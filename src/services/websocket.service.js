const { Server } = require('socket.io');
const { verifyToken } = require('../config/jwt');
const { prisma } = require('../config/prisma');

let io = null;
/** @type {Map<string, number>} */
const activeUsers = new Map();
/** @type {Map<string, { userId: string; expires: number }>} */
const joinChatCache = new Map();
const JOIN_CACHE_TTL_MS = 60_000;

const init = async (server, allowedOrigins) => {
  io = new Server(server, {
    cors: {
      origin: allowedOrigins,
      credentials: true,
      methods: ['GET', 'POST'],
    },
    path: '/socket.io/',
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  if (process.env.REDIS_URL) {
    try {
      const { createAdapter } = require('@socket.io/redis-adapter');
      const { createClient } = require('redis');
      const pub = createClient({ url: process.env.REDIS_URL });
      const sub = pub.duplicate();
      await Promise.all([pub.connect(), sub.connect()]);
      io.adapter(createAdapter(pub, sub));
      console.log('[SOCKET] Redis adapter ativo');
    } catch (err) {
      console.warn('[SOCKET] Redis adapter indisponível:', err.message);
    }
  }

  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;

    if (!token) {
      return next(new Error('Authentication error: Token not found'));
    }

    try {
      const payload = verifyToken(token);

      if (!payload?.id) {
        return next(new Error('Authentication error: Invalid token payload'));
      }

      const user = await prisma.user.findUnique({
        where: { id: payload.id },
        select: { id: true, isAdmin: true },
      });

      if (!user) {
        return next(new Error('Authentication error: User not found'));
      }

      socket.user = { id: user.id, isAdmin: Boolean(user.isAdmin) };
      next();
    } catch (err) {
      console.error('[SOCKET] Auth error:', err.message);
      return next(new Error('Authentication error: Token invalid or expired'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.user.id;
    const isAdmin = Boolean(socket.user.isAdmin);

    const currentConns = activeUsers.get(userId) || 0;
    activeUsers.set(userId, currentConns + 1);

    socket.join(`user_${userId}`);

    if (isAdmin) {
      socket.join('admins');
      socket.emit('presence_update', getActiveUsers());
    }

    broadcastPresenceToAdmins();

    socket.on('join_chat', async (chatId) => {
      if (!chatId || typeof chatId !== 'string') return;

      const cacheKey = `${userId}:${chatId}`;
      const cached = joinChatCache.get(cacheKey);
      if (cached && cached.expires > Date.now()) {
        socket.join(`chat_${chatId}`);
        return;
      }

      try {
        const chat = await prisma.chat.findUnique({
          where: { id: chatId },
          select: { order: { select: { userId: true } } },
        });

        if (!chat) return;

        if (!isAdmin && chat.order.userId !== userId) {
          return;
        }

        joinChatCache.set(cacheKey, { userId, expires: Date.now() + JOIN_CACHE_TTL_MS });
        socket.join(`chat_${chatId}`);
      } catch (err) {
        console.error('[SOCKET] Erro ao entrar no chat:', err.message);
      }
    });

    socket.on('leave_chat', (chatId) => {
      if (chatId) socket.leave(`chat_${chatId}`);
    });

    let typingTimer = null;
    socket.on('typing_start', ({ chatId }) => {
      if (!chatId) return;
      if (typingTimer) clearTimeout(typingTimer);
      emitToChat(chatId, 'typing', { chatId, userId, isTyping: true, isAdmin });
      typingTimer = setTimeout(() => {
        emitToChat(chatId, 'typing', { chatId, userId, isTyping: false, isAdmin });
      }, 3000);
    });

    socket.on('typing_stop', ({ chatId }) => {
      if (!chatId) return;
      if (typingTimer) clearTimeout(typingTimer);
      emitToChat(chatId, 'typing', { chatId, userId, isTyping: false, isAdmin });
    });

    socket.on('disconnect', () => {
      const conns = activeUsers.get(userId) || 0;
      if (conns <= 1) {
        activeUsers.delete(userId);
      } else {
        activeUsers.set(userId, conns - 1);
      }
      broadcastPresenceToAdmins();
    });
  });

  console.log('[SOCKET] Servidor WebSocket inicializado');
};

const getIo = () => io;

const getActiveUsers = () => Array.from(activeUsers.keys());

const broadcastPresenceToAdmins = () => {
  if (io) {
    io.to('admins').emit('presence_update', getActiveUsers());
  }
};

const emitToChat = (chatId, event, data) => {
  if (io) io.to(`chat_${chatId}`).emit(event, data);
};

const emitToUser = (userId, event, data) => {
  if (io) io.to(`user_${userId}`).emit(event, data);
};

const emitToAdmins = (event, data) => {
  if (io) io.to('admins').emit(event, data);
};

/** Broadcast a new message — sem fan-out global de new_message para todos admins */
const broadcastNewMessage = (chatId, orderUserId, message, senderIsAdmin, meta = {}) => {
  const payload = { chatId, orderId: meta.orderId, ...message };
  const alertPayload = { chatId, message, unreadCount: meta.unreadCount, ...meta };

  emitToChat(chatId, 'new_message', payload);
  emitToUser(orderUserId, 'new_message', payload);

  if (senderIsAdmin) {
    emitToUser(orderUserId, 'new_message_alert', alertPayload);
  } else {
    emitToAdmins('new_message_alert', alertPayload);
  }

  emitToAdmins('chat_list_update', {
    chatId,
    lastMessage: message,
    unreadCount: meta.unreadCount,
    ...meta,
  });
};

const notifyChatCreated = (chatId, orderUserId, lastMessage, meta = {}) => {
  const alertPayload = { chatId, type: 'new_chat', unreadCount: meta.unreadCount ?? 1, ...meta };

  emitToUser(orderUserId, 'new_message_alert', alertPayload);
  emitToAdmins('new_message_alert', alertPayload);
  emitToAdmins('chat_list_update', {
    chatId,
    type: 'new_chat',
    lastMessage,
    unreadCount: meta.unreadCount ?? 1,
    ...meta,
  });

  if (lastMessage) {
    const payload = { chatId, ...lastMessage };
    emitToUser(orderUserId, 'new_message', payload);
    emitToChat(chatId, 'new_message', payload);
  }
};

module.exports = {
  init,
  getIo,
  getActiveUsers,
  emitToChat,
  emitToUser,
  emitToAdmins,
  broadcastNewMessage,
  notifyChatCreated,
};
