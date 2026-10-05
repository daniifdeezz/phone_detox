// Reglas de la app: ajustes por defecto, energía, resúmenes del día e ideas a partir de Garmin.
const { parts, localDate, nightKey, addDays, hm, fmtHm } = require('./time');

const DEFAULT_SETTINGS = {
  tz: 'Europe/Madrid',
  wake: '07:30',
  bedtime: '00:00',
  tone: 'cercano', // cercano | directo
  allowMinutes: 5,
  lockWaitMinutes: 15,
  morningSteps: [
    { id: 's1', text: 'Siéntate en la cama y pon los pies en el suelo', min: true },
    { id: 's2', text: 'Abre la persiana o la ventana', min: true },
    { id: 's3', text: 'Un vaso de agua', min: true },
    { id: 's4', text: 'Baja a la perrita', min: true },
    { id: 's5', text: 'Ducha o, al menos, agua en la cara', min: false },
    { id: 's6', text: 'Desayuna algo', min: false },
    { id: 's7', text: 'Mochila y sal hacia la uni', min: false },
  ],
  alternatives: [
    { id: 'a1', text: 'Bajar a la perrita a dar una vuelta', energy: 'baja' },
    { id: 'a2', text: 'Ordenar 5 cosas de la habitación', energy: 'baja' },
    { id: 'a3', text: 'Leer 10 páginas', energy: 'baja' },
    { id: 'a4', text: 'Ducha', energy: 'baja' },
    { id: 'a5', text: 'Dejar la comida de mañana preparada', energy: 'media' },
    { id: 'a6', text: 'Salir ya hacia la uni y estudiar allí', energy: 'media' },
    { id: 'a7', text: 'Hacer la cama y recoger la mesa', energy: 'media' },
    { id: 'a8', text: 'Salir a correr 20 minutos', energy: 'alta' },
  ],
  apps: [
    { id: 'instagram', name: 'Instagram', url: 'instagram://app' },
    { id: 'youtube', name: 'YouTube', url: 'youtube://' },
    { id: 'x', name: 'X', url: 'https://x.com' },
  ],
  notif: { nightPrep: true, nightPark: true, morningHello: true, morningNudge: true, maxPerDay: 4 },
};

function mergeSettings(saved) {
  const s = { ...DEFAULT_SETTINGS, ...(saved || {}) };
  s.notif = { ...DEFAULT_SETTINGS.notif, ...((saved && saved.notif) || {}) };
  return s;
}

const ENERGY_LABEL = { baja: 'baja', media: 'media', alta: 'alta' };

function energyFromVitals(v) {
  if (!v || v.battery_max == null) return null;
  const sleepH = (v.sleep_seconds || 0) / 3600;
  const score = v.sleep_score ?? 60;
  if (v.battery_max < 55 || (v.sleep_seconds && sleepH < 5.5) || score < 50) return 'baja';
  if (v.battery_max >= 75 && score >= 65) return 'alta';
  return 'media';
}

// Hora local (minutos desde medianoche) a la que empezó el sueño de una fila de Garmin.
function bedtimeMinutes(v, tz) {
  if (!v || !v.sleep_start) return null;
  if (v.sleep_offset_min != null) {
    const d = new Date(v.sleep_start + v.sleep_offset_min * 60e3);
    return d.getUTCHours() * 60 + d.getUTCMinutes();
  }
  return parts(new Date(v.sleep_start), tz).minutes;
}

// Pasa la hora de acostarse a una escala continua alrededor de medianoche: 22:00 -> -120, 02:00 -> 120.
// Devuelve null para "noches" raras (siestas, viajes con otro huso), entre 08:00 y 19:00.
function bedtimeAroundMidnight(mins) {
  if (mins == null) return null;
  if (mins >= 8 * 60 && mins < 19 * 60) return null;
  return mins >= 19 * 60 ? mins - 1440 : mins;
}

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function vitalsInsight(rows, tz) {
  const early = [];
  const late = [];
  const recentBed = [];
  const recent = rows.slice(-14);
  for (const v of rows) {
    const b = bedtimeAroundMidnight(bedtimeMinutes(v, tz));
    if (b == null || v.battery_max == null) continue;
    if (b < 60) early.push(v);
    else if (b >= 120) late.push(v);
  }
  for (const v of recent) {
    const b = bedtimeAroundMidnight(bedtimeMinutes(v, tz));
    if (b != null) recentBed.push(b);
  }
  const steps = (list) => avg(list.map((v) => v.steps).filter((x) => x != null));
  const prev = rows.slice(-42, -14);
  const out = {
    nights: rows.length,
    avgBedtimeRecent: recentBed.length ? fmtHm(avg(recentBed)) : null,
    stepsRecent: steps(recent) != null ? Math.round(steps(recent)) : null,
    stepsBefore: steps(prev) != null ? Math.round(steps(prev)) : null,
  };
  if (early.length >= 3 && late.length >= 3) {
    out.early = {
      n: early.length,
      battery: Math.round(avg(early.map((v) => v.battery_max))),
      sleepScore: Math.round(avg(early.map((v) => v.sleep_score).filter((x) => x != null))),
    };
    out.late = {
      n: late.length,
      battery: Math.round(avg(late.map((v) => v.battery_max))),
      sleepScore: Math.round(avg(late.map((v) => v.sleep_score).filter((x) => x != null))),
    };
  }
  return out;
}

function normalizeVitals(input) {
  const days = Array.isArray(input) ? input : input?.data?.days || input?.days || [];
  const keep = [
    'date', 'steps', 'resting_hr', 'sleep_seconds', 'sleep_score', 'sleep_start', 'sleep_end',
    'sleep_offset_min', 'battery_min', 'battery_max', 'battery_end', 'avg_stress', 'hrv', 'hrv_status',
  ];
  return days
    .filter((d) => d && /^\d{4}-\d{2}-\d{2}$/.test(d.date))
    .map((d) => Object.fromEntries(keep.map((k) => [k, d[k] ?? null])));
}

function isMonday(date) {
  return new Date(`${date}T12:00:00Z`).getUTCDay() === 1;
}

function weekStart(date) {
  let d = date;
  while (!isMonday(d)) d = addDays(d, -1);
  return d;
}

// Resumen de un día concreto a partir de los eventos.
function summarizeDay(date, events, tz) {
  const today = events.filter((e) => localDate(e.at, tz) === date);
  const nightBefore = events.filter((e) => nightKey(e.at, tz) === addDays(date, -1));
  const tonight = events.filter((e) => nightKey(e.at, tz) === date);
  const stepsDone = [...new Set(today.filter((e) => e.type === 'morning_step').map((e) => e.data.stepId))];
  const energyEv = today.filter((e) => e.type === 'energy').pop();
  const planEv = nightBefore.filter((e) => e.type === 'plan_tomorrow').pop();
  const choices = today.filter((e) => e.type === 'pause_choice');
  return {
    date,
    stepsDone,
    morningDone: today.some((e) => e.type === 'morning_done'),
    energyManual: energyEv ? energyEv.data.level : null,
    plan: planEv ? planEv.data.text : null,
    parkedLastNight: nightBefore.some((e) => e.type === 'park'),
    parkedTonight: tonight.some((e) => e.type === 'park'),
    planTonight: (tonight.filter((e) => e.type === 'plan_tomorrow').pop() || {}).data?.text || null,
    pauses: today.filter((e) => e.type === 'gate_pause').length,
    redirected: choices.filter((e) => e.data.choice !== 'entrar').length,
    entered: choices.filter((e) => e.data.choice === 'entrar').length,
    altsDone: today.filter((e) => e.type === 'alt_done').length,
  };
}

const MESSAGES = {
  nightPrep: {
    cercano: [
      ['Media hora para aparcar el móvil', 'Elige ya lo primero de mañana. Mañana-tú te lo agradece.'],
      ['Se acerca la hora', 'En 30 min el móvil se va a cargar fuera del cuarto. Deja elegido lo de mañana.'],
    ],
    directo: [
      ['30 minutos', 'Elige lo de mañana y prepárate para dejar el móvil fuera.'],
    ],
  },
  nightPark: {
    cercano: [
      ['Hora de aparcar el móvil', 'Fuera del cuarto, a cargar. Lo de mañana empieza ahora.'],
      ['Buenas noches 🌙', 'Deja el móvil fuera y pulsa "Aparcado". Nada de lo que hay ahí dentro es urgente.'],
    ],
    directo: [
      ['Móvil fuera', 'Es la hora. Al cargador fuera del cuarto y a dormir.'],
    ],
  },
  morningHello: {
    cercano: [
      ['Buenos días', 'Solo una cosa: {step}. Nada más de momento.'],
      ['Arriba, poco a poco', 'Primer paso: {step}. El resto viene solo.'],
    ],
    directo: [
      ['Buenos días', 'Paso 1: {step}. Ya.'],
    ],
  },
  morningNudge: {
    cercano: [
      ['¿Cómo va la mañana?', 'Siguiente paso: {step}. Si hoy cuesta, haz la versión mínima.'],
    ],
    directo: [
      ['La mañana sigue ahí', 'Siguiente: {step}. Suelta el móvil.'],
    ],
  },
  allowOver: {
    cercano: [['Han pasado {min} minutos', 'Buen momento para salir. ¿Qué tenías pensado hacer?']],
    directo: [['{min} minutos', 'Tiempo cumplido. Cierra y a otra cosa.']],
  },
};

function message(kind, tone, vars = {}) {
  const list = MESSAGES[kind][tone] || MESSAGES[kind].cercano;
  const [title, body] = list[Math.floor(Math.random() * list.length)];
  const fill = (s) => s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : ''));
  return { title: fill(title), body: fill(body) };
}

// Notificaciones programadas que tocan ahora mismo (ventana de 10 minutos tras la hora objetivo).
function dueNotifications(settings, nowParts, summary, alreadySent) {
  const wake = hm(settings.wake);
  const bed = hm(settings.bedtime);
  const steps = settings.morningSteps || [];
  const next = steps.find((s) => !summary.stepsDone.includes(s.id));
  const rules = [
    { kind: 'nightPrep', at: bed - 30, when: !summary.parkedTonight },
    { kind: 'nightPark', at: bed, when: !summary.parkedTonight },
    { kind: 'morningHello', at: wake, when: summary.stepsDone.length === 0 && !summary.morningDone },
    { kind: 'morningNudge', at: wake + 45, when: !summary.morningDone && !!next },
  ];
  const out = [];
  for (const r of rules) {
    if (!settings.notif[r.kind] || !r.when || alreadySent.includes(r.kind)) continue;
    const target = ((r.at % 1440) + 1440) % 1440;
    const diff = (nowParts.minutes - target + 1440) % 1440;
    if (diff < 10) out.push({ kind: r.kind, vars: { step: (next || steps[0] || {}).text?.toLowerCase() || '' } });
  }
  return out;
}

module.exports = {
  DEFAULT_SETTINGS,
  ENERGY_LABEL,
  mergeSettings,
  energyFromVitals,
  vitalsInsight,
  normalizeVitals,
  summarizeDay,
  weekStart,
  bedtimeMinutes,
  bedtimeAroundMidnight,
  message,
  dueNotifications,
};
