const { getReviewsSettings } = require('../utils/reviewsSettings');

const DELIVERED_MESSAGE = 'Seu pedido foi entregue com sucesso. Aproveite!';
const RATING_PROMPT = 'Por favor, avalie nosso atendimento (1-5 estrelas):';

async function areAllItemsDelivered(tx, orderId) {
  const items = await tx.orderItem.findMany({
    where: { orderId },
    include: { codes: { where: { status: 'DELIVERED' } } },
  });

  if (!items.length) return false;

  return items.every((item) => item.codes.length >= item.quantity);
}

async function ensureAutomatedMessage(tx, chatId, contentFragment) {
  const existing = await tx.chatMessage.findFirst({
    where: {
      chatId,
      type: 'AUTOMATED',
      content: { contains: contentFragment },
    },
  });

  if (existing) return null;

  return tx.chatMessage.create({
    data: {
      chatId,
      senderId: 'SYSTEM',
      content: contentFragment === 'avalie nosso atendimento' ? RATING_PROMPT : DELIVERED_MESSAGE,
      type: 'AUTOMATED',
    },
  });
}

/**
 * Marca pedido como entregue, fecha chat e convida avaliação quando aplicável.
 * @param {{ force?: boolean }} options - force=true ignora checagem de códigos (admin manual)
 */
async function finalizeOrderDelivery(tx, orderId, options = {}) {
  const { force = false } = options;

  const order = await tx.order.findUnique({
    where: { id: orderId },
    include: { chat: true },
  });

  if (!order) return { changed: false };

  const itemsComplete = await areAllItemsDelivered(tx, orderId);
  const shouldDeliver = force || itemsComplete;

  if (!shouldDeliver && order.status !== 'DELIVERED') {
    return { changed: false };
  }

  const wasDelivered = order.status === 'DELIVERED';
  const now = new Date();

  if (!wasDelivered) {
    await tx.order.update({
      where: { id: orderId },
      data: { status: 'DELIVERED', deliveredAt: now },
    });
  } else if (!order.deliveredAt) {
    await tx.order.update({
      where: { id: orderId },
      data: { deliveredAt: order.updatedAt || now },
    });
  }

  const chat = order.chat;
  if (!chat) {
    return {
      changed: !wasDelivered,
      orderId,
      userId: order.userId,
      chatId: null,
      newlyDelivered: !wasDelivered,
      shouldSendDeliveredEmail: !wasDelivered,
      shouldSendReviewEmail: false,
      shouldEmitChat: false,
    };
  }

  const settings = await getReviewsSettings(tx);
  const chatUpdates = { updatedAt: now };

  if (settings.enabled && settings.autoCloseChatOnDelivery !== false && chat.status !== 'CLOSED') {
    chatUpdates.status = 'CLOSED';
    chatUpdates.isResolved = true;
  }

  if (!wasDelivered) {
    await ensureAutomatedMessage(tx, chat.id, 'entregue com sucesso');
  }

  let shouldSendReviewEmail = false;

  if (settings.enabled && !chat.rating) {
    await ensureAutomatedMessage(tx, chat.id, 'avalie nosso atendimento');

    if (!chat.reviewInviteSentAt && settings.sendReviewInviteEmail !== false) {
      shouldSendReviewEmail = true;
    }
  }

  if (Object.keys(chatUpdates).length > 1) {
    await tx.chat.update({
      where: { id: chat.id },
      data: chatUpdates,
    });
  }

  return {
    changed: !wasDelivered || shouldSendReviewEmail,
    orderId,
    userId: order.userId,
    chatId: chat.id,
    newlyDelivered: !wasDelivered,
    shouldSendDeliveredEmail: !wasDelivered,
    shouldSendReviewEmail,
    shouldEmitChat: true,
  };
}

async function emitDeliverySideEffects(result) {
  if (!result?.chatId) return;

  try {
    const socketService = require('./websocket.service');
    const { prisma } = require('../config/prisma');
    const orderEmailService = require('./orderEmail.service');

    if (result.shouldSendDeliveredEmail) {
      orderEmailService.notifyOrderDelivered(result.orderId);
    } else if (result.shouldSendReviewEmail) {
      orderEmailService.notifyReviewInvite(result.orderId);
    }

    const chat = await prisma.chat.findUnique({
      where: { id: result.chatId },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
        labels: true,
        order: {
          include: {
            user: { select: { id: true, name: true, email: true } },
            items: {
              include: {
                product: { select: { name: true, imageUrl: true, deliveryType: true } },
                variant: { select: { deliveryType: true } },
                codes: { where: { status: 'DELIVERED' } },
              },
            },
          },
        },
      },
    });

    if (chat) {
      socketService.emitToChat(result.chatId, 'chat_updated', chat);
      socketService.emitToUser(result.userId, 'new_message_alert', { chatId: result.chatId });
      socketService.emitToAdmins('chat_list_update', { chatId: result.chatId });
    }
  } catch (err) {
    console.error('[orderDelivery.emitDeliverySideEffects]', err.message);
  }
}

module.exports = {
  areAllItemsDelivered,
  finalizeOrderDelivery,
  emitDeliverySideEffects,
};
