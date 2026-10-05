/* Mañanas — PWA sin dependencias.
   Rutas: #/, #/manana, #/noche, #/foco, #/pausa, #/progreso, #/candado, #/ajustes, #/atajos */
(() => {
  'use strict';

  const $app = document.getElementById('app');
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
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  function fmtMin(m) {
    m = Math.round(m);
    if (m < 60) return `${m} min`;
    return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
  }

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
      renderLogin();
      throw new Error('no autorizado');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `error ${res.status}`);
    return data;
  }

  const event = (type, data = {}) => api('/api/event', { body: { type, data } });

  // Llamada a la IA con tiempo máximo: si tarda o falla, devuelve null y se usa el texto fijo.
  function withTimeout(promise, ms) {
    return Promise.race([promise.catch(() => null), new Promise((r) => setTimeout(() => r(null), ms))]);
  }
  const post = (path, body) => api(path, { method: 'POST', body });

  function parseHash() {
    const raw = location.hash.replace(/^#\/?/, '');
    const [route, qs] = raw.split('?');
    return { route: route || '', q: new URLSearchParams(qs || '') };
  }

  // Enlaces antiguos con ?t=CÓDIGO: se quita de la barra sin guardarlo. El código ya no viaja en URLs.
  function stripTokenFromUrl() {
    const { route, q } = parseHash();
    if (!q.has('t')) return;
    q.delete('t');
    const rest = q.toString();
    history.replaceState(null, '', `${location.pathname}#/${route}${rest ? `?${rest}` : ''}`);
  }

  const BACK = '<a href="#/">← Volver</a>';

  // Cada pantalla: una línea arriba, el contenido en el centro y las acciones abajo.
  function screen({ top = '', middle = '', bottom = '', scroll = false }) {
    clearInterval(screen.timer);
    $app.innerHTML = `
      <div class="screen fade ${scroll ? 'scroll' : ''}">
        <div class="top">${top}</div>
        <div class="middle">${middle}</div>
        <div class="bottom">${bottom}</div>
      </div>`;
    window.scrollTo(0, 0);
  }

  function on(sel, evt, fn) {
    $app.querySelectorAll(sel).forEach((el) => el.addEventListener(evt, (e) => fn(e, el)));
  }

  const ENERGY_TEXT = { baja: 'Poca', media: 'Normal', alta: 'Bastante' };
  const PLACES = { clase: 'Clase', biblioteca: 'Biblioteca', estudio: 'Estudiando' };
  const DURATIONS = [25, 50, 90, 120];

  function activeSteps(S) {
    const steps = S.settings.morningSteps || [];
    return S.energy === 'baja' ? steps.filter((s) => s.min) : steps;
  }

  const weekDots = (S) => `<div class="week">${S.week.map((d) => `<span class="dot ${d.win ? 'win' : ''} ${d.future ? 'future' : ''}"></span>`).join('')}</div>`;

  function pickAlternative(S, energy, exclude = []) {
    const alts = S.settings.alternatives || [];
    const order = { baja: ['baja'], media: ['baja', 'media'], alta: ['media', 'alta', 'baja'] }[energy || 'media'];
    const pool = alts.filter((a) => order.includes(a.energy) && !exclude.includes(a.id));
    return shuffle(pool.length ? pool : alts)[0] || { id: 'x', text: 'Levántate y bebe un vaso de agua' };
  }

  // ---------- pantallas ----------

  function renderLogin() {
    screen({
      middle: `
        <p class="say">Mañanas</p>
        <p class="sub">Solo te lo pide una vez en cada navegador.</p>
        <form id="f"><input id="tok" class="say" autocomplete="current-password" type="password" placeholder="Código de acceso" required></form>`,
      bottom: '<button id="go">Entrar</button>',
    });
    const submit = async (e) => {
      e?.preventDefault();
      const t = $app.querySelector('#tok').value.trim();
      const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: t }) });
      if (!r.ok) return toast('Código incorrecto');
      local.set('token', t);
      // Vuelve a la pantalla a la que ibas (p. ej. la pausa que abrió un Atajo).
      if (parseHash().route === 'login') location.hash = '#/';
      else router();
    };
    $app.querySelector('#f').addEventListener('submit', submit);
    on('#go', 'click', submit);
  }

  async function renderHome() {
    const S = await api('/api/state');
    if (S.focus) return renderFocus(S);
    const date = cap(new Date().toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' }));
    const top = `<span>${esc(date)}</span><nav><a href="#/progreso">Progreso</a><a href="#/ajustes">Ajustes</a></nav>`;

    if (S.mode === 'manana') {
      const next = activeSteps(S).find((s) => !S.today.stepsDone.includes(s.id));
      return screen({
        top,
        middle: `<p class="say">${esc(next ? next.text : 'Empieza la mañana.')}</p><p class="sub">Tu mañana, paso a paso.</p>`,
        bottom: '<a class="btn" href="#/manana">Empezar</a>',
      });
    }
    if (S.mode === 'noche') {
      return screen({
        top,
        middle: '<p class="say">Hora de dejar el móvil fuera del cuarto.</p>',
        bottom: '<a class="btn" href="#/noche">Preparar la noche</a>',
      });
    }
    if (S.mode === 'aparcado') {
      return screen({ top, middle: '<p class="say">Buenas noches.</p><p class="sub">El móvil, fuera hasta mañana.</p>' });
    }
    screen({
      top,
      middle: `
        <p class="say">¿En clase o en la biblioteca?</p>
        <p class="sub">Deja el móvil y vuelve al terminar.</p>
        ${weekDots(S)}
        ${!isStandalone() ? '<p class="sub small">Añádela a la pantalla de inicio para recibir avisos.</p>' : ''}`,
      bottom: `<a class="btn" href="#/foco">Dejar el móvil</a>${S.local.hour >= 20 ? '<a class="btn text" href="#/noche">Preparar la noche</a>' : ''}`,
    });
  }

  // ----- modo clase / biblioteca -----

  async function renderFocus(S) {
    S = S || (await api('/api/state'));
    const { q } = parseHash();

    if (S.focus) {
      const draw = (confirming = false) => {
        const left = Math.max(0, Math.ceil((new Date(S.focus.end) - Date.now()) / 60e3));
        screen({
          top: `<span>${esc(PLACES[S.focus.place] || '')}</span>`,
          middle: `
            <p class="huge">${left}</p>
            <p class="sub">${left === 1 ? 'minuto' : 'minutos'}. El móvil, boca abajo y lejos.</p>
            ${S.focus.pickups ? `<p class="sub small">Lo has mirado ${S.focus.pickups} ${S.focus.pickups === 1 ? 'vez' : 'veces'}.</p>` : ''}`,
          bottom: confirming
            ? '<button id="stop">Terminar ya</button><button class="text" id="keep">Sigo</button>'
            : '<button class="text" id="ask">Terminar antes</button>',
        });
        on('#ask', 'click', () => draw(true));
        on('#keep', 'click', () => draw(false));
        on('#stop', 'click', async () => {
          const r = await post('/api/focus/stop');
          focusDone(r.minutes, S.focus.pickups);
        });
        screen.timer = setInterval(() => {
          if (Date.now() >= new Date(S.focus.end)) return router();
          if (!confirming) draw(false);
        }, 20000);
      };
      return draw();
    }

    // Recién terminada (por tiempo): resumen.
    const last = S.lastFocus;
    if (last && Date.now() - new Date(last.at) < 15 * 60e3 && !q.get('lugar') && !q.get('otra')) {
      return focusDone(last.minutes, last.pickups, S.weekFocusMinutes);
    }

    const pickDuration = (place) => {
      screen({
        top: BACK,
        middle: `
          <p class="say">¿Cuánto tiempo?</p>
          <div class="options">${DURATIONS.map((m) => `<button data-m="${m}">${fmtMin(m)}</button>`).join('')}</div>`,
      });
      on('[data-m]', 'click', async (e, el) => {
        await post('/api/focus/start', { place, minutes: Number(el.dataset.m) });
        history.replaceState(null, '', `${location.pathname}#/foco`);
        toast('Móvil boca abajo. Te aviso al terminar.', 3000);
        renderFocus();
      });
    };

    const place = q.get('lugar');
    if (place && PLACES[place]) return pickDuration(place);
    screen({
      top: BACK,
      middle: `
        <p class="say">¿Dónde estás?</p>
        <div class="options">${Object.entries(PLACES).map(([k, v]) => `<button data-p="${k}">${v}</button>`).join('')}</div>`,
    });
    on('[data-p]', 'click', (e, el) => pickDuration(el.dataset.p));
  }

  async function focusDone(minutes, pickups, weekMinutes) {
    if (weekMinutes == null) weekMinutes = (await api('/api/state')).weekFocusMinutes;
    screen({
      middle: `
        <p class="say">${minutes >= 1 ? `${fmtMin(minutes)} sin móvil.` : 'Sesión terminada.'}</p>
        <p class="sub">${pickups ? `Lo miraste ${pickups} ${pickups === 1 ? 'vez' : 'veces'}. ` : ''}${weekMinutes >= 1 ? `Esta semana llevas ${fmtMin(weekMinutes)}.` : ''}</p>`,
      bottom: '<a class="btn" href="#/">Listo</a><a class="btn text" href="#/foco?otra=1">Otra sesión</a>',
    });
  }

  // ----- mañana -----

  async function renderMorning() {
    const S = await api('/api/state');
    if (S.today.morningDone) {
      return screen({
        middle: `<p class="say">Mañana ganada.</p><p class="sub">${S.today.plan ? `Ahora: ${esc(S.today.plan)}.` : 'Ahora, sal de casa.'}</p>${weekDots(S)}`,
        bottom: '<a class="btn" href="#/">Listo</a>',
      });
    }
    if (!S.energy) {
      screen({
        top: '<span>Buenos días</span>',
        middle: `
          <p class="say">¿Cuánta energía tienes hoy?</p>
          <div class="options">${Object.entries(ENERGY_TEXT).map(([k, v]) => `<button data-e="${k}">${v}</button>`).join('')}</div>`,
      });
      on('[data-e]', 'click', async (e, el) => {
        await event('energy', { level: el.dataset.e });
        renderMorning();
      });
      return;
    }
    const steps = activeSteps(S);
    const next = steps.find((s) => !S.today.stepsDone.includes(s.id));
    if (!next) {
      await event('morning_done', { energy: S.energy, steps: S.today.stepsDone.length });
      return renderMorning();
    }
    const top = `<span>${steps.indexOf(next) + 1} / ${steps.length}</span><span>${S.energy === 'baja' ? 'Versión corta' : ''}</span>`;
    const showStep = (sub = '') => {
      screen({
        top,
        middle: `<p class="say">${esc(next.text)}</p>${sub ? `<p class="sub">${esc(sub)}</p>` : ''}`,
        bottom: '<button id="done">Hecho</button><button class="text" id="hard">Me cuesta</button>',
      });
      on('#done', 'click', async () => {
        await event('morning_step', { stepId: next.id });
        renderMorning();
      });
      on('#hard', 'click', async (e, el) => {
        el.textContent = '·  ·  ·';
        el.disabled = true;
        const r = S.aiEnabled ? await withTimeout(api('/api/ai/smaller', { body: { stepId: next.id } }), 7000) : null;
        const micro = r?.step || 'Haz solo el primer movimiento. Nada más.';
        screen({
          top: '<span>Solo esto</span>',
          middle: `<p class="say">${esc(micro)}</p>`,
          bottom: '<button id="micro">Hecho</button>',
        });
        on('#micro', 'click', () => showStep('Ya has empezado. Lo difícil está hecho.'));
      });
    };
    showStep();
  }

  // ----- noche -----

  async function renderNight() {
    const S = await api('/api/state');
    if (S.tonight.parked) {
      return screen({
        top: BACK,
        middle: `<p class="say">Buenas noches.</p><p class="sub">Alarma a las ${esc(S.settings.wake)}.${S.tonight.plan ? ` Mañana: ${esc(S.tonight.plan)}.` : ''}</p>`,
      });
    }
    screen({
      top: BACK,
      middle: `
        <p class="say">Mañana, lo primero que harás:</p>
        <input id="plan" class="say" placeholder="p. ej. ir pronto a la biblioteca" value="${esc(S.tonight.plan || '')}" autocomplete="off">`,
      bottom: '<button id="next">Siguiente</button>',
    });
    on('#next', 'click', async () => {
      const plan = $app.querySelector('#plan').value.trim();
      if (plan && plan !== S.tonight.plan) await event('plan_tomorrow', { text: plan });
      screen({
        middle: `<p class="say">Deja el móvil cargando fuera del cuarto.</p><p class="sub">Con la alarma a las ${esc(S.settings.wake)}. Para apagarla tendrás que levantarte.</p>`,
        bottom: '<button id="park">Hecho</button>',
      });
      on('#park', 'click', async () => {
        await event('park');
        renderNight();
      });
    });
  }

  // ----- pausa al abrir una app -----

  async function renderPause() {
    const { q } = parseHash();
    const appId = q.get('app') || 'app';
    const finished = q.get('fin') === '1';
    const S = await api('/api/state');
    const appDef = (S.settings.apps || []).find((a) => a.id === appId) || { id: appId, name: appId, url: '' };
    const seen = [];
    const seenTexts = [];
    let reason = null;

    if (S.focus) {
      const left = Math.max(1, Math.ceil((new Date(S.focus.end) - Date.now()) / 60e3));
      screen({
        middle: `<p class="say">Estás en ${esc(S.focus.placeText)}.</p><p class="sub">Quedan ${fmtMin(left)}. ${esc(appDef.name)} puede esperar.</p>`,
        bottom: '<a class="btn" href="#/foco">Vuelvo a lo mío</a>',
      });
      return;
    }

    const enter = async () => {
      await api('/api/allow', { body: { app: appId, minutes: S.settings.allowMinutes } });
      await event('pause_choice', { app: appId, reason, choice: 'entrar' });
      toast(`Te aviso en ${S.settings.allowMinutes} min`);
      if (appDef.url) setTimeout(() => { location.href = appDef.url; }, 400);
    };

    const suggest = async () => {
      const nextStep = S.mode === 'manana' && !S.today.morningDone && activeSteps(S).find((s) => !S.today.stepsDone.includes(s.id));
      if (reason === 'concreto') {
        screen({
          middle: `<p class="say">Vale. ${S.settings.allowMinutes} minutos.</p><p class="sub">Entra, búscalo y sal. Te aviso al acabar.</p>`,
          bottom: '<button id="enter">Entrar</button><a class="btn text" href="#/">Mejor no</a>',
        });
        return on('#enter', 'click', enter);
      }
      if (nextStep) {
        screen({
          middle: `<p class="say">${esc(nextStep.text)}</p><p class="sub">Tu mañana sigue aquí.</p>`,
          bottom: '<a class="btn" href="#/manana">Volver a mi mañana</a>',
        });
        return event('pause_choice', { app: appId, reason, choice: 'manana' });
      }
      let alt = null;
      if (S.aiEnabled) {
        screen({ middle: '<p class="say muted">·  ·  ·</p>' });
        const r = await withTimeout(api('/api/ai/pause', { body: { app: appId, reason, avoid: seenTexts } }), 6000);
        if (r?.action) alt = { id: 'ia', text: r.action, why: r.reason };
      }
      if (!alt) {
        alt = pickAlternative(S, reason === 'descansar' ? 'baja' : S.energy, seen);
        seen.push(alt.id);
      }
      seenTexts.push(alt.text);
      const why = alt.why || (finished ? 'Se acabó el tiempo.' : '');
      screen({
        middle: `<p class="say">${esc(alt.text)}</p>${why ? `<p class="sub">${esc(why)}</p>` : ''}`,
        bottom: `<button id="go">Lo hago</button><button class="text" id="other">Otra idea</button>${finished ? '' : `<button class="text" id="enter">Entrar ${S.settings.allowMinutes} min</button>`}`,
      });
      on('#other', 'click', suggest);
      on('#enter', 'click', enter);
      on('#go', 'click', async () => {
        await event('pause_choice', { app: appId, reason, choice: 'alternativa', alt: alt.id });
        await event('alt_done', { alt: alt.id, text: alt.text });
        screen({ middle: '<p class="say">Bien.</p><p class="sub">Bloquea la pantalla y a por ello.</p>' });
      });
    };

    if (finished) { reason = 'fin'; return suggest(); }

    let n = 8;
    screen({
      top: `<span>${esc(appDef.name)}</span>`,
      middle: '<div class="circle"></div>',
      bottom: '<p class="sub" style="text-align:center">Respira.</p>',
    });
    screen.timer = setInterval(() => {
      n -= 1;
      if (n > 0) return;
      clearInterval(screen.timer);
      screen({
        middle: `
          <p class="say">¿Qué buscas?</p>
          <div class="options">
            <button data-r="concreto">Algo concreto</button>
            <button data-r="descansar">Descansar</button>
            <button data-r="inercia">Nada, es costumbre</button>
          </div>`,
      });
      on('[data-r]', 'click', (e, el) => { reason = el.dataset.r; suggest(); });
    }, 1000);
  }

  // ----- progreso -----

  async function renderProgress() {
    const [S, P] = await Promise.all([api('/api/state'), api('/api/progress')]);
    const I = P.insight;
    const lines = [];
    if (S.weekFocusMinutes) lines.push(`${fmtMin(S.weekFocusMinutes)} sin móvil en clase o biblioteca esta semana.`);
    if (I.onTime && I.other) lines.push(`Cuando aparcas el móvil a tu hora, ganas ${I.onTime.of10} de cada 10 mañanas. Cuando no, ${I.other.of10}.`);
    if (!lines.length) lines.push('Con unos días de uso, aquí verás qué te funciona.');
    screen({
      top: BACK,
      scroll: true,
      middle: `
        <div class="gap"></div>
        <p class="huge">${S.totalWins}</p>
        <p class="sub">${S.totalWins === 1 ? 'mañana ganada' : 'mañanas ganadas'}</p>
        ${weekDots(S)}
        <div class="gap"></div>
        ${lines.map((l) => `<p>${esc(l)}</p>`).join('')}
        <p id="week" class="sub" hidden></p>`,
    });
    if (S.aiEnabled) {
      const r = await withTimeout(api('/api/ai/week'), 16000);
      const el = $app.querySelector('#week');
      if (el && r?.text) {
        el.textContent = r.text;
        el.hidden = false;
      }
    }
  }

  // ----- candado de Tiempo de uso -----

  async function renderLock() {
    const [L, S] = await Promise.all([api('/api/lock'), api('/api/state')]);
    const guide = `
      <details>
        <summary class="small muted">Qué poner en Tiempo de uso</summary>
        <ol class="guide">
          <li><b>Bloquear ajustes de Tiempo de uso</b> con el código de la app.</li>
          <li><b>Límites de uso</b>: Instagram, YouTube, <code>x.com</code>, <code>instagram.com</code> y <code>youtube.com</code>. 15–20 min al día.</li>
          <li><b>Contenido y privacidad → Instalar apps: No permitir.</b> Así no reinstalas Instagram.</li>
          <li>Opcional: <b>Tiempo de inactividad</b> de ${esc(S.settings.bedtime)} a ${esc(S.settings.wake)}.</li>
        </ol>
      </details>`;

    if (!L.exists) {
      screen({
        top: '<a href="#/ajustes">← Volver</a>',
        middle: `<p class="say">Un código de Tiempo de uso que no te sabes.</p>
          <p class="sub">Solo vuelve a aparecer si completas tu mañana o esperas ${L.waitMinutes} minutos.</p>${guide}`,
        bottom: '<button id="new">Crear código</button>',
      });
      return on('#new', 'click', async () => { await post('/api/lock/new'); renderLock(); });
    }

    if (L.pendingCode) {
      screen({
        middle: L.previousCode
          ? `<p class="sub">Código actual</p><p class="code">${esc(L.previousCode)}</p>
             <div class="gap"></div><p class="sub">Al acabar, cámbialo por este</p><p class="code">${esc(L.pendingCode)}</p>`
          : `<p class="say">Ponlo en Ajustes → Tiempo de uso.</p><p class="code">${esc(L.pendingCode)}</p><p class="sub">Después no volverás a verlo.</p>${guide}`,
        bottom: `<button id="ok">Hecho</button>${L.previousCode ? '' : '<button class="text" id="cancel">Cancelar</button>'}`,
      });
      on('#ok', 'click', async () => { await post('/api/lock/confirm'); renderLock(); });
      on('#cancel', 'click', async () => { await post('/api/lock/forget'); renderLock(); });
      return;
    }

    const waitLeft = L.waitEnds ? Math.max(0, Math.ceil((new Date(L.waitEnds) - Date.now()) / 1000)) : null;
    const mmss = (x) => `${Math.floor(x / 60)}:${String(x % 60).padStart(2, '0')}`;
    if (L.canReveal) {
      screen({
        top: '<a href="#/ajustes">← Volver</a>',
        middle: '<p class="say">Puedes ver el código.</p><p class="sub">Después se cambiará por uno nuevo.</p>',
        bottom: '<button id="reveal">Ver el código</button>',
      });
      return on('#reveal', 'click', async () => { await post('/api/lock/reveal'); renderLock(); });
    }
    screen({
      top: '<a href="#/ajustes">← Volver</a>',
      middle: waitLeft != null
        ? `<p class="huge" id="cd">${mmss(waitLeft)}</p><p class="sub">Si al terminar lo sigues necesitando, será por algo.</p>`
        : `<p class="say">Límites protegidos.</p><p class="sub">Para ver el código, completa tu mañana o espera ${L.waitMinutes} minutos.</p>`,
      bottom: waitLeft != null ? '' : `<button class="text" id="wait">Esperar ${L.waitMinutes} min</button>`,
    });
    on('#wait', 'click', async () => { await post('/api/lock/wait'); renderLock(); });
    if (waitLeft != null) {
      let left = waitLeft;
      screen.timer = setInterval(() => {
        left -= 1;
        if (left <= 0) return renderLock();
        const el = $app.querySelector('#cd');
        if (el) el.textContent = mmss(left);
      }, 1000);
    }
  }

  // ----- ajustes -----

  async function renderSettings() {
    const S = await api('/api/state');
    const s = S.settings;
    const stepsText = s.morningSteps.map((x) => `${x.min ? '* ' : ''}${x.text}`).join('\n');
    const altsBy = (e) => s.alternatives.filter((a) => a.energy === e).map((a) => a.text).join('\n');
    const canPush = 'serviceWorker' in navigator && 'PushManager' in window;
    const granted = canPush && Notification.permission === 'granted';
    screen({
      top: BACK,
      scroll: true,
      middle: `
        <p class="say">Ajustes</p>
        <div class="row">
          <div><label for="wake">Me despierto</label><input id="wake" type="time" value="${esc(s.wake)}"></div>
          <div><label for="bed">Móvil fuera</label><input id="bed" type="time" value="${esc(s.bedtime)}"></div>
        </div>
        <div class="gap"></div>

        <details>
          <summary>Avisos</summary>
          ${!canPush ? '<p class="small muted">Abre la app desde la pantalla de inicio para activarlos.</p>' : ''}
          ${canPush && !granted ? '<button id="push">Activar avisos</button>' : ''}
          <div class="switch"><label for="n1">30 min antes de aparcar</label><input type="checkbox" id="n1" ${s.notif.nightPrep ? 'checked' : ''}></div>
          <div class="switch"><label for="n2">Hora de aparcar</label><input type="checkbox" id="n2" ${s.notif.nightPark ? 'checked' : ''}></div>
          <div class="switch"><label for="n3">Buenos días</label><input type="checkbox" id="n3" ${s.notif.morningHello ? 'checked' : ''}></div>
          <div class="switch"><label for="n4">Si la mañana va a medias</label><input type="checkbox" id="n4" ${s.notif.morningNudge ? 'checked' : ''}></div>
          <label for="tone">Tono</label>
          <select id="tone">
            <option value="cercano" ${s.tone === 'cercano' ? 'selected' : ''}>Cercano</option>
            <option value="directo" ${s.tone === 'directo' ? 'selected' : ''}>Directo</option>
          </select>
          <label for="nmax">Máximo al día</label><input id="nmax" type="number" min="0" max="8" value="${s.notif.maxPerDay}">
          ${granted ? '<button class="text" id="test">Enviar uno de prueba</button>' : ''}
        </details>

        <details>
          <summary>Pasos de la mañana</summary>
          <p class="small muted">Uno por línea. Con * delante, forman la versión corta.</p>
          <textarea id="steps">${esc(stepsText)}</textarea>
        </details>

        <details>
          <summary>IA</summary>
          ${S.aiAvailable
            ? `<div class="switch"><label for="ai">Usar IA</label><input type="checkbox" id="ai" ${s.ai !== false ? 'checked' : ''}></div>
               <label for="about">Sobre ti</label>
               <textarea id="about" style="min-height:120px">${esc(s.aboutMe || '')}</textarea>
               <p class="small muted">La IA parte los pasos que se te atascan, propone qué hacer en la pausa y resume tu semana. Recibe lo que escribas aquí y tu uso de la app (horas, pasos, pausas); nunca tu código del candado.</p>`
            : '<p class="small muted">Desactivada. Para activarla, añade <code>OPENROUTER_API_KEY</code> en las variables de Railway.</p>'}
        </details>

        <details>
          <summary>Alternativas al móvil</summary>
          <label for="ab">Con poca energía</label><textarea id="ab" style="min-height:110px">${esc(altsBy('baja'))}</textarea>
          <label for="am">Con energía normal</label><textarea id="am" style="min-height:90px">${esc(altsBy('media'))}</textarea>
          <label for="aa">Con bastante energía</label><textarea id="aa" style="min-height:60px">${esc(altsBy('alta'))}</textarea>
          <div class="row">
            <div><label for="allow">Minutos al «entrar»</label><input id="allow" type="number" min="1" max="30" value="${s.allowMinutes}"></div>
            <div><label for="lw">Espera del candado</label><input id="lw" type="number" min="5" max="120" value="${s.lockWaitMinutes}"></div>
          </div>
        </details>

        <div class="options">
          <a class="btn text" style="text-align:left;padding:18px 0;color:var(--text);font-size:18px" href="#/candado">Candado de Tiempo de uso</a>
          <a class="btn text" style="text-align:left;padding:18px 0;color:var(--text);font-size:18px" href="#/atajos">Atajos de iOS</a>
        </div>
        <div class="gap"></div>
        <button class="text" id="export" style="text-align:left;padding:8px 0">Descargar mis datos</button>
        <button class="text" id="logout" style="text-align:left;padding:8px 0">Cerrar sesión</button>
        <div class="gap"></div>`,
      bottom: '<button id="save">Guardar</button>',
    });

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
            ...($app.querySelector('#ai') ? { ai: $app.querySelector('#ai').checked, aboutMe: val('#about').trim().slice(0, 600) } : {}),
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

  // ----- guía de Atajos -----

  async function renderShortcuts() {
    const base = location.origin;
    const { key } = await api('/api/shortcut-key');
    const url = (txt) => `<pre class="copy">${esc(txt)}</pre><button class="text small" style="text-align:left;padding:6px 0" data-copy="${esc(txt)}">Copiar</button>`;
    screen({
      top: '<a href="#/ajustes">← Volver</a>',
      scroll: true,
      middle: `
        <p class="say">Atajos de iOS</p>
        <p class="sub">Los enlaces no llevan tu código de acceso. La primera vez que un atajo abra Safari, te lo pedirá una sola vez.</p>
        <div class="gap"></div>

        <details>
          <summary>Pausa al abrir Instagram o YouTube</summary>
          <ol class="guide">
            <li>Automatización → + → <b>App</b> → Instagram → <b>Se abre</b> → <b>Ejecutar inmediatamente</b>.</li>
            <li><b>Obtener contenido de URL</b>:</li>
          </ol>
          ${url(`${base}/api/gate?app=instagram&k=${encodeURIComponent(key)}`)}
          <ol class="guide" start="3">
            <li><b>Si</b> el contenido <b>contiene</b> <code>pausa</code> → <b>Abrir URL</b>:</li>
          </ol>
          ${url(`${base}/#/pausa?app=instagram`)}
          <p class="small muted">Para YouTube, cambia <code>instagram</code> por <code>youtube</code> en las dos URLs. La primera lleva una llave de atajos: solo sirve para comprobar si toca pausa, no da acceso a tus datos.</p>
        </details>

        <details>
          <summary>Al llegar a la uni o a la biblioteca</summary>
          <ol class="guide">
            <li>Automatización → + → <b>Llegar</b> → elige la ubicación → <b>Ejecutar inmediatamente</b>.</li>
            <li><b>Abrir URL</b> (cambia <code>clase</code> por <code>biblioteca</code> si es la biblioteca):</li>
          </ol>
          ${url(`${base}/#/foco?lugar=clase`)}
          <p class="small muted">Al llegar, solo eliges cuánto tiempo y dejas el móvil en la mochila.</p>
        </details>

        <details>
          <summary>La alarma abre tu mañana</summary>
          <ol class="guide"><li>Automatización → + → <b>Alarma</b> → <b>Se detiene</b> → <b>Abrir URL</b>:</li></ol>
          ${url(`${base}/#/manana`)}
        </details>

        <details>
          <summary>Modo Dormir abre la noche</summary>
          <ol class="guide"><li>Automatización → + → <b>Modo de concentración</b> → Dormir → Al activarse → <b>Abrir URL</b>:</li></ol>
          ${url(`${base}/#/noche`)}
        </details>

        <details>
          <summary>X en el navegador</summary>
          <p class="small muted">Atajos no detecta webs. Añade <code>x.com</code> a los límites de Tiempo de uso y protégelo con el candado.</p>
        </details>

        <div class="gap"></div>
        <button class="text small" id="rotate" style="text-align:left;padding:6px 0">Cambiar la llave de atajos</button>
        <p class="small muted">Si alguien ha visto el enlace de la pausa. Tendrás que pegar el enlace nuevo en los atajos de Instagram y YouTube.</p>`,
    });
    on('#rotate', 'click', async (e, el) => {
      if (el.dataset.sure !== '1') {
        el.dataset.sure = '1';
        el.textContent = '¿Seguro? Pulsa otra vez';
        return;
      }
      await post('/api/shortcut-key/rotate');
      toast('Llave cambiada');
      renderShortcuts();
    });
    on('[data-copy]', 'click', async (e, el) => {
      try { await navigator.clipboard.writeText(el.dataset.copy); toast('Copiado'); } catch { toast('Mantén pulsado el texto para copiarlo'); }
    });
  }

  // ---------- router ----------

  async function router() {
    stripTokenFromUrl();
    const { route } = parseHash();
    if (!token() && route !== 'login') return renderLogin();
    try {
      switch (route) {
        case 'login': return renderLogin();
        case 'manana': return await renderMorning();
        case 'noche': return await renderNight();
        case 'foco': return await renderFocus();
        case 'pausa': return await renderPause();
        case 'progreso': return await renderProgress();
        case 'candado': return await renderLock();
        case 'ajustes': return await renderSettings();
        case 'atajos': return await renderShortcuts();
        default: return await renderHome();
      }
    } catch (err) {
      if (err.message === 'no autorizado') return;
      screen({ middle: `<p class="say">Algo ha fallado.</p><p class="sub">${esc(err.message)}</p>`, bottom: '<button onclick="location.reload()">Reintentar</button>' });
    }
  }

  window.addEventListener('hashchange', router);

  // Cada vez que vuelves a la app durante una sesión, cuenta como haber mirado el móvil.
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
    const { route } = parseHash();
    if (token() && (route === '' || route === 'foco') && hiddenAt && Date.now() - hiddenAt > 5000) {
      try { await post('/api/focus/pickup'); } catch { /* sin conexión */ }
    }
    if (['', 'foco', 'candado'].includes(route)) router();
  });

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  router();
})();
