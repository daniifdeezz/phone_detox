// Utilidades de fecha en la zona horaria del usuario (por defecto Europe/Madrid).

function parts(date, tz) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  const weekdays = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    hour: Number(p.hour),
    minute: Number(p.minute),
    minutes: Number(p.hour) * 60 + Number(p.minute),
    weekday: weekdays[p.weekday],
  };
}

const localDate = (date, tz) => parts(date, tz).date;

// La "noche" de un evento: antes de las 6:00 cuenta como la noche del día anterior.
const nightKey = (date, tz) => localDate(new Date(date.getTime() - 6 * 3600e3), tz);

function addDays(isoDate, n) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// "07:30" -> 450
function hm(str) {
  const [h, m] = String(str || '0:0').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function fmtHm(mins) {
  const m = ((Math.round(mins) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

module.exports = { parts, localDate, nightKey, addDays, hm, fmtHm };
