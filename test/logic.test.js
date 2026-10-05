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

test('conclusión de aparcar a tu hora', () => {
  const at = (h, m) => h * 60 + m;
  const days = [
    { parkedAt: at(23, 50), win: true }, { parkedAt: at(0, 10), win: true }, { parkedAt: at(23, 40), win: false },
    { parkedAt: at(2, 0), win: false }, { parkedAt: null, win: false }, { parkedAt: null, win: true },
  ];
  const r = L.parkingInsight(days, '00:00');
  assert.deepStrictEqual(r.onTime, { n: 3, of10: 7 });
  assert.deepStrictEqual(r.other, { n: 3, of10: 3 });
  assert.strictEqual(L.parkingInsight(days.slice(0, 2), '00:00').onTime, null);
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
