const { prisma } = require('../config/prisma');
const { resolveCustomerFromOrder } = require('../utils/checkoutConfig');
const { getEnabledPluginConfig } = require('./pluginConfig.service');

const FRONTEND_URL = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');

function formatBRL(cents) {
  return (Number(cents || 0) / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

function isDiscordWebhookUrl(url) {
  return /^https:\/\/(?:discord|discordapp)\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+$/i.test(
    String(url || '').trim()
  );
}

async function getPaidPaymentMeta(orderId) {
  const paidPayment = await prisma.payment.findFirst({
    where: { orderId, status: 'PAID' },
    orderBy: { createdAt: 'desc' },
  });

  if (!paidPayment) return null;

  const metadata =
    paidPayment.metadata && typeof paidPayment.metadata === 'object'
      ? { ...paidPayment.metadata }
      : {};

  return { payment: paidPayment, metadata };
}

async function setPaymentFlag(paymentId, flagKey) {
  const current = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: { metadata: true },
  });
  const metadata =
    current?.metadata && typeof current.metadata === 'object' ? { ...current.metadata } : {};

  await prisma.payment.update({
    where: { id: paymentId },
    data: {
      metadata: {
        ...metadata,
        [flagKey]: true,
        [`${flagKey}At`]: new Date().toISOString(),
      },
    },
  });
}

async function notifyDiscordOrderPaid(orderId) {
  try {
    const config = await getEnabledPluginConfig('discord-orders');
    const webhookUrl = config?.webhookUrl?.trim();
    if (!webhookUrl || !isDiscordWebhookUrl(webhookUrl)) return;

    const paid = await getPaidPaymentMeta(orderId);
    if (!paid || paid.metadata.discordOrderPaidSent) return;

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        user: { select: { name: true, email: true } },
        items: {
          include: {
            product: { select: { name: true } },
            variant: { select: { name: true } },
          },
        },
      },
    });

    if (!order || !['PAID', 'DELIVERED'].includes(order.status)) return;

    const customer = resolveCustomerFromOrder(order);
    const itemLines = order.items
      .slice(0, 8)
      .map((item) => {
        const name = item.variant?.name
          ? `${item.product.name} — ${item.variant.name}`
          : item.variantName
            ? `${item.product.name} — ${item.variantName}`
            : item.product.name;
        return `• ${item.quantity}x ${name}`;
      })
      .join('\n');

    const more =
      order.items.length > 8 ? `\n… +${order.items.length - 8} item(ns)` : '';

    const site = await prisma.siteConfig.findUnique({
      where: { id: 'default' },
      select: { storeName: true },
    });
    const storeName = site?.storeName?.trim() || 'Space Point';

    const embed = {
      title: 'Pedido pago',
      color: 0xa855f7,
      description: `Novo pagamento confirmado em **${storeName}**`,
      fields: [
        { name: 'Pedido', value: `\`${order.id}\``, inline: true },
        {
          name: 'Total',
          value: formatBRL(order.total),
          inline: true,
        },
        {
          name: 'Método',
          value: String(order.paymentMethod || 'PIX').toUpperCase(),
          inline: true,
        },
        {
          name: 'Cliente',
          value: customer.customerName || customer.customerEmail || '—',
          inline: true,
        },
        {
          name: 'E-mail',
          value: customer.customerEmail || '—',
          inline: true,
        },
        {
          name: 'Itens',
          value: (itemLines || '—') + more,
        },
      ],
      url: `${FRONTEND_URL}/dashboard/admin/orders?search=${encodeURIComponent(order.id)}`,
      timestamp: new Date(order.paidAt || Date.now()).toISOString(),
    };

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: storeName.slice(0, 80),
        embeds: [embed],
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error('[discordOrders]', res.status, text.slice(0, 200));
      return;
    }

    await setPaymentFlag(paid.payment.id, 'discordOrderPaidSent');
  } catch (err) {
    console.error('[discordOrders]', err.message);
  }
}

function queueDiscordOrderPaid(orderId) {
  setImmediate(() => {
    void notifyDiscordOrderPaid(orderId);
  });
}

module.exports = {
  notifyDiscordOrderPaid,
  queueDiscordOrderPaid,
  isDiscordWebhookUrl,
};
