const { prisma } = require('../config/prisma');
const { verifyToken } = require('../config/jwt');
const { verifyChatFileSignature, isChatCdnFilename } = require('./cdnSignedUrl');

async function resolveUserFromRequest(req) {
  const token = req.cookies?.access_token;
  if (!token) return null;

  try {
    const payload = verifyToken(token);
    return prisma.user.findUnique({
      where: { id: payload.id },
      select: { id: true, isAdmin: true },
    });
  } catch {
    return null;
  }
}

async function userCanAccessChatFile(user, filename) {
  if (!user?.id || !filename) return false;

  const message = await prisma.chatMessage.findFirst({
    where: {
      fileUrl: { contains: filename },
    },
    select: {
      chat: {
        select: {
          order: { select: { userId: true } },
        },
      },
    },
  });

  if (!message) return false;
  if (user.isAdmin) return true;
  return message.chat.order.userId === user.id;
}

async function canAccessChatCdnFile(req, filename) {
  if (!isChatCdnFilename(filename)) return true;

  const { exp, sig } = req.query || {};
  if (verifyChatFileSignature(filename, exp, sig)) return true;

  const user = await resolveUserFromRequest(req);
  if (!user) return false;

  return userCanAccessChatFile(user, filename);
}

module.exports = {
  canAccessChatCdnFile,
  resolveUserFromRequest,
  userCanAccessChatFile,
};
