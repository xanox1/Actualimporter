import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

dotenv.config();

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const port = Number(process.env.APP_PORT || 3000);

app.use(cors());
app.use(express.json({ limit: '10mb' }));

function detectDelimiter(csvText) {
  const firstLine = (csvText || '').split(/\r?\n/, 1)[0] || '';
  const candidates = [';', ',', '\t'];
  let best = ';';
  let bestCount = -1;

  for (const candidate of candidates) {
    const count = firstLine.split(candidate).length;
    if (count > bestCount) {
      bestCount = count;
      best = candidate;
    }
  }

  return best;
}

function normalizeCellValue(value) {
  if (value === undefined || value === null) {
    return '';
  }

  return String(value).trim();
}

function parseAmount(rawValue) {
  const text = normalizeCellValue(rawValue);
  if (!text) {
    return null;
  }

  const normalized = text.replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function mapRows(rows, mapping) {
  const mapped = [];

  for (const row of rows) {
    const mappedRow = {};

    for (const [targetField, rule] of Object.entries(mapping || {})) {
      if (!rule) {
        mappedRow[targetField] = '';
        continue;
      }

      if (rule.type === 'merge') {
        const separator = rule.separator ?? ' ';
        const values = (rule.columns || [])
          .map((column) => normalizeCellValue(row[column]))
          .filter(Boolean);
        mappedRow[targetField] = values.join(separator);
      } else {
        mappedRow[targetField] = normalizeCellValue(row[rule.column]);
      }
    }

    mapped.push(mappedRow);
  }

  return mapped;
}

function groupRows(rows, groupByColumn) {
  if (!groupByColumn) {
    return { all: rows };
  }

  return rows.reduce((acc, row) => {
    const groupKey = normalizeCellValue(row[groupByColumn]) || '(leeg)';
    if (!acc[groupKey]) {
      acc[groupKey] = [];
    }
    acc[groupKey].push(row);
    return acc;
  }, {});
}

function extractAccountList(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (Array.isArray(payload?.accounts)) {
    return payload.accounts;
  }

  if (Array.isArray(payload?.data?.accounts)) {
    return payload.data.accounts;
  }

  return [];
}

function extractBudgetList(payload) {
  if (Array.isArray(payload?.budgets)) {
    return payload.budgets;
  }

  if (Array.isArray(payload?.data?.budgets)) {
    return payload.data.budgets;
  }

  return [];
}

function shapeAccount(account) {
  return {
    id: String(account.id ?? account.uuid ?? account.accountId ?? ''),
    name: String(account.name ?? account.accountName ?? 'Onbekende rekening'),
    raw: account
  };
}

function shapeBudget(budget) {
  return {
    id: String(budget.id ?? budget.uuid ?? budget.budgetId ?? ''),
    name: String(budget.name ?? budget.budgetName ?? 'Onbekend budget'),
    raw: budget
  };
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/api/csv/preview', upload.single('csv'), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'Geen CSV bestand geüpload (field: csv).' });
    return;
  }

  try {
    const csvText = req.file.buffer.toString('utf8');
    const delimiter = detectDelimiter(csvText);
    const records = parse(csvText, {
      columns: true,
      skip_empty_lines: true,
      delimiter,
      relax_column_count: true,
      bom: true,
      trim: true
    });

    const headers = records.length ? Object.keys(records[0]) : [];

    res.json({
      fileName: req.file.originalname,
      delimiter,
      headers,
      rowCount: records.length,
      rows: records.slice(0, 300)
    });
  } catch (error) {
    res.status(400).json({ error: `Kon CSV niet verwerken: ${error.message}` });
  }
});

app.post('/api/actual/accounts', async (req, res) => {
  const serverUrl = (req.body?.serverUrl || process.env.ACTUAL_SERVER_URL || '').trim();
  const password = req.body?.password || process.env.ACTUAL_PASSWORD || '';
  const budgetId = req.body?.budgetId || process.env.ACTUAL_BUDGET_ID || '';

  if (process.env.MOCK_ACTUAL === 'true') {
    res.json({
      accounts: [
        { id: 'acc-checking', name: 'Rabo Betaalrekening' },
        { id: 'acc-savings', name: 'Rabo Spaarrekening' }
      ]
    });
    return;
  }

  if (!serverUrl) {
    res.status(400).json({ error: 'ACTUAL_SERVER_URL ontbreekt.' });
    return;
  }

  try {
    const response = await fetch(`${serverUrl.replace(/\/$/, '')}/api/accounts`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        password,
        budgetId
      })
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Actual API fout (${response.status}): ${detail}`);
    }

    const payload = await response.json();
    const accounts = extractAccountList(payload).map(shapeAccount).filter((account) => account.id);

    res.json({ accounts });
  } catch (error) {
    res.status(502).json({
      error: 'Kon rekeningen niet ophalen bij Actual API.',
      details: error.message
    });
  }
});

app.post('/api/actual/budgets', async (req, res) => {
  const serverUrl = (req.body?.serverUrl || process.env.ACTUAL_SERVER_URL || '').trim();
  const password = req.body?.password || process.env.ACTUAL_PASSWORD || '';

  if (process.env.MOCK_ACTUAL === 'true') {
    res.json({
      budgets: [
        { id: 'budget-main', name: 'Main Budget' },
        { id: 'budget-personal', name: 'Personal Budget' }
      ]
    });
    return;
  }

  if (!serverUrl) {
    res.status(400).json({ error: 'ACTUAL_SERVER_URL ontbreekt.' });
    return;
  }

  try {
    const response = await fetch(`${serverUrl.replace(/\/$/, '')}/api/budgets`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({ password })
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Actual API fout (${response.status}): ${detail}`);
    }

    const payload = await response.json();
    const budgets = extractBudgetList(payload).map(shapeBudget).filter((budget) => budget.id);

    res.json({ budgets });
  } catch (error) {
    res.status(502).json({
      error: 'Kon budget IDs niet ophalen bij Actual API.',
      details: error.message
    });
  }
});

app.post('/api/import', async (req, res) => {
  const {
    rows,
    mapping,
    groupByColumn,
    accountMapping,
    dryRun = true,
    actualConfig
  } = req.body || {};

  if (!Array.isArray(rows) || !mapping) {
    res.status(400).json({ error: 'rows en mapping zijn verplicht.' });
    return;
  }

  const grouped = groupRows(rows, groupByColumn);
  const result = [];

  for (const [group, groupRowsData] of Object.entries(grouped)) {
    const accountId = accountMapping?.[group] || null;
    const mappedRows = mapRows(groupRowsData, mapping);

    const normalized = mappedRows.map((row) => ({
      date: row.date,
      payee: row.payee,
      notes: row.notes,
      amount: parseAmount(row.amount)
    }));

    const invalidCount = normalized.filter((row) => row.amount === null || !row.date).length;

    result.push({
      group,
      accountId,
      transactionCount: normalized.length,
      invalidCount,
      preview: normalized.slice(0, 5)
    });

    if (dryRun || process.env.MOCK_ACTUAL === 'true') {
      continue;
    }

    const serverUrl = (actualConfig?.serverUrl || process.env.ACTUAL_SERVER_URL || '').trim();
    const password = actualConfig?.password || process.env.ACTUAL_PASSWORD || '';
    const budgetId = actualConfig?.budgetId || process.env.ACTUAL_BUDGET_ID || '';

    if (!serverUrl) {
      res.status(400).json({ error: 'ACTUAL_SERVER_URL ontbreekt voor import.' });
      return;
    }

    if (!accountId) {
      res.status(400).json({ error: `Geen account gekoppeld voor groep '${group}'.` });
      return;
    }

    const response = await fetch(`${serverUrl.replace(/\/$/, '')}/api/import-transactions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        password,
        budgetId,
        accountId,
        transactions: normalized.filter((row) => row.amount !== null && row.date)
      })
    });

    if (!response.ok) {
      const detail = await response.text();
      res.status(502).json({
        error: `Import naar Actual mislukt voor groep '${group}'.`,
        details: detail
      });
      return;
    }
  }

  res.json({
    dryRun,
    groups: result,
    totalTransactions: result.reduce((sum, item) => sum + item.transactionCount, 0),
    totalInvalid: result.reduce((sum, item) => sum + item.invalidCount, 0)
  });
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendDist = path.resolve(__dirname, '../../frontend/dist');

if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) {
      next();
      return;
    }
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

app.listen(port, () => {
  console.log(`Actualimporter backend draait op poort ${port}`);
});