const test = require('node:test');
const assert = require('node:assert');
const L = require('../lib/logic');
const T = require('../lib/time');

const TZ = 'Europe/Madrid';
const at = (iso) => new Date(iso);

test('nightKey: antes de las 6:00 cuenta como la noche anterior', () => {
  assert.strictEqual(T.nightKey(at('2026-10-05T23:30:00+02:00'), TZ), '2026-10-05');
  assert.strictEqual(T.nightKey(at('2026-10-06T01:30:00+02:00'), TZ), '2026-10-05');
  assert.strictEqual(T.nightKey(at('2026-10-06T07:30:00+02:00'), TZ), '2026-10-06');
});

test('summarizeDay junta mañana, plan y aparcado de la noche anterior', () => {
  const ev = [
    { type: 'plan_tomorrow', data: { text: 'Leer' }, at: at('2026-10-05T23:40:00+02:00') },
    { type: 'park', data: {}, at: at('2026-10-06T00:05:00+02:00') },
    { type: 'morning_step', data: { stepId: 's1' }, at: at('2026-10-06T07:35:00+02:00') },
    { type: 'morning_step', data: { stepId: 's1' }, at: at('2026-10-06T07:36:00+02:00') },
    { type: 'gate_pause', data: {}, at: at('2026-10-06T09:00:00+02:00') },
    { type: 'pause_choice', data: { choice: 'alternativa' }, at: at('2026-10-06T09:01:00+02:00') },
  ];
  const s = L.summarizeDay('2026-10-06', ev, TZ);
  assert.deepStrictEqual(s.stepsDone, ['s1']);
  assert.strictEqual(s.plan, 'Leer');
  assert.strictEqual(s.parkedLastNight, true);
  assert.strictEqual(s.pauses, 1);
  assert.strictEqual(s.redirected, 1);
  assert.strictEqual(L.summarizeDay('2026-10-05', ev, TZ).parkedTonight, true);
});

test('energía a partir de Garmin', () => {
  assert.strictEqual(L.energyFromVitals({ battery_max: 90, sleep_score: 80, sleep_seconds: 8 * 3600 }), 'alta');
  assert.strictEqual(L.energyFromVitals({ battery_max: 40, sleep_score: 80, sleep_seconds: 8 * 3600 }), 'baja');
  assert.strictEqual(L.energyFromVitals({ battery_max: 80, sleep_score: 70, sleep_seconds: 4 * 3600 }), 'baja');
  assert.strictEqual(L.energyFromVitals({ battery_max: 68, sleep_score: 60, sleep_seconds: 7 * 3600 }), 'media');
  assert.strictEqual(L.energyFromVitals(null), null);
});

test('hora de dormir alrededor de medianoche', () => {
  assert.strictEqual(L.bedtimeAroundMidnight(23 * 60), -60);
  assert.strictEqual(L.bedtimeAroundMidnight(150), 150);
  assert.strictEqual(L.bedtimeAroundMidnight(17 * 60), null);
});

test('notificaciones: solo en su ventana, una vez y si hace falta', () => {
  const s = L.mergeSettings({ wake: '07:30', bedtime: '00:00' });
  const base = { stepsDone: [], morningDone: false, parkedTonight: false };
  const at = (h, m) => ({ minutes: h * 60 + m });
  assert.deepStrictEqual(L.dueNotifications(s, at(23, 31), base, []).map((n) => n.kind), ['nightPrep']);
  assert.deepStrictEqual(L.dueNotifications(s, at(0, 2), base, []).map((n) => n.kind), ['nightPark']);
  assert.deepStrictEqual(L.dueNotifications(s, at(0, 2), { ...base, parkedTonight: true }, []), []);
  assert.deepStrictEqual(L.dueNotifications(s, at(7, 30), base, []).map((n) => n.kind), ['morningHello']);
  assert.deepStrictEqual(L.dueNotifications(s, at(7, 30), base, ['morningHello']), []);
  assert.deepStrictEqual(L.dueNotifications(s, at(8, 20), base, []).map((n) => n.kind), ['morningNudge']);
  assert.deepStrictEqual(L.dueNotifications(s, at(8, 20), { ...base, morningDone: true }, []), []);
  assert.deepStrictEqual(L.dueNotifications(s, at(12, 0), base, []), []);
});

test('normalizeVitals acepta el export de vitals-lab', () => {
  const rows = L.normalizeVitals({ data: { days: [{ date: '2026-10-05', battery_max: 87, sleep_series: [1, 2], foo: 1 }, { date: 'x' }] } });
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].battery_max, 87);
  assert.ok(!('sleep_series' in rows[0]));
});
