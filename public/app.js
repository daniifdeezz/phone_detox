/* Mañanas — PWA sin dependencias. Rutas por hash: #/, #/manana, #/noche, #/pausa, #/progreso, #/candado, #/ajustes, #/atajos */
(() => {
  'use strict';

  const $app = document.getElementById('app');
  const $nav = document.getElementById('nav');
  const $toast = document.getElementById('toast');

  // ---------- utilidades ----------

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* sin almacenamiento */ } },
  };

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const shuffle = (xs) => xs.map((x) => [Math.random(), x]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);

  function toast(msg, ms = 2200) {
    $toast.textContent = msg;
    $toast.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => { $toast.hidden = true; }, ms);
  }

  function token() { return store.get('token'); }

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      method: opts.method || (opts.body ? 'POST' : 'GET'),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (res.status === 401) {
      store.del('token');
      location.hash = '#/login';
      throw new Error('no autorizado');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `error ${res.status}`);
    return data;
  }

  const event = (type, data = {}) => api('/api/event', { body: { type, data } });

  function parseHash() {
    const raw = location.hash.replace(/^#\/?/, '');
    const [route, qs] = raw.split('?');
    return { route: route || '', q: new URLSearchParams(qs || '') };
  }

  // Los Atajos abren URLs con ?t=TOKEN: lo guardamos y lo quitamos de la barra.
  function absorbToken() {
    const { route, q } = parseHash();
    const t = q.get('t');
    if (!t) return;
    store.set('token', t);
    q.delete('t');
    const rest = q.toString();
    history.replaceState(null, '', `${location.pathname}#/${route}${rest ? `?${rest}` : ''}`);
  }

  function view(html, { nav = true } = {}) {
    $app.innerHTML = `<div class="fade">${html}</div>`;
    $nav.hidden = !nav;
    const { route } = parseHash();
    $nav.querySelectorAll('a').forEach((a) => a.classList.toggle('on', a.dataset.r === route));
    window.scrollTo(0, 0);
  }

  function on(sel, evt, fn) {
    $app.querySelectorAll(sel).forEach((el) => el.addEventListener(evt, (e) => fn(e, el)));
  }

  const greeting = (h) => (h < 6 ? 'Es tarde' : h < 13 ? 'Buenos días' : h < 21 ? 'Buenas tardes' : 'Buenas noches');
  const ENERGY_TEXT = { baja: 'Me arrastro', media: 'Normal', alta: 'Con ganas' };
  const WEEKDAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

  function activeSteps(S) {
    const steps = S.settings.morningSteps || [];
    return S.energy === 'baja' ? steps.filter((s) => s.min) : steps;
  }

  function weekDots(S) {
    return `<div class="week">${S.week.map((d, i) => `
      <div class="day">
        <div class="dot ${d.win ? 'win' : ''} ${d.date === S.local.date ? 'today' : ''} ${d.future ? 'future' : ''}">${d.win ? '☀' : ''}</div>
        ${WEEKDAYS[i]}
      </div>`).join('')}</div>`;
  }

  function pickAlternative(S, energy, exclude = []) {
    const alts = S.settings.alternatives || [];
    const order = { baja: ['baja'], media: ['baja', 'media'], alta: ['media', 'alta', 'baja'] }[energy || 'media'];
    const pool = alts.filter((a) => order.includes(a.energy) && !exclude.includes(a.id));
    return shuffle(pool.length ? pool : alts)[0] || { id: 'x', text: 'Levántate y bebe un vaso de agua' };
  }

  // ---------- pantallas ----------

  function renderLogin() {
    view(`
      <p class="eyebrow">Mañanas</p>
      <h1>Hola</h1>
      <p class="muted">Introduce el código de acceso (la variable <b>APP_TOKEN</b> de Railway).</p>
      <form id="f">
        <input id="tok" autocomplete="current-password" type="password" placeholder="Código" required>
        <button type="submit">Entrar</button>
      </form>`, { nav: false });
    $app.querySelector('#f').addEventListener('submit', async (e) => {
      e.preventDefault();
      const t = $app.querySelector('#tok').value.trim();
      const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: t }) });
      if (!r.ok) return toast('Código incorrecto');
      store.set('token', t);
      location.hash = '#/';
    });
  }

  async function renderHome() {
    const S = await api('/api/state');
    const h = S.local.hour;
    let hero = '';
    if (S.mode === 'manana') {
      const steps = activeSteps(S);
      const next = steps.find((s) => !S.today.stepsDone.includes(s.id));
      hero = `
        <div class="card hero accent">
          <p class="eyebrow">Tu mañana</p>
          <div class="step-now">${esc(next ? next.text : 'Empieza la mañana')}</div>
          ${S.today.plan ? `<p class="muted">Anoche elegiste: <b>${esc(S.today.plan)}</b></p>` : ''}
          <a class="btn big" href="#/manana">Empezar</a>
        </div>`;
    } else if (S.mode === 'noche') {
      hero = `
        <div class="card hero accent">
          <p class="eyebrow">Esta noche</p>
          <div class="step-now">Aparca el móvil fuera del cuarto</div>
          <p class="muted">Dos minutos: eliges lo primero de mañana y lo dejas a cargar.</p>
          <a class="btn big" href="#/noche">Preparar la noche</a>
        </div>`;
    } else if (S.mode === 'aparcado') {
      hero = `
        <div class="card hero">
          <p class="eyebrow">Aparcado</p>
          <div class="step-now">Ya está. Buenas noches 🌙</div>
          <p class="muted">Si estás leyendo esto en la cama, el móvil no está fuera 😉</p>
        </div>`;
    } else {
      hero = `
        <div class="card hero">
          <p class="eyebrow">${S.today.morningDone ? 'Mañana ganada' : 'Ahora'}</p>
          <div class="step-now">${S.today.morningDone ? 'La mañana ya es tuya. El resto del día, también.' : '¿Tienes un rato?'}</div>
          <button id="idea" class="secondary">Dame una idea que no sea el móvil</button>
          <div id="ideaOut"></div>
        </div>`;
    }

    const energy = S.energyAuto
      ? `<p class="small muted">Garmin hoy: batería ${S.vitalsToday.battery_max ?? '–'} · sueño ${S.vitalsToday.sleep_score ?? '–'} → energía <b>${S.energyAuto}</b></p>`
      : '';

    view(`
      <p class="eyebrow">${esc(greeting(h))}</p>
      <h1>${S.totalWins ? `${S.totalWins} ${S.totalWins === 1 ? 'mañana ganada' : 'mañanas ganadas'}` : 'Hoy empieza'}</h1>
      ${energy}
      ${hero}
      <div class="card">
        <h3>Esta semana</h3>
        ${weekDots(S)}
        <p class="small muted">Cada sol es una mañana en la que hiciste tus pasos. No hay rachas que romper: cada semana empieza limpia y el total solo sube.</p>
      </div>
      ${!isStandalone() ? `<div class="card"><h3>Instálala</h3><p class="small muted">En Safari: Compartir → «Añadir a pantalla de inicio». Solo así llegan las notificaciones.</p></div>` : ''}
      <a class="btn secondary" href="#/noche">Preparar la noche</a>
      <a class="btn ghost" href="#/atajos">Configurar los Atajos de iOS</a>
    `);

    on('#idea', 'click', () => {
      const a = pickAlternative(S, S.energy);
      $app.querySelector('#ideaOut').innerHTML = `
        <div class="step-now" style="font-size:22px">${esc(a.text)}</div>
        <button id="doIt">Voy</button>`;
      on('#doIt', 'click', async () => {
        await event('alt_done', { alt: a.id, text: a.text });
        toast('Hecho. Deja el móvil y a por ello.');
      });
    });
  }

  async function renderMorning() {
    const S = await api('/api/state');
    if (S.today.morningDone) return renderMorningWin(S);
    if (!S.energy) {
      view(`
        <p class="eyebrow">Buenos días</p>
        <h1>¿Cómo te has levantado?</h1>
        <p class="muted">Sin juzgar. Si la energía está baja, hoy toca la versión mínima, y cuenta igual.</p>
        ${Object.entries(ENERGY_TEXT).map(([k, v]) => `<button class="${k === 'media' ? '' : 'secondary'} big" data-e="${k}">${v}</button>`).join('')}
      `, { nav: false });
      on('[data-e]', 'click', async (e, el) => {
        await event('energy', { level: el.dataset.e });
        renderMorning();
      });
      return;
    }
    const steps = activeSteps(S);
    const done = S.today.stepsDone;
    const next = steps.find((s) => !done.includes(s.id));
    if (!next) {
      await event('morning_done', { energy: S.energy, steps: done.length });
      return renderMorning();
    }
    const idx = steps.indexOf(next);
    view(`
      <p class="eyebrow">Paso ${idx + 1} de ${steps.length}${S.energy === 'baja' ? ' · versión mínima' : ''}</p>
      <div class="step-now" style="font-size:34px;margin-top:28px">${esc(next.text)}</div>
      ${S.today.plan ? `<p class="muted">Y luego: <b>${esc(S.today.plan)}</b></p>` : ''}
      <button class="big" id="done" style="margin-top:28px">Hecho</button>
      <ul class="steps">
        ${steps.map((s) => `
          <li class="${done.includes(s.id) ? 'done' : ''} ${s.id === next.id ? 'current' : ''}" data-s="${s.id}">
            <span class="check">${done.includes(s.id) ? '✓' : ''}</span>
            <span class="t">${esc(s.text)}</span>
          </li>`).join('')}
      </ul>
      <p class="small muted" style="margin-top:22px">Energía${S.today.energyManual ? '' : ' (según Garmin)'}:</p>
      <div class="chips">${Object.entries(ENERGY_TEXT).map(([k, v]) => `<button class="chip ${S.energy === k ? 'on' : ''}" data-lvl="${k}">${v}</button>`).join('')}</div>
      <p class="small muted center">Haz el paso y vuelve a pulsar. Entre paso y paso, el móvil boca abajo.</p>
    `, { nav: false });
    const mark = async (id) => {
      await event('morning_step', { stepId: id });
      renderMorning();
    };
    on('#done', 'click', () => mark(next.id));
    on('li[data-s]', 'click', (e, el) => { if (!done.includes(el.dataset.s)) mark(el.dataset.s); });
    on('[data-lvl]', 'click', async (e, el) => {
      if (el.dataset.lvl === S.energy) return;
      await event('energy', { level: el.dataset.lvl });
      renderMorning();
    });
  }

  function renderMorningWin(S) {
    view(`
      <div class="center" style="margin-top:40px">
        <div style="font-size:72px">☀</div>
        <h1>Mañana ganada</h1>
        <p class="muted">Llevas <b>${S.totalWins}</b> en total. Esta semana:</p>
      </div>
      ${weekDots(S)}
      <div class="card">
        <h3>¿Y ahora?</h3>
        <p>${S.today.plan ? `Lo que elegiste anoche: <b>${esc(S.today.plan)}</b>.` : 'Lo siguiente: salir de casa. La uni, la biblioteca, un café. Fuera es más fácil.'}</p>
      </div>
      <a class="btn" href="#/">Listo</a>
    `);
  }

  async function renderNight() {
    const S = await api('/api/state');
    if (S.tonight.parked) {
      view(`
        <div class="center" style="margin-top:40px">
          <div style="font-size:64px">🌙</div>
          <h1>Buenas noches</h1>
          <p class="muted">Mañana a las <b>${esc(S.settings.wake)}</b>.${S.tonight.plan ? ` Lo primero: <b>${esc(S.tonight.plan)}</b>.` : ''}</p>
          <p class="muted">El móvil se queda fuera. Lo que hay ahí dentro seguirá ahí mañana.</p>
        </div>`);
      return;
    }
    const alts = S.settings.alternatives || [];
    view(`
      <p class="eyebrow">Esta noche · 2 minutos</p>
      <h1>Deja la mañana preparada</h1>
      <div class="card">
        <h3>1 · Mañana, después de tus pasos, lo primero será…</h3>
        <div class="chips">${alts.map((a) => `<button class="chip ${S.tonight.plan === a.text ? 'on' : ''}" data-p="${esc(a.text)}">${esc(a.text)}</button>`).join('')}</div>
        <input id="plan" placeholder="Otra cosa…" value="${esc(S.tonight.plan && !alts.some((a) => a.text === S.tonight.plan) ? S.tonight.plan : '')}">
      </div>
      <div class="card">
        <h3>2 · El móvil, fuera del cuarto</h3>
        <p class="muted small">Al cargador del salón o la cocina, con la alarma puesta a las ${esc(S.settings.wake)}. Cuando suene tendrás que levantarte para apagarla, y eso ya es medio trabajo hecho.</p>
        <button class="big" id="park">Aparcado</button>
      </div>
    `);
    let plan = S.tonight.plan || '';
    on('[data-p]', 'click', (e, el) => {
      plan = el.dataset.p;
      $app.querySelectorAll('[data-p]').forEach((c) => c.classList.toggle('on', c === el));
      $app.querySelector('#plan').value = '';
    });
    on('#park', 'click', async () => {
      const custom = $app.querySelector('#plan').value.trim();
      const finalPlan = custom || plan;
      if (finalPlan && finalPlan !== S.tonight.plan) await event('plan_tomorrow', { text: finalPlan });
      await event('park');
      renderNight();
    });
  }

  async function renderPause() {
    const { q } = parseHash();
    const appId = q.get('app') || 'app';
    const finished = q.get('fin') === '1';
    const S = await api('/api/state');
    const appDef = (S.settings.apps || []).find((a) => a.id === appId) || { id: appId, name: appId, url: '' };
    let reason = null;
    const seen = [];

    const breath = () => {
      let n = 8;
      view(`
        <p class="eyebrow center">${esc(appDef.name)}</p>
        <h1 class="center">Un momento</h1>
        <div class="breath"><div class="circle" id="n">${n}</div></div>
        <p class="center muted">Inspira mientras crece, suelta mientras encoge.<br>${esc(appDef.name)} va a seguir ahí.</p>
      `, { nav: false });
      const timer = setInterval(() => {
        n -= 1;
        const el = $app.querySelector('#n');
        if (el) el.textContent = n > 0 ? n : '';
        if (n <= 0) { clearInterval(timer); ask(); }
      }, 1000);
    };

    const ask = () => {
      view(`
        <p class="eyebrow">Hoy: ${S.today.pauses} ${S.today.pauses === 1 ? 'intento' : 'intentos'} · ${S.today.redirected} veces elegiste otra cosa</p>
        <h1>¿Qué te ha traído aquí?</h1>
        <button class="secondary" data-r="concreto">Busco algo concreto</button>
        <button class="secondary" data-r="cansancio">Cansancio, no me da para más</button>
        <button class="secondary" data-r="aburrimiento">Aburrimiento</button>
        <button class="secondary" data-r="inercia">Ni lo he pensado</button>
        <button class="secondary" data-r="evitar">Estoy evitando algo</button>
      `, { nav: false });
      on('[data-r]', 'click', (e, el) => { reason = el.dataset.r; suggest(); });
    };

    const suggest = () => {
      const morningPending = S.mode === 'manana' && !S.today.morningDone;
      const nextStep = activeSteps(S).find((s) => !S.today.stepsDone.includes(s.id));
      const energy = reason === 'cansancio' ? 'baja' : S.energy;
      const alt = pickAlternative(S, energy, seen);
      seen.push(alt.id);
      const lines = {
        concreto: 'Vale. Entra, busca eso y sal. Te aviso cuando pase el tiempo.',
        cansancio: 'El scroll no descansa: cansa más. Prueba algo de energía baja que sí recarga.',
        aburrimiento: 'El aburrimiento dura dos minutos si no lo tapas. Prueba esto:',
        inercia: 'Ha sido el piloto automático. Ya lo has pillado, y eso es lo difícil.',
        evitar: 'Hacer solo los primeros 2 minutos de eso que evitas suele bastar para arrancar.',
        fin: 'Se acabó el tiempo. Buen momento para cerrar.',
      };
      const main = morningPending && nextStep
        ? { text: nextStep.text, href: '#/manana', label: 'Volver a mi mañana' }
        : { text: alt.text, label: 'Lo hago' };
      view(`
        <p class="eyebrow">${esc(lines[reason] || '')}</p>
        <div class="card hero accent">
          <div class="step-now">${esc(main.text)}</div>
          <button class="big" id="go">${main.label}</button>
          ${main.href ? '' : '<button class="ghost" id="other">Otra idea</button>'}
        </div>
        ${finished ? '' : `<button class="${reason === 'concreto' ? '' : 'secondary'}" id="enter">Entrar ${S.settings.allowMinutes} min en ${esc(appDef.name)}</button>`}
        <a class="btn ghost" href="#/">Cerrar</a>
      `, { nav: false });
      on('#other', 'click', suggest);
      on('#go', 'click', async () => {
        await event('pause_choice', { app: appId, reason, choice: main.href ? 'manana' : 'alternativa', alt: main.href ? null : alt.id });
        if (main.href) return void (location.hash = main.href);
        await event('alt_done', { alt: alt.id, text: alt.text });
        view(`
          <div class="center" style="margin-top:60px">
            <div style="font-size:64px">👏</div>
            <h1>Bien elegido</h1>
            <p class="muted">Bloquea la pantalla y a por ello. El móvil, boca abajo.</p>
          </div>
          <a class="btn secondary" href="#/">Inicio</a>`);
      });
      on('#enter', 'click', async () => {
        await api('/api/allow', { body: { app: appId, minutes: S.settings.allowMinutes } });
        await event('pause_choice', { app: appId, reason, choice: 'entrar' });
        toast(`Te aviso en ${S.settings.allowMinutes} min`);
        if (appDef.url) setTimeout(() => { location.href = appDef.url; }, 400);
      });
    };

    if (finished) { reason = 'fin'; suggest(); } else breath();
  }

  async function renderProgress() {
    const [S, P] = await Promise.all([api('/api/state'), api('/api/progress')]);
    const wins = P.days.filter((d) => d.win).length;
    const parked = P.days.filter((d) => d.parked).length;
    const pauses = P.days.reduce((a, d) => a + d.pauses, 0);
    const redirected = P.days.reduce((a, d) => a + d.redirected, 0);
    const I = P.insight;
    const offset = (new Date(`${P.days[0].date}T12:00:00Z`).getUTCDay() + 6) % 7;
    let garmin = `<p class="muted small">Importa el export de Garmin (vitals-lab, .json) para ver cómo afecta la hora de dormir a tus mañanas.</p>`;
    if (I && I.nights) {
      garmin = '';
      if (I.early && I.late) {
        garmin += `<p>Las noches que te duermes <b>antes de la 1</b>, te levantas con batería <b>${I.early.battery}</b> y sueño <b>${I.early.sleepScore}</b>.
          Cuando es <b>después de las 2</b>: batería <b>${I.late.battery}</b>, sueño <b>${I.late.sleepScore}</b>.</p>
          <p class="small muted">${I.early.n} noches frente a ${I.late.n}. La mañana se gana (o se pierde) la noche anterior.</p>`;
      }
      if (I.avgBedtimeRecent) garmin += `<div class="stats"><div class="stat"><b>${I.avgBedtimeRecent}</b><span>hora media de dormirte (14 días)</span></div>
        <div class="stat"><b>${I.stepsRecent?.toLocaleString('es') ?? '–'}</b><span>pasos/día (14 días)${I.stepsBefore ? ` · antes ${I.stepsBefore.toLocaleString('es')}` : ''}</span></div></div>`;
    }
    view(`
      <p class="eyebrow">Últimas 4 semanas</p>
      <h1>Progreso</h1>
      <div class="card">
        <h3>Esta semana</h3>
        ${weekDots(S)}
      </div>
      <div class="stats">
        <div class="stat"><b>${wins}</b><span>mañanas ganadas</span></div>
        <div class="stat"><b>${parked}</b><span>noches con el móvil fuera</span></div>
        <div class="stat"><b>${pauses}</b><span>pausas antes de abrir apps</span></div>
        <div class="stat"><b>${pauses ? Math.round((redirected / pauses) * 100) : 0}%</b><span>veces que elegiste otra cosa</span></div>
      </div>
      <div class="card">
        <h3>28 días</h3>
        <div class="grid28">
          ${'<div></div>'.repeat(offset)}
          ${P.days.map((d) => `<div class="cell ${d.win ? 'win' : ''} ${d.parked ? 'parked' : ''}" title="${d.date}">${Number(d.date.slice(8))}</div>`).join('')}
        </div>
        <p class="small muted">Relleno: mañana ganada. Raya verde: la noche anterior dejaste el móvil fuera.</p>
      </div>
      <div class="card">
        <h3>Sueño y energía (Garmin)</h3>
        ${garmin}
        <label for="vf" class="btn secondary" style="font-weight:600">Importar export de Garmin</label>
        <input id="vf" type="file" accept="application/json,.json" hidden>
      </div>
    `);
    on('#vf', 'change', async (e, el) => {
      const file = el.files[0];
      if (!file) return;
      try {
        const json = JSON.parse(await file.text());
        const r = await api('/api/vitals/import', { body: json });
        toast(`${r.imported} días importados`);
        renderProgress();
      } catch (err) { toast(err.message); }
    });
  }

  async function renderLock() {
    const L = await api('/api/lock');
    const S = await api('/api/state');
    const setup = `
      <details class="card">
        <summary><b>Qué poner en Tiempo de uso</b></summary>
        <ol class="guide small">
          <li><b>Ajustes → Tiempo de uso → Bloquear ajustes de Tiempo de uso</b> (o «Usar código»): mete el código de aquí.</li>
          <li><b>Límites de uso → Añadir límite</b>: Instagram, YouTube y, en «Sitios web», <code>x.com</code>, <code>instagram.com</code> y <code>youtube.com</code>. Pon 15–20 min al día y activa «Bloquear al final del límite».</li>
          <li><b>Contenido y privacidad → Compras en iTunes y App Store → Instalar apps: No permitir.</b> Así no puedes reinstalar Instagram en un mal momento.</li>
          <li>Opcional: <b>Tiempo de inactividad</b> de ${esc(S.settings.bedtime)} a ${esc(S.settings.wake)}, dejando permitidos solo Teléfono, Mensajes y Reloj.</li>
        </ol>
        <p class="small muted">Los nombres pueden cambiar un poco según la versión de iOS. Si olvidas el código, Apple deja restablecerlo con tu Apple ID: es una salida de emergencia, no un truco.</p>
      </details>`;

    if (!L.exists) {
      view(`
        <p class="eyebrow">Candado</p>
        <h1>Un código de Tiempo de uso que no te sabes</h1>
        <p class="muted">Los límites no funcionan si te sabes el código. La app genera uno, lo pones en Tiempo de uso y desaparece.
          Solo vuelve a aparecer cuando <b>completas tu mañana</b> o después de <b>esperar ${L.waitMinutes} minutos</b>, que es tiempo de sobra para que se pase el impulso.</p>
        <button id="new">Crear código</button>
        ${setup}`);
      on('#new', 'click', async () => { await api('/api/lock/new', { method: 'POST' }); renderLock(); });
      return;
    }

    if (L.pendingCode) {
      view(`
        <p class="eyebrow">Candado</p>
        ${L.previousCode ? `
          <h1>Aquí tienes</h1>
          <p>Código actual, para entrar en Tiempo de uso:</p>
          <div class="code">${esc(L.previousCode)}</div>
          <p>Cuando acabes, ve a <b>Tiempo de uso → Cambiar código</b> y pon el nuevo:</p>`
        : `<h1>Tu nuevo código</h1>
          <p>Ponlo ahora en <b>Ajustes → Tiempo de uso → Bloquear ajustes</b>. Después pulsa «Ya está» y no volverás a verlo.</p>`}
        <div class="code">${esc(L.pendingCode)}</div>
        <button id="ok">Ya está, escóndelo</button>
        ${L.previousCode ? '' : '<button class="ghost" id="cancel">Cancelar</button>'}
        <p class="small muted">Por seguridad, se esconde solo a los 30 minutos.</p>
        ${setup}`);
      on('#ok', 'click', async () => { await api('/api/lock/confirm', { method: 'POST' }); toast('Escondido'); renderLock(); });
      on('#cancel', 'click', async () => { await api('/api/lock/forget', { method: 'POST' }); renderLock(); });
      return;
    }

    const waitLeft = L.waitEnds ? Math.max(0, Math.ceil((new Date(L.waitEnds) - Date.now()) / 1000)) : null;
    view(`
      <p class="eyebrow">Candado puesto</p>
      <h1>🔒 Límites protegidos</h1>
      <p class="muted">Desde el ${new Date(L.setAt).toLocaleDateString('es', { day: 'numeric', month: 'long' })}.</p>
      ${L.canReveal ? `
        <div class="card"><p>${L.morningDone ? 'Has completado tu mañana, así que puedes ver el código.' : 'Ya has esperado.'} Al verlo se generará uno nuevo para que vuelvas a cerrarlo.</p>
        <button id="reveal">Ver el código</button></div>`
      : `
        <div class="card">
          <h3>¿Necesitas el código?</h3>
          <p class="muted small">Dos formas: completa tu mañana, o espera ${L.waitMinutes} minutos. Si dentro de ${L.waitMinutes} minutos lo sigues necesitando, será por algo.</p>
          ${waitLeft != null
            ? `<div class="code" id="cd">${Math.floor(waitLeft / 60)}:${String(waitLeft % 60).padStart(2, '0')}</div>`
            : `<button class="secondary" id="wait">Empezar a esperar ${L.waitMinutes} min</button>`}
          ${!L.morningDone ? '<a class="btn" href="#/manana">Ir a mi mañana</a>' : ''}
        </div>`}
      ${setup}`);
    on('#reveal', 'click', async () => { await api('/api/lock/reveal', { method: 'POST' }); renderLock(); });
    on('#wait', 'click', async () => { await api('/api/lock/wait', { method: 'POST' }); renderLock(); });
    if (waitLeft != null) {
      let left = waitLeft;
      const t = setInterval(() => {
        const el = $app.querySelector('#cd');
        if (!el) return clearInterval(t);
        left -= 1;
        if (left <= 0) { clearInterval(t); renderLock(); return; }
        el.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
      }, 1000);
    }
  }

  async function renderSettings() {
    const S = await api('/api/state');
    const s = S.settings;
    const stepsText = s.morningSteps.map((x) => `${x.min ? '* ' : ''}${x.text}`).join('\n');
    const altsBy = (e) => s.alternatives.filter((a) => a.energy === e).map((a) => a.text).join('\n');
    const pushState = !('serviceWorker' in navigator) || !('PushManager' in window)
      ? (isStandalone() ? 'Este navegador no admite notificaciones.' : 'Primero añade la app a la pantalla de inicio (Safari → Compartir → Añadir a pantalla de inicio) y ábrela desde ahí.')
      : `Permiso: ${Notification.permission === 'granted' ? 'concedido' : Notification.permission === 'denied' ? 'denegado (cámbialo en Ajustes del iPhone)' : 'sin pedir'}`;
    view(`
      <p class="eyebrow">Ajustes</p>
      <h1>Ajustes</h1>
      <div class="card">
        <div class="row">
          <div><label for="wake">Me despierto</label><input id="wake" type="time" value="${esc(s.wake)}"></div>
          <div><label for="bed">Móvil fuera a las</label><input id="bed" type="time" value="${esc(s.bedtime)}"></div>
        </div>
        <label for="tone">Tono de los mensajes</label>
        <select id="tone">
          <option value="cercano" ${s.tone === 'cercano' ? 'selected' : ''}>Cercano: amable, sin culpa</option>
          <option value="directo" ${s.tone === 'directo' ? 'selected' : ''}>Directo: corto y firme</option>
        </select>
        <div class="row">
          <div><label for="allow">Minutos al «entrar»</label><input id="allow" type="number" min="1" max="30" value="${s.allowMinutes}"></div>
          <div><label for="lw">Espera del candado</label><input id="lw" type="number" min="5" max="120" value="${s.lockWaitMinutes}"></div>
        </div>
      </div>

      <div class="card">
        <h3>Notificaciones</h3>
        <p class="small muted">${pushState}</p>
        <button class="secondary" id="push">Activar notificaciones</button>
        <div class="switch"><label for="n1">30 min antes: prepara la noche</label><input type="checkbox" id="n1" ${s.notif.nightPrep ? 'checked' : ''}></div>
        <div class="switch"><label for="n2">Hora de aparcar el móvil</label><input type="checkbox" id="n2" ${s.notif.nightPark ? 'checked' : ''}></div>
        <div class="switch"><label for="n3">Buenos días + primer paso</label><input type="checkbox" id="n3" ${s.notif.morningHello ? 'checked' : ''}></div>
        <div class="switch"><label for="n4">Recordatorio a los 45 min si la mañana sigue a medias</label><input type="checkbox" id="n4" ${s.notif.morningNudge ? 'checked' : ''}></div>
        <div class="switch"><label for="nmax">Máximo al día</label><input id="nmax" type="number" min="0" max="8" value="${s.notif.maxPerDay}" style="width:80px"></div>
        <button class="ghost" id="test">Enviar una de prueba</button>
      </div>

      <div class="card">
        <h3>Pasos de la mañana</h3>
        <p class="small muted">Uno por línea. Los que empiezan por <b>*</b> forman la versión mínima, la de los días sin energía.</p>
        <textarea id="steps">${esc(stepsText)}</textarea>
      </div>

      <div class="card">
        <h3>Alternativas al móvil</h3>
        <p class="small muted">Una por línea. Se proponen según tu energía.</p>
        <label for="ab">Energía baja</label><textarea id="ab" style="min-height:110px">${esc(altsBy('baja'))}</textarea>
        <label for="am">Energía media</label><textarea id="am" style="min-height:90px">${esc(altsBy('media'))}</textarea>
        <label for="aa">Energía alta</label><textarea id="aa" style="min-height:70px">${esc(altsBy('alta'))}</textarea>
      </div>

      <button id="save">Guardar</button>
      <a class="btn secondary" href="#/atajos">Guía de Atajos de iOS</a>
      <button class="ghost" id="export">Descargar mis datos</button>
      <button class="ghost" id="logout">Cerrar sesión en este dispositivo</button>
    `);

    on('#save', 'click', async () => {
      const val = (id) => $app.querySelector(id).value;
      const lines = (id) => val(id).split('\n').map((x) => x.trim()).filter(Boolean);
      const morningSteps = lines('#steps').map((t, i) => ({ id: `s${i + 1}`, text: t.replace(/^\*\s*/, ''), min: t.startsWith('*') }));
      let n = 0;
      const alternatives = [['#ab', 'baja'], ['#am', 'media'], ['#aa', 'alta']]
        .flatMap(([id, energy]) => lines(id).map((text) => ({ id: `a${++n}`, text, energy })));
      try {
        await api('/api/settings', {
          method: 'PUT',
          body: {
            wake: val('#wake'),
            bedtime: val('#bed'),
            tone: val('#tone'),
            allowMinutes: Number(val('#allow')) || 5,
            lockWaitMinutes: Number(val('#lw')) || 15,
            morningSteps,
            alternatives,
            notif: {
              nightPrep: $app.querySelector('#n1').checked,
              nightPark: $app.querySelector('#n2').checked,
              morningHello: $app.querySelector('#n3').checked,
              morningNudge: $app.querySelector('#n4').checked,
              maxPerDay: Number(val('#nmax')),
            },
          },
        });
        toast('Guardado');
      } catch (err) { toast(err.message); }
    });
    on('#push', 'click', enablePush);
    on('#test', 'click', async () => {
      const r = await api('/api/push/test', { method: 'POST' });
      toast(r.sent ? 'Enviada' : 'No hay dispositivos suscritos');
    });
    on('#export', 'click', async () => {
      const data = await api('/api/export');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      a.download = `mananas-${S.local.date}.json`;
      a.click();
    });
    on('#logout', 'click', () => { store.del('token'); location.hash = '#/login'; });
  }

  async function enablePush() {
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        return toast('Abre la app desde la pantalla de inicio', 3000);
      }
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return toast('Sin permiso para notificar');
      const reg = await navigator.serviceWorker.ready;
      const { key } = await api('/api/push/key');
      const raw = atob(key.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (key.length % 4)) % 4));
      const appServerKey = Uint8Array.from(raw, (c) => c.charCodeAt(0));
      const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appServerKey }));
      await api('/api/push/subscribe', { body: sub.toJSON() });
      toast('Notificaciones activadas');
      renderSettings();
    } catch (err) {
      toast(err.message, 3500);
    }
  }

  function renderShortcuts() {
    const base = location.origin;
    const t = encodeURIComponent(token() || '');
    const block = (txt) => `<pre class="copy">${esc(txt)}</pre><button class="ghost small" data-copy="${esc(txt)}">Copiar</button>`;
    const apps = [['instagram', 'Instagram'], ['youtube', 'YouTube']];
    view(`
      <p class="eyebrow">Atajos de iOS</p>
      <h1>Que el iPhone te pare a tiempo</h1>
      <p class="muted">Son automatizaciones de la app <b>Atajos</b> que llaman a esta web. Se configuran una vez. Las URLs llevan tu código de acceso: no las compartas.</p>

      <div class="card">
        <h3>1 · Pausa al abrir Instagram o YouTube</h3>
        <ol class="guide small">
          <li>Atajos → <b>Automatización</b> → <b>+</b> → <b>App</b> → elige Instagram → marca <b>«Se abre»</b> → <b>Ejecutar inmediatamente</b>.</li>
          <li>Añade la acción <b>Obtener contenido de URL</b> con:</li>
        </ol>
        ${block(`${base}/api/gate?app=instagram&t=${t}`)}
        <ol class="guide small" start="3">
          <li>Añade <b>Si</b> → «Contenido de URL» <b>contiene</b> <code>pausa</code>.</li>
          <li>Dentro del «Si», añade <b>Abrir URL</b> con:</li>
        </ol>
        ${block(`${base}/#/pausa?app=instagram&t=${t}`)}
        <p class="small muted">Repite lo mismo para YouTube cambiando <code>instagram</code> por <code>youtube</code> en las dos URLs. Si en la pausa eliges «Entrar unos minutos», durante ese rato el atajo te deja pasar sin parar.</p>
      </div>

      <div class="card">
        <h3>2 · La alarma abre tu mañana</h3>
        <ol class="guide small">
          <li>Automatización → <b>+</b> → <b>Alarma</b> → <b>«Se detiene»</b> (cualquier alarma) → Ejecutar inmediatamente.</li>
          <li>Acción <b>Abrir URL</b>:</li>
        </ol>
        ${block(`${base}/#/manana?t=${t}`)}
        <p class="small muted">Así lo primero que ves al apagar la alarma es tu primer paso, no Instagram.</p>
      </div>

      <div class="card">
        <h3>3 · (Opcional) Modo Dormir → preparar la noche</h3>
        <ol class="guide small">
          <li>Automatización → <b>+</b> → <b>Modo de concentración</b> → Dormir → «Al activarse».</li>
          <li>Acción <b>Abrir URL</b>:</li>
        </ol>
        ${block(`${base}/#/noche?t=${t}`)}
      </div>

      <div class="card">
        <h3>4 · X en el navegador</h3>
        <p class="small muted">Atajos no detecta webs. Para X usa el <a href="#/candado" style="color:inherit">Candado</a>: añade <code>x.com</code> a los límites de Tiempo de uso.</p>
      </div>
    `);
    on('[data-copy]', 'click', async (e, el) => {
      try { await navigator.clipboard.writeText(el.dataset.copy); toast('Copiado'); } catch { toast('Mantén pulsado el texto para copiarlo'); }
    });
  }

  // ---------- router ----------

  async function router() {
    absorbToken();
    const { route } = parseHash();
    if (!token() && route !== 'login') return renderLogin();
    try {
      switch (route) {
        case 'login': return renderLogin();
        case 'manana': return await renderMorning();
        case 'noche': return await renderNight();
        case 'pausa': return await renderPause();
        case 'progreso': return await renderProgress();
        case 'candado': return await renderLock();
        case 'ajustes': return await renderSettings();
        case 'atajos': return renderShortcuts();
        default: return await renderHome();
      }
    } catch (err) {
      if (err.message === 'no autorizado') return;
      view(`<h1>Vaya</h1><p class="muted">${esc(err.message)}</p><button onclick="location.reload()">Reintentar</button>`);
    }
  }

  window.addEventListener('hashchange', router);
  document.addEventListener('visibilitychange', () => {
    const { route } = parseHash();
    if (document.visibilityState === 'visible' && (route === '' || route === 'candado')) router();
  });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  router();
})();
