// Reglas de la app: ajustes por defecto, resúmenes del día, conclusiones y avisos.
const { localDate, nightKey, addDays, hm, fmtHm } = require('./time');

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

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

// Pasa una hora a una escala continua alrededor de medianoche: 22:00 -> -120, 02:00 -> 120.
const aroundMidnight = (mins) => (mins >= 12 * 60 ? mins - 1440 : mins);

// Conclusión a partir de tus propios datos: ¿ganas más mañanas cuando aparcas el móvil a tu hora?
// days: [{ parkedAt: minutos locales o null, win: bool }] (parkedAt es la noche anterior a ese día)
function parkingInsight(days, bedtime) {
  const limit = aroundMidnight(hm(bedtime)) + 30;
  const onTime = days.filter((d) => d.parkedAt != null && aroundMidnight(d.parkedAt) <= limit);
  const other = days.filter((d) => !(d.parkedAt != null && aroundMidnight(d.parkedAt) <= limit));
  const parkedTimes = days.filter((d) => d.parkedAt != null).map((d) => aroundMidnight(d.parkedAt));
  const rate = (xs) => Math.round((xs.filter((d) => d.win).length / xs.length) * 10);
  return {
    avgParkedAt: parkedTimes.length ? fmtHm(avg(parkedTimes)) : null,
    onTime: onTime.length >= 3 && other.length >= 3 ? { n: onTime.length, of10: rate(onTime) } : null,
    other: onTime.length >= 3 && other.length >= 3 ? { n: other.length, of10: rate(other) } : null,
  };
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
    parkedLastNightAt: (nightBefore.find((e) => e.type === 'park') || {}).at || null,
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
  focusOver: {
    cercano: [['Sesión terminada', '{min} minutos sin móvil. Bien hecho.']],
    directo: [['Hecho', '{min} minutos sin móvil.']],
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
  mergeSettings,
  parkingInsight,
  summarizeDay,
  weekStart,
  message,
  dueNotifications,
};
