const { Server } = require('socket.io');
const { verifyToken } = require('../config/jwt');
const { prisma } = require('../config/prisma');

let io = null;
/** @type {Map<string, number>} */
const activeUsers = new Map();

const init = (server, allowedOrigins) => {
  io = new Server(server, {
    cors: {
      origin: allowedOrigins,
      credentials: true,
      methods: ['GET', 'POST'],
    },
    // Explicit path avoids conflicts with Express routes
    path: '/socket.io/',
    pingTimeout: 60000,
    pingInterval: 25000,
  });

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

      // Always resolve admin flag from DB — JWT cookie may not include isAdmin
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

    console.log(`[SOCKET] Conectado: ${userId} (${isAdmin ? 'Admin' : 'Cliente'})`);

    socket.join(`user_${userId}`);

    if (isAdmin) {
      socket.join('admins');
    }

    // Send current presence list immediately to the connecting client
    socket.emit('presence_update', getActiveUsers());
    broadcastPresenceUpdate();

    socket.on('join_chat', async (chatId) => {
      if (!chatId || typeof chatId !== 'string') return;

      try {
        const chat = await prisma.chat.findUnique({
          where: { id: chatId },
          select: { order: { select: { userId: true } } },
        });

        if (!chat) return;

        if (!isAdmin && chat.order.userId !== userId) {
          console.warn(`[SOCKET] Acesso negado ao chat ${chatId} para ${userId}`);
          return;
        }

        socket.join(`chat_${chatId}`);
      } catch (err) {
        console.error('[SOCKET] Erro ao entrar no chat:', err.message);
      }
    });

    socket.on('leave_chat', (chatId) => {
      if (chatId) socket.leave(`chat_${chatId}`);
    });

    socket.on('typing_start', ({ chatId }) => {
      if (!chatId) return;
      emitToChat(chatId, 'typing', { chatId, userId, isTyping: true, isAdmin });
    });

    socket.on('typing_stop', ({ chatId }) => {
      if (!chatId) return;
      emitToChat(chatId, 'typing', { chatId, userId, isTyping: false, isAdmin });
    });

    socket.on('disconnect', () => {
      const conns = activeUsers.get(userId) || 0;
      if (conns <= 1) {
        activeUsers.delete(userId);
      } else {
        activeUsers.set(userId, conns - 1);
      }
      broadcastPresenceUpdate();
    });
  });

  console.log('[SOCKET] Servidor WebSocket inicializado');
};

const getIo = () => io;

const getActiveUsers = () => Array.from(activeUsers.keys());

const broadcastPresenceUpdate = () => {
  if (io) {
    io.emit('presence_update', getActiveUsers());
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

/** Broadcast a new message to chat room + personal rooms (reliable delivery) */
const broadcastNewMessage = (chatId, orderUserId, message, senderIsAdmin, meta = {}) => {
  const payload = { chatId, orderId: meta.orderId, ...message };
  const alertPayload = { chatId, message, ...meta };

  emitToChat(chatId, 'new_message', payload);
  emitToUser(orderUserId, 'new_message', payload);

  if (senderIsAdmin) {
    emitToUser(orderUserId, 'new_message_alert', alertPayload);
  } else {
    emitToAdmins('new_message', payload);
    emitToAdmins('new_message_alert', alertPayload);
  }

  emitToAdmins('chat_list_update', { chatId, lastMessage: message, ...meta });
};

const notifyChatCreated = (chatId, orderUserId, lastMessage, meta = {}) => {
  const alertPayload = { chatId, type: 'new_chat', ...meta };

  emitToUser(orderUserId, 'new_message_alert', alertPayload);
  emitToAdmins('new_message_alert', alertPayload);
  emitToAdmins('chat_list_update', { chatId, type: 'new_chat', lastMessage, ...meta });

  if (lastMessage) {
    const payload = { chatId, ...lastMessage };
    emitToUser(orderUserId, 'new_message', payload);
    emitToAdmins('new_message', payload);
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
