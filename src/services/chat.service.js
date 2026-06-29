const { prisma } = require('../config/prisma');
const { tiptapToPlainText } = require('../utils/tiptapText');

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

async function sendAutomatedText(tx, chatId, content) {
  if (!content?.trim()) return null;
  return tx.chatMessage.create({
    data: {
      chatId,
      senderId: 'SYSTEM',
      content: content.trim(),
      type: 'AUTOMATED',
    },
  });
}

async function loadSiteChatConfig(tx) {
  return tx.siteConfig.findUnique({
    where: { id: 'default' },
    select: {
      chatPreChatEnabled: true,
      chatPreChatQuestions: true,
      chatWelcomeMessage: true,
      chatAutomatedMessages: true,
    },
  });
}

async function sendSiteAutomatedMessages(tx, chatId) {
  const siteConfig = await loadSiteChatConfig(tx);
  if (!siteConfig) return;

  if (siteConfig.chatWelcomeMessage?.trim()) {
    await sendAutomatedText(tx, chatId, siteConfig.chatWelcomeMessage);
  }

  if (siteConfig.chatAutomatedMessages) {
    try {
      const messages = JSON.parse(siteConfig.chatAutomatedMessages);
      if (Array.isArray(messages)) {
        for (const msg of messages) {
          const text = typeof msg === 'string' ? msg : msg?.content;
          if (text?.trim()) await sendAutomatedText(tx, chatId, text);
        }
      }
    } catch (err) {
      console.error('[ChatService] Failed to parse chatAutomatedMessages', err.message);
    }
  }

  if (siteConfig.chatPreChatEnabled && siteConfig.chatPreChatQuestions) {
    try {
      const questions = JSON.parse(siteConfig.chatPreChatQuestions);
      if (Array.isArray(questions)) {
        for (const question of questions) {
          if (question?.trim()) await sendAutomatedText(tx, chatId, question);
        }
      }
    } catch (err) {
      console.error('[ChatService] Failed to parse pre-chat questions', err.message);
    }
  }
}

async function sendProductInstructions(tx, chatId, orderItems) {
  const sentKeys = new Set();

  for (const item of orderItems) {
    const instructions =
      item.variant?.postPurchaseInstructions ?? item.product?.postPurchaseInstructions;
    if (!instructions) continue;

    const key = `${item.productId}-${item.variantId || 'base'}`;
    if (sentKeys.has(key)) continue;
    sentKeys.add(key);

    const text = tiptapToPlainText(instructions);
    if (!text) continue;

    const productName = item.variant?.name
      ? `${item.product.name} — ${item.variant.name}`
      : item.product.name;

    await tx.chatMessage.create({
      data: {
        chatId,
        senderId: 'SYSTEM',
        type: 'AUTOMATED',
        content: `📋 Instruções — ${productName}\n\n${text}`,
      },
    });
  }
}

async function labelMatchesOrderItem(label, item, product) {
  const refs = label.references || [];
  if (!refs.length) return false;
  return refs.some((ref) => {
    if (ref.type === 'PRODUCT' && ref.referenceId === item.productId) return true;
    if (ref.type === 'VARIANT' && ref.referenceId === item.variantId) return true;
    if (ref.type === 'CATEGORY' && product?.categoryId === ref.referenceId) return true;
    return false;
  });
}

async function applyAutoLabelsForOrder(tx, chatId, orderItems) {
  if (!orderItems?.length) return;

  const productIds = [...new Set(orderItems.map((i) => i.productId))];
  const products = await tx.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, categoryId: true },
  });
  const productsById = new Map(products.map((p) => [p.id, p]));

  const labels = await tx.chatLabel.findMany({ include: { references: true } });
  const matchingLabelIds = labels
    .filter((label) => label.references?.length > 0)
    .filter((label) =>
      orderItems.some((item) =>
        labelMatchesOrderItem(label, item, productsById.get(item.productId))
      )
    )
    .map((l) => l.id);

  if (!matchingLabelIds.length) return;

  await tx.chat.update({
    where: { id: chatId },
    data: { labels: { connect: matchingLabelIds.map((id) => ({ id })) } },
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
          product: {
            select: {
              name: true,
              imageUrl: true,
              postPurchaseInstructions: true,
            },
          },
          variant: {
            select: {
              name: true,
              postPurchaseInstructions: true,
            },
          },
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
      name: item.variant?.name
        ? `${item.product.name} — ${item.variant.name}`
        : item.product.name,
      imageUrl: item.product.imageUrl,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
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

    await sendSiteAutomatedMessages(tx, chat.id);
    await sendProductInstructions(tx, chat.id, order.items);

    await applyAutoLabelsForOrder(tx, chat.id, order.items);

    await tx.chat.update({
      where: { id: chat.id },
      data: { updatedAt: new Date() },
    });
  }

  return chat;
}

async function initializeChat(orderId) {
  let chat = await prisma.chat.findUnique({ where: { orderId } });

  if (!chat) {
    chat = await prisma.chat.create({
      data: { orderId, status: 'OPEN' },
    });
  }

  await prisma.$transaction(async (tx) => {
    await sendSiteAutomatedMessages(tx, chat.id);
  });

  return chat;
}

async function closeChat(chatId) {
  const chat = await prisma.chat.update({
    where: { id: chatId },
    data: { status: 'CLOSED', updatedAt: new Date() },
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
    data: { status: 'ARCHIVED', updatedAt: new Date() },
  });
}

async function submitRating(chatId, rating, comment = null) {
  return prisma.chat.update({
    where: { id: chatId },
    data: { rating, ratingComment: comment, updatedAt: new Date() },
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
