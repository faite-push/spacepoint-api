const { PrismaClient } = require('@prisma/client');

const basePrisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

/**
 * @param {string} userId
 */

const getRlsPrisma = (userId) => {
  return basePrisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          const [, result] = await basePrisma.$transaction([
            basePrisma.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`,
            query(args),
          ]);
          return result;
        },
      },
    },
  });
};

module.exports = { prisma: basePrisma, getRlsPrisma };