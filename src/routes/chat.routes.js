const express = require('express');
const router = express.Router();
const chatControllers = require('../controllers/chat.controllers');
const authenticate = require('../middleware/authMiddleware');
const requireAdmin = require('../middleware/adminMiddleware');
const optionalAdmin = require('../middleware/optionalAdmin');

router.get('/v2/api/chats/order/:orderId', authenticate, optionalAdmin, chatControllers.getChatByOrder);
router.post('/v2/api/chats/:chatId/messages', authenticate, optionalAdmin, chatControllers.sendMessage);
router.put('/v2/api/chats/:chatId/labels', authenticate, requireAdmin, chatControllers.updateChatLabels);
router.put('/v2/api/chats/:chatId/status', authenticate, requireAdmin, chatControllers.updateChatStatus);
router.patch('/v2/api/chats/:chatId/read', authenticate, requireAdmin, chatControllers.markChatAsRead);
router.post('/v2/api/chats/:chatId/items/:itemId/deliver', authenticate, requireAdmin, chatControllers.deliverItem);
router.get('/v2/api/chats', authenticate, requireAdmin, chatControllers.listChats);

router.get('/v2/api/chats/macros', authenticate, requireAdmin, chatControllers.listMacros);
router.post('/v2/api/chats/macros', authenticate, requireAdmin, chatControllers.createMacro);
router.delete('/v2/api/chats/macros/:id', authenticate, requireAdmin, chatControllers.deleteMacro);
router.put('/v2/api/chats/macros/:id', authenticate, requireAdmin, chatControllers.updateMacro);

router.get('/v2/api/chats/labels', authenticate, requireAdmin, chatControllers.listLabels);
router.post('/v2/api/chats/labels', authenticate, requireAdmin, chatControllers.createLabel);
router.delete('/v2/api/chats/labels/:id', authenticate, requireAdmin, chatControllers.deleteLabel);

module.exports = router;
