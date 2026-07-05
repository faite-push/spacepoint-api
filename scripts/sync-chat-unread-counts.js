/**
 * Sincroniza unreadCount de todos os chats (rodar uma vez após deploy).
 * Uso: node scripts/sync-chat-unread-counts.js
 */
const { PrismaClient } = require('@prisma/client');
const { syncUnreadCount } = require('../src/services/chatUnread.service');

const prisma = new PrismaClient();

async function main() {
  const chats = await prisma.chat.findMany({ select: { id: true } });
  console.log(`Sincronizando ${chats.length} chats...`);
  let done = 0;
  for (const { id } of chats) {
    await syncUnreadCount(id);
    done += 1;
    if (done % 50 === 0) console.log(`  ${done}/${chats.length}`);
  }
  console.log('Concluído.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
