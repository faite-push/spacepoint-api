const { prisma } = require('../config/prisma');
const { sanitizeString, sanitizeChatContent } = require('../utils/sanitize');
const { initializeChatForPaidOrder } = require('../services/chat.service');
const { randomBytes } = require('crypto');
const socketService = require('../services/websocket.service');

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
  socketService.emitToAdmins('chat_list_update', { chatId, ...extra });
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
          messages: { orderBy: { createdAt: 'asc' } },
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
                messages: { orderBy: { createdAt: 'asc' } },
                labels: true,
                order: { include: ORDER_INCLUDE },
              },
            });
          });
        } else {
          chat = await prisma.chat.create({
            data: { orderId: order.id },
            include: {
              messages: true,
              labels: true,
              order: { include: ORDER_INCLUDE },
            },
          });
        }
      }

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

      await prisma.$transaction(async (tx) => {
        for (const line of linesToDeliver) {
          let deliveryContent = line;

          if (deliveryType === 'automatic_lines' || useStock) {
            const reserved = await tx.productCode.findMany({
              where: { orderItemId: item.id, status: 'RESERVED' },
              take: 1,
              orderBy: { createdAt: 'asc' },
            });

            let codeToDeliver = reserved[0];

            if (!codeToDeliver) {
              const available = await tx.productCode.findMany({
                where: {
                  productId: item.productId,
                  variantId: item.variantId ?? null,
                  status: 'AVAILABLE',
                },
                take: 1,
                orderBy: { createdAt: 'asc' },
              });
              codeToDeliver = available[0];
            }

            if (!codeToDeliver) {
              throw new Error('Sem códigos disponíveis para entrega');
            }

            await tx.productCode.update({
              where: { id: codeToDeliver.id },
              data: {
                status: 'DELIVERED',
                deliveredAt: new Date(),
                orderItemId: item.id,
              },
            });

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

        const allItems = await tx.orderItem.findMany({
          where: { orderId: chat.orderId },
          include: { codes: { where: { status: 'DELIVERED' } } },
        });

        const allDelivered = allItems.every(
          (i) => i.codes.filter((c) => c.status === 'DELIVERED').length >= i.quantity
        );

        if (allDelivered) {
          await tx.order.update({
            where: { id: chat.orderId },
            data: { status: 'DELIVERED' },
          });

          await tx.chatMessage.create({
            data: {
              chatId: chat.id,
              senderId: 'SYSTEM',
              content: 'Seu pedido foi entregue com sucesso. Aproveite!',
              type: 'AUTOMATED',
            },
          });
        }
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

      const message = await prisma.chatMessage.create({
        data: {
          chatId,
          senderId: req.user.isAdmin ? 'ADMIN' : senderId,
          content: sanitizeChatContent(content || '', 4000),
          type,
          fileUrl,
        },
      });

      await prisma.chat.update({
        where: { id: chatId },
        data: { updatedAt: new Date() },
      });

      if (req.user.isAdmin) {
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

      const customerName = chat.order.user?.name || chat.order.user?.email || 'Cliente';
      socketService.broadcastNewMessage(chatId, chat.order.userId, message, req.user.isAdmin, {
        orderId: chat.orderId,
        customerName,
      });

      return res.status(201).json(message);
    } catch (err) {
      console.error('[ChatController.sendMessage]', err);
      return res.status(500).json({ error: 'Erro ao enviar mensagem' });
    }
  }

  async listChats(req, res) {
    try {
      const { search, status, labelId, page = 1, sortBy = 'activity' } = req.query;
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
      } else if (status && status !== 'ALL') {
        where.status = status;
      }
      if (labelId) {
        where.labels = { some: { id: labelId } };
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
            order: {
              include: {
                user: { select: { id: true, name: true, email: true, image: true } },
                items: {
                  include: {
                    product: { select: { name: true, imageUrl: true, deliveryType: true } },
                    variant: { select: { deliveryType: true } },
                    codes: { where: { status: 'DELIVERED' }, select: { id: true, code: true, status: true } },
                  },
                },
              },
            },
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

      const chatsWithUnread = await Promise.all(
        chats.map(async (chat) => {
          const unreadWhere = {
            chatId: chat.id,
            senderId: { notIn: ['ADMIN', 'SYSTEM'] },
          };
          if (chat.lastAdminReadAt) {
            unreadWhere.createdAt = { gt: chat.lastAdminReadAt };
          }
          let unreadCount = await prisma.chatMessage.count({ where: unreadWhere });

          // Nova compra: chat nunca aberto pelo admin conta como 1 não lido
          if (unreadCount === 0 && !chat.lastAdminReadAt) {
            const hasMessages = await prisma.chatMessage.findFirst({
              where: { chatId: chat.id },
              select: { id: true },
            });
            if (hasMessages) unreadCount = 1;
          }

          return { ...chat, unreadCount };
        })
      );

      return res.json({ chats: chatsWithUnread, total, page: Number(page), totalPages: Math.ceil(total / pageSize) });
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
        data: { lastAdminReadAt: new Date() },
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

      socketService.emitToChat(chatId, 'chat_updated', chat);
      socketService.emitToAdmins('chat_list_update', { chatId });

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

      const updated = await prisma.chat.update({
        where: { id: chatId },
        data: {
          rating: stars,
          ratingComment: ratingComment ? sanitizeString(ratingComment, 256) : null,
          ratingTags: Array.isArray(ratingTags) ? ratingTags.slice(0, 10) : null,
          isAnonymousRating: Boolean(isAnonymous),
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

      socketService.broadcastNewMessage(chatId, chat.order.userId, reopenMessage, false, {
        orderId: chat.orderId,
      });

      const fullChat = await emitFullChatUpdate(chatId, { type: 'reopened' });
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

  async togglePinMessage(req, res) {
    try {
      if (!req.user.isAdmin) return res.status(403).json({ error: 'Acesso negado' });
      const { chatId, messageId } = req.params;

      const message = await prisma.chatMessage.findFirst({
        where: { id: messageId, chatId },
      });
      if (!message) return res.status(404).json({ error: 'Mensagem não encontrada' });

      const updated = await prisma.chatMessage.update({
        where: { id: messageId },
        data: { isPinned: !message.isPinned },
      });

      socketService.emitToChat(chatId, 'message_pinned', { chatId, message: updated });

      return res.json(updated);
    } catch (err) {
      return res.status(400).json({ error: 'Erro ao fixar mensagem' });
    }
  }

  async listClients(req, res) {
    try {
      if (!req.user.isAdmin) return res.status(403).json({ error: 'Acesso negado' });
      const { search, page = 1 } = req.query;
      const pageSize = 20;
      const skip = (Number(page) - 1) * pageSize;

      const where = { orders: { some: { status: { in: ['PAID', 'DELIVERED'] } } } };
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
          const stats = await prisma.order.aggregate({
            where: { userId: u.id, status: { in: ['PAID', 'DELIVERED'] } },
            _sum: { total: true },
            _count: { id: true },
          });
          return {
            id: u.id,
            name: u.name,
            email: u.email,
            image: u.image,
            createdAt: u.createdAt,
            recentOrders: u.orders,
            ordersCount: stats._count.id,
            totalSpent: stats._sum.total || 0,
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
      const { page = 1, minRating } = req.query;
      const pageSize = 20;
      const skip = (Number(page) - 1) * pageSize;

      const where = { rating: { not: null } };
      if (minRating) where.rating = { gte: Number(minRating) };

      const [reviews, total, avgResult] = await Promise.all([
        prisma.chat.findMany({
          where,
          include: {
            order: {
              include: {
                user: { select: { id: true, name: true, email: true, image: true } },
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
}

module.exports = new ChatController();
