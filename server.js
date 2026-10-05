const path = require('path');
const crypto = require('crypto');
const express = require('express');
const webpush = require('web-push');
const { createStore } = require('./lib/store');
const { parts, localDate, nightKey, addDays, hm } = require('./lib/time');
const L = require('./lib/logic');
const AI = require('./lib/ai');

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

// ---------- modo clase / biblioteca ----------

const FOCUS_PLACES = { clase: 'clase', biblioteca: 'la biblioteca', estudio: 'modo estudio' };

async function schedulePush(entry) {
  const pending = await store.get('pending_push', []);
  pending.push(entry);
  await store.set('pending_push', pending);
}

async function cancelPush(tag) {
  const pending = await store.get('pending_push', []);
  await store.set('pending_push', pending.filter((x) => x.tag !== tag));
}

async function finishFocus(focus, endAt) {
  const minutes = Math.max(0, Math.round((endAt - new Date(focus.start)) / 60e3));
  await store.del('focus');
  await store.addEvent('focus_end', {
    place: focus.place,
    minutes,
    planned: focus.minutes,
    early: endAt < new Date(focus.end),
    pickups: focus.pickups || 0,
  }, endAt);
  return minutes;
}

// Sesión activa, o null. Si ya ha terminado, la cierra y la registra.
async function currentFocus() {
  const focus = await store.get('focus');
  if (!focus) return null;
  if (new Date(focus.end) <= new Date()) {
    await finishFocus(focus, new Date(focus.end));
    return null;
  }
  return focus;
}

// ---------- estado ----------

async function buildState() {
  const s = await settings();
  const now = new Date();
  const p = parts(now, s.tz);
  const focus = await currentFocus();
  const events = await recentEvents();
  const today = L.summarizeDay(p.date, events, s.tz);
  const tonightDate = nightKey(now, s.tz);
  const tonight = L.summarizeDay(tonightDate, events, s.tz);

  const ws = L.weekStart(p.date);
  const week = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(ws, i);
    const sum = L.summarizeDay(d, events, s.tz);
    week.push({ date: d, win: sum.morningDone, parked: sum.parkedLastNight, future: d > p.date });
  }
  const allEvents = await store.events(new Date(0));
  const totalWins = new Set(allEvents.filter((e) => e.type === 'morning_done').map((e) => localDate(e.at, s.tz))).size;
  const weekFocusMinutes = events
    .filter((e) => e.type === 'focus_end' && localDate(e.at, s.tz) >= ws)
    .reduce((a, e) => a + (e.data.minutes || 0), 0);

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
    energy: today.energyManual,
    week,
    totalWins,
    focus: focus ? { ...focus, placeText: FOCUS_PLACES[focus.place] || focus.place } : null,
    lastFocus: (() => {
      const e = events.filter((x) => x.type === 'focus_end').pop();
      return e ? { at: e.at, minutes: e.data.minutes, pickups: e.data.pickups } : null;
    })(),
    weekFocusMinutes,
    aiEnabled: AI.configured() && s.ai !== false,
    aiAvailable: AI.configured(),
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
  const focus = await currentFocus();
  const until = await store.get(`allow:${appId}`);
  if (!focus && until && new Date(until) > new Date()) return res.type('text').send('abrir');
  await store.addEvent('gate_pause', { app: appId, focus: !!focus });
  res.type('text').send('pausa');
}));

app.use('/api', (req, res, next) => (req.path === '/login' ? next() : auth(req, res, next)));

app.get('/api/state', wrap(async (req, res) => res.json(await buildState())));

app.put('/api/settings', wrap(async (req, res) => {
  const current = await settings();
  const body = req.body || {};
  const allowed = ['tz', 'wake', 'bedtime', 'tone', 'allowMinutes', 'lockWaitMinutes', 'morningSteps', 'alternatives', 'apps', 'notif', 'ai', 'aboutMe'];
  const next = { ...current };
  for (const k of allowed) if (k in body) next[k] = body[k];
  next.ai = next.ai !== false;
  next.aboutMe = String(next.aboutMe || '').slice(0, 600);
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
  if (await currentFocus()) return res.status(409).json({ error: 'estás en una sesión' });
  await store.set(`allow:${appId}`, until.toISOString());
  await schedulePush({ at: until.toISOString(), kind: 'allowOver', vars: { min: minutes }, url: '/#/pausa?app=' + appId + '&fin=1' });
  res.json({ until });
}));

app.post('/api/focus/start', wrap(async (req, res) => {
  const place = String(req.body?.place || 'estudio');
  if (!(place in FOCUS_PLACES)) return res.status(400).json({ error: 'lugar desconocido' });
  const minutes = Math.min(Math.max(Math.round(Number(req.body?.minutes) || 50), 5), 300);
  const old = await currentFocus();
  if (old) await finishFocus(old, new Date());
  const start = new Date();
  const end = new Date(start.getTime() + minutes * 60e3);
  const focus = { place, minutes, start: start.toISOString(), end: end.toISOString(), pickups: 0 };
  await store.set('focus', focus);
  await store.addEvent('focus_start', { place, minutes });
  await cancelPush('focus');
  await schedulePush({ at: end.toISOString(), kind: 'focusOver', vars: { min: minutes }, url: '/#/foco', tag: 'focus' });
  res.json(focus);
}));

app.post('/api/focus/pickup', wrap(async (req, res) => {
  const focus = await currentFocus();
  if (!focus) return res.json({ active: false });
  focus.pickups = (focus.pickups || 0) + 1;
  await store.set('focus', focus);
  res.json({ active: true, pickups: focus.pickups });
}));

app.post('/api/focus/stop', wrap(async (req, res) => {
  const focus = await currentFocus();
  if (!focus) return res.json({ minutes: 0 });
  await cancelPush('focus');
  res.json({ minutes: await finishFocus(focus, new Date()) });
}));

// ---------- IA (OpenRouter) ----------

const ENERGY_WORD = { baja: 'baja', media: 'normal', alta: 'alta' };
const REASON_TEXT = {
  descansar: 'dice que necesita descansar',
  inercia: 'reconoce que la ha abierto por costumbre, sin pensar',
  fin: 'se le acaba de terminar el rato que se había dado en la app',
};

async function aiContext() {
  const st = await buildState();
  if (!st.aiEnabled) return null;
  const hhmm = `${String(st.local.hour).padStart(2, '0')}:${String(st.local.minute).padStart(2, '0')}`;
  return { st, hhmm };
}

app.post('/api/ai/smaller', wrap(async (req, res) => {
  const ctx = await aiContext();
  if (!ctx) return res.json({ step: null });
  const step = (ctx.st.settings.morningSteps || []).find((x) => x.id === req.body?.stepId);
  if (!step) return res.status(400).json({ error: 'paso desconocido' });
  const out = await AI.smallerStep({
    store,
    date: ctx.st.local.date,
    settings: ctx.st.settings,
    step: step.text,
    time: ctx.hhmm,
    energy: ENERGY_WORD[ctx.st.energy],
  });
  if (out) await store.addEvent('ai_smaller', { stepId: step.id, micro: out.step });
  res.json({ step: out ? out.step : null });
}));

app.post('/api/ai/pause', wrap(async (req, res) => {
  const ctx = await aiContext();
  if (!ctx) return res.json({ action: null });
  const { st, hhmm } = ctx;
  const appName = ((st.settings.apps || []).find((a) => a.id === req.body?.app) || {}).name || 'una app';
  const facts = [
    `son las ${hhmm} de un ${new Date().toLocaleDateString('es', { weekday: 'long', timeZone: st.settings.tz })}`,
    `iba a abrir ${appName}`,
    REASON_TEXT[req.body?.reason] || '',
    st.energy ? `su energía hoy es ${ENERGY_WORD[st.energy]}` : '',
    st.today.morningDone ? 'ya ha completado su rutina de mañana' : '',
    st.today.plan ? `anoche dijo que hoy lo primero sería: ${st.today.plan}` : '',
    `hoy ha intentado abrir apps ${st.today.pauses} veces y ${st.today.redirected} veces eligió otra cosa`,
    st.mode === 'noche' ? 'es casi la hora de dejar el móvil fuera del cuarto para dormir' : '',
  ].filter(Boolean).join('; ');
  const avoid = (Array.isArray(req.body?.avoid) ? req.body.avoid : []).map((x) => String(x).slice(0, 100)).slice(0, 5);
  const out = await AI.pauseSuggestion({ store, date: st.local.date, settings: st.settings, context: facts, avoid });
  res.json(out || { action: null });
}));

app.get('/api/ai/week', wrap(async (req, res) => {
  const ctx = await aiContext();
  if (!ctx) return res.json({ text: null });
  const { st } = ctx;
  const cached = await store.get('ai_week');
  if (cached && cached.date === st.local.date) return res.json({ text: cached.text });

  const events = await recentEvents(16);
  const firstUse = events.length ? localDate(events[0].at, st.settings.tz) : st.local.date;
  const lines = [];
  for (let d = addDays(st.local.date, -13); d <= st.local.date; d = addDays(d, 1)) {
    if (d < firstUse) continue;
    const sum = L.summarizeDay(d, events, st.settings.tz);
    const dayEvents = events.filter((e) => localDate(e.at, st.settings.tz) === d);
    const focus = dayEvents.filter((e) => e.type === 'focus_end').reduce((a, e) => a + (e.data.minutes || 0), 0);
    const parkedAt = sum.parkedLastNightAt ? parts(sum.parkedLastNightAt, st.settings.tz) : null;
    const reasons = dayEvents.filter((e) => e.type === 'pause_choice' && e.data.reason).map((e) => e.data.reason);
    lines.push([
      new Date(`${d}T12:00:00Z`).toLocaleDateString('es', { weekday: 'short', day: 'numeric', timeZone: 'UTC' }),
      sum.morningDone ? 'mañana completada' : 'mañana sin completar',
      parkedAt ? `móvil fuera la noche anterior a las ${String(parkedAt.hour).padStart(2, '0')}:${String(parkedAt.minute).padStart(2, '0')}` : 'no aparcó el móvil la noche anterior',
      sum.energyManual ? `energía ${ENERGY_WORD[sum.energyManual]}` : '',
      `${sum.pauses} intentos de abrir apps, ${sum.redirected} veces eligió otra cosa`,
      reasons.length ? `motivos: ${reasons.join(', ')}` : '',
      focus ? `${focus} min sin móvil en clase o biblioteca` : '',
    ].filter(Boolean).join(', '));
  }
  if (lines.length < 2) return res.json({ text: null });
  const text = await AI.weekReflection({
    store,
    date: st.local.date,
    settings: st.settings,
    summary: `Hora prevista para dejar el móvil: ${st.settings.bedtime}. Despertador: ${st.settings.wake}.\n${lines.join('\n')}`,
  });
  if (text) await store.set('ai_week', { date: st.local.date, text });
  res.json({ text });
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

// ---------- progreso ----------

app.get('/api/progress', wrap(async (req, res) => {
  const s = await settings();
  const p = parts(new Date(), s.tz);
  const events = await recentEvents(62);
  const summarize = (d) => {
    const sum = L.summarizeDay(d, events, s.tz);
    return {
      date: d,
      win: sum.morningDone,
      parked: sum.parkedLastNight,
      parkedAt: sum.parkedLastNightAt ? parts(sum.parkedLastNightAt, s.tz).minutes : null,
      pauses: sum.pauses,
      redirected: sum.redirected,
    };
  };
  const days = [];
  for (let d = addDays(p.date, -27); d <= p.date; d = addDays(d, 1)) days.push(summarize(d));
  // Para la conclusión usamos hasta 60 días cerrados (sin contar hoy) desde el primer uso.
  const firstUse = events.length ? localDate(events[0].at, s.tz) : p.date;
  const history = [];
  for (let d = addDays(p.date, -60); d < p.date; d = addDays(d, 1)) if (d > firstUse) history.push(summarize(d));
  res.json({ days, insight: L.parkingInsight(history, s.bedtime) });
}));

app.get('/api/export', wrap(async (req, res) => {
  res.json({
    settings: await settings(),
    events: await store.events(new Date(0)),
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
  await currentFocus();
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
}

if (require.main === module) main();

module.exports = { app, store, tick, buildState };
