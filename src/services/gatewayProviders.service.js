const axios = require('axios');
const { prisma } = require('../config/prisma');
const { createEfiInstance } = require('../config/efi.config');
const {
  getPagBankCredentials,
  pagBankAuthHeaders,
} = require('../config/pagbank.config');
const { resolveEfiCertificate } = require('./gatewayValidation.service');
const { fulfillPaidOrder } = require('./orderFulfillment.service');

const PIX_EXPIRATION_SECONDS = 30 * 60;
const PROVIDER_SLUGS = ['efi-bank', 'mercado-pago', 'pagbank', 'stripe'];

function getPublicApiUrl() {
  const url = process.env.API_PUBLIC_URL || process.env.PUBLIC_API_URL || process.env.BACKEND_URL;
  return url ? url.replace(/\/$/, '') : null;
}

function webhookUrl(path) {
  const base = getPublicApiUrl();
  return base ? `${base}${path}` : null;
}

function formatBrlFromCents(cents) {
  return (Math.max(0, cents) / 100).toFixed(2);
}

function normalizeSlug(slug) {
  return slug === 'efi-pix' ? 'efi-bank' : slug;
}

function getConfig(gateway) {
  return gateway?.config || {};
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
  return metadata;
}

async function createEfiPix(order, gateway) {
  const config = getConfig(gateway);
  const efi = createEfiInstance({
    clientId: config.clientId || config.client_id,
    clientSecret: config.clientSecret || config.client_secret,
    pixKey: config.pixKey || config.pix_key,
    sandbox: config.sandbox !== false,
    certificatePath: resolveEfiCertificate(config),
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
  const payerEmail = order.user?.email || order.customerEmail || 'cliente@spacepoint.com';
  const idempotencyKey = `pix-${order.id}-${Date.now()}`;

  let data;
  try {
    const payload = {
      transaction_amount: parseFloat(formatBrlFromCents(order.total)),
      description: `Pedido ${order.id}`,
      payment_method_id: 'pix',
      payer: { email: payerEmail },
      external_reference: order.id,
    };
    const mpWebhook = webhookUrl('/v1/webhooks/mercado-pago');
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

  const customerName = order.user?.name || order.customerName || 'Cliente';
  const customerEmail = order.user?.email || order.customerEmail || 'cliente@spacepoint.com';

  const orderPayload = {
    reference_id: order.id,
    customer: {
      name: customerName.slice(0, 80),
      email: customerEmail,
    },
    items: (order.items || []).length
      ? (order.items || []).map((item, idx) => ({
        reference_id: String(idx + 1),
        name: (item.product?.name || item.variantName || 'Produto').slice(0, 100),
        quantity: item.quantity || 1,
        unit_amount: item.unitPrice || order.total,
      }))
      : [{
        reference_id: '1',
        name: 'Pedido',
        quantity: 1,
        unit_amount: order.total,
      }],
    qr_codes: [{
      amount: { value: order.total },
      expiration_date: new Date(Date.now() + PIX_EXPIRATION_SECONDS * 1000).toISOString(),
    }],
  };
  const pagbankWebhook = webhookUrl('/v1/webhooks/pagbank');
  if (pagbankWebhook) orderPayload.notification_urls = [pagbankWebhook];

  const { data } = await axios.post(
    `${baseUrl}/orders`,
    orderPayload,
    {
      headers: pagBankAuthHeaders(token, { 'Content-Type': 'application/json' }),
      timeout: 20000,
    }
  );

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

async function createStripePix(order, gateway) {
  const config = getConfig(gateway);
  const secretKey = config.secretKey || config.secret_key;

  const customerName = order.user?.name || order.customerName || 'Cliente';
  const customerEmail = order.user?.email || order.customerEmail || 'cliente@spacepoint.com';

  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const returnUrl = `${frontendUrl}/orders/${order.id}`;

  const params = new URLSearchParams();
  params.append('amount', String(order.total));
  params.append('currency', 'brl');
  params.append('confirm', 'true');
  params.append('payment_method_types[]', 'pix');
  params.append('payment_method_data[type]', 'pix');
  params.append('payment_method_data[billing_details][name]', customerName);
  params.append('payment_method_data[billing_details][email]', customerEmail);
  params.append('return_url', returnUrl);
  params.append('metadata[order_id]', order.id);
  params.append('description', `Pedido ${order.id}`);


  try {
    const { data } = await axios.post('https://api.stripe.com/v1/payment_intents', params, {
      auth: { username: secretKey, password: '' },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 20000,
    });

    const pix = data.next_action?.pix_display_qr_code;
    if (!pix?.data) {
      throw new Error('Stripe não retornou QR Code PIX (verifique se PIX está habilitado na conta Stripe Brasil)');
    }

    const metadata = {
      type: 'PIX',
      provider: 'stripe',
      copyPaste: pix.data,
      qrCode: pix.image_url_png || null,
      expiresAt: pix.expires_at
        ? new Date(pix.expires_at * 1000).toISOString()
        : new Date(Date.now() + PIX_EXPIRATION_SECONDS * 1000).toISOString(),
      paymentIntentId: data.id,
    };

    return savePixPayment(order, 'stripe', data.id, metadata);
  } catch (err) {
    const stripeError = err.response?.data?.error?.message || err.message;
    console.error('[Stripe Pix Error]', err.response?.data || err.message);
    throw new Error(`Stripe: ${stripeError}`);
  }
}

async function createStripeCard(order, gateway) {
  const config = getConfig(gateway);
  const secretKey = config.secretKey || config.secret_key;
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const successUrl = `${frontendUrl}/checkout/payment/${order.id}?card=success`;
  const cancelUrl = `${frontendUrl}/checkout/payment/${order.id}?card=cancel`;
  const customerEmail = order.user?.email || order.customerEmail || undefined;

  const params = new URLSearchParams();
  params.append('mode', 'payment');
  params.append('success_url', successUrl);
  params.append('cancel_url', cancelUrl);
  params.append('payment_method_types[]', 'card');
  params.append('metadata[order_id]', order.id);
  params.append('expires_at', String(Math.floor((Date.now() + PIX_EXPIRATION_SECONDS * 1000) / 1000)));
  if (customerEmail) params.append('customer_email', customerEmail);

  (order.items || []).forEach((item, idx) => {
    const prefix = `line_items[${idx}]`;
    params.append(`${prefix}[quantity]`, String(item.quantity || 1));
    params.append(`${prefix}[price_data][currency]`, 'brl');
    params.append(`${prefix}[price_data][unit_amount]`, String(item.unitPrice || order.total));
    params.append(
      `${prefix}[price_data][product_data][name]`,
      String(item.product?.name || item.variantName || 'Produto').slice(0, 120)
    );
  });

  if (!order.items?.length) {
    params.append('line_items[0][quantity]', '1');
    params.append('line_items[0][price_data][currency]', 'brl');
    params.append('line_items[0][price_data][unit_amount]', String(order.total));
    params.append('line_items[0][price_data][product_data][name]', `Pedido ${order.id}`);
  }

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
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

  const items = (order.items || []).length
    ? (order.items || []).map((item) => ({
      title: String(item.product?.name || item.variantName || 'Produto').slice(0, 120),
      quantity: item.quantity || 1,
      unit_price: parseFloat(formatBrlFromCents(item.unitPrice || order.total)),
      currency_id: 'BRL',
    }))
    : [{
      title: `Pedido ${order.id}`,
      quantity: 1,
      unit_price: parseFloat(formatBrlFromCents(order.total)),
      currency_id: 'BRL',
    }];

  const payload = {
    items,
    external_reference: order.id,
    back_urls: {
      success: `${frontendUrl}/checkout/payment/${order.id}?card=success`,
      failure: `${frontendUrl}/checkout/payment/${order.id}?card=cancel`,
      pending: `${frontendUrl}/checkout/payment/${order.id}?card=pending`,
    },
    auto_return: 'approved',
  };

  const mpWebhook = webhookUrl('/v1/webhooks/mercado-pago');
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

async function createPagBankCard(order, gateway) {
  const config = getConfig(gateway);
  const creds = getPagBankCredentials(config);
  const token = await getPagBankToken(config);
  const baseUrl = creds.baseUrl;

  const customerName = order.user?.name || order.customerName || 'Cliente';
  const customerEmail = order.user?.email || order.customerEmail || 'cliente@spacepoint.com';

  const payload = {
    reference_id: order.id,
    customer: {
      name: customerName.slice(0, 80),
      email: customerEmail,
    },
    items: (order.items || []).length
      ? (order.items || []).map((item, idx) => ({
        reference_id: String(idx + 1),
        name: (item.product?.name || item.variantName || 'Produto').slice(0, 100),
        quantity: item.quantity || 1,
        unit_amount: item.unitPrice || order.total,
      }))
      : [{
        reference_id: '1',
        name: 'Pedido',
        quantity: 1,
        unit_amount: order.total,
      }],
    payment_methods: [
      { type: 'CREDIT_CARD' },
      { type: 'DEBIT_CARD' },
    ],
  };

  const pagbankWebhook = webhookUrl('/v1/webhooks/pagbank');
  if (pagbankWebhook) payload.notification_urls = [pagbankWebhook];

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

    const metadata = {
      type: 'CARD',
      provider: 'pagbank',
      checkoutUrl,
      checkoutId: data.id,
      expiresAt: new Date(Date.now() + PIX_EXPIRATION_SECONDS * 1000).toISOString(),
    };

    return saveCardPayment(order, 'pagbank', data.id, metadata);
  } catch (err) {
    const msg = err?.response?.data?.error_messages?.[0]?.description
      || err?.response?.data?.message
      || err.message;
    throw new Error(`PagBank: ${msg}`);
  }
}

async function createEfiCard(order, gateway) {
  const config = getConfig(gateway);
  const efi = createEfiInstance({
    clientId: config.clientId || config.client_id,
    clientSecret: config.clientSecret || config.client_secret,
    sandbox: config.sandbox !== false,
    certificatePath: resolveEfiCertificate(config),
  });

  const body = {
    items: [{
      name: `Pedido ${order.id}`.slice(0, 100),
      value: order.total,
      amount: 1,
    }],
    metadata: {
      custom_id: order.id,
    },
    settings: {
      payment_method: 'all',
      expire_at: new Date(Date.now() + PIX_EXPIRATION_SECONDS * 1000).toISOString().slice(0, 19),
      message: `Pedido ${order.id}`,
    },
  };

  try {
    const charge = await efi.createOneStepLink([], body);
    const checkoutUrl = charge.payment_url || charge.link || charge.data?.payment_url;
    const chargeId = String(charge.charge_id || charge.id || `efi-link-${order.id}-${Date.now()}`);

    if (!checkoutUrl) throw new Error('Efí não retornou link de pagamento');

    const metadata = {
      type: 'CARD',
      provider: 'efi-bank',
      checkoutUrl,
      chargeId,
      expiresAt: new Date(Date.now() + PIX_EXPIRATION_SECONDS * 1000).toISOString(),
    };

    return saveCardPayment(order, 'efi-bank', chargeId, metadata);
  } catch (err) {
    const msg = err?.error_description || err?.message || 'Falha ao criar link Efí';
    throw new Error(`Efí Bank: ${msg}`);
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
  await prisma.$transaction(async (tx) => {
    await fulfillPaidOrder(tx, payment.orderId, {
      provider: payment.provider,
      externalId: payment.externalId,
      description,
      skipPaymentCreate: true,
    });
    await tx.payment.update({
      where: { id: payment.id },
      data: { status: 'PAID', amount: paidCents },
    });
  });
  return true;
}

async function verifyEfiPayment(payment, gateway) {
  const config = getConfig(gateway);
  const meta = payment.metadata || {};

  if (meta.type === 'CARD') {
    const efi = createEfiInstance({
      clientId: config.clientId || config.client_id,
      clientSecret: config.clientSecret || config.client_secret,
      sandbox: config.sandbox !== false,
      certificatePath: resolveEfiCertificate(config),
    });

    try {
      const detail = await efi.detailCharge({ id: payment.externalId });
      const status = detail?.data?.status || detail?.status;
      const isPaid = ['paid', 'settled', 'approved'].includes(String(status || '').toLowerCase());
      if (!isPaid) return false;
      const paidCents = detail?.data?.total
        ? Math.round(parseFloat(detail.data.total) * 100)
        : payment.amount;
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
    sandbox: config.sandbox !== false,
    certificatePath: resolveEfiCertificate(config),
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
      const paidCents = session.amount_total || payment.amount;
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

  await markPaymentPaid(payment, data.amount_received, 'Pagamento PIX Stripe confirmado');
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
  if (!payment || payment.status !== 'PENDING') return false;
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
        status: 'PENDING',
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
