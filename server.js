// sync-backend/server.js
import dotenv from "dotenv";
dotenv.config();

import express from "express";
import pg from "pg";
import cors from "cors";

const { Pool } = pg;
const app = express();

// ── DB Pool ───────────────────────────────────────────────────────────────────
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  ssl: { rejectUnauthorized: false },
});

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "5mb" }));
app.use((req, res, next) => {
  // Public routes — no auth needed
  if (req.path === "/health") return next();
  if (req.path.startsWith("/license")) return next();

  // Sync routes require bearer token
  const auth = req.headers["authorization"] ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!process.env.SYNC_TOKEN || token !== process.env.SYNC_TOKEN) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
});

// ── Allowed tables (whitelist) ────────────────────────────────────────────────
const ALLOWED_TABLES = new Set([
  "patients",
  "staff",
  "visits",
  "prescriptions",
  "investigations",
  "appointments",
]);

function assertTable(name, res) {
  if (!ALLOWED_TABLES.has(name)) {
    res.status(400).json({ error: `Unknown table: ${name}` });
    return false;
  }
  return true;
}

// ── Health ────────────────────────────────────────────────────────────────────
app.get("/health", (_req, res) =>
  res.json({ ok: true, ts: new Date().toISOString() }),
);

// ─────────────────────────────────────────────────────────────────────────────
//  PULL  GET /changes?since=ISO_TIMESTAMP
//  Returns rows from all tables updated after `since`.
//  Must be defined BEFORE /:table to avoid route conflict.
// ─────────────────────────────────────────────────────────────────────────────
app.get("/changes", async (req, res) => {
  try {
    const since = req.query.since ?? "1970-01-01T00:00:00.000Z";
    const limit = parseInt(req.query.limit ?? "200");
    const offset = parseInt(req.query.offset ?? "0");
    const tables = [...ALLOWED_TABLES];
    const rows = [];

    await Promise.all(
      tables.map(async (table) => {
        const result = await pool.query(
          `SELECT * FROM "${table}" WHERE updated_at > $1 ORDER BY updated_at ASC LIMIT $2 OFFSET $3`,
          [since, limit, offset],
        );
        for (const row of result.rows) {
          rows.push({ table, row });
        }
      }),
    );

    rows.sort(
      (a, b) => new Date(a.row.updated_at) - new Date(b.row.updated_at),
    );
    res.json({ ok: true, rows, hasMore: rows.length === limit });
  } catch (err) {
    console.error("GET /changes:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  PUSH  POST /:table   → upsert
//        PUT  /:table/:id → upsert (idempotent)
//        DELETE /:table/:id → soft-delete
// ─────────────────────────────────────────────────────────────────────────────
async function upsertRow(table, row, res) {
  console.log("[upsertRow] table:", table, "row:", JSON.stringify(row));
  try {
    const cols = Object.keys(row);
    const vals = Object.values(row);

    const colList = cols.map((c) => `"${c}"`).join(", ");
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
    const setClauses = cols
      .filter((c) => c !== "id" && c !== "synced_at") // ← add && c !== "synced_at"
      .map((c) => `"${c}" = EXCLUDED."${c}"`)
      .join(", ");

    const sql = `INSERT INTO "${table}" (${colList}) VALUES (${placeholders}) ON CONFLICT (id) DO UPDATE SET ${setClauses}, synced_at = NOW()`;
    console.log("[sql]", sql);
    console.log("[vals]", vals);

    await pool.query(sql, vals);
    res.json({ ok: true });
  } catch (err) {
    console.error("[upsertRow error]", err); // full error object
    res.status(500).json({ error: err.message });
  }
}

app.post("/:table", async (req, res) => {
  const { table } = req.params;
  if (!assertTable(table, res)) return;
  try {
    await upsertRow(table, req.body, res);
  } catch (err) {
    console.error(`POST /${table}:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

app.put("/:table/:id", async (req, res) => {
  const { table } = req.params;
  if (!assertTable(table, res)) return;
  try {
    // Merge id from URL in case body omits it
    const row = { ...req.body, id: req.params.id };
    await upsertRow(table, row, res);
  } catch (err) {
    console.error(`PUT /${table}/${req.params.id}:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

app.delete("/:table/:id", async (req, res) => {
  const { table, id } = req.params;
  if (!assertTable(table, res)) return;
  try {
    await pool.query(
      `UPDATE "${table}"
       SET _deleted = true, updated_at = NOW(), synced_at = NOW()
       WHERE id = $1`,
      [id],
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(`DELETE /${table}/${id}:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── LICENSE ───────────────────────────────────────────────────────────────────

// Activate a license key on a machine
app.post("/license/activate", async (req, res) => {
  const { key, machine_id } = req.body;
  if (!key || !machine_id)
    return res
      .status(400)
      .json({ ok: false, error: "Missing key or machine_id" });

  try {
    const result = await pool.query(`SELECT * FROM licenses WHERE key = $1`, [
      key,
    ]);

    const license = result.rows[0];

    if (!license)
      return res.status(404).json({ ok: false, error: "Invalid license key" });

    if (!license.is_active)
      return res
        .status(403)
        .json({ ok: false, error: "License is deactivated" });

    if (license.expires_at && new Date(license.expires_at) < new Date())
      return res.status(403).json({ ok: false, error: "License expired" });

    // Already activated on a different machine
    if (license.machine_id && license.machine_id !== machine_id)
      return res
        .status(403)
        .json({ ok: false, error: "License already used on another device" });

    // Activate
    await pool.query(
      `UPDATE licenses SET machine_id = $1, activated_at = NOW() WHERE key = $2`,
      [machine_id, key],
    );

    res.json({ ok: true, expires_at: license.expires_at });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Verify a license (called on every launch)
app.post("/license/verify", async (req, res) => {
  const { key, machine_id } = req.body;
  if (!key || !machine_id)
    return res
      .status(400)
      .json({ ok: false, error: "Missing key or machine_id" });

  try {
    const result = await pool.query(`SELECT * FROM licenses WHERE key = $1`, [
      key,
    ]);

    const license = result.rows[0];

    if (!license)
      return res.status(404).json({ ok: false, error: "Invalid license key" });

    if (!license.is_active)
      return res.status(403).json({ ok: false, error: "License deactivated" });

    if (license.machine_id !== machine_id)
      return res
        .status(403)
        .json({ ok: false, error: "License not valid for this device" });

    if (license.expires_at && new Date(license.expires_at) < new Date())
      return res.status(403).json({ ok: false, error: "License expired" });

    res.json({ ok: true, expires_at: license.expires_at });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Deactivate — release from machine so user can move to new PC
app.post("/license/deactivate", async (req, res) => {
  const { key, machine_id } = req.body;
  if (!key || !machine_id)
    return res.status(400).json({ ok: false, error: "Missing fields" });

  try {
    const result = await pool.query(`SELECT * FROM licenses WHERE key = $1`, [
      key,
    ]);

    const license = result.rows[0];
    if (!license)
      return res.status(404).json({ ok: false, error: "Invalid key" });

    if (license.machine_id !== machine_id)
      return res.status(403).json({ ok: false, error: "Not your license" });

    await pool.query(
      `UPDATE licenses SET machine_id = NULL, activated_at = NULL WHERE key = $1`,
      [key],
    );

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅ Sync backend running on port ${PORT}`);
});
