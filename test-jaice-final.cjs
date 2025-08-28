const puppeteer = require('puppeteer');

(async () => {
  try {
    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    const page = await browser.newPage();
    
    page.on('console', msg => console.log('PAGE:', msg.text()));
    page.on('pageerror', error => console.log('ERROR:', error.message));
    
    await page.goto('http://localhost:3000');
    console.log('✓ Loaded page, URL:', page.url());
    
    // Check if we're on login page
    const hasLoginForm = await page.$('#username');
    if (hasLoginForm) {
      console.log('✓ On login page, filling credentials');
      await page.type('#username', 'CognitiveAdmin');
      await page.type('#password', 'coggpt25');
      
      // Click the correct login button
      await page.click('#loginBtn');
      console.log('✓ Clicked login button');
      await new Promise(resolve => setTimeout(resolve, 3000)); // Wait for navigation/response
    }
    
    console.log('✓ Current URL after login attempt:', page.url());
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Now check JAICE functions and elements
    const diagnostics = await page.evaluate(() => {
      const results = {
        url: window.location.href,
        title: document.title,
        searchInput: !!document.getElementById('searchInput'),
        searchButton: !!document.getElementById('searchBtn'),
        scripts: Array.from(document.querySelectorAll('script')).map(s => s.src || 'inline').filter(s => s.includes('app') || s.includes('debug')),
        functions: {
          attachSearchRecos: typeof attachSearchRecos !== 'undefined',
          attachCardMenus: typeof attachCardMenus !== 'undefined',
          jaiceSelectors: typeof window.$jaice_$ !== 'undefined',
          jqueryLike: typeof window.$jaice_$$ !== 'undefined'
        },
        elements: {
          searchRecoChips: document.querySelectorAll('.search-recommendation-chip').length,
          threeDotMenus: document.querySelectorAll('.three-dot-menu').length,
          jaiceElements: document.querySelectorAll('[class*="jaice"]').length
        },
        errors: []
      };
      
      // Try to manually trigger JAICE functions
      if (typeof attachSearchRecos === 'function') {
        const input = document.getElementById('searchInput');
        if (input) {
          try {
            console.log('Manually triggering attachSearchRecos...');
            attachSearchRecos(input);
            results.searchRecosTriggered = true;
            // Check again after triggering
            results.elements.searchRecoChipsAfter = document.querySelectorAll('.search-recommendation-chip').length;
          } catch (e) {
            results.errors.push('attachSearchRecos error: ' + e.message);
          }
        } else {
          results.errors.push('searchInput element not found');
        }
      } else {
        results.errors.push('attachSearchRecos function not defined');
      }
      
      if (typeof attachCardMenus === 'function') {
        try {
          console.log('Manually triggering attachCardMenus...');
          attachCardMenus(document);
          results.cardMenusTriggered = true;
          // Check again after triggering
          results.elements.threeDotMenusAfter = document.querySelectorAll('.three-dot-menu').length;
        } catch (e) {
          results.errors.push('attachCardMenus error: ' + e.message);
        }
      } else {
        results.errors.push('attachCardMenus function not defined');
      }
      
      return results;
    });
    
    console.log('=== JAICE DIAGNOSTICS ===');
    console.log(JSON.stringify(diagnostics, null, 2));
    
    // If we have a search input, try typing in it
    if (diagnostics.searchInput) {
      console.log('\\n=== TESTING SEARCH INPUT ===');
      await page.click('#searchInput');
      await page.type('#searchInput', 'what are the primary drivers to treatment?');
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Check for search recommendations after typing
      const afterTyping = await page.evaluate(() => {
        return {
          searchRecoChips: document.querySelectorAll('.search-recommendation-chip').length,
          inputValue: document.getElementById('searchInput').value
        };
      });
      console.log('After typing:', JSON.stringify(afterTyping, null, 2));
    }
    
    await browser.close();
    console.log('\\n=== TEST COMPLETE ===');
  } catch (error) {
    console.log('❌ Test error:', error.message);
  }
})();