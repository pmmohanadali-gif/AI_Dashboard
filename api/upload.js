import { put, head } from '@vercel/blob';

export const config = { api: { bodyParser: false } };

// ── CSV PARSER ────────────────────────────────────────────────
function parseCSVLine(line) {
  const result = []; let cur = ''; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (inQ && line[i+1]==='"') { cur+='"'; i++; } else inQ=!inQ; }
    else if (ch === ',' && !inQ) { result.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  result.push(cur.trim());
  return result;
}

function parseCSV(text) {
  const lines = text.split('\n');
  const headers = parseCSVLine(lines[0]);
  return lines.slice(1)
    .filter(l => l.trim())
    .map(line => {
      const vals = parseCSVLine(line);
      const row = {};
      headers.forEach((h, i) => {
        let v = vals[i] ?? '';
        if (v === '' || v === 'nan' || v === 'NaN') v = null;
        row[h] = v;
      });
      return row;
    });
}

// ── PROCESS BATCH FILE ────────────────────────────────────────
function processBatch(rows) {
  const today = new Date(); today.setHours(0, 0, 0, 0);

  return rows
    .filter(r => {
      if (!r['Created At']) return false;
      return new Date(r['Created At']) < today;
    })
    .map(r => {
      let quickMode = null, filetype = null;
      try { quickMode = String(JSON.parse(r['Meta'] || '{}').quick_mode ?? ''); } catch {}
      try { const f = JSON.parse(r['Files'] || '[]'); filetype = f[0]?.filetype ?? null; } catch {}
      return {
        ...r,
        Cost:    r['Cost']   != null ? parseFloat(r['Cost'])   : null,
        Tokens:  r['Tokens'] != null ? parseFloat(r['Tokens']) : null,
        Environment: r['Environment'] || 'unknown',
        quick_mode: quickMode,
        filetype,
        date: r['Created At']?.substring(0, 10) ?? null,
      };
    });
}

// ── CATEGORISE ERRORS ─────────────────────────────────────────
function catError(e) {
  if (!e) return 'Other';
  const el = e.toLowerCase();
  if (el.includes('rate limit'))          return 'Rate Limit';
  if (el.includes('context window'))      return 'Context Window';
  if (el.startsWith('limit_invoice'))     return 'Too Many Invoices in File';
  if (el.startsWith('limit_expense'))     return 'Too Many Expenses in File';
  if (el.includes('insufficient'))        return 'Insufficient Coins';
  if (el.includes('invalid document') || el.includes('invalid input')) return 'Wrong Doc Type';
  if ((el.includes('supplier') || el.includes('address')) &&
      (el.includes('not present') || el.includes('not found') || el.includes('not legible')))
    return 'Unreadable Document';
  if (el.includes('undefined') || el.includes('exception') || el.includes('ifplugininstalled'))
    return 'Code Error';
  return 'Other';
}

function extractWDT(e) {
  const m = e?.match(/found:\s*(.+)$/i);
  if (m) return m[1].replace(/_/g, ' ').replace(/\(.*?\)/g, '').trim().toLowerCase();
  return null;
}

// ── PROCESS ACTION LOG ────────────────────────────────────────
function processAction(rows, batchRows) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const envMap = {};
  batchRows.forEach(r => { if (r.Environment !== 'unknown') envMap[r['Site ID']] = r.Environment; });

  const errors = [], overrides = [], batches = [];
  const firstTimers = {}, seenPi = new Set(), seenExp = new Set();

  // Sort batch rows for first-timer tracking
  const bSorted = [...batchRows].sort((a, b) => new Date(a['Created At']) - new Date(b['Created At']));
  bSorted.forEach(r => {
    const sid = r['Site ID'], dt = r.date, env = r.Environment, name = r['Business Name'] || String(sid);
    if (r.Type === 'Purchase Invoice' && !seenPi.has(sid)) {
      seenPi.add(sid);
      if (!firstTimers[dt]) firstTimers[dt] = { pi: [], exp: [] };
      firstTimers[dt].pi.push({ siteId: sid, name, env });
    }
    if (r.Type === 'Expense' && !seenExp.has(sid)) {
      seenExp.add(sid);
      if (!firstTimers[dt]) firstTimers[dt] = { pi: [], exp: [] };
      firstTimers[dt].exp.push({ siteId: sid, name, env });
    }
  });

  const overrideKeywords = ['Overridden', 'Add New Product', 'Delete Product'];

  rows
    .filter(r => r['Created At'] && new Date(r['Created At']) < today)
    .forEach(r => {
      const env  = envMap[r['Site ID']] || 'unknown';
      const date = r['Created At']?.substring(0, 10) ?? null;
      const action = r['Action'];
      let data = {};
      try { data = JSON.parse(r['Data'] || '{}'); } catch {}

      if (action === 'Processing AI Batch Item Failed AI' || action === 'Processing AI Batch Item Failed Exception') {
        const errs = data.errors || (data.error ? [data.error] : []);
        errs.forEach(err => {
          const cat = catError(err);
          errors.push({ site_id: r['Site ID'], error: err, category: cat,
            wrong_doc_type: cat === 'Wrong Doc Type' ? extractWDT(err) : null,
            feature_type: null, environment: env, date });
        });
      }

      if (overrideKeywords.some(k => action.includes(k))) {
        let ot = 'Product Override';
        if (action.includes('Supplier')) ot = 'Supplier Override';
        else if (action.includes('Tax'))       ot = 'Tax Override';
        else if (action.includes('Unit Price')) ot = 'Price Override';
        else if (action.includes('Quantity'))  ot = 'Quantity Override';
        else if (action.includes('Unit Factor'))ot = 'Unit Factor Override';
        else if (action.includes('Delete Product')) ot = 'Product Deleted';
        else if (action.includes('Add New Product')) ot = 'Product Added';
        overrides.push({ site_id: r['Site ID'], override_type: ot, environment: env, date });
      }

      if (action === 'Create AI Batch') {
        const bt = data.batch_type === 'PURCHASE_INVOICE' ? 'Purchase Invoice'
                 : data.batch_type === 'EXPENSE' ? 'Expense' : data.batch_type;
        batches.push({ site_id: r['Site ID'], business_name: data.action_by_name,
          batch_type: bt, items_count: data.items_count || 1, environment: env, date });
      }
    });

  return { errors, overrides, batches, firstTimers };
}

// ── RFR AGE ───────────────────────────────────────────────────
function computeRFR(batchRows) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return batchRows
    .filter(r => r['Status'] === 'Ready for Review')
    .map(r => ({
      site_id: r['Site ID'], business_name: r['Business Name'],
      Type: r['Type'], Environment: r['Environment'], date: r.date,
      age_days: r.date ? Math.floor((today - new Date(r.date + 'T00:00:00')) / 86400000) : null,
    }));
}

// ── MULTIPART BODY READER ─────────────────────────────────────
async function readMultipart(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      const boundary = req.headers['content-type'].split('boundary=')[1];
      const parts = body.split(`--${boundary}`).filter(p => p.includes('Content-Disposition'));
      const fields = {};
      parts.forEach(part => {
        const [rawHeaders, ...rest] = part.split('\r\n\r\n');
        const nameMatch = rawHeaders.match(/name="([^"]+)"/);
        if (!nameMatch) return;
        fields[nameMatch[1]] = rest.join('\r\n\r\n').replace(/\r\n--$/, '').replace(/\r\n$/, '');
      });
      resolve(fields);
    });
    req.on('error', reject);
  });
}

// ── HANDLER ───────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const fields = await readMultipart(req);
    const { type, file } = fields;

    if (!type || !file) return res.status(400).json({ error: 'Missing type or file' });

    const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;

    // Store raw CSV (always overwrite latest)
    const csvKey = type === 'batch' ? 'latest-batch.csv' : 'latest-action.csv';
    await put(csvKey, file, { access: 'public', token: BLOB_TOKEN, addRandomSuffix: false });

    // Fetch both CSVs from blob, reprocess everything together
    let batchCsv = file, actionCsv = null;

    if (type === 'batch') {
      // Try to get existing action CSV
      try {
        const actionBlob = await head('latest-action.csv', { token: BLOB_TOKEN });
        const r = await fetch(actionBlob.url);
        actionCsv = await r.text();
      } catch {}
    } else {
      actionCsv = file;
      // Get existing batch CSV
      try {
        const batchBlob = await head('latest-batch.csv', { token: BLOB_TOKEN });
        const r = await fetch(batchBlob.url);
        batchCsv = await r.text();
      } catch {}
    }

    // Process batch
    const batchRows = processBatch(parseCSV(batchCsv));
    const rfr = computeRFR(batchRows);

    // Process action log
    let errors = [], overrides = [], batches = [], firstTimers = {};
    if (actionCsv) {
      const actionRows = parseCSV(actionCsv);
      ({ errors, overrides, batches, firstTimers } = processAction(actionRows, batchRows));
    }

    const processed = { batch: batchRows, errors, overrides, batches, firstTimers, rfr, retention: {}, newDaily: {} };

    // Store processed JSON
    await put('latest-data.json', JSON.stringify(processed), {
      access: 'public', token: BLOB_TOKEN, addRandomSuffix: false,
      contentType: 'application/json',
    });

    res.status(200).json({ ok: true, rows: batchRows.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}
