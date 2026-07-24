const axios = require('axios');
const { prisma } = require('../config/prisma');
const { createEfiInstance } = require('../config/efi.config');
const { getPagBankCredentials, pagBankAuthHeaders, } = require('../config/pagbank.config');
const { resolveEfiCertificate } = require('./gatewayValidation.service');
const { fulfillPaidOrder, notifyOrderChatCreated } = require('./orderFulfillment.service');
const orderEmailService = require('./orderEmail.service');
const { emitOrderPaidSideEffects } = require('./orderPaidSideEffects.service');
const { resolveCustomerFromOrder, formatPagBankCheckoutPhone, formatPagBankOrderPhones } = require('../utils/checkoutConfig');
const { isGatewaySandbox } = require('../utils/gatewaySandbox');

const PIX_EXPIRATION_SECONDS = 30 * 60;
const PROVIDER_SLUGS = ['efi-bank', 'mercado-pago', 'pagbank', 'stripe'];

function getPublicApiUrl() {
  const url = process.env.API_PUBLIC_URL || process.env.PUBLIC_API_URL || process.env.BACKEND_URL;
  return url ? url.replace(/\/$/, '') : null;
}

function webhookUrl(path, { withToken = false, efiIgnore = false } = {}) {
  const base = getPublicApiUrl();
  if (!base) return null;
  let url = `${base}${path}`;
  const secret = String(process.env.WEBHOOK_SHARED_SECRET || '').trim();
  if (withToken && secret) {
    const params = new URLSearchParams();
    params.set('token', secret);
    if (efiIgnore) params.set('ignorar', '');
    url += `?${params.toString()}`;
  }
  return url;
}

function formatBrlFromCents(cents) {
  return (Math.max(0, cents) / 100).toFixed(2);
}

function normalizeSlug(slug) {
  return slug === 'efi-pix' ? 'efi-bank' : slug;
}

const { unlockGatewayConfig } = require('../utils/gatewaySecrets');
const { maskEmail } = require('../utils/maskSensitive');

function getConfig(gateway) {
  return unlockGatewayConfig(gateway?.config || {});
}

async function getPagBankToken(config) {
  const creds = getPagBankCredentials(config);
  if (creds.hasToken) {
    return creds.token;
  }
  if (!creds.hasOAuth) {
    throw new Error('Informe Client ID + Client Secret ou um Access Token PagBank.');
  }
  const auth = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64');
  const { data } = await axios.post(
    `${creds.baseUrl}/oauth2/token`,
    'grant_type=client_credentials',
    {
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      timeout: 15000,
    }
  );
  return data.access_token;
}

async function savePixPayment(order, provider, externalId, metadata) {
  await prisma.payment.create({
    data: {
      userId: order.userId,
      orderId: order.id,
      amount: order.total,
      status: 'PENDING',
      provider,
      externalId,
      description: `PIX pedido ${order.id}`,
      metadata,
    },
  });
  orderEmailService.notifyPaymentPending(order.id, metadata);
  return metadata;
}

async function saveCardPayment(order, provider, externalId, metadata) {
  await prisma.payment.create({
    data: {
      userId: order.userId,
      orderId: order.id,
      amount: order.total,
      status: 'PENDING',
      provider,
      externalId,
      description: `Cartão pedido ${order.id}`,
      metadata,
    },
  });
  orderEmailService.notifyPaymentPending(order.id, metadata);
  return metadata;
}

async function createEfiPix(order, gateway) {
  const config = getConfig(gateway);
  const efi = createEfiInstance({
    clientId: config.clientId || config.client_id,
    clientSecret: config.clientSecret || config.client_secret,
    pixKey: config.pixKey || config.pix_key,
    sandbox: isGatewaySandbox(config),
    certificateBase64: config.certificateBase64,
    certificatePath: config.certificateBase64 ? undefined : resolveEfiCertificate(config),
  });

  const body = {
    calendario: { expiracao: PIX_EXPIRATION_SECONDS },
    valor: { original: formatBrlFromCents(order.total) },
    chave: config.pixKey || config.pix_key,
    solicitacaoPagador: `Pedido ${order.id}`,
  };

  const charge = await efi.pixCreateImmediateCharge([], body);
  const txid = charge.txid;
  const locId = charge.loc?.id;
  if (!txid || !locId) throw new Error('Falha ao gerar cobrança PIX Efí');

  const qr = await efi.pixGenerateQRCode({ id: locId });
  const expiresAt = new Date(Date.now() + PIX_EXPIRATION_SECONDS * 1000).toISOString();

  const metadata = {
    type: 'PIX',
    provider: 'efi-bank',
    copyPaste: qr.qrcode || qr.pixCopiaECola,
    qrCode: qr.imagemQrcode || null,
    expiresAt,
    txid,
  };

  return savePixPayment(order, 'efi-bank', txid, metadata);
}

async function createMercadoPagoPix(order, gateway) {
  const config = getConfig(gateway);
  const accessToken = config.accessToken || config.access_token;
  const { customerEmail: payerEmail } = resolveCustomerFromOrder(order);
  const idempotencyKey = `pix-${order.id}`;

  let data;
  try {
    const payload = {
      transaction_amount: parseFloat(formatBrlFromCents(order.total)),
      description: `Pedido ${order.id}`,
      payment_method_id: 'pix',
      payer: { email: payerEmail },
      external_reference: order.id,
    };
    const mpWebhook = webhookUrl('/v1/webhooks/mercado-pago', { withToken: true });
    if (mpWebhook) payload.notification_url = mpWebhook;

    const response = await axios.post(
      'https://api.mercadopago.com/v1/payments',
      payload,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Idempotency-Key': idempotencyKey,
        },
        timeout: 20000,
      }
    );
    data = response.data;
  } catch (err) {
    const msg = err?.response?.data?.message
      || err?.response?.data?.cause?.[0]?.description
      || err.message;
    throw new Error(`Mercado Pago: ${msg}`);
  }

  const txData = data.point_of_interaction?.transaction_data;
  if (!txData?.qr_code) throw new Error('Mercado Pago não retornou QR Code PIX');

  const expiresAt = txData.date_of_expiration
    || new Date(Date.now() + PIX_EXPIRATION_SECONDS * 1000).toISOString();

  const metadata = {
    type: 'PIX',
    provider: 'mercado-pago',
    copyPaste: txData.qr_code,
    qrCode: txData.qr_code_base64 ? `data:image/png;base64,${txData.qr_code_base64}` : null,
    expiresAt,
    paymentId: String(data.id),
  };

  return savePixPayment(order, 'mercado-pago', String(data.id), metadata);
}

async function createPagBankPix(order, gateway) {
  const config = getConfig(gateway);
  const creds = getPagBankCredentials(config);
  const token = await getPagBankToken(config);
  const baseUrl = creds.baseUrl;

  const { customerName, customerEmail, customerCpf, customerPhone } = resolveCustomerFromOrder(order);

  if (!customerCpf || customerCpf.length !== 11) {
    throw new Error('PagBank: CPF do comprador é obrigatório');
  }

  const customer = {
    name: customerName.slice(0, 80),
    email: customerEmail,
    tax_id: customerCpf,
  };
  const phones = formatPagBankOrderPhones(customerPhone);
  if (phones) customer.phones = phones;

  // 1 line item = order.total (frete/desconto já embutidos) — evita divergência com o QR
  const orderPayload = {
    reference_id: order.id,
    customer,
    items: [{
      reference_id: '1',
      name: String(`Pedido ${(order.id || '').slice(0, 12)}`)
        .replace(/[^\w\sÀ-ÿ\-.,()/+&]/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 100) || 'Pedido',
      quantity: 1,
      unit_amount: Math.max(1, Number(order.total) || 1),
    }],
    qr_codes: [{
      amount: { value: order.total },
      expiration_date: new Date(Date.now() + PIX_EXPIRATION_SECONDS * 1000).toISOString().split('.')[0] + 'Z',
    }],
  };
  const pagbankWebhook = webhookUrl('/v1/webhooks/pagbank', { withToken: true });
  // Some sandbox environments fail if the webhook is not publicly reachable or has certain TLDs
  if (pagbankWebhook && !pagbankWebhook.includes('localhost')) {
    orderPayload.notification_urls = [pagbankWebhook];
  }

  let data;
  try {
    const response = await axios.post(
      `${baseUrl}/orders`,
      orderPayload,
      {
        headers: pagBankAuthHeaders(token, { 'Content-Type': 'application/json' }),
        timeout: 20000,
      }
    );
    data = response.data;
  } catch (err) {
    const errorData = err?.response?.data;
    const msg = errorData?.error_messages?.[0]?.description
      || errorData?.message
      || err.message;
    console.error('[createPagBankPix Error Detail]', msg);
    throw new Error(`PagBank: ${msg}`);
  }

  const qr = data.qr_codes?.[0];
  const text = qr?.text;
  if (!text) throw new Error('PagBank não retornou QR Code PIX');

  const metadata = {
    type: 'PIX',
    provider: 'pagbank',
    copyPaste: text,
    qrCode: qr.links?.find((l) => l.rel === 'QRCODE.PNG')?.href || null,
    expiresAt: qr.expiration_date || new Date(Date.now() + PIX_EXPIRATION_SECONDS * 1000).toISOString(),
    orderId: data.id,
  };

  return savePixPayment(order, 'pagbank', data.id, metadata);
}

async function createStripeCard(order, gateway) {
  const config = getConfig(gateway);
  const secretKey = config.secretKey || config.secret_key;
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const successUrl = `${frontendUrl}/checkout/payment/${order.id}?card=success`;
  const cancelUrl = `${frontendUrl}/checkout/payment/${order.id}?card=cancel`;
  const { customerEmail } = resolveCustomerFromOrder(order);

  const params = new URLSearchParams();
  params.append('mode', 'payment');
  params.append('success_url', successUrl);
  params.append('cancel_url', cancelUrl);
  params.append('payment_method_types[]', 'card');
  params.append('metadata[order_id]', order.id);
  params.append('expires_at', String(Math.floor((Date.now() + PIX_EXPIRATION_SECONDS * 1000) / 1000)));
  if (customerEmail) params.append('customer_email', customerEmail);

  // Cobrar exatamente order.total (inclui frete e desconto) — 1 line item
  params.append('line_items[0][quantity]', '1');
  params.append('line_items[0][price_data][currency]', 'brl');
  params.append('line_items[0][price_data][unit_amount]', String(Math.max(1, Number(order.total) || 1)));
  params.append(
    'line_items[0][price_data][product_data][name]',
    String(`Pedido ${(order.id || '').slice(0, 12)}`).slice(0, 120)
  );

  try {
    const { data } = await axios.post('https://api.stripe.com/v1/checkout/sessions', params, {
      auth: { username: secretKey, password: '' },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 20000,
    });

    const metadata = {
      type: 'CARD',
      provider: 'stripe',
      checkoutUrl: data.url,
      sessionId: data.id,
      expiresAt: data.expires_at
        ? new Date(data.expires_at * 1000).toISOString()
        : new Date(Date.now() + PIX_EXPIRATION_SECONDS * 1000).toISOString(),
      status: data.payment_status || 'unpaid',
    };

    return saveCardPayment(order, 'stripe', data.id, metadata);
  } catch (err) {
    const stripeError = err.response?.data?.error?.message || err.message;
    console.error('[Stripe Card Error]', err.response?.data || err.message);
    throw new Error(`Stripe: ${stripeError}`);
  }
}

async function createMercadoPagoCard(order, gateway) {
  const config = getConfig(gateway);
  const accessToken = config.accessToken || config.access_token;
  
  let frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:3000').trim();
  if (!frontendUrl.startsWith('http')) {
    frontendUrl = `https://${frontendUrl}`;
  }
  frontendUrl = frontendUrl.replace(/\/$/, '');

  const items = [{
    title: String(`Pedido ${(order.id || '').slice(0, 12)}`).slice(0, 120),
    quantity: 1,
    unit_price: parseFloat(formatBrlFromCents(Math.max(1, Number(order.total) || 1))),
    currency_id: 'BRL',
  }];

  const isLocal = frontendUrl.includes('localhost') || frontendUrl.includes('127.0.0.1');

  const payload = {
    items,
    external_reference: order.id,
    back_urls: {
      success: `${frontendUrl}/checkout/payment/${order.id}?card=success`,
      failure: `${frontendUrl}/checkout/payment/${order.id}?card=cancel`,
      pending: `${frontendUrl}/checkout/payment/${order.id}?card=pending`,
    },
    auto_return: isLocal ? undefined : 'approved',
  };

  const mpWebhook = webhookUrl('/v1/webhooks/mercado-pago', { withToken: true });
  if (mpWebhook) payload.notification_url = mpWebhook;

  try {
    const { data } = await axios.post(
      'https://api.mercadopago.com/checkout/preferences',
      payload,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 20000,
      }
    );

    const checkoutUrl = data.init_point || data.sandbox_init_point;
    if (!checkoutUrl) throw new Error('Mercado Pago não retornou URL de checkout');

    const metadata = {
      type: 'CARD',
      provider: 'mercado-pago',
      checkoutUrl,
      preferenceId: data.id,
      expiresAt: new Date(Date.now() + PIX_EXPIRATION_SECONDS * 1000).toISOString(),
    };

    return saveCardPayment(order, 'mercado-pago', String(data.id), metadata);
  } catch (err) {
    const msg = err?.response?.data?.message
      || err?.response?.data?.cause?.[0]?.description
      || err.message;
    throw new Error(`Mercado Pago: ${msg}`);
  }
}

function toSandboxBuyerEmail(email) {
  const raw = String(email || 'cliente@spacepoint.com').trim().toLowerCase();
  if (raw.endsWith('@sandbox.pagseguro.com.br')) return raw.slice(0, 60);
  const local = raw.split('@')[0] || 'cliente';
  const safeLocal = local.replace(/[^a-z0-9._+-]/g, '').slice(0, 40) || 'cliente';
  return `${safeLocal}@sandbox.pagseguro.com.br`.slice(0, 60);
}

async function createPagBankCard(order, gateway) {
  const config = getConfig(gateway);
  const creds = getPagBankCredentials(config);
  const token = await getPagBankToken(config);
  const baseUrl = creds.baseUrl;

  const { customerName, customerEmail, customerCpf, customerPhone } = resolveCustomerFromOrder(order);

  if (!customerCpf || customerCpf.length !== 11) {
    throw new Error('PagBank: CPF do comprador é obrigatório');
  }

  // No sandbox, e-mail @gmail/@outlook costuma falhar no Checkout hospedado.
  // PagBank recomenda domínio @sandbox.pagseguro.com.br para comprador de teste.
  const emailForCheckout = creds.sandbox
    ? toSandboxBuyerEmail(customerEmail)
    : String(customerEmail || 'cliente@email.com').slice(0, 60);

  const customer = {
    name: String(customerName || 'Cliente').slice(0, 80),
    email: emailForCheckout,
    tax_id: customerCpf,
  };

  let phone = formatPagBankCheckoutPhone(customerPhone);
  // Checkout sandbox frequentemente exige celular; usa placeholder válido se faltar
  if (!phone && creds.sandbox) {
    phone = { country: '+55', area: '11', number: '999999999' };
  }
  if (phone) {
    customer.phone = phone;
  }

  const items = [{
    reference_id: 'ITEM1',
    name: String(`Pedido ${(order.id || '').slice(0, 12)}`)
      .replace(/[^\w\sÀ-ÿ\-.,()/+&]/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100) || 'Pedido',
    quantity: 1,
    unit_amount: Math.max(1, Number(order.total) || 1),
  }];

  const payload = {
    reference_id: String(order.id).slice(0, 64),
    customer,
    // Em produção trava dados do comprador; sandbox permite ajuste no hosted checkout
    customer_modifiable: Boolean(creds.sandbox),
    items,
    soft_descriptor: 'SpacePoint',
    payment_methods: [
      {
        type: 'CREDIT_CARD',
        brands: ['VISA', 'MASTERCARD', 'ELO', 'AMEX', 'HIPERCARD', 'HIPER'],
      },
    ],
    payment_methods_configs: [
      {
        type: 'CREDIT_CARD',
        config_options: [
          { option: 'INSTALLMENTS_LIMIT', value: '1' },
        ],
      },
    ],
  };

  const pagbankWebhook = webhookUrl('/v1/webhooks/pagbank', { withToken: true });
  if (
    pagbankWebhook
    && !pagbankWebhook.includes('localhost')
    && !pagbankWebhook.includes('127.0.0.1')
    && pagbankWebhook.startsWith('https://')
  ) {
    payload.notification_urls = [pagbankWebhook];
    payload.payment_notification_urls = [pagbankWebhook];
  }

  const storeUrl = String(process.env.FRONTEND_URL || '').replace(/\/$/, '');
  if (storeUrl.startsWith('https://')) {
    payload.return_url = `${storeUrl}/checkout/payment/${order.id}`.slice(0, 255);
  }

  console.log('[createPagBankCard]', {
    sandbox: creds.sandbox,
    baseUrl,
    email: maskEmail(customer.email),
    hasPhone: Boolean(customer.phone),
    amount: order.total,
  });

  try {
    const { data } = await axios.post(
      `${baseUrl}/checkouts`,
      payload,
      {
        headers: pagBankAuthHeaders(token, { 'Content-Type': 'application/json' }),
        timeout: 20000,
      }
    );

    const checkoutUrl = data.links?.find((l) => ['PAY', 'CHECKOUT'].includes(l.rel))?.href;
    if (!checkoutUrl) throw new Error('PagBank não retornou URL de checkout');

    if (creds.sandbox && !String(checkoutUrl).includes('sandbox')) {
      console.warn('[createPagBankCard] URL sem sandbox — confira se o token é de teste');
    }

    const metadata = {
      type: 'CARD',
      provider: 'pagbank',
      checkoutUrl,
      checkoutId: data.id,
      sandbox: creds.sandbox,
      expiresAt: new Date(Date.now() + PIX_EXPIRATION_SECONDS * 1000).toISOString(),
    };

    return saveCardPayment(order, 'pagbank', data.id, metadata);
  } catch (err) {
    const errorData = err?.response?.data;
    const first = errorData?.error_messages?.[0];
    const msg = first?.description
      || errorData?.message
      || err.message;
    const param = first?.parameter_name ? ` (${first.parameter_name})` : '';
    console.error('[createPagBankCard Error Detail]', first?.description || msg);
    throw new Error(`PagBank: ${msg}${param}`);
  }
}

function formatEfiApiError(err) {
  const desc = err?.error_description;
  if (typeof desc === 'string' && desc.trim()) return desc;
  if (desc && typeof desc === 'object') {
    if (typeof desc.message === 'string') return desc.message;
    if (typeof desc.property === 'string') {
      return `Parâmetro inválido: ${desc.property}`;
    }
    try {
      return JSON.stringify(desc);
    } catch {
      /* ignore */
    }
  }
  if (typeof err?.error === 'string' && err.error.trim()) return err.error;
  if (typeof err?.message === 'string' && err.message.trim() && err.message !== '[object Object]') {
    return err.message;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return 'Falha ao criar link Efí';
  }
}

/** expire_at da API de Cobranças exige yyyy-mm-dd (não datetime ISO). */
function efiLinkExpireDate(daysFromNow = 1) {
  const d = new Date(Date.now() + Math.max(1, daysFromNow) * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

async function createEfiCard(order, gateway) {
  const config = getConfig(gateway);
  const efi = createEfiInstance({
    clientId: config.clientId || config.client_id,
    clientSecret: config.clientSecret || config.client_secret,
    sandbox: isGatewaySandbox(config),
    certificateBase64: config.certificateBase64,
    certificatePath: config.certificateBase64 ? undefined : resolveEfiCertificate(config),
  });

  const { customerEmail } = resolveCustomerFromOrder(order);
  const expireAt = efiLinkExpireDate(1);
  const itemName = String(`Pedido ${(order.id || '').slice(0, 12)}`)
    .replace(/[^\w\sÀ-ÿ\-.,()/+&]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 255) || 'Pedido';

  const body = {
    items: [{
      name: itemName,
      value: Math.max(1, Number(order.total) || 1),
      amount: 1,
    }],
    metadata: {
      custom_id: String(order.id).slice(0, 255),
    },
    settings: {
      payment_method: 'credit_card',
      expire_at: expireAt,
      request_delivery_address: false,
      message: `Pedido ${(order.id || '').slice(0, 12)}`.slice(0, 80),
    },
  };

  if (customerEmail) {
    body.customer = { email: String(customerEmail).slice(0, 255) };
  }

  try {
    const charge = await efi.createOneStepLink({}, body);
    const data = charge?.data || charge;
    const checkoutUrl = data?.payment_url || data?.link || charge?.payment_url;
    const chargeId = String(
      data?.charge_id
      || charge?.charge_id
      || data?.id
      || `efi-link-${order.id}-${Date.now()}`
    );

    if (!checkoutUrl) throw new Error('Efí não retornou link de pagamento');

    const metadata = {
      type: 'CARD',
      provider: 'efi-bank',
      checkoutUrl,
      chargeId,
      expiresAt: new Date(`${expireAt}T23:59:59.000Z`).toISOString(),
    };

    return saveCardPayment(order, 'efi-bank', chargeId, metadata);
  } catch (err) {
    console.error('[createEfiCard Error Detail]', err);
    throw new Error(`Efí Bank: ${formatEfiApiError(err)}`);
  }
}


const CREATORS = {
  'efi-bank': createEfiPix,
  'efi-pix': createEfiPix,
  'mercado-pago': createMercadoPagoPix,
  pagbank: createPagBankPix,
};

const CARD_CREATORS = {
  'efi-bank': createEfiCard,
  'mercado-pago': createMercadoPagoCard,
  pagbank: createPagBankCard,
  stripe: createStripeCard,
};

async function createPixCharge(order, gateway) {
  const slug = normalizeSlug(gateway.slug);
  const creator = CREATORS[slug];
  if (!creator) throw new Error(`Provedor PIX não suportado: ${slug}`);
  return creator(order, gateway);
}

async function createCardCharge(order, gateway) {
  const slug = normalizeSlug(gateway.slug);
  const creator = CARD_CREATORS[slug];
  if (!creator) throw new Error(`Provedor cartão não suportado: ${slug}`);
  return creator(order, gateway);
}

async function markPaymentPaid(payment, paidCents, description) {
  let orderResult = null;
  let fulfilled = false;
  let shouldNotify = false;

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "Payment" WHERE id = ${payment.id} FOR UPDATE`;
    await tx.$executeRaw`SELECT 1 FROM "Order" WHERE id = ${payment.orderId} FOR UPDATE`;

    const currentPayment = await tx.payment.findUnique({ where: { id: payment.id } });
    // Aceita PENDING e CANCELLED (pedido/cobrança expirados antes do webhook)
    if (!currentPayment || !['PENDING', 'CANCELLED'].includes(currentPayment.status)) {
      fulfilled = currentPayment?.status === 'PAID';
      return;
    }

    const order = await tx.order.findUnique({
      where: { id: payment.orderId },
      select: { id: true, status: true, total: true },
    });
    if (!order) return;

    // Já pago: só garante o registro deste payment (idempotência)
    if (['PAID', 'DELIVERED'].includes(order.status)) {
      if (currentPayment.status !== 'PAID') {
        await tx.payment.update({
          where: { id: payment.id },
          data: { status: 'PAID', amount: paidCents ?? currentPayment.amount },
        });
      }
      fulfilled = true;
      return;
    }

    if (!['PENDING', 'CANCELLED'].includes(order.status)) {
      console.error('[markPaymentPaid] status de pedido incompatível', {
        orderId: order.id,
        orderStatus: order.status,
        paymentId: currentPayment.id,
      });
      return;
    }

    const expected = Number(order.total) || Number(currentPayment.amount) || 0;
    if (paidCents == null || paidCents < expected - 1) {
      console.error('[markPaymentPaid] valor insuficiente', {
        orderId: order.id,
        paidCents,
        expected,
        paymentId: currentPayment.id,
      });
      return;
    }

    // Reabre cobrança CANCELLED antes do fulfill (skipPaymentCreate atualiza este registro)
    if (currentPayment.status === 'CANCELLED') {
      await tx.payment.update({
        where: { id: payment.id },
        data: { status: 'PENDING' },
      });
    }

    const recoverFromCancellation = order.status === 'CANCELLED';

    orderResult = await fulfillPaidOrder(tx, payment.orderId, {
      provider: payment.provider,
      externalId: payment.externalId,
      description,
      skipPaymentCreate: true,
      recoverFromCancellation,
    });

    await tx.payment.update({
      where: { id: payment.id },
      data: { status: 'PAID', amount: paidCents },
    });

    // Cancela outras cobranças PENDING do mesmo pedido (evita double-pay side-effects)
    await tx.payment.updateMany({
      where: {
        orderId: payment.orderId,
        status: 'PENDING',
        id: { not: payment.id },
      },
      data: { status: 'CANCELLED' },
    });

    fulfilled = true;
    shouldNotify = true;
  });

  if (orderResult && fulfilled && shouldNotify) {
    notifyOrderChatCreated(orderResult);
    orderEmailService.notifyPaymentConfirmed(orderResult.id);
    emitOrderPaidSideEffects(orderResult.id);
  }
  return fulfilled;
}

async function verifyEfiPayment(payment, gateway) {
  const config = getConfig(gateway);
  const meta = payment.metadata || {};

  if (meta.type === 'CARD') {
    const efi = createEfiInstance({
      clientId: config.clientId || config.client_id,
      clientSecret: config.clientSecret || config.client_secret,
      sandbox: isGatewaySandbox(config),
      certificateBase64: config.certificateBase64,
      certificatePath: config.certificateBase64 ? undefined : resolveEfiCertificate(config),
    });

    try {
      const detail = await efi.detailCharge({ id: Number(payment.externalId) || payment.externalId });
      const status = detail?.data?.status || detail?.status;
      const isPaid = ['paid', 'settled', 'approved'].includes(String(status || '').toLowerCase());
      if (!isPaid) return false;
      // API Cobranças retorna total já em centavos
      const paidCents = detail?.data?.total != null
        ? Math.round(Number(detail.data.total))
        : null;
      if (paidCents == null || paidCents < payment.amount - 1) return false;
      await markPaymentPaid(payment, paidCents, 'Pagamento cartão Efí confirmado');
      return true;
    } catch {
      return false;
    }
  }

  const txid = payment.externalId;
  const efi = createEfiInstance({
    clientId: config.clientId || config.client_id,
    clientSecret: config.clientSecret || config.client_secret,
    sandbox: isGatewaySandbox(config),
    certificateBase64: config.certificateBase64,
    certificatePath: config.certificateBase64 ? undefined : resolveEfiCertificate(config),
  });
  const detail = await efi.pixDetailCharge({ txid });
  if (detail.status !== 'CONCLUIDA') return false;
  const paidCents = Math.round(parseFloat(detail.valor?.original || '0') * 100);
  if (paidCents < payment.amount) return false;
  await markPaymentPaid(payment, paidCents, 'Pagamento PIX Efí confirmado');
  return true;
}

async function verifyMercadoPagoPayment(payment, gateway) {
  const config = getConfig(gateway);
  const accessToken = config.accessToken || config.access_token;
  const meta = payment.metadata || {};

  if (meta.type === 'CARD') {
    const { data } = await axios.get(
      'https://api.mercadopago.com/v1/payments/search',
      {
        params: { external_reference: payment.orderId, sort: 'date_created', criteria: 'desc' },
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 15000,
      }
    );
    const approved = (data.results || []).find((p) => p.status === 'approved');
    if (!approved) return false;
    const paidCents = Math.round((approved.transaction_amount || 0) * 100);
    if (paidCents < payment.amount - 1) return false;
    await markPaymentPaid(payment, paidCents, 'Pagamento cartão Mercado Pago confirmado');
    return true;
  }

  const { data } = await axios.get(
    `https://api.mercadopago.com/v1/payments/${payment.externalId}`,
    { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 15000 }
  );

  const isApproved = data.status === 'approved'
    || data.status_detail === 'accredited'
    || Boolean(data.date_approved);
  if (!isApproved) return false;

  const paidCents = Math.round((data.transaction_amount || 0) * 100);
  if (paidCents < payment.amount - 1) return false;

  await markPaymentPaid(payment, paidCents, 'Pagamento PIX Mercado Pago confirmado');
  return true;
}

async function verifyPagBankPayment(payment, gateway) {
  const config = getConfig(gateway);
  const creds = getPagBankCredentials(config);
  const token = await getPagBankToken(config);
  const meta = payment.metadata || {};

  async function fetchCheckoutOrOrder(id) {
    try {
      const response = await axios.get(`${creds.baseUrl}/checkouts/${id}`, {
        headers: pagBankAuthHeaders(token),
        timeout: 15000,
      });
      return response.data;
    } catch {
      const response = await axios.get(`${creds.baseUrl}/orders/${id}`, {
        headers: pagBankAuthHeaders(token),
        timeout: 15000,
      });
      return response.data;
    }
  }

  let data;
  try {
    data = await fetchCheckoutOrOrder(payment.externalId);
  } catch (err) {
    const message = err?.response?.data?.error_messages?.[0]?.description || '';
    if (message.includes('No known parameter was given') && payment.orderId) {
      data = await fetchCheckoutOrOrder(payment.orderId);
    } else {
      throw err;
    }
  }

  const charge = data.charges?.find((c) => c.status === 'PAID') || data.charges?.[0];
  const isPaid = charge?.status === 'PAID' || data.status === 'PAID';
  if (!isPaid) return false;

  const paidCents = charge?.amount?.value
    || data.amount?.value
    || data.qr_codes?.[0]?.amount?.value
    || 0;
  if (paidCents < payment.amount - 1) return false;

  const label = meta.type === 'CARD' ? 'Pagamento cartão PagBank confirmado' : 'Pagamento PagBank confirmado';
  await markPaymentPaid(payment, paidCents, label);
  return true;
}

async function verifyStripePayment(payment, gateway) {
  const config = getConfig(gateway);
  const secretKey = config.secretKey || config.secret_key;
  let data;
  if (String(payment.externalId || '').startsWith('cs_')) {
    const sessionResp = await axios.get(
      `https://api.stripe.com/v1/checkout/sessions/${payment.externalId}`,
      {
        auth: { username: secretKey, password: '' },
        params: { 'expand[]': 'payment_intent' },
        timeout: 15000,
      }
    );
    const session = sessionResp.data;
    if (session.payment_status === 'paid') {
      const paidCents = Number(session.amount_total);
      if (!Number.isFinite(paidCents) || paidCents < payment.amount - 1) {
        console.warn(
          '[Stripe] Session paga com valor insuficiente',
          payment.externalId,
          paidCents,
          payment.amount
        );
        return false;
      }
      await markPaymentPaid(payment, paidCents, 'Pagamento cartão Stripe confirmado');
      return true;
    }
    const piId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
    if (!piId) return false;
    const piResp = await axios.get(
      `https://api.stripe.com/v1/payment_intents/${piId}`,
      { auth: { username: secretKey, password: '' }, timeout: 15000 }
    );
    data = piResp.data;
  } else {
    const piResp = await axios.get(
      `https://api.stripe.com/v1/payment_intents/${payment.externalId}`,
      { auth: { username: secretKey, password: '' }, timeout: 15000 }
    );
    data = piResp.data;
  }

  const isPaid = data.status === 'succeeded'
    || (data.status === 'requires_capture' && data.amount_received > 0);
  if (!isPaid) return false;
  if ((data.amount_received || 0) < payment.amount - 1) return false;

  await markPaymentPaid(payment, data.amount_received, 'Pagamento Stripe confirmado');
  return true;
}

const VERIFIERS = {
  'efi-bank': verifyEfiPayment,
  'efi-pix': verifyEfiPayment,
  'mercado-pago': verifyMercadoPagoPayment,
  pagbank: verifyPagBankPayment,
  stripe: verifyStripePayment,
};

async function verifyAndFulfillPayment(payment) {
  if (!payment) return false;
  if (payment.status === 'PAID') return true;

  // Cobrança CANCELLED (QR regenerado ou pedido expirado): reabre se o pedido
  // ainda for PENDING/CANCELLED e não houver outra cobrança ativa/paga.
  if (payment.status === 'CANCELLED') {
    const order = await prisma.order.findUnique({
      where: { id: payment.orderId },
      select: { status: true },
    });
    if (!order || !['PENDING', 'CANCELLED'].includes(order.status)) return false;

    const activeOther = await prisma.payment.findFirst({
      where: {
        orderId: payment.orderId,
        id: { not: payment.id },
        status: { in: ['PENDING', 'PAID'] },
      },
      select: { id: true },
    });
    if (activeOther) return false;

    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'PENDING' },
    });
    payment = { ...payment, status: 'PENDING' };
  } else if (payment.status !== 'PENDING') {
    return false;
  }

  const slug = normalizeSlug(payment.provider);
  const gateway = await prisma.gatewayConfig.findFirst({
    where: { slug: { in: [slug, payment.provider] } },
  });
  if (!gateway) return false;

  const verifier = VERIFIERS[slug];
  if (!verifier) return false;

  try {
    return await verifier(payment, gateway);
  } catch (err) {
    console.error('[verifyAndFulfillPayment]', slug, payment.externalId, err.message);
    return false;
  }
}

async function handleEfiWebhook(body) {
  const pixList = body?.pix;
  if (!Array.isArray(pixList)) return;
  for (const entry of pixList) {
    if (!entry?.txid) continue;
    let payment = await prisma.payment.findFirst({
      where: { externalId: entry.txid, status: 'PENDING', provider: { in: ['efi-bank', 'efi-pix'] } },
    });
    if (!payment) {
      payment = await prisma.payment.findFirst({
        where: { externalId: entry.txid, provider: { in: ['efi-bank', 'efi-pix'] } },
        orderBy: { createdAt: 'desc' },
      });
    }
    if (payment) await verifyAndFulfillPayment(payment);
  }
}

async function findPaymentByMercadoPagoId(paymentId, gateway) {
  let payment = await prisma.payment.findFirst({
    where: { externalId: String(paymentId), provider: 'mercado-pago' },
    orderBy: { createdAt: 'desc' },
  });
  if (payment) return payment;

  const config = getConfig(gateway);
  const accessToken = config.accessToken || config.access_token;
  if (!accessToken) return null;

  try {
    const { data } = await axios.get(
      `https://api.mercadopago.com/v1/payments/${paymentId}`,
      { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 15000 }
    );
    if (!data?.external_reference) return null;
    return prisma.payment.findFirst({
      where: {
        orderId: data.external_reference,
        provider: 'mercado-pago',
        status: { in: ['PENDING', 'CANCELLED'] },
      },
      orderBy: { createdAt: 'desc' },
    });
  } catch {
    return null;
  }
}

async function handleMercadoPagoWebhook(body, query = {}) {
  const paymentId = body?.data?.id
    || body?.id
    || query?.id
    || query?.['data.id'];

  if (!paymentId) return;

  let payment = await prisma.payment.findFirst({
    where: { externalId: String(paymentId), status: 'PENDING', provider: 'mercado-pago' },
  });

  if (!payment) {
    const gateway = await prisma.gatewayConfig.findFirst({
      where: { slug: 'mercado-pago', isActive: true },
    });
    if (gateway) {
      payment = await findPaymentByMercadoPagoId(paymentId, gateway);
    }
  }

  if (payment) await verifyAndFulfillPayment(payment);
}

async function handlePagBankWebhook(body) {
  const orderId = body?.id
    || body?.order_id
    || body?.reference_id
    || body?.charges?.[0]?.reference_id;
  if (!orderId) return;

  const orConditions = [{ externalId: String(orderId), provider: 'pagbank' }];
  if (body?.reference_id) {
    orConditions.push({ orderId: String(body.reference_id), provider: 'pagbank' });
  }

  const payment = await prisma.payment.findFirst({
    where: { OR: orConditions, status: 'PENDING' },
    orderBy: { createdAt: 'desc' },
  });
  if (payment) await verifyAndFulfillPayment(payment);
}

async function handleStripeWebhook(body) {
  const eventType = body?.type;
  const obj = body?.data?.object;
  if (!obj?.id) return;

  if (eventType === 'checkout.session.completed' || eventType === 'checkout.session.async_payment_succeeded') {
    const sessionId = obj.id;
    let payment = await prisma.payment.findFirst({
      where: { externalId: sessionId, status: 'PENDING', provider: 'stripe' },
    });
    if (!payment && obj.metadata?.order_id) {
      payment = await prisma.payment.findFirst({
        where: {
          orderId: obj.metadata.order_id,
          status: 'PENDING',
          provider: 'stripe',
        },
        orderBy: { createdAt: 'desc' },
      });
    }
    if (payment) await verifyAndFulfillPayment(payment);
    return;
  }

  const intentId = obj.id;
  let payment = await prisma.payment.findFirst({
    where: { externalId: intentId, status: 'PENDING', provider: 'stripe' },
  });

  if (!payment && obj?.metadata?.order_id) {
    payment = await prisma.payment.findFirst({
      where: {
        orderId: obj.metadata.order_id,
        status: 'PENDING',
        provider: 'stripe',
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  if (payment) await verifyAndFulfillPayment(payment);
}

async function syncPendingOrderPayment(orderId) {
  const payment = await prisma.payment.findFirst({
    where: {
      orderId,
      status: 'PENDING',
      provider: { not: 'dev-mock-pix' },
    },
    orderBy: { createdAt: 'desc' },
  });
  if (!payment) return false;
  return verifyAndFulfillPayment(payment);
}

module.exports = {
  PROVIDER_SLUGS,
  createPixCharge,
  createCardCharge,
  verifyAndFulfillPayment,
  syncPendingOrderPayment,
  handleEfiWebhook,
  handleMercadoPagoWebhook,
  handlePagBankWebhook,
  handleStripeWebhook,
};
