#!/usr/bin/env node
/**
 * Roda comandos Prisma com TLS SquareCloud já aplicado na DATABASE_URL.
 * Uso: node scripts/prisma-with-ssl.js db push
 *      node scripts/prisma-with-ssl.js migrate deploy
 */
const path = require('path');
const fs = require('fs');

const root = path.join(__dirname, '..');
const envFile = path.join(root, '.env');
const envLocal = path.join(root, '.env.local');
require('dotenv').config({
  path: fs.existsSync(envFile) ? envFile : envLocal,
});

require('../src/config/databaseSsl');

const { spawnSync } = require('child_process');

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Uso: node scripts/prisma-with-ssl.js <comando prisma...>');
  console.error('Ex.: node scripts/prisma-with-ssl.js db push');
  process.exit(1);
}

const result = spawnSync('npx', ['prisma', ...args], {
  stdio: 'inherit',
  env: process.env,
  shell: true,
  cwd: root,
});

process.exit(result.status == null ? 1 : result.status);
