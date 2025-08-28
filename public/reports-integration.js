// public/reports-integration.js — ensure correct item POST and re-sync
(function(){
  function toJSON(res){ return res.text().then(function(t){ try{return JSON.parse(t||'{}');}catch(e){ return { raw:t }; }}); }
  function req(url, method, body){
    var opts = { method: method||'GET', credentials:'include', headers:{ 'Accept':'application/json' } };
    if (body != null){ opts.headers['Content-Type']='application/json'; opts.body = JSON.stringify(body); }
    return fetch(url, opts);
  }
  function addItem(reportId, item){
    var shapes = [ { items:[item] }, item, { item:item } ];
    var i=0;
    function attempt(){
      if (i>=shapes.length) return Promise.reject(new Error('addItem failed'));
      return req('/api/reports/'+encodeURIComponent(reportId)+'/items','POST',shapes[i++]).then(function(res){
        if (!res.ok) return res.text().then(function(t){ throw new Error('addItem '+res.status+' '+t); });
        return toJSON(res);
      }).catch(function(){ return attempt(); });
    }
    return attempt().then(function(){
      return req('/api/reports').then(toJSON).then(function(list){
        try{ localStorage.setItem('userReports', JSON.stringify(Array.isArray(list&&list.data)?list.data:list)); }catch(e){}
        document.dispatchEvent(new CustomEvent('reports:synced', { detail:list }));
      });
    });
  }
  window.ReportsIntegration = { addItem: addItem };
})();