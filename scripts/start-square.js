#!/usr/bin/env node
/**
 * Entry point para Square Cloud:
 * 1) aplica TLS na DATABASE_URL
 * 2) sincroniza schema (db push) se PRISMA_PUSH_ON_START !== "false"
 * 3) inicia a API
 *
 * Comando na Square: node scripts/start-square.js
 * (ou npm start, que aponta para este arquivo)
 */
const { spawnSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
process.chdir(root);

require('../src/config/databaseSsl');

const shouldPush = String(process.env.PRISMA_PUSH_ON_START || 'true').toLowerCase() !== 'false';
const shouldSeed = String(process.env.PRISMA_SEED_ON_START || 'false').toLowerCase() === 'true';

function runPrisma(args) {
  const result = spawnSync('npx', ['prisma', ...args], {
    stdio: 'inherit',
    env: process.env,
    shell: true,
    cwd: root,
  });
  if (result.status !== 0) {
    console.error(`[start-square] prisma ${args.join(' ')} falhou (exit ${result.status})`);
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
