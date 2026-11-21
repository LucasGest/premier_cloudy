(function () {
  const $ = (id) => document.getElementById(id);
  const MAP_NAME = Object.fromEntries(window.MAPS.map((m) => [m.id, m.nom]));
  const MAP_BY_ID = Object.fromEntries(window.MAPS.map((m) => [m.id, m]));
  const COTES = [
    { key: 'attaque', titre: 'Attaque' },
    { key: 'defense', titre: 'Défense' },
    { key: 'retake', titre: 'Retake' }
  ];
  const COTE_TITRE = Object.fromEntries(COTES.map((c) => [c.key, c.titre]));
  const SITES = ['A', 'B', 'C', 'Mid'];

  const RANGS = ['Fer', 'Bronze', 'Argent', 'Or', 'Platine', 'Diamant', 'Ascendant', 'Immortel']
    .flatMap((r) => [1, 2, 3].map((n) => `${r} ${n}`))
    .concat('Radiant');
  const ROLES = ['Duelliste', 'Initiateur', 'Contrôleur', 'Sentinelle', 'Flex'];
  const STATUTS = ['Titulaire', 'Remplaçant', 'Coach'];
  const MAX_AGENTS = 5;

  const state = {
    me: null,
    data: { joueurs: {}, maps: {}, strats: {}, compos: {}, matchs: {} },
    view: 'equipe',
    map: window.MAPS[0].id,
    cote: 'tous', // filtre des strats sur la fiche de map
    editing: null // "<collection>:<id>", ou "strats:nouveau" / "matchs:nouveau"
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
  // Icône d'agent + nom (le nom reste lisible si l'image ne charge pas).
  function agentIcon(name) {
    const src = window.AGENT_ICONS[name];
    return src ? h('img', { class: 'agent-icon', src, alt: '', loading: 'lazy' }) : null;
  }
  function agentTag(name, extra) {
    return h('span', { class: 'agent-tag' }, agentIcon(name), name, extra && h('small', null, ` · ${extra}`));
  }
  // Bandeau d'image de map, avec le titre par-dessus.
  function mapBanner(id, cls, ...children) {
    const el = h('div', { class: cls }, ...children);
    const map = MAP_BY_ID[id];
    if (map) el.style.backgroundImage = `linear-gradient(90deg, rgba(15,20,25,.92), rgba(15,20,25,.35)), url("${map.banniere}")`;
    return el;
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

  async function removeDoc(collection, id, question, done) {
    if (!confirm(question)) return;
    try {
      await Api.remove(collection, id);
      delete state.data[collection][id];
      render();
      toast(done);
    } catch (e) {
      handleError(e);
    }
  }

  function handleError(e) {
    if (e.auth) return showLogin();
    toast("Échec de l'enregistrement, réessayez");
  }

  // ---------- Équipe ----------
  function select(options, value, placeholder) {
    return h('select', null, h('option', { value: '' }, placeholder), options.map((o) => h('option', { value: o, selected: o === value }, o)));
  }

  // Choix de 5 agents maximum, en pastilles rangées par rôle.
  function agentPicker(initial, label) {
    const chosen = new Set(initial || []);
    const count = h('span', { class: 'meta' }, `${chosen.size}/${MAX_AGENTS}`);
    const groups = Object.entries(window.AGENTS).map(([r, names]) =>
      h(
        'div',
        { class: 'agent-group' },
        h('span', { class: 'meta' }, r),
        h(
          'div',
          { class: 'chips' },
          names.map((n) => {
            const b = h('button', { type: 'button', class: 'chip', 'aria-pressed': chosen.has(n) ? 'true' : 'false' }, agentIcon(n), n);
            b.addEventListener('click', () => {
              if (chosen.has(n)) chosen.delete(n);
              else if (chosen.size < MAX_AGENTS) chosen.add(n);
              else return toast(`${MAX_AGENTS} agents maximum`);
              b.setAttribute('aria-pressed', chosen.has(n) ? 'true' : 'false');
              count.textContent = `${chosen.size}/${MAX_AGENTS}`;
            });
            return b;
          })
        )
      )
    );
    return { el: h('div', { class: 'field' }, h('span', null, `${label} `, count), groups), values: () => [...chosen] };
  }

  function playerForm(doc) {
    const riotId = h('input', { placeholder: 'Pseudo#TAG', value: doc.riotId || '', maxlength: 22, required: true, pattern: '[^#]{3,16}#[A-Za-z0-9]{2,5}' });
    const rang = select(RANGS, doc.rang, 'Rang');
    const role = select(ROLES, doc.role, 'Rôle principal');
    const statut = select(STATUTS, doc.statut, 'Statut');
    const notes = h('input', { placeholder: 'Ex : à l\'aise en lurk, peut jouer smoke', value: doc.notes || '', maxlength: 300 });
    const picker = agentPicker(doc.agents, 'Agents joués');

    return h(
      'form',
      {
        class: 'card player-form',
        onsubmit: (e) => {
          e.preventDefault();
          save('joueurs', state.me.id, {
            riotId: riotId.value.trim(),
            rang: rang.value,
            role: role.value,
            statut: statut.value,
            agents: picker.values(),
            notes: notes.value.trim()
          });
        }
      },
      h('h3', null, 'Ma fiche'),
      h(
        'div',
        { class: 'form-grid' },
        h('label', { class: 'field' }, 'Riot ID', riotId),
        h('label', { class: 'field' }, 'Rang', rang),
        h('label', { class: 'field' }, 'Rôle', role),
        h('label', { class: 'field' }, 'Statut', statut)
      ),
      h('p', { class: 'meta' }, 'Le rang se met à jour tout seul quand le Riot ID est trouvé ; sinon, celui choisi ici est gardé.'),
      picker.el,
      h('label', { class: 'field' }, 'Notes', notes),
      h(
        'div',
        { class: 'toolbar' },
        h('button', { class: 'btn btn-primary', type: 'submit' }, 'Enregistrer'),
        state.data.joueurs[state.me.id] && h('button', { class: 'btn', type: 'button', onclick: () => ((state.editing = null), render()) }, 'Annuler')
      )
    );
  }

  // "Diamant 2" -> emblème officiel et couleur du rang (CDN valorant-api).
  const TIER_ORDER = ['Fer', 'Bronze', 'Argent', 'Or', 'Platine', 'Diamant', 'Ascendant', 'Immortel', 'Radiant'];
  const TIER_COLORS = ['#868986', '#a5855d', '#bbc2c2', '#eccf56', '#59a9b6', '#b489c4', '#6ae2af', '#bb3d65', '#ffffaa'];
  function rankInfo(rang) {
    const [name, div] = (rang || '').split(' ');
    const i = TIER_ORDER.indexOf(name);
    if (i < 0) return null;
    const tier = name === 'Radiant' ? 27 : 3 + i * 3 + (Number(div) || 1) - 1;
    return { icon: `https://media.valorant-api.com/competitivetiers/03621f52-342b-cf4e-4f86-9350a49c6d04/${tier}/largeicon.png`, color: TIER_COLORS[i] };
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast(`${text} copié`);
    } catch {
      toast('Copie impossible sur ce navigateur');
    }
  }

  function playerCard(id, p) {
    const mine = id === state.me.id;
    const rank = rankInfo(p.rang);
    // Le statut est posé sur la bannière : il ne gêne plus les noms longs.
    const banner = h('div', { class: 'banner' }, p.statut && h('span', { class: `badge${p.statut === 'Titulaire' ? ' badge-main' : ''}` }, p.statut));
    if (p.carte) banner.style.backgroundImage = `url("${p.carte}")`;

    return h(
      'article',
      { class: `card player${mine ? ' mine' : ''}` },
      banner,
      h(
        'div',
        { class: 'player-head' },
        p.avatar ? h('img', { class: 'avatar', src: p.avatar, alt: '' }) : h('span', { class: 'avatar avatar-empty' }, (p.discord || '?').slice(0, 1).toUpperCase()),
        h(
          'div',
          { class: 'player-name' },
          h('strong', null, p.discord || 'Joueur'),
          p.riotId
            ? h('button', { class: 'riot-id', type: 'button', title: 'Copier le Riot ID', onclick: () => copy(p.riotId) }, p.riotId)
            : h('span', { class: 'meta' }, 'Riot ID non renseigné'),
          p.niveau ? h('span', { class: 'meta' }, `Niveau ${p.niveau}`) : null
        )
      ),
      h(
        'div',
        { class: 'player-rank' },
        rank ? h('img', { class: 'rank-icon', src: rank.icon, alt: '', loading: 'lazy' }) : h('span', { class: 'rank-icon rank-empty' }),
        h(
          'div',
          null,
          h('strong', { style: rank ? `color:${rank.color}` : null }, p.rang || 'Non classé'),
          h('span', { class: 'meta' }, [p.role, p.rangAuto ? 'rang lu en jeu' : null].filter(Boolean).join(' · ') || ' ')
        )
      ),
      p.agents?.length ? h('div', { class: 'compo-strip' }, p.agents.map((a) => agentTag(a))) : null,
      p.notes && h('p', { class: 'player-notes' }, p.notes),
      mine && h('button', { class: 'btn', onclick: () => ((state.editing = 'joueurs:moi'), render()) }, 'Modifier ma fiche')
    );
  }

  // Dispos du dernier sondage /dispos (lancé sur Discord, lu ici).
  const JOURS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
  function disposSection() {
    const poll = state.data.dispos;
    const title = h('h2', { class: 'section-title' }, 'Dispos de la semaine');
    if (!poll) return h('section', null, title, h('p', { class: 'empty-text' }, "Aucun sondage pour l'instant. L'IGL le lance avec /dispos sur Discord."));

    const start = new Date(poll.monday + 'T12:00:00Z');
    const nameOf = (id) => state.data.joueurs[id]?.discord || 'Joueur sans fiche';
    const days = JOURS.map((jour, i) => {
      const date = new Date(start);
      date.setUTCDate(start.getUTCDate() + i);
      const ids = Object.entries(poll.responses).filter(([, d]) => d.includes(i)).map(([id]) => id);
      return h(
        'div',
        { class: `dispo-day${ids.length >= 5 ? ' full' : ''}` },
        h('span', { class: 'dispo-label' }, `${jour} ${String(date.getUTCDate()).padStart(2, '0')}/${String(date.getUTCMonth() + 1).padStart(2, '0')}`),
        h('strong', null, `${ids.length}/5`),
        h('ul', null, ids.map((id) => h('li', null, nameOf(id))))
      );
    });
    const answered = Object.keys(poll.responses).length;
    return h(
      'section',
      null,
      h('div', { class: 'section-row' }, title, h('span', { class: 'meta' }, `Semaine du ${start.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })} · ${answered} réponse${answered > 1 ? 's' : ''} · à remplir sur Discord, salon dispos`)),
      h('div', { class: 'dispos' }, days)
    );
  }

  function viewEquipe() {
    const order = { Titulaire: 0, Remplaçant: 1, Coach: 2 };
    const entries = Object.entries(state.data.joueurs).sort(
      (a, b) => (order[a[1].statut] ?? 3) - (order[b[1].statut] ?? 3) || (a[1].discord || '').localeCompare(b[1].discord || '')
    );
    const mine = state.data.joueurs[state.me.id];
    const showForm = !mine || state.editing === 'joueurs:moi';

    return h(
      'div',
      { class: 'equipe' },
      showForm && h('div', null, !mine && h('p', { class: 'intro' }, 'Bienvenue. Remplissez votre fiche pour apparaître dans l\'équipe.'), playerForm(mine || {})),
      disposSection(),
      h('div', { class: 'record' }, h('div', null, h('strong', null, `${entries.length} joueur${entries.length > 1 ? 's' : ''}`))),
      entries.length
        ? h('div', { class: 'grid' }, entries.filter(([id]) => !(showForm && id === state.me.id && mine)).map(([id, p]) => playerCard(id, p)))
        : h('p', { class: 'empty-text' }, "Personne n'a encore rempli sa fiche.")
    );
  }

  // ---------- Maps ----------
  function stratsOf(mapId) {
    return Object.entries(state.data.strats)
      .filter(([, s]) => s.map === mapId)
      .sort((a, b) => COTES.findIndex((c) => c.key === a[1].cote) - COTES.findIndex((c) => c.key === b[1].cote) || a[1].nom.localeCompare(b[1].nom));
  }

  function viewMaps() {
    const list = h(
      'nav',
      { class: 'map-list', 'aria-label': 'Maps' },
      window.MAPS.map((m) => {
        const count = stratsOf(m.id).length;
        return h(
          'button',
          {
            class: 'map-item',
            'aria-current': m.id === state.map ? 'true' : 'false',
            onclick: () => {
              state.map = m.id;
              state.cote = 'tous';
              state.editing = null;
              render();
            }
          },
          m.nom,
          count > 0 && h('span', { class: 'count', title: `${count} strat${count > 1 ? 's' : ''}` }, count)
        );
      })
    );
    return h('div', { class: 'maps-layout' }, list, mapSheet(state.map));
  }

  function editButtons() {
    return h(
      'div',
      { class: 'toolbar' },
      h('button', { class: 'btn btn-primary', type: 'submit' }, 'Enregistrer'),
      h('button', { class: 'btn', type: 'button', onclick: () => ((state.editing = null), render()) }, 'Annuler')
    );
  }

  function stratForm(id, s, mapId) {
    const nom = h('input', { placeholder: 'Ex : Exec A rapide', value: s.nom || '', maxlength: 60, required: true });
    const cote = h('select', null, COTES.map((c) => h('option', { value: c.key, selected: c.key === (s.cote || (state.cote !== 'tous' ? state.cote : 'attaque')) }, c.titre)));
    const site = h('select', null, h('option', { value: '' }, 'Aucun site précis'), SITES.map((x) => h('option', { value: x, selected: x === s.site }, x === 'Mid' ? 'Mid' : `Site ${x}`)));
    const plan = h('textarea', { placeholder: 'Déroulé : qui fait quoi, utilitaires, timings, plan B si ça coince.', value: s.plan || '', style: 'min-height:160px' });
    const picker = agentPicker(s.agents, 'Agents concernés');

    return h(
      'form',
      {
        class: 'strat strat-form',
        onsubmit: (e) => {
          e.preventDefault();
          save('strats', id, { map: mapId, nom: nom.value.trim(), cote: cote.value, site: site.value, agents: picker.values(), plan: plan.value });
        }
      },
      h('h3', null, id ? 'Modifier la strat' : 'Nouvelle strat'),
      h('div', { class: 'form-grid' }, h('label', { class: 'field' }, 'Nom', nom), h('label', { class: 'field' }, 'Côté', cote), h('label', { class: 'field' }, 'Site', site)),
      picker.el,
      h('label', { class: 'field' }, 'Plan', plan),
      editButtons()
    );
  }

  function stratCard(id, s) {
    if (state.editing === `strats:${id}`) return stratForm(id, s, s.map);
    return h(
      'article',
      { class: `strat cote-${s.cote}` },
      h(
        'div',
        { class: 'strat-head' },
        h('h3', null, s.nom),
        h('span', { class: 'tag' }, COTE_TITRE[s.cote] || s.cote),
        s.site && h('span', { class: 'tag tag-light' }, s.site === 'Mid' ? 'Mid' : `Site ${s.site}`)
      ),
      s.agents?.length ? h('div', { class: 'compo-strip' }, s.agents.map((a) => agentTag(a))) : null,
      s.plan ? h('p', { class: 'strat-plan' }, s.plan) : h('p', { class: 'empty-text' }, 'Pas encore de plan détaillé.'),
      h(
        'div',
        { class: 'strat-foot' },
        metaLine(s),
        h(
          'div',
          { class: 'toolbar' },
          h('button', { class: 'btn', onclick: () => ((state.editing = `strats:${id}`), render()) }, 'Modifier'),
          h('button', { class: 'btn btn-danger', onclick: () => removeDoc('strats', id, `Supprimer la strat « ${s.nom} » ?`, 'Strat supprimée') }, 'Supprimer')
        )
      )
    );
  }

  function mapSheet(id) {
    const doc = state.data.maps[id] || {};
    const compo = state.data.compos[id];
    const all = stratsOf(id);
    const shown = state.cote === 'tous' ? all : all.filter(([, s]) => s.cote === state.cote);

    const head = mapBanner(id, 'sheet-head map-banner', h('div', null, h('h2', null, MAP_NAME[id]), h('span', { class: 'meta' }, `${all.length} strat${all.length > 1 ? 's' : ''}`)));

    const compoStrip = h(
      'div',
      { class: 'block' },
      h('h3', null, 'Compo'),
      compo && compo.slots.some((s) => s.agent)
        ? h('div', { class: 'compo-strip' }, compo.slots.filter((s) => s.agent).map((s) => agentTag(s.agent, s.joueur)))
        : h('p', { class: 'empty-text' }, "Pas encore de compo. Elle se remplit dans l'onglet Compos.")
    );

    const filters = h(
      'div',
      { class: 'filters', role: 'group', 'aria-label': 'Filtrer par côté' },
      [{ key: 'tous', titre: 'Toutes' }, ...COTES].map((c) => {
        const n = c.key === 'tous' ? all.length : all.filter(([, s]) => s.cote === c.key).length;
        return h('button', { class: 'filter', 'aria-pressed': state.cote === c.key ? 'true' : 'false', onclick: () => ((state.cote = c.key), render()) }, `${c.titre} (${n})`);
      })
    );

    const adding = state.editing === 'strats:nouveau';
    const strats = h(
      'div',
      { class: 'block' },
      h(
        'div',
        { class: 'block-head' },
        h('h3', null, 'Strats'),
        !adding && h('button', { class: 'btn btn-primary', onclick: () => ((state.editing = 'strats:nouveau'), render()) }, 'Nouvelle strat')
      ),
      filters,
      adding && stratForm(null, {}, id),
      shown.length
        ? h('div', { class: 'strats' }, shown.map(([sid, s]) => stratCard(sid, s)))
        : !adding && h('p', { class: 'empty-text' }, all.length ? 'Aucune strat de ce côté.' : 'Aucune strat sur cette map pour le moment.')
    );

    // Notes générales de la map (callouts, infos qui ne sont pas une strat).
    const editingNotes = state.editing === `maps:${id}`;
    let notesBlock;
    if (editingNotes) {
      const notes = h('textarea', { placeholder: 'Callouts, habitudes adverses, infos utiles sur la map.', value: doc.notes || '' });
      notesBlock = h(
        'form',
        { class: 'block', onsubmit: (e) => (e.preventDefault(), save('maps', id, { notes: notes.value })) },
        h('h3', null, 'Notes générales'),
        notes,
        editButtons()
      );
    } else {
      notesBlock = h(
        'div',
        { class: 'block' },
        h('div', { class: 'block-head' }, h('h3', null, 'Notes générales'), h('button', { class: 'btn', onclick: () => ((state.editing = `maps:${id}`), render()) }, 'Modifier')),
        doc.notes ? h('p', null, doc.notes) : h('p', { class: 'empty-text' }, 'Rien pour le moment.'),
        metaLine(doc)
      );
    }

    return h('section', { class: 'sheet' }, head, compoStrip, strats, notesBlock);
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
            { class: 'card map-card' },
            mapBanner(m.id, 'card-head map-banner', h('h3', null, m.nom), h('button', { class: 'btn', onclick: () => ((state.editing = `compos:${m.id}`), render()) }, 'Modifier')),
            filled
              ? h('ul', { class: 'slots' }, slots.map((s) => h('li', null, h('span', { class: 'slot-agent' }, agentIcon(s.agent), s.agent || '-'), h('span', { class: 'player' }, s.joueur || ''))))
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
            class: 'card map-card',
            onsubmit: (e) => {
              e.preventDefault();
              save('compos', m.id, { slots: rows.map((r) => ({ agent: r.agent.value, joueur: r.joueur.value.trim() })), notes: notes.value });
            }
          },
          mapBanner(m.id, 'card-head map-banner', h('h3', null, m.nom)),
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
          MAP_BY_ID[m.map] && h('img', { class: 'match-thumb', src: MAP_BY_ID[m.map].banniere, alt: '', loading: 'lazy' }),
          h('span', { class: 'score' }, `${m.scoreNous} - ${m.scoreEux}`),
          h('div', { class: 'match-info' }, h('strong', null, `${MAP_NAME[m.map] || m.map}${m.adversaire ? ' contre ' + m.adversaire : ''}`), h('span', { class: 'meta' }, new Date(m.date + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }))),
          h('button', { class: 'btn', onclick: () => ((state.editing = `matchs:${id}`), render()) }, 'Modifier'),
          h('button', { class: 'btn btn-danger', onclick: () => removeDoc('matchs', id, 'Supprimer ce match ?', 'Match supprimé') }, 'Supprimer')
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
    const view = { equipe: viewEquipe, maps: viewMaps, compos: viewCompos, matchs: viewMatchs }[state.view]();
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
      state.me = me;
      state.data = await Api.all();
      for (const k of ['joueurs', 'maps', 'strats', 'compos', 'matchs']) state.data[k] = state.data[k] || {};
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
      return;
    }

    // Les rangs se rafraîchissent en arrière-plan, sans bloquer l'affichage.
    try {
      const { joueurs } = await Api.refreshRanks();
      if (Object.keys(joueurs || {}).length === 0) return;
      Object.assign(state.data.joueurs, joueurs);
      // Pas de nouveau rendu pendant une saisie, pour ne rien effacer.
      if (!state.editing && !(state.view === 'equipe' && !state.data.joueurs[state.me.id])) render();
    } catch {}
  })();
})();
