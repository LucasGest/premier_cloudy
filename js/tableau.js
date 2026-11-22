// Tableau tactique : la minimap officielle, des étapes, et sur chaque étape des
// agents, des compétences, des flèches, des zones et des textes.
//   Tableau.view(board, mapId)                 -> aperçu avec lecture animée
//   Tableau.edit(board, mapId, { side, agents, onSave }) -> éditeur plein écran
//     (onSave peut renvoyer une promesse : false garde l'éditeur ouvert)
// Format : { phases: [{ nom, items: [...] }] }, coordonnées de 0 à 1000.
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const COLORS = ['#ff4655', '#4aa8e0', '#f5c542', '#3ecf8e', '#ffffff', '#b46cff'];
  const MAP_BY_ID = Object.fromEntries(window.MAPS.map((m) => [m.id, m]));
  const MOVE_MS = 900;
  let uid = 0;

  function s(tag, attrs, ...children) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v != null) el.setAttribute(k, v);
    for (const c of children) if (c) el.append(c);
    return el;
  }
  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
    return el;
  }
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const hasContent = (b) => Boolean(b?.phases?.some((p) => p.items?.length));
  const emptyBoard = () => ({ phases: [{ nom: 'Setup', items: [] }] });

  // Clé d'un agent d'une étape à l'autre : même agent, même camp (et rang s'il est en double).
  function agentKeys(items) {
    const seen = {};
    return items.map((it) => {
      if (it.t !== 'a') return null;
      const k = `${it.s}:${it.a}`;
      seen[k] = (seen[k] || 0) + 1;
      return `${k}:${seen[k]}`;
    });
  }

  // ---------- Rendu d'une étape ----------
  function buildSvg(mapId, id) {
    const map = MAP_BY_ID[mapId];
    const defs = s('defs');
    COLORS.forEach((c, i) =>
      defs.append(
        s('marker', { id: `${id}-arrow-${i}`, viewBox: '0 0 10 10', refX: '6', refY: '5', markerWidth: '4', markerHeight: '4', orient: 'auto-start-reverse' }, s('path', { d: 'M0,0 L10,5 L0,10 z', fill: c }))
      )
    );
    defs.append(s('clipPath', { id: `${id}-clip-agent`, clipPathUnits: 'objectBoundingBox' }, s('circle', { cx: '0.5', cy: '0.5', r: '0.5' })));
    const svg = s(
      'svg',
      { viewBox: '0 0 1000 1000', class: 'board-svg', role: 'img', 'aria-label': `Tableau tactique ${map?.nom || ''}` },
      defs,
      s('rect', { x: 0, y: 0, width: 1000, height: 1000, class: 'board-bg' }),
      map ? s('image', { href: map.minimap, x: 0, y: 0, width: 1000, height: 1000, preserveAspectRatio: 'xMidYMid meet' }) : null,
      s('g', { class: 'layer' })
    );
    return svg;
  }

  function smoothPath(p) {
    if (p.length < 4) return '';
    let d = `M${p[0]},${p[1]}`;
    if (p.length === 4) return `${d} L${p[2]},${p[3]}`;
    for (let i = 2; i < p.length - 2; i += 2) {
      const mx = (p[i] + p[i + 2]) / 2;
      const my = (p[i + 1] + p[i + 3]) / 2;
      d += ` Q${p[i]},${p[i + 1]} ${mx},${my}`;
    }
    return `${d} L${p[p.length - 2]},${p[p.length - 1]}`;
  }

  function itemNode(it, id, index) {
    const data = { 'data-index': index };
    if (it.t === 'l') {
      return s('path', { ...data, class: 'it it-line', d: smoothPath(it.p), stroke: COLORS[it.c], 'marker-end': it.f ? `url(#${id}-arrow-${it.c})` : null });
    }
    if (it.t === 'z') {
      return s('circle', { ...data, class: 'it it-zone', cx: it.x, cy: it.y, r: it.r, fill: COLORS[it.c], stroke: COLORS[it.c] });
    }
    if (it.t === 'x') {
      return s('text', { ...data, class: 'it it-text', x: it.x, y: it.y, fill: COLORS[it.c] }, document.createTextNode(it.txt));
    }
    if (it.t === 'u') {
      const ab = window.AGENT_ABILITIES[it.a]?.[it.i];
      return s(
        'g',
        { ...data, class: 'it it-util', transform: `translate(${it.x},${it.y})` },
        s('title', null, document.createTextNode(ab ? `${it.a} · ${ab.nom}` : it.a)),
        s('circle', { r: 23, class: 'util-bg' }),
        ab ? s('image', { href: ab.icon, x: -15, y: -15, width: 30, height: 30 }) : null
      );
    }
    if (it.t === 'a') {
      const icon = window.AGENT_ICONS[it.a];
      return s(
        'g',
        { ...data, class: `it it-agent side-${it.s}`, transform: `translate(${it.x},${it.y})` },
        s('title', null, document.createTextNode(`${it.a} (${it.s === 'def' ? 'défense' : 'attaque'})`)),
        s('circle', { r: 33, class: 'agent-ring' }),
        icon ? s('image', { href: icon, x: -28, y: -28, width: 56, height: 56, 'clip-path': `url(#${id}-clip-agent)` }) : null
      );
    }
    return null;
  }

  // Dessine une étape. prev : étape précédente, pour faire glisser les agents.
  function draw(svg, id, phase, prev) {
    const layer = svg.querySelector('.layer');
    const order = { z: 0, l: 1, u: 2, x: 3, a: 4 };
    const indexed = phase.items.map((it, i) => [it, i]).sort((a, b) => order[a[0].t] - order[b[0].t]);
    layer.replaceChildren(...indexed.map(([it, i]) => itemNode(it, id, i)).filter(Boolean));
    if (!prev) return;

    const before = {};
    agentKeys(prev.items).forEach((k, i) => k && (before[k] = prev.items[i]));
    const keys = agentKeys(phase.items);
    const moving = [];
    layer.querySelectorAll('.it').forEach((node) => {
      const i = Number(node.dataset.index);
      const from = keys[i] && before[keys[i]];
      if (from) moving.push({ node, from, to: phase.items[i] });
      else node.classList.add('appear');
    });
    if (!moving.length) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const start = performance.now();
    const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
    (function frame(now) {
      const t = reduce ? 1 : Math.min(1, (now - start) / MOVE_MS);
      for (const m of moving) {
        const k = ease(t);
        m.node.setAttribute('transform', `translate(${m.from.x + (m.to.x - m.from.x) * k},${m.from.y + (m.to.y - m.from.y) * k})`);
      }
      if (t < 1) requestAnimationFrame(frame);
    })(start);
  }

  // ---------- Aperçu avec lecture ----------
  function view(board, mapId) {
    const id = `tb${++uid}`;
    const svg = buildSvg(mapId, id);
    const phases = board.phases;
    let current = 0;
    let timer = null;

    const pills = h('div', { class: 'board-phases' });
    const play = h('button', { class: 'btn board-play', type: 'button' }, 'Lecture');
    function show(i, animate) {
      const prev = animate ? phases[current] : null;
      current = i;
      draw(svg, id, phases[i], prev);
      pills.querySelectorAll('button').forEach((b, j) => b.setAttribute('aria-pressed', j === i ? 'true' : 'false'));
    }
    function stop() {
      clearInterval(timer);
      timer = null;
      play.textContent = 'Lecture';
    }
    phases.forEach((ph, i) =>
      pills.append(
        h('button', { class: 'filter', type: 'button', onclick: () => (stop(), show(i, Math.abs(i - current) === 1)) }, `${i + 1}. ${ph.nom}`)
      )
    );
    play.addEventListener('click', () => {
      if (timer) return stop();
      play.textContent = 'Pause';
      show(0, false);
      timer = setInterval(() => {
        if (current + 1 >= phases.length) return stop();
        show(current + 1, true);
      }, MOVE_MS + 900);
    });
    show(0, false);
    return h('div', { class: 'board-view' }, h('div', { class: 'board-frame' }, svg), phases.length > 1 ? h('div', { class: 'board-bar' }, pills, play) : null);
  }

  // ---------- Éditeur ----------
  function edit(initial, mapId, { side = 'att', agents = [], onSave }) {
    const id = `tb${++uid}`;
    const board = clone(initial?.phases?.length ? initial : emptyBoard());
    const state = { phase: 0, tool: 'move', color: 0, side, agent: agents[0] || 'Jett', util: 0, selected: null, dirty: false, allAgents: false };
    const history = [];

    const svg = buildSvg(mapId, id);
    svg.classList.add('editing');
    // Message affiché à côté des boutons d'enregistrement (tableau vide...).
    const notice = h('span', { class: 'tb-notice', role: 'alert' });
    notice.hidden = true;
    const phase = () => board.phases[state.phase];

    function snapshot() {
      history.push(JSON.stringify(board));
      if (history.length > 60) history.shift();
      state.dirty = true;
      notice.hidden = true;
    }
    function redraw() {
      draw(svg, id, phase(), null);
      if (state.selected != null) svg.querySelector(`.it[data-index="${state.selected}"]`)?.classList.add('selected');
      renderPhases();
    }

    // Coordonnées écran -> repère 0..1000 du tableau.
    function point(e) {
      const pt = svg.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const p = pt.matrixTransform(svg.getScreenCTM().inverse());
      return { x: Math.round(Math.min(1000, Math.max(0, p.x))), y: Math.round(Math.min(1000, Math.max(0, p.y))) };
    }

    let drag = null;
    svg.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const p = point(e);
      const hit = e.target.closest('.it');
      const items = phase().items;

      if (state.tool === 'move' || state.tool === 'erase') {
        if (!hit) {
          state.selected = null;
          return redraw();
        }
        const i = Number(hit.dataset.index);
        if (state.tool === 'erase') {
          snapshot();
          items.splice(i, 1);
          state.selected = null;
          return redraw();
        }
        state.selected = i;
        const it = items[i];
        snapshot();
        drag = { kind: 'move', i, start: p, orig: clone(it) };
        svg.setPointerCapture(e.pointerId);
        return redraw();
      }

      snapshot();
      if (state.tool === 'agent') items.push({ t: 'a', a: state.agent, s: state.side, x: p.x, y: p.y });
      else if (state.tool === 'util') items.push({ t: 'u', a: state.agent, i: state.util, x: p.x, y: p.y });
      else if (state.tool === 'text') {
        const txt = window.prompt('Texte à afficher (40 caractères max)');
        if (!txt || !txt.trim()) return history.pop();
        items.push({ t: 'x', c: state.color, x: p.x, y: p.y, txt: txt.trim().slice(0, 40) });
      } else if (state.tool === 'arrow' || state.tool === 'line') {
        items.push({ t: 'l', c: state.color, f: state.tool === 'arrow', p: [p.x, p.y, p.x, p.y] });
        drag = { kind: 'draw', i: items.length - 1 };
        svg.setPointerCapture(e.pointerId);
      } else if (state.tool === 'zone') {
        items.push({ t: 'z', c: state.color, x: p.x, y: p.y, r: 40 });
        drag = { kind: 'zone', i: items.length - 1, start: p };
        svg.setPointerCapture(e.pointerId);
      }
      state.selected = null;
      redraw();
    });

    svg.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const p = point(e);
      const it = phase().items[drag.i];
      if (drag.kind === 'move') {
        const dx = p.x - drag.start.x;
        const dy = p.y - drag.start.y;
        const clamp = (v) => Math.min(1000, Math.max(0, v));
        if (it.t === 'l') it.p = drag.orig.p.map((v, k) => clamp(v + (k % 2 ? dy : dx)));
        else Object.assign(it, { x: clamp(drag.orig.x + dx), y: clamp(drag.orig.y + dy) });
      } else if (drag.kind === 'draw') {
        // La pointe suit le pointeur ; un point est figé tous les 14 unités,
        // 80 points au plus : tracé lisse et léger.
        const n = it.p.length;
        it.p[n - 2] = p.x;
        it.p[n - 1] = p.y;
        if (n < 160 && Math.hypot(p.x - it.p[n - 4], p.y - it.p[n - 3]) >= 14) it.p.push(p.x, p.y);
      } else if (drag.kind === 'zone') {
        it.r = Math.min(300, Math.max(10, Math.round(Math.hypot(p.x - drag.start.x, p.y - drag.start.y))));
      }
      redraw();
    });

    function endDrag() {
      if (!drag) return;
      const it = phase().items[drag.i];
      // Un simple clic avec l'outil flèche ne laisse pas de trait d'un point.
      if (drag.kind === 'draw' && it && Math.hypot(it.p[it.p.length - 2] - it.p[0], it.p[it.p.length - 1] - it.p[1]) < 8) phase().items.splice(drag.i, 1);
      drag = null;
      redraw();
    }
    svg.addEventListener('pointerup', endDrag);
    svg.addEventListener('pointercancel', endDrag);

    // ----- Barre d'outils -----
    const TOOLS = [
      ['move', 'Déplacer'],
      ['agent', 'Agent'],
      ['util', 'Compétence'],
      ['arrow', 'Flèche'],
      ['line', 'Trait'],
      ['zone', 'Zone'],
      ['text', 'Texte'],
      ['erase', 'Gomme']
    ];
    const toolBar = h('div', { class: 'tb-tools', role: 'toolbar', 'aria-label': 'Outils' });
    const colorBar = h('div', { class: 'tb-colors', role: 'group', 'aria-label': 'Couleur' });
    const sideBar = h('div', { class: 'tb-side', role: 'group', 'aria-label': 'Camp' });
    const agentBar = h('div', { class: 'tb-agents' });
    const utilBar = h('div', { class: 'tb-utils' });
    const phaseBar = h('div', { class: 'board-phases tb-phases' });

    function renderTools() {
      toolBar.replaceChildren(
        ...TOOLS.map(([k, label]) =>
          h('button', { type: 'button', class: 'filter', 'aria-pressed': state.tool === k ? 'true' : 'false', onclick: () => ((state.tool = k), (state.selected = null), renderTools(), redraw()) }, label)
        )
      );
      colorBar.replaceChildren(
        ...COLORS.map((c, i) => {
          const b = h('button', { type: 'button', class: 'swatch', 'aria-label': `Couleur ${i + 1}`, 'aria-pressed': state.color === i ? 'true' : 'false', onclick: () => ((state.color = i), renderTools()) });
          b.style.background = c;
          return b;
        })
      );
      sideBar.replaceChildren(
        ...[
          ['att', 'Attaque'],
          ['def', 'Défense']
        ].map(([k, label]) => h('button', { type: 'button', class: `filter side-${k}`, 'aria-pressed': state.side === k ? 'true' : 'false', onclick: () => ((state.side = k), renderTools()) }, label))
      );
      // Les agents de la strat d'abord ; la liste complète sur demande
      // (pour placer l'équipe adverse).
      const all = Object.values(window.AGENTS).flat();
      const names = state.allAgents || !agents.length ? [...new Set([...agents, ...all])] : agents;
      agentBar.replaceChildren(
        ...names.map((n) => {
          const b = h('button', { type: 'button', class: 'tb-agent', title: n, 'aria-label': n, 'aria-pressed': state.agent === n ? 'true' : 'false', onclick: () => ((state.agent = n), state.tool === 'move' && (state.tool = 'agent'), renderTools()) });
          b.append(h('img', { src: window.AGENT_ICONS[n], alt: '' }));
          return b;
        }),
        agents.length
          ? h('button', { type: 'button', class: 'filter tb-more', onclick: () => ((state.allAgents = !state.allAgents), renderTools()) }, state.allAgents ? 'Agents de la strat' : 'Autres agents')
          : null
      );
      utilBar.replaceChildren(
        h('span', { class: 'meta' }, `${state.agent} :`),
        ...(window.AGENT_ABILITIES[state.agent] || []).map((ab, i) => {
          const b = h('button', { type: 'button', class: 'tb-util', title: ab.nom, 'aria-label': ab.nom, 'aria-pressed': state.tool === 'util' && state.util === i ? 'true' : 'false', onclick: () => ((state.util = i), (state.tool = 'util'), renderTools()) });
          b.append(h('img', { src: ab.icon, alt: '' }));
          return b;
        })
      );
    }

    function renderPhases() {
      phaseBar.replaceChildren(
        ...board.phases.map((ph, i) =>
          h('button', { type: 'button', class: 'filter', 'aria-pressed': i === state.phase ? 'true' : 'false', title: 'Double-clic pour renommer', onclick: () => ((state.phase = i), (state.selected = null), redraw()), ondblclick: () => renamePhase(i) }, `${i + 1}. ${ph.nom}`)
        ),
        board.phases.length < 8 &&
          h(
            'button',
            {
              type: 'button',
              class: 'filter',
              title: "Copie l'étape en cours : il suffit ensuite de déplacer les agents",
              onclick: () => {
                snapshot();
                board.phases.splice(state.phase + 1, 0, { nom: `Étape ${board.phases.length + 1}`, items: clone(phase().items.filter((it) => it.t === 'a')) });
                state.phase += 1;
                redraw();
              }
            },
            '+ Étape'
          )
      );
    }
    function renamePhase(i) {
      const nom = window.prompt("Nom de l'étape", board.phases[i].nom);
      if (nom && nom.trim()) {
        snapshot();
        board.phases[i].nom = nom.trim().slice(0, 30);
        redraw();
      }
    }

    function undo() {
      if (!history.length) return;
      Object.assign(board, JSON.parse(history.pop()));
      state.phase = Math.min(state.phase, board.phases.length - 1);
      state.selected = null;
      redraw();
    }
    function deleteSelected() {
      if (state.selected == null) return;
      snapshot();
      phase().items.splice(state.selected, 1);
      state.selected = null;
      redraw();
    }

    const overlay = h(
      'div',
      { class: 'board-editor', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Tableau tactique' },
      h(
        'div',
        { class: 'tb-head' },
        h('strong', null, `Tableau · ${MAP_BY_ID[mapId]?.nom || ''}`),
        phaseBar,
        h(
          'div',
          { class: 'toolbar' },
          h('button', { type: 'button', class: 'btn', onclick: undo, title: 'Ctrl+Z' }, 'Annuler'),
          h('button', { type: 'button', class: 'btn', onclick: () => renamePhase(state.phase) }, 'Renommer'),
          h(
            'button',
            {
              type: 'button',
              class: 'btn btn-danger',
              onclick: () => {
                if (board.phases.length === 1) {
                  if (!confirm('Vider cette étape ?')) return;
                  snapshot();
                  phase().items = [];
                } else {
                  if (!confirm(`Supprimer l'étape « ${phase().nom} » ?`)) return;
                  snapshot();
                  board.phases.splice(state.phase, 1);
                  state.phase = Math.max(0, state.phase - 1);
                }
                redraw();
              }
            },
            'Supprimer l’étape'
          )
        )
      ),
      h(
        'div',
        { class: 'tb-body' },
        h('div', { class: 'board-frame tb-board' }, svg),
        h(
          'aside',
          { class: 'tb-panel' },
          h('div', { class: 'tb-section' }, h('span', { class: 'meta' }, 'Outil'), toolBar),
          h('div', { class: 'tb-section' }, h('span', { class: 'meta' }, 'Couleur des flèches, zones et textes'), colorBar),
          h('div', { class: 'tb-section' }, h('span', { class: 'meta' }, 'Camp des agents posés'), sideBar),
          h('div', { class: 'tb-section' }, h('span', { class: 'meta' }, 'Agent'), agentBar),
          h('div', { class: 'tb-section' }, h('span', { class: 'meta' }, 'Compétences'), utilBar),
          h(
            'p',
            { class: 'meta tb-help' },
            "Déplacer : glisser un élément (Suppr pour l'effacer). Flèche et trait : tracer à la souris ou au doigt. Zone : cliquer puis tirer pour la taille. + Étape copie les agents de l'étape en cours : il ne reste qu'à les déplacer, la lecture les fera glisser."
          )
        )
      ),
      h(
        'div',
        { class: 'tb-foot' },
        notice,
        h('button', { type: 'button', class: 'btn', onclick: () => close(false) }, 'Fermer sans enregistrer'),
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => close(true) }, 'Enregistrer le tableau')
      )
    );

    function onKey(e) {
      if (e.key === 'Escape') close(false);
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') (e.preventDefault(), undo());
      else if ((e.key === 'Delete' || e.key === 'Backspace') && state.selected != null && !/input|textarea/i.test(e.target.tagName)) (e.preventDefault(), deleteSelected());
    }
    let saving = false;
    async function close(save) {
      if (saving) return;
      if (!save && state.dirty && !confirm('Fermer sans enregistrer les changements ?')) return;
      if (save && !hasContent(board)) {
        // Rien de posé : un nouveau tableau vide n'est pas enregistré ; un
        // tableau existant vidé à la main est supprimé après confirmation.
        if (!hasContent(initial)) {
          notice.textContent = 'Pose au moins un élément sur la map avant d’enregistrer.';
          notice.hidden = false;
          return;
        }
        if (!confirm('Le tableau est vide. Supprimer le tableau de cette strat ?')) return;
      }
      if (save) {
        // L'éditeur reste ouvert tant que le serveur n'a pas confirmé :
        // en cas d'échec (réseau, limite), le dessin n'est pas perdu.
        saving = true;
        const ok = await onSave(board);
        saving = false;
        if (ok === false) return;
      }
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      document.body.classList.remove('no-scroll');
    }

    document.addEventListener('keydown', onKey);
    document.body.classList.add('no-scroll');
    document.body.append(overlay);
    renderTools();
    redraw();
  }

  window.Tableau = { view, edit, hasContent };
})();
