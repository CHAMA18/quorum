const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addCookies([{ name: 'quorum_session', value: '09ae2f77da73bbcd4917a65d557ba5bf7c47d0a7dfcc862d31b189298a9ab625', domain: 'localhost', path: '/', httpOnly: true }]);
  const p = await ctx.newPage();
  await p.goto('http://localhost:3000/#/dashboard', { waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  await p.getByText('Tender Reviews', { exact: true }).first().click();
  await p.waitForTimeout(500);
  await p.getByRole('button', { name: /RUN DOCUMENT CHECKS/i }).click();
  await p.waitForTimeout(800);
  // find select/combobox
  const sels = await p.locator('select').evaluateAll(els => els.map(e => ({name:e.name, id:e.id, options:[...e.options].map(o=>({v:o.value,t:o.text}))})));
  console.log('SELECTS', JSON.stringify(sels, null, 2).slice(0,4000));
  const btns = await p.locator('button').evaluateAll(els => els.map(e=>e.innerText.trim()).filter(Boolean));
  console.log('BUTTONS', btns.slice(-30));
  await p.screenshot({ path: 'recordings/_modal2.png', fullPage: false });
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
