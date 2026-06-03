// ── PlanCrazy server ───────────────────────────────────────────────────────────
// Serves the app and stores ALL data in a shared JSON file so that everyone who
// opens the same link sees the same plans, expenses, attendance and contributions.
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import nodemailer from 'nodemailer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// Where the shared database lives. On Railway, mount a Volume and set
// DATA_DIR=/data so the data survives redeploys.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

// Default seed: the fixed squad. Josmar is always present.
const DEFAULT_STATE = {
  squad: [
    { id: 'iker',   name: 'Iker',   emoji: '🎸', color: '#7c3aed' },
    { id: 'ahmed',  name: 'Ahmed',  emoji: '⚡',  color: '#0ea5c9' },
    { id: 'aaron',  name: 'Aaron',  emoji: '🏀', color: '#22c55e' },
    { id: 'fatima', name: 'Fatima', emoji: '🌺', color: '#e2407a' },
    { id: 'pool',   name: 'Pool',   emoji: '🎯', color: '#f59e0b' },
    { id: 'josmar', name: 'Josmar', emoji: '😎', color: '#ef4444', email: 'zamorajosmar98@gmail.com' },
  ],
  plans: [],
  ejs: {},
  rev: 0,
};

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readDB() {
  try {
    ensureDir();
    if (!fs.existsSync(DB_FILE)) {
      fs.writeFileSync(DB_FILE, JSON.stringify(DEFAULT_STATE, null, 2));
      return structuredClone(DEFAULT_STATE);
    }
    const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    // Guarantee every default squad member exists (e.g. Josmar after an upgrade).
    DEFAULT_STATE.squad.forEach(def => {
      if (!raw.squad?.find(s => s.id === def.id)) {
        raw.squad = raw.squad || [];
        raw.squad.push(def);
      }
    });
    if (typeof raw.rev !== 'number') raw.rev = 0;
    return raw;
  } catch (e) {
    console.error('readDB failed, using defaults:', e);
    return structuredClone(DEFAULT_STATE);
  }
}

let writeQueue = Promise.resolve();
function writeDB(state) {
  // Serialize writes so concurrent requests don't corrupt the file.
  writeQueue = writeQueue.then(() => {
    ensureDir();
    return fs.promises.writeFile(DB_FILE, JSON.stringify(state, null, 2));
  }).catch(e => console.error('writeDB failed:', e));
  return writeQueue;
}

app.use(express.json({ limit: '5mb' }));

// ── EMAIL ─────────────────────────────────────────────────────────────────────
// Set EMAIL_HOST, EMAIL_PORT, EMAIL_USER, EMAIL_PASS in Railway env vars.
// Gmail example: host=smtp.gmail.com, port=465, user=tu@gmail.com, pass=app-password
function createTransport() {
  const { EMAIL_HOST, EMAIL_PORT, EMAIL_USER, EMAIL_PASS } = process.env;
  if (!EMAIL_HOST || !EMAIL_USER || !EMAIL_PASS) return null;
  return nodemailer.createTransport({
    host: EMAIL_HOST,
    port: parseInt(EMAIL_PORT || '465'),
    secure: parseInt(EMAIL_PORT || '465') === 465,
    auth: { user: EMAIL_USER, pass: EMAIL_PASS },
  });
}

function planEmailHtml({ toName, planName, planDate, planBudget, message }) {
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><style>
  body{margin:0;padding:0;background:#0f0f13;font-family:'Segoe UI',Arial,sans-serif;color:#e2e8f0;}
  .wrap{max-width:520px;margin:32px auto;background:#1a1a2e;border-radius:20px;overflow:hidden;border:1px solid rgba(255,255,255,.08);}
  .hd{background:linear-gradient(135deg,#7c3aed,#e2407a);padding:32px 28px;text-align:center;}
  .hd h1{margin:0;font-size:28px;letter-spacing:-1px;}
  .hd p{margin:6px 0 0;opacity:.85;font-size:13px;}
  .body{padding:28px;}
  .pill{display:inline-block;background:rgba(124,58,237,.2);border:1px solid rgba(124,58,237,.4);color:#a78bfa;border-radius:99px;font-size:12px;padding:3px 12px;margin-bottom:20px;}
  .msg{background:rgba(255,255,255,.05);border-left:3px solid #7c3aed;border-radius:0 10px 10px 0;padding:14px 16px;font-size:14px;line-height:1.7;white-space:pre-wrap;}
  .meta{margin-top:20px;display:flex;gap:10px;flex-wrap:wrap;}
  .tag{background:rgba(255,255,255,.06);border-radius:10px;padding:8px 14px;font-size:12px;color:#94a3b8;}
  .tag strong{display:block;color:#e2e8f0;font-size:14px;}
  .ft{text-align:center;padding:20px;font-size:11px;color:#475569;}
</style></head>
<body>
<div class="wrap">
  <div class="hd">
    <h1>🌪️ PlanCrazy</h1>
    <p>Mensaje para ${toName}</p>
  </div>
  <div class="body">
    <div class="pill">📣 Aviso del squad</div>
    <div class="msg">${message.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>
    <div class="meta">
      <div class="tag"><strong>${planName}</strong>Plan</div>
      <div class="tag"><strong>${planDate}</strong>Fecha</div>
      <div class="tag"><strong>${planBudget}</strong>Presupuesto</div>
    </div>
  </div>
  <div class="ft">PlanCrazy &mdash; planes locos con el squad 🔥</div>
</div>
</body></html>`;
}

app.post('/api/notify', async (req, res) => {
  const { toEmail, toName, planName, planDate, planBudget, message, subject } = req.body || {};
  if (!toEmail || !message) return res.status(400).json({ error: 'toEmail and message required' });

  const transport = createTransport();
  if (!transport) {
    return res.status(503).json({ error: 'Email not configured. Set EMAIL_HOST, EMAIL_USER, EMAIL_PASS env vars.' });
  }

  try {
    await transport.sendMail({
      from: `"PlanCrazy 🌪️" <${process.env.EMAIL_USER}>`,
      to: toEmail,
      subject: subject || `📣 ${planName || 'PlanCrazy'} — aviso del squad`,
      html: planEmailHtml({ toName, planName, planDate, planBudget, message }),
      text: message,
    });
    res.json({ ok: true });
  } catch (e) {
    console.error('sendMail failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Get the whole shared state.
app.get('/api/state', (req, res) => {
  res.json(readDB());
});

// Replace the whole shared state (last write wins, with a monotonic revision).
app.put('/api/state', async (req, res) => {
  const incoming = req.body;
  if (!incoming || typeof incoming !== 'object') {
    return res.status(400).json({ error: 'invalid state' });
  }
  const current = readDB();
  const next = {
    squad: Array.isArray(incoming.squad) ? incoming.squad : current.squad,
    plans: Array.isArray(incoming.plans) ? incoming.plans : current.plans,
    ejs:   incoming.ejs && typeof incoming.ejs === 'object' ? incoming.ejs : current.ejs,
    rev:   (current.rev || 0) + 1,
  };
  await writeDB(next);
  res.json(next);
});

// Static files (index.html etc.)
app.use(express.static(__dirname, { extensions: ['html'] }));

// SPA fallback.
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`PlanCrazy escuchando en http://localhost:${PORT}`);
  console.log(`Datos compartidos en: ${DB_FILE}`);
});
