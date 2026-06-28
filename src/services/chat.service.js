const { prisma } = require('../config/prisma');

/**
 * Business logic for chat system
 * Handles automated messages, status updates, and questionnaire logic
 */

const AUTOMATED_MESSAGES = {
  PAYMENT_APPROVED: {
    type: 'AUTOMATED',
    content: 'Pagamento aprovado! Seu pedido está sendo processado.',
  },
  ORDER_DELIVERED: {
    type: 'AUTOMATED',
    content: 'Seu pedido foi entregue com sucesso. Aproveite!',
  },
  ORDER_CANCELLED: {
    type: 'AUTOMATED',
    content: 'Seu pedido foi cancelado. Entre em contato se tiver dúvidas.',
  },
};

/**
 * Send an automated system message to a chat
 */
async function sendSystemMessage(chatId, messageKey) {
  const template = AUTOMATED_MESSAGES[messageKey];
  if (!template) return null;

  return prisma.chatMessage.create({
    data: {
      chatId,
      senderId: 'SYSTEM',
      content: template.content,
      type: template.type,
    },
  });
}

/**
 * Create chat for a paid order and send the payment-approved card message.
 * Safe to call multiple times (idempotent).
 */
async function initializeChatForPaidOrder(tx, orderId) {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    include: {
      items: {
        include: {
          product: { select: { name: true, imageUrl: true } },
        },
      },
    },
  });

  if (!order) return null;

  let chat = await tx.chat.findUnique({ where: { orderId } });
  if (!chat) {
    chat = await tx.chat.create({
      data: { orderId, status: 'OPEN' },
    });
  }

  const existingMsg = await tx.chatMessage.findFirst({
    where: { chatId: chat.id, type: 'ORDER_APPROVED' },
  });

  if (!existingMsg) {
    const products = order.items.map((item) => ({
      name: item.product.name,
      imageUrl: item.product.imageUrl,
    }));

    await tx.chatMessage.create({
      data: {
        chatId: chat.id,
        senderId: 'SYSTEM',
        type: 'ORDER_APPROVED',
        content: JSON.stringify({
          title: 'Pedido Aprovado',
          description: 'Acompanhe o status do seu pedido.',
          products,
        }),
      },
    });

    await tx.chat.update({
      where: { id: chat.id },
      data: { updatedAt: new Date() },
    });
  }

  return chat;
}

/**
 * Initialize chat for an order with optional questionnaire
 */
async function initializeChat(orderId) {
  let chat = await prisma.chat.findUnique({
    where: { orderId },
  });

  if (!chat) {
    chat = await prisma.chat.create({
      data: {
        orderId,
        status: 'OPEN',
      },
    });
  }

  const siteConfig = await prisma.siteConfig.findUnique({
    where: { id: 'default' },
    select: {
      chatPreChatEnabled: true,
      chatPreChatQuestions: true,
      chatWelcomeMessage: true,
    },
  });

  if (siteConfig?.chatPreChatEnabled && siteConfig.chatPreChatQuestions) {
    try {
      const questions = JSON.parse(siteConfig.chatPreChatQuestions);
      for (const question of questions) {
        await prisma.chatMessage.create({
          data: {
            chatId: chat.id,
            senderId: 'SYSTEM',
            content: question,
            type: 'AUTOMATED',
          },
        });
      }
    } catch (e) {
      console.error('[ChatService] Failed to parse pre-chat questions', e);
    }
  }

  if (siteConfig?.chatWelcomeMessage) {
    await prisma.chatMessage.create({
      data: {
        chatId: chat.id,
        senderId: 'SYSTEM',
        content: siteConfig.chatWelcomeMessage,
        type: 'AUTOMATED',
      },
    });
  }

  return chat;
}

async function closeChat(chatId) {
  const chat = await prisma.chat.update({
    where: { id: chatId },
    data: {
      status: 'CLOSED',
      updatedAt: new Date(),
    },
  });

  await prisma.chatMessage.create({
    data: {
      chatId,
      senderId: 'SYSTEM',
      content: 'Por favor, avalie nosso atendimento (1-5 estrelas):',
      type: 'AUTOMATED',
    },
  });

  return chat;
}

async function archiveChat(chatId) {
  return prisma.chat.update({
    where: { id: chatId },
    data: {
      status: 'ARCHIVED',
      updatedAt: new Date(),
    },
  });
}

async function submitRating(chatId, rating, comment = null) {
  return prisma.chat.update({
    where: { id: chatId },
    data: {
      rating,
      ratingComment: comment,
      updatedAt: new Date(),
    },
  });
}

async function getChatStats() {
  const [total, open, closed, archived, avgRating] = await Promise.all([
    prisma.chat.count(),
    prisma.chat.count({ where: { status: 'OPEN' } }),
    prisma.chat.count({ where: { status: 'CLOSED' } }),
    prisma.chat.count({ where: { status: 'ARCHIVED' } }),
    prisma.chat.aggregate({
      where: { rating: { not: null } },
      _avg: { rating: true },
    }),
  ]);

  return {
    total,
    open,
    closed,
    archived,
    averageRating: avgRating._avg.rating || 0,
  };
}

module.exports = {
  sendSystemMessage,
  initializeChatForPaidOrder,
  initializeChat,
  closeChat,
  archiveChat,
  submitRating,
  getChatStats,
  AUTOMATED_MESSAGES,
};
