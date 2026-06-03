// ── PlanCrazy server ───────────────────────────────────────────────────────────
// Serves the app and stores ALL data in a shared JSON file so that everyone who
// opens the same link sees the same plans, expenses, attendance and contributions.
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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
