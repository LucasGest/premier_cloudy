(function () {
  const $ = (id) => document.getElementById(id);
  const MAP_NAME = Object.fromEntries(window.MAPS.map((m) => [m.id, m.nom]));
  const SECTIONS = [
    { key: 'attaque', titre: 'Attaque', aide: 'Exécutions par site, défauts, timings.' },
    { key: 'defense', titre: 'Défense', aide: 'Setups, placements, rotations.' },
    { key: 'retake', titre: 'Retake', aide: 'Plans de retake par site.' },
    { key: 'notes', titre: 'Notes', aide: 'Tout le reste.' }
  ];

  const state = {
    data: { maps: {}, compos: {}, matchs: {} },
    view: 'maps',
    map: window.MAPS[0].id,
    editing: null // "maps:<id>", "compos:<id>", "matchs:<id>" ou "matchs:nouveau"
  };

  // Construction du DOM : textContent partout, jamais de HTML injecté.
  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
    return el;
  }

  let toastTimer;
  function toast(text) {
    const t = $('toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  function formatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) + ' à ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }
  function metaLine(doc) {
    return doc?.updatedBy ? h('span', { class: 'meta' }, `Modifié par ${doc.updatedBy} le ${formatDate(doc.updatedAt)}`) : null;
  }

  async function save(collection, id, data) {
    try {
      const res = await Api.save(collection, id, data);
      state.data[collection][res.id] = res.data;
      state.editing = null;
      render();
      toast('Enregistré');
    } catch (e) {
      handleError(e);
    }
  }

  function handleError(e) {
    if (e.auth) return showLogin();
    toast("Échec de l'enregistrement, réessayez");
  }

  // ---------- Maps ----------
  function viewMaps() {
    const list = h(
      'nav',
      { class: 'map-list', 'aria-label': 'Maps' },
      window.MAPS.map((m) => {
        const filled = Boolean(state.data.maps[m.id]);
        return h(
          'button',
          {
            class: 'map-item',
            'aria-current': m.id === state.map ? 'true' : 'false',
            onclick: () => {
              state.map = m.id;
              state.editing = null;
              render();
            }
          },
          m.nom,
          filled && h('span', { class: 'dot', title: 'Strats renseignées' })
        );
      })
    );
    return h('div', { class: 'maps-layout' }, list, mapSheet(state.map));
  }

  function mapSheet(id) {
    const doc = state.data.maps[id] || {};
    const compo = state.data.compos[id];
    const editing = state.editing === `maps:${id}`;

    const head = h(
      'div',
      { class: 'sheet-head' },
      h('div', null, h('h2', null, MAP_NAME[id]), metaLine(doc)),
      !editing && h('button', { class: 'btn', onclick: () => ((state.editing = `maps:${id}`), render()) }, 'Modifier')
    );

    const compoStrip = h(
      'div',
      { class: 'block' },
      h('h3', null, 'Compo'),
      compo && compo.slots.some((s) => s.agent)
        ? h('div', { class: 'compo-strip' }, compo.slots.filter((s) => s.agent).map((s) => h('span', { class: 'agent-tag' }, s.agent, s.joueur && h('small', null, ` · ${s.joueur}`))))
        : h('p', { class: 'empty-text' }, "Pas encore de compo. Elle se remplit dans l'onglet Compos.")
    );

    if (!editing) {
      const blocks = SECTIONS.map((s) =>
        h('div', { class: 'block' }, h('h3', null, s.titre), doc[s.key] ? h('p', null, doc[s.key]) : h('p', { class: 'empty-text' }, 'Rien pour le moment.'))
      );
      return h('section', { class: 'sheet' }, head, compoStrip, blocks);
    }

    const fields = {};
    const form = h(
      'form',
      {
        class: 'sheet',
        onsubmit: (e) => {
          e.preventDefault();
          save('maps', id, Object.fromEntries(SECTIONS.map((s) => [s.key, fields[s.key].value])));
        }
      },
      head,
      SECTIONS.map((s) => {
        fields[s.key] = h('textarea', { name: s.key, placeholder: s.aide, value: doc[s.key] || '' });
        return h('label', { class: 'field' }, s.titre, fields[s.key]);
      }),
      h('div', { class: 'toolbar' }, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Enregistrer'), h('button', { class: 'btn', type: 'button', onclick: () => ((state.editing = null), render()) }, 'Annuler'))
    );
    return form;
  }

  // ---------- Compos ----------
  function agentSelect(value) {
    return h(
      'select',
      { 'aria-label': 'Agent' },
      h('option', { value: '' }, 'Agent'),
      Object.entries(window.AGENTS).map(([role, names]) =>
        h('optgroup', { label: role }, names.map((n) => h('option', { value: n, selected: n === value }, n)))
      )
    );
  }

  function viewCompos() {
    return h(
      'div',
      { class: 'grid' },
      window.MAPS.map((m) => {
        const doc = state.data.compos[m.id];
        const slots = doc?.slots || Array.from({ length: 5 }, () => ({ agent: '', joueur: '' }));
        const editing = state.editing === `compos:${m.id}`;

        if (!editing) {
          const filled = slots.some((s) => s.agent);
          return h(
            'article',
            { class: 'card' },
            h('div', { class: 'card-head' }, h('h3', null, m.nom), h('button', { class: 'btn', onclick: () => ((state.editing = `compos:${m.id}`), render()) }, 'Modifier')),
            filled
              ? h('ul', { class: 'slots' }, slots.map((s) => h('li', null, h('span', null, s.agent || '-'), h('span', { class: 'player' }, s.joueur || ''))))
              : h('p', { class: 'empty-text' }, 'Pas de compo.'),
            doc?.notes && h('p', { class: 'meta' }, doc.notes),
            metaLine(doc)
          );
        }

        const rows = slots.map((s) => ({ agent: agentSelect(s.agent), joueur: h('input', { placeholder: 'Joueur', value: s.joueur, maxlength: 40 }) }));
        const notes = h('textarea', { placeholder: 'Notes (rôles, variantes...)', value: doc?.notes || '', style: 'min-height:70px' });
        return h(
          'form',
          {
            class: 'card',
            onsubmit: (e) => {
              e.preventDefault();
              save('compos', m.id, { slots: rows.map((r) => ({ agent: r.agent.value, joueur: r.joueur.value.trim() })), notes: notes.value });
            }
          },
          h('h3', null, m.nom),
          rows.map((r) => h('div', { class: 'slot-edit' }, r.agent, r.joueur)),
          notes,
          h('div', { class: 'toolbar' }, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Enregistrer'), h('button', { class: 'btn', type: 'button', onclick: () => ((state.editing = null), render()) }, 'Annuler'))
        );
      })
    );
  }

  // ---------- Matchs ----------
  function matchForm(id, doc) {
    const f = {
      date: h('input', { type: 'date', value: doc.date || new Date().toISOString().slice(0, 10), required: true }),
      map: h('select', null, window.MAPS.map((m) => h('option', { value: m.id, selected: m.id === doc.map }, m.nom))),
      adversaire: h('input', { placeholder: 'Équipe adverse', value: doc.adversaire || '', maxlength: 60 }),
      scoreNous: h('input', { type: 'number', min: 0, max: 30, value: doc.scoreNous ?? 13 }),
      scoreEux: h('input', { type: 'number', min: 0, max: 30, value: doc.scoreEux ?? 0 }),
      debrief: h('textarea', { placeholder: "Ce qui a marché, ce qui est à revoir.", value: doc.debrief || '' })
    };
    return h(
      'form',
      {
        class: 'card',
        onsubmit: (e) => {
          e.preventDefault();
          save('matchs', id, {
            date: f.date.value,
            map: f.map.value,
            adversaire: f.adversaire.value.trim(),
            scoreNous: Number(f.scoreNous.value),
            scoreEux: Number(f.scoreEux.value),
            debrief: f.debrief.value
          });
        }
      },
      h('h3', null, id ? 'Modifier le match' : 'Nouveau match'),
      h(
        'div',
        { class: 'form-grid' },
        h('label', { class: 'field' }, 'Date', f.date),
        h('label', { class: 'field' }, 'Map', f.map),
        h('label', { class: 'field' }, 'Adversaire', f.adversaire),
        h('label', { class: 'field' }, 'Nos rounds', f.scoreNous),
        h('label', { class: 'field' }, 'Leurs rounds', f.scoreEux)
      ),
      h('label', { class: 'field' }, 'Debrief', f.debrief),
      h('div', { class: 'toolbar' }, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Enregistrer'), h('button', { class: 'btn', type: 'button', onclick: () => ((state.editing = null), render()) }, 'Annuler'))
    );
  }

  function viewMatchs() {
    const entries = Object.entries(state.data.matchs).sort((a, b) => (b[1].date || '').localeCompare(a[1].date || ''));
    const wins = entries.filter(([, m]) => m.scoreNous > m.scoreEux).length;
    const losses = entries.filter(([, m]) => m.scoreNous < m.scoreEux).length;

    const header = h(
      'div',
      { class: 'record' },
      h('div', null, h('strong', null, `${wins} V · ${losses} D`), h('div', { class: 'meta' }, `${entries.length} match${entries.length > 1 ? 's' : ''} joué${entries.length > 1 ? 's' : ''}`)),
      state.editing !== 'matchs:nouveau' && h('button', { class: 'btn btn-primary', onclick: () => ((state.editing = 'matchs:nouveau'), render()) }, 'Ajouter un match')
    );

    const list = entries.map(([id, m]) => {
      if (state.editing === `matchs:${id}`) return matchForm(id, m);
      const result = m.scoreNous > m.scoreEux ? 'win' : m.scoreNous < m.scoreEux ? 'loss' : '';
      return h(
        'article',
        { class: `match ${result}` },
        h(
          'div',
          { class: 'match-row' },
          h('span', { class: 'score' }, `${m.scoreNous} - ${m.scoreEux}`),
          h('div', { class: 'match-info' }, h('strong', null, `${MAP_NAME[m.map] || m.map}${m.adversaire ? ' contre ' + m.adversaire : ''}`), h('span', { class: 'meta' }, new Date(m.date + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }))),
          h('button', { class: 'btn', onclick: () => ((state.editing = `matchs:${id}`), render()) }, 'Modifier'),
          h(
            'button',
            {
              class: 'btn btn-danger',
              onclick: async () => {
                if (!confirm('Supprimer ce match ?')) return;
                try {
                  await Api.remove('matchs', id);
                  delete state.data.matchs[id];
                  render();
                  toast('Match supprimé');
                } catch (e) {
                  handleError(e);
                }
              }
            },
            'Supprimer'
          )
        ),
        m.debrief ? h('details', null, h('summary', null, 'Debrief'), h('p', null, m.debrief)) : null,
        metaLine(m)
      );
    });

    return h(
      'div',
      null,
      header,
      h('div', { class: 'matches' }, state.editing === 'matchs:nouveau' && matchForm(null, {}), list.length ? list : state.editing !== 'matchs:nouveau' && h('p', { class: 'empty-text' }, 'Aucun match enregistré.'))
    );
  }

  // ---------- Rendu ----------
  function render() {
    document.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', t.dataset.view === state.view ? 'true' : 'false'));
    const view = { maps: viewMaps, compos: viewCompos, matchs: viewMatchs }[state.view]();
    $('view').replaceChildren(view);
  }

  function showLogin() {
    $('app').hidden = true;
    $('login').hidden = false;
    const err = new URLSearchParams(location.search).get('erreur');
    const messages = {
      acces: "Accès refusé : il faut le rôle Premier ou IGL sur le serveur CloudyCat.",
      connexion: 'La connexion avec Discord a échoué, réessayez.'
    };
    if (messages[err]) {
      $('login-error').textContent = messages[err];
      $('login-error').hidden = false;
    }
  }

  document.querySelectorAll('.tab').forEach((t) =>
    t.addEventListener('click', () => {
      state.view = t.dataset.view;
      state.editing = null;
      render();
    })
  );

  (async function start() {
    try {
      const me = await Api.me();
      state.data = await Api.all();
      for (const k of ['maps', 'compos', 'matchs']) state.data[k] = state.data[k] || {};
      $('user-name').textContent = me.name;
      if (me.avatar) {
        $('user-avatar').src = me.avatar;
        $('user-avatar').hidden = false;
      }
      if (Api.demo) {
        $('demo-banner').hidden = false;
        $('logout').hidden = true;
      }
      $('login').hidden = true;
      $('app').hidden = false;
      history.replaceState(null, '', location.pathname + (Api.demo && location.protocol !== 'file:' ? '?demo' : ''));
      render();
    } catch (e) {
      showLogin();
    }
  })();
})();
