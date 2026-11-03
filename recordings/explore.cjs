const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addCookies([{ name: 'quorum_session', value: '09ae2f77da73bbcd4917a65d557ba5bf7c47d0a7dfcc862d31b189298a9ab625', domain: 'localhost', path: '/', httpOnly: true }]);
  const p = await ctx.newPage();
  await p.goto('http://localhost:3000/#/dashboard', { waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);
  console.log('TITLE', await p.title());
  console.log('URL', p.url());
  console.log((await p.locator('body').innerText()).slice(0, 6000));
  await p.screenshot({ path: 'recordings/_dashboard.png', fullPage: false });
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
