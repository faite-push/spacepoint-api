const { PrismaClient } = require('@prisma/client');
const { ALL_PERMISSIONS, ADMIN_ROLE_PERMISSIONS, MODERATOR_ROLE_PERMISSIONS, } = require('../src/config/permissions');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting seed...');

  console.log('📋 Seeding permissions...');

  for (const perm of ALL_PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key: perm.key },
      update: perm,
      create: perm,
    });
  }

  console.log(`✅ ${ALL_PERMISSIONS.length} permissions seeded`);

  console.log('👑 Creating Super Owner role...');

  const superOwnerRole = await prisma.role.upsert({
    where: { name: 'Dono Supremo' },
    update: {
      description: 'Acesso total ao sistema. Não pode ser removido ou alterado.',
      isProtected: true,
      permissions: {
        set: ALL_PERMISSIONS.map((p) => ({ key: p.key })),
      },
    },
    create: {
      name: 'Dono Supremo',
      description: 'Acesso total ao sistema. Não pode ser removido ou alterado.',
      isProtected: true,
      permissions: {
        connect: ALL_PERMISSIONS.map((p) => ({ key: p.key })),
      },
    },
    include: {
      permissions: true,
    },
  });

  console.log(`✅ Super Owner role created: ${superOwnerRole.id}`);
  console.log(`   Permissions: ${superOwnerRole.permissions.length}`);

  const superAdminEmail = process.env.SUPER_ADMIN_EMAIL;

  if (superAdminEmail) {
    console.log(`👤 Assigning Super Owner role to: ${superAdminEmail}`);

    const user = await prisma.user.findUnique({
      where: { email: superAdminEmail },
    });

    if (user) {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          isAdmin: true,
          roleId: superOwnerRole.id,
        },
      });
      console.log(`✅ Super Owner role assigned to existing user: ${user.id}`);
    } else {
      console.log(`⚠️  User with email ${superAdminEmail} not found`);
      console.log('   Create an account first, then run seed again');
    }
  } else {
    console.log('⚠️  SUPER_ADMIN_EMAIL not set in .env');
    console.log('   Set it to automatically assign Super Owner role to a user');
  }

  console.log('🎭 Creating default roles...');

  const adminRole = await prisma.role.upsert({
    where: { name: 'Administrador' },
    update: {
      permissions: {
        set: ADMIN_ROLE_PERMISSIONS.map((key) => ({ key })),
      },
    },
    create: {
      name: 'Administrador',
      description: 'Administrador com acesso a quase todas as funções',
      permissions: {
        connect: ADMIN_ROLE_PERMISSIONS.map((key) => ({ key })),
      },
    },
  });

  console.log(`✅ Administrador role created: ${adminRole.id}`);

  const moderatorRole = await prisma.role.upsert({
    where: { name: 'Moderador' },
    update: {
      permissions: {
        set: MODERATOR_ROLE_PERMISSIONS.map((key) => ({ key })),
      },
    },
    create: {
      name: 'Moderador',
      description: 'Acesso limitado para gerenciar pedidos, chat e visualizar produtos',
      permissions: {
        connect: MODERATOR_ROLE_PERMISSIONS.map((key) => ({ key })),
      },
    },
  });

  console.log(`✅ Moderador role created: ${moderatorRole.id}`);

  console.log('\n🎉 Seed completed!');
}

main().then(async () => {
  await prisma.$disconnect();
}).catch(async (e) => {
  console.error('❌ Seed failed:', e);
  await prisma.$disconnect();
  process.exit(1);
});