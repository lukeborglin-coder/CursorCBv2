// public/js/reports.js
// Renders the saved reports grid by pulling from the server API.
// Falls back to localStorage('userReports') if the API is unavailable.
// Also tolerates a missing /auth/switch-client route (ignores 404).

(function () {
  const grid = document.getElementById('reportsGrid');
  const emptyState = document.getElementById('emptyState');
  const clientSelect = document.getElementById('clientSelect');

  function fmtDate(d) {
    try {
      const dt = (d instanceof Date) ? d : new Date(d);
      if (!dt || isNaN(+dt)) return '';
      return dt.toLocaleString();
    } catch { return ''; }
  }

  function timeAgo(d) {
    try {
      const t = (d instanceof Date) ? +d : +new Date(d);
      if (!t || isNaN(t)) return '';
      const s = Math.floor((Date.now() - t) / 1000);
      if (s < 60) return `${s}s ago`;
      const m = Math.floor(s/60); if (m < 60) return `${m}m ago`;
      const h = Math.floor(m/60); if (h < 24) return `${h}h ago`;
      const dd = Math.floor(h/24); if (dd < 30) return `${dd}d ago`;
      const mo = Math.floor(dd/30); if (mo < 12) return `${mo}mo ago`;
      const y = Math.floor(mo/12); return `${y}y ago`;
    } catch { return ''; }
  }

  function normalizeReports(payload) {
    // Try common shapes
    if (Array.isArray(payload)) return payload;
    if (payload && Array.isArray(payload.reports)) return payload.reports;
    // Flatten arrays inside objects (e.g., keyed by userId)
    let out = [];
    if (payload && typeof payload === 'object') {
      if (payload.byId && typeof payload.byId === 'object') {
        out = Object.values(payload.byId);
      } else {
        for (const v of Object.values(payload)) {
          if (Array.isArray(v)) out = out.concat(v);
        }
      }
    }
    return out;
  }

  async function fetchJSON(url, opts) {
    const res = await fetch(url, Object.assign({ credentials: 'include' }, opts || {}));
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json();
  }

  async function loadClientOptions() {
    // Best-effort: if you already have a list of clients in localStorage or a known endpoint, populate it here.
    // We'll keep the placeholder and not block rendering.
    try {
      // Example optional endpoint: /api/clients
      // const data = await fetchJSON('/api/clients');
      // (Array.isArray(data) ? data : []).forEach(c => {
      //   const opt = document.createElement('option');
      //   opt.value = c.id || c.clientId || c.name || '';
      //   opt.textContent = c.name || c.label || String(opt.value);
      //   clientSelect.appendChild(opt);
      // });
    } catch {}
  }

  function clearGrid() {
    while (grid.firstChild) grid.removeChild(grid.firstChild);
  }

  function renderReports(list) {
    clearGrid();
    if (!list || list.length === 0) {
      emptyState.style.display = 'flex';
      return;
    }
    emptyState.style.display = 'none';

    list.forEach(r => {
      const card = document.createElement('div');
      card.className = 'report-card';

      const head = document.createElement('div');
      head.className = 'report-header';

      const title = document.createElement('h3');
      title.className = 'report-title';
      title.textContent = r.title || r.name || r.reportName || 'Untitled report';

      const btn = document.createElement('button');
      btn.className = 'btn';
      btn.textContent = 'Open';
      btn.addEventListener('click', () => {
        try {
          // Store active ID for any existing detail view logic you have
          if (r.id || r.reportId || r._id) {
            const id = r.id || r.reportId || r._id;
            localStorage.setItem('activeReportId', String(id));
          }
          // Navigate to the same page; if you have a dedicated view, change this href.
          window.location.href = '/reports.html';
        } catch {}
      });

      head.appendChild(title);
      head.appendChild(btn);

      const meta = document.createElement('div');
      meta.className = 'muted';
      const updated = r.updatedAt || r.modifiedAt || r.lastUpdated || r.updated_on || r.updated || r.mtime;
      const created = r.createdAt || r.created_on || r.ctime || r.created;
      const when = updated || created;
      const count = (r.items && Array.isArray(r.items)) ? r.items.length
                  : (typeof r.itemCount === 'number' ? r.itemCount : (r.count || 0));
      meta.textContent = `${count} item${count === 1 ? '' : 's'} • ${when ? timeAgo(when) : ''}`.trim();

      card.appendChild(head);
      card.appendChild(meta);

      grid.appendChild(card);
    });
  }

  async function loadFromAPI() {
    const data = await fetchJSON('/api/reports');
    let list = normalizeReports(data);
    
    // Filter reports by client library access
    if (window.currentUser && window.currentUser.role === 'client') {
      const clientLibrary = window.currentUser.library || window.currentUser.libraryId || window.currentUser.clientLibrary;
      if (clientLibrary) {
        list = list.filter(report => {
          return report.library === clientLibrary || 
                 report.libraryId === clientLibrary ||
                 report.clientLibrary === clientLibrary ||
                 (report.metadata && report.metadata.library === clientLibrary);
        });
      } else {
        // No library assigned, show no reports
        list = [];
      }
    }

    // Sort most recent first
    list.sort((a, b) => {
      const da = +(new Date(a.updatedAt || a.modifiedAt || a.createdAt || 0));
      const db = +(new Date(b.updatedAt || b.modifiedAt || b.createdAt || 0));
      return db - da;
    });

    renderReports(list);
  }

  function loadFromLocalStorage() {
    try {
      const raw = localStorage.getItem('userReports') || '[]';
      const list = JSON.parse(raw);
      renderReports(Array.isArray(list) ? list : []);
    } catch {
      renderReports([]);
    }
  }

  async function init() {
    await loadClientOptions();

    // Optional: handle client changes; ignore 404s from missing /auth/switch-client
    clientSelect?.addEventListener('change', async () => {
      const val = clientSelect.value || '';
      try {
        await fetch('/auth/switch-client', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientId: val }),
          credentials: 'include'
        });
      } catch {}
      // After switching, reload the reports (server might filter by client)
      try { await loadFromAPI(); } catch { loadFromLocalStorage(); }
    });

    try {
      await loadFromAPI();
    } catch (e) {
      // Fallback if API route is missing
      console.warn('Falling back to localStorage for reports:', e && e.message);
      loadFromLocalStorage();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
