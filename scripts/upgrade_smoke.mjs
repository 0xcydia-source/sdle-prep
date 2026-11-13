/** Local-only regression: node scripts/upgrade_smoke.mjs; SDLE_BASE overrides target. */
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const base = (process.env.SDLE_BASE || 'http://127.0.0.1:8765').replace(/\/$/, '');
const output = fileURLToPath(new URL('../work/upgrade-review-smoke.json', import.meta.url));
const report = { base, started: new Date().toISOString(), checks: [], samples: [], pageerrors: [], blockedExternalRequests: [] };
const views = ['today','topics','practice','recentqa','marjune','notes','progress','feedback'];
const check = (ok, name, detail) => { report.checks.push({ok:!!ok,name,...(detail === undefined ? {} : {detail})}); console.log(`${ok?'PASS':'FAIL'} ${name}`); };
const browser = await chromium.launch({headless:true});
async function fresh(viewport) {
  const context = await browser.newContext({viewport, serviceWorkers:'allow', acceptDownloads:true});
  // Never send feedback or upload to an external origin, including accidentally.
  await context.route('**/*', route => {
    const r = route.request();
    if (new URL(r.url()).origin !== new URL(base).origin) { report.blockedExternalRequests.push(r.url()); return route.abort(); }
    if (r.method() !== 'GET' && r.method() !== 'HEAD') return route.abort();
    return route.continue();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', e => report.pageerrors.push({viewport:viewport.width,message:e.message}));
  page.on('dialog', d => d.accept());
  return {context,page};
}
async function loaded(page) {
  await page.waitForFunction(() => window.QUESTION_BANK?.length > 100 && window.FLASH_NOTES && document.querySelectorAll('#main-nav button').length >= 8, null, {timeout:60000});
}
async function onboard(page) {
  const pick = page.locator('[data-pick-plan="30"]');
  if (await pick.count()) await pick.first().click();
  const close = page.getByRole('button',{name:/Close/});
  if (await close.count() && await close.first().isVisible()) await close.first().click();
}
async function tab(page,view) { await page.locator(`#main-nav button[data-view="${view}"]`).click(); }
async function practice(page) {
  await tab(page,'practice');
  if (await page.locator('[data-pick-pool]').count()) await page.locator('[data-pick-pool]').first().click();
  await page.locator('[data-qz]').first().click();
  await page.locator('.option').first().waitFor();
}
async function backupPage(page) {
  // Backup lives in Coach More; use persisted mode setup, then real UI controls.
  await page.evaluate(() => localStorage.setItem('sdle3_simpleMode','false'));
  await page.reload({waitUntil:'domcontentloaded',timeout:120000}); await loaded(page);
  await page.locator('#main-nav [data-view="more"]').click();
  await page.getByText('Backup',{exact:true}).click();
}
async function importObject(page, data) {
  await backupPage(page);
  await Promise.all([
    page.waitForEvent('domcontentloaded',{timeout:120000}),
    page.locator('#more-import').setInputFiles({name:'regression.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))})
  ]);
  await loaded(page);
}
try {
  for (const viewport of [{width:1280,height:900},{width:390,height:844}]) {
    const {context,page} = await fresh(viewport); const label = `${viewport.width}px`;
    try {
      await page.goto(`${base}/index.html`,{waitUntil:'load',timeout:90000}); await loaded(page); await onboard(page);
      check(await page.locator('#main-nav button').count() === 8,`${label}: eight tabs`);
      for (const view of views) {
        await tab(page,view);
        check((await page.locator('#app').innerText()).trim().length > 20,`${label}: ${view} content`);
        const size = await page.evaluate(() => [innerWidth,document.documentElement.scrollWidth]);
        check(size[1] <= size[0]+1,`${label}: ${view} no horizontal overflow`,size);
      }
      await practice(page);
      for (let i=0;i<2;i++) {
        check(await page.locator('.option').count() >= 2,`${label}: practice ${i+1} real options`);
        const before = await page.locator('#app').innerText();
        await page.locator('.option').first().click();
        const after = await page.locator('#app').innerText();
        check(after.includes('Why') && after.length > before.length,`${label}: practice ${i+1} explanation`);
        report.samples.push({viewport:viewport.width,type:'practice',index:i+1,before,after});
        if (!i) await page.locator('#btn-next').click();
      }
      const stats = await page.evaluate(() => JSON.parse(localStorage.getItem('sdle3_stats')));
      check(stats?.answered >= 2,`${label}: answers persisted`,stats);
      await page.reload({waitUntil:'domcontentloaded',timeout:120000}); await loaded(page);
      check(JSON.stringify(await page.evaluate(() => JSON.parse(localStorage.getItem('sdle3_stats')))) === JSON.stringify(stats),`${label}: progress survives reload`);
      await tab(page,'progress');
      check(!/NaN|undefined|\[object Object\]/.test(await page.locator('#app').innerText()),`${label}: progress renders valid values`);
      await tab(page,'marjune');
      await page.locator('[data-fn-pane="cards"]').click();
      await page.locator('[data-fn-type="mcq"]').click();
      for(let i=0;i<3;i++) {
        const opts = page.locator('[data-fn-opt]');
        await opts.first().scrollIntoViewIfNeeded();
        check(await opts.count() >= 2 && await opts.count() <= 6,`${label}: Flash ${i+1} pickable MCQ options`);
        const before = await page.locator('#fn-study-widget').innerText();
        check(!/A\. Reveal answer|Answer:.*Options:/s.test(before),`${label}: Flash ${i+1} no fake options`);
        await opts.first().click();
        if (await page.locator('#fn-reveal').isVisible()) await page.locator('#fn-reveal').click();
        const after = await page.locator('#fn-study-widget').innerText();
        check(after !== before,`${label}: Flash ${i+1} answer revealed`);
        report.samples.push({viewport:viewport.width,type:'flash',index:i+1,before,after});
        if(i<2) await page.locator('#fn-next').click();
      }
      // Export via UI, keep download in memory (no out-of-scope artifact writes).
      await backupPage(page);
      const downloadPromise = page.waitForEvent('download'); await page.locator('#more-export').click();
      const download = await downloadPromise; const stream = await download.createReadStream(); const chunks=[];
      for await (const c of stream) chunks.push(c);
      const backup=JSON.parse(Buffer.concat(chunks).toString());
      check(backup.keys.planPickedExplicit === true,`${label}: backup exports explicit plan flag`);
      await page.evaluate(() => {localStorage.removeItem('sdle3_planPickedExplicit');localStorage.removeItem('sdle3_planChosen');});
      // Already on import page; do not reload before restoring the exported file.
      await Promise.all([page.waitForEvent('domcontentloaded',{timeout:120000}),page.locator('#more-import').setInputFiles({name:'roundtrip.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))})]);
      await loaded(page);
      check(await page.evaluate(() => JSON.parse(localStorage.getItem('sdle3_planPickedExplicit'))) === true,`${label}: backup restores explicit plan flag`);
      const malicious = {keys:{simpleMode:true,planChosen:true,planPickedExplicit:true,stats:{answered:'<img src=x onerror="window.__statsXss=1">',correct:999,byTopic:{endo:null,restorative:{a:-3,c:100},perio:{a:2.7,c:99},oms:'broken'},bySubtopic:{bad:null,valid:{a:3,c:2}}}}};
      await importObject(page,malicious);
      await tab(page,'progress');
      const clean = await page.evaluate(() => ({stats:JSON.parse(localStorage.getItem('sdle3_stats')),xss:window.__statsXss||0}));
      check(clean.xss===0 && clean.stats.answered===0 && clean.stats.correct===0 && clean.stats.byTopic.endo.a===0 && clean.stats.byTopic.perio.a===2 && clean.stats.byTopic.perio.c===2 && clean.stats.bySubtopic.bad.a===0,`${label}: malicious UI import normalized`,clean);
      check(!/NaN|undefined|\[object Object\]/.test(await page.locator('#app').innerText()),`${label}: imported progress valid`);
      await practice(page); await page.locator('.option').first().click();
      check(await page.evaluate(() => JSON.parse(localStorage.getItem('sdle3_stats')).answered)===1,`${label}: can answer after malicious import`);
    } catch(e) {check(false,`${label}: exception`,e.stack);} finally {await context.close();}
  }
  // Brand new install: never warm-cache via an online reload before going offline.
  const {context,page}=await fresh({width:1280,height:900});
  try {
    await page.goto(`${base}/index.html`,{waitUntil:'load',timeout:90000}); await loaded(page);
    await page.evaluate(async () => {await navigator.serviceWorker.ready;});
    await page.waitForFunction(() => !!navigator.serviceWorker.controller,null,{timeout:60000});
    report.offlineCacheKeys=await page.evaluate(() => caches.keys());
    await context.setOffline(true);
    await page.reload({waitUntil:'domcontentloaded',timeout:120000}); await loaded(page);
    const globals=await page.evaluate(() => ({bank:window.QUESTION_BANK?.length,flash:!!window.FLASH_NOTES,lessons:!!window.LESSONS,plans:!!window.PLAN_TRACKS}));
    check(globals.bank>100 && globals.flash && globals.lessons && globals.plans,'first-visit ready → offline reload: data globals',globals);
    await onboard(page);
    for(const view of views) {await tab(page,view);check((await page.locator('#app').innerText()).length>20,`offline: ${view} navigation`);}
  } catch(e) {check(false,'first-visit offline exception',e.stack);} finally {await context.close();}
} catch(e) {check(false,'runner exception',e.stack);} finally {
  await browser.close();
  check(report.pageerrors.length===0,'no pageerrors',report.pageerrors);
  report.finished=new Date().toISOString();report.passed=report.checks.filter(x=>x.ok).length;report.failed=report.checks.filter(x=>!x.ok).length;
  await writeFile(output,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({output,passed:report.passed,failed:report.failed,samples:report.samples.length}));
  process.exitCode=report.failed ? 1 : 0;
}
