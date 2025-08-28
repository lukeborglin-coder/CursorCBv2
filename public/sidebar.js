
// sidebar.js — Fixed below header, no quick actions, shows Recent Reports
// Drop-in replacement.
class EnhancedSidebar {
  constructor() {
    this.isLocked = false;
    this.isVisible = false;
    this.HEADER_HEIGHT = this.getHeaderHeight();
    this.init();
  }
  getHeaderHeight() {
    try {
      const h = document.querySelector('.header');
      const px = (h && h.offsetHeight) ? h.offsetHeight : 70;
      return Math.max(50, px);
    } catch {
      return 70;
    }
  }
  init() {
    this.createSidebar();
    this.createHamburgerButton();
    this.attachEventListeners();
    this.loadSidebarState();
    this.loadRecentReports();
  }
  createHamburgerButton() {
    if (document.getElementById('hamburgerBtn')) return;
    const hamburger = document.createElement('button');
    hamburger.id = 'hamburgerBtn';
    hamburger.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M3,6H21V8H3V6M3,11H21V13H3V11M3,16H21V18H3V16Z"/></svg>`;
    hamburger.style.cssText = `position: fixed; top: ${this.HEADER_HEIGHT + 10}px; left: 15px; z-index: 901; background: #D14829; border: none; border-radius: 6px; padding: 8px; cursor: pointer; color: white; transition: all 0.2s ease; box-shadow: 0 2px 8px rgba(0,0,0,0.1);`;
    hamburger.title = 'Open sidebar';
    document.body.appendChild(hamburger);
    hamburger.addEventListener('mouseenter', () => { hamburger.style.transform = 'translateY(-1px) scale(1.02)'; hamburger.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)'; });
    hamburger.addEventListener('mouseleave', () => { hamburger.style.transform = 'none'; hamburger.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)'; });
    hamburger.addEventListener('click', () => this.toggleLock());
  }
  createSidebar() {
    const existing = document.getElementById('enhancedSidebar');
    if (existing) existing.remove();
    const sidebar = document.createElement('div');
    sidebar.id = 'enhancedSidebar';
    sidebar.style.cssText = `position: fixed; top: ${this.HEADER_HEIGHT}px; left: -280px; width: 280px; height: calc(100vh - ${this.HEADER_HEIGHT}px); background: linear-gradient(135deg, #2c3e50, #34495e); z-index: 900; transition: left 0.3s ease; box-shadow: 2px 0 10px rgba(0,0,0,0.1); overflow-y: auto; font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; display:flex; flex-direction:column;`;
    sidebar.innerHTML = `
      <div style="padding: 16px 16px 12px 16px;">
        <h3 style="color:#ecf0f1;margin:0 0 10px 0;font-size:16px;font-weight:600;">Recent Reports</h3>
        <div style="height:2px;background:linear-gradient(90deg,#D14829,#e67e22);border-radius:2px;"></div>
      </div>
      <div id="sidebarRecentItems" style="padding:0 16px 8px 16px;">
        <div style="color:#bdc3c7;font-size:14px;text-align:center;padding:16px;font-style:italic;">No recent reports</div>
      </div>
      <div style="margin-top:auto;padding:14px 16px;border-top:1px solid #34495e;">
        <div style="color:#7f8c8d;font-size:12px;text-align:center;">JAICE v2.0 • Reports System</div>
      </div>`;
    document.body.appendChild(sidebar);
  }
  attachEventListeners() {
    const sidebar = document.getElementById('enhancedSidebar');
    const revealZone = document.createElement('div');
    revealZone.id = 'sidebarRevealZone';
    revealZone.style.cssText = `position: fixed; top: ${this.HEADER_HEIGHT}px; left: 0; width: 8px; height: calc(100vh - ${this.HEADER_HEIGHT}px); z-index: 902;`;
    document.body.appendChild(revealZone);
    revealZone.addEventListener('mouseenter', () => { if (!this.isLocked) this.show(); });
    sidebar.addEventListener('mouseleave', () => { if (!this.isLocked) this.hide(); });
    window.addEventListener('resize', () => {
      this.HEADER_HEIGHT = this.getHeaderHeight();
      sidebar.style.top = `${this.HEADER_HEIGHT}px`;
      sidebar.style.height = `calc(100vh - ${this.HEADER_HEIGHT}px)`;
      revealZone.style.top = `${this.HEADER_HEIGHT}px`;
      revealZone.style.height = `calc(100vh - ${this.HEADER_HEIGHT}px)`;
      const hb = document.getElementById('hamburgerBtn'); if (hb) hb.style.top = `${this.HEADER_HEIGHT + 10}px`;
    });
  }
  async loadRecentReports() {
    const el = document.getElementById('sidebarRecentItems');
    if (!el) return;
    try {
      const res = await fetch('/api/reports', { headers: {'Accept':'application/json'}, credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const js = await res.json();
      const list = Array.isArray(js?.data) ? js.data : [];
      if (!list.length) { el.innerHTML = `<div style="color:#bdc3c7;font-size:14px;text-align:center;padding:16px;font-style:italic;">No recent reports</div>`; return; }
      list.sort((a,b)=> (b.updatedAt||b.createdAt||0) - (a.updatedAt||a.createdAt||0));
      el.innerHTML = list.slice(0,10).map(item => {
        const title = (item.title || item.name || 'Untitled Report');
        const ts = (item.updatedAt || item.createdAt || Date.now());
        return `<div style="background:rgba(255,255,255,0.04);border:1px solid #3a4a5a;border-radius:8px;padding:10px 12px;margin-bottom:10px;">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
            <div style="color:#ecf0f1;font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${this.escape(title)}</div>
            <a href="/reports.html" style="color:#ffd08a;font-size:12px;text-decoration:underline;">Open</a>
          </div>
          <div style="color:#95a5a6;font-size:11px;margin-top:4px;">${this.formatTime(ts)}</div>
        </div>`;
      }).join('');
    } catch (e) {
      el.innerHTML = `<div style="color:#bdc3c7;font-size:13px;text-align:center;padding:16px;">Failed to load reports.</div>`;
      console.error('sidebar recent reports error:', e);
    }
  }
  escape(s){ return String(s ?? "").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
  show(){ const sidebar = document.getElementById('enhancedSidebar'); sidebar.style.left = '0px'; this.isVisible = true; }
  hide(){ if (this.isLocked) return; const sidebar = document.getElementById('enhancedSidebar'); if (sidebar) { sidebar.style.left = '-280px'; this.isVisible = false; } }
  toggleLock(){
    this.isLocked = !this.isLocked;
    const hamburger = document.getElementById('hamburgerBtn');
    if (this.isLocked){ this.show(); hamburger && (hamburger.style.background='#27ae60', hamburger.title='Click to unlock sidebar (hover mode)'); }
    else { hamburger && (hamburger.style.background='#D14829', hamburger.title='Click to lock sidebar open'); this.hide(); }
    localStorage.setItem('sidebarLocked', this.isLocked ? 'true' : 'false');
  }
  loadSidebarState(){ const saved = localStorage.getItem('sidebarLocked'); if (saved === 'true') this.toggleLock(); }
  formatTime(ts){
    try{ const date = new Date(ts); const now = new Date(); const diff = Math.floor((now - date) / 1000);
      if (diff < 60) return 'Just now'; if (diff < 3600) return `${Math.floor(diff/60)}m ago`; if (diff < 86400) return `${Math.floor(diff/3600)}h ago`; return `${Math.floor(diff/86400)}d ago`; }
    catch { return 'Recently'; }
  }
}
if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', () => { window.enhancedSidebar = new EnhancedSidebar(); }); }
else { window.enhancedSidebar = new EnhancedSidebar(); }
