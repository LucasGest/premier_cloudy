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
    data: { joueurs: {}, maps: {}, strats: {}, compos: {}, matchs: {}, entrainements: {} },
    view: 'accueil',
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
      // Style via le CSSOM : autorisé par la politique de sécurité, contrairement à l'attribut style.
      else if (k === 'style') el.style.cssText = v;
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
    if (map) el.style.backgroundImage = `linear-gradient(90deg, rgba(8,8,15,.92), rgba(8,8,15,.35)), url("${map.banniere}")`;
    return el;
  }

  function metaLine(doc) {
    return doc?.updatedBy ? h('span', { class: 'meta' }, `Modifié par ${doc.updatedBy} le ${formatDate(doc.updatedAt)}`) : null;
  }

  // Renvoie true si l'enregistrement a réussi (le tableau tactique s'en sert
  // pour ne se fermer qu'une fois le dessin bien enregistré).
  async function save(collection, id, data) {
    try {
      const res = await Api.save(collection, id, data);
      state.data[collection][res.id] = res.data;
      state.editing = null;
      render();
      toast('Enregistré');
      return true;
    } catch (e) {
      handleError(e);
      return false;
    }
  }

  // Mêmes droits que le serveur (qui reste seul juge) : sert à masquer les boutons inutiles.
  function can(collection) {
    if (['strats', 'compos', 'reglages', 'entrainements'].includes(collection)) return Boolean(state.me?.igl || state.me?.admin);
    if (collection === 'matchs') return Boolean(state.me?.admin);
    return true;
  }

  async function removeDoc(collection, id, question, done) {
    if (!confirm(question)) return;
    try {
      await Api.remove(collection, id);
      delete state.data[collection][id];
      state.editing = null;
      render();
      toast(done);
    } catch (e) {
      handleError(e);
    }
  }

  function handleError(e) {
    if (e.auth) return showLogin(e);
    toast(e.message === 'réservé' ? (e.collection === 'matchs' ? "Réservé à l'administrateur" : "Réservé à l'IGL") : e.message === 'séance introuvable' ? 'Cette séance a été supprimée' : "Échec de l'enregistrement, réessayez");
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
  const DEFAULT_CARD = 'https://media.valorant-api.com/playercards/9fb348bc-41a0-91ad-8a3e-818035c4e561/wideart.png';
  const TIER_ORDER =['Fer', 'Bronze', 'Argent', 'Or', 'Platine', 'Diamant', 'Ascendant', 'Immortel', 'Radiant'];
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

  // Moyennes du joueur sur les matchs Premier importés.
  function playerStats(id) {
    const lines = Object.values(state.data.matchs).flatMap((m) => (m.joueurs || []).filter((j) => j.id === id));
    if (!lines.length) return null;
    const sum = (k) => lines.reduce((t, j) => t + (j[k] || 0), 0);
    const avg = (k) => Math.round(sum(k) / lines.length);
    const kd = sum('deaths') ? (sum('kills') / sum('deaths')).toFixed(2) : sum('kills').toFixed(2);
    const counts = {};
    for (const j of lines) counts[j.agent] = (counts[j.agent] || 0) + 1;
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
    const cell = (label, value) => h('div', null, h('dt', null, label), h('dd', null, value));
    return h(
      'div',
      { class: 'player-perf' },
      h('span', { class: 'meta' }, `Premier · ${lines.length} match${lines.length > 1 ? 's' : ''}`),
      h('dl', null, cell('ACS', avg('acs')), cell('K/D', kd), cell('HS', `${avg('hs')} %`), cell('Agent', h('span', { class: 'slot-agent' }, agentIcon(top), top)))
    );
  }

  // Bandeau de la map de la semaine, en haut de chaque onglet.
  function weekBanner() {
    const current = state.data.reglages.site?.mapSemaine || '';
    const picker =
      can('reglages') &&
      h(
        'select',
        {
          class: 'week-select',
          'aria-label': 'Choisir la map de la semaine',
          onchange: (e) => save('reglages', 'site', { mapSemaine: e.target.value })
        },
        h('option', { value: '' }, current ? 'Aucune map' : 'Choisir la map de la semaine'),
        window.MAPS.map((m) => h('option', { value: m.id, selected: m.id === current }, m.nom))
      );
    if (!current) return picker ? h('div', { class: 'week week-empty' }, picker) : null;

    const rec = recordOf(current);
    const n = stratsOf(current).length;
    return mapBanner(
      current,
      'week map-banner',
      h(
        'div',
        { class: 'week-text' },
        h('span', { class: 'eyebrow' }, 'Map de la semaine'),
        h('strong', null, MAP_NAME[current]),
        h('span', { class: 'meta' }, `${n} strat${n > 1 ? 's' : ''}${rec.n ? ` · ${rec.pct} % de victoires en match` : ''}`)
      ),
      h(
        'div',
        { class: 'toolbar' },
        h(
          'button',
          {
            class: 'btn btn-primary',
            onclick: () => go('maps', { map: current, cote: 'tous' })
          },
          'Voir les strats'
        ),
        picker
      )
    );
  }

  function playerCard(id, p) {
    const mine = id === state.me.id;
    const rank = rankInfo(p.rang);
    // Le statut est posé sur la bannière : il ne gêne plus les noms longs.
    const banner = h('div', { class: 'banner' }, p.statut && h('span', { class: `badge${p.statut === 'Titulaire' ? ' badge-main' : ''}` }, p.statut));
    // Sans bannière lue en jeu (Riot ID introuvable) : la carte Valorant par défaut, assombrie.
    banner.style.backgroundImage = p.carte
      ? `url("${p.carte}")`
      : `linear-gradient(rgba(8,8,15,.45), rgba(8,8,15,.45)), url("${DEFAULT_CARD}")`;

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
          p.niveau
            ? h('span', { class: 'meta' }, `Niveau ${p.niveau}`)
            : p.riotId && h('span', { class: 'warn', title: 'Vérifier le pseudo et le tag, ou jouer une partie' }, 'Introuvable en jeu')
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
      playerStats(id),
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
    // Nouvelle strat : agents de la compo de la map cochés d'avance.
    const compoAgents = (state.data.compos[mapId]?.slots || []).map((x) => x.agent).filter(Boolean);
    const picker = agentPicker(id ? s.agents : compoAgents, 'Agents concernés');

    return h(
      'form',
      {
        class: 'strat strat-form',
        onsubmit: (e) => {
          e.preventDefault();
          // Filtre d'un autre côté actif : on bascule sur le côté de la strat
          // pour qu'elle reste visible une fois enregistrée.
          if (state.cote !== 'tous') state.cote = cote.value;
          // Le tableau tactique se modifie à part : on le renvoie tel quel pour ne pas l'effacer.
          save('strats', id, { map: mapId, nom: nom.value.trim(), cote: cote.value, site: site.value, agents: picker.values(), plan: plan.value, tableau: s.tableau });
        }
      },
      h('h3', null, id ? 'Modifier la strat' : 'Nouvelle strat'),
      h('div', { class: 'form-grid' }, h('label', { class: 'field' }, 'Nom', nom), h('label', { class: 'field' }, 'Côté', cote), h('label', { class: 'field' }, 'Site', site)),
      picker.el,
      h('label', { class: 'field' }, 'Plan', plan),
      editButtons()
    );
  }

  // Lineups de la communauté sur Tracker.gg, filtrés sur la map. Ouverts chez
  // eux, dans un nouvel onglet : leur contenu n'est ni copié ni intégré ici.
  function trackerLink(mapId) {
    if (!MAP_BY_ID[mapId]) return null;
    return h(
      'a',
      {
        class: 'btn',
        href: `https://tracker.gg/valorant/guides/clips?map=${encodeURIComponent(mapId)}`,
        target: '_blank',
        rel: 'noopener noreferrer',
        title: `Lineups ${MAP_NAME[mapId]} proposés par la communauté Tracker.gg`
      },
      'Lineups sur Tracker ↗'
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
      h(
        'div',
        { class: Tableau.hasContent(s.tableau) ? 'strat-body with-board' : 'strat-body' },
        Tableau.hasContent(s.tableau) && Tableau.view(s.tableau, s.map),
        s.plan ? h('p', { class: 'strat-plan' }, s.plan) : h('p', { class: 'empty-text' }, 'Pas encore de plan détaillé.')
      ),
      h(
        'div',
        { class: 'strat-foot' },
        metaLine(s),
        h(
          'div',
          { class: 'toolbar' },
          can('strats') &&
            h(
              'button',
              {
                class: 'btn',
                onclick: () =>
                  Tableau.edit(s.tableau, s.map, {
                    side: s.cote === 'attaque' ? 'att' : 'def',
                    // Agents de la strat, sinon ceux de la compo de la map.
                    agents: s.agents?.length ? s.agents : (state.data.compos[s.map]?.slots || []).map((x) => x.agent).filter(Boolean),
                    onSave: (tableau) => save('strats', id, { ...s, tableau })
                  })
              },
              Tableau.hasContent(s.tableau) ? 'Modifier le tableau' : 'Dessiner le tableau'
            ),
          trackerLink(s.map),
          can('strats') && h('button', { class: 'btn', onclick: () => ((state.editing = `strats:${id}`), render()) }, 'Modifier'),
          can('strats') && h('button', { class: 'btn btn-danger', onclick: () => removeDoc('strats', id, `Supprimer la strat « ${s.nom} » ?`, 'Strat supprimée') }, 'Supprimer')
        )
      )
    );
  }

  function mapSheet(id) {
    const doc = state.data.maps[id] || {};
    const compo = state.data.compos[id];
    const all = stratsOf(id);
    const shown = state.cote === 'tous' ? all : all.filter(([, s]) => s.cote === state.cote);

    const rec = recordOf(id);
    const head = mapBanner(
      id,
      'sheet-head map-banner',
      h(
        'div',
        null,
        h('h2', null, MAP_NAME[id]),
        h('span', { class: 'meta' }, `${all.length} strat${all.length > 1 ? 's' : ''}${rec.n ? ` · ${rec.v} V ${rec.d} D en match (${rec.pct} %)` : ''}`)
      )
    );

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
        h(
          'div',
          { class: 'toolbar' },
          trackerLink(id),
          !adding && can('strats') && h('button', { class: 'btn btn-primary', onclick: () => ((state.editing = 'strats:nouveau'), render()) }, 'Nouvelle strat')
        )
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

  // Compos réellement jouées sur une map, d'après les matchs importés :
  // les 5 agents de notre équipe, regroupés, avec victoires et défaites.
  const compoKey = (agents) => [...agents].sort().join('|');
  function composPlayed(mapId) {
    const groups = new Map();
    for (const m of Object.values(state.data.matchs)) {
      if (m.map !== mapId || !Array.isArray(m.joueurs)) continue;
      const agents = m.joueurs.map((j) => j.agent).filter(Boolean);
      if (agents.length !== 5) continue;
      const key = compoKey(agents);
      const g = groups.get(key) || { agents: [...agents].sort(), v: 0, d: 0, n: 0 };
      g.n++;
      if (m.scoreNous > m.scoreEux) g.v++;
      else if (m.scoreNous < m.scoreEux) g.d++;
      groups.set(key, g);
    }
    return [...groups.values()]
      .map((g) => ({ ...g, pct: Math.round((g.v / g.n) * 100) }))
      .sort((a, b) => b.n - a.n || b.pct - a.pct);
  }

  function compoBilan(mapId, slots) {
    const played = composPlayed(mapId);
    const planned = slots.filter((s) => s.agent).map((s) => s.agent);
    const plannedKey = planned.length === 5 ? compoKey(planned) : null;
    if (!played.length) return plannedKey ? h('p', { class: 'meta compo-bilan-empty' }, 'Pas encore de match importé avec cette compo.') : null;
    return h(
      'div',
      { class: 'compo-bilan' },
      h('h4', null, 'Compos jouées'),
      h(
        'ul',
        null,
        played.slice(0, 5).map((g) =>
          h(
            'li',
            { class: compoKey(g.agents) === plannedKey ? 'planned' : null },
            h('span', { class: 'compo-icons', title: g.agents.join(', ') }, g.agents.map((a) => agentIcon(a) || h('small', null, a))),
            h(
              'span',
              { class: 'compo-score' },
              h('span', { class: `compo-pct ${g.pct >= 50 ? 'good' : 'bad'}` }, `${g.pct} %`),
              h('span', { class: 'compo-record' }, `${g.v} V · ${g.d} D`)
            )
          )
        )
      ),
      plannedKey && !played.some((g) => compoKey(g.agents) === plannedKey) && h('p', { class: 'meta' }, 'La compo prévue n\'a pas encore été jouée.')
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
            mapBanner(m.id, 'card-head map-banner', h('h3', null, m.nom), can('compos') && h('button', { class: 'btn', onclick: () => ((state.editing = `compos:${m.id}`), render()) }, 'Modifier')),
            filled
              ? h('ul', { class: 'slots' }, slots.map((s) => h('li', null, h('span', { class: 'slot-agent' }, agentIcon(s.agent), s.agent || '-'), h('span', { class: 'player' }, s.joueur || ''))))
              : h('p', { class: 'empty-text' }, 'Pas de compo.'),
            doc?.notes && h('p', { class: 'meta' }, doc.notes),
            compoBilan(m.id, slots),
            metaLine(doc)
          );
        }

        // Joueurs de l'équipe (fiches remplies), titulaires d'abord. Un nom déjà
        // enregistré qui n'a plus de fiche reste proposé pour ne pas le perdre.
        const ordre = { Titulaire: 0, Remplaçant: 1, Coach: 2 };
        const equipe = Object.values(state.data.joueurs)
          .filter((p) => p.discord)
          .sort((a, b) => (ordre[a.statut] ?? 3) - (ordre[b.statut] ?? 3) || a.discord.localeCompare(b.discord))
          .map((p) => p.discord);
        const joueurSelect = (value) => {
          const noms = [...new Set([...equipe, ...(value ? [value] : [])])];
          return h('select', { 'aria-label': 'Joueur' }, h('option', { value: '' }, 'Joueur'), noms.map((n) => h('option', { value: n, selected: n === value }, n)));
        };
        const rows = slots.map((s) => ({ agent: agentSelect(s.agent), joueur: joueurSelect(s.joueur) }));
        const notes = h('textarea', { placeholder: 'Notes (rôles, variantes...)', value: doc?.notes || '', style: 'min-height:70px' });
        return h(
          'form',
          {
            class: 'card map-card',
            onsubmit: (e) => {
              e.preventDefault();
              const slotsOut = rows.map((r) => ({ agent: r.agent.value, joueur: r.joueur.value.trim() }));
              const double = (list) => list.find((v, i) => v && list.indexOf(v) !== i);
              const agentDouble = double(slotsOut.map((x) => x.agent));
              const joueurDouble = double(slotsOut.map((x) => x.joueur));
              if (agentDouble) return toast(`${agentDouble} est choisi deux fois`);
              if (joueurDouble) return toast(`${joueurDouble} est placé deux fois`);
              save('compos', m.id, { slots: slotsOut, notes: notes.value });
            }
          },
          mapBanner(m.id, 'card-head map-banner', h('h3', null, m.nom)),
          rows.map((r) => h('div', { class: 'slot-edit' }, r.agent, r.joueur)),
          notes,
          h(
            'div',
            { class: 'toolbar' },
            h('button', { class: 'btn btn-primary', type: 'submit' }, 'Enregistrer'),
            h('button', { class: 'btn', type: 'button', onclick: () => ((state.editing = null), render()) }, 'Annuler'),
            doc &&
              h(
                'button',
                {
                  class: 'btn btn-danger',
                  type: 'button',
                  onclick: () => removeDoc('compos', m.id, `Supprimer la compo de ${m.nom} ?`, 'Compo supprimée')
                },
                'Supprimer'
              )
          )
        );
      })
    );
  }

  // ---------- Matchs ----------
  function matchForm(id, doc) {
    // Match importé du jeu : score, map et date viennent de Riot (et seraient
    // réécrits au prochain import). Seul le debrief se modifie.
    if (doc.source === 'auto') {
      const debrief = h('textarea', { placeholder: 'Ce qui a marché, ce qui est à revoir.', value: doc.debrief || '' });
      return h(
        'form',
        {
          class: 'card',
          onsubmit: (e) => {
            e.preventDefault();
            save('matchs', id, { date: doc.date, map: doc.map, adversaire: doc.adversaire, scoreNous: doc.scoreNous, scoreEux: doc.scoreEux, debrief: debrief.value });
          }
        },
        h('h3', null, `Debrief · ${MAP_NAME[doc.map] || doc.map} ${doc.scoreNous}-${doc.scoreEux}${doc.adversaire ? ' contre ' + doc.adversaire : ''}`),
        h('label', { class: 'field' }, 'Debrief', debrief),
        editButtons()
      );
    }
    const f = {
      date: h('input', { type: 'date', value: doc.date || todayIso(), required: true }),
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

  // Bilan victoires/défaites, global ou pour une map.
  function recordOf(mapId) {
    const list = Object.values(state.data.matchs).filter((m) => !mapId || m.map === mapId);
    const v = list.filter((m) => m.scoreNous > m.scoreEux).length;
    const d = list.filter((m) => m.scoreNous < m.scoreEux).length;
    return { v, d, n: list.length, pct: list.length ? Math.round((v / list.length) * 100) : null };
  }

  function statsTable(joueurs) {
    return h(
      'table',
      { class: 'stats' },
      h('thead', null, h('tr', null, ['Joueur', 'K / D / A', 'HS', 'ACS'].map((t) => h('th', null, t)))),
      h(
        'tbody',
        null,
        joueurs.map((j) =>
          h(
            'tr',
            { class: j.equipe ? 'ours' : null },
            h('td', null, h('span', { class: 'slot-agent' }, agentIcon(j.agent), j.nom)),
            h('td', null, `${j.kills} / ${j.deaths} / ${j.assists}`),
            h('td', null, `${j.hs} %`),
            h('td', null, j.acs)
          )
        )
      )
    );
  }

  async function importNow() {
    toast('Import en cours…');
    try {
      const res = await Api.importMatches(true);
      Object.assign(state.data.matchs, res.matchs || {});
      render();
      toast(res.total ? `${res.total} match${res.total > 1 ? 's' : ''} trouvé${res.total > 1 ? 's' : ''}, dont ${res.added} nouveau${res.added > 1 ? 'x' : ''}` : 'Aucun match Premier trouvé pour l\'équipe');
    } catch (e) {
      handleError(e);
    }
  }

  function viewMatchs() {
    const entries = Object.entries(state.data.matchs).sort((a, b) => (b[1].date || '').localeCompare(a[1].date || ''));
    const total = recordOf();

    const header = h(
      'div',
      { class: 'record' },
      h(
        'div',
        null,
        h('strong', null, `${total.v} V · ${total.d} D`),
        h('div', { class: 'meta' }, `${total.n} match${total.n > 1 ? 's' : ''} joué${total.n > 1 ? 's' : ''}${total.pct != null ? ` · ${total.pct} % de victoires` : ''}`)
      ),
      h(
        'div',
        { class: 'toolbar' },
        can('matchs') && h('button', { class: 'btn', onclick: importNow }, 'Importer maintenant'),
        state.editing !== 'matchs:nouveau' && can('matchs') && h('button', { class: 'btn btn-primary', onclick: () => ((state.editing = 'matchs:nouveau'), render()) }, 'Ajouter un match')
      )
    );
    const note = h('p', { class: 'meta import-note' }, "Les matchs Premier de l'équipe s'importent tout seuls depuis le jeu (score, map, stats), dès que 3 joueurs du site y ont joué ensemble. Le debrief reste à écrire.");

    // Taux de victoire par map, pour les maps déjà jouées.
    const played = window.MAPS.map((m) => ({ m, r: recordOf(m.id) })).filter((x) => x.r.n > 0);
    const winrates =
      played.length > 0 &&
      h(
        'section',
        { class: 'winrates' },
        h('h2', { class: 'section-title' }, 'Par map'),
        h(
          'div',
          { class: 'winrate-grid' },
          played.map(({ m, r }) =>
            mapBanner(
              m.id,
              'winrate map-banner',
              h('strong', null, m.nom),
              h('span', { class: `winrate-pct ${r.pct >= 50 ? 'good' : 'bad'}` }, `${r.pct} %`),
              h('span', { class: 'meta' }, `${r.v} V · ${r.d} D`)
            )
          )
        )
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
          h(
            'div',
            { class: 'match-info' },
            h('strong', null, `${MAP_NAME[m.map] || m.map}${m.adversaire ? ' contre ' + m.adversaire : ''}`),
            h('span', { class: 'meta' }, new Date(m.date + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }), m.source === 'auto' ? ' · importé du jeu' : '')
          ),
          can('matchs') && h('button', { class: 'btn', onclick: () => ((state.editing = `matchs:${id}`), render()) }, m.source === 'auto' ? 'Debrief' : 'Modifier'),
          can('matchs') && h('button', { class: 'btn btn-danger', onclick: () => removeDoc('matchs', id, 'Supprimer ce match ?', 'Match supprimé') }, 'Supprimer')
        ),
        m.joueurs?.length ? h('details', null, h('summary', null, 'Stats du match'), statsTable(m.joueurs)) : null,
        m.debrief ? h('details', null, h('summary', null, 'Debrief'), h('p', null, m.debrief)) : null,
        m.source !== 'auto' || m.debrief ? metaLine(m) : null
      );
    });

    return h(
      'div',
      null,
      header,
      note,
      winrates,
      h(
        'div',
        { class: 'matches' },
        state.editing === 'matchs:nouveau' && matchForm(null, {}),
        list.length ? list : state.editing !== 'matchs:nouveau' && h('p', { class: 'empty-text' }, 'Aucun match enregistré.')
      )
    );
  }

  // ---------- Entraînements ----------
  const TYPES_SEANCE = ['Strats', 'Scrim', 'Aim', 'Review VOD', 'Custom', 'Autre'];
  const todayIso = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const dureeText = (min) => (min >= 60 ? `${Math.floor(min / 60)} h${min % 60 ? String(min % 60).padStart(2, '0') : ''}` : `${min} min`);

  function seanceForm(id, s) {
    const f = {
      date: h('input', { type: 'date', value: s.date || todayIso(), required: true }),
      heure: h('input', { type: 'time', value: s.heure || '21:00', required: true }),
      duree: h(
        'select',
        null,
        [30, 60, 90, 120, 150, 180, 240].map((m) => h('option', { value: m, selected: m === (s.duree || 120) }, dureeText(m)))
      ),
      type: h('select', null, TYPES_SEANCE.map((t) => h('option', { value: t, selected: t === s.type }, t))),
      notes: h('textarea', { placeholder: 'Programme, map travaillée, adversaire du scrim...', value: s.notes || '', maxlength: 1000, style: 'min-height:70px' })
    };
    return h(
      'form',
      {
        class: 'card',
        onsubmit: (e) => {
          e.preventDefault();
          save('entrainements', id, { date: f.date.value, heure: f.heure.value, duree: Number(f.duree.value), type: f.type.value, notes: f.notes.value });
        }
      },
      h('h3', null, id ? 'Modifier la séance' : 'Nouvelle séance'),
      h(
        'div',
        { class: 'form-grid' },
        h('label', { class: 'field' }, 'Date', f.date),
        h('label', { class: 'field' }, 'Heure', f.heure),
        h('label', { class: 'field' }, 'Durée', f.duree),
        h('label', { class: 'field' }, 'Type', f.type)
      ),
      h('label', { class: 'field' }, 'Notes', f.notes),
      !id && h('p', { class: 'meta' }, 'La séance sera annoncée par le bot dans le salon des entraînements.'),
      h('div', { class: 'toolbar' }, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Enregistrer'), h('button', { class: 'btn', type: 'button', onclick: () => ((state.editing = null), render()) }, 'Annuler'))
    );
  }

  async function setPresence(id, statut) {
    try {
      const res = await Api.presence(id, statut);
      state.data.entrainements[id] = res.data;
      render();
    } catch (e) {
      handleError(e);
    }
  }

  function seanceCard(id, s, past) {
    if (state.editing === `entrainements:${id}`) return seanceForm(id, s);
    const presences = Object.values(s.presences || {});
    const oui = presences.filter((p) => p.statut === 'oui');
    const non = presences.filter((p) => p.statut === 'non');
    const mine = s.presences?.[state.me.id]?.statut || '';
    const day = new Date(s.date + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    const choice = (statut, label) =>
      h('button', { class: `btn${mine === statut ? ` chosen-${statut}` : ''}`, type: 'button', 'aria-pressed': mine === statut ? 'true' : 'false', onclick: () => setPresence(id, mine === statut ? '' : statut) }, label);

    return h(
      'article',
      { class: `seance${past ? ' past' : ''}` },
      h(
        'div',
        { class: 'seance-row' },
        h('div', { class: 'seance-when' }, h('strong', null, s.heure.replace(':', 'h')), h('span', null, dureeText(s.duree || 120))),
        h('div', { class: 'seance-info' }, h('strong', null, day), h('span', { class: 'seance-type' }, s.type)),
        !past && h('div', { class: 'seance-choice' }, choice('oui', 'Présent'), choice('non', 'Absent')),
        can('entrainements') && h('button', { class: 'btn', onclick: () => ((state.editing = `entrainements:${id}`), render()) }, 'Modifier'),
        can('entrainements') && h('button', { class: 'btn btn-danger', onclick: () => removeDoc('entrainements', id, 'Supprimer cette séance ?', 'Séance supprimée') }, 'Supprimer')
      ),
      s.notes && h('p', { class: 'seance-notes' }, s.notes),
      h(
        'div',
        { class: 'seance-presences' },
        h('span', { class: 'pres-oui' }, `${oui.length} présent${oui.length > 1 ? 's' : ''}`, oui.length ? ` : ${oui.map((p) => p.nom).join(', ')}` : ''),
        non.length ? h('span', { class: 'pres-non' }, `${non.length} absent${non.length > 1 ? 's' : ''} : ${non.map((p) => p.nom).join(', ')}`) : null
      )
    );
  }

  function viewEntrainements() {
    const today = todayIso();
    const all = Object.entries(state.data.entrainements).sort((a, b) => `${a[1].date} ${a[1].heure}`.localeCompare(`${b[1].date} ${b[1].heure}`));
    const upcoming = all.filter(([, s]) => s.date >= today);
    const past = all.filter(([, s]) => s.date < today).reverse().slice(0, 10);

    return h(
      'div',
      null,
      h(
        'div',
        { class: 'record' },
        h('div', null, h('strong', null, 'Entraînements'), h('div', { class: 'meta' }, `${upcoming.length} séance${upcoming.length > 1 ? 's' : ''} à venir`)),
        can('entrainements') && state.editing !== 'entrainements:nouveau' && h('div', { class: 'toolbar' }, h('button', { class: 'btn btn-primary', onclick: () => ((state.editing = 'entrainements:nouveau'), render()) }, 'Planifier une séance'))
      ),
      h(
        'div',
        { class: 'matches' },
        state.editing === 'entrainements:nouveau' && seanceForm(null, {}),
        upcoming.length ? upcoming.map(([id, s]) => seanceCard(id, s, false)) : state.editing !== 'entrainements:nouveau' && h('p', { class: 'empty-text' }, 'Aucune séance prévue.')
      ),
      past.length > 0 && h('details', { class: 'past-seances' }, h('summary', null, 'Séances passées'), h('div', { class: 'matches' }, past.map(([id, s]) => seanceCard(id, s, true))))
    );
  }

  // ---------- Accueil ----------
  // Carte cliquable du résumé de la semaine : mène à l'onglet concerné.
  function homeCard(titre, valeur, detail, view, extra) {
    return h(
      'button',
      { class: 'home-card', type: 'button', onclick: () => go(view, extra) },
      h('span', { class: 'eyebrow' }, titre),
      h('strong', null, valeur),
      detail && h('span', { class: 'meta' }, detail)
    );
  }

  function viewAccueil() {
    const mine = state.data.joueurs[state.me.id];
    const prenom = state.me.name;

    // Map de la semaine
    const semaine = state.data.reglages.site?.mapSemaine;
    const nStrats = semaine ? stratsOf(semaine).length : 0;
    const mapCard = semaine
      ? homeCard('Map de la semaine', MAP_NAME[semaine], `${nStrats} strat${nStrats > 1 ? 's' : ''} prête${nStrats > 1 ? 's' : ''}`, 'maps', { map: semaine, cote: 'tous' })
      : homeCard('Map de la semaine', 'Pas encore choisie', "L'IGL la choisit en haut de chaque onglet", 'maps');
    if (semaine && MAP_BY_ID[semaine]) mapCard.style.backgroundImage = `linear-gradient(90deg, rgba(8,8,15,.92), rgba(8,8,15,.55)), url("${MAP_BY_ID[semaine].banniere}")`;
    if (semaine) mapCard.classList.add('with-image');

    // Prochain entraînement
    const today = todayIso();
    const next = Object.values(state.data.entrainements)
      .filter((s) => s.date >= today)
      .sort((a, b) => `${a.date} ${a.heure}`.localeCompare(`${b.date} ${b.heure}`))[0];
    const maReponse = next?.presences?.[state.me.id]?.statut;
    const seanceCard = next
      ? homeCard(
          'Prochain entraînement',
          `${new Date(next.date + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })} · ${next.heure.replace(':', 'h')}`,
          `${next.type} · ${maReponse === 'oui' ? 'tu es noté présent' : maReponse === 'non' ? 'tu es noté absent' : 'indique ta présence'}`,
          'entrainements'
        )
      : homeCard('Prochain entraînement', 'Aucun de prévu', "L'IGL les planifie dans l'onglet Entraînements", 'entrainements');
    if (next && !maReponse) seanceCard.classList.add('todo');

    // Dispos
    const poll = state.data.dispos;
    let disposCard;
    if (poll) {
      const counts = JOURS.map((_, i) => Object.values(poll.responses).filter((d) => d.includes(i)).length);
      const best = Math.max(...counts);
      const jours = JOURS.filter((_, i) => counts[i] === best && best > 0);
      const repondu = state.me.id in poll.responses;
      disposCard = homeCard(
        'Dispos de la semaine',
        best ? `${jours.join(', ')} · ${best}/5` : 'Aucune réponse',
        repondu ? 'tu as répondu au sondage' : 'réponds au sondage /dispos sur Discord',
        'equipe'
      );
      if (!repondu) disposCard.classList.add('todo');
    } else disposCard = homeCard('Dispos de la semaine', 'Pas de sondage', "L'IGL le lance avec /dispos sur Discord", 'equipe');

    // Dernier match
    const last = Object.values(state.data.matchs).sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
    const total = recordOf();
    const matchCard = last
      ? homeCard(
          'Dernier match',
          `${last.scoreNous > last.scoreEux ? 'Victoire' : last.scoreNous < last.scoreEux ? 'Défaite' : 'Égalité'} ${last.scoreNous}-${last.scoreEux}`,
          `${MAP_NAME[last.map] || last.map}${last.adversaire ? ' contre ' + last.adversaire : ''} · bilan ${total.v} V ${total.d} D`,
          'matchs'
        )
      : homeCard('Dernier match', 'Pas encore joué', "Les matchs Premier s'importent tout seuls", 'matchs');

    const guide = [
      ['equipe', 'Équipe', 'Les fiches des joueurs, leur rang et leurs stats.', 'Remplis la tienne une fois.'],
      ['maps', 'Maps', 'Les strats de chaque map, avec tableau tactique.', 'Lance la lecture avant un match.'],
      ['compos', 'Compos', 'Qui joue quoi sur chaque map.', 'Avec le bilan des compos jouées.'],
      ['entrainements', 'Entraînements', 'Les séances de la semaine.', 'Indique Présent ou Absent.'],
      ['matchs', 'Matchs', 'Résultats importés du jeu, stats et debriefs.', 'Taux de victoire par map.']
    ];

    return h(
      'div',
      { class: 'home' },
      h(
        'section',
        { class: 'home-hero' },
        h('span', { class: 'eyebrow' }, 'Équipe Premier CloudyCat'),
        h('h1', null, `Salut ${prenom}`),
        h('p', null, "Tout ce qu'il faut pour préparer les matchs Premier : la map de la semaine, les strats, les compos, les entraînements et les résultats."),
        !mine &&
          h(
            'div',
            { class: 'home-cta' },
            h('p', null, 'Première visite : remplis ta fiche joueur pour apparaître dans l\'équipe et dans les compos.'),
            h('button', { class: 'btn btn-primary', type: 'button', onclick: () => go('equipe') }, 'Remplir ma fiche')
          )
      ),
      h('h2', { class: 'section-title' }, 'Cette semaine'),
      h('div', { class: 'home-grid' }, mapCard, seanceCard, disposCard, matchCard),
      h('h2', { class: 'section-title' }, 'Le site, onglet par onglet'),
      h(
        'div',
        { class: 'guide-grid' },
        guide.map(([view, titre, texte, astuce]) =>
          h(
            'article',
            { class: 'guide-card' },
            h('h3', null, titre),
            h('p', null, texte),
            h('p', { class: 'meta' }, astuce),
            h('button', { class: 'btn', type: 'button', 'aria-label': `Ouvrir ${titre}`, onclick: () => go(view) }, 'Ouvrir')
          )
        )
      ),
      h(
        'div',
        { class: 'home-columns' },
        h(
          'section',
          { class: 'card' },
          h('h3', null, 'Sur Discord'),
          h(
            'ul',
            { class: 'home-list' },
            h('li', null, h('strong', null, 'dispos'), " : chaque semaine, l'IGL lance le sondage /dispos. Réponds en choisissant tes jours."),
            h('li', null, h('strong', null, 'strats'), ' : le bot annonce chaque nouvelle strat ou modification.'),
            h('li', null, h('strong', null, 'entraînements'), ' : le bot annonce chaque séance planifiée.'),
            h('li', null, h('strong', null, 'résultats'), ' : le bot poste le score et le meilleur joueur après chaque match importé.')
          )
        ),
        h(
          'section',
          { class: 'card' },
          h('h3', null, 'Qui fait quoi'),
          h(
            'ul',
            { class: 'home-list' },
            h('li', null, h('strong', null, 'Tous les joueurs'), ' : leur fiche, les notes des maps, leur présence aux entraînements.'),
            h('li', null, h('strong', null, 'IGL'), ' : la map de la semaine, les strats et leurs tableaux, les compos, les entraînements.'),
            h('li', null, h('strong', null, 'Admin'), ' : les matchs (import, ajout à la main, debriefs).')
          )
        )
      )
    );
  }

  // ---------- Rendu ----------
  const VIEWS = { accueil: viewAccueil, equipe: viewEquipe, maps: viewMaps, compos: viewCompos, entrainements: viewEntrainements, matchs: viewMatchs };

  // Change d'onglet ; l'onglet est gardé dans l'adresse (#maps...) pour
  // revenir au même endroit après un rechargement.
  function go(view, extra) {
    Object.assign(state, { view, editing: null }, extra);
    history.replaceState(null, '', `${location.pathname}${location.search}#${view}`);
    render();
    window.scrollTo(0, 0);
  }

  function render() {
    document.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', t.dataset.view === state.view ? 'true' : 'false'));
    const view = VIEWS[state.view]();
    // L'accueil a son propre résumé de la map de la semaine.
    $('view').replaceChildren(...[state.view !== 'accueil' && weekBanner(), view].filter(Boolean));
  }

  // Fondu de sortie de l'écran de chargement, puis retrait du DOM.
  function hideLoader() {
    const loader = $('loader');
    if (!loader || loader.classList.contains('done')) return;
    loader.classList.add('done');
    setTimeout(() => loader.remove(), 400);
  }

  function showLogin(e) {
    hideLoader();
    $('app').hidden = true;
    $('login').hidden = false;
    const err = e?.retire ? 'acces' : new URLSearchParams(location.search).get('erreur');
    const messages = {
      acces: "Accès refusé : il faut le rôle Premier sur le serveur CloudyCat.",
      connexion: 'La connexion avec Discord a échoué, réessayez.'
    };
    if (messages[err]) {
      const compte = new URLSearchParams(location.search).get('compte');
      $('login-error').textContent =
        err === 'acces' && compte
          ? `Accès refusé pour le compte Discord ${compte.slice(0, 60)} : il n'a pas le rôle Premier sur le serveur CloudyCat. Si ce n'est pas ton compte, déconnecte-toi de discord.com dans ce navigateur puis réessaie.`
          : messages[err];
      $('login-error').hidden = false;
    }
  }

  $('logout').addEventListener('click', async () => {
    try {
      await Api.logout();
    } catch {}
    location.replace('/');
  });

  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => go(t.dataset.view)));

  (async function start() {
    try {
      // L'écran reste au moins un instant : pas de flash quand tout va vite.
      const minDelay = new Promise((r) => setTimeout(r, 700));
      const me = await Api.me();
      state.me = me;
      $('loader-text').textContent = `Chargement de l'équipe`;
      state.data = await Api.all();
      await minDelay;
      for (const k of ['joueurs', 'reglages', 'maps', 'strats', 'compos', 'matchs', 'entrainements']) state.data[k] = state.data[k] || {};
      // L'onglet Maps s'ouvre sur la map de la semaine.
      if (state.data.reglages.site?.mapSemaine) state.map = state.data.reglages.site.mapSemaine;
      $('user-name').textContent = me.name;
      const roleTag = me.admin ? 'Admin' : me.igl ? 'IGL' : null;
      if (roleTag && !Api.demo) $('user-name').after(h('span', { class: 'tag' }, roleTag));
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
      // Onglet demandé dans l'adresse (#maps...) ; sinon l'accueil.
      const asked = location.hash.slice(1);
      if (VIEWS[asked]) state.view = asked;
      history.replaceState(null, '', location.pathname + (Api.demo && location.protocol !== 'file:' ? '?demo' : '') + `#${state.view}`);
      render();
      hideLoader();
    } catch (e) {
      showLogin(e);
      return;
    }

    // En arrière-plan, sans bloquer l'affichage : rangs d'abord (ils donnent
    // l'identifiant Riot de chacun), puis import des matchs Premier.
    // Pas de nouveau rendu pendant une saisie, pour ne rien effacer.
    const quietRender = () => {
      if (!state.editing && !(state.view === 'equipe' && !state.data.joueurs[state.me.id])) render();
    };
    try {
      const { joueurs } = await Api.refreshRanks();
      if (Object.keys(joueurs || {}).length) {
        Object.assign(state.data.joueurs, joueurs);
        quietRender();
      }
    } catch {}
    try {
      const { matchs } = await Api.importMatches(false);
      if (Object.keys(matchs || {}).length) {
        Object.assign(state.data.matchs, matchs);
        quietRender();
      }
    } catch {}
  })();
})();
