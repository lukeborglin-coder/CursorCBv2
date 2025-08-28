// app.js - FIXED version with chart duplication and data label fixes
console.log('🚀 app.js loading...');

// Define critical functions immediately at the top of the file
function showSaveMenu(button, contentType) {
  console.log('showSaveMenu called with:', contentType);
  // Close other menus
  document.querySelectorAll('.dropdown-menu').forEach(menu => {
    menu.classList.remove('show');
  });
  
  const menu = button.nextElementSibling;
  if (menu) {
    menu.classList.add('show');
    
    // Close on outside click
    setTimeout(() => {
      document.addEventListener('click', function closeMenu(e) {
        if (!menu.contains(e.target) && !button.contains(e.target)) {
          menu.classList.remove('show');
          document.removeEventListener('click', closeMenu);
        }
      });
    }, 10);
  }
}

function saveToReport(contentType) {
  console.log('saveToReport called with:', contentType);
  
  // Find the nearest card element
  let card;
  if (contentType === 'answer') {
    card = document.getElementById('answerCard');
  } else {
    // For theme cards, find the active dropdown
    const activeDropdown = document.querySelector('.dropdown-menu.show');
    if (activeDropdown) {
      card = activeDropdown.closest('.answer-card, .theme-card, .dashboard-item');
    }
  }
  
  if (card) {
    const title = card.querySelector('h4, h3, .answer-headline')?.textContent || 'Untitled';
    const content = card.querySelector('.answer-text, .theme-summary, .chart-content, .answer-details')?.textContent || '';
    
    // Hide the dropdown
    const dropdown = card.querySelector('.dropdown-menu');
    if (dropdown) dropdown.classList.remove('show');
    
    alert(`Saving "${title}" to report...`);
    console.log('Content to save:', { title, content });
  }
}

function exportContent(contentType) {
  console.log('exportContent called with:', contentType);
  
  // Find the nearest card element
  let card;
  if (contentType === 'answer') {
    card = document.getElementById('answerCard');
  } else {
    // For theme cards, find the active dropdown
    const activeDropdown = document.querySelector('.dropdown-menu.show');
    if (activeDropdown) {
      card = activeDropdown.closest('.answer-card, .theme-card, .dashboard-item');
    }
  }
  
  if (card) {
    const title = card.querySelector('h4, h3, .answer-headline')?.textContent || 'Untitled';
    const content = card.querySelector('.answer-text, .theme-summary, .chart-content, .answer-details')?.textContent || '';
    
    // Hide the dropdown
    const dropdown = card.querySelector('.dropdown-menu');
    if (dropdown) dropdown.classList.remove('show');
    
    // Create and download a simple text file
    const exportContent = `${title}\n${'='.repeat(title.length)}\n\n${content}`;
    const blob = new Blob([exportContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.replace(/[^a-zA-Z0-9]/g, '_')}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    console.log('Exported:', title);
  }
}

// Make functions globally available immediately - CRITICAL FIX
if (typeof window !== 'undefined') {
  window.showSaveMenu = showSaveMenu;
  window.saveToReport = saveToReport;
  window.exportContent = exportContent;
  
  // Also assign to global scope directly
  globalThis.showSaveMenu = showSaveMenu;
  globalThis.saveToReport = saveToReport;
  globalThis.exportContent = exportContent;
  
  console.log('✅ Dropdown functions assigned to window:', {
    showSaveMenu: typeof window.showSaveMenu,
    saveToReport: typeof window.saveToReport,
    exportContent: typeof window.exportContent
  });
}

// Global state
let currentUser = null;
let currentClient = null;
let filters = {
  years: new Set(),
  methodology: new Set(),
  reports: new Set()
};
let availableFilters = {
  years: [],
  methodology: [],
  reports: []
};
let currentReferences = [];
let currentSaveContent = null;
let currentSaveType = null;

// REPORTS FUNCTIONALITY
let userReports = JSON.parse(localStorage.getItem('userReports') || '[]');

function saveToLocalStorage() {
  localStorage.setItem('userReports', JSON.stringify(userReports));
}

function switchToResultsLayout() {
  const contentArea = document.getElementById('contentArea');
  if (contentArea) {
    contentArea.classList.remove('initial-state');
    contentArea.classList.add('results-state');
    
    window.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
  }
}

async function initializeApp() {
  console.log('🔧 Initializing app...');
  
  try {
    console.log('📡 Fetching user data from /me...');
    const response = await fetch('/me');
    console.log('📡 Response status:', response.status);
    
    if (!response.ok) {
      console.error('❌ Authentication failed, redirecting to login');
      window.location.href = '/login.html';
      return;
    }
    
    const userData = await response.json();
    console.log('✅ User data received:', userData);
    
    currentUser = userData.user;
    currentClient = userData.activeClientId;
    
    console.log('👤 Current user:', currentUser);
    console.log('🏢 Current client:', currentClient);
    
    updateUserDisplay();
    await loadClientLibraries();
    await loadFilters();
    setupEventListeners();
    
    console.log('✅ App initialized successfully');
    
  } catch (error) {
    console.error('❌ Failed to initialize app:', error);
    console.log('🔄 Redirecting to login...');
    window.location.href = '/login.html';
  }
}

function updateUserDisplay() {
  console.log('📝 Updating user display...');
  
  const userDisplay = document.getElementById('userDisplay');
  const companyNameDisplay = document.getElementById('companyNameDisplay');
  const adminCenterLink = document.getElementById('adminCenterLink');
  const clientSelectorCorner = document.getElementById('clientSelectorCorner');
  const sidebarAdminLink = document.getElementById('sidebarAdminLink');
  
  console.log('📝 DOM elements found:', {
    userDisplay: !!userDisplay,
    companyNameDisplay: !!companyNameDisplay,
    adminCenterLink: !!adminCenterLink,
    clientSelectorCorner: !!clientSelectorCorner,
    sidebarAdminLink: !!sidebarAdminLink
  });
  
  if (!userDisplay) {
    console.error('❌ userDisplay element not found!');
    return;
  }
  
  if (currentUser) {
    const roleDisplay = currentUser.role === 'admin' ? 'admin' : currentUser.role;
    const displayText = `${currentUser.username} (${roleDisplay})`;
    userDisplay.textContent = displayText;
    
    console.log('✅ Updated user display to:', displayText);
    console.log('👤 User role from server:', currentUser.role);
    
    // FIXED: Check if user is admin (server sends "admin" for both admin and internal users)
    if (currentUser.role === 'admin') {
      console.log('👑 User is admin, showing admin controls');
      if (adminCenterLink) {
        adminCenterLink.style.display = 'block';
        console.log('✅ Admin center link made visible');
      }
      if (sidebarAdminLink) {
        sidebarAdminLink.style.display = 'block';
        console.log('✅ Sidebar admin link made visible');
      }
      if (clientSelectorCorner) {
        clientSelectorCorner.classList.add('show');
        console.log('✅ Client selector made visible');
      }
      if (companyNameDisplay) {
        companyNameDisplay.style.display = 'none';
        console.log('✅ Company name hidden for admin');
      }
    } else {
      console.log('👤 User is client, showing client view');
      if (companyNameDisplay) {
        companyNameDisplay.style.display = 'block';
        companyNameDisplay.textContent = 'GENENTECH';
        console.log('✅ Company name shown for client');
      }
      if (clientSelectorCorner) {
        clientSelectorCorner.classList.remove('show');
        console.log('✅ Client selector hidden for client');
      }
      if (adminCenterLink) {
        adminCenterLink.style.display = 'none';
        console.log('✅ Admin center link hidden for client');
      }
      if (sidebarAdminLink) {
        sidebarAdminLink.style.display = 'none';
        console.log('✅ Sidebar admin link hidden for client');
      }
    }
  } else {
    console.log('⚠️ No current user, showing loading...');
    userDisplay.textContent = 'Loading...';
  }
}

async function loadClientLibraries() {
  console.log('📚 Loading client libraries...');
  
  try {
    const response = await fetch('/api/client-libraries');
    console.log('📚 Client libraries response status:', response.status);
    
    if (response.ok) {
      const libraries = await response.json();
      console.log('📚 Client libraries loaded:', libraries);
      
      const clientSelect = document.getElementById('clientSelect');
      if (clientSelect) {
        clientSelect.innerHTML = '<option value="">Select a client library</option>';
        
        libraries.forEach(lib => {
          const option = document.createElement('option');
          option.value = lib.id;
          option.textContent = lib.name;
          clientSelect.appendChild(option);
        });
        
        if (currentClient) {
          clientSelect.value = currentClient;
        }
        
        console.log('✅ Client select populated with', libraries.length, 'libraries');
      } else {
        console.warn('⚠️ clientSelect element not found');
      }
    } else {
      console.warn('⚠️ Failed to load client libraries:', response.status);
    }
  } catch (error) {
    console.warn('⚠️ Failed to load client libraries:', error);
  }
}

async function loadFilters() {
  console.log('🔍 Loading filters...');
  
  try {
    const clientId = currentUser?.role === 'admin' ? currentClient : null;
    const url = clientId ? `/api/filter-options?clientId=${clientId}` : '/api/filter-options';
    console.log('🔍 Fetching filters from:', url);
    
    const response = await fetch(url);
    let data = {};
    
    if (response.ok) {
      data = await response.json();
      console.log('✅ Filters loaded:', data);
    } else {
      console.warn('⚠️ Using fallback filters');
      data = {
        years: [],
        methodology: [],
        reports: []
      };
    }
    
    availableFilters = data;
    populateFilterOptions();
  } catch (error) {
    console.warn('⚠️ Failed to load filters:', error);
    availableFilters = {
      years: [],
      methodology: [],
      reports: []
    };
    populateFilterOptions();
  }
}

function populateFilterOptions() {
  console.log('🎛️ Populating filter options...');
  
  if (document.getElementById('yearFilters')) {
    populateFilterSection('yearFilters', availableFilters.years || [], 'years');
    populateFilterSection('methodFilters', availableFilters.methodology || [], 'methodology');
    populateFilterSection('reportFilters', availableFilters.reports || [], 'reports');
    console.log('✅ Filter options populated');
  } else {
    console.log('ℹ️ Filter elements not found (probably not on search page)');
  }
}

function populateFilterSection(containerId, options, filterType) {
  const container = document.getElementById(containerId);
  if (!container) return;
  
  container.innerHTML = '';
  
  options.forEach(option => {
    const optionDiv = document.createElement('div');
    optionDiv.className = 'filter-option';
    
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = `${filterType}_${option}`;
    checkbox.checked = true;
    checkbox.dataset.option = option;
    checkbox.addEventListener('change', (e) => {
      if (e.target.checked) {
        filters[filterType].add(option);
        e.target.parentElement.classList.add('selected');
      } else {
        filters[filterType].delete(option);
        e.target.parentElement.classList.remove('selected');
      }
    });
    
    const label = document.createElement('label');
    label.htmlFor = checkbox.id;
    label.textContent = option;
    label.title = option;
    
    filters[filterType].add(option);
    optionDiv.classList.add('selected');
    
    optionDiv.appendChild(checkbox);
    optionDiv.appendChild(label);
    container.appendChild(optionDiv);
  });
}

function setupEventListeners() {
  console.log('🎧 Setting up event listeners...');
  
  // Profile menu - MOST IMPORTANT FOR YOUR ISSUE
  const profileBtn = document.getElementById('profileBtn');
  const profileMenu = document.getElementById('profileMenu');
  
  console.log('📝 Profile elements found:', {
    profileBtn: !!profileBtn,
    profileMenu: !!profileMenu
  });
  
  if (profileBtn && profileMenu) {
    console.log('✅ Setting up profile menu listeners');
    
    profileBtn.addEventListener('click', (e) => {
      console.log('👤 Profile button clicked');
      e.stopPropagation();
      profileMenu.classList.toggle('show');
      console.log('👤 Profile menu toggled, visible:', profileMenu.classList.contains('show'));
    });
    
    document.addEventListener('click', (e) => {
      if (!profileMenu.contains(e.target) && !profileBtn.contains(e.target)) {
        profileMenu.classList.remove('show');
      }
    });
  } else {
    console.error('❌ Profile button or menu not found!');
  }

  // Search functionality
  const searchBtn = document.getElementById('searchBtn');
  const searchInput = document.getElementById('searchInput');
  
  console.log('🔍 Search elements found:', {
    searchBtn: !!searchBtn,
    searchInput: !!searchInput
  });
  
  if (searchBtn) {
    searchBtn.addEventListener('click', performSearch);
    console.log('✅ Search button listener added');
  }
  
  if (searchInput) {
    searchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        performSearch();
      }
    });
    console.log('✅ Search input listener added');
  }

  // Filter functionality
  const filterBtn = document.getElementById('filterBtn');
  const filterOverlay = document.getElementById('filterOverlay');
  const cancelFilters = document.getElementById('cancelFilters');
  const applyFilters = document.getElementById('applyFilters');

  if (filterBtn && filterOverlay) {
    filterBtn.addEventListener('click', () => {
      filterOverlay.classList.add('show');
    });
  }

  if (cancelFilters) {
    cancelFilters.addEventListener('click', () => {
      filterOverlay.classList.remove('show');
    });
  }

  if (applyFilters) {
    applyFilters.addEventListener('click', () => {
      filterOverlay.classList.remove('show');
    });
  }

  if (filterOverlay) {
    filterOverlay.addEventListener('click', (e) => {
      if (e.target === filterOverlay) {
        filterOverlay.classList.remove('show');
      }
    });
  }

  // Client switching for admins
  const clientSelect = document.getElementById('clientSelect');
  if (clientSelect) {
    clientSelect.addEventListener('change', async (e) => {
      const selectedClientId = e.target.value;
      console.log('🏢 Client switched to:', selectedClientId);
      if (selectedClientId) {
        try {
          const response = await fetch('/auth/switch-client', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId: selectedClientId })
          });
          
          if (response.ok) {
            currentClient = selectedClientId;
            await loadFilters();
            console.log('✅ Client switch successful');
          } else {
            console.error('❌ Client switch failed:', response.status);
          }
        } catch (error) {
          console.error('❌ Failed to switch client:', error);
        }
      }
    });
    console.log('✅ Client select listener added');
  }

  // Logout
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      console.log('🚪 Logout clicked');
      try {
        await fetch('/auth/logout', { method: 'POST' });
        window.location.href = '/login.html';
      } catch (error) {
        window.location.href = '/login.html';
      }
    });
    console.log('✅ Logout listener added');
  }

  // Refresh button
  const refreshBtn = document.getElementById('refreshBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      performSearch(true);
    });
  }

  console.log('✅ Event listeners setup completed');
}

async function performSearch(refresh = false) {
  console.log('🔍 Performing search...');
  const query = document.getElementById('searchInput').value.trim();
  
  if (!query) {
    alert('Please enter a search query');
    return;
  }

  if (currentUser?.role === 'admin' && !currentClient) {
    alert('Please select a client library first');
    return;
  }

  if (!refresh) {
    clearPreviousResults();
  }

  const searchBtn = document.getElementById('searchBtn');
  const btnText = searchBtn.querySelector('.btn-text');
  const spinner = searchBtn.querySelector('.spinner');

  // Show thinking state in button only
  searchBtn.disabled = true;
  if (btnText) btnText.textContent = 'THINKING...';
  if (spinner) spinner.style.display = 'block';

  try {
    const requestBody = {
      userQuery: query,
      generateSupport: true,
      filters: {
        years: Array.from(filters.years),
        methodology: Array.from(filters.methodology),
        reports: Array.from(filters.reports)
      }
    };

    if (currentUser?.role === 'admin' && currentClient) {
      requestBody.clientId = currentClient;
    }

    if (refresh) {
      requestBody.refresh = Date.now();
    }

    console.log('📡 Sending search request:', requestBody);

    const response = await fetch('/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Search failed');
    }

    const results = await response.json();
    console.log('✅ Search results received:', results);
    
    switchToResultsLayout();
    displayResults(results);

  } catch (error) {
    console.error('❌ Search failed:', error);
    alert(error.message || 'Search failed. Please try again.');
  } finally {
    // Reset button state
    searchBtn.disabled = false;
    if (btnText) btnText.textContent = 'ASK';
    if (spinner) spinner.style.display = 'none';
  }
}

// FIXED: Enhanced display results with smart dynamic layout and no duplication
function displayResults(results) {
  console.log('📊 Displaying search results:', results);
  
  const answerCard = document.getElementById('answerCard');
  const answerHeadline = document.getElementById('answerHeadline');
  const answerDetails = document.getElementById('answerDetails');
  const resultsArea = document.getElementById('resultsArea');
  
  // Show the main answer using the correct HTML structure
  if (results.answer && answerCard) {
    if (answerHeadline && answerDetails) {
      // Split answer into headline and details if possible
      const answerText = formatRefsToSup(results.answer);
      const lines = answerText.split('\n');
      
      if (lines.length > 1) {
        answerHeadline.innerHTML = lines[0];
        const detailsText = lines.slice(1).join('\n').trim();
        if (detailsText) {
          answerDetails.innerHTML = detailsText.replace(/\n/g, '<br>');
        } else {
          answerDetails.innerHTML = '';
        }
      } else {
        answerHeadline.innerHTML = answerText;
        answerDetails.innerHTML = '';
      }
      
      answerCard.style.display = 'block';
      resultsArea.style.display = 'block';
      console.log('✅ Answer displayed');
    }
  }
  
  // Store current references for saving functionality
  currentReferences = Array.isArray(results.references?.chunks) ? results.references.chunks : [];
  
  // FIXED: Clear dashboard completely before rebuilding
  const dashboard = document.getElementById('dashboard');
  const dashboardFlow = document.getElementById('dashboardFlow');
  
  console.log('🚨 DEBUG: dashboard element:', dashboard);
  console.log('🚨 DEBUG: dashboardFlow element:', dashboardFlow);
  
  if (dashboardFlow) {
    dashboardFlow.innerHTML = ''; // CRITICAL: Clear all existing content
    console.log('🚨 DEBUG: Cleared dashboardFlow');
  } else {
    console.error('🚨 ERROR: dashboardFlow element not found!');
    return;
  }
  
  const themes = Array.isArray(results.supportingThemes) ? results.supportingThemes : [];
  console.log('🚨 DEBUG: Themes received:', themes.length, themes);

  if (themes.length) {
    // FIXED: Show ALL themes - don't filter by title duplication since server sends unique themes
    console.log(`🎯 DISPLAYING ${themes.length} themes received from server`);
    console.log('🎯 Themes data:', themes);
    
    themes.forEach((theme, index) => {
      console.log(`🎯 Processing theme ${index + 1}:`, theme.title);
      
      const layoutClass = determineLayoutClass(theme, index);
      console.log(`🎯 Layout class determined:`, layoutClass);
      
      const item = createDashboardItem(theme, layoutClass, index);
      console.log(`🎯 Dashboard item created:`, item);
      
      if (layoutClass === 'wide-chart') {
        console.log(`🎯 Adding wide chart to dashboardFlow`);
        dashboardFlow.appendChild(item);
      } else {
        const lastChild = dashboardFlow.lastElementChild;
        if (!lastChild || !lastChild.classList.contains('dashboard-row') || lastChild.children.length >= 2) {
          console.log(`🎯 Creating new row for item`);
          const rowDiv = document.createElement('div');
          rowDiv.className = 'dashboard-row';
          rowDiv.appendChild(item);
          dashboardFlow.appendChild(rowDiv);
        } else {
          console.log(`🎯 Adding to existing row`);
          lastChild.appendChild(item);
        }
      }
      
      console.log(`🎯 Theme ${index + 1} added to DOM`);
    });

  } else {
    const emptyItem = document.createElement('div');
    emptyItem.className = 'dashboard-item';
    emptyItem.innerHTML = `
      <div style="color:#6b7280;text-align:center;padding:40px;">
        Supporting findings will appear here when detected.
      </div>
    `;
    dashboardFlow.appendChild(emptyItem);
  }

  if (dashboard) {
    dashboard.style.display = 'block';
  }
  
  // FIXED: Remove any existing slides/reports sections before creating new ones
  removeExistingSections();
  
  // Add report slides section using CURRENT references only
  displayReportSlides();
  
  // Add reports referenced section  
  displayReportsReferenced(currentReferences);
  // === Attach overflow menus to answer & supporting cards ===
  try {
    initResponseMenus();
    const answer = document.getElementById('answerCard');
    if (answer) wrapAsResponseCard(answer, answer.getAttribute('data-response-id') || 'resp_answer');
    document.querySelectorAll(
      '#dashboardFlow .dashboard-item, #resultsArea .theme-card, #resultsArea .theme-item, .result-card, .supporting-card'
    ).forEach((el, i) => {
      wrapAsResponseCard(el, el.getAttribute('data-response-id') || ('resp_theme_' + i));
    });
    // Respect dismissed toggle
    const toggle = document.getElementById('toggleDismissed');
    const show = toggle && toggle.checked;
    document.querySelectorAll('.response-card').forEach(card=>{
      const id = deriveResponseIdFromCard(card);
      const dismissed = !!__dismissedMap[id];
      card.style.display = (!dismissed || show) ? '' : 'none';
      if (dismissed) card.classList.add('is-dismissed');
    });
    updateActiveReportBar();
  // Ensure menus attach to any newly created cards
  try { if (window.attachCardMenus) window.attachCardMenus(document); } catch(_){}
} catch (e) { console.warn('menu attach failed', e); }

}

// FIXED: Smart layout determination based on content
function determineLayoutClass(theme, index) {
  const hasChart = theme.chartData && theme.chartData.series && theme.chartData.series.length > 0;
  
  if (!hasChart) {
    return 'single'; // No chart = single column
  }
  
  const chartType = theme.chartData.type;
  const dataPointCount = theme.chartData.series.length;
  
  // Determine if chart needs full width
  const needsFullWidth = (
    (chartType === 'bar' && dataPointCount >= 5) || // Many bar chart items
    (chartType === 'line') || // Line charts usually need more space
    (index === 0 && chartType === 'bar') // First theme with bar chart (likely key metrics)
  );
  
  return needsFullWidth ? 'wide-chart' : 'single';
}

// FIXED: Create dashboard item with unique IDs and no duplication
function createDashboardItem(theme, layoutClass = '', index = 0) {
  try {
    console.log('🎨 Creating dashboard item:', theme.title, 'layoutClass:', layoutClass, 'index:', index);
    
    const item = document.createElement('div');
    item.className = `dashboard-item response-card ${layoutClass}`;
    
    // Add a visible background color to make it easy to spot for debugging
    item.style.border = '2px solid red'; // TEMPORARY DEBUG
    item.style.position = 'relative';
    item.style.padding = '16px';
    item.style.margin = '8px';
    item.style.backgroundColor = '#f9f9f9';
    
    console.log('🎨 Basic item element created');
    
    // FIXED: Ensure unique bullets by removing duplicates
    const bullets = Array.isArray(theme.bullets) ? 
      [...new Set(theme.bullets)].map(b => `<li>${formatRefsToSup(b)}</li>`).join('') : '';
    
    // Normalize quotes: extract quoted segment and infer speaker if missing; then allowlist
    const normalizedQuotes = (Array.isArray(theme.quotes) ? theme.quotes : [])
      .map(q => {
        const rawText = ((q && (q.text || q)) || '').toString().trim();
        let speaker = ((q && q.speaker) || '').toString().trim();
        let quotedText = '';
        if (/^\s*["“].+["”"]\s*$/.test(rawText)) {
          quotedText = rawText;
        } else {
          const m = rawText.match(/["“']([^"”']{3,})["”']/);
          if (m) quotedText = `“${m[1]}”`;
        }
        if (!speaker) {
          const sm = rawText.match(/—\s*([^—]{2,80})$/);
          if (sm) speaker = sm[1].trim();
        }
        const allowed = /(HCP|Patient|Caregiver|Respondent|Physician|Doctor|MD|DO|NP|Nurse|KOL|Specialist|Participant|Interviewee)/i;
        if (quotedText && speaker && allowed.test(speaker)) {
          return { text: quotedText, speaker };
        }
        return null;
      })
      .filter(Boolean)
      .slice(0, 2);
    
    const quotes = normalizedQuotes.map(q => 
      `<div class="quote-item">
        <div class="quote-text">${formatRefsToSup(q.text)}</div>
        <div class="quote-speaker">— ${q.speaker}</div>
      </div>`
    ).join('');

  // FIXED: Chart handling with guaranteed unique IDs
  let chartHtml = '';
  if (theme.chartData && Array.isArray(theme.chartData.series) && theme.chartData.series.length > 0) {
    const chartId = `chart-${Date.now()}-${index}-${Math.random().toString(36).substr(2, 9)}`;
    const containerClass = layoutClass === 'wide-chart' ? 'chart-container' : '';
    const chartHeight = layoutClass === 'wide-chart' ? '300px' : '220px';
    
    // Add clear chart title above the chart
    const chartTitle = theme.chartData.title || theme.title;
    
    chartHtml = `
      <div class="chart-wrapper ${containerClass}" style="margin: 16px 0; background: #f8f9fa; border-radius: 8px; padding: 16px; height: ${chartHeight};">
        <h5 style="margin: 0 0 12px 0; color: #333; font-size: 14px; font-weight: 600; text-align: center;">${chartTitle}</h5>
        <div id="${chartId}" style="position: relative; height: calc(100% - 32px); min-height: 160px;"></div>
      </div>
    `;
    
    // FIXED: Delay chart rendering to ensure DOM is ready and use unique timeout
    setTimeout(() => {
      try {
        console.log('🔧 Attempting to render chart:', chartId, 'Title:', chartTitle);
        const container = document.getElementById(chartId);
        if (!container) {
          console.error('🔧 Chart container not found:', chartId);
          return;
        }
        
        if (window.renderChart && typeof window.renderChart === 'function') {
          console.log('🔧 Calling window.renderChart');
          window.renderChart(chartId, theme.chartData);
        } else {
          console.warn('🔧 window.renderChart not available, showing fallback');
          container.innerHTML = '<p style="color: #666; text-align: center; padding: 20px;">Chart rendering unavailable</p>';
        }
      } catch (error) {
        console.error('🔧 Chart rendering failed for', chartId, ':', error);
        const container = document.getElementById(chartId);
        if (container) {
          container.innerHTML = '<p style="color: #666; text-align: center; padding: 20px;">Chart error: ' + error.message + '</p>';
        }
      }
    }, 500 + (index * 100)); // Increased delay and stagger
  }
  
  // Create the complete HTML structure
  const htmlContent = `
    <div class="card-header-with-menu" style="position: relative;">
      <h4 style="margin: 0;">${theme.title || 'Supporting Finding'}</h4>
      <div class="dropdown-container" style="position: absolute; top: 0; right: 0; background: blue; width: 40px; height: 30px;">
        <button class="three-dot-menu" onclick="showSaveMenu(this, 'theme')" aria-label="Options" style="background: yellow; padding: 8px;">
          <span class="dot" style="background: black; width: 3px; height: 3px; display: block; margin: 1px;"></span>
          <span class="dot" style="background: black; width: 3px; height: 3px; display: block; margin: 1px;"></span>
          <span class="dot" style="background: black; width: 3px; height: 3px; display: block; margin: 1px;"></span>
        </button>
        <div class="dropdown-menu" style="display: none; position: absolute; top: 100%; right: 0; background: white; border: 1px solid black; min-width: 120px;">
          <button onclick="addToReportFromDropdown('theme')" class="dropdown-item" style="display: block; width: 100%; text-align: left; padding: 8px;">
            <span class="dropdown-icon">📄</span>
            Add to Report
          </button>
          <button onclick="removeFromAnswer('theme')" class="dropdown-item" style="display: block; width: 100%; text-align: left; padding: 8px;">
            <span class="dropdown-icon">🗑️</span>
            Remove from Answer
          </button>
        </div>
      </div>
    </div>
    ${theme.subtitle ? `<p class="chart-description">${theme.subtitle}</p>` : ''}
    <div class="chart-content">
      ${chartHtml}
      ${bullets ? `<ul class="bullets">${bullets}</ul>` : ''}
      ${quotes ? `<div class="quote-section">${quotes}</div>` : ''}
    </div>
  `;
  
  console.log('🔍 HTML content being set:', htmlContent.substring(0, 200) + '...');
  item.innerHTML = htmlContent;
  
  // Verify the menu was actually inserted
  setTimeout(() => {
    const menu = item.querySelector('.three-dot-menu');
    const dropdownContainer = item.querySelector('.dropdown-container');
    console.log('🔍 After setting innerHTML:');
    console.log('  - three-dot-menu found:', !!menu);
    console.log('  - dropdown-container found:', !!dropdownContainer);
    if (dropdownContainer) {
      console.log('  - dropdown-container style:', dropdownContainer.style.cssText);
    }
    if (menu) {
      console.log('  - menu style:', menu.style.cssText);
    }
  }, 50);
  
    console.log('✅ Dashboard item HTML created for:', theme.title);
    
    return item;
    
  } catch (error) {
    console.error('🚨 ERROR creating dashboard item for', theme.title, ':', error);
    
    // Create a minimal fallback item
    const fallbackItem = document.createElement('div');
    fallbackItem.className = 'dashboard-item response-card';
    fallbackItem.style.border = '3px solid orange'; // Different color to indicate error
    fallbackItem.style.padding = '16px';
    fallbackItem.style.backgroundColor = '#ffe6cc';
    fallbackItem.innerHTML = `
      <div style="position: relative;">
        <h4 style="margin: 0; color: red;">ERROR: ${theme.title || 'Unknown Theme'}</h4>
        <div style="position: absolute; top: 0; right: 0;">
          <button style="background: red; color: white; padding: 4px 8px; border: none; border-radius: 4px;" onclick="console.log('Fallback menu clicked')">
            ⋯
          </button>
        </div>
        <p style="color: #666; font-size: 12px;">Error creating dashboard item: ${error.message}</p>
      </div>
    `;
    
    return fallbackItem;
  }
}

// FIXED: Helper function to remove existing sections
function removeExistingSections() {
  const existingSlides = document.getElementById('reportSlides');
  const existingReports = document.getElementById('reportsReferenced');
  if (existingSlides) existingSlides.remove();
  if (existingReports) existingReports.remove();
}

function clearPreviousResults() {
  const resultsArea = document.getElementById('resultsArea');
  if (resultsArea) {
    resultsArea.classList.add('clearing');
    
    setTimeout(() => {
      const answerCard = document.getElementById('answerCard');
      const dashboard = document.getElementById('dashboard');
      const dashboardFlow = document.getElementById('dashboardFlow');
      
      if (answerCard) answerCard.style.display = 'none';
      if (dashboard) dashboard.style.display = 'none';
      if (dashboardFlow) dashboardFlow.innerHTML = ''; // CRITICAL: Clear all content
      
      // Remove existing sections
      removeExistingSections();
      
      resultsArea.classList.remove('clearing');
    }, 300);
  }
}

// FIXED: Enhanced report slides display using ONLY current search results

function displayReportSlides() {
  const dashboard = document.getElementById('dashboard');

  const reportSlidesSection = document.createElement('div');
  reportSlidesSection.id = 'reportSlides';
  reportSlidesSection.className = 'report-slides-section';
  reportSlidesSection.innerHTML = `
    <h3 style="margin-bottom: 16px; color: var(--text-primary); font-size: 18px; font-weight: 600;">Related Report Slides</h3>
    <div class="report-slides-grid" id="reportSlidesGrid"></div>
  `;
  dashboard.after(reportSlidesSection);

  // Guard: require currentReferences from the live search result
  if (!Array.isArray(currentReferences) || currentReferences.length === 0) {
    document.getElementById('reportSlidesGrid').innerHTML =
      '<p style="color: var(--text-muted); text-align:center; padding: 40px;">No report slides available for this search.</p>';
    return;
  }

  const refs = currentReferences.slice();

  // Helper: fetch a small text signature to detect divider pages
  async function fetchTextSig(fileId, page) {
    try {
      const res = await fetch(`/secure-slide/text/${fileId}/${page}`);
      if (!res.ok) return null;
      return await res.json();
    } catch (_) {
      return null;
    }
  }

  function looksContent(sig) {
    if (!sig || !sig.ok) return false;
    const snippet = String(sig.snippet || '').toLowerCase();
    if (/(detailed findings|appendix|agenda|section|table of contents|toc|methodology|disclaimer|thank you|cover|divider)/i.test(snippet)) {
      return false;
    }
    return sig.hasDigits || sig.hasPercent || (Number(sig.length) || 0) >= 120;
  }

  async function snapToContent(fileId, page) {
    const candidates = [page, page + 1, page - 1, page + 2, page - 2].filter(p => p > 1);
    for (const p of candidates) {
      const sig = await fetchTextSig(fileId, p);
      if (looksContent(sig)) return p;
    }
    return null;
  }

  (async () => {
    const grid = document.getElementById('reportSlidesGrid');
    grid.innerHTML = '';

    const seen = new Set();
    const cards = [];

    for (const r of refs) {
      if (cards.length >= 6) break;
      const fileId = r.fileId || r.driveId || r.gdocId || null;
      const rawPage = Number(r.page || r.pageNumber || r.page_index || r.pageIndex);
      if (!fileId || !Number.isFinite(rawPage) || rawPage <= 1) continue;

      const goodPage = await snapToContent(fileId, rawPage);
      if (!goodPage) continue;

      const key = `${fileId}::${goodPage}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const title = (r.fileName || r.title || 'Report slide').replace(/\.(pdf|docx?|pptx?)$/i, '');
      const date = (r.monthTag ? (r.monthTag + ' ') : '') + (r.yearTag || r.year || '');

      const card = document.createElement('div');
      card.className = 'report-slide-card';
      card.setAttribute('data-file-id', fileId);
      card.setAttribute('data-page', String(goodPage));
      card.innerHTML = `
        <div class="report-slide-preview">
          <img alt="Slide preview" loading="lazy" decoding="async" src="/secure-slide/${fileId}/${goodPage}">
        </div>
        <div class="report-slide-content">
          <div class="report-slide-title">${title}</div>
          <div class="report-slide-subtitle">${date || ''}</div>
          <div class="report-slide-page">Slide ${goodPage}</div>
        </div>
      `;
      cards.push(card);
    }

    if (!cards.length) {
      grid.innerHTML = '<p style="color: var(--text-muted); text-align:center; padding: 40px;">No report slides available for this search.</p>';
      return;
    }

    cards.forEach(card => grid.appendChild(card));
  })();
}


function displayReportsReferenced(references) {
  const reportSlidesSection = document.getElementById('reportSlides');
  
  const reportsSection = document.createElement('div');
  reportsSection.id = 'reportsReferenced';
  reportsSection.style.cssText = `
    margin-top: 40px;
    border-top: 2px solid var(--border);
    padding-top: 24px;
  `;
  
  reportsSection.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: space-between; cursor: pointer; padding: 12px 0; user-select: none;" onclick="toggleReportsReferenced()">
      <h3 style="margin: 0; font-size: 18px; font-weight: 600; color: var(--text-primary);">Reports Referenced</h3>
      <span style="font-size: 16px; color: var(--text-muted);">▼</span>
    </div>
    <div id="reportsReferencedContent" style="max-height: 500px; overflow-y: auto; margin-top: 16px;">
      <!-- Report references will be populated here -->
    </div>
  `;
  
  reportSlidesSection.after(reportsSection);
  
  const content = document.getElementById('reportsReferencedContent');
  
  if (!references || !references.length) {
    content.innerHTML = '<p style="color: var(--text-muted);">No references found for this search.</p>';
    return;
  }

  references.forEach((ref, index) => {
    const refDiv = document.createElement('div');
    refDiv.style.cssText = `
      background: var(--white);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 12px;
      display: flex;
      align-items: flex-start;
      gap: 12px;
    `;
    
    refDiv.innerHTML = `
      <div style="background: var(--jaice-orange); color: white; font-size: 12px; font-weight: 700; padding: 6px 10px; border-radius: 50%; min-width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
        ${index + 1}
      </div>
      <div style="flex: 1;">
        <div style="font-weight: 600; font-size: 15px; color: var(--text-primary); margin-bottom: 8px; line-height: 1.3;">
          ${ref.fileName || ref.title || 'Reference Document'}
        </div>
        <div style="display: flex; flex-wrap: wrap; gap: 16px; font-size: 13px; color: var(--text-muted);">
          <span><strong>Source:</strong> ${ref.source || 'Unknown'}</span>
          ${ref.page ? `<span><strong>Page:</strong> ${ref.page}</span>` : ''}
        </div>
      </div>
    `;
    
    content.appendChild(refDiv);
  });
}

// Utility functions
function formatRefsToSup(text){
  const s = String(text ?? "");
  return s
    .replace(/\s?\[(\d+(?:\s*,\s*\d+)*)\]/g, (_,m)=>`<sup>${m.replace(/\s+/g,'')}</sup>`)
    .replace(/\((\d+(?:\s*,\s*\d+)*)\)/g,  (_,m)=>`<sup>${m.replace(/\s+/g,'')}</sup>`)
    .replace(/&lt;(\d+(?:\s*,\s*\d+)*)&gt;/g, (_,m)=>`<sup>${m.replace(/\s+/g,'')}</sup>`);
}

function toggleReportsReferenced() {
  const content = document.getElementById('reportsReferencedContent');
  const toggle = document.querySelector('#reportsReferenced span');
  
  if (content.style.display === 'none') {
    content.style.display = 'block';
    toggle.textContent = '▼';
  } else {
    content.style.display = 'none'; 
    toggle.textContent = '▶';
  }
}

// Add missing dropdown action functions  
function addToReportFromDropdown(type) {
  console.log('Add to Report clicked for:', type);
  
  // Find the active dropdown menu's parent card
  const activeDropdown = document.querySelector('.dropdown-menu.show');
  const card = activeDropdown ? 
    activeDropdown.closest('.answer-card, .theme-card, .dashboard-item') : 
    document.querySelector('.answer-card, .theme-card, .dashboard-item');
    
  if (!card) {
    console.warn('Could not find card to save');
    return;
  }
  
  const title = card.querySelector('h4, h3, .answer-headline')?.textContent || 'Untitled';
  
  // Hide the dropdown
  const dropdown = card.querySelector('.dropdown-menu');
  if (dropdown) dropdown.classList.remove('show');
  
  // Trigger the jaice-fixes modal
  if (typeof openReportModal === 'function') {
    openReportModal(card);
  } else {
    alert(`Saving "${title}" to report...`);
  }
}

function removeFromAnswer(type) {
  console.log('Remove from Answer clicked for:', type);
  
  // Find the active dropdown menu's parent card
  const activeDropdown = document.querySelector('.dropdown-menu.show');
  const card = activeDropdown ? 
    activeDropdown.closest('.answer-card, .theme-card, .dashboard-item') : 
    null;
    
  if (!card) {
    console.warn('Could not find card to remove');
    return;
  }
  
  // Hide the dropdown first
  const dropdown = card.querySelector('.dropdown-menu');
  if (dropdown) dropdown.classList.remove('show');
  
  // Add fade out animation and remove
  card.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
  card.style.opacity = '0';
  card.style.transform = 'translateY(-20px)';
  
  setTimeout(() => {
    card.remove();
  }, 300);
}

function handleExport(element) {
  console.log('Export clicked for:', element);
  
  // Get the card content for export
  const card = element.closest('.answer-card, .theme-card, .dashboard-item');
  const title = card.querySelector('h4, h3')?.textContent || 'Untitled';
  const content = card.querySelector('.answer-text, .theme-summary, .chart-content')?.textContent || '';
  
  // Hide the dropdown
  const dropdown = card.querySelector('.dropdown-menu');
  if (dropdown) dropdown.classList.remove('show');
  
  // Create and download a simple text file
  const exportContent = `${title}\n${'='.repeat(title.length)}\n\n${content}`;
  const blob = new Blob([exportContent], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = `${title.replace(/[^a-zA-Z0-9]/g, '_')}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  console.log('Exported:', title);
}

// Add functions that match the HTML onclick handlers
function saveToReport(contentType) {
  console.log('saveToReport called with:', contentType);
  
  // Find the nearest card element
  let card;
  if (contentType === 'answer') {
    card = document.getElementById('answerCard');
  } else {
    // For theme cards, find the active dropdown
    const activeDropdown = document.querySelector('.dropdown-menu.show');
    if (activeDropdown) {
      card = activeDropdown.closest('.answer-card, .theme-card, .dashboard-item');
    }
  }
  
  if (card) {
    const title = card.querySelector('h4, h3, .answer-headline')?.textContent || 'Untitled';
    const content = card.querySelector('.answer-text, .theme-summary, .chart-content, .answer-details')?.textContent || '';
    
    // Hide the dropdown
    const dropdown = card.querySelector('.dropdown-menu');
    if (dropdown) dropdown.classList.remove('show');
    
    alert(`Saving "${title}" to report...`);
    console.log('Content to save:', { title, content });
  }
}

function exportContent(contentType) {
  console.log('exportContent called with:', contentType);
  
  // Find the nearest card element
  let card;
  if (contentType === 'answer') {
    card = document.getElementById('answerCard');
  } else {
    // For theme cards, find the active dropdown
    const activeDropdown = document.querySelector('.dropdown-menu.show');
    if (activeDropdown) {
      card = activeDropdown.closest('.answer-card, .theme-card, .dashboard-item');
    }
  }
  
  if (card) {
    const title = card.querySelector('h4, h3, .answer-headline')?.textContent || 'Untitled';
    const content = card.querySelector('.answer-text, .theme-summary, .chart-content, .answer-details')?.textContent || '';
    
    // Hide the dropdown
    const dropdown = card.querySelector('.dropdown-menu');
    if (dropdown) dropdown.classList.remove('show');
    
    // Create and download a simple text file
    const exportContent = `${title}\n${'='.repeat(title.length)}\n\n${content}`;
    const blob = new Blob([exportContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.replace(/[^a-zA-Z0-9]/g, '_')}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    console.log('Exported:', title);
  }
}

// Make functions globally accessible
window.showSaveMenu = showSaveMenu;
window.handleSaveToReport = handleSaveToReport;
window.handleExport = handleExport;
window.saveToReport = saveToReport;
window.exportContent = exportContent;
window.addToReportFromDropdown = addToReportFromDropdown;
window.removeFromAnswer = removeFromAnswer;
window.toggleReportsReferenced = toggleReportsReferenced;

// DOM Ready Event
console.log('🎯 Setting up DOM ready listener...');

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    console.log('📄 DOM Content Loaded');
    initializeApp(); renderActiveReportBar && renderActiveReportBar();
  });
} else {
  console.log('📄 DOM already ready, initializing immediately');
  initializeApp(); renderActiveReportBar && renderActiveReportBar();
}

console.log('✅ app.js loaded successfully');

// ===== UI Guards: single-source-of-truth for charts =====
function pickOneChart(charts){
  if (!Array.isArray(charts)) return charts;
  // Prefer canonicalized pie marked as _preferred, else first pie, else first chart.
  const preferred = charts.find(c=>c && c._preferred);
  if (preferred) return preferred;
  const pie = charts.find(c=>c && c.type==='pie');
  return pie || charts[0];
}

// Patch any renderChart usage
(function(){
  const _render = window.renderChart;
  if (typeof _render === 'function'){
    window.renderChart = function(containerId, chartData){
      if (Array.isArray(chartData)) chartData = pickOneChart(chartData);
      return _render(containerId, chartData);
    }
  }
})();


// ===== Render dynamic dashboard from structured payload =====
function h(tag, attrs={}, children=[]){
  const el = document.createElement(tag);
  for (const k in attrs){ if(attrs[k]!=null) el.setAttribute(k, attrs[k]); }
  if (typeof children === 'string'){ el.innerHTML = children; } else { children.forEach(c=> el.appendChild(c)); }
  return el;
}

function renderDashboard(dash){
  const root = document.getElementById('dash-root');
  if (!root) return;
  root.innerHTML='';
  if (!dash) return;

  // Snapshot (charts disabled)
  if (dash.snapshot && dash.snapshot.labels && dash.snapshot.values){
    const card = h('div', {class:'dash-card'} , [
      h('div', {class:'card-h'}, [document.createTextNode('Current Market Share' + (dash.snapshot.asOf? ' ('+dash.snapshot.asOf+')':''))]),
      h('div', {class:'card-b'}, [h('div', {}, dash.snapshot.labels.map((L,i)=> h('div', {class:'row'}, [document.createTextNode(L + ': ' + dash.snapshot.values[i] + '%')])) )])
    ]);
    root.appendChild(card);
  }

  renderTrend(root, dash);

  // Drivers (charts disabled)
  if (dash.drivers && dash.drivers.items && dash.drivers.items.length){
    const card = h('div', {class:'dash-card'} , [
      h('div', {class:'card-h'}, [document.createTextNode('Key Drivers of Choice')]),
      h('div', {class:'card-b'}, [h('ul', {}, dash.drivers.items.map(x=> h('li', {}, [document.createTextNode(x.label + ': ' + x.value)])))])
    ]);
    root.appendChild(card);
  }

  // Quotes
  if (dash.quotes && dash.quotes.length){
    const card = h('div', {class:'dash-card'}, [
      h('div', {class:'card-h'}, [document.createTextNode('HCP/Patient Quotes')]),
      h('div', {class:'card-b'}, [h('div', {}, dash.quotes.map(q=> h('div', {class:'quote'}, [document.createTextNode('“'+q.text+'” — '+q.speaker)]))) ])
    ]);
    root.appendChild(card);
  }

  // Reports
  if (dash.reports && dash.reports.length){
    const card = h('div', {class:'dash-card'}, [
      h('div', {class:'card-h'}, [document.createTextNode('Supporting Reports')]),
      h('div', {class:'card-b'}, [h('div', {}, dash.reports.map(r=> h('a', {class:'report-item', href: (r.preview||'#'), target:'_blank', rel:'noopener'}, [ (r.thumbnail? h('img',{src:r.thumbnail, style:'width:44px;height:44px;border-radius:8px;object-fit:cover;margin-right:10px'},[]): h('div',{style:'width:44px;height:44px;border-radius:8px;background:#e5e7eb;margin-right:10px'},[])), h('div',{},[document.createTextNode(r.study||r.source||'Document'), h('div',{class:'small'},[document.createTextNode(r.date||'')]) ]) ]))) ])
    ]);
    root.appendChild(card);
  }
}

// Hook search response to render dashboard
;(function(){
  const _fetch = window.fetch;
  window.fetch = async function(input, init){
    const res = await _fetch(input, init);
    try{
      if (typeof input === 'string' && input.includes('/search')){
        const clone = res.clone();
        const data = await clone.json().catch(()=>null);
        if (data && data.dashboard){ renderDashboard(data.dashboard); }
      }
    }catch(e){ /* no-op */ }
    return res;
  }
})();

// Trend card renderer
function renderTrend(root, dash){
  if (!dash.trend || !dash.trend.series || !dash.trend.timepoints) return;
  const card = h('div', {class:'dash-card'}, [
    h('div', {class:'card-h'}, [document.createTextNode('Market Share Trend')]),
    h('div', {class:'card-b'}, [h('div', {}, (dash.trend.series||[]).map(s=> h('div', {}, [document.createTextNode(s.label + ': ' + (s.values||[]).join(', '))])))])
  ]);
  root.appendChild(card);
  // charts disabled
}


// Use color map from dashboard.snapshot if available to keep label colors consistent with source reports
function applyColorMap(labels, defaultColors, colorMap){
  if (!labels) return defaultColors;
  return labels.map((L, i)=> (colorMap && colorMap[L]) ? colorMap[L] : (defaultColors ? defaultColors[i] : undefined));
}

/* == JAICE enhancements == */
window.__JAICE_ENH=1;

// Define helper functions
const $jaice_$ = (s,r=document)=>r.querySelector(s);
const $jaice_$$ = (s,r=document)=>Array.from(r.querySelectorAll(s));


/* == JAICE enhancements (full) == */
(function(){
  window.jaice_$ = window.jaice_$ || ((s,r=document)=>r.querySelector(s));
  window.jaice_$$ = window.jaice_$$ || ((s,r=document)=>Array.from(r.querySelectorAll(s)));

  // ---- Search Recommendations ----
  async function fetchRecos(clientLibraryId){
    try{
      const r = await fetch(`/recos/${encodeURIComponent(clientLibraryId)}`);
      const j = await r.json();
      return j.ok ? (j.items||[]) : [];
    }catch(_){ return []; }
  }
  window.attachSearchRecos = async function(lib){
    const box = jaice_$('#searchInput'); if(!box) return;
    let wrap = document.getElementById('searchRecos');
    if(!wrap){
      wrap = document.createElement('div');
      wrap.id = 'searchRecos';
      wrap.className = 'recos-wrap';
      box.parentElement.appendChild(wrap);
    }
    wrap.innerHTML = '';
    const recos = await fetchRecos(lib||'default');
    const seeds = recos.length ? recos : [
      "What did patients say about access barriers?",
      "Show last quarter's ATU highlights",
      "Which MOA claims index highest?"
    ];
    for(const txt of seeds){
      const b=document.createElement('button');
      b.className='chip';
      b.textContent=txt;
      b.addEventListener('click',()=>{ box.value=txt; wrap.style.display='none'; box.focus(); });
      wrap.appendChild(b);
    }
    box.addEventListener('focus', ()=> wrap.style.display='block');
    box.addEventListener('blur', ()=> setTimeout(()=>wrap.style.display='none', 150));
  };

  // ---- Study Details on Report References ----
  async function fetchReportMeta(fileId){
    try{ const r = await fetch(`/report-metadata/${encodeURIComponent(fileId)}`); return await r.json(); }
    catch(e){ return { ok:false, error:String(e) }; }
  }
  window.attachStudyDetails = function(container){
    if(!container) return;
    $jaice_$('.report-ref', container).forEach(ref=>{
      if (ref.dataset.studyInit==='1') return;
      ref.dataset.studyInit='1';
      const fileId = ref.dataset.fileId || ref.getAttribute('data-file-id') || '';
      const btn = document.createElement('button');
      btn.className = 'link study-details-link';
      btn.textContent = 'Study details';
      const drop = document.createElement('div');
      drop.className = 'study-drop';
      drop.style.display = 'none';
      drop.innerHTML = '<div class="skeleton" style="height:16px;width:40%"></div>';
      btn.addEventListener('click', async()=>{
        drop.style.display = drop.style.display==='none' ? 'block' : 'none';
        if (drop.dataset.loaded==='1') return;
        const meta = await fetchReportMeta(fileId);
        if (!meta || !meta.ok){ drop.innerHTML='<div class="empty">Could not extract details</div>'; return; }
        const obj = Array.isArray(meta.objectives)? meta.objectives : [];
        const fw = meta.fieldwork||{};
        const dates = (fw.start&&fw.end) ? (fw.start+'–'+fw.end) : (fw.start||fw.end||'—');
        drop.innerHTML = `
          <div class="study-sec">
            <div class="study-h">Objectives</div>
            <ul class="study-list">${obj.map(x=>`<li>${x}</li>`).join('')}</ul>
          </div>
          <div class="study-sec">
            <div class="study-h">Sample</div>
            <div class="study-t">${String(meta.sample||'').replace(/</g,'&lt;')}</div>
          </div>
          <div class="study-sec">
            <div class="study-h">Fieldwork</div>
            <div class="study-t">${dates}</div>
          </div>`;
        drop.dataset.loaded='1';
      });
      const row = document.createElement('div');
      row.className = 'report-meta-row';
      row.appendChild(btn);
      ref.appendChild(row);
      ref.appendChild(drop);
    });
  };

  // ---- Filters auto-linking ----
  window.applyThinkingPreset = function(level){
    const charts = document.getElementById('includeCharts');
    const quotes = document.getElementById('quotesLevel');
    if (!charts || !quotes) return;
    if (level==='Detailed'){ charts.checked=true; quotes.value='many'; window.topkSelected=50; }
    else if (level==='Concise'){ charts.checked=false; quotes.value='none'; window.topkSelected=10; }
    else { charts.checked=true; quotes.value='moderate'; window.topkSelected=30; }
  };

  // ---- Related Slides skeletons ----
  window.renderRelatedSlidesSkeleton = function(target, n=8){
    if(!target) return; target.innerHTML='';
    for(let i=0;i<n;i++){ const sk=document.createElement('div'); sk.className='tile skeleton-tile'; target.appendChild(sk); }
  };

  // ---- Three-dot menus on answer cards ----
  
  window.attachCardMenus = function(root=document){
    try {
      const cards = Array.from(root.querySelectorAll('.response-card, .answer-card, .dashboard-item, .result-card, .supporting-card, .theme-card'));
      cards.forEach(card => {
        if (card.dataset.menuInit === '1') return;
        card.dataset.menuInit = '1';
        const hasChart = !!card.querySelector('canvas');
        const btn = document.createElement('button');
        btn.className = 'response-menu-button';
        btn.textContent = '⋯';
        const menu = document.createElement('div');
        menu.className = 'response-menu';
        function addItem(label, cb){
          const b = document.createElement('button');
          b.textContent = label;
          b.addEventListener('click', (e)=>{ e.stopPropagation(); try{ cb(); }finally{ menu.style.display='none'; } });
          menu.appendChild(b);
        }
        addItem('Add to report', ()=>{ const ev=new CustomEvent('report:add',{bubbles:true,detail:{source:'menu',card}}); card.dispatchEvent(ev); try{ toast('Added to report'); }catch(_){} });
        addItem('Remove from response', ()=> card.remove());
        if (hasChart) addItem('Change chart type', ()=>{ try{ const cv = card.querySelector('canvas'); const ch = window.__chartInstances?.get(cv); const t = (ch?.config?.type==='bar'?'line':'bar'); if (ch){ ch.config.type=t; ch.update(); } }catch(_){ } });
        btn.addEventListener('click', (e)=>{ e.stopPropagation(); menu.style.display = menu.style.display === 'block' ? 'none':'block'; const r = btn.getBoundingClientRect(); menu.style.position='absolute'; menu.style.top = (btn.offsetTop+24)+'px'; menu.style.right='16px'; });
        document.addEventListener('click', ()=> menu.style.display='none');
        // Append if not already present
        if (!card.querySelector('.response-menu-button')) card.appendChild(btn);
        if (!card.querySelector('.response-menu')) card.appendChild(menu);
      });
    } catch (e) {
      console.warn('attachCardMenus failed', e);
    }
  };
    

  // ---- Boot hooks ----
  window.addEventListener('load', ()=>{
    try {
      const libSel = document.getElementById('clientSelect');
      const lib = (libSel && libSel.value) || 'default';
      attachSearchRecos(lib);
    } catch(_){}
    try {
      const rr = document.getElementById('relatedSlides');
      if (rr) renderRelatedSlidesSkeleton(rr, 8);
      attachStudyDetails(document.getElementById('reportsReferencedContent'));
      attachCardMenus(document);
    } catch(_){}
  });
})();

// Navigation handling to prevent clearing on reports page
document.addEventListener('click', (e) => {
  if (e.target.tagName === 'A' && e.target.href && e.target.href.includes('/reports.html')) {
    // Don't clear results when going to reports page
    e.preventDefault();
    window.location.href = e.target.href;
    return;
  }
});

// Preserve search results when navigating
const preserveSearchResults = () => {
  const resultsArea = document.querySelector('.results-area');
  const dashboard = document.querySelector('.dashboard');
  
  if (resultsArea && resultsArea.style.display !== 'none') {
    sessionStorage.setItem('preserved_search_results', resultsArea.outerHTML);
  }
  if (dashboard && dashboard.innerHTML.trim()) {
    sessionStorage.setItem('preserved_dashboard', dashboard.outerHTML);
  }
};

// Restore search results when coming back
const restoreSearchResults = () => {
  const preservedResults = sessionStorage.getItem('preserved_search_results');
  const preservedDashboard = sessionStorage.getItem('preserved_dashboard');
  
  if (preservedResults && window.location.pathname === '/') {
    const container = document.querySelector('.content');
    if (container) {
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = preservedResults;
      const resultsArea = tempDiv.querySelector('.results-area');
      
      if (resultsArea) {
        // Remove existing results area if any
        const existing = container.querySelector('.results-area');
        if (existing) existing.remove();
        
        // Add preserved results
        container.appendChild(resultsArea);
        resultsArea.style.display = 'block';
      }
    }
  }
};

// Save results before navigation and restore on page load
window.addEventListener('beforeunload', preserveSearchResults);

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', restoreSearchResults);
} else {
  restoreSearchResults();
}
// Add to Report functionality with report selection
function addToReport(type) {
  const card = document.querySelector('.answer-card, .theme-card, .dashboard-item');
  if (!card) return;
  
  // Get card content
  const title = card.querySelector('.answer-headline, h4, h3')?.textContent || 'Untitled';
  const content = card.outerHTML; // Get the entire card HTML for exact formatting
  
  // Hide dropdown
  const dropdown = card.querySelector('.dropdown-menu');
  if (dropdown) dropdown.classList.remove('show');
  
  // Show report selection modal
  showReportSelectionModal(title, content);
}

function removeFromAnswer(type) {
  const card = document.querySelector('.answer-card, .theme-card, .dashboard-item');
  if (!card) return;
  
  // Hide dropdown
  const dropdown = card.querySelector('.dropdown-menu');
  if (dropdown) dropdown.classList.remove('show');
  
  // Remove the card with animation
  card.style.transition = 'opacity 0.3s ease-out, transform 0.3s ease-out';
  card.style.opacity = '0';
  card.style.transform = 'translateY(-20px)';
  
  setTimeout(() => {
    card.remove();
  }, 300);
}

function showReportSelectionModal(title, content) {
  // Create modal overlay
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  `;
  
  // Create modal content
  const modal = document.createElement('div');
  modal.className = 'report-selection-modal';
  modal.style.cssText = `
    background: white;
    border-radius: 12px;
    padding: 24px;
    max-width: 400px;
    width: 90%;
    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.2);
  `;
  
  modal.innerHTML = `
    <h3 style="margin: 0 0 16px 0; font-size: 18px; font-weight: 600;">Add to Report</h3>
    <div style="margin-bottom: 16px;">
      <button id="createNewReport" style="
        width: 100%;
        padding: 12px;
        border: 2px solid var(--jaice-orange);
        background: var(--jaice-orange);
        color: white;
        border-radius: 8px;
        font-weight: 500;
        margin-bottom: 12px;
        cursor: pointer;
      ">+ Create New Report</button>
    </div>
    <div id="existingReports" style="max-height: 200px; overflow-y: auto;">
      <p style="color: #666; font-size: 14px; margin: 0;">Loading existing reports...</p>
    </div>
    <div style="display: flex; gap: 8px; margin-top: 16px;">
      <button id="cancelModal" style="
        flex: 1;
        padding: 10px;
        border: 1px solid #ddd;
        background: white;
        border-radius: 6px;
        cursor: pointer;
      ">Cancel</button>
    </div>
  `;
  
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  
  // Load existing reports
  loadExistingReports(content, title);
  
  // Event listeners
  document.getElementById('createNewReport').onclick = () => {
    createNewReportWithContent(title, content);
    document.body.removeChild(overlay);
  };
  
  document.getElementById('cancelModal').onclick = () => {
    document.body.removeChild(overlay);
  };
  
  overlay.onclick = (e) => {
    if (e.target === overlay) {
      document.body.removeChild(overlay);
    }
  };
}

function loadExistingReports(content, title) {
  fetch('/api/reports')
    .then(response => response.json())
    .then(reports => {
      const container = document.getElementById('existingReports');
      if (reports.length === 0) {
        container.innerHTML = '<p style="color: #666; font-size: 14px; margin: 0;">No existing reports found.</p>';
        return;
      }
      
      container.innerHTML = reports.map(report => `
        <button onclick="addToExistingReport('${report.id}', \`${content.replace(/`/g, '\\`')}\`, '${title}')" style="
          width: 100%;
          padding: 10px;
          border: 1px solid #ddd;
          background: white;
          border-radius: 6px;
          text-align: left;
          margin-bottom: 8px;
          cursor: pointer;
          transition: background-color 0.2s;
        " onmouseover="this.style.backgroundColor='#f5f5f5'" onmouseout="this.style.backgroundColor='white'">
          <div style="font-weight: 500;">${report.title}</div>
          <div style="font-size: 12px; color: #666;">${report.items?.length || 0} items</div>
        </button>
      `).join('');
    })
    .catch(error => {
      console.error('Error loading reports:', error);
      document.getElementById('existingReports').innerHTML = '<p style="color: #666; font-size: 14px; margin: 0;">Error loading reports.</p>';
    });
}

function createNewReportWithContent(title, content) {
  const reportTitle = prompt('Enter report title:');
  if (!reportTitle) return;
  
  const reportData = {
    title: reportTitle,
    description: '',
    items: [{
      title: title,
      html: content,
      timestamp: new Date().toISOString()
    }]
  };
  
  fetch('/api/reports', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(reportData)
  })
  .then(response => response.json())
  .then(result => {
    if (result.success) {
      alert('Added to new report successfully!');
    } else {
      alert('Error creating report: ' + result.error);
    }
  })
  .catch(error => {
    console.error('Error creating report:', error);
    alert('Error creating report');
  });
}

function addToExistingReport(reportId, content, title) {
  fetch(`/api/reports/${reportId}/items`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      title: title,
      html: content,
      timestamp: new Date().toISOString()
    })
  })
  .then(response => response.json())
  .then(result => {
    if (result.success) {
      alert('Added to report successfully!');
      // Close modal
      const overlay = document.querySelector('.modal-overlay');
      if (overlay) document.body.removeChild(overlay);
    } else {
      alert('Error adding to report: ' + result.error);
    }
  })
  .catch(error => {
    console.error('Error adding to report:', error);
    alert('Error adding to report');
  });
}
