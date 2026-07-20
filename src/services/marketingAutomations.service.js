const crypto = require('crypto');
const { prisma } = require('../config/prisma');
const {
  getAbandonedCartSettings,
  getInactivityCutoff,
  DEFAULT_WHATSAPP_CART,
  DEFAULT_WHATSAPP_ORDER,
  normalizeAbandonedCartSettings,
  saveAbandonedCartSettings,
  CART_EMAIL_DELAY_OPTIONS,
  PRODUCT_EMAIL_DELAY_OPTIONS,
  CANCELLED_ORDER_DELAY_OPTIONS,
  DEFAULT_ABANDONED_CART_SETTINGS,
} = require('../utils/abandonedCartSettings');
const { countSentEmails } = require('../utils/recoverySequence');

const FRONTEND_URL = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');

const AUTOMATION_HIDDEN_NOTE = '[AUTOMACAO] Oculto da listagem de recuperação';
const PAYMENT_RECOVERY_CANCEL_NOTES = ['Expirado por falta de pagamento', 'Pagamento recusado', 'pagamento recusado'];

function ensureToken() {
  return crypto.randomBytes(24).toString('hex');
}

function parseRange(query = {}) {
  const from = query.from ? new Date(query.from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const to = query.to ? new Date(query.to) : new Date();
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    const err = new Error('Período inválido');
    err.status = 400;
    throw err;
  }
  return { from, to };
}

function formatRecoveryUrl(token, source) {
  const base = `${FRONTEND_URL}/checkout?recover=${encodeURIComponent(token)}`;
  if (!source) return base;
  return `${base}&src=${encodeURIComponent(source)}`;
}

function formatOrderPayUrl(orderId) {
  return `${FRONTEND_URL}/checkout/payment/${orderId}`;
}

function applyTemplate(template, vars) {
  const aliases = {
    ...vars,
    carrinho: vars.carrinho ?? vars.link ?? '',
    link: vars.link ?? vars.carrinho ?? '',
  };
  return String(template || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => String(aliases[key] ?? ''));
}

function buildWhatsAppUrl(phone, message) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length < 10) return null;
  const withCountry = digits.startsWith('55') ? digits : `55${digits}`;
  return `https://wa.me/${withCountry}?text=${encodeURIComponent(message)}`;
}

async function ensureCartToken(cartId) {
  const cart = await prisma.abandonedCart.findUnique({
    where: { id: cartId },
    select: { id: true, recoveryToken: true },
  });
  if (!cart) return null;
  if (cart.recoveryToken) return cart.recoveryToken;
  const token = ensureToken();
  await prisma.abandonedCart.update({
    where: { id: cart.id },
    data: { recoveryToken: token },
  });
  return token;
}

async function ensureProductInterestToken(interestId) {
  const interest = await prisma.abandonedProductInterest.findUnique({
    where: { id: interestId },
    select: { id: true, recoveryToken: true },
  });
  if (!interest) return null;
  if (interest.recoveryToken) return interest.recoveryToken;
  const token = ensureToken();
  await prisma.abandonedProductInterest.update({
    where: { id: interest.id },
    data: { recoveryToken: token },
  });
  return token;
}

async function ensureCancelledOrderToken(orderId) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, cancelledRecoveryToken: true },
  });
  if (!order) return null;
  if (order.cancelledRecoveryToken) return order.cancelledRecoveryToken;
  const token = ensureToken();
  await prisma.order.update({
    where: { id: order.id },
    data: { cancelledRecoveryToken: token },
  });
  return token;
}

function formatProductRecoveryUrl(slug, source) {
  const base = `${FRONTEND_URL}/product/${encodeURIComponent(slug)}`;
  if (!source) return base;
  return `${base}?src=${encodeURIComponent(source)}`;
}

/** Link de 1 clique: abre o checkout com os itens do pedido cancelado. */
function formatCancelledOrderRecoveryUrl(token, source) {
  const base = `${FRONTEND_URL}/checkout?reorder=${encodeURIComponent(token)}`;
  if (!source) return base;
  return `${base}&src=${encodeURIComponent(source)}`;
}

/** Fallback para links genéricos da loja. */
function formatStoreRecoveryUrl(source) {
  if (!source) return FRONTEND_URL;
  return `${FRONTEND_URL}/?src=${encodeURIComponent(source)}`;
}

async function getWhatsAppTemplates() {
  const site = await prisma.siteConfig.findUnique({
    where: { id: 'default' },
    select: { storeName: true, abandonedCartSettings: true },
  });
  const settings = normalizeAbandonedCartSettings(site?.abandonedCartSettings);
  return {
    storeName: site?.storeName?.trim() || 'Space Point',
    cartTemplate: settings.whatsappCartMessage || DEFAULT_WHATSAPP_CART,
    orderTemplate: settings.whatsappOrderMessage || DEFAULT_WHATSAPP_ORDER,
  };
}

async function getAutomationSettings() {
  const settings = await getAbandonedCartSettings(prisma);
  return {
    settings,
    defaults: {
      whatsappCartMessage: DEFAULT_WHATSAPP_CART,
      whatsappOrderMessage: DEFAULT_WHATSAPP_ORDER,
      cartEmailDelays: DEFAULT_ABANDONED_CART_SETTINGS.cartEmailDelays,
      abandonedProductDelays: DEFAULT_ABANDONED_CART_SETTINGS.abandonedProductDelays,
      cancelledOrderDelays: DEFAULT_ABANDONED_CART_SETTINGS.cancelledOrderDelays,
      notificationWindowStart: DEFAULT_ABANDONED_CART_SETTINGS.notificationWindowStart,
      notificationWindowEnd: DEFAULT_ABANDONED_CART_SETTINGS.notificationWindowEnd,
    },
    options: {
      cartEmailDelays: CART_EMAIL_DELAY_OPTIONS,
      abandonedProductDelays: PRODUCT_EMAIL_DELAY_OPTIONS,
      cancelledOrderDelays: CANCELLED_ORDER_DELAY_OPTIONS,
    },
  };
}

async function updateAutomationSettings(input) {
  await saveAbandonedCartSettings(prisma, input);
  return getAutomationSettings();
}

function mapCartRow(cart, templates) {
  const phone = cart.phone || cart.user?.phone || null;
  const email = cart.email || cart.user?.email || null;
  const name = cart.customerName || cart.user?.name || null;
  const token = cart.recoveryToken;
  const recoveryUrl = token ? formatRecoveryUrl(token, 'link') : null;
  const whatsappLink = token ? formatRecoveryUrl(token, 'whatsapp') : null;
  const message = applyTemplate(templates.cartTemplate, {
    nome: name || 'tudo bem',
    loja: templates.storeName,
    link: whatsappLink || FRONTEND_URL,
    carrinho: whatsappLink || FRONTEND_URL,
  });

  return {
    id: cart.id,
    email,
    phone,
    document: cart.document || cart.user?.document || null,
    customerName: name,
    isVisitor: !name && !email && !phone,
    subtotalCents: cart.subtotalCents,
    couponCode: cart.couponCode,
    lastActivityAt: cart.lastActivityAt,
    recoveryEmailSentAt: cart.recoveryEmailSentAt,
    emailOpenedAt: cart.emailOpenedAt,
    emailClickedAt: cart.emailClickedAt,
    convertedAt: cart.convertedAt,
    recoveredAt: cart.recoveredAt,
    recoveryUrl,
    whatsappUrl: buildWhatsAppUrl(phone, message),
    itemsCount: cart.items?.length || 0,
    items: (cart.items || []).map((item) => ({
      id: item.id,
      productId: item.productId,
      variantId: item.variantId,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      name: item.variant?.name
        ? `${item.product?.name || 'Produto'} — ${item.variant.name}`
        : item.product?.name || 'Produto',
      imageUrl: item.product?.imageUrl || null,
    })),
    userId: cart.userId,
  };
}

async function computeCartsMetrics(rangeFilter) {
  const [sentCartRows, opened, clicked, attributedPaidOrders] = await Promise.all([
    prisma.abandonedCart.findMany({
      where: { recoveryEmailSentAt: rangeFilter, archivedAt: null },
      select: { recoveryEmailsSent: true, recoveryEmailSentAt: true },
    }),
    prisma.abandonedCart.count({
      where: {
        recoveryEmailSentAt: rangeFilter,
        emailOpenedAt: { not: null },
        archivedAt: null,
      },
    }),
    prisma.abandonedCart.count({
      where: {
        recoveryEmailSentAt: rangeFilter,
        emailClickedAt: { not: null },
        archivedAt: null,
      },
    }),
    // Pedidos pagos realmente atribuídos ao e-mail de recuperação
    prisma.order.findMany({
      where: {
        status: { in: ['PAID', 'DELIVERED'] },
        paidAt: rangeFilter,
        recoverySource: 'email',
        recoveredFromCartId: { not: null },
        recoveredFromCart: {
          recoveryEmailSentAt: { not: null },
          emailClickedAt: { not: null },
        },
      },
      select: { id: true, total: true },
    }),
  ]);

  const settings = await getAbandonedCartSettings(prisma);
  const inactivityCutoff = getInactivityCutoff(settings);

  const abandonedCarts = await prisma.abandonedCart.findMany({
    where: {
      lastActivityAt: {
        gte: rangeFilter.gte,
        lte: inactivityCutoff < rangeFilter.lte ? inactivityCutoff : rangeFilter.lte,
      },
      convertedAt: null,
      archivedAt: null,
      items: { some: {} },
    },
    select: { subtotalCents: true },
  });

  const unfinishedPending = await prisma.order.aggregate({
    where: {
      status: 'PENDING',
      createdAt: rangeFilter,
      NOT: { adminNotes: { contains: AUTOMATION_HIDDEN_NOTE } },
    },
    _count: { id: true },
    _sum: { total: true },
  });

  const recoveredCount = attributedPaidOrders.length;
  const recoveredRevenueCents = attributedPaidOrders.reduce((s, o) => s + o.total, 0);
  const emailsSent = sentCartRows.reduce(
    (sum, row) => sum + countSentEmails(row.recoveryEmailsSent, row.recoveryEmailSentAt),
    0
  );
  const openRate = emailsSent ? (opened / emailsSent) * 100 : 0;
  const clickRate = emailsSent ? (clicked / emailsSent) * 100 : 0;
  // Conversão real: cliques no e-mail que viraram compra paga atribuída
  const conversionRate = clicked ? (recoveredCount / clicked) * 100 : 0;
  const averageTicketCents = recoveredCount ? Math.round(recoveredRevenueCents / recoveredCount) : 0;

  return {
    recoveredOrders: recoveredCount,
    recoveredRevenueCents,
    unfinishedOrders: unfinishedPending._count.id + abandonedCarts.length,
    lostRevenueCents:
      (unfinishedPending._sum.total || 0) + abandonedCarts.reduce((s, c) => s + c.subtotalCents, 0),
    emailsSent,
    openRate: Math.round(openRate * 10) / 10,
    clickRate: Math.round(clickRate * 10) / 10,
    conversionRate: Math.round(conversionRate * 10) / 10,
    averageTicketCents,
  };
}

async function computeAbandonedProductsMetrics(rangeFilter) {
  const interests = await prisma.abandonedProductInterest.findMany({
    where: {
      archivedAt: null,
      lastViewedAt: rangeFilter,
    },
    include: {
      product: { select: { price: true } },
      variant: { select: { price: true } },
    },
  });

  const unfinished = interests.filter((i) => !i.convertedAt).length;
  const lostRevenueCents = interests
    .filter((i) => !i.convertedAt)
    .reduce((sum, i) => {
      const price = i.variant?.price ?? i.product?.price;
      const cents = Math.round(Number(price || 0) * 100);
      return sum + (Number.isFinite(cents) ? cents : 0);
    }, 0);

  const emailsSent = interests.reduce(
    (sum, i) => sum + countSentEmails(i.recoveryEmailsSent, i.recoveryEmailSentAt),
    0
  );
  const opened = interests.filter((i) => i.emailOpenedAt).length;
  const clicked = interests.filter((i) => i.emailClickedAt).length;
  const converted = interests.filter((i) => i.convertedAt && i.recoveryEmailSentAt).length;

  const recovered = await prisma.abandonedProductInterest.findMany({
    where: {
      convertedAt: rangeFilter,
      recoveryEmailSentAt: { not: null },
    },
    include: {
      product: { select: { price: true } },
      variant: { select: { price: true } },
    },
  });
  const recoveredRevenueCents = recovered.reduce((sum, i) => {
    const price = i.variant?.price ?? i.product?.price;
    const cents = Math.round(Number(price || 0) * 100);
    return sum + (Number.isFinite(cents) ? cents : 0);
  }, 0);

  const openRate = emailsSent ? (opened / emailsSent) * 100 : 0;
  const clickRate = emailsSent ? (clicked / emailsSent) * 100 : 0;
  const conversionRate = emailsSent ? (converted / emailsSent) * 100 : 0;
  const averageTicketCents =
    recovered.length > 0 ? Math.round(recoveredRevenueCents / recovered.length) : 0;

  return {
    recoveredOrders: recovered.length,
    recoveredRevenueCents,
    unfinishedOrders: unfinished,
    lostRevenueCents,
    emailsSent,
    openRate: Math.round(openRate * 10) / 10,
    clickRate: Math.round(clickRate * 10) / 10,
    conversionRate: Math.round(conversionRate * 10) / 10,
    averageTicketCents,
  };
}

async function computeCancelledOrdersMetrics(rangeFilter) {
  const cancelled = await prisma.order.findMany({
    where: {
      status: 'CANCELLED',
      updatedAt: rangeFilter,
      NOT: { adminNotes: { contains: AUTOMATION_HIDDEN_NOTE } },
    },
    select: {
      id: true,
      total: true,
      cancelledRecoveryEmailSentAt: true,
      cancelledRecoveryEmailsSent: true,
      cancelledRecoveryEmailOpenedAt: true,
      cancelledRecoveryEmailClickedAt: true,
      cancelledRecoveryConvertedAt: true,
    },
  });

  const unfinished = cancelled.filter((o) => !o.cancelledRecoveryConvertedAt);
  const emailsSent = cancelled.reduce(
    (sum, o) =>
      sum + countSentEmails(o.cancelledRecoveryEmailsSent, o.cancelledRecoveryEmailSentAt),
    0
  );
  const opened = cancelled.filter((o) => o.cancelledRecoveryEmailOpenedAt).length;
  const clicked = cancelled.filter((o) => o.cancelledRecoveryEmailClickedAt).length;

  const recovered = await prisma.order.findMany({
    where: {
      cancelledRecoveryConvertedAt: rangeFilter,
      cancelledRecoveryEmailSentAt: { not: null },
    },
    select: { id: true, total: true },
  });
  const recoveredRevenueCents = recovered.reduce((s, o) => s + (o.total || 0), 0);
  const converted = recovered.length;

  const openRate = emailsSent ? (opened / emailsSent) * 100 : 0;
  const clickRate = emailsSent ? (clicked / emailsSent) * 100 : 0;
  const conversionRate = emailsSent ? (converted / emailsSent) * 100 : 0;
  const averageTicketCents =
    recovered.length > 0 ? Math.round(recoveredRevenueCents / recovered.length) : 0;

  return {
    recoveredOrders: recovered.length,
    recoveredRevenueCents,
    unfinishedOrders: unfinished.length,
    lostRevenueCents: unfinished.reduce((s, o) => s + (o.total || 0), 0),
    emailsSent,
    openRate: Math.round(openRate * 10) / 10,
    clickRate: Math.round(clickRate * 10) / 10,
    conversionRate: Math.round(conversionRate * 10) / 10,
    averageTicketCents,
  };
}

function emptyMetrics() {
  return {
    recoveredOrders: 0,
    recoveredRevenueCents: 0,
    unfinishedOrders: 0,
    lostRevenueCents: 0,
    emailsSent: 0,
    openRate: 0,
    clickRate: 0,
    conversionRate: 0,
    averageTicketCents: 0,
  };
}

function parseMetricTypes(query = {}) {
  const ALL = ['carts', 'abandoned_products', 'cancelled_orders'];
  let raw = [];
  if (query.metricTypes != null && String(query.metricTypes).trim() !== '') {
    raw = String(query.metricTypes)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  } else if (query.metricType) {
    raw = [String(query.metricType)];
  } else {
    raw = [...ALL];
  }
  const allowed = new Set(ALL);
  return [...new Set(raw.filter((t) => allowed.has(t)))];
}

async function getAutomationMetrics(query = {}) {
  const { from, to } = parseRange(query);
  const metricTypes = parseMetricTypes(query);
  const rangeFilter = { gte: from, lte: to };

  if (!metricTypes.length) {
    return {
      metricTypes: [],
      metricType: null,
      from: from.toISOString(),
      to: to.toISOString(),
      ...emptyMetrics(),
    };
  }

  const parts = await Promise.all(
    metricTypes.map(async (type) => {
      if (type === 'abandoned_products') return computeAbandonedProductsMetrics(rangeFilter);
      if (type === 'cancelled_orders') return computeCancelledOrdersMetrics(rangeFilter);
      return computeCartsMetrics(rangeFilter);
    })
  );

  const merged = emptyMetrics();
  let recoveredWeight = 0;
  let recoveredRevenueSum = 0;

  for (const part of parts) {
    merged.unfinishedOrders += part.unfinishedOrders;
    merged.lostRevenueCents += part.lostRevenueCents;
    merged.emailsSent += part.emailsSent;
    merged.recoveredOrders += part.recoveredOrders;
    merged.recoveredRevenueCents += part.recoveredRevenueCents;
    if (part.recoveredOrders > 0) {
      recoveredWeight += part.recoveredOrders;
      recoveredRevenueSum += part.recoveredRevenueCents;
    }
  }

  // Taxas de e-mail só fazem sentido com a fonte de carrinhos (disparos)
  const cartsPart = metricTypes.includes('carts')
    ? parts[metricTypes.indexOf('carts')]
    : null;
  if (cartsPart) {
    merged.openRate = cartsPart.openRate;
    merged.clickRate = cartsPart.clickRate;
    merged.conversionRate = cartsPart.conversionRate;
    merged.emailsSent = cartsPart.emailsSent;
    merged.recoveredOrders = cartsPart.recoveredOrders;
    merged.recoveredRevenueCents = cartsPart.recoveredRevenueCents;
    merged.averageTicketCents = cartsPart.averageTicketCents;
  } else {
    merged.openRate = 0;
    merged.clickRate = 0;
    merged.conversionRate = 0;
    merged.emailsSent = 0;
    merged.averageTicketCents = recoveredWeight
      ? Math.round(recoveredRevenueSum / recoveredWeight)
      : 0;
  }

  // unfinished/lost: se carts + abandoned_products, o lost de produtos/carrinhos se sobrepõe.
  // Mantém soma das fontes selecionadas (cada filtro contribui com seu recorte).
  return {
    metricTypes,
    metricType: metricTypes.length === 1 ? metricTypes[0] : 'combined',
    from: from.toISOString(),
    to: to.toISOString(),
    ...merged,
  };
}

async function listAbandonedCarts(query = {}) {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(query.pageSize) || 20));
  const skip = (page - 1) * pageSize;
  const search = String(query.search || '').trim();
  const { from, to } = parseRange(query);
  const settings = await getAbandonedCartSettings(prisma);
  const inactivityCutoff = getInactivityCutoff(settings);
  const activityTo = inactivityCutoff < to ? inactivityCutoff : to;

  const where = {
    archivedAt: null,
    convertedAt: null,
    lastActivityAt: { gte: from, lte: activityTo },
    items: { some: {} },
  };

  if (search) {
    const digits = search.replace(/\D/g, '');
    where.OR = [
      { email: { contains: search, mode: 'insensitive' } },
      { customerName: { contains: search, mode: 'insensitive' } },
      { user: { name: { contains: search, mode: 'insensitive' } } },
      { user: { email: { contains: search, mode: 'insensitive' } } },
    ];
    if (digits.length >= 4) {
      where.OR.push({ phone: { contains: digits } });
      where.OR.push({ document: { contains: digits } });
    }
  }

  const [rows, total, templates] = await Promise.all([
    prisma.abandonedCart.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, email: true, phone: true, document: true } },
        items: {
          include: {
            product: { select: { id: true, name: true, imageUrl: true } },
            variant: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { lastActivityAt: 'desc' },
      skip,
      take: pageSize,
    }),
    prisma.abandonedCart.count({ where }),
    getWhatsAppTemplates(),
  ]);

  for (const cart of rows) {
    if (!cart.recoveryToken) {
      cart.recoveryToken = await ensureCartToken(cart.id);
    }
  }

  return {
    carts: rows.map((c) => mapCartRow(c, templates)),
    total,
    page,
    totalPages: Math.ceil(total / pageSize),
    inactivityMinutes: settings.inactivityMinutes,
  };
}

async function getAbandonedCart(id) {
  const cart = await prisma.abandonedCart.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, name: true, email: true, phone: true, document: true } },
      items: {
        include: {
          product: { select: { id: true, name: true, imageUrl: true, slug: true } },
          variant: { select: { id: true, name: true } },
        },
      },
    },
  });
  if (!cart || cart.archivedAt) {
    const err = new Error('Carrinho não encontrado');
    err.status = 404;
    throw err;
  }
  if (!cart.recoveryToken) {
    cart.recoveryToken = await ensureCartToken(cart.id);
  }
  const templates = await getWhatsAppTemplates();
  return mapCartRow(cart, templates);
}

async function archiveAbandonedCart(id) {
  await prisma.abandonedCart.update({
    where: { id },
    data: { archivedAt: new Date() },
  });
  return { success: true };
}

function mapUnpaidOrderRow(order, templates) {
  const checkout = order.checkoutData && typeof order.checkoutData === 'object' ? order.checkoutData : {};
  const name = checkout.name || order.user?.name || 'Cliente';
  const email = checkout.email || order.user?.email || null;
  const phone = String(checkout.phone || order.user?.phone || '').replace(/\D/g, '') || null;
  const document = String(checkout.cpf || order.user?.document || '').replace(/\D/g, '') || null;
  const payUrl = formatOrderPayUrl(order.id);
  const message = applyTemplate(templates.orderTemplate, {
    nome: name,
    loja: templates.storeName,
    pedido: `#${order.id.slice(-6).toUpperCase()}`,
    link: payUrl,
    carrinho: payUrl,
  });

  return {
    id: order.id,
    customerName: name,
    email,
    phone,
    document,
    total: order.total,
    paymentMethod: order.paymentMethod,
    paymentExpiresAt: order.paymentExpiresAt,
    status: order.status,
    createdAt: order.createdAt,
    recoveryUrl: payUrl,
    whatsappUrl: buildWhatsAppUrl(phone, message),
    items: order.items.map((item) => ({
      id: item.id,
      name: item.variantName
        ? `${item.product?.name || 'Produto'} — ${item.variantName}`
        : item.product?.name || 'Produto',
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      imageUrl: item.product?.imageUrl || null,
    })),
  };
}

function isPaymentRecoveryOrder(order) {
  if (!order) return false;
  if (order.status === 'PENDING') return true;
  if (order.status !== 'CANCELLED') return false;
  const notes = String(order.adminNotes || '');
  return PAYMENT_RECOVERY_CANCEL_NOTES.some((hint) =>
    notes.toLowerCase().includes(hint.toLowerCase())
  );
}

function buildUnpaidOrdersWhere(query = {}) {
  const { from, to } = parseRange(query);
  const search = String(query.search || '').trim();

  const where = {
    createdAt: { gte: from, lte: to },
    NOT: {
      adminNotes: { contains: AUTOMATION_HIDDEN_NOTE },
    },
    OR: [
      { status: 'PENDING' },
      {
        status: 'CANCELLED',
        OR: PAYMENT_RECOVERY_CANCEL_NOTES.map((hint) => ({
          adminNotes: { contains: hint, mode: 'insensitive' },
        })),
      },
    ],
  };

  if (search) {
    const digits = search.replace(/\D/g, '');
    where.AND = [
      {
        OR: [
          { id: { contains: search, mode: 'insensitive' } },
          { user: { name: { contains: search, mode: 'insensitive' } } },
          { user: { email: { contains: search, mode: 'insensitive' } } },
          ...(digits.length >= 4
            ? [
                { user: { phone: { contains: digits } } },
                { user: { document: { contains: digits } } },
              ]
            : []),
        ],
      },
    ];
  }

  return where;
}

async function listUnpaidOrders(query = {}) {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(query.pageSize) || 20));
  const skip = (page - 1) * pageSize;
  const where = buildUnpaidOrdersWhere(query);

  const [rows, total, templates] = await Promise.all([
    prisma.order.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, email: true, phone: true, document: true } },
        items: {
          include: {
            product: { select: { id: true, name: true, imageUrl: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
    }),
    prisma.order.count({ where }),
    getWhatsAppTemplates(),
  ]);

  return {
    orders: rows.map((order) => mapUnpaidOrderRow(order, templates)),
    total,
    page,
    totalPages: Math.ceil(total / pageSize),
  };
}

async function getUnpaidOrder(id) {
  const order = await prisma.order.findFirst({
    where: {
      id,
      NOT: {
        adminNotes: { contains: AUTOMATION_HIDDEN_NOTE },
      },
    },
    include: {
      user: { select: { id: true, name: true, email: true, phone: true, document: true } },
      items: {
        include: {
          product: { select: { id: true, name: true, imageUrl: true } },
        },
      },
    },
  });
  if (!order || !isPaymentRecoveryOrder(order)) {
    const err = new Error('Pedido não encontrado');
    err.status = 404;
    throw err;
  }
  const templates = await getWhatsAppTemplates();
  return mapUnpaidOrderRow(order, templates);
}

async function archiveUnpaidOrder(id) {
  const order = await prisma.order.findUnique({ where: { id } });
  if (!order || !isPaymentRecoveryOrder(order)) {
    const err = new Error('Pedido de recuperação não encontrado');
    err.status = 404;
    throw err;
  }
  const note = AUTOMATION_HIDDEN_NOTE;
  await prisma.order.update({
    where: { id },
    data: {
      adminNotes: order.adminNotes?.includes(note)
        ? order.adminNotes
        : [order.adminNotes, note].filter(Boolean).join('\n'),
    },
  });
  return { success: true };
}

async function createOrderFromAbandonedCart(cartId) {
  const { resolveSellable } = require('../utils/productStore');
  const { ORDER_PAYMENT_TTL_MS, reserveStockForOrderItem } = require('./orderFulfillment.service');
  const orderEmailService = require('./orderEmail.service');

  const cart = await prisma.abandonedCart.findUnique({
    where: { id: cartId },
    include: {
      user: true,
      items: true,
    },
  });

  if (!cart || cart.archivedAt || cart.convertedAt) {
    const err = new Error('Carrinho não disponível para criar pedido');
    err.status = 404;
    throw err;
  }
  if (!cart.items.length) {
    const err = new Error('Carrinho sem itens');
    err.status = 400;
    throw err;
  }

  let userId = cart.userId;
  if (!userId && cart.email) {
    const existing = await prisma.user.findUnique({ where: { email: cart.email.toLowerCase() } });
    if (existing) {
      userId = existing.id;
    } else {
      const createdUser = await prisma.user.create({
        data: {
          email: cart.email.toLowerCase(),
          name: cart.customerName || null,
          phone: cart.phone || null,
          document: cart.document || null,
          provider: 'import',
        },
      });
      userId = createdUser.id;
    }
  }

  if (!userId) {
    const err = new Error('É necessário e-mail ou cliente cadastrado para criar o pedido');
    err.status = 400;
    throw err;
  }

  const order = await prisma.$transaction(async (tx) => {
    const sellables = [];
    const orderItemsData = [];

    for (const item of cart.items) {
      const normalized = {
        productId: item.productId,
        variantId: item.variantId || null,
        quantity: item.quantity,
      };
      const sellable = await resolveSellable(
        tx,
        normalized.productId,
        normalized.variantId,
        normalized.quantity,
        userId
      );
      sellables.push({ item: normalized, sellable });
      orderItemsData.push({
        productId: sellable.product.id,
        variantId: sellable.variant?.id ?? null,
        variantName: sellable.variantName,
        quantity: normalized.quantity,
        unitPrice: sellable.unitPriceCents,
      });
    }

    const subtotal = orderItemsData.reduce((sum, row) => sum + row.unitPrice * row.quantity, 0);
    const paymentExpiresAt = new Date(Date.now() + ORDER_PAYMENT_TTL_MS);

    const created = await tx.order.create({
      data: {
        userId,
        subtotal,
        discount: 0,
        deliveryFee: 0,
        deliveryOption: 'standard',
        total: subtotal,
        paymentExpiresAt,
        paymentMethod: 'PIX',
        couponCode: cart.couponCode || null,
        checkoutData: {
          name: cart.customerName || cart.user?.name || '',
          email: cart.email || cart.user?.email || '',
          phone: cart.phone || cart.user?.phone || '',
          cpf: cart.document || cart.user?.document || '',
        },
        adminNotes: `[AUTOMACAO] Pedido criado manualmente a partir do carrinho ${cart.id}`,
        recoveredFromCartId: cart.id,
        recoverySource: 'manual',
        items: { create: orderItemsData },
      },
      include: { items: true },
    });

    for (const { item, sellable } of sellables) {
      const orderItem = created.items.find(
        (oi) =>
          oi.productId === item.productId &&
          (oi.variantId ?? null) === (item.variantId ?? null)
      );
      if (!orderItem) throw new Error('Falha ao reservar estoque');
      await reserveStockForOrderItem(tx, item, orderItem.id, sellable);
    }

    await tx.abandonedCart.update({
      where: { id: cart.id },
      data: {
        convertedAt: new Date(),
        recoveredAt: new Date(),
        convertedOrderId: created.id,
      },
    });

    return created;
  });

  orderEmailService.notifyOrderCreated(order.id);

  const templates = await getWhatsAppTemplates();
  const detailed = await prisma.order.findUnique({
    where: { id: order.id },
    include: {
      user: { select: { id: true, name: true, email: true, phone: true, document: true } },
      items: {
        include: { product: { select: { id: true, name: true, imageUrl: true } } },
      },
    },
  });

  return mapUnpaidOrderRow(detailed, templates);
}

async function getCartByRecoveryToken(token) {
  if (!token) return null;
  const cart = await prisma.abandonedCart.findFirst({
    where: {
      recoveryToken: String(token),
      convertedAt: null,
      archivedAt: null,
    },
    include: {
      items: {
        include: {
          product: { select: { id: true, name: true, imageUrl: true, slug: true } },
          variant: { select: { id: true, name: true } },
        },
      },
    },
  });
  return cart;
}

async function trackEmailOpen(token) {
  if (!token) return;
  const tok = String(token);
  const cartResult = await prisma.abandonedCart.updateMany({
    where: {
      recoveryToken: tok,
      emailOpenedAt: null,
    },
    data: { emailOpenedAt: new Date() },
  });
  if (cartResult.count > 0) return;

  const productResult = await prisma.abandonedProductInterest.updateMany({
    where: {
      recoveryToken: tok,
      emailOpenedAt: null,
    },
    data: { emailOpenedAt: new Date() },
  });
  if (productResult.count > 0) return;

  await prisma.order.updateMany({
    where: {
      cancelledRecoveryToken: tok,
      cancelledRecoveryEmailOpenedAt: null,
    },
    data: { cancelledRecoveryEmailOpenedAt: new Date() },
  });
}

async function trackEmailClick(token) {
  if (!token) return null;
  const tok = String(token);

  const cart = await prisma.abandonedCart.findFirst({
    where: { recoveryToken: tok },
  });
  if (cart) {
    await prisma.abandonedCart.update({
      where: { id: cart.id },
      data: {
        emailClickedAt: cart.emailClickedAt || new Date(),
        emailOpenedAt: cart.emailOpenedAt || new Date(),
      },
    });
    return formatRecoveryUrl(tok, 'email');
  }

  const interest = await prisma.abandonedProductInterest.findFirst({
    where: { recoveryToken: tok },
    include: { product: { select: { slug: true } } },
  });
  if (interest?.product?.slug) {
    await prisma.abandonedProductInterest.update({
      where: { id: interest.id },
      data: {
        emailClickedAt: interest.emailClickedAt || new Date(),
        emailOpenedAt: interest.emailOpenedAt || new Date(),
      },
    });
    return formatProductRecoveryUrl(interest.product.slug, 'email');
  }

  const order = await prisma.order.findFirst({
    where: { cancelledRecoveryToken: tok },
    select: {
      id: true,
      cancelledRecoveryEmailClickedAt: true,
      cancelledRecoveryEmailOpenedAt: true,
    },
  });
  if (!order) return null;

  await prisma.order.update({
    where: { id: order.id },
    data: {
      cancelledRecoveryEmailClickedAt: order.cancelledRecoveryEmailClickedAt || new Date(),
      cancelledRecoveryEmailOpenedAt: order.cancelledRecoveryEmailOpenedAt || new Date(),
    },
  });
  return formatCancelledOrderRecoveryUrl(tok, 'email');
}

async function getCancelledOrderByReorderToken(token) {
  if (!token) return null;
  const order = await prisma.order.findFirst({
    where: {
      cancelledRecoveryToken: String(token),
      status: 'CANCELLED',
    },
    include: {
      items: {
        include: {
          product: {
            select: {
              id: true,
              name: true,
              slug: true,
              imageUrl: true,
              price: true,
              isActive: true,
              isVisible: true,
              stockQuantity: true,
            },
          },
          variant: {
            select: {
              id: true,
              name: true,
              imageUrl: true,
              price: true,
              isActive: true,
              isVisible: true,
              stockQuantity: true,
            },
          },
        },
      },
    },
  });
  return order;
}

/**
 * Monta payload de carrinho a partir de um pedido cancelado.
 * Usa preço/estoque atuais; ignora itens indisponíveis.
 */
function buildReorderPayload(order) {
  if (!order) return null;

  const { priceToCents } = require('../utils/productStore');
  const items = [];
  let skipped = 0;

  for (const item of order.items || []) {
    const product = item.product;
    if (!product?.isActive || !product?.isVisible) {
      skipped += 1;
      continue;
    }

    if (item.variantId) {
      const variant = item.variant;
      if (!variant?.isActive || variant.isVisible === false || (variant.stockQuantity ?? 0) <= 0) {
        skipped += 1;
        continue;
      }
      const qty = Math.min(
        Math.max(1, item.quantity || 1),
        Math.max(1, variant.stockQuantity || 1)
      );
      items.push({
        productId: product.id,
        variantId: variant.id,
        quantity: qty,
        name: `${product.name} — ${variant.name}`,
        image: variant.imageUrl || product.imageUrl || null,
        price: priceToCents(variant.price),
        slug: product.slug || null,
      });
      continue;
    }

    if ((product.stockQuantity ?? 0) <= 0) {
      skipped += 1;
      continue;
    }
    const qty = Math.min(
      Math.max(1, item.quantity || 1),
      Math.max(1, product.stockQuantity || 1)
    );
    items.push({
      productId: product.id,
      variantId: null,
      quantity: qty,
      name: product.name,
      image: product.imageUrl || null,
      price: priceToCents(product.price),
      slug: product.slug || null,
    });
  }

  return {
    orderId: order.id,
    couponCode: order.couponCode || null,
    items,
    skipped,
  };
}

async function markCancelledOrderReorderOpened(token) {
  if (!token) return;
  await prisma.order.updateMany({
    where: { cancelledRecoveryToken: String(token) },
    data: {
      cancelledRecoveryEmailClickedAt: new Date(),
      cancelledRecoveryEmailOpenedAt: new Date(),
    },
  });
}

async function markCartRecovered(token) {
  if (!token) return;
  await prisma.abandonedCart.updateMany({
    where: {
      recoveryToken: String(token),
      recoveredAt: null,
    },
    data: { recoveredAt: new Date() },
  });
}

/**
 * Resolve atribuição real de recuperação para um pedido.
 * Só atribui a "email" se o carrinho teve e-mail enviado + clique rastreado.
 */
async function resolveRecoveryAttribution({ recoveryToken, recoverySource, tx = prisma }) {
  const token = String(recoveryToken || '').trim();
  if (!token) return null;

  const cart = await tx.abandonedCart.findFirst({
    where: { recoveryToken: token },
    select: {
      id: true,
      recoveryEmailSentAt: true,
      emailClickedAt: true,
      convertedAt: true,
    },
  });
  if (!cart) return null;

  const requested = String(recoverySource || '').trim().toLowerCase();
  let source = ['email', 'whatsapp', 'manual', 'link'].includes(requested) ? requested : 'link';

  // Fonte e-mail só é válida com clique rastreado no e-mail de recuperação
  if (source === 'email') {
    if (!cart.recoveryEmailSentAt || !cart.emailClickedAt) {
      source = 'link';
    }
  }

  return {
    recoveredFromCartId: cart.id,
    recoverySource: source,
  };
}

async function attachRecoveryToOrder(tx, { orderId, recoveryToken, recoverySource }) {
  const attribution = await resolveRecoveryAttribution({ recoveryToken, recoverySource, tx });
  if (!attribution) return null;

  await tx.order.update({
    where: { id: orderId },
    data: {
      recoveredFromCartId: attribution.recoveredFromCartId,
      recoverySource: attribution.recoverySource,
    },
  });

  await tx.abandonedCart.update({
    where: { id: attribution.recoveredFromCartId },
    data: {
      convertedAt: new Date(),
      recoveredAt: new Date(),
      convertedOrderId: orderId,
    },
  });

  return attribution;
}

module.exports = {
  AUTOMATION_HIDDEN_NOTE,
  PAYMENT_RECOVERY_CANCEL_NOTES,
  getAutomationMetrics,
  listAbandonedCarts,
  getAbandonedCart,
  archiveAbandonedCart,
  listUnpaidOrders,
  getUnpaidOrder,
  archiveUnpaidOrder,
  createOrderFromAbandonedCart,
  ensureCartToken,
  ensureProductInterestToken,
  ensureCancelledOrderToken,
  formatRecoveryUrl,
  formatProductRecoveryUrl,
  formatStoreRecoveryUrl,
  formatCancelledOrderRecoveryUrl,
  getCartByRecoveryToken,
  getCancelledOrderByReorderToken,
  buildReorderPayload,
  markCancelledOrderReorderOpened,
  trackEmailOpen,
  trackEmailClick,
  markCartRecovered,
  resolveRecoveryAttribution,
  attachRecoveryToOrder,
  getWhatsAppTemplates,
  getAutomationSettings,
  updateAutomationSettings,
};
