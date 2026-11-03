const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addCookies([{ name: 'quorum_session', value: '09ae2f77da73bbcd4917a65d557ba5bf7c47d0a7dfcc862d31b189298a9ab625', domain: 'localhost', path: '/', httpOnly: true }]);
  const p = await ctx.newPage();
  await p.goto('http://localhost:3000/#/dashboard', { waitUntil: 'networkidle' });
  await p.waitForTimeout(1000);
  // click Tender Reviews in sidebar
  const side = p.getByText('Tender Reviews', { exact: true }).first();
  await side.click();
  await p.waitForTimeout(1200);
  console.log('URL', p.url());
  console.log((await p.locator('body').innerText()).slice(0, 7000));
  await p.screenshot({ path: 'recordings/_reviews.png', fullPage: false });
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
