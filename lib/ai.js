// IA vía OpenRouter (API compatible con OpenAI). Si no hay clave o algo falla, devuelve null
// y la app usa sus textos fijos: la IA nunca es imprescindible.

const BASE_URL = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
const MODEL = process.env.OPENROUTER_MODEL || 'anthropic/claude-haiku-4.5';
const DAILY_LIMIT = Number(process.env.AI_DAILY_LIMIT) || 80;

const configured = () => !!process.env.OPENROUTER_API_KEY;

const SYSTEM = `Eres la voz de "Mañanas", una app que ayuda a una persona a usar menos el móvil y recuperar sus mañanas.
Cómo hablas:
- En español de España, de tú, cercano y tranquilo. Nunca culpa, nunca sermones, nunca diagnósticos.
- Muy breve. Frases cortas y concretas. Sin emojis, sin listas, sin comillas.
- Propones acciones físicas, pequeñas y posibles ahora mismo, adaptadas a la hora y a la energía.
- Si la energía es baja, propones lo mínimo. El objetivo es empezar, no hacerlo perfecto.
- Nunca propones usar el móvil, redes sociales ni vídeos.
Respondes SOLO con un objeto JSON válido, sin texto alrededor.`;

function extractJson(text) {
  const match = String(text || '').match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

const clean = (s, max) => String(s || '').replace(/\s+/g, ' ').replace(/^["«]|["»]$/g, '').trim().slice(0, max);

async function underLimit(store, date) {
  const key = `ai_calls:${date}`;
  const n = await store.get(key, 0);
  if (n >= DAILY_LIMIT) return false;
  await store.set(key, n + 1);
  return true;
}

async function complete({ store, date, prompt, maxTokens = 200, timeoutMs = 8000 }) {
  if (!configured() || !(await underLimit(store, date))) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'HTTP-Referer': process.env.PUBLIC_URL || 'https://mananas.app',
        'X-Title': 'Mananas',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens,
        temperature: 0.8,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: prompt },
        ],
      }),
    });
    if (!res.ok) throw new Error(`OpenRouter HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    return extractJson(data.choices?.[0]?.message?.content);
  } catch (err) {
    console.error('ia', err.name === 'AbortError' ? 'tiempo agotado' : err.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const about = (s) => (s.aboutMe ? `Sobre la persona: ${s.aboutMe}\n` : '');

// Parte un paso de la mañana en algo que se pueda hacer en 10 segundos.
async function smallerStep({ store, date, settings, step, time, energy }) {
  const out = await complete({
    store,
    date,
    prompt: `${about(settings)}Son las ${time}. Energía: ${energy || 'sin indicar'}.
Le está costando este paso de su mañana: "${step}".
Propón un micro-paso que lleve menos de 10 segundos y que sea el primer movimiento físico hacia ese paso.
JSON: {"paso": "máximo 10 palabras, en imperativo"}`,
    maxTokens: 80,
  });
  const paso = clean(out?.paso, 90);
  return paso ? { step: paso } : null;
}

// Sugerencia para la pausa antes de abrir una app.
async function pauseSuggestion({ store, date, settings, context, avoid }) {
  const alts = (settings.alternatives || []).map((a) => `${a.text} (energía ${a.energy})`).join('; ');
  const out = await complete({
    store,
    date,
    prompt: `${about(settings)}Contexto: ${context}
Ideas que la persona ha apuntado como alternativas: ${alts || 'ninguna'}.
${avoid.length ? `No repitas estas sugerencias: ${avoid.join('; ')}.\n` : ''}Propón UNA cosa concreta para hacer ahora en lugar de abrir la app. Puede ser de su lista o una nueva.
JSON: {"accion": "máximo 9 palabras, en imperativo", "motivo": "una frase de máximo 14 palabras que conecte con su situación"}`,
    maxTokens: 120,
  });
  const accion = clean(out?.accion, 90);
  return accion ? { action: accion, reason: clean(out?.motivo, 140) } : null;
}

// Lectura breve de la semana a partir del resumen de datos.
async function weekReflection({ store, date, settings, summary }) {
  const out = await complete({
    store,
    date,
    prompt: `${about(settings)}Datos de sus últimos 14 días, del más antiguo al más reciente:
${summary}
Escribe una lectura breve: qué ha funcionado (si algo) y UN solo ajuste concreto para los próximos días.
Si hay pocos datos, anímale a seguir sin inventar conclusiones.
JSON: {"texto": "2 o 3 frases, máximo 55 palabras en total"}`,
    maxTokens: 220,
    timeoutMs: 15000,
  });
  const texto = clean(out?.texto, 420);
  return texto || null;
}

module.exports = { configured, smallerStep, pauseSuggestion, weekReflection, MODEL, extractJson };
