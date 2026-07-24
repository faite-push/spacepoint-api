#!/usr/bin/env node
/**
 * Entry point Square Cloud: TLS → db push → API
 * Comando: npm start
 */
const { spawnSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
process.chdir(root);

const { applyDatabaseSsl, sanitizeUrlForLog } = require('../src/config/databaseSsl');
const applied = applyDatabaseSsl();

if (!process.env.DATABASE_URL) {
  console.error('[start-square] DATABASE_URL não definida');
  process.exit(1);
}

console.log(`[start-square] DB ${sanitizeUrlForLog(process.env.DATABASE_URL)} (tls=${applied.mode})`);

const shouldPush = String(process.env.PRISMA_PUSH_ON_START || 'true').toLowerCase() !== 'false';
const shouldSeed = String(process.env.PRISMA_SEED_ON_START || 'false').toLowerCase() === 'true';

function runPrisma(args) {
  // Garante que o Prisma CLI herde a URL já com SSL (não sobrescreve se já setada)
  const env = { ...process.env, DATABASE_URL: process.env.DATABASE_URL };
  const result = spawnSync('npx', ['prisma', ...args], {
    stdio: 'inherit',
    env,
    shell: true,
    cwd: root,
  });
  if (result.status !== 0) {
    console.error(`[start-square] prisma ${args.join(' ')} falhou (exit ${result.status})`);
    console.error('[start-square] Confira senha do DB, nome /squarecloud e certificado (.p12/PEM) nas envs da Square.');
    process.exit(result.status == null ? 1 : result.status);
  }
}

if (shouldPush) {
  console.log('[start-square] prisma db push...');
  runPrisma(['db', 'push', '--skip-generate']);
}

if (shouldSeed) {
  console.log('[start-square] prisma db seed...');
  runPrisma(['db', 'seed']);
}

console.log('[start-square] iniciando API...');
require('../index.js');
