// Debug and fix JAICE enhancements
console.log('🔧 Debug: Checking JAICE elements...');

// 1. Add ID to search input if missing
const searchInput = document.querySelector('.search-input');
if (searchInput && !searchInput.id) {
  searchInput.id = 'searchInput';
  console.log('✅ Added ID to search input');
}

// 2. Create search recommendations container if missing
if (!document.getElementById('searchRecommendations')) {
  const searchContainer = document.querySelector('.search-container');
  if (searchContainer) {
    const recoContainer = document.createElement('div');
    recoContainer.id = 'searchRecommendations';
    recoContainer.style.display = 'none';
    recoContainer.style.marginTop = '8px';
    searchContainer.appendChild(recoContainer);
    console.log('✅ Created search recommendations container');
  }
}

// 3. Create related slides container if missing
if (!document.getElementById('relatedSlides')) {
  const resultsArea = document.querySelector('.results-area');
  if (resultsArea) {
    const relatedContainer = document.createElement('div');
    relatedContainer.id = 'relatedSlides';
    relatedContainer.innerHTML = '<h3>Related Slides</h3><div class="slides-grid"></div>';
    resultsArea.appendChild(relatedContainer);
    console.log('✅ Created related slides container');
  }
}

// 4. Initialize JAICE features
setTimeout(() => {
  console.log('🚀 Initializing JAICE features...');
  
  // Attach search recommendations
  if (window.attachSearchRecos && searchInput) {
    const clientSelect = document.getElementById('clientSelect');
    const lib = (clientSelect && clientSelect.value) || 'default';
    window.attachSearchRecos(lib);
    console.log('✅ Search recommendations initialized');
    
    // Show recommendations on focus
    searchInput.addEventListener('focus', () => {
      const recoContainer = document.getElementById('searchRecommendations');
      if (recoContainer) {
        recoContainer.style.display = 'block';
        recoContainer.innerHTML = `
          <div style="display: flex; gap: 8px; flex-wrap: wrap; padding: 8px 0;">
            <span class="reco-chip" onclick="document.getElementById('searchInput').value='market trends'; document.getElementById('searchInput').focus();">market trends</span>
            <span class="reco-chip" onclick="document.getElementById('searchInput').value='customer satisfaction'; document.getElementById('searchInput').focus();">customer satisfaction</span>
            <span class="reco-chip" onclick="document.getElementById('searchInput').value='product performance'; document.getElementById('searchInput').focus();">product performance</span>
            <span class="reco-chip" onclick="document.getElementById('searchInput').value='competitive analysis'; document.getElementById('searchInput').focus();">competitive analysis</span>
          </div>
        `;
      }
    });
  }
  
  // Attach study details
  if (window.attachStudyDetails) {
    window.attachStudyDetails(document.getElementById('reportsReferencedContent'));
    console.log('✅ Study details initialized');
  }
  
  // Attach card menus
  if (window.attachCardMenus) {
    window.attachCardMenus(document);
    console.log('✅ Card menus initialized');
  }
}, 1000);

// 5. Add CSS for recommendations
const style = document.createElement('style');
style.textContent = `
  .reco-chip {
    display: inline-block;
    background: #f0f0f0;
    border: 1px solid #ddd;
    border-radius: 16px;
    padding: 4px 12px;
    font-size: 14px;
    cursor: pointer;
    transition: all 0.2s ease;
  }
  .reco-chip:hover {
    background: #D14829;
    color: white;
    border-color: #D14829;
  }
  .study-details-link {
    background: none;
    border: none;
    color: #D14829;
    text-decoration: underline;
    cursor: pointer;
    font-size: 12px;
    margin-left: 8px;
  }
  .study-drop {
    background: #f8f9fa;
    border: 1px solid #ddd;
    border-radius: 8px;
    padding: 12px;
    margin-top: 8px;
  }
  .response-menu-button {
    position: absolute;
    top: 8px;
    right: 8px;
    background: rgba(255,255,255,0.9);
    border: 1px solid #ddd;
    border-radius: 4px;
    padding: 4px 8px;
    cursor: pointer;
    font-size: 18px;
  }
  .response-menu {
    position: absolute;
    top: 32px;
    right: 8px;
    background: white;
    border: 1px solid #ddd;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    display: none;
    z-index: 1000;
  }
  .response-menu-item {
    display: block;
    width: 100%;
    padding: 8px 16px;
    border: none;
    background: none;
    text-align: left;
    cursor: pointer;
    font-size: 14px;
  }
  .response-menu-item:hover {
    background: #f0f0f0;
  }
`;
document.head.appendChild(style);

console.log('🎉 JAICE debug fix applied!');