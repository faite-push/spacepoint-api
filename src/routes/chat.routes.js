const express = require('express');
const router = express.Router();
const chatControllers = require('../controllers/chat.controllers');
const authenticate = require('../middleware/authMiddleware');
const requireAdmin = require('../middleware/adminMiddleware');
const optionalAdmin = require('../middleware/optionalAdmin');
const { clientChatBurstLimiter, clientChatMessageLimiter } = require('../middleware/chatMessageRateLimit');

router.get('/v2/api/admin/clients', authenticate, requireAdmin, chatControllers.listClients);
router.get('/v2/api/admin/chat-reviews', authenticate, requireAdmin, chatControllers.listChatReviews);

router.get('/v2/api/chats/macros', authenticate, requireAdmin, chatControllers.listMacros);
router.post('/v2/api/chats/macros', authenticate, requireAdmin, chatControllers.createMacro);
router.delete('/v2/api/chats/macros/:id', authenticate, requireAdmin, chatControllers.deleteMacro);
router.put('/v2/api/chats/macros/:id', authenticate, requireAdmin, chatControllers.updateMacro);

router.get('/v2/api/chats/labels', authenticate, requireAdmin, chatControllers.listLabels);
router.post('/v2/api/chats/labels', authenticate, requireAdmin, chatControllers.createLabel);
router.put('/v2/api/chats/labels/:id', authenticate, requireAdmin, chatControllers.updateLabel);
router.delete('/v2/api/chats/labels/:id', authenticate, requireAdmin, chatControllers.deleteLabel);

router.get('/v2/api/chats/ws-token', authenticate, chatControllers.getWsToken);
router.get('/v2/api/chats/order/:orderId', authenticate, optionalAdmin, chatControllers.getChatByOrder);
router.get('/v2/api/chats', authenticate, requireAdmin, chatControllers.listChats);

router.get('/v2/api/chats/:chatId', authenticate, requireAdmin, chatControllers.getChatById);
router.post(
  '/v2/api/chats/:chatId/messages',
  authenticate,
  optionalAdmin,
  clientChatBurstLimiter,
  clientChatMessageLimiter,
  chatControllers.sendMessage
);
router.post('/v2/api/chats/:chatId/rating', authenticate, chatControllers.submitClientRating);
router.post('/v2/api/chats/:chatId/reopen', authenticate, chatControllers.reopenChat);
router.put('/v2/api/chats/:chatId/labels', authenticate, requireAdmin, chatControllers.updateChatLabels);
router.put('/v2/api/chats/:chatId/status', authenticate, requireAdmin, chatControllers.updateChatStatus);
router.patch('/v2/api/chats/:chatId/assign', authenticate, requireAdmin, chatControllers.assignChat);
router.patch('/v2/api/chats/:chatId/messages/:messageId/pin', authenticate, requireAdmin, chatControllers.togglePinMessage);
router.patch('/v2/api/chats/:chatId/read', authenticate, requireAdmin, chatControllers.markChatAsRead);
router.post('/v2/api/chats/:chatId/items/:itemId/deliver', authenticate, requireAdmin, chatControllers.deliverItem);

module.exports = router;
