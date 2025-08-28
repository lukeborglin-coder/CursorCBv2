// public/js/search.reports.sync.js
// Lightweight helper to ensure search/home pages get fresh server reports
// BEFORE they build a 'Add to report' dropdown.
(function(){
  async function refresh() {
    try {
      const res = await fetch('/api/reports', { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json();
      const list = Array.isArray(data) ? data : (Array.isArray(data.reports) ? data.reports : []);
      localStorage.setItem('userReports', JSON.stringify(list));
      document.dispatchEvent(new CustomEvent('reports:synced', { detail: list }));
    } catch(e) {}
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', refresh);
  } else {
    refresh();
  }
})();
