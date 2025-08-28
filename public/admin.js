console.log("🔧 admin.js (fixed) loading...");

// -------- Helpers
const $ = (s) => document.querySelector(s);

function escapeHtml(s){
  return String(s ?? "").replace(/[&<>"']/g, m => (
    {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]
  ));
}

async function j(url, fallback, options={}){
  try{
    const res = await fetch(url, {
      headers: {'Accept':'application/json'},
      credentials: 'include',
      ...options
    });
    if(!res.ok) {
      console.warn('API error:', url, res.status, res.statusText);
      throw new Error(`${res.status}: ${res.statusText}`);
    }
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) return await res.json();
    return fallback;
  }catch(e){
    console.warn('fetch failed', url, e.message);
    return fallback;
  }
}

// Helper to get library name by ID from cached libraries
function getLibraryNameById(libraryId) {
  console.log('getLibraryNameById called with:', libraryId);
  if (!libraryId || !window.cachedLibraries) {
    console.log('Missing libraryId or cachedLibraries');
    return "";
  }
  
  console.log('Searching in cached libraries:', window.cachedLibraries);
  const lib = window.cachedLibraries.find(l => {
    const matches = l.id === libraryId || l._id === libraryId || l.folderId === libraryId;
    if (matches) console.log('Found matching library:', l);
    return matches;
  });
  
  const result = lib ? (lib.name || lib.title || lib.libraryName || lib.folderName || "") : "";
  console.log('getLibraryNameById result:', result);
  return result;
}

// Deep string extraction for library objects
function _deepFirstString(val, depth=4){
  if (val == null || depth < 0) return "";
  if (typeof val === "string" && val.trim()) return val;
  if (Array.isArray(val)){
    for (const v of val){
      const s = _deepFirstString(v, depth-1);
      if (s) return s;
    }
    return "";
  }
  if (typeof val === "object"){
    for (const k of Object.keys(val)){
      const s = _deepFirstString(val[k], depth-1);
      if (s) return s;
    }
  }
  try {
    const s = String(val);
    if (s && s !== "[object Object]") return s;
  } catch {}
  return "";
}

function labelFrom(lib){
  if (lib == null) return "";
  if (typeof lib === "string") return lib;
  const keys = ["name","title","clientName","displayName","label","text","client","library","folder","folderName","client_library","clientLibrary","ClientName","Name"];
  for (const k of keys){
    if (lib[k]){
      const s = _deepFirstString(lib[k]);
      if (s) return s;
    }
  }
  return _deepFirstString(lib) || "(unnamed library)";
}

function idFrom(lib){
  if (lib == null) return "";
  if (typeof lib === "string") return lib;
  const keys = ["id","slug","code","key","name","client","library","folder","folderName","client_library","clientLibrary"];
  for (const k of keys){
    if (lib[k]){
      const s = _deepFirstString(lib[k]);
      if (s) return s;
    }
  }
  return _deepFirstString(lib) || "";
}

function isBadValue(v){
  return !v || /\[object Object\]/i.test(String(v));
}

function fmtDate(x){
  try { return x ? new Date(x).toLocaleString() : "—"; } catch { return "—"; }
}

// -------- Elements
const els = {
  adminCount: document.querySelector("#adminCount"),
  clientCount: document.querySelector("#clientCount"),
  libraryCount: document.querySelector("#libraryCount"),
  librarySelect: document.querySelector("#librarySelect"),
  libraryStats: document.querySelector("#libraryStats"),
  adminAccounts: document.querySelector("#adminAccounts"),
  clientAccounts: document.querySelector("#clientAccounts"),
  modal: document.querySelector("#confirmModal"),
  confirmBtn: document.querySelector("#confirmDelete"),
  cancelBtn: document.querySelector("#cancelDelete"),
  confirmText: document.querySelector("#confirmText")
};

// -------- Init
(async function init(){
  try{
    await Promise.all([loadStats(), loadLibraries(), loadAdmins(), loadClients()]);
    setupModalHandlers();
    console.log("✅ admin ready");
  }catch(e){
    console.error("admin init failed", e);
  }
})();

// -------- Profile Dropdown
(function() {
  const profileBtn = document.getElementById('profileBtn');
  const profileMenu = document.getElementById('profileMenu');
  const logoutBtn = document.getElementById('logoutBtn');

  if (profileBtn && profileMenu) {
    profileBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      profileMenu.classList.toggle('show');
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', () => {
      profileMenu.classList.remove('show');
    });

    // Prevent dropdown from closing when clicking inside it
    profileMenu.addEventListener('click', (e) => {
      e.stopPropagation();
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      try {
        await fetch('/auth/logout', { 
          method: 'POST', 
          credentials: 'include' 
        });
        window.location.href = '/login.html';
      } catch (e) {
        console.warn('Logout failed:', e);
        // Still redirect to login even if logout fails
        window.location.href = '/login.html';
      }
    });
  }
})();

// -------- Modal Handlers
function setupModalHandlers() {
  // Add Admin button
  const addAdminBtn = document.getElementById('btnAddAdmin');
  if (addAdminBtn) {
    addAdminBtn.addEventListener('click', showAddAdminModal);
    console.log('Admin button handler attached');
  } else {
    console.log('Admin button not found');
  }
  
  // Add Client button  
  const addClientBtn = document.getElementById('btnAddClient');
  if (addClientBtn) {
    addClientBtn.addEventListener('click', showAddClientModal);
    console.log('Client button handler attached');  
  } else {
    console.log('Client button not found');
  }
  
  // Cancel buttons
  document.getElementById('cancelAddAdmin')?.addEventListener('click', () => {
    document.getElementById('addAdminModal').style.display = 'none';
  });
  
  document.getElementById('cancelAddClient')?.addEventListener('click', () => {
    document.getElementById('addClientModal').style.display = 'none';
  });
  
  // Confirm buttons
  document.getElementById('confirmAddAdmin')?.addEventListener('click', handleAddAdmin);
  document.getElementById('confirmAddClient')?.addEventListener('click', handleAddClient);
}

function showAddAdminModal() {
  // Clear form
  document.getElementById('addAdminForm').reset();
  document.getElementById('addAdminModal').style.display = 'flex';
}

function showAddClientModal() {
  // Clear form
  document.getElementById('addClientForm').reset();
  
  // Populate library dropdown
  populateClientLibraryDropdown();
  
  document.getElementById('addClientModal').style.display = 'flex';
}

function populateClientLibraryDropdown() {
  const select = document.getElementById('clientLibrary');
  if (!select) return;
  
  select.innerHTML = '<option value="">Select a library...</option>';
  
  // Get libraries from the main library select
  const mainLibrarySelect = els.librarySelect;
  if (mainLibrarySelect) {
    Array.from(mainLibrarySelect.options).forEach(option => {
      if (option.value) {
        const newOption = document.createElement('option');
        newOption.value = option.value;
        newOption.textContent = option.textContent;
        select.appendChild(newOption);
      }
    });
  }
}

async function handleAddAdmin() {
  const email = document.getElementById('adminEmail').value;
  const username = document.getElementById('adminUsername').value;
  const password = document.getElementById('adminPassword').value;
  const confirmPassword = document.getElementById('adminConfirmPassword').value;
  
  // Validation
  if (!email || !username || !password || !confirmPassword) {
    alert('Please fill in all fields');
    return;
  }
  
  // Email format validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    alert('Please enter a valid email address');
    return;
  }
  
  if (password !== confirmPassword) {
    alert('Passwords do not match');
    return;
  }
  
  if (password.length < 6) {
    alert('Password must be at least 6 characters long');
    return;
  }
  
  try {
    const result = await j('/api/admin/users', {}, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        username,
        password,
        role: 'admin'
      })
    });
    
    if (result && !result.error) {
      alert('Admin account created successfully');
      document.getElementById('addAdminModal').style.display = 'none';
      await loadAdmins(); // Refresh the admin list
    } else {
      alert('Error creating admin: ' + (result.error || 'Unknown error'));
    }
  } catch (error) {
    alert('Error creating admin: ' + error.message);
  }
}

async function handleAddClient() {
  const email = document.getElementById('clientEmail').value;
  const username = document.getElementById('clientUsername').value;
  const password = document.getElementById('clientPassword').value;
  const confirmPassword = document.getElementById('clientConfirmPassword').value;
  const clientLibrary = document.getElementById('clientLibrary').value;
  
  // Validation
  if (!email || !username || !password || !confirmPassword || !clientLibrary) {
    alert('Please fill in all fields');
    return;
  }
  
  // Email format validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    alert('Please enter a valid email address');
    return;
  }
  
  if (password !== confirmPassword) {
    alert('Passwords do not match');
    return;
  }
  
  if (password.length < 6) {
    alert('Password must be at least 6 characters long');
    return;
  }
  
  try {
    // Get the selected library name for display
    const librarySelect = document.getElementById('clientLibrary');
    const selectedOption = librarySelect.options[librarySelect.selectedIndex];
    const libraryName = selectedOption.textContent;
    
    const result = await j('/api/admin/users', {}, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        username,
        password,
        role: 'client',
        allowedClients: clientLibrary, // Store library access
        library: clientLibrary, // Keep for backwards compatibility
        libraryName: libraryName // Store the human-readable name
      })
    });
    
    if (result && !result.error) {
      alert('Client account created successfully');
      document.getElementById('addClientModal').style.display = 'none';
      await loadClients(); // Refresh the client list
    } else {
      alert('Error creating client: ' + (result.error || 'Unknown error'));
    }
  } catch (error) {
    alert('Error creating client: ' + error.message);
  }
}

// -------- Loaders
async function loadStats(){
  // We'll update these counts after loading the actual data
  // to ensure they match what's displayed
  if (els.adminCount) els.adminCount.textContent = "Total Admins: 0";
  if (els.clientCount) els.clientCount.textContent = "Total Clients: 0";
  if (els.libraryCount) els.libraryCount.textContent = "Client Libraries: 0";
}

// Update stats based on actual loaded data
function updateStatCounts(adminCount, clientCount, libraryCount) {
  if (els.adminCount) els.adminCount.textContent = `Total Admins: ${adminCount ?? 0}`;
  if (els.clientCount) els.clientCount.textContent = `Total Clients: ${clientCount ?? 0}`;
  if (els.libraryCount) els.libraryCount.textContent = `Client Libraries: ${libraryCount ?? 0}`;
}

// Update stats when all data is ready
function updateStatsIfReady() {
  console.log('updateStatsIfReady called - admin:', window.adminCount, 'client:', window.clientCount, 'library:', window.libraryCount);
  if (typeof window.adminCount !== 'undefined' && 
      typeof window.clientCount !== 'undefined' && 
      typeof window.libraryCount !== 'undefined') {
    console.log('All counts ready, updating UI...');
    updateStatCounts(window.adminCount, window.clientCount, window.libraryCount);
  }
}

async function loadLibraries(){
  console.log('Loading libraries from /api/libraries...');
  const data = await j("/api/libraries", []);
  console.log('Raw library data response:', data);
  
  if (!els.librarySelect) {
    console.log('No library select element found, skipping library UI setup');
    return;
  }
  
  const libs = Array.isArray(data) ? data : (data.libraries || []);
  console.log('Processed libraries array:', libs);
  
  // Cache libraries for name lookup
  window.cachedLibraries = libs;
  console.log('Set window.cachedLibraries to:', window.cachedLibraries);
  
  // Store library count for stats update
  window.libraryCount = libs.length;
  console.log('Library count set to:', window.libraryCount);
  updateStatsIfReady();
  
  els.librarySelect.innerHTML = `<option value="">Choose a library…</option>`;
  libs.forEach(lb => {
    const label = labelFrom(lb);
    const id = idFrom(lb);
    const opt = document.createElement("option");
    opt.value = isBadValue(id) ? label : id;
    opt.textContent = (!label || /\[object Object\]/i.test(label)) ? "(unnamed library)" : label;
    els.librarySelect.appendChild(opt);
  });
  
  els.librarySelect.addEventListener("change", async () => {
    const id = els.librarySelect.value;
    if (!id || isBadValue(id)){
      els.libraryStats.innerHTML = `<span class="muted">Select a library to view stats.</span>`;
      return;
    }
    
    els.libraryStats.innerHTML = `<span class="muted">Loading library statistics...</span>`;
    
    const st = await j(`/api/libraries/${encodeURIComponent(id)}/stats`, { 
      totalFiles: 0, 
      processedFiles: 0, 
      lastSynced: null, 
      byCategory: { Reports: 0, QNR: 0, DataFiles: 0 }
    });
    
    const cat = st.byCategory || {};
    const totalFiles = st.totalFiles || 0;
    const processedFiles = st.processedFiles || 0;
    const lastSynced = st.lastSynced;
    
    els.libraryStats.innerHTML = `
      <div style="display:flex;gap:24px;flex-wrap:wrap;align-items:center;">
        <div>Google Drive files: <strong>${totalFiles}</strong></div>
        <div>Processed: <strong>${processedFiles}</strong></div>
        <div>Last synced: <strong>${fmtDate(lastSynced)}</strong></div>
      </div>
      <div style="margin-top:8px;border-top:1px dashed #e5e7eb;padding-top:8px;">
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;max-width:640px;">
          <div style="background:#fafafa;border:1px solid #f0f2f5;border-radius:8px;padding:8px 10px;">
            <div class="muted" style="font-size:12px;">Reports</div>
            <div style="font-weight:600;">${cat.Reports ?? 0}</div>
          </div>
          <div style="background:#fafafa;border:1px solid #f0f2f5;border-radius:8px;padding:8px 10px;">
            <div class="muted" style="font-size:12px;">QNR</div>
            <div style="font-weight:600;">${cat.QNR ?? 0}</div>
          </div>
          <div style="background:#fafafa;border:1px solid #f0f2f5;border-radius:8px;padding:8px 10px;">
            <div class="muted" style="font-size:12px;">Data files</div>
            <div style="font-weight:600;">${cat.DataFiles ?? 0}</div>
          </div>
        </div>
      </div>
      <div style="margin-top:12px;">
        <button onclick="manualSync()" style="background:#D14829;color:white;border:none;padding:6px 12px;border-radius:6px;font-size:12px;cursor:pointer;">
          Sync Google Drive
        </button>
      </div>`;
  });
  
  if (els.libraryStats) els.libraryStats.innerHTML = `<span class="muted">Select a library to view stats.</span>`;
}

// Manual sync function
async function manualSync() {
  const button = event.target;
  const originalText = button.innerHTML;
  button.innerHTML = 'Syncing...';
  button.disabled = true;
  
  try {
    const result = await j("/admin/manual-sync", {}, { method: 'POST' });
    if (result.success) {
      alert('✅ Google Drive sync completed successfully!');
      // Refresh the current library stats
      if (els.librarySelect.value) {
        els.librarySelect.dispatchEvent(new Event('change'));
      }
      // Refresh stats
      await loadStats();
    } else {
      alert('❌ Sync failed: ' + (result.details || 'Unknown error'));
    }
  } catch (error) {
    alert('❌ Sync failed: ' + error.message);
  } finally {
    button.innerHTML = originalText;
    button.disabled = false;
  }
}

// Make manualSync globally available
window.manualSync = manualSync;

async function loadAdmins(){
  console.log('Loading admin accounts...');
  const admins = await j("/api/admin/users", []);
  console.log('Admin accounts response:', admins);
  
  const arr = Array.isArray(admins) ? admins : [];
  arr.sort((a,b) => {
    const tb = new Date(b.createdAt || b.created || 0).getTime();
    const ta = new Date(a.createdAt || a.created || 0).getTime();
    if (tb !== ta) return tb - ta;
    const sb = (b.username || b.email || b.id || "").toLowerCase();
    const sa = (a.username || a.email || a.id || "").toLowerCase();
    return sa.localeCompare(sb);
  });
  
  let displayData = arr.map(a => ({
    id: a.id || a.username || a.email,
    title: a.username || a.email || a.id,
    role: "admin",
    createdAt: a.createdAt || a.created
  }));
  
  // Remove duplicates based on username/email
  const seen = new Set();
  displayData = displayData.filter(item => {
    const key = item.title.toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
  
  renderAccounts(els.adminAccounts, displayData);
  
  // Store admin count for stats update
  window.adminCount = displayData.length;
  console.log('Admin count set to:', window.adminCount);
  updateStatsIfReady();
}

async function loadClients(){
  console.log('🔍 Loading client accounts...');
  const users = await j("/api/admin/users", []);
  console.log('🔍 All users response:', users);
  console.log('🔍 Users array check - is array?', Array.isArray(users), 'length:', users?.length);
  
  // Filter for client role accounts only
  const clients = Array.isArray(users) ? users.filter(u => {
    console.log('🔍 Checking user role:', u.username, 'role:', u.role);
    return u.role === 'client';
  }) : [];
  console.log('🔍 Filtered client accounts:', clients);
  console.log('🔍 Client count after filtering:', clients.length);
  
  const arr = clients;
  arr.sort((a,b) => {
    const tb = new Date(b.createdAt || b.created || 0).getTime();
    const ta = new Date(a.createdAt || a.created || 0).getTime();
    if (tb !== ta) return tb - ta;
    const sb = (b.name || b.username || b.id || "").toLowerCase();
    const sa = (a.name || a.username || a.id || "").toLowerCase();
    return sa.localeCompare(sb);
  });
  
  let displayData = arr.map(c => {
    console.log('Processing client:', c);
    const libraryId = c.library || c.allowedClients || c.libraryId || c.clientLibrary;
    console.log('Library lookup:', libraryId);
    console.log('Library name from lookup:', getLibraryNameById(libraryId));
    console.log('Cached libraries:', window.cachedLibraries);
    
    return {
      id: c.username || c.id || c.name, // Use username as primary ID for users.json structure
      title: c.username || c.name || c.id,
      role: "client",
      createdAt: c.createdAt || c.created,
      library: c.libraryName || getLibraryNameById(libraryId) || libraryId || "—"
    };
  });
  
  // Remove duplicates based on username/name
  const seen = new Set();
  displayData = displayData.filter(item => {
    const key = item.title.toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
  
  renderAccounts(els.clientAccounts, displayData);
  
  // Store client count for stats update
  window.clientCount = displayData.length;
  console.log('Client count set to:', window.clientCount);
  updateStatsIfReady();
}

// -------- Rendering & actions
function renderAccounts(container, arr){
  if (!container) return;
  container.classList.remove("scroll10");
  container.innerHTML = "";
  if (!arr.length){
    container.innerHTML = `<div class="muted">No accounts yet.</div>`;
    return;
  }
  if (arr.length > 10) container.classList.add("scroll10");

  arr.forEach(item => {
    const row = document.createElement("div");
    row.className = "row";
    let metaHtml = "";
    if (item.role === "client"){
      metaHtml = `<div class="meta">Library Access: ${escapeHtml(item.library ?? "—")}</div>`;
    }
    const isCurrentUser = item.title === window.currentUser?.username || item.id === window.currentUser?.id;
    const loggedInIndicator = isCurrentUser ? ' <span style="font-size:11px;color:#6b7280;">(logged in)</span>' : '';
    
    row.innerHTML = `
      <div>
        <div class="title">${escapeHtml(item.title)}${loggedInIndicator}</div>
        ${metaHtml}
      </div>
      <div class="menu">
        <button class="kebab" aria-label="More"><span></span><span></span><span></span></button>
        <div class="menu-items">
          <button data-action="delete">Delete account</button>
        </div>
      </div>
    `;
    const kebab = row.querySelector(".kebab");
    const menu = row.querySelector(".menu-items");
    kebab.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = menu.style.display === "block";
      document.querySelectorAll(".menu-items").forEach(m => m.style.display = "none");
      menu.style.display = open ? "none" : "block";
    });
    document.addEventListener("click", () => { menu.style.display = "none"; });

    const delBtn = row.querySelector("[data-action='delete']");
    delBtn.addEventListener("click", () => {
      menu.style.display = "none";
      confirmDelete(item);
    });

    container.appendChild(row);
  });
}

function confirmDelete(account){
  const modal = document.querySelector("#confirmModal");
  const confirmBtn = document.querySelector("#confirmDelete");
  const cancelBtn = document.querySelector("#cancelDelete");
  const text = document.querySelector("#confirmText");
  if (!modal || !confirmBtn || !cancelBtn || !text) return;
  text.textContent = `Delete account "${account.title}"? This action cannot be undone.`;
  modal.style.display = "flex";
  const cleanup = () => {
    modal.style.display = "none";
    confirmBtn.onclick = null;
    cancelBtn.onclick = null;
  };
  cancelBtn.onclick = cleanup;
  confirmBtn.onclick = async () => {
    try {
      // Use username for the delete endpoint as per server.js
      const username = account.title || account.id; // account.title is the username
      console.log('Trying to delete account:', account);
      console.log('Using username:', username);
      const url = `/api/admin/users/${encodeURIComponent(username)}`;
      console.log('DELETE URL:', url);
      const res = await fetch(url, { method:"DELETE", credentials:"include" });
      if (!res.ok) {
        if (res.status === 404 && account.role === "client") {
          throw new Error("Client deletion not supported for accounts created via the separate client system. This client exists in a different storage location that doesn't have a delete API endpoint.");
        }
        throw new Error(String(res.status));
      }
      
      // Refresh the appropriate section
      if (account.role === "admin") {
        await loadAdmins();
      } else {
        await loadClients();
      }
      await loadStats(); // Refresh the counters
    } catch(e) {
      console.warn("Delete failed:", e.message);
      alert("Failed to delete account: " + e.message);
    } finally {
      cleanup();
    }
  };
}

// --- Reports admin (list count only) ---
async function loadReportsAdmin(){
  try{
    const res = await fetch('/api/reports', { headers:{'Accept':'application/json'} });
    if (!res.ok) return;
    const js = await res.json();
    const count = (js && js.data && js.data.length) ? js.data.length : 0;
    const el = document.querySelector('#kpiReportsTotal');
    if (el) el.textContent = count;
  }catch{}
}
document.addEventListener('DOMContentLoaded', ()=>{
  try{ loadReportsAdmin(); }catch{}
});
