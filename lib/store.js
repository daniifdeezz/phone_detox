// Almacenamiento: Postgres si hay DATABASE_URL (Railway), si no un fichero JSON local.
const fs = require('fs');
const path = require('path');
const { env } = require('./env');

class PgStore {
  constructor(url) {
    const { Pool } = require('pg');
    const ssl = /localhost|127\.0\.0\.1|\.railway\.internal/.test(url) ? false : { rejectUnauthorized: false };
    this.pool = new Pool({ connectionString: url, ssl, max: 5 });
  }

  async init() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value JSONB NOT NULL);
      CREATE TABLE IF NOT EXISTS events (
        id SERIAL PRIMARY KEY,
        type TEXT NOT NULL,
        data JSONB NOT NULL DEFAULT '{}',
        at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS events_at ON events (at);
    `);
  }

  async get(key, fallback = null) {
    const r = await this.pool.query('SELECT value FROM kv WHERE key = $1', [key]);
    return r.rows.length ? r.rows[0].value : fallback;
  }

  async set(key, value) {
    await this.pool.query(
      'INSERT INTO kv (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
      [key, JSON.stringify(value)]
    );
  }

  async del(key) {
    await this.pool.query('DELETE FROM kv WHERE key = $1', [key]);
  }

  async addEvent(type, data = {}, at = new Date()) {
    const r = await this.pool.query(
      'INSERT INTO events (type, data, at) VALUES ($1, $2, $3) RETURNING id, type, data, at',
      [type, JSON.stringify(data), at]
    );
    return normEvent(r.rows[0]);
  }

  async events(since) {
    const r = await this.pool.query('SELECT id, type, data, at FROM events WHERE at >= $1 ORDER BY at', [since]);
    return r.rows.map(normEvent);
  }
}

class FileStore {
  constructor(file) {
    this.file = file;
    this.data = { kv: {}, events: [], seq: 0 };
  }

  async init() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    if (fs.existsSync(this.file)) this.data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
  }

  save() {
    fs.writeFileSync(this.file, JSON.stringify(this.data));
  }

  async get(key, fallback = null) {
    return key in this.data.kv ? structuredClone(this.data.kv[key]) : fallback;
  }

  async set(key, value) {
    this.data.kv[key] = structuredClone(value);
    this.save();
  }

  async del(key) {
    delete this.data.kv[key];
    this.save();
  }

  async addEvent(type, data = {}, at = new Date()) {
    const ev = { id: ++this.data.seq, type, data, at: new Date(at).toISOString() };
    this.data.events.push(ev);
    this.save();
    return normEvent(ev);
  }

  async events(since) {
    const t = new Date(since).getTime();
    return this.data.events.filter((e) => new Date(e.at).getTime() >= t).map(normEvent);
  }
}

function normEvent(e) {
  return { id: e.id, type: e.type, data: e.data || {}, at: new Date(e.at) };
}

function createStore() {
  if (env('DATABASE_URL')) return new PgStore(env('DATABASE_URL'));
  return new FileStore(env('DATA_FILE') || path.join(__dirname, '..', 'data', 'db.json'));
}

module.exports = { createStore };
