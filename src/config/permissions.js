/** Ordem alinhada à sidebar admin (system fica no topo do editor de cargos). */
const ALL_PERMISSIONS = [
  { key: 'system:admin', name: 'Administrator', category: 'system' },

  { key: 'analytics:view', name: 'Ver Dashboard', category: 'analytics' },

  { key: 'products:view', name: 'Ver Produtos', category: 'products' },
  { key: 'products:create', name: 'Criar Produtos', category: 'products' },
  { key: 'products:edit', name: 'Editar Produtos', category: 'products' },
  { key: 'products:delete', name: 'Excluir Produtos', category: 'products' },

  { key: 'codes:view', name: 'Ver Códigos', category: 'codes' },
  { key: 'codes:upload', name: 'Upload de Códigos', category: 'codes' },
  { key: 'codes:delete', name: 'Excluir Códigos', category: 'codes' },

  { key: 'orders:view', name: 'Ver Pedidos', category: 'orders' },
  { key: 'orders:manage', name: 'Gerenciar Pedidos', category: 'orders' },
  { key: 'orders:refund', name: 'Reembolsar Pedidos', category: 'orders' },

  { key: 'coupons:view', name: 'Ver Cupons', category: 'coupons' },
  { key: 'coupons:manage', name: 'Gerenciar Cupons', category: 'coupons' },

  { key: 'media:view', name: 'Ver Galeria', category: 'media' },
  { key: 'media:manage', name: 'Gerenciar Galeria', category: 'media' },

  { key: 'clients:view', name: 'Ver Clientes', category: 'clients' },

  { key: 'reviews:view', name: 'Ver Avaliações', category: 'reviews' },
  { key: 'reviews:manage', name: 'Moderar Avaliações', category: 'reviews' },

  { key: 'audit:view', name: 'Ver Auditoria', category: 'audit' },

  { key: 'chats:view', name: 'Ver Space Chat', category: 'chats' },
  { key: 'chats:manage', name: 'Gerenciar Space Chat', category: 'chats' },

  { key: 'plugins:manage', name: 'Gerenciar Plugins', category: 'plugins' },

  { key: 'users:view', name: 'Ver Equipe', category: 'users' },
  { key: 'users:edit', name: 'Editar Usuários', category: 'users' },
  { key: 'users:ban', name: 'Banir/Desbanir Usuários', category: 'users' },

  { key: 'roles:view', name: 'Ver Cargos', category: 'roles' },
  { key: 'roles:manage', name: 'Gerenciar Cargos', category: 'roles' },

  { key: 'gateways:manage', name: 'Gerenciar Gateways', category: 'gateways' },

  { key: 'pages:manage', name: 'Gerenciar Páginas do Site', category: 'pages' },
  { key: 'settings:manage', name: 'Gerenciar Configurações', category: 'settings' },
];

/** Categorias na ordem da sidebar admin. */
const PERMISSION_CATEGORY_ORDER = [
  'system',
  'analytics',
  'products',
  'codes',
  'orders',
  'coupons',
  'media',
  'clients',
  'reviews',
  'audit',
  'chats',
  'plugins',
  'users',
  'roles',
  'gateways',
  'pages',
  'settings',
];

const FULL_ACCESS_PERMISSION = 'system:admin';

const ADMIN_ROLE_PERMISSIONS = [
  FULL_ACCESS_PERMISSION,
  'products:view', 'products:create', 'products:edit', 'products:delete',
  'codes:view', 'codes:upload', 'codes:delete',
  'orders:view', 'orders:manage', 'orders:refund',
  'coupons:view', 'coupons:manage',
  'chats:view', 'chats:manage',
  'clients:view',
  'reviews:view', 'reviews:manage',
  'media:view', 'media:manage',
  'users:view', 'users:edit',
  'roles:view',
  'pages:manage', 'gateways:manage', 'plugins:manage', 'settings:manage',
  'analytics:view', 'audit:view',
];

const MODERATOR_ROLE_PERMISSIONS = [
  'products:view', 'codes:view',
  'orders:view', 'orders:manage',
  'coupons:view',
  'chats:view', 'chats:manage',
  'clients:view',
  'reviews:view',
  'users:view',
  'analytics:view',
];

function roleHasFullAccess(permissionKeys = []) {
  return permissionKeys.includes(FULL_ACCESS_PERMISSION);
}

function groupPermissions(permissions = ALL_PERMISSIONS) {
  const grouped = {};
  for (const category of PERMISSION_CATEGORY_ORDER) {
    grouped[category] = [];
  }
  for (const perm of permissions) {
    if (!grouped[perm.category]) grouped[perm.category] = [];
    grouped[perm.category].push(perm);
  }
  // Remove categorias vazias preservando ordem
  const ordered = {};
  for (const category of PERMISSION_CATEGORY_ORDER) {
    if (grouped[category]?.length) ordered[category] = grouped[category];
  }
  for (const [category, perms] of Object.entries(grouped)) {
    if (!ordered[category] && perms.length) ordered[category] = perms;
  }
  return ordered;
}

module.exports = {
  ALL_PERMISSIONS,
  PERMISSION_CATEGORY_ORDER,
  FULL_ACCESS_PERMISSION,
  ADMIN_ROLE_PERMISSIONS,
  MODERATOR_ROLE_PERMISSIONS,
  roleHasFullAccess,
  groupPermissions,
};
