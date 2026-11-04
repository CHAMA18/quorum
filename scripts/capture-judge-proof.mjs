import { chromium } from 'playwright';
import fs from 'node:fs';
const session=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const out='demo-video/quorum-hackathon/assets/rubric';
fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||undefined});
try {
const context=await browser.newContext({viewport:{width:1600,height:1000},deviceScaleFactor:2,colorScheme:'light',reducedMotion:'reduce'});
const login=await context.request.post(session.origin+'/api/auth/login',{data:{email:session.officer.email,password:session.officer.password}});
if(login.status()!==200)throw new Error('Could not authenticate fictional capture account');
const page=await context.newPage();
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto(session.origin+'/#/dashboard',{waitUntil:'domcontentloaded',timeout:180000});
await page.getByRole('button',{name:'Tender Workflow',exact:true}).waitFor({timeout:60000});
await page.screenshot({path:out+'/workspace.png'});
await page.getByRole('button',{name:'Open Bid evaluation',exact:true}).click();
await page.getByRole('heading',{name:'AI-assisted bid review',exact:true}).waitFor({timeout:30000});
await page.getByRole('heading',{name:'AI-assisted bid review',exact:true}).scrollIntoViewIfNeeded();
await page.screenshot({path:out+'/evaluation.png'});
await page.getByRole('button',{name:'Review bidder submissions',exact:true}).click();
// The workflow panel has an observed 280ms entrance. Wait for its final
// transform before taking element crops, otherwise the pixels are clipped.
await page.waitForFunction(()=>{
  const panel=document.querySelector('[role="dialog"] .panel');
  if(!panel)return false;
  const style=getComputedStyle(panel), matrix=new DOMMatrixReadOnly(style.transform);
  return style.opacity==='1'&&Math.abs(matrix.a-1)<.0001&&Math.abs(matrix.f)<.01;
});
const criteria=page.getByRole('region',{name:'Issued evaluation matrix'});
await criteria.locator('li').nth(0).screenshot({path:out+'/criterion-technical.png'});
await criteria.locator('li').nth(1).screenshot({path:out+'/criterion-delivery.png'});
if(process.argv.includes('--criteria-only')){await browser.close();process.exit(0);}
await page.getByRole('checkbox',{name:/I am authorised to send/}).check();
const advisoryResponse=page.waitForResponse(r=>r.url().endsWith('/api/cycle/evaluate-bids')&&r.request().method()==='POST',{timeout:90000});
await page.getByRole('button',{name:'Generate AI assessment',exact:true}).click();
const actualAdvisory=await advisoryResponse;
if(actualAdvisory.status()!==200)throw new Error('Live UI advisory failed: '+actualAdvisory.status());
fs.writeFileSync('SUBMISSION/evidence/current-run/browser-advisory.json',JSON.stringify(await actualAdvisory.json(),null,2)+'\n');
await page.getByRole('region',{name:'AI review provenance'}).waitFor({timeout:90000});
await page.getByRole('region',{name:'AI review provenance'}).evaluate(e=>e.scrollIntoView({block:'start'}));
await page.screenshot({path:out+'/model-result.png'});
await page.getByRole('region',{name:'AI review provenance'}).screenshot({path:out+'/provenance.png'});
await page.getByText('No supporting source quotation for this criterion.',{exact:false}).first().scrollIntoViewIfNeeded();
await page.screenshot({path:out+'/source-gap.png'});
await page.locator('article').filter({has:page.getByText('Demo Clinic Supplies',{exact:true})}).locator('li').filter({has:page.getByText('Delivery plan · 40%',{exact:true})}).first().screenshot({path:out+'/supported-card.png'});
await page.locator('article').filter({has:page.getByText('Demo Medical Works',{exact:true})}).locator('li').filter({has:page.getByText('Delivery plan · 40%',{exact:true})}).first().screenshot({path:out+'/gap-card.png'});
const textStyles=await page.getByRole('region',{name:'AI review provenance'}).evaluate(e=>({background:getComputedStyle(e).backgroundColor,paragraphs:[...e.querySelectorAll('p')].map(p=>({color:getComputedStyle(p).color,text:p.textContent}))}));
fs.writeFileSync('SUBMISSION/evidence/current-run/browser-review.json',JSON.stringify({capturedAt:new Date().toISOString(),viewport:{width:1600,height:1000},deviceScaleFactor:2,reducedMotion:'reduce',errors,textStyles},null,2)+'\n');
fs.writeFileSync('/private/tmp/quorum-capture-dom.txt',await page.locator('body').innerText());
console.log(JSON.stringify({url:page.url(),buttons:await page.getByRole('button').allTextContents(),errors},null,2));
} finally { await browser.close(); }
