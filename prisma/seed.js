const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// ─── Permissions List ───────────────────────────────────────────────────────

const ALL_PERMISSIONS = [
  // Products
  { key: 'products:view', name: 'Ver Produtos', category: 'products' },
  { key: 'products:create', name: 'Criar Produtos', category: 'products' },
  { key: 'products:edit', name: 'Editar Produtos', category: 'products' },
  { key: 'products:delete', name: 'Excluir Produtos', category: 'products' },
  // Codes
  { key: 'codes:view', name: 'Ver Códigos', category: 'codes' },
  { key: 'codes:upload', name: 'Upload de Códigos', category: 'codes' },
  { key: 'codes:delete', name: 'Excluir Códigos', category: 'codes' },
  // Orders
  { key: 'orders:view', name: 'Ver Pedidos', category: 'orders' },
  { key: 'orders:manage', name: 'Gerenciar Pedidos', category: 'orders' },
  { key: 'orders:refund', name: 'Reembolsar Pedidos', category: 'orders' },
  // Users
  { key: 'users:view', name: 'Ver Usuários', category: 'users' },
  { key: 'users:edit', name: 'Editar Usuários', category: 'users' },
  { key: 'users:ban', name: 'Banir/Desbanir Usuários', category: 'users' },
  // Roles
  { key: 'roles:view', name: 'Ver Cargos', category: 'roles' },
  { key: 'roles:manage', name: 'Gerenciar Cargos', category: 'roles' },
  // Settings
  { key: 'settings:manage', name: 'Gerenciar Configurações', category: 'settings' },
  // Analytics
  { key: 'analytics:view', name: 'Ver Analytics', category: 'analytics' },
  // Coupons
  { key: 'coupons:view', name: 'Ver Cupons', category: 'marketing' },
  { key: 'coupons:manage', name: 'Gerenciar Cupons', category: 'marketing' },
];

async function main() {
  console.log('🌱 Starting seed...');

  // ─── Seed Permissions ─────────────────────────────────────────────────────
  console.log('📋 Seeding permissions...');

  for (const perm of ALL_PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key: perm.key },
      update: perm,
      create: perm,
    });
  }

  console.log(`✅ ${ALL_PERMISSIONS.length} permissions seeded`);

  // ─── Seed Super Owner Role ────────────────────────────────────────────────
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

  // ─── Assign Super Owner to specified email ────────────────────────────────
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

  // ─── Seed default roles ─────────────────────────────────────────────────
  console.log('🎭 Creating default roles...');

  const adminRole = await prisma.role.upsert({
    where: { name: 'Administrador' },
    update: {},
    create: {
      name: 'Administrador',
      description: 'Administrador com acesso a quase todas as funções',
      permissions: {
        connect: [
          { key: 'products:view' },
          { key: 'products:create' },
          { key: 'products:edit' },
          { key: 'products:delete' },
          { key: 'codes:view' },
          { key: 'codes:upload' },
          { key: 'codes:delete' },
          { key: 'orders:view' },
          { key: 'orders:manage' },
          { key: 'orders:refund' },
          { key: 'users:view' },
          { key: 'users:edit' },
          { key: 'settings:manage' },
          { key: 'analytics:view' },
        ],
      },
    },
  });

  console.log(`✅ Administrador role created: ${adminRole.id}`);

  const moderatorRole = await prisma.role.upsert({
    where: { name: 'Moderador' },
    update: {},
    create: {
      name: 'Moderador',
      description: 'Acesso limitado para gerenciar pedidos e visualizar produtos',
      permissions: {
        connect: [
          { key: 'products:view' },
          { key: 'codes:view' },
          { key: 'orders:view' },
          { key: 'orders:manage' },
          { key: 'users:view' },
          { key: 'analytics:view' },
        ],
      },
    },
  });

  console.log(`✅ Moderador role created: ${moderatorRole.id}`);

  console.log('\n🎉 Seed completed!');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error('❌ Seed failed:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
