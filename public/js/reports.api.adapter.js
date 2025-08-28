// public/js/reports.api.adapter.js — full replacement
// Keeps your UI intact while syncing with server truth.
// Adds a global window.refreshReportsFromServer for pages that call it.

(function () {
  const LS_KEY = 'userReports';
  const API = {
    async list() {
      const res = await fetch('/api/reports', { credentials: 'include' });
      if (!res.ok) throw new Error('GET /api/reports ' + res.status);
      return res.json();
    },
    async create(title) {
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ title })
      });
      if (!res.ok) throw new Error('POST /api/reports ' + res.status);
      return res.json();
    },
    async remove(id) {
      const res = await fetch(`/api/reports/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      if (!res.ok) throw new Error('DELETE /api/reports/:id ' + res.status);
      return res.json();
    },
    async addItem(id, item) {
      const res = await fetch(`/api/reports/${encodeURIComponent(id)}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ items: [item] })
      });
      if (!res.ok) throw new Error('POST /api/reports/:id/items ' + res.status);
      return res.json();
    }
  };

  function normalize(payload) {
    try {
      if (Array.isArray(payload)) return payload;
      if (payload && Array.isArray(payload.reports)) return payload.reports;
      if (payload && Array.isArray(payload.data)) return payload.data;
      if (payload && payload.byId && typeof payload.byId === 'object') return Object.values(payload.byId);
      if (payload && typeof payload === 'object') {
        const out = [];
        for (const v of Object.values(payload)) { if (Array.isArray(v)) out.push(...v); }
        return out;
      }
    } catch (e) {}
    return [];
  }

  function store(list) { try { localStorage.setItem(LS_KEY, JSON.stringify(list || [])); } catch {} }

  function callRenderers(list) {
    try {
      if (typeof window.renderReports === 'function') return window.renderReports(list);
      if (typeof window.renderSavedReports === 'function') return window.renderSavedReports(list);
      if (typeof window.renderReportGrid === 'function') return window.renderReportGrid(list);
      if (typeof window.renderReport === 'function') {
        const c = document.querySelector('#reportsGrid') || document.querySelector('#savedReports') || document.body;
        c && (c.innerHTML = '');
        if (Array.isArray(list)) list.forEach(r => window.renderReport(r));
      }
      document.dispatchEvent(new CustomEvent('reports:synced', { detail: list }));
    } catch (e) {
      console.warn('Renderer call failed:', e);
    }
  }

  async function refreshAndRender() {
    const payload = await API.list();
    const list = normalize(payload).map(r => ({
      id: r.id || r._id || r.reportId,
      title: r.title || r.name || 'Untitled report',
      name: r.title || r.name || 'Untitled report',
      items: Array.isArray(r.items) ? r.items : [],
      createdAt: r.createdAt || r.ctime || Date.now(),
      updatedAt: r.updatedAt || r.modifiedAt || r.createdAt || Date.now()
    })).sort((a,b)=>{
      const da = +(new Date(a.updatedAt || a.createdAt || 0));
      const db = +(new Date(b.updatedAt || b.createdAt || 0));
      return db - da;
    });
    store(list);
    callRenderers(list);
    return list;
  }

  async function init() {
    // Expose helpers
    window.ReportsAPI = {
      list: async () => normalize(await API.list()),
      refresh: refreshAndRender,
      create: async (title) => { const r = await API.create(title); await refreshAndRender(); return r; },
      delete: async (id) => { await API.remove(id); await refreshAndRender(); },
      addItem: async (id, item) => { const r = await API.addItem(id, item); await refreshAndRender(); return r; }
    };

    // Provide backward-compatible global
    window.refreshReportsFromServer = refreshAndRender;

    try { await refreshAndRender(); }
    catch (e) {
      console.warn('Falling back to localStorage(userReports):', e && e.message);
      try { callRenderers(JSON.parse(localStorage.getItem(LS_KEY) || '[]')); } catch {}
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
