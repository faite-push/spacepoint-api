const { prisma } = require('../config/prisma');
const { sanitizeString, sanitizeChatContent } = require('../utils/sanitize');
const { resolveSellable } = require('../utils/productStore');
const { initializeChatForPaidOrder } = require('../services/chat.service');
const { randomBytes } = require('crypto');
const socketService = require('../services/websocket.service');
const { syncAutomaticStockFromCodes } = require('../utils/digitalStock');
const { syncUnreadCount, resetUnreadCount, setInitialUnreadCount, fetchChatMessages } = require('../services/chatUnread.service');
const { getReviewsSettings } = require('../utils/reviewsSettings');
const { signChatFileUrl, signChatMessageFileUrls } = require('../utils/cdnSignedUrl');
const { userHasPermission } = require('../middleware/permissionMiddleware');
const { claimOneCodeForDelivery } = require('../services/orderFulfillment.service');
const { finalizeOrderDelivery, emitDeliverySideEffects } = require('../services/orderDelivery.service');
const orderEmailService = require('../services/orderEmail.service');
const {
  recordAdminAction,
  AUDIT_ACTIONS,
  requestContext,
} = require('../services/auditLog.service');

const ORDER_LIST_INCLUDE = {
  user: { select: { id: true, name: true, email: true, image: true } },
  items: {
    select: {
      id: true,
      quantity: true,
      codes: { where: { status: 'DELIVERED' }, select: { id: true, status: true } },
    },
  },
};

const ORDER_INCLUDE = {
  user: { select: { id: true, name: true, email: true, image: true } },
  payments: {
    orderBy: { createdAt: 'desc' },
    select: { id: true, externalId: true, provider: true, status: true, amount: true, createdAt: true },
  },
  items: {
    include: {
      product: {
        select: {
          name: true,
          imageUrl: true,
          deliveryType: true,
        },
      },
      variant: {
        select: {
          name: true,
          deliveryType: true,
        },
      },
      codes: {
        where: { status: 'DELIVERED' },
        select: { id: true, code: true, deliveredAt: true, status: true },
      },
    },
  },
};

async function fetchFullChat(chatId) {
  return prisma.chat.findUnique({
    where: { id: chatId },
    include: {
      messages: { orderBy: { createdAt: 'asc' } },
      labels: true,
      assignedTo: { select: { id: true, name: true, email: true, image: true } },
      order: { include: ORDER_INCLUDE },
    },
  });
}

async function emitFullChatUpdate(chatId, extra = {}) {
  const fullChat = await fetchFullChat(chatId);
  if (!fullChat) return null;
  socketService.emitToChat(chatId, 'chat_updated', fullChat);
  if (!extra.skipListUpdate) {
    socketService.emitToAdmins('chat_list_update', { chatId, ...extra });
  }
  return fullChat;
}

class ChatController {
  async getWsToken(req, res) {
    try {
      const { generateToken } = require('../config/jwt');

      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: { id: true, isAdmin: true },
      });

      if (!user) {
        return res.status(404).json({ error: 'Usuário não encontrado' });
      }

      const wsToken = generateToken(
        { id: user.id, isAdmin: Boolean(user.isAdmin) },
        { expiresIn: '1h' }
      );

      return res.json({ token: wsToken });
    } catch (err) {
      console.error('[ChatController.getWsToken]', err);
      return res.status(500).json({ error: 'Erro ao gerar token' });
    }
  }

  async getChatByOrder(req, res) {
    try {
      const { orderId } = req.params;
      const userId = req.user.id;
      const isAdmin = req.user.isAdmin;

      const order = await prisma.order.findUnique({
        where: { id: orderId },
        select: { userId: true, status: true, id: true },
      });

      if (!order) return res.status(404).json({ error: 'Pedido não encontrado' });
      if (!isAdmin && order.userId !== userId) {
        return res.status(403).json({ error: 'Acesso negado' });
      }

      let chat = await prisma.chat.findUnique({
        where: { orderId: order.id },
        include: {
          labels: true,
          assignedTo: { select: { id: true, name: true, email: true, image: true } },
          order: { include: ORDER_INCLUDE },
        },
      });

      if (!chat) {
        if (order.status === 'PAID' || order.status === 'DELIVERED') {
          chat = await prisma.$transaction(async (tx) => {
            await initializeChatForPaidOrder(tx, order.id);
            return tx.chat.findUnique({
              where: { orderId: order.id },
              include: {
                labels: true,
                order: { include: ORDER_INCLUDE },
              },
            });
          });
        } else {
          chat = await prisma.chat.create({
            data: { orderId: order.id },
            include: {
              labels: true,
              order: { include: ORDER_INCLUDE },
            },
          });
        }
      }

      const messageLimit = Math.min(Math.max(Number(req.query.messageLimit) || 50, 1), 100);
      const before = typeof req.query.before === 'string' ? req.query.before : undefined;
      const { messages, hasMore } = await fetchChatMessages(chat.id, {
        before,
        limit: messageLimit,
        req,
      });

      const userStats = await prisma.order.aggregate({
        where: { userId: chat.order.userId, status: { in: ['PAID', 'DELIVERED'] } },
        _sum: { total: true },
        _count: { id: true },
      });

      const itemsCount = await prisma.orderItem.aggregate({
        where: { order: { userId: chat.order.userId, status: { in: ['PAID', 'DELIVERED'] } } },
        _sum: { quantity: true },
      });

      const response = {
        ...chat,
        messages,
        messagesMeta: {
          hasMore,
          oldestId: messages[0]?.id ?? null,
        },
        userStats: {
          totalSpent: userStats._sum.total || 0,
          ordersCount: userStats._count.id || 0,
          itemsCount: itemsCount._sum.quantity || 0,
        },
      };

      return res.json(response);
    } catch (err) {
      console.error('[ChatController.getChatByOrder]', err);
      return res.status(500).json({ error: 'Erro ao buscar chat' });
    }
  }

  async deliverItem(req, res) {
    try {
      if (!req.user.isAdmin) return res.status(403).json({ error: 'Acesso negado' });

      const { chatId, itemId } = req.params;
      const content = sanitizeString(req.body?.content || '', 8000);
      const mode = req.body?.mode === 'lines' ? 'lines' : 'text';
      const useStock = Boolean(req.body?.useStock);

      const chat = await prisma.chat.findUnique({
        where: { id: chatId },
        include: {
          order: {
            include: {
              items: {
                include: {
                  product: { select: { name: true, imageUrl: true, deliveryType: true } },
                  variant: { select: { deliveryType: true } },
                  codes: true,
                },
              },
            },
          },
        },
      });

      if (!chat) return res.status(404).json({ error: 'Chat não encontrado' });

      const item = chat.order.items.find((i) => i.id === itemId);
      if (!item) return res.status(404).json({ error: 'Item não encontrado' });

      const deliveredCount = item.codes.filter((c) => c.status === 'DELIVERED').length;
      const pending = item.quantity - deliveredCount;
      if (pending <= 0) {
        return res.status(400).json({ error: 'Todos os produtos já foram entregues' });
      }

      const deliveryType = item.variant?.deliveryType ?? item.product.deliveryType;
      const isManual = ['manual', 'manual_chat', 'file', 'automatic_text', 'mixed'].includes(deliveryType);

      let linesToDeliver = [];
      if (mode === 'lines') {
        linesToDeliver = content.split('\n').map((l) => l.trim()).filter(Boolean);
      } else if (content.trim()) {
        linesToDeliver = [content.trim()];
      }

      if (isManual && !linesToDeliver.length) {
        return res.status(400).json({ error: 'Informe o conteúdo da entrega' });
      }

      linesToDeliver = linesToDeliver.slice(0, pending);

      let deliveryResult = null;

      await prisma.$transaction(async (tx) => {
        for (const line of linesToDeliver) {
          let deliveryContent = line;

          if (deliveryType === 'automatic_lines' || useStock) {
            const codeToDeliver = await claimOneCodeForDelivery(tx, {
              orderItemId: item.id,
              productId: item.productId,
              variantId: item.variantId ?? null,
            });

            if (!codeToDeliver) {
              throw new Error('Sem códigos disponíveis para entrega');
            }

            await syncAutomaticStockFromCodes(tx, item.productId, item.variantId ?? null);

            deliveryContent = codeToDeliver.code;
          } else {
            const uniquePrefix = randomBytes(8).toString('hex');
            await tx.productCode.create({
              data: {
                productId: item.productId,
                variantId: item.variantId,
                code: `${uniquePrefix}:${line}`,
                status: 'DELIVERED',
                deliveredAt: new Date(),
                orderItemId: item.id,
              },
            });

            const sellable = await resolveSellable(tx, item.productId, item.variantId, 1);
            const entity = sellable.variant || sellable.product;
            const reserved = item.stockReserved ?? 0;
            const manualStock = entity.stockQuantity;
            if (manualStock != null && reserved < item.quantity) {
              if (sellable.variant) {
                await tx.productVariant.update({
                  where: { id: sellable.variant.id },
                  data: { stockQuantity: { decrement: 1 } },
                });
              } else {
                await tx.product.update({
                  where: { id: sellable.product.id },
                  data: { stockQuantity: { decrement: 1 } },
                });
              }
              await tx.orderItem.update({
                where: { id: item.id },
                data: { stockReserved: { increment: 1 } },
              });
            }
          }

          await tx.chatMessage.create({
            data: {
              chatId: chat.id,
              senderId: 'ADMIN',
              type: 'DELIVERY',
              content: JSON.stringify({
                title: 'Produto entregue',
                description: 'Acompanhe o status do seu pedido.',
                productName: item.product.name,
                productImageUrl: item.product.imageUrl,
                deliveryContent,
                quantity: 1,
              }),
            },
          });
        }

        await tx.chat.update({
          where: { id: chat.id },
          data: { updatedAt: new Date() },
        });

        deliveryResult = await finalizeOrderDelivery(tx, chat.orderId);
      });

      if (deliveryResult?.changed) {
        await emitDeliverySideEffects(deliveryResult);
      }

      await recordAdminAction({
        ...requestContext(req),
        action: AUDIT_ACTIONS.ORDER_ITEM_DELIVERED,
        targetType: 'order_item',
        targetId: itemId,
        metadata: {
          orderId: chat.orderId,
          chatId: chat.id,
          productId: item.productId,
          productName: item.product.name,
          variantId: item.variantId,
          deliveryType,
          mode,
          useStock,
          quantityDelivered: linesToDeliver.length,
          pendingBefore: pending,
          pendingAfter: pending - linesToDeliver.length,
          orderFullyDelivered: Boolean(deliveryResult?.changed),
          orderStatusAfter: deliveryResult?.order?.status ?? chat.order.status,
          hasSensitiveContent: linesToDeliver.length > 0,
        },
      });

      const updatedChat = await prisma.chat.findUnique({
        where: { id: chatId },
        include: {
          messages: { orderBy: { createdAt: 'asc' } },
          labels: true,
          order: { include: ORDER_INCLUDE },
        },
      });

      if (updatedChat) {
        socketService.emitToChat(chatId, 'chat_updated', updatedChat);
        socketService.emitToUser(updatedChat.order.userId, 'new_message_alert', { chatId });
        socketService.emitToAdmins('chat_list_update', { chatId });
      }

      return res.json(updatedChat);
    } catch (err) {
      console.error('[ChatController.deliverItem]', err);
      return res.status(400).json({ error: err.message || 'Erro ao entregar produto' });
    }
  }

  async sendMessage(req, res) {
    try {
      const { chatId } = req.params;
      const { content, type = 'TEXT', fileUrl } = req.body;
      const senderId = req.user.id;

      const chat = await prisma.chat.findUnique({
        where: { id: chatId },
        include: {
          order: {
            select: {
              userId: true,
              user: { select: { name: true, email: true } },
            },
          },
        },
      });

      if (!chat) return res.status(404).json({ error: 'Chat não encontrado' });

      if (!req.user.isAdmin && chat.order.userId !== senderId) {
        return res.status(403).json({ error: 'Acesso negado' });
      }

      if (!req.user.isAdmin && chat.status === 'CLOSED') {
        return res.status(400).json({ error: 'Chat encerrado. Reabra o atendimento para enviar mensagens.' });
      }

      const isChatCustomer = chat.order.userId === senderId;
      const isStaffMessage = req.user.isAdmin && !isChatCustomer;

      if (isStaffMessage) {
        const allowed = await userHasPermission(senderId, 'chats:manage');
        if (!allowed) {
          return res.status(403).json({
            error: 'Acesso negado: falta a permissão chats:manage',
          });
        }
      }

      let staffTitle = null;
      if (isStaffMessage) {
        const staffUser = await prisma.user.findUnique({
          where: { id: senderId },
          select: { role: { select: { name: true } } },
        });
        staffTitle = staffUser?.role?.name || 'Staff';
      }

      const displayName =
        req.user.name?.trim() ||
        req.user.email?.trim() ||
        (isStaffMessage ? 'Suporte' : chat.order.user?.name || chat.order.user?.email || 'Cliente');

      const message = await prisma.chatMessage.create({
        data: {
          chatId,
          senderId: isStaffMessage ? 'ADMIN' : senderId,
          senderName: displayName,
          senderRole: isStaffMessage ? 'STAFF' : 'CLIENT',
          senderStaffTitle: staffTitle,
          content: sanitizeChatContent(content || '', 4000),
          type,
          fileUrl,
        },
      });

      let unreadCount = chat.unreadCount ?? 0;

      if (!isStaffMessage) {
        unreadCount = await syncUnreadCount(chatId);
      }

      await prisma.chat.update({
        where: { id: chatId },
        data: { updatedAt: new Date() },
      });

      if (isStaffMessage) {
        const chatMeta = await prisma.chat.findUnique({
          where: { id: chatId },
          select: { firstAdminResponseAt: true },
        });
        if (!chatMeta?.firstAdminResponseAt) {
          await prisma.chat.update({
            where: { id: chatId },
            data: { firstAdminResponseAt: new Date() },
          });
        }
      }

      const signedMessage = {
        ...message,
        fileUrl: signChatFileUrl(message.fileUrl, req),
      };

      const customerName = chat.order.user?.name || chat.order.user?.email || 'Cliente';
      socketService.broadcastNewMessage(chatId, chat.order.userId, signedMessage, isStaffMessage, {
        orderId: chat.orderId,
        customerName,
        unreadCount,
      });

      return res.status(201).json(signedMessage);
    } catch (err) {
      console.error('[ChatController.sendMessage]', err);
      return res.status(500).json({ error: 'Erro ao enviar mensagem' });
    }
  }

  async listMessages(req, res) {
    try {
      const { orderId } = req.params;
      const userId = req.user.id;
      const isAdmin = req.user.isAdmin;

      const order = await prisma.order.findUnique({
        where: { id: orderId },
        select: { userId: true },
      });
      if (!order) return res.status(404).json({ error: 'Pedido não encontrado' });
      if (!isAdmin && order.userId !== userId) {
        return res.status(403).json({ error: 'Acesso negado' });
      }

      const chat = await prisma.chat.findUnique({
        where: { orderId },
        select: { id: true },
      });
      if (!chat) return res.status(404).json({ error: 'Chat não encontrado' });

      const before = typeof req.query.before === 'string' ? req.query.before : undefined;
      const limit = req.query.limit;
      const result = await fetchChatMessages(chat.id, { before, limit, req });

      return res.json({
        messages: result.messages,
        messagesMeta: {
          hasMore: result.hasMore,
          oldestId: result.messages[0]?.id ?? null,
        },
      });
    } catch (err) {
      console.error('[ChatController.listMessages]', err);
      return res.status(500).json({ error: 'Erro ao carregar mensagens' });
    }
  }

  async listChats(req, res) {
    try {
      const { search, status, labelId, deliveryFilter, page = 1, sortBy = 'activity' } = req.query;
      const pageSize = 20;
      const skip = (Number(page) - 1) * pageSize;

      const where = {};
      if (status === 'RESOLVED') {
        where.isResolved = true;
      } else if (status === 'UNRESOLVED') {
        where.isResolved = false;
        where.status = 'OPEN';
      } else if (status === 'ARCHIVED') {
        where.OR = [{ isArchived: true }, { status: 'ARCHIVED' }];
      } else if (status === 'OPEN') {
        where.status = 'OPEN';
        where.isArchived = false;
      } else if (status === 'EXPRESS') {
        where.order = {
          OR: [
            { deliveryOption: 'express' },
            { adminNotes: { contains: 'ENTREGA EXPRESSA', mode: 'insensitive' } },
          ],
        };
      } else if (status && status !== 'ALL') {
        where.status = status;
      }
      if (labelId) {
        where.labels = { some: { id: labelId } };
      }
      if (deliveryFilter === 'express') {
        where.order = {
          OR: [
            { deliveryOption: 'express' },
            { adminNotes: { contains: 'ENTREGA EXPRESSA', mode: 'insensitive' } },
          ],
        };
      }
      if (search) {
        where.OR = [
          { orderId: { contains: search, mode: 'insensitive' } },
          { order: { user: { name: { contains: search, mode: 'insensitive' } } } },
          { order: { user: { email: { contains: search, mode: 'insensitive' } } } },
        ];
      }

      const orderBy = sortBy === 'created' ? { createdAt: 'desc' } : { updatedAt: 'desc' };

      const [chats, total] = await Promise.all([
        prisma.chat.findMany({
          where,
          include: {
            order: { include: ORDER_LIST_INCLUDE },
            messages: {
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
            labels: true,
          },
          orderBy,
          skip,
          take: pageSize,
        }),
        prisma.chat.count({ where }),
      ]);

      return res.json({
        chats: chats.map((chat) => ({
          ...chat,
          messages: signChatMessageFileUrls(chat.messages, req),
        })),
        total,
        page: Number(page),
        totalPages: Math.ceil(total / pageSize),
      });
    } catch (err) {
      console.error('[ChatController.listChats]', err);
      return res.status(500).json({ error: 'Erro ao listar chats' });
    }
  }

  async updateChatLabels(req, res) {
    try {
      const { chatId } = req.params;
      const { labelIds } = req.body;

      const chat = await prisma.chat.update({
        where: { id: chatId },
        data: {
          labels: {
            set: labelIds.map((id) => ({ id })),
          },
        },
        include: { labels: true },
      });

      socketService.emitToChat(chatId, 'chat_updated', chat);
      socketService.emitToAdmins('chat_list_update', { chatId });

      return res.json(chat);
    } catch (err) {
      console.error('[ChatController.updateChatLabels]', err);
      return res.status(400).json({ error: 'Erro ao atualizar etiquetas' });
    }
  }

  async updateChatStatus(req, res) {
    try {
      const { chatId } = req.params;
      const { status, rating, ratingComment, isResolved, isArchived } = req.body;

      const existing = await prisma.chat.findUnique({ where: { id: chatId } });
      if (!existing) return res.status(404).json({ error: 'Chat não encontrado' });

      const data = { updatedAt: new Date() };
      if (rating !== undefined) data.rating = rating ? Number(rating) : null;
      if (ratingComment !== undefined) {
        data.ratingComment = ratingComment ? sanitizeString(ratingComment, 1000) : null;
      }

      if (isArchived !== undefined) {
        data.isArchived = Boolean(isArchived);
      } else if (status === 'ARCHIVED') {
        data.isArchived = true;
      } else if (status === 'OPEN') {
        data.isArchived = false;
      }

      if (isResolved !== undefined) {
        data.isResolved = Boolean(isResolved);
        data.status = isResolved ? 'CLOSED' : 'OPEN';
      } else if (status !== undefined && status !== 'ARCHIVED') {
        data.status = status;
      } else if (existing.status === 'ARCHIVED' && (isArchived === false || status === 'OPEN')) {
        data.status = 'OPEN';
      }

      await prisma.chat.update({ where: { id: chatId }, data });

      if (isResolved === true) {
        const existingRatingMsg = await prisma.chatMessage.findFirst({
          where: { chatId, type: 'AUTOMATED', content: { contains: 'avalie nosso atendimento' } },
        });
        if (!existingRatingMsg) {
          await prisma.chatMessage.create({
            data: {
              chatId,
              senderId: 'SYSTEM',
              content: 'Por favor, avalie nosso atendimento (1-5 estrelas):',
              type: 'AUTOMATED',
            },
          });
        }
      }

      const fullChat = await emitFullChatUpdate(chatId);
      return res.json(fullChat || await prisma.chat.findUnique({ where: { id: chatId } }));
    } catch (err) {
      console.error('[ChatController.updateChatStatus]', err);
      return res.status(400).json({ error: 'Erro ao atualizar status do chat' });
    }
  }

  async markChatAsRead(req, res) {
    try {
      if (!req.user.isAdmin) return res.status(403).json({ error: 'Acesso negado' });
      const { chatId } = req.params;

      const chat = await prisma.chat.update({
        where: { id: chatId },
        data: { lastAdminReadAt: new Date(), unreadCount: 0 },
        include: { order: { select: { userId: true } } },
      });

      socketService.emitToChat(chatId, 'messages_read', {
        chatId,
        readAt: chat.lastAdminReadAt,
      });
      socketService.emitToUser(chat.order.userId, 'messages_read', {
        chatId,
        readAt: chat.lastAdminReadAt,
      });

      socketService.emitToChat(chatId, 'chat_updated', {
        id: chat.id,
        lastAdminReadAt: chat.lastAdminReadAt,
      });
      socketService.emitToAdmins('chat_list_update', { chatId, unreadCount: 0 });

      return res.json({ success: true, lastAdminReadAt: chat.lastAdminReadAt });
    } catch (err) {
      console.error('[ChatController.markChatAsRead]', err);
      return res.status(400).json({ error: 'Erro ao marcar como lido' });
    }
  }

  async listMacros(req, res) {
    const macros = await prisma.chatMacro.findMany({ orderBy: { shortcut: 'asc' } });
    return res.json({ macros });
  }

  async createMacro(req, res) {
    try {
      const { shortcut, content, category = 'geral' } = req.body;
      const macro = await prisma.chatMacro.create({
        data: {
          shortcut: shortcut.toLowerCase().replace(/\s/g, '-'),
          content,
          category: sanitizeString(category, 32) || 'geral',
        },
      });
      return res.status(201).json(macro);
    } catch (err) {
      return res.status(400).json({ error: 'Atalho já existe ou dados inválidos' });
    }
  }

  async deleteMacro(req, res) {
    try {
      await prisma.chatMacro.delete({ where: { id: req.params.id } });
      return res.json({ success: true });
    } catch (err) {
      return res.status(400).json({ error: 'Erro ao deletar macro' });
    }
  }

  async updateMacro(req, res) {
    try {
      const { id } = req.params;
      const { shortcut, content, category } = req.body;
      const data = {
        shortcut: shortcut.toLowerCase().replace(/\s/g, '-'),
        content,
      };
      if (category !== undefined) data.category = sanitizeString(category, 32) || 'geral';
      const macro = await prisma.chatMacro.update({ where: { id }, data });
      return res.json(macro);
    } catch (err) {
      return res.status(400).json({ error: 'Erro ao atualizar macro' });
    }
  }

  async listLabels(req, res) {
    const labels = await prisma.chatLabel.findMany({
      orderBy: { name: 'asc' },
      include: { references: true },
    });
    return res.json({ labels });
  }

  async createLabel(req, res) {
    try {
      const { name, color, references } = req.body;

      if (Array.isArray(references) && references.length) {
        for (const ref of references) {
          if (ref.type === 'PRODUCT') {
            const product = await prisma.product.findUnique({ where: { id: ref.referenceId }, select: { id: true } });
            if (!product) return res.status(400).json({ error: `Produto não encontrado: ${ref.referenceId}` });
          } else if (ref.type === 'CATEGORY') {
            const category = await prisma.category.findUnique({ where: { id: ref.referenceId }, select: { id: true } });
            if (!category) return res.status(400).json({ error: `Categoria não encontrada: ${ref.referenceId}` });
          } else if (ref.type === 'VARIANT') {
            const variant = await prisma.productVariant.findUnique({ where: { id: ref.referenceId }, select: { id: true } });
            if (!variant) return res.status(400).json({ error: `Variante não encontrada: ${ref.referenceId}` });
          }
        }
      }

      const label = await prisma.chatLabel.create({
        data: {
          name: sanitizeString(name, 64),
          color: color || '#3b82f6',
          references: references?.length
            ? {
                create: references.map((ref) => ({
                  type: ref.type,
                  referenceId: ref.referenceId,
                })),
              }
            : undefined,
        },
        include: { references: true },
      });
      return res.status(201).json(label);
    } catch (err) {
      return res.status(400).json({ error: 'Erro ao criar etiqueta' });
    }
  }

  async updateLabel(req, res) {
    try {
      const { id } = req.params;
      const { name, color, references } = req.body;

      const data = {};
      if (name !== undefined) data.name = sanitizeString(name, 64);
      if (color !== undefined) data.color = color;

      if (references !== undefined) {
        if (Array.isArray(references) && references.length) {
          for (const ref of references) {
            if (ref.type === 'PRODUCT') {
              const product = await prisma.product.findUnique({ where: { id: ref.referenceId }, select: { id: true } });
              if (!product) return res.status(400).json({ error: `Produto não encontrado: ${ref.referenceId}` });
            } else if (ref.type === 'CATEGORY') {
              const category = await prisma.category.findUnique({ where: { id: ref.referenceId }, select: { id: true } });
              if (!category) return res.status(400).json({ error: `Categoria não encontrada: ${ref.referenceId}` });
            } else if (ref.type === 'VARIANT') {
              const variant = await prisma.productVariant.findUnique({ where: { id: ref.referenceId }, select: { id: true } });
              if (!variant) return res.status(400).json({ error: `Variante não encontrada: ${ref.referenceId}` });
            }
          }
        }

        await prisma.chatLabelReference.deleteMany({ where: { labelId: id } });
        if (references.length) {
          data.references = {
            create: references.map((ref) => ({
              type: ref.type,
              referenceId: ref.referenceId,
            })),
          };
        }
      }

      const label = await prisma.chatLabel.update({
        where: { id },
        data,
        include: { references: true },
      });
      return res.json(label);
    } catch (err) {
      return res.status(400).json({ error: 'Erro ao atualizar etiqueta' });
    }
  }

  async deleteLabel(req, res) {
    try {
      await prisma.chatLabel.delete({ where: { id: req.params.id } });
      return res.json({ success: true });
    } catch (err) {
      return res.status(400).json({ error: 'Erro ao deletar etiqueta' });
    }
  }

  async getChatById(req, res) {
    try {
      if (!req.user.isAdmin) return res.status(403).json({ error: 'Acesso negado' });
      const { chatId } = req.params;
      const chat = await prisma.chat.findUnique({
        where: { id: chatId },
        include: {
          messages: { orderBy: { createdAt: 'asc' } },
          labels: true,
          assignedTo: { select: { id: true, name: true, email: true, image: true } },
          order: { include: ORDER_INCLUDE },
        },
      });
      if (!chat) return res.status(404).json({ error: 'Chat não encontrado' });

      const userStats = await prisma.order.aggregate({
        where: { userId: chat.order.userId, status: { in: ['PAID', 'DELIVERED'] } },
        _sum: { total: true },
        _count: { id: true },
      });
      const itemsCount = await prisma.orderItem.aggregate({
        where: { order: { userId: chat.order.userId, status: { in: ['PAID', 'DELIVERED'] } } },
        _sum: { quantity: true },
      });

      return res.json({
        ...chat,
        messages: signChatMessageFileUrls(chat.messages, req),
        userStats: {
          totalSpent: userStats._sum.total || 0,
          ordersCount: userStats._count.id || 0,
          itemsCount: itemsCount._sum.quantity || 0,
        },
      });
    } catch (err) {
      console.error('[ChatController.getChatById]', err);
      return res.status(500).json({ error: 'Erro ao buscar chat' });
    }
  }

  async submitClientRating(req, res) {
    try {
      const { chatId } = req.params;
      const { rating, ratingComment, ratingTags, isAnonymous } = req.body;

      const chat = await prisma.chat.findUnique({
        where: { id: chatId },
        include: { order: { select: { userId: true } } },
      });
      if (!chat) return res.status(404).json({ error: 'Chat não encontrado' });
      if (chat.order.userId !== req.user.id) return res.status(403).json({ error: 'Acesso negado' });
      if (chat.rating) return res.status(400).json({ error: 'Avaliação já enviada' });
      if (!['CLOSED', 'ARCHIVED', 'OPEN'].includes(chat.status)) {
        return res.status(400).json({ error: 'Chat não disponível para avaliação' });
      }

      const stars = Number(rating);
      if (!stars || stars < 1 || stars > 5) {
        return res.status(400).json({ error: 'Avaliação inválida' });
      }

      const reviewsSettings = await getReviewsSettings(prisma);
      const reviewStatus = reviewsSettings.autoPublish ? 'PUBLISHED' : 'PENDING';

      const updated = await prisma.chat.update({
        where: { id: chatId },
        data: {
          rating: stars,
          ratingComment: ratingComment ? sanitizeString(ratingComment, 256) : null,
          ratingTags: Array.isArray(ratingTags) ? ratingTags.slice(0, 10) : null,
          isAnonymousRating: Boolean(isAnonymous),
          reviewStatus,
          status: 'CLOSED',
        },
      });

      socketService.emitToChat(chatId, 'chat_updated', updated);
      socketService.emitToAdmins('chat_list_update', { chatId });

      return res.json(updated);
    } catch (err) {
      console.error('[ChatController.submitClientRating]', err);
      return res.status(400).json({ error: err.message || 'Erro ao enviar avaliação' });
    }
  }

  async reopenChat(req, res) {
    try {
      const { chatId } = req.params;
      const chat = await prisma.chat.findUnique({
        where: { id: chatId },
        include: { order: { select: { userId: true } } },
      });
      if (!chat) return res.status(404).json({ error: 'Chat não encontrado' });
      if (chat.order.userId !== req.user.id) return res.status(403).json({ error: 'Acesso negado' });
      if (chat.status !== 'CLOSED') {
        return res.status(400).json({ error: 'Chat já está aberto' });
      }

      await prisma.chat.update({
        where: { id: chatId },
        data: { status: 'OPEN', isResolved: false, updatedAt: new Date() },
      });

      const reopenMessage = await prisma.chatMessage.create({
        data: {
          chatId,
          senderId: 'SYSTEM',
          content: 'O cliente reabriu o chat de atendimento.',
          type: 'AUTOMATED',
        },
      });

      const customer = await prisma.user.findUnique({
        where: { id: chat.order.userId },
        select: { name: true, email: true },
      });
      const customerName = customer?.name || customer?.email || 'Cliente';

      const unreadCount = await syncUnreadCount(chatId);

      socketService.broadcastNewMessage(chatId, chat.order.userId, reopenMessage, false, {
        orderId: chat.orderId,
        type: 'reopened',
        customerName,
        unreadCount,
      });

      const fullChat = await emitFullChatUpdate(chatId, { skipListUpdate: true });
      return res.json(fullChat);
    } catch (err) {
      console.error('[ChatController.reopenChat]', err);
      return res.status(400).json({ error: 'Erro ao reabrir chat' });
    }
  }

  async assignChat(req, res) {
    try {
      if (!req.user.isAdmin) return res.status(403).json({ error: 'Acesso negado' });
      const { chatId } = req.params;
      const { assignedToId } = req.body;

      const chat = await prisma.chat.update({
        where: { id: chatId },
        data: { assignedToId: assignedToId || null },
        include: {
          assignedTo: { select: { id: true, name: true, email: true, image: true } },
        },
      });

      socketService.emitToChat(chatId, 'chat_updated', chat);
      socketService.emitToAdmins('chat_list_update', { chatId });

      return res.json(chat);
    } catch (err) {
      return res.status(400).json({ error: 'Erro ao atribuir chat' });
    }
  }

  async listClients(req, res) {
    try {
      if (!req.user.isAdmin) return res.status(403).json({ error: 'Acesso negado' });
      const { search, page = 1 } = req.query;
      const pageSize = 20;
      const skip = (Number(page) - 1) * pageSize;

      const where = {};
      if (search) {
        where.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ];
      }

      const [users, total] = await Promise.all([
        prisma.user.findMany({
          where,
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
            createdAt: true,
            lastAccessAt: true,
            isAdmin: true,
            roleId: true,
            role: { select: { id: true, name: true } },
            orders: {
              where: { status: { in: ['PAID', 'DELIVERED'] } },
              select: { id: true, total: true, status: true, createdAt: true },
              orderBy: { createdAt: 'desc' },
              take: 5,
            },
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take: pageSize,
        }),
        prisma.user.count({ where }),
      ]);

      const clients = await Promise.all(
        users.map(async (u) => {
          const [stats, itemsStats, discountStats] = await Promise.all([
            prisma.order.aggregate({
              where: { userId: u.id, status: { in: ['PAID', 'DELIVERED'] } },
              _sum: { total: true },
              _count: { id: true },
            }),
            prisma.orderItem.aggregate({
              where: { order: { userId: u.id, status: { in: ['PAID', 'DELIVERED'] } } },
              _sum: { quantity: true },
            }),
            prisma.order.aggregate({
              where: { userId: u.id, status: { in: ['PAID', 'DELIVERED'] } },
              _sum: { discount: true },
            }),
          ]);
          return {
            id: u.id,
            name: u.name,
            email: u.email,
            image: u.image,
            createdAt: u.createdAt,
            lastAccessAt: u.lastAccessAt,
            isAdmin: u.isAdmin,
            roleId: u.roleId,
            role: u.role,
            recentOrders: u.orders,
            ordersCount: stats._count.id,
            totalSpent: stats._sum.total || 0,
            totalItemsCount: itemsStats._sum.quantity || 0,
            totalDiscounts: discountStats._sum.discount || 0,
          };
        })
      );

      return res.json({ clients, total, page: Number(page), totalPages: Math.ceil(total / pageSize) });
    } catch (err) {
      console.error('[ChatController.listClients]', err);
      return res.status(500).json({ error: 'Erro ao listar clientes' });
    }
  }

  async listChatReviews(req, res) {
    try {
      if (!req.user.isAdmin) return res.status(403).json({ error: 'Acesso negado' });
      const { page = 1, minRating, status, search } = req.query;
      const pageSize = 20;
      const skip = (Number(page) - 1) * pageSize;

      const where = { rating: { not: null } };
      if (minRating) where.rating = { gte: Number(minRating) };
      if (status && status !== 'ALL') where.reviewStatus = status;
      if (search) {
        where.OR = [
          { ratingComment: { contains: search, mode: 'insensitive' } },
          { order: { user: { email: { contains: search, mode: 'insensitive' } } } },
          { order: { user: { name: { contains: search, mode: 'insensitive' } } } },
        ];
      }

      const [reviews, total, avgResult] = await Promise.all([
        prisma.chat.findMany({
          where,
          include: {
            order: {
              include: {
                user: { select: { id: true, name: true, email: true, image: true } },
                items: {
                  include: {
                    product: {
                      select: { id: true, name: true, imageUrl: true, price: true, slug: true },
                    },
                  },
                },
              },
            },
          },
          orderBy: { updatedAt: 'desc' },
          skip,
          take: pageSize,
        }),
        prisma.chat.count({ where }),
        prisma.chat.aggregate({ where: { rating: { not: null } }, _avg: { rating: true } }),
      ]);

      return res.json({
        reviews,
        total,
        page: Number(page),
        totalPages: Math.ceil(total / pageSize),
        averageRating: avgResult._avg.rating || 0,
      });
    } catch (err) {
      console.error('[ChatController.listChatReviews]', err);
      return res.status(500).json({ error: 'Erro ao listar avaliações' });
    }
  }

  async updateChatReview(req, res) {
    try {
      if (!req.user.isAdmin) return res.status(403).json({ error: 'Acesso negado' });
      const { chatId } = req.params;
      const { reviewStatus, sellerResponse } = req.body;

      const chat = await prisma.chat.findUnique({ where: { id: chatId } });
      if (!chat || chat.rating == null) {
        return res.status(404).json({ error: 'Avaliação não encontrada' });
      }

      const data = {};
      if (reviewStatus !== undefined) {
        const allowed = ['PENDING', 'PUBLISHED', 'ARCHIVED'];
        if (!allowed.includes(reviewStatus)) {
          return res.status(400).json({ error: 'Status inválido' });
        }
        data.reviewStatus = reviewStatus;
      }
      if (sellerResponse !== undefined) {
        data.sellerResponse = sellerResponse ? sanitizeString(sellerResponse, 2000) : null;
      }

      const updated = await prisma.chat.update({
        where: { id: chatId },
        data,
        include: {
          order: {
            include: {
              user: { select: { id: true, name: true, email: true, image: true } },
              items: {
                include: {
                  product: {
                    select: { id: true, name: true, imageUrl: true, price: true, slug: true },
                  },
                },
              },
            },
          },
        },
      });

      return res.json(updated);
    } catch (err) {
      console.error('[ChatController.updateChatReview]', err);
      return res.status(500).json({ error: 'Erro ao atualizar avaliação' });
    }
  }

  async deleteChatReview(req, res) {
    try {
      if (!req.user.isAdmin) return res.status(403).json({ error: 'Acesso negado' });
      const { chatId } = req.params;

      const updated = await prisma.chat.update({
        where: { id: chatId },
        data: {
          rating: null,
          ratingComment: null,
          ratingTags: null,
          isAnonymousRating: false,
          reviewStatus: null,
          sellerResponse: null,
        },
      });

      return res.json(updated);
    } catch (err) {
      console.error('[ChatController.deleteChatReview]', err);
      return res.status(500).json({ error: 'Erro ao excluir avaliação' });
    }
  }

  async listPublishedStoreReviews(req, res) {
    try {
      const productSlug = String(req.query.productSlug || '').trim();
      const productIdParam = String(req.query.productId || '').trim();
      const page = Math.max(1, Number(req.query.page) || 1);
      const limit = Math.min(50, Math.max(1, Number(req.query.limit) || (productSlug || productIdParam ? 10 : 30)));
      const skip = (page - 1) * limit;

      let productId = productIdParam || null;
      if (!productId && productSlug) {
        const product = await prisma.product.findUnique({
          where: { slug: productSlug },
          select: { id: true },
        });
        if (!product) {
          return res.json({
            reviews: [],
            summary: { averageRating: 0, total: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } },
            pagination: { page, limit, total: 0, totalPages: 1 },
          });
        }
        productId = product.id;
      }

      const where = {
        rating: { not: null },
        reviewStatus: 'PUBLISHED',
        ...(productId
          ? {
            order: {
              items: {
                some: { productId },
              },
            },
          }
          : {}),
      };

      const include = {
        order: {
          include: {
            user: { select: { id: true, name: true, email: true, image: true } },
            items: {
              include: {
                product: {
                  select: { id: true, name: true, imageUrl: true, price: true, slug: true },
                },
                variant: { select: { id: true, name: true } },
              },
            },
          },
        },
      };

      const [total, reviews, allRatings] = await Promise.all([
        prisma.chat.count({ where }),
        prisma.chat.findMany({
          where,
          include,
          orderBy: { updatedAt: 'desc' },
          skip,
          take: limit,
        }),
        prisma.chat.findMany({
          where,
          select: { rating: true },
        }),
      ]);

      const mapReview = (review) => {
        const items = review.order?.items ?? [];
        const matchedItem = productId
          ? items.find((item) => item.productId === productId)
          : items[0];
        const product = matchedItem?.product ?? items[0]?.product;
        const variantName = matchedItem?.variantName || matchedItem?.variant?.name || null;
        const customer = review.isAnonymousRating
          ? 'Cliente verificado'
          : (review.order?.user?.name || review.order?.user?.email || 'Cliente');

        return {
          id: review.id,
          name: customer,
          avatarUrl: review.isAnonymousRating ? null : review.order?.user?.image || null,
          rating: review.rating,
          comment: review.ratingComment || '',
          tags: Array.isArray(review.ratingTags) ? review.ratingTags : [],
          sellerResponse: review.sellerResponse,
          dateLabel: review.updatedAt,
          variantName,
          product: product
            ? {
              id: product.id,
              name: product.name,
              imageUrl: product.imageUrl,
              price: Number(product.price),
              slug: product.slug,
            }
            : null,
        };
      };

      const payload = reviews.map(mapReview);

      const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      let sum = 0;
      for (const row of allRatings) {
        const rating = Math.min(5, Math.max(1, Number(row.rating) || 0));
        sum += rating;
        distribution[rating] += 1;
      }
      const summary = {
        averageRating: total ? Math.round((sum / total) * 100) / 100 : 0,
        total,
        distribution,
      };

      const response = {
        reviews: payload,
        summary,
        ...(productId
          ? {
            pagination: {
              page,
              limit,
              total,
              totalPages: Math.max(1, Math.ceil(total / limit)),
            },
          }
          : {}),
      };

      return res.json(response);
    } catch (err) {
      console.error('[ChatController.listPublishedStoreReviews]', err);
      return res.status(500).json({ error: 'Erro ao listar avaliações' });
    }
  }
}

module.exports = new ChatController();
