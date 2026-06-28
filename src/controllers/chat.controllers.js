const { prisma } = require('../config/prisma');
const { sanitizeString } = require('../utils/sanitize');
const { initializeChatForPaidOrder } = require('../services/chat.service');
const { randomBytes } = require('crypto');

const ORDER_INCLUDE = {
  user: { select: { name: true, email: true, image: true } },
  payments: {
    where: { status: 'PAID' },
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: { id: true, externalId: true, provider: true, createdAt: true },
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

class ChatController {
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
        include: { order: { select: { userId: true } } },
      });

      if (!chat) return res.status(404).json({ error: 'Chat não encontrado' });

      if (!req.user.isAdmin && chat.order.userId !== senderId) {
        return res.status(403).json({ error: 'Acesso negado' });
      }

      const message = await prisma.chatMessage.create({
        data: {
          chatId,
          senderId: req.user.isAdmin ? 'ADMIN' : senderId,
          content: sanitizeString(content || '', 4000),
          type,
          fileUrl,
        },
      });

      await prisma.chat.update({
        where: { id: chatId },
        data: { updatedAt: new Date() },
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
      if (status && status !== 'ALL') where.status = status;
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
                user: { select: { name: true, email: true, image: true } },
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
          const unreadCount = await prisma.chatMessage.count({ where: unreadWhere });
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

      return res.json(chat);
    } catch (err) {
      console.error('[ChatController.updateChatLabels]', err);
      return res.status(400).json({ error: 'Erro ao atualizar etiquetas' });
    }
  }

  async updateChatStatus(req, res) {
    try {
      const { chatId } = req.params;
      const { status, rating, ratingComment, isResolved } = req.body;

      const data = {};
      if (status !== undefined) data.status = status;
      if (rating !== undefined) data.rating = rating ? Number(rating) : null;
      if (ratingComment !== undefined) {
        data.ratingComment = ratingComment ? sanitizeString(ratingComment, 1000) : null;
      }
      if (isResolved !== undefined) data.isResolved = Boolean(isResolved);

      const chat = await prisma.chat.update({
        where: { id: chatId },
        data,
      });

      return res.json(chat);
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
      });

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
      const { shortcut, content } = req.body;
      const macro = await prisma.chatMacro.create({
        data: {
          shortcut: shortcut.toLowerCase().replace(/\s/g, '-'),
          content,
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
      const { shortcut, content } = req.body;
      const macro = await prisma.chatMacro.update({
        where: { id },
        data: {
          shortcut: shortcut.toLowerCase().replace(/\s/g, '-'),
          content,
        },
      });
      return res.json(macro);
    } catch (err) {
      return res.status(400).json({ error: 'Erro ao atualizar macro' });
    }
  }

  async listLabels(req, res) {
    const labels = await prisma.chatLabel.findMany({ orderBy: { name: 'asc' } });
    return res.json({ labels });
  }

  async createLabel(req, res) {
    try {
      const { name, color } = req.body;
      const label = await prisma.chatLabel.create({
        data: { name, color },
      });
      return res.status(201).json(label);
    } catch (err) {
      return res.status(400).json({ error: 'Erro ao criar etiqueta' });
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
}

module.exports = new ChatController();
