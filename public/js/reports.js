// reports.js — robust normalizer (with visible logs)
console.log('📑 reports.js (normalizer v2) loaded');

(function(){
  function ready(fn){ if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', fn); else fn(); }

  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
  const timeAgo = (ts)=>{ try{ const d=new Date(ts); const s=(Date.now()-d)/1000; if(s<60)return'Just now'; if(s<3600)return Math.floor(s/60)+'m ago'; if(s<86400)return Math.floor(s/3600)+'h ago'; return Math.floor(s/86400)+'d ago'; }catch{return'';} };

  function findArray(p, depth=0){
    if(!p || depth>4) return null;
    if(Array.isArray(p)) return p;
    for(const k of ['data','results','reports','items','rows','docs']) if(Array.isArray(p?.[k])) return p[k];
    for(const k in p){ const v = p[k]; const a = findArray(v, depth+1); if(a) return a; }
    return null;
  }
  function normalize(list){
    if(!Array.isArray(list)) return [];
    return list.map(r=>{
      const id = r.id || r._id || r.reportId || r.uuid || r.key || '';
      const title = r.title || r.name || r.label || 'Untitled Report';
      const items = Array.isArray(r.items) ? r.items : Array.isArray(r.contents) ? r.contents : Array.isArray(r.children) ? r.children : [];
      const count = ('itemCount' in r) ? Number(r.itemCount) : items.length;
      const updated = r.updatedAt || r.updated || r.modifiedAt || r.lastModified || r.createdAt || r.created || Date.now();
      return { id, title, count, updated };
    });
  }
  function render(list){
    const grid=document.getElementById('reportsGrid');
    const empty=document.getElementById('emptyState');
    if(!grid) return;
    if(!list.length){ grid.innerHTML=''; if(empty) empty.style.display='block'; return; }
    if(empty) empty.style.display='none';
    grid.innerHTML = list.map(r=>`
      <div class="report-card" data-id="${esc(r.id)}">
        <div class="report-header">
          <h3 class="report-title">${esc(r.title)}</h3>
          <div class="report-menu"><button class="report-menu-btn" title="More">⋮</button></div>
        </div>
        <div class="report-meta">${r.count} item${r.count===1?'':'s'} • Updated ${esc(timeAgo(r.updated))}</div>
        <div class="report-actions"><a class="btn" href="reports.html#${encodeURIComponent(r.id)}">Open</a></div>
      </div>`).join('');
  }

  ready(async function init(){
    async function refresh(){
      try{
        const res = await fetch('/api/reports', {credentials:'include'});
        console.log('[reports] GET /api/reports ->', res.status);
        const payload = await res.json().catch(()=>([]));
        window.__reportsRaw = payload;
        const arr = findArray(payload) || [];
        const norm = normalize(arr).sort((a,b)=> (new Date(b.updated)-new Date(a.updated)));
        console.log('[reports] normalized count:', norm.length, norm);
        render(norm);
      }catch(e){
        console.error('[reports] load failed', e);
      }
    }
    window.addEventListener('reports:updated', refresh);
    await refresh();
  });
})();