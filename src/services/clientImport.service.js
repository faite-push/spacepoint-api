const XLSX = require('xlsx');
const { prisma } = require('../config/prisma');
const { generateNumericId } = require('../utils/idGenerators');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

function stripDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return EMAIL_RE.test(email) ? email : null;
}

function normalizeName(value) {
  let name = String(value || '').trim().replace(/\s+/g, ' ');
  // Alguns exports vêm com telefone colado no nome: "27999958643 Carlos"
  name = name.replace(/^\d{10,13}\s+/, '').trim();
  return name.slice(0, 120) || null;
}

function parseBrDateTime(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;

  const raw = String(value).trim();
  // Excel serial date
  if (/^\d+(\.\d+)?$/.test(raw)) {
    const serial = Number(raw);
    if (Number.isFinite(serial) && serial > 20000) {
      const utc = Date.UTC(1899, 11, 30) + Math.round(serial * 86400000);
      const date = new Date(utc);
      return Number.isNaN(date.getTime()) ? null : date;
    }
  }

  // dd/MM/yyyy HH:mm or dd/MM/yyyy
  const match = raw.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
  );
  if (match) {
    const [, dd, mm, yyyy, hh = '0', min = '0', ss = '0'] = match;
    const date = new Date(
      Number(yyyy),
      Number(mm) - 1,
      Number(dd),
      Number(hh),
      Number(min),
      Number(ss)
    );
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const fallback = new Date(raw);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

function pick(row, keys) {
  for (const key of keys) {
    if (row[key] != null && String(row[key]).trim() !== '') return row[key];
  }
  // Case-insensitive fallback
  const map = Object.fromEntries(
    Object.entries(row).map(([k, v]) => [String(k).trim().toUpperCase(), v])
  );
  for (const key of keys) {
    const hit = map[String(key).trim().toUpperCase()];
    if (hit != null && String(hit).trim() !== '') return hit;
  }
  return null;
}

function parseWorkbookBuffer(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    const err = new Error('Planilha vazia');
    err.status = 400;
    throw err;
  }
  return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: null });
}

function mapClientRow(row, index) {
  const email = normalizeEmail(pick(row, ['CLIENTE_EMAIL', 'EMAIL', 'E-MAIL', 'email']));
  const name = normalizeName(pick(row, ['CLIENTE_NOME', 'NOME', 'NAME', 'name']));
  const document = stripDigits(pick(row, ['CPF_CNPJ', 'CPF', 'CNPJ', 'DOCUMENTO', 'document']));
  const phone = stripDigits(pick(row, [
    'CLIENTE_TELEFONE_CELULAR',
    'TELEFONE',
    'CELULAR',
    'PHONE',
    'phone',
  ]));
  const externalId = String(
    pick(row, ['CLIENTE_ID', 'ID', 'ID_CLIENTE', 'externalId']) || ''
  ).trim() || null;
  const createdAt = parseBrDateTime(
    pick(row, ['CLIENTE_DATA_CRIACAO', 'DATA_CRIACAO', 'CREATED_AT', 'createdAt'])
  );

  if (!email) {
    return {
      valid: false,
      row: index + 2,
      error: 'E-mail inválido ou ausente',
      raw: row,
    };
  }

  return {
    valid: true,
    row: index + 2,
    email,
    name,
    document: document || null,
    phone: phone || null,
    externalId,
    createdAt,
  };
}

/**
 * Importa clientes de planilha .xlsx/.csv no formato Loja Integrada.
 * Colunas esperadas: CLIENTE_ID, CLIENTE_NOME, CPF_CNPJ, CLIENTE_EMAIL,
 * CLIENTE_TELEFONE_CELULAR, CLIENTE_DATA_CRIACAO
 */
async function importClientsFromSpreadsheet(buffer, options = {}) {
  const dryRun = options.dryRun === true;
  const skipExisting = options.skipExisting !== false;
  const updateExisting = options.updateExisting === true;

  const rows = parseWorkbookBuffer(buffer);
  if (!rows.length) {
    const err = new Error('Nenhuma linha encontrada na planilha');
    err.status = 400;
    throw err;
  }

  const mapped = rows.map((row, index) => mapClientRow(row, index));
  const invalid = mapped.filter((r) => !r.valid);
  const valid = mapped.filter((r) => r.valid);

  // Deduplicar por e-mail (mantém a última ocorrência)
  const byEmail = new Map();
  for (const client of valid) {
    byEmail.set(client.email, client);
  }
  const uniqueClients = [...byEmail.values()];

  const emails = uniqueClients.map((c) => c.email);
  const existingUsers = emails.length
    ? await prisma.user.findMany({
      where: { email: { in: emails } },
      select: { id: true, email: true, name: true, phone: true, document: true },
    })
    : [];
  const existingByEmail = new Map(
    existingUsers.map((u) => [String(u.email || '').toLowerCase(), u])
  );

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const errors = [];
  const sample = uniqueClients.slice(0, 8).map((c) => ({
    email: c.email,
    name: c.name,
    document: c.document,
    phone: c.phone,
    externalId: c.externalId,
    createdAt: c.createdAt?.toISOString?.() || null,
    exists: existingByEmail.has(c.email),
  }));

  if (dryRun) {
    for (const client of uniqueClients) {
      if (existingByEmail.has(client.email)) {
        if (skipExisting && !updateExisting) skipped += 1;
        else updated += 1;
      } else {
        created += 1;
      }
    }

    return {
      dryRun: true,
      totalRows: rows.length,
      validRows: valid.length,
      uniqueEmails: uniqueClients.length,
      duplicateEmailsInFile: valid.length - uniqueClients.length,
      invalidRows: invalid.length,
      created,
      updated,
      skipped,
      errors: invalid.slice(0, 20).map((r) => ({ row: r.row, error: r.error })),
      sample,
    };
  }

  for (const client of uniqueClients) {
    try {
      const existing = existingByEmail.get(client.email);
      if (existing) {
        if (skipExisting && !updateExisting) {
          skipped += 1;
          continue;
        }

        await prisma.user.update({
          where: { id: existing.id },
          data: {
            ...(client.name ? { name: client.name } : {}),
            ...(client.phone ? { phone: client.phone } : {}),
            ...(client.document ? { document: client.document } : {}),
          },
        });
        updated += 1;
        continue;
      }

      await prisma.user.create({
        data: {
          id: generateNumericId(),
          email: client.email,
          name: client.name,
          phone: client.phone,
          document: client.document,
          provider: 'import',
          ...(client.createdAt ? { createdAt: client.createdAt } : {}),
        },
      });
      created += 1;
    } catch (err) {
      errors.push({
        email: client.email,
        error: err.message || 'Falha ao importar',
      });
    }
  }

  return {
    dryRun: false,
    totalRows: rows.length,
    validRows: valid.length,
    uniqueEmails: uniqueClients.length,
    duplicateEmailsInFile: valid.length - uniqueClients.length,
    invalidRows: invalid.length,
    created,
    updated,
    skipped,
    errors: [
      ...invalid.slice(0, 20).map((r) => ({ row: r.row, error: r.error })),
      ...errors.slice(0, 20),
    ],
    sample,
  };
}

module.exports = {
  importClientsFromSpreadsheet,
};
