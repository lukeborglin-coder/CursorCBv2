// Emergency fix for showSaveMenu function
console.log('🔧 Loading showSaveMenu fix...');

function showSaveMenu(button, contentType) {
  console.log('showSaveMenu called with:', contentType);
  
  // Remove existing menu if present
  const existingMenu = document.querySelector('.save-menu');
  if (existingMenu) {
    existingMenu.remove();
  }
  
  // Create menu element
  const menu = document.createElement('div');
  menu.className = 'save-menu';
  menu.style.cssText = `
    position: absolute;
    top: 100%;
    right: 0;
    background: white;
    border: 1px solid #e1e5e9;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    z-index: 1000;
    min-width: 150px;
    padding: 8px 0;
  `;
  
  // Add menu items
  const items = [
    { text: '💾 Save to Notes', action: () => saveToNotes(contentType) },
    { text: '📋 Copy to Clipboard', action: () => copyToClipboard(contentType) },
    { text: '📧 Share via Email', action: () => shareViaEmail(contentType) },
    { text: '⬇️ Download PDF', action: () => downloadPDF(contentType) }
  ];
  
  items.forEach(item => {
    const menuItem = document.createElement('div');
    menuItem.textContent = item.text;
    menuItem.style.cssText = `
      padding: 8px 16px;
      cursor: pointer;
      transition: background 0.2s;
    `;
    menuItem.onmouseover = () => menuItem.style.background = '#f5f5f5';
    menuItem.onmouseout = () => menuItem.style.background = 'white';
    menuItem.onclick = () => {
      item.action();
      menu.remove();
    };
    menu.appendChild(menuItem);
  });
  
  // Position menu relative to button
  const buttonRect = button.getBoundingClientRect();
  const container = button.closest('.search-result') || button.parentElement;
  
  if (container) {
    container.style.position = 'relative';
    container.appendChild(menu);
  }
  
  // Close menu when clicking outside
  setTimeout(() => {
    document.addEventListener('click', function closeMenu(e) {
      if (!menu.contains(e.target) && e.target !== button) {
        menu.remove();
        document.removeEventListener('click', closeMenu);
      }
    });
  }, 100);
}

// Helper functions
function saveToNotes(contentType) {
  console.log('Saving to notes:', contentType);
  alert('Saved to notes! (This is a demo)');
}

function copyToClipboard(contentType) {
  console.log('Copying to clipboard:', contentType);
  const content = getContentByType(contentType);
  navigator.clipboard.writeText(content).then(() => {
    alert('Copied to clipboard!');
  }).catch(() => {
    alert('Failed to copy to clipboard');
  });
}

function shareViaEmail(contentType) {
  console.log('Sharing via email:', contentType);
  const content = getContentByType(contentType);
  const subject = encodeURIComponent('Shared from JAICE');
  const body = encodeURIComponent(content);
  window.open(`mailto:?subject=${subject}&body=${body}`);
}

function downloadPDF(contentType) {
  console.log('Downloading PDF:', contentType);
  alert('PDF download feature coming soon!');
}

function getContentByType(contentType) {
  // Get content based on type
  const searchResults = document.querySelector('#searchResults');
  if (searchResults) {
    return searchResults.textContent || 'No content available';
  }
  return 'No content available';
}

// Make function globally available
window.showSaveMenu = showSaveMenu;
globalThis.showSaveMenu = showSaveMenu;

console.log('✅ showSaveMenu function loaded successfully!');