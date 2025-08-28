const puppeteer = require('puppeteer');

(async () => {
  try {
    const browser = await puppeteer.launch({
      headless: false, 
      args: ['--no-sandbox', '--disable-web-security', '--disable-features=VizDisplayCompositor']
    });
    const page = await browser.newPage();
    
    // Enable console logging
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', error => console.log('PAGE ERROR:', error.message));
    
    await page.goto('http://localhost:3000');
    console.log('✓ Navigated to login page');
    
    // Fill login form
    await page.type('#username', 'CognitiveAdmin');
    await page.type('#password', 'coggpt25');
    console.log('✓ Filled login credentials');
    
    await page.click('button[type="submit"]');
    console.log('✓ Clicked submit button');
    
    // Wait for navigation to complete
    await page.waitForNavigation();
    console.log('✓ Current URL after login:', page.url());
    
    // Wait a moment for page to load
    await page.waitForTimeout(2000);
    
    // Check if search input exists
    const searchInput = await page.$('#searchInput');
    if (searchInput) {
      console.log('✓ Found search input');
      
      // Click on search input
      await page.click('#searchInput');
      console.log('✓ Clicked search input');
      await page.waitForTimeout(1000);
      
      // Look for JAICE features BEFORE typing
      let searchRecos = await page.$$('.search-recommendation-chip');
      console.log('Search recommendations found (before typing):', searchRecos.length);
      
      // Type the test query
      await page.type('#searchInput', 'what are the primary drivers to treatment?');
      console.log('✓ Typed search query');
      await page.waitForTimeout(1000);
      
      // Look for JAICE features AFTER typing
      searchRecos = await page.$$('.search-recommendation-chip');
      const threeDotMenus = await page.$$('.three-dot-menu');
      const jaiceElements = await page.$$('[class*="jaice"]');
      
      console.log('Search recommendations found (after typing):', searchRecos.length);
      console.log('Three-dot menus found:', threeDotMenus.length);
      console.log('Any JAICE-related elements found:', jaiceElements.length);
      
      // Check if JAICE functions are available
      const jaiceFunctions = await page.evaluate(() => {
        return {
          attachSearchRecos: typeof attachSearchRecos !== 'undefined',
          attachCardMenus: typeof attachCardMenus !== 'undefined',
          $jaice_$: typeof window.$jaice_$ !== 'undefined',
          $jaice_$$: typeof window.$jaice_$$ !== 'undefined'
        };
      });
      console.log('JAICE functions available:', jaiceFunctions);
      
      // Manually trigger JAICE functions
      await page.evaluate(() => {
        try {
          if (typeof attachSearchRecos === 'function') {
            const input = document.getElementById('searchInput');
            if (input) {
              console.log('Manually triggering attachSearchRecos...');
              attachSearchRecos(input);
            }
          }
          if (typeof attachCardMenus === 'function') {
            console.log('Manually triggering attachCardMenus...');
            attachCardMenus(document);
          }
        } catch (e) {
          console.log('Error triggering JAICE functions:', e.message);
        }
      });
      
      await page.waitForTimeout(1000);
      
      // Check again for JAICE features after manual trigger
      searchRecos = await page.$$('.search-recommendation-chip');
      console.log('Search recommendations found (after manual trigger):', searchRecos.length);
      
      // Perform search
      const searchBtn = await page.$('#searchBtn');
      if (searchBtn) {
        await page.click('#searchBtn');
        console.log('✓ Clicked search button');
        await page.waitForTimeout(3000);
        
        // Check what happened after search
        const resultsContainer = await page.$('#searchResults');
        console.log('Results container exists:', !!resultsContainer);
      } else {
        console.log('❌ Search button not found');
      }
    } else {
      console.log('❌ Search input not found');
    }
    
    await browser.close();
  } catch (error) {
    console.log('❌ Error:', error.message);
  }
})();