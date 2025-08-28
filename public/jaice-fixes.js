// public/jaice-fixes.js — robust, server-compatible integration
(function(){
  function escapeHtml(t){ var d=document.createElement('div'); d.textContent=t||''; return d.innerHTML; }
  function toJSON(res){ return res.text().then(function(t){ try{return JSON.parse(t||'{}');}catch(e){ return { raw:t }; }}); }
  function req(url, method, body){
    var opts = { method: method||'GET', credentials:'include', headers:{ 'Accept':'application/json' } };
    if (body != null){ opts.headers['Content-Type']='application/json'; opts.body = JSON.stringify(body); }
    return fetch(url, opts);
  }

  var API = {
    listReports: function(){ 
      return req('/api/reports','GET').then(toJSON).then(function(data){
        console.log('API.listReports response:', data);
        // Handle different response formats
        if (Array.isArray(data)) return data;
        if (data && Array.isArray(data.data)) return data.data;
        if (data && Array.isArray(data.reports)) return data.reports;
        return [];
      }); 
    },
    createReport: function(title, description){
      console.log('API.createReport called:', { title, description });
      return req('/api/reports','POST', { title: title, description: description||'' })
        .then(function(res){
          if (!res.ok) return res.text().then(function(t){ throw new Error('create '+res.status+' '+t); });
          return toJSON(res);
        });
    },
    addItem: function(reportId, item){
      console.log('API.addItem called:', { reportId, item });
      // Ensure item has the correct structure that matches your server expectations
      var normalizedItem = {
        title: item.title || item.headline || 'Saved Content',
        html: item.html || item.content || '',
        content: item.html || item.content || '', // Add both html and content for compatibility
        createdAt: Date.now()
      };
      
      // Try multiple request formats that your server might expect
      var formats = [
        { items: [normalizedItem] },           // Array wrapper
        normalizedItem,                        // Direct item
        { item: normalizedItem },              // Single item wrapper
        { title: normalizedItem.title, html: normalizedItem.html, createdAt: normalizedItem.createdAt } // Flattened
      ];
      
      var tryFormat = function(formatIndex) {
        if (formatIndex >= formats.length) {
          return Promise.reject(new Error('All addItem formats failed'));
        }
        
        console.log('Trying format', formatIndex, ':', formats[formatIndex]);
        
        return req('/api/reports/'+encodeURIComponent(reportId)+'/items','POST', formats[formatIndex])
          .then(function(res){
            if (!res.ok) {
              return res.text().then(function(t){ 
                console.log('Format', formatIndex, 'failed:', res.status, t);
                throw new Error('addItem format '+formatIndex+' failed: '+res.status+' '+t); 
              });
            }
            console.log('Format', formatIndex, 'succeeded!');
            return toJSON(res);
          })
          .catch(function(error){
            console.log('Format', formatIndex, 'error:', error.message);
            if (formatIndex < formats.length - 1) {
              return tryFormat(formatIndex + 1);
            }
            throw error;
          });
      };
      
      return tryFormat(0);
    }
  };

  function toast(msg){
    try{
      var host = document.getElementById('toastHost');
      if(!host){ 
        host=document.createElement('div'); 
        host.id='toastHost'; 
        host.style.cssText='position:fixed;right:16px;bottom:16px;display:flex;flex-direction:column;gap:8px;z-index:10050;'; 
        document.body.appendChild(host); 
      }
      var el=document.createElement('div'); 
      el.style.cssText='min-width:240px;max-width:360px;padding:10px 12px;border-radius:8px;background:#10b981;color:#fff;font:14px/1.3 system-ui;box-shadow:0 6px 18px rgba(0,0,0,.16)'; 
      el.textContent=msg; 
      host.appendChild(el);
      setTimeout(function(){ try{ host.removeChild(el);}catch(e){} }, 2400);
    }catch(e){ alert(msg); }
  }

  function getBoxTitle(box){
    var candidates = [
      box.querySelector('.answer-headline'),
      box.querySelector('.answer-title'),
      box.querySelector('.theme-title'),
      box.querySelector('.card-title'),
      box.querySelector('h1'),
      box.querySelector('h2'), 
      box.querySelector('h3'),
      box.querySelector('h4')
    ];
    
    for (var i = 0; i < candidates.length; i++) {
      if (candidates[i] && candidates[i].textContent) {
        var text = candidates[i].textContent.trim();
        if (text) return text;
      }
    }
    
    return 'Saved Content';
  }

  function getBoxContent(box){
    // Get the full HTML content of the box for saving
    return box ? box.outerHTML : '';
  }

  function addToReport(box){
    var title = getBoxTitle(box);
    var html = getBoxContent(box);
    console.log('addToReport called:', { title, html: html.substring(0, 100) + '...' });
    openModal({ title: title, html: html });
  }

  function openModal(payload){
    var existing = document.getElementById('reportSelectionModal'); 
    if (existing) existing.remove();
    
    var overlay = document.createElement('div'); 
    overlay.id='reportSelectionModal';
    overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:10000;';
    
    var panel = document.createElement('div');
    panel.style.cssText='background:#fff;border-radius:12px;max-width:520px;width:92%;padding:24px;box-shadow:0 10px 30px rgba(0,0,0,.2);font:14px system-ui;';
    panel.innerHTML = ''
      + '<div style="font-size:18px;font-weight:700;margin-bottom:8px;color:#1f2937;">Add to Report</div>'
      + '<div style="color:#6b7280;margin-bottom:16px;font-size:14px;">Content: '+escapeHtml(payload.title)+'</div>'
      + '<label style="font-size:13px;color:#374151;font-weight:500;display:block;margin-bottom:8px;">Select Report</label>'
      + '<select id="rptSelect" style="width:100%;padding:12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;margin-bottom:16px;background:#fff;">'
      + '<option value="">Loading reports...</option>'
      + '<option value="__new">+ Create new report…</option>'
      + '</select>'
      + '<div id="newWrap" style="display:block;margin-top:0px;">'
      + '  <label style="font-size:13px;color:#374151;font-weight:500;display:block;margin-bottom:6px;">Report Title *</label>'
      + '  <input id="rptTitle" type="text" placeholder="Enter report title" style="width:100%;padding:12px;border:1px solid #d1d5db;border-radius:8px;margin-bottom:12px;font-size:14px;">'
      + '  <label style="font-size:13px;color:#374151;font-weight:500;display:block;margin-bottom:6px;">Description (optional)</label>'
      + '  <textarea id="rptDesc" rows="3" placeholder="Brief description of this report" style="width:100%;padding:12px;border:1px solid #d1d5db;border-radius:8px;resize:vertical;font-family:inherit;font-size:14px;"></textarea>'
      + '</div>'
      + '<div style="display:flex;gap:12px;justify-content:flex-end;margin-top:20px;">'
      + '  <button id="rptCancel" style="padding:10px 20px;border:1px solid #d1d5db;background:#fff;border-radius:8px;cursor:pointer;font-size:14px;font-weight:500;color:#374151;">Cancel</button>'
      + '  <button id="rptConfirm" style="padding:10px 20px;border:none;background:#D14829;color:#fff;border-radius:8px;cursor:pointer;font-size:14px;font-weight:600;">Add to Report</button>'
      + '</div>';
    
    overlay.appendChild(panel); 
    document.body.appendChild(overlay);

    var select = panel.querySelector('#rptSelect');
    var newWrap = panel.querySelector('#newWrap');
    var titleInput = panel.querySelector('#rptTitle');
    var descInput = panel.querySelector('#rptDesc');
    
    panel.querySelector('#rptCancel').onclick = function(){ overlay.remove(); };
    
    // Set initial state - show form fields since "__new" is pre-selected
    select.value = '__new';
    newWrap.style.display = 'block';
    
    select.addEventListener('change', function(){ 
      console.log('Select changed to:', select.value);
      if (select.value === '__new') {
        newWrap.style.display = 'block';
        setTimeout(function(){ titleInput.focus(); }, 100);
      } else {
        newWrap.style.display = 'none';
      }
    });

    // Load existing reports
    console.log('Loading reports for modal...');
    API.listReports().then(function(reports){
      console.log('Modal received reports:', reports);
      
      // Clear loading option but keep "create new" as first option
      select.innerHTML = '<option value="__new">+ Create new report…</option>';
      
      // Add existing reports
      if (Array.isArray(reports) && reports.length > 0) {
        reports.forEach(function(report){
          var opt = document.createElement('option');
          opt.value = report.id || report._id || report.reportId;
          opt.textContent = report.title || report.name || 'Untitled Report';
          select.appendChild(opt);
        });
        
        // Add separator line
        var separator = document.createElement('option');
        separator.disabled = true;
        separator.textContent = '─────────────────';
        select.insertBefore(separator, select.children[1]);
      }
      
      // Keep "create new" selected and form visible
      select.value = '__new';
      newWrap.style.display = 'block';
      setTimeout(function(){ titleInput.focus(); }, 200);
      
    }).catch(function(error){
      console.error('Failed to load reports for modal:', error);
      select.innerHTML = '<option value="__new">+ Create new report…</option><option value="" disabled>Failed to load existing reports</option>';
      select.value = '__new';
      newWrap.style.display = 'block';
      setTimeout(function(){ titleInput.focus(); }, 100);
    });

    // Focus title input initially
    setTimeout(function(){ titleInput.focus(); }, 300);

    // Handle form submission
    panel.querySelector('#rptConfirm').onclick = function(){
      var selectedValue = select.value;
      
      function afterAdd(){
        toast('Successfully added to report!');
        overlay.remove();
        
        // Refresh reports in any open reports page
        if (typeof window.loadReportsFromAPI === 'function') {
          window.loadReportsFromAPI();
        }
        
        // Update localStorage as fallback
        API.listReports().then(function(reports){
          try{ 
            localStorage.setItem('userReports', JSON.stringify(reports)); 
          } catch(e) {
            console.warn('Failed to update localStorage:', e);
          }
          document.dispatchEvent(new CustomEvent('reports:synced', { detail: reports }));
        }).catch(function(e){
          console.warn('Failed to refresh reports after add:', e);
        });
      }
      
      function doAdd(reportId){
        console.log('Adding item to report:', reportId);
        API.addItem(reportId, { 
          title: payload.title, 
          html: payload.html, 
          createdAt: Date.now() 
        }).then(function(result){
          console.log('Item added successfully:', result);
          afterAdd();
        }).catch(function(error){
          console.error('Failed to add item:', error);
          alert('Failed to add to report: ' + error.message);
        });
      }
      
      if (selectedValue === '__new'){
        var title = (titleInput.value || '').trim();
        if (!title){ 
          alert('Please enter a report title'); 
          titleInput.focus(); 
          return; 
        }
        
        console.log('Creating new report:', title);
        API.createReport(title, (descInput.value || '').trim())
          .then(function(result){
            console.log('Report created:', result);
            var reportId = result.id || result._id || result.reportId;
            if (!reportId) {
              // Try to get ID from result.data
              if (result.data) {
                reportId = result.data.id || result.data._id || result.data.reportId;
              }
            }
            if (!reportId) {
              throw new Error('No report ID returned from server');
            }
            doAdd(reportId);
          })
          .catch(function(error){
            console.error('Failed to create report:', error);
            alert('Failed to create report: ' + error.message);
          });
      } else if (selectedValue) {
        doAdd(selectedValue);
      } else {
        alert('Please select a report or create a new one');
      }
    };

    overlay.addEventListener('click', function(e){ 
      if(e.target === overlay) overlay.remove(); 
    });
  }

  // Global click handler for three-dot menus - more flexible selectors
  document.addEventListener('click', function(ev){
    var trigger = ev.target.closest('.three-dot-menu, .jaice-three-dot-trigger, [data-menu="three-dots"], button[onclick*="showSaveMenu"], .dropdown-container button, [aria-label="Options"]');
    if(!trigger) return;
    
    ev.preventDefault(); 
    ev.stopPropagation();
    
    console.log('Three-dot menu clicked');
    
    var contentBox = trigger.closest('.answer-card, .theme-card, .dashboard-item, .search-result, .card, [data-saveable]');
    if (!contentBox) {
      console.warn('Could not find content box to save');
      return;
    }
    
    addToReport(contentBox);
  }, true);

  // Also handle showSaveMenu function calls from existing code
  window.showSaveMenu = function(button, type) {
    console.log('showSaveMenu called:', type);
    var contentBox = button.closest('.answer-card, .theme-card, .dashboard-item, .search-result, .card');
    if (contentBox) {
      addToReport(contentBox);
    }
  };

  // Disabled: Handle clicks on dashboard items that don't have three-dot menus yet
  // This functionality is now handled in app.js directly when creating dashboard items
  /* 
  document.addEventListener('mouseenter', function(ev) {
    // Check if ev.target exists and has the closest method
    if (!ev.target || typeof ev.target.closest !== 'function') return;
    
    var dashboardItem = ev.target.closest('.dashboard-item');
    if (!dashboardItem) return;
    if (dashboardItem.querySelector('.three-dot-menu')) return; // Already has menu
    
    // Add three-dot menu to dashboard items that don't have one
    var header = dashboardItem.querySelector('h4');
    if (header && !header.querySelector('.three-dot-menu')) {
      header.style.position = 'relative';
      var menuBtn = document.createElement('button');
      menuBtn.className = 'three-dot-menu';
      menuBtn.style.cssText = 'position:absolute;top:-8px;right:-8px;background:rgba(255,255,255,0.9);border:1px solid #e5e7eb;border-radius:4px;width:24px;height:24px;display:flex;align-items:center;justify-content:center;cursor:pointer;opacity:0;transition:opacity 0.2s;';
      menuBtn.innerHTML = '⋯';
      menuBtn.title = 'Add to Report';
      header.appendChild(menuBtn);
      
      dashboardItem.addEventListener('mouseenter', function() {
        menuBtn.style.opacity = '1';
      });
      
      dashboardItem.addEventListener('mouseleave', function() {
        menuBtn.style.opacity = '0';
      });
    }
  });
  */

  // Expose main function
  window.addToReport = addToReport;
  
  console.log('jaice-fixes.js loaded with report integration');
})();