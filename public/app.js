/* Mañanas — PWA sin dependencias. Rutas por hash: #/, #/manana, #/noche, #/pausa, #/progreso, #/candado, #/ajustes, #/atajos */
(() => {
  'use strict';

  const $app = document.getElementById('app');
  const $nav = document.getElementById('nav');
  const $toast = document.getElementById('toast');

  // ---------- utilidades ----------

  const local = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* sin almacenamiento */ } },
  };

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const shuffle = (xs) => xs.map((x) => [Math.random(), x]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  const token = () => local.get('token');

  function toast(msg, ms = 2200) {
    $toast.textContent = msg;
    $toast.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => { $toast.hidden = true; }, ms);
  }

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      method: opts.method || (opts.body ? 'POST' : 'GET'),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (res.status === 401) {
      local.del('token');
      location.hash = '#/login';
      throw new Error('no autorizado');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `error ${res.status}`);
    return data;
  }

  const event = (type, data = {}) => api('/api/event', { body: { type, data } });
  const post = (path) => api(path, { method: 'POST' });

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
    local.set('token', t);
    q.delete('t');
    const rest = q.toString();
    history.replaceState(null, '', `${location.pathname}#/${route}${rest ? `?${rest}` : ''}`);
  }

  function view(html, { nav = true } = {}) {
    $app.innerHTML = `<div class="fade">${html}</div>`;
    $app.classList.toggle('bare', !nav);
    $nav.hidden = !nav;
    const { route } = parseHash();
    $nav.querySelectorAll('a').forEach((a) => a.classList.toggle('on', a.dataset.r === route));
    window.scrollTo(0, 0);
  }

  function on(sel, evt, fn) {
    $app.querySelectorAll(sel).forEach((el) => el.addEventListener(evt, (e) => fn(e, el)));
  }

  const ENERGY_TEXT = { baja: 'Poca', media: 'Normal', alta: 'Bastante' };
  const WEEKDAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
  const today = () => new Date().toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' });

  function activeSteps(S) {
    const steps = S.settings.morningSteps || [];
    return S.energy === 'baja' ? steps.filter((s) => s.min) : steps;
  }

  function weekDots(S) {
    return `<div class="week">${S.week.map((d, i) => `
      <div class="day"><div class="dot ${d.win ? 'win' : ''} ${d.date === S.local.date ? 'today' : ''} ${d.future ? 'future' : ''}"></div>${WEEKDAYS[i]}</div>`).join('')}</div>`;
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
      <h1>Mañanas</h1>
      <p class="muted">Introduce tu código de acceso.</p>
      <form id="f">
        <input id="tok" autocomplete="current-password" type="password" placeholder="Código" required>
        <div class="space"></div>
        <button type="submit">Entrar</button>
      </form>`, { nav: false });
    $app.querySelector('#f').addEventListener('submit', async (e) => {
      e.preventDefault();
      const t = $app.querySelector('#tok').value.trim();
      const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: t }) });
      if (!r.ok) return toast('Código incorrecto');
      local.set('token', t);
      location.hash = '#/';
    });
  }

  async function renderHome() {
    const S = await api('/api/state');
    const wins = S.week.filter((d) => d.win).length;
    let main = '';
    if (S.mode === 'manana') {
      const next = activeSteps(S).find((s) => !S.today.stepsDone.includes(s.id));
      main = `
        <p class="label">Tu mañana</p>
        <div class="big-text">${esc(next ? next.text : 'Empieza la mañana')}</div>
        <a class="btn" href="#/manana">Empezar</a>`;
    } else if (S.mode === 'noche') {
      main = `
        <p class="label">Esta noche</p>
        <div class="big-text">Deja el móvil fuera del cuarto.</div>
        <a class="btn" href="#/noche">Preparar la noche</a>`;
    } else if (S.mode === 'aparcado') {
      main = `
        <p class="label">Esta noche</p>
        <div class="big-text">Buenas noches.</div>
        <p class="muted">Si estás leyendo esto en la cama, el móvil no está fuera.</p>`;
    } else {
      main = `
        <p class="label">${S.today.morningDone ? 'Mañana ganada' : 'Ahora'}</p>
        <div class="big-text" id="idea">${S.today.morningDone ? 'El resto del día también es tuyo.' : '¿Un rato libre?'}</div>
        <button class="secondary" id="ideaBtn">Dame una idea</button>`;
    }

    view(`
      <p class="label">${esc(today())}</p>
      ${main}
      <h2>Semana</h2>
      ${weekDots(S)}
      <p class="small muted">${wins} esta semana · ${S.totalWins} en total</p>
      ${!isStandalone() ? '<div class="space"></div><p class="small muted">Añádela a la pantalla de inicio (Compartir → Añadir a pantalla de inicio) para recibir avisos.</p>' : ''}
    `);

    let current = null;
    on('#ideaBtn', 'click', async (e, el) => {
      if (current) {
        await event('alt_done', { alt: current.id, text: current.text });
        toast('A por ello');
        return renderHome();
      }
      current = pickAlternative(S, S.energy);
      $app.querySelector('#idea').textContent = current.text;
      el.textContent = 'Voy';
      el.classList.remove('secondary');
    });
  }

  async function renderMorning() {
    const S = await api('/api/state');
    if (S.today.morningDone) return renderMorningWin(S);
    if (!S.energy) {
      view(`
        <p class="label">Buenos días</p>
        <h1>¿Cuánta energía tienes?</h1>
        <p class="muted">Si es poca, hoy haces la versión corta. Cuenta igual.</p>
        <div class="space"></div>
        <div class="options">
          ${Object.entries(ENERGY_TEXT).map(([k, v]) => `<button data-e="${k}">${v}</button>`).join('')}
        </div>
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
    view(`
      <p class="label">${steps.indexOf(next) + 1} / ${steps.length}${S.energy === 'baja' ? ' · versión corta' : ''}</p>
      <div class="big-text">${esc(next.text)}</div>
      <button id="done">Hecho</button>
      ${S.today.plan ? `<p class="small muted center">Después: ${esc(S.today.plan)}</p>` : ''}
      <ul class="steps">
        ${steps.map((s) => `
          <li class="${done.includes(s.id) ? 'done' : ''} ${s.id === next.id ? 'current' : ''}" data-s="${s.id}">
            <span class="mark"></span><span class="t">${esc(s.text)}</span>
          </li>`).join('')}
      </ul>
      <h2>Energía</h2>
      <div class="chips">${Object.entries(ENERGY_TEXT).map(([k, v]) => `<button class="chip ${S.energy === k ? 'on' : ''}" data-lvl="${k}">${v}</button>`).join('')}</div>
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
      <p class="label">Mañana ganada</p>
      <div class="big-text">Hecho.</div>
      <p class="muted">${S.today.plan ? `Ahora: ${esc(S.today.plan)}.` : 'Ahora, sal de casa. Fuera es más fácil.'}</p>
      <h2>Semana</h2>
      ${weekDots(S)}
      <p class="small muted">${S.totalWins} en total</p>
      <div class="space"></div>
      <a class="btn secondary" href="#/">Listo</a>
    `);
  }

  async function renderNight() {
    const S = await api('/api/state');
    if (S.tonight.parked) {
      view(`
        <p class="label">Esta noche</p>
        <div class="big-text">Buenas noches.</div>
        <p class="muted">Mañana a las ${esc(S.settings.wake)}.${S.tonight.plan ? ` Después de tus pasos: ${esc(S.tonight.plan)}.` : ''}</p>
      `);
      return;
    }
    const alts = S.settings.alternatives || [];
    const custom = S.tonight.plan && !alts.some((a) => a.text === S.tonight.plan) ? S.tonight.plan : '';
    view(`
      <p class="label">Esta noche</p>
      <h1>Prepara mañana</h1>
      <h2>Después de tus pasos, lo primero</h2>
      <div class="chips">${alts.map((a) => `<button class="chip ${S.tonight.plan === a.text ? 'on' : ''}" data-p="${esc(a.text)}">${esc(a.text)}</button>`).join('')}</div>
      <input id="plan" placeholder="Otra cosa" value="${esc(custom)}">
      <h2>El móvil</h2>
      <p class="muted">A cargar fuera del cuarto, con la alarma a las ${esc(S.settings.wake)}. Tendrás que levantarte para apagarla.</p>
      <div class="space"></div>
      <button id="park">Aparcado</button>
    `);
    let plan = S.tonight.plan || '';
    on('[data-p]', 'click', (e, el) => {
      plan = el.dataset.p;
      $app.querySelectorAll('[data-p]').forEach((c) => c.classList.toggle('on', c === el));
      $app.querySelector('#plan').value = '';
    });
    on('#park', 'click', async () => {
      const finalPlan = $app.querySelector('#plan').value.trim() || plan;
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
        <p class="label center">${esc(appDef.name)}</p>
        <div class="breath"><div class="circle"><span id="n">${n}</span></div></div>
        <p class="center muted">Inspira al crecer, suelta al encoger.</p>
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
        <p class="label">Hoy: ${S.today.pauses} ${S.today.pauses === 1 ? 'pausa' : 'pausas'} · ${S.today.redirected} veces otra cosa</p>
        <h1>¿Qué te ha traído aquí?</h1>
        <div class="space"></div>
        <div class="options">
          <button data-r="concreto">Busco algo concreto</button>
          <button data-r="cansancio">Cansancio</button>
          <button data-r="aburrimiento">Aburrimiento</button>
          <button data-r="inercia">Ni lo he pensado</button>
          <button data-r="evitar">Estoy evitando algo</button>
        </div>
      `, { nav: false });
      on('[data-r]', 'click', (e, el) => { reason = el.dataset.r; suggest(); });
    };

    const suggest = () => {
      const morningPending = S.mode === 'manana' && !S.today.morningDone;
      const nextStep = activeSteps(S).find((s) => !S.today.stepsDone.includes(s.id));
      const alt = pickAlternative(S, reason === 'cansancio' ? 'baja' : S.energy, seen);
      seen.push(alt.id);
      const lines = {
        concreto: 'Entra, búscalo y sal. Te aviso al acabar el tiempo.',
        cansancio: 'El scroll no descansa. Esto sí:',
        aburrimiento: 'El aburrimiento pasa en dos minutos. Prueba esto:',
        inercia: 'Piloto automático. Ya lo has visto, que es lo difícil.',
        evitar: 'Empieza con solo dos minutos de eso que evitas.',
        fin: 'Se acabó el tiempo.',
      };
      const main = morningPending && nextStep
        ? { text: nextStep.text, href: '#/manana', label: 'Volver a mi mañana' }
        : { text: alt.text, label: 'Lo hago' };
      view(`
        <p class="label">${esc(lines[reason] || '')}</p>
        <div class="big-text">${esc(main.text)}</div>
        <button id="go">${main.label}</button>
        ${main.href ? '' : '<button class="ghost" id="other">Otra idea</button>'}
        <div class="space"></div>
        ${finished ? '' : `<button class="secondary" id="enter">Entrar ${S.settings.allowMinutes} min en ${esc(appDef.name)}</button>`}
        <a class="btn ghost" href="#/">Cerrar</a>
      `, { nav: false });
      on('#other', 'click', suggest);
      on('#go', 'click', async () => {
        await event('pause_choice', { app: appId, reason, choice: main.href ? 'manana' : 'alternativa', alt: main.href ? null : alt.id });
        if (main.href) return void (location.hash = main.href);
        await event('alt_done', { alt: alt.id, text: alt.text });
        view(`
          <p class="label">Bien elegido</p>
          <div class="big-text">Bloquea la pantalla y a por ello.</div>
          <a class="btn secondary" href="#/">Inicio</a>`, { nav: false });
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
    const offset = (new Date(`${P.days[0].date}T12:00:00Z`).getUTCDay() + 6) % 7;
    const I = P.insight;
    let insight = '<p class="muted">Cuando lleves unas semanas, aquí verás cómo influye la hora a la que aparcas el móvil en tus mañanas.</p>';
    if (I.onTime && I.other) {
      insight = `<p>Cuando aparcas el móvil a tu hora, ganas <b>${I.onTime.of10} de cada 10</b> mañanas. Cuando no, <b>${I.other.of10} de cada 10</b>.</p>`;
    }
    if (I.avgParkedAt) insight += `<p class="small muted">Sueles aparcarlo a las ${I.avgParkedAt}.</p>`;
    view(`
      <p class="label">Últimas 4 semanas</p>
      <h1>Progreso</h1>
      <div class="space"></div>
      <div class="stats">
        <div class="stat"><b>${wins}</b><span>mañanas ganadas</span></div>
        <div class="stat"><b>${parked}</b><span>noches con el móvil fuera</span></div>
        <div class="stat"><b>${pauses}</b><span>pausas</span></div>
        <div class="stat"><b>${pauses ? Math.round((redirected / pauses) * 100) : 0}%</b><span>elegiste otra cosa</span></div>
      </div>
      <h2>28 días</h2>
      <div class="grid28">
        ${WEEKDAYS.map((d) => `<div class="cell">${d}</div>`).join('')}
        ${'<div></div>'.repeat(offset)}
        ${P.days.map((d) => `<div class="cell ${d.win ? 'win' : ''} ${d.parked ? 'parked' : ''}"><i></i><span>${Number(d.date.slice(8))}</span></div>`).join('')}
      </div>
      <p class="small muted" style="margin-top:16px">Punto relleno: mañana ganada. Número subrayado: la noche anterior el móvil durmió fuera.</p>
      <h2>Lo que dicen tus datos</h2>
      ${insight}
      <h2>Esta semana</h2>
      ${weekDots(S)}
    `);
  }

  async function renderLock() {
    const [L, S] = await Promise.all([api('/api/lock'), api('/api/state')]);
    const setup = `
      <details>
        <summary>Qué poner en Tiempo de uso</summary>
        <ol class="guide small">
          <li><b>Ajustes → Tiempo de uso → Bloquear ajustes</b>: usa el código de aquí.</li>
          <li><b>Límites de uso</b>: Instagram, YouTube y los sitios <code>x.com</code>, <code>instagram.com</code>, <code>youtube.com</code>. 15–20 min al día, con «Bloquear al final del límite».</li>
          <li><b>Contenido y privacidad → Compras en App Store → Instalar apps: No permitir.</b> Así no reinstalas Instagram en un mal momento.</li>
          <li>Opcional: <b>Tiempo de inactividad</b> de ${esc(S.settings.bedtime)} a ${esc(S.settings.wake)}.</li>
        </ol>
        <p class="small muted">Los nombres pueden variar según la versión de iOS. Si olvidas el código, Apple permite restablecerlo con tu Apple ID.</p>
      </details>`;

    if (!L.exists) {
      view(`
        <p class="label">Candado</p>
        <h1>Un código que no te sabes</h1>
        <p class="muted">Los límites no sirven si te sabes el código. La app crea uno, lo pones en Tiempo de uso y se esconde. Vuelve a aparecer si completas tu mañana o esperas ${L.waitMinutes} minutos.</p>
        <div class="space"></div>
        <button id="new">Crear código</button>
        <div class="space"></div>
        ${setup}`);
      on('#new', 'click', async () => { await post('/api/lock/new'); renderLock(); });
      return;
    }

    if (L.pendingCode) {
      view(`
        <p class="label">Candado</p>
        ${L.previousCode
          ? `<h1>Código actual</h1>
             <div class="code">${esc(L.previousCode)}</div>
             <p class="muted">Úsalo para entrar en Tiempo de uso. Al acabar, en <b>Cambiar código</b>, pon este nuevo:</p>`
          : `<h1>Tu código</h1>
             <p class="muted">Ponlo ahora en Ajustes → Tiempo de uso → Bloquear ajustes. Después no volverás a verlo.</p>`}
        <div class="code">${esc(L.pendingCode)}</div>
        <button id="ok">Hecho, escóndelo</button>
        ${L.previousCode ? '' : '<button class="ghost" id="cancel">Cancelar</button>'}
        <p class="small muted center">Se esconde solo a los 30 minutos.</p>
        <div class="space"></div>
        ${setup}`);
      on('#ok', 'click', async () => { await post('/api/lock/confirm'); renderLock(); });
      on('#cancel', 'click', async () => { await post('/api/lock/forget'); renderLock(); });
      return;
    }

    const waitLeft = L.waitEnds ? Math.max(0, Math.ceil((new Date(L.waitEnds) - Date.now()) / 1000)) : null;
    const mmss = (x) => `${Math.floor(x / 60)}:${String(x % 60).padStart(2, '0')}`;
    view(`
      <p class="label">Candado</p>
      <h1>Límites protegidos</h1>
      <p class="muted">Desde el ${new Date(L.setAt).toLocaleDateString('es', { day: 'numeric', month: 'long' })}.</p>
      <div class="space"></div>
      ${L.canReveal
        ? `<p>${L.morningDone ? 'Has completado tu mañana.' : 'Ya has esperado.'} Puedes ver el código; después se cambiará por uno nuevo.</p>
           <button id="reveal">Ver el código</button>`
        : `<p class="muted">Para ver el código, completa tu mañana o espera ${L.waitMinutes} minutos. Si después de esperar lo sigues necesitando, será por algo.</p>
           ${waitLeft != null ? `<div class="code" id="cd">${mmss(waitLeft)}</div>` : `<button class="secondary" id="wait">Esperar ${L.waitMinutes} min</button>`}
           ${!L.morningDone ? '<a class="btn" href="#/manana">Ir a mi mañana</a>' : ''}`}
      <div class="space"></div>
      ${setup}`);
    on('#reveal', 'click', async () => { await post('/api/lock/reveal'); renderLock(); });
    on('#wait', 'click', async () => { await post('/api/lock/wait'); renderLock(); });
    if (waitLeft != null) {
      let left = waitLeft;
      const t = setInterval(() => {
        const el = $app.querySelector('#cd');
        if (!el) return clearInterval(t);
        left -= 1;
        if (left <= 0) { clearInterval(t); renderLock(); return; }
        el.textContent = mmss(left);
      }, 1000);
    }
  }

  async function renderSettings() {
    const S = await api('/api/state');
    const s = S.settings;
    const stepsText = s.morningSteps.map((x) => `${x.min ? '* ' : ''}${x.text}`).join('\n');
    const altsBy = (e) => s.alternatives.filter((a) => a.energy === e).map((a) => a.text).join('\n');
    const canPush = 'serviceWorker' in navigator && 'PushManager' in window;
    const pushState = !canPush
      ? 'Para recibir avisos, abre la app desde la pantalla de inicio.'
      : Notification.permission === 'granted' ? 'Avisos activados en este dispositivo.'
        : Notification.permission === 'denied' ? 'Avisos bloqueados. Actívalos en los Ajustes del iPhone.' : '';
    view(`
      <h1>Ajustes</h1>

      <h2>Horario</h2>
      <div class="row">
        <div><label for="wake">Me despierto</label><input id="wake" type="time" value="${esc(s.wake)}"></div>
        <div><label for="bed">Móvil fuera</label><input id="bed" type="time" value="${esc(s.bedtime)}"></div>
      </div>

      <h2>Avisos</h2>
      ${pushState ? `<p class="small muted">${pushState}</p>` : ''}
      ${canPush && Notification.permission !== 'granted' ? '<button class="secondary" id="push">Activar avisos</button>' : ''}
      <div class="switch"><label for="n1">30 min antes de aparcar</label><input type="checkbox" id="n1" ${s.notif.nightPrep ? 'checked' : ''}></div>
      <div class="switch"><label for="n2">Hora de aparcar</label><input type="checkbox" id="n2" ${s.notif.nightPark ? 'checked' : ''}></div>
      <div class="switch"><label for="n3">Buenos días</label><input type="checkbox" id="n3" ${s.notif.morningHello ? 'checked' : ''}></div>
      <div class="switch"><label for="n4">Recordatorio si la mañana va a medias</label><input type="checkbox" id="n4" ${s.notif.morningNudge ? 'checked' : ''}></div>
      <div class="switch"><label for="nmax">Máximo al día</label><input id="nmax" type="number" min="0" max="8" value="${s.notif.maxPerDay}"></div>
      <label for="tone">Tono</label>
      <select id="tone">
        <option value="cercano" ${s.tone === 'cercano' ? 'selected' : ''}>Cercano</option>
        <option value="directo" ${s.tone === 'directo' ? 'selected' : ''}>Directo</option>
      </select>
      ${canPush && Notification.permission === 'granted' ? '<button class="ghost" id="test">Enviar uno de prueba</button>' : ''}

      <h2>Pasos de la mañana</h2>
      <p class="small muted">Uno por línea. Los que empiezan por * forman la versión corta.</p>
      <textarea id="steps">${esc(stepsText)}</textarea>

      <h2>Alternativas al móvil</h2>
      <label for="ab">Con poca energía</label><textarea id="ab" style="min-height:110px">${esc(altsBy('baja'))}</textarea>
      <label for="am">Con energía normal</label><textarea id="am" style="min-height:90px">${esc(altsBy('media'))}</textarea>
      <label for="aa">Con bastante energía</label><textarea id="aa" style="min-height:60px">${esc(altsBy('alta'))}</textarea>

      <h2>Otros</h2>
      <div class="row">
        <div><label for="allow">Minutos al «entrar»</label><input id="allow" type="number" min="1" max="30" value="${s.allowMinutes}"></div>
        <div><label for="lw">Espera del candado</label><input id="lw" type="number" min="5" max="120" value="${s.lockWaitMinutes}"></div>
      </div>

      <div class="space"></div>
      <button id="save">Guardar</button>
      <a class="btn secondary" href="#/atajos">Configurar Atajos de iOS</a>
      <button class="ghost" id="export">Descargar mis datos</button>
      <button class="ghost" id="logout">Cerrar sesión</button>
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
      const r = await post('/api/push/test');
      toast(r.sent ? 'Enviado' : 'No hay dispositivos suscritos');
    });
    on('#export', 'click', async () => {
      const data = await api('/api/export');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      a.download = `mananas-${S.local.date}.json`;
      a.click();
    });
    on('#logout', 'click', () => { local.del('token'); location.hash = '#/login'; });
  }

  async function enablePush() {
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return toast('Sin permiso para avisar');
      const reg = await navigator.serviceWorker.ready;
      const { key } = await api('/api/push/key');
      const raw = atob(key.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (key.length % 4)) % 4));
      const appServerKey = Uint8Array.from(raw, (c) => c.charCodeAt(0));
      const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appServerKey }));
      await api('/api/push/subscribe', { body: sub.toJSON() });
      toast('Avisos activados');
      renderSettings();
    } catch (err) {
      toast(err.message, 3500);
    }
  }

  function renderShortcuts() {
    const base = location.origin;
    const t = encodeURIComponent(token() || '');
    const block = (txt) => `<pre class="copy">${esc(txt)}</pre><button class="ghost small" data-copy="${esc(txt)}">Copiar</button>`;
    view(`
      <p class="label">Atajos de iOS</p>
      <h1>Que el iPhone te pare a tiempo</h1>
      <p class="muted">Automatizaciones de la app Atajos. Se configuran una vez. Las URLs llevan tu código: no las compartas.</p>
      <div class="space"></div>

      <details open>
        <summary>Pausa al abrir Instagram o YouTube</summary>
        <ol class="guide small">
          <li>Atajos → Automatización → + → <b>App</b> → Instagram → <b>Se abre</b> → <b>Ejecutar inmediatamente</b>.</li>
          <li>Acción <b>Obtener contenido de URL</b>:</li>
        </ol>
        ${block(`${base}/api/gate?app=instagram&t=${t}`)}
        <ol class="guide small" start="3">
          <li>Acción <b>Si</b> → «Contenido de URL» <b>contiene</b> <code>pausa</code>.</li>
          <li>Dentro del «Si», acción <b>Abrir URL</b>:</li>
        </ol>
        ${block(`${base}/#/pausa?app=instagram&t=${t}`)}
        <p class="small muted">Para YouTube, repite cambiando <code>instagram</code> por <code>youtube</code> en las dos URLs.</p>
      </details>

      <details>
        <summary>La alarma abre tu mañana</summary>
        <ol class="guide small">
          <li>Automatización → + → <b>Alarma</b> → <b>Se detiene</b> → Ejecutar inmediatamente.</li>
          <li>Acción <b>Abrir URL</b>:</li>
        </ol>
        ${block(`${base}/#/manana?t=${t}`)}
      </details>

      <details>
        <summary>Modo Dormir abre la noche (opcional)</summary>
        <ol class="guide small">
          <li>Automatización → + → <b>Modo de concentración</b> → Dormir → Al activarse.</li>
          <li>Acción <b>Abrir URL</b>:</li>
        </ol>
        ${block(`${base}/#/noche?t=${t}`)}
      </details>

      <details>
        <summary>X en el navegador</summary>
        <p class="small muted">Atajos no detecta webs. Añade <code>x.com</code> a los límites de Tiempo de uso y protégelo con el <a href="#/candado">candado</a>.</p>
      </details>
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
      view(`<h1>Algo ha fallado</h1><p class="muted">${esc(err.message)}</p><button onclick="location.reload()">Reintentar</button>`);
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
