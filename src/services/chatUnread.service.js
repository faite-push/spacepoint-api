const { prisma } = require('../config/prisma');
const { signChatMessageFileUrls } = require('../utils/cdnSignedUrl');

const CUSTOMER_SENDERS = { notIn: ['ADMIN', 'SYSTEM'] };

/**
 * Recalcula unreadCount do chat (mesma regra da listagem antiga).
 */
async function syncUnreadCount(chatId, tx = prisma) {
  const chat = await tx.chat.findUnique({
    where: { id: chatId },
    select: { id: true, lastAdminReadAt: true },
  });
  if (!chat) return 0;

  const unreadWhere = {
    chatId,
    senderId: CUSTOMER_SENDERS,
  };
  if (chat.lastAdminReadAt) {
    unreadWhere.createdAt = { gt: chat.lastAdminReadAt };
  }

  let unreadCount = await tx.chatMessage.count({ where: unreadWhere });

  if (unreadCount === 0 && !chat.lastAdminReadAt) {
    const hasMessages = await tx.chatMessage.findFirst({
      where: { chatId },
      select: { id: true },
    });
    if (hasMessages) unreadCount = 1;
  }

  if (unreadCount === 0 && chat.lastAdminReadAt) {
    const reopenAfterRead = await tx.chatMessage.findFirst({
      where: {
        chatId,
        senderId: 'SYSTEM',
        type: 'AUTOMATED',
        content: { contains: 'reabriu' },
        createdAt: { gt: chat.lastAdminReadAt },
      },
      select: { id: true },
    });
    if (reopenAfterRead) unreadCount = 1;
  }

  await tx.chat.update({
    where: { id: chatId },
    data: { unreadCount },
  });

  return unreadCount;
}

async function resetUnreadCount(chatId, tx = prisma) {
  await tx.chat.update({
    where: { id: chatId },
    data: { unreadCount: 0, lastAdminReadAt: new Date() },
  });
}

async function setInitialUnreadCount(chatId, tx = prisma) {
  await tx.chat.update({
    where: { id: chatId },
    data: { unreadCount: 1 },
  });
}

async function fetchChatMessages(chatId, { before, limit = 50, req = null } = {}) {
  const take = Math.min(Math.max(Number(limit) || 50, 1), 100);

  let cursorDate = null;
  if (before) {
    const cursor = await prisma.chatMessage.findFirst({
      where: { id: before, chatId },
      select: { createdAt: true },
    });
    cursorDate = cursor?.createdAt ?? null;
  }

  const where = { chatId };
  if (cursorDate) {
    where.createdAt = { lt: cursorDate };
  }

  const batch = await prisma.chatMessage.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: take + 1,
  });

  const hasMore = batch.length > take;
  const messages = signChatMessageFileUrls(batch.slice(0, take).reverse(), req);

  return { messages, hasMore };
}

module.exports = {
  syncUnreadCount,
  resetUnreadCount,
  setInitialUnreadCount,
  fetchChatMessages,
};
