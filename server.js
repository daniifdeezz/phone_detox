const path = require('path');
const crypto = require('crypto');
const express = require('express');
const webpush = require('web-push');
const { createStore } = require('./lib/store');
const { parts, localDate, nightKey, addDays, hm } = require('./lib/time');
const L = require('./lib/logic');

const store = createStore();
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '10mb' }));

let APP_TOKEN = process.env.APP_TOKEN || null;

// ---------- utilidades ----------

const settings = async () => L.mergeSettings(await store.get('settings'));

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function auth(req, res, next) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : req.query.t;
  if (!safeEqual(token, APP_TOKEN)) return res.status(401).json({ error: 'no autorizado' });
  next();
}

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

async function recentEvents(days = 35) {
  return store.events(new Date(Date.now() - days * 86400e3));
}

async function todayVitals(date) {
  const rows = await store.vitals(date);
  return rows.find((r) => r.date === date) || null;
}

// ---------- push ----------

async function setupPush() {
  let keys =
    process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY
      ? { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY }
      : await store.get('vapid');
  if (!keys) {
    keys = webpush.generateVAPIDKeys();
    await store.set('vapid', keys);
  }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:phone-detox@example.com', keys.publicKey, keys.privateKey);
  return keys.publicKey;
}

async function sendPush(payload) {
  const subs = await store.get('push_subs', []);
  const alive = [];
  let sent = 0;
  for (const sub of subs) {
    try {
      await webpush.sendNotification(sub, JSON.stringify(payload), { TTL: 3600 });
      alive.push(sub);
      sent++;
    } catch (err) {
      if (err.statusCode !== 404 && err.statusCode !== 410) alive.push(sub);
      console.error('push error', err.statusCode || err.message);
    }
  }
  if (alive.length !== subs.length) await store.set('push_subs', alive);
  return sent;
}

// ---------- estado ----------

async function buildState() {
  const s = await settings();
  const now = new Date();
  const p = parts(now, s.tz);
  const events = await recentEvents();
  const today = L.summarizeDay(p.date, events, s.tz);
  const tonightDate = nightKey(now, s.tz);
  const tonight = L.summarizeDay(tonightDate, events, s.tz);
  const vit = await todayVitals(p.date);
  const energyAuto = L.energyFromVitals(vit);

  const ws = L.weekStart(p.date);
  const week = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(ws, i);
    const sum = L.summarizeDay(d, events, s.tz);
    week.push({ date: d, win: sum.morningDone, parked: sum.parkedLastNight, future: d > p.date });
  }
  const allEvents = await store.events(new Date(0));
  const totalWins = new Set(allEvents.filter((e) => e.type === 'morning_done').map((e) => localDate(e.at, s.tz))).size;

  // Qué pantalla toca: noche (desde 1 h antes de dormir hasta 2 h antes de despertar),
  // mañana (hasta 4 h después de despertar, si no está hecha) o día.
  const wake = hm(s.wake);
  const bed = hm(s.bedtime);
  const circ = (x) => ((x % 1440) + 1440) % 1440;
  const inNight = circ(p.minutes - (bed - 60)) < circ(wake - 120 - (bed - 60));
  let mode = 'dia';
  if (inNight) mode = tonight.parkedTonight ? 'aparcado' : 'noche';
  else if (circ(p.minutes - (wake - 120)) < 6 * 60 && !today.morningDone) mode = 'manana';

  return {
    now: now.toISOString(),
    local: p,
    mode,
    settings: s,
    today,
    tonight: { date: tonightDate, parked: tonight.parkedTonight, plan: tonight.planTonight },
    energy: today.energyManual || energyAuto,
    energyAuto,
    vitalsToday: vit,
    week,
    totalWins,
  };
}

// ---------- API ----------

app.post('/api/login', (req, res) => {
  if (!safeEqual(req.body?.token, APP_TOKEN)) return res.status(401).json({ error: 'código incorrecto' });
  res.json({ ok: true });
});

// Para los Atajos de iOS: responde "abrir" o "pausa" en texto plano.
app.get('/api/gate', auth, wrap(async (req, res) => {
  const appId = String(req.query.app || 'app').slice(0, 40);
  const until = await store.get(`allow:${appId}`);
  if (until && new Date(until) > new Date()) return res.type('text').send('abrir');
  await store.addEvent('gate_pause', { app: appId });
  res.type('text').send('pausa');
}));

app.use('/api', (req, res, next) => (req.path === '/login' ? next() : auth(req, res, next)));

app.get('/api/state', wrap(async (req, res) => res.json(await buildState())));

app.put('/api/settings', wrap(async (req, res) => {
  const current = await settings();
  const body = req.body || {};
  const allowed = ['tz', 'wake', 'bedtime', 'tone', 'allowMinutes', 'lockWaitMinutes', 'morningSteps', 'alternatives', 'apps', 'notif'];
  const next = { ...current };
  for (const k of allowed) if (k in body) next[k] = body[k];
  if (!/^\d{2}:\d{2}$/.test(next.wake) || !/^\d{2}:\d{2}$/.test(next.bedtime)) {
    return res.status(400).json({ error: 'hora inválida' });
  }
  try {
    new Intl.DateTimeFormat('es', { timeZone: next.tz });
  } catch {
    return res.status(400).json({ error: 'zona horaria inválida' });
  }
  await store.set('settings', next);
  res.json(L.mergeSettings(next));
}));

const EVENT_TYPES = ['morning_step', 'morning_done', 'energy', 'park', 'plan_tomorrow', 'pause_choice', 'alt_done'];

app.post('/api/event', wrap(async (req, res) => {
  const { type, data } = req.body || {};
  if (!EVENT_TYPES.includes(type)) return res.status(400).json({ error: 'tipo desconocido' });
  res.json(await store.addEvent(type, data || {}));
}));

app.post('/api/allow', wrap(async (req, res) => {
  const s = await settings();
  const appId = String(req.body?.app || 'app').slice(0, 40);
  const minutes = Math.min(Math.max(Number(req.body?.minutes) || s.allowMinutes, 1), 30);
  const until = new Date(Date.now() + minutes * 60e3);
  await store.set(`allow:${appId}`, until.toISOString());
  const pending = await store.get('pending_push', []);
  pending.push({ at: until.toISOString(), kind: 'allowOver', vars: { min: minutes }, url: '/#/pausa?app=' + appId + '&fin=1' });
  await store.set('pending_push', pending);
  res.json({ until });
}));

// ---------- candado de Tiempo de uso ----------

const newCode = () => String(crypto.randomInt(0, 10000)).padStart(4, '0');
const PENDING_VISIBLE_MIN = 30;

async function lockStatus() {
  const s = await settings();
  const lock = await store.get('lock');
  const st = await buildState();
  if (!lock) return { exists: false, morningDone: st.today.morningDone, waitMinutes: s.lockWaitMinutes };
  const pendingVisible = !lock.confirmed && Date.now() - new Date(lock.createdAt).getTime() < PENDING_VISIBLE_MIN * 60e3;
  if (!lock.confirmed && !pendingVisible) {
    lock.confirmed = true;
    await store.set('lock', lock);
  }
  const waitEnds = lock.waitStartedAt ? new Date(lock.waitStartedAt).getTime() + s.lockWaitMinutes * 60e3 : null;
  return {
    exists: true,
    confirmed: lock.confirmed,
    pendingCode: pendingVisible ? lock.code : null,
    previousCode: pendingVisible ? lock.previous || null : null,
    morningDone: st.today.morningDone,
    waitMinutes: s.lockWaitMinutes,
    waitEnds: waitEnds ? new Date(waitEnds).toISOString() : null,
    canReveal: st.today.morningDone || (waitEnds != null && Date.now() >= waitEnds),
    setAt: lock.createdAt,
  };
}

app.get('/api/lock', wrap(async (req, res) => res.json(await lockStatus())));

app.post('/api/lock/new', wrap(async (req, res) => {
  const lock = await store.get('lock');
  if (lock && lock.confirmed) return res.status(409).json({ error: 'ya hay un código activo' });
  await store.set('lock', { code: newCode(), confirmed: false, createdAt: new Date().toISOString() });
  res.json(await lockStatus());
}));

app.post('/api/lock/confirm', wrap(async (req, res) => {
  const lock = await store.get('lock');
  if (!lock) return res.status(404).json({ error: 'no hay código' });
  lock.confirmed = true;
  delete lock.previous;
  await store.set('lock', lock);
  res.json(await lockStatus());
}));

app.post('/api/lock/forget', wrap(async (req, res) => {
  const lock = await store.get('lock');
  if (lock && lock.confirmed) return res.status(409).json({ error: 'el código ya está activo; usa "Necesito el código"' });
  await store.del('lock');
  res.json(await lockStatus());
}));

app.post('/api/lock/wait', wrap(async (req, res) => {
  const lock = await store.get('lock');
  if (!lock) return res.status(404).json({ error: 'no hay código' });
  if (!lock.waitStartedAt) {
    lock.waitStartedAt = new Date().toISOString();
    await store.set('lock', lock);
    await store.addEvent('lock_wait', {});
  }
  res.json(await lockStatus());
}));

app.post('/api/lock/reveal', wrap(async (req, res) => {
  const status = await lockStatus();
  if (!status.exists || !status.confirmed) return res.status(404).json({ error: 'no hay código activo' });
  if (!status.canReveal) return res.status(403).json({ error: 'todavía no' });
  const lock = await store.get('lock');
  const fresh = { code: newCode(), previous: lock.code, confirmed: false, createdAt: new Date().toISOString() };
  await store.set('lock', fresh);
  await store.addEvent('lock_reveal', { reason: status.morningDone ? 'manana' : 'espera' });
  res.json(await lockStatus());
}));

// ---------- notificaciones ----------

app.get('/api/push/key', wrap(async (req, res) => res.json({ key: await setupPush() })));

app.post('/api/push/subscribe', wrap(async (req, res) => {
  const sub = req.body;
  if (!sub || !sub.endpoint) return res.status(400).json({ error: 'suscripción inválida' });
  const subs = (await store.get('push_subs', [])).filter((x) => x.endpoint !== sub.endpoint);
  subs.push(sub);
  await store.set('push_subs', subs);
  res.json({ ok: true, count: subs.length });
}));

app.post('/api/push/test', wrap(async (req, res) => {
  const sent = await sendPush({ title: 'Funciona ✅', body: 'Así te llegarán los avisos. Pocos y con sentido.', url: '/' });
  res.json({ sent });
}));

// ---------- progreso y Garmin ----------

app.get('/api/progress', wrap(async (req, res) => {
  const s = await settings();
  const p = parts(new Date(), s.tz);
  const from = addDays(p.date, -27);
  const events = await recentEvents(32);
  const vitals = await store.vitals(addDays(p.date, -90));
  const byDate = Object.fromEntries(vitals.map((v) => [v.date, v]));
  const days = [];
  for (let d = from; d <= p.date; d = addDays(d, 1)) {
    const sum = L.summarizeDay(d, events, s.tz);
    const v = byDate[d];
    const bed = v ? L.bedtimeAroundMidnight(L.bedtimeMinutes(v, s.tz)) : null;
    days.push({
      date: d,
      win: sum.morningDone,
      parked: sum.parkedLastNight,
      pauses: sum.pauses,
      redirected: sum.redirected,
      entered: sum.entered,
      battery: v ? v.battery_max : null,
      sleepScore: v ? v.sleep_score : null,
      bedtime: bed,
    });
  }
  res.json({ days, insight: L.vitalsInsight(vitals, s.tz) });
}));

app.post('/api/vitals/import', wrap(async (req, res) => {
  const rows = L.normalizeVitals(req.body);
  if (!rows.length) return res.status(400).json({ error: 'no encuentro días en ese archivo' });
  await store.upsertVitals(rows);
  res.json({ imported: rows.length, from: rows[0].date, to: rows[rows.length - 1].date });
}));

app.get('/api/export', wrap(async (req, res) => {
  res.json({
    settings: await settings(),
    events: await store.events(new Date(0)),
    vitals: await store.vitals('0000-00-00'),
  });
}));

app.use('/api', (req, res) => res.status(404).json({ error: 'no existe' }));

// ---------- web ----------

app.get('/health', (req, res) => res.send('ok'));
app.use(
  express.static(path.join(__dirname, 'public'), {
    setHeaders(res, file) {
      if (file.endsWith('sw.js') || file.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    },
  })
);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'error interno' });
});

// ---------- programador (cada minuto) ----------

async function tick() {
  const s = await settings();
  const now = new Date();
  const p = parts(now, s.tz);

  // Avisos pedidos por el usuario ("entrar 5 min").
  const pending = await store.get('pending_push', []);
  const due = pending.filter((x) => new Date(x.at) <= now);
  if (due.length) {
    await store.set('pending_push', pending.filter((x) => new Date(x.at) > now));
    for (const d of due) await sendPush({ ...L.message(d.kind, s.tone, d.vars), url: d.url });
  }

  // Avisos programados del día.
  const sentKey = `sent:${p.date}`;
  const sent = await store.get(sentKey, []);
  if (sent.length >= s.notif.maxPerDay) return;
  const events = await recentEvents(3);
  const today = L.summarizeDay(p.date, events, s.tz);
  const tonight = L.summarizeDay(nightKey(now, s.tz), events, s.tz);
  const summary = { ...today, parkedTonight: tonight.parkedTonight };
  for (const n of L.dueNotifications(s, p, summary, sent)) {
    if (sent.length >= s.notif.maxPerDay) break;
    const url = n.kind.startsWith('night') ? '/#/noche' : '/#/manana';
    sent.push(n.kind);
    await store.set(sentKey, sent);
    await sendPush({ ...L.message(n.kind, s.tone, n.vars), url });
  }
}

async function syncVitals() {
  const url = process.env.VITALS_URL;
  if (!url) return;
  try {
    const headers = process.env.VITALS_TOKEN ? { Authorization: `Bearer ${process.env.VITALS_TOKEN}` } : {};
    const r = await fetch(url, { headers });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const rows = L.normalizeVitals(await r.json());
    await store.upsertVitals(rows);
    console.log(`vitals: ${rows.length} días sincronizados`);
  } catch (err) {
    console.error('vitals sync', err.message);
  }
}

async function main() {
  await store.init();
  if (!APP_TOKEN) {
    APP_TOKEN = await store.get('app_token');
    if (!APP_TOKEN) {
      APP_TOKEN = crypto.randomBytes(9).toString('base64url');
      await store.set('app_token', APP_TOKEN);
    }
    console.log(`\n  Sin APP_TOKEN en el entorno. Código de acceso generado: ${APP_TOKEN}\n`);
  }
  await setupPush();
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => console.log(`phone-detox escuchando en :${port}`));
  setInterval(() => tick().catch((e) => console.error('tick', e)), 60e3);
  tick().catch((e) => console.error('tick', e));
  syncVitals();
  setInterval(syncVitals, 60 * 60e3);
}

if (require.main === module) main();

module.exports = { app, store, tick, buildState };
