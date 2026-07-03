const express = require('express');
const router = express.Router();
const chatControllers = require('../controllers/chat.controllers');
const authenticate = require('../middleware/authMiddleware');
const requireAdmin = require('../middleware/adminMiddleware');
const requirePermission = require('../middleware/permissionMiddleware');
const optionalAdmin = require('../middleware/optionalAdmin');
const { clientChatBurstLimiter, clientChatMessageLimiter } = require('../middleware/chatMessageRateLimit');

const adminGuard = [authenticate, requireAdmin];

router.get('/v2/api/admin/clients', ...adminGuard, requirePermission('clients:view'), chatControllers.listClients);
router.get('/v2/api/admin/chat-reviews', ...adminGuard, requirePermission('reviews:view'), chatControllers.listChatReviews);
router.patch('/v2/api/admin/chat-reviews/:chatId', ...adminGuard, requirePermission('reviews:manage'), chatControllers.updateChatReview);
router.delete('/v2/api/admin/chat-reviews/:chatId', ...adminGuard, requirePermission('reviews:manage'), chatControllers.deleteChatReview);
router.get('/v2/api/store-reviews', chatControllers.listPublishedStoreReviews);

router.get('/v2/api/chats/macros', ...adminGuard, requirePermission('chats:view'), chatControllers.listMacros);
router.post('/v2/api/chats/macros', ...adminGuard, requirePermission('chats:manage'), chatControllers.createMacro);
router.delete('/v2/api/chats/macros/:id', ...adminGuard, requirePermission('chats:manage'), chatControllers.deleteMacro);
router.put('/v2/api/chats/macros/:id', ...adminGuard, requirePermission('chats:manage'), chatControllers.updateMacro);

router.get('/v2/api/chats/labels', ...adminGuard, requirePermission('chats:view'), chatControllers.listLabels);
router.post('/v2/api/chats/labels', ...adminGuard, requirePermission('chats:manage'), chatControllers.createLabel);
router.put('/v2/api/chats/labels/:id', ...adminGuard, requirePermission('chats:manage'), chatControllers.updateLabel);
router.delete('/v2/api/chats/labels/:id', ...adminGuard, requirePermission('chats:manage'), chatControllers.deleteLabel);

router.get('/v2/api/chats/ws-token', authenticate, chatControllers.getWsToken);
router.get('/v2/api/chats/order/:orderId', authenticate, optionalAdmin, chatControllers.getChatByOrder);
router.get('/v2/api/chats', ...adminGuard, requirePermission('chats:view'), chatControllers.listChats);

router.get('/v2/api/chats/:chatId', ...adminGuard, requirePermission('chats:view'), chatControllers.getChatById);
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
router.put('/v2/api/chats/:chatId/labels', ...adminGuard, requirePermission('chats:manage'), chatControllers.updateChatLabels);
router.put('/v2/api/chats/:chatId/status', ...adminGuard, requirePermission('chats:manage'), chatControllers.updateChatStatus);
router.patch('/v2/api/chats/:chatId/assign', ...adminGuard, requirePermission('chats:manage'), chatControllers.assignChat);
router.patch('/v2/api/chats/:chatId/messages/:messageId/pin', ...adminGuard, requirePermission('chats:manage'), chatControllers.togglePinMessage);
router.patch('/v2/api/chats/:chatId/read', ...adminGuard, requirePermission('chats:view'), chatControllers.markChatAsRead);
router.post('/v2/api/chats/:chatId/items/:itemId/deliver', ...adminGuard, requirePermission('chats:manage'), chatControllers.deliverItem);

module.exports = router;
