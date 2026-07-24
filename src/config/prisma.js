// TLS SquareCloud / DATABASE_URL com certificado — antes do PrismaClient
require('./databaseSsl');

const { PrismaClient } = require('@prisma/client');
const {
  generateNumericId,
  generateOrderId,
  generateVariantId,
} = require('../utils/idGenerators');

const basePrisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

const prisma = basePrisma.$extends({
  query: {
    user: {
      async create({ args, query }) {
        if (!args.data.id) args.data.id = generateNumericId();
        return query(args);
      },
    },
    order: {
      async create({ args, query }) {
        if (!args.data.id) args.data.id = generateOrderId();
        return query(args);
      },
    },
    product: {
      async create({ args, query }) {
        if (!args.data.id) args.data.id = generateNumericId();
        return query(args);
      },
    },
    category: {
      async create({ args, query }) {
        if (!args.data.id) args.data.id = generateNumericId();
        return query(args);
      },
    },
    productVariant: {
      async create({ args, query }) {
        if (!args.data.id) {
          args.data.id = await generateVariantId(basePrisma);
        }
        return query(args);
      },
    },
  },
});

/**
 * @param {string} userId
 */
const getRlsPrisma = (userId) => {
  return prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          const [, result] = await prisma.$transaction([
            prisma.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`,
            query(args),
          ]);
          return result;
        },
      },
    },
  });
};

module.exports = { prisma, getRlsPrisma };
