// Accès aux données. En ligne : les fonctions Vercel (/api). Ouvert en local
// (fichier) ou avec ?demo : mode démo, données gardées dans ce navigateur.
(function () {
  const DEMO = location.protocol === 'file:' || new URLSearchParams(location.search).has('demo');
  const KEY = 'premier-strats-demo';

  function demoLoad() {
    try {
      return JSON.parse(localStorage.getItem(KEY)) || { joueurs: {}, maps: {}, strats: {}, compos: {}, matchs: {} };
    } catch {
      return { joueurs: {}, maps: {}, strats: {}, compos: {}, matchs: {} };
    }
  }
  function demoSave(all) {
    try {
      localStorage.setItem(KEY, JSON.stringify(all));
    } catch {}
  }

  async function call(method, url, body) {
    const res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json', 'X-Premier': '1' } : { 'X-Premier': '1' },
      body: body ? JSON.stringify(body) : undefined
    });
    if (res.status === 401) throw Object.assign(new Error('non connecté'), { auth: true });
    if (res.status === 403 && url !== '/api/logout') {
      const body = await res.clone().json().catch(() => ({}));
      if (body.error === 'accès retiré') throw Object.assign(new Error('accès retiré'), { auth: true, retire: true });
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(json.error || 'erreur'), { collection: body?.collection || new URLSearchParams(url.split('?')[1]).get('collection') });
    return json;
  }

  window.Api = {
    demo: DEMO,

    async me() {
      if (DEMO) return { id: 'demo', name: 'Démo', avatar: null, igl: true, admin: true };
      return call('GET', '/api/me');
    },

    async all() {
      if (DEMO) return demoLoad();
      return call('GET', '/api/data');
    },

    async save(collection, id, data) {
      if (!DEMO) return call('PUT', '/api/data', { collection, id, data });
      const all = demoLoad();
      const docId = collection === 'joueurs' ? 'demo' : id || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
      const saved = { ...data, updatedBy: 'Démo', updatedAt: new Date().toISOString() };
      if (collection === 'joueurs') Object.assign(saved, { discord: 'Démo', avatar: null, rangAuto: false });
      all[collection] = all[collection] || {};
      all[collection][docId] = saved;
      demoSave(all);
      return { id: docId, data: saved };
    },

    async logout() {
      if (!DEMO) await call('POST', '/api/logout');
    },

    // Relit en jeu les rangs de plus de 6 heures. Rien à faire en démo.
    async refreshRanks() {
      if (DEMO) return { joueurs: {} };
      return call('POST', '/api/ranks');
    },

    async remove(collection, id) {
      if (!DEMO) return call('DELETE', `/api/data?collection=${encodeURIComponent(collection)}&id=${encodeURIComponent(id)}`);
      const all = demoLoad();
      delete all[collection][id];
      demoSave(all);
      return { ok: true };
    }
  };
})();
