import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createReadStream, readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { once } from 'node:events';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const dist = resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8', '.glb':'model/gltf-binary' };
let server, browser, baseURL;

function serve(req,res) {
  let urlPath;
  try { urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch { res.writeHead(400).end('Bad URL'); return; }
  const file = resolve(dist, '.' + (urlPath === '/' ? '/index.html' : urlPath));
  if (!file.startsWith(dist + sep)) { res.writeHead(403).end('Forbidden'); return; }
  const stream = createReadStream(file);
  stream.on('error', () => res.headersSent ? res.destroy() : res.writeHead(404).end('Not found'));
  stream.on('open', () => {
    res.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream');
    stream.pipe(res);
  });
}

before(async () => {
  server = createServer(serve);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseURL = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({
    headless: true,
    args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  });
});
after(async () => {
  await browser?.close();
  if (server?.listening) await new Promise(done => server.close(done));
});

async function withPage(name, options, verify) {
  const context = await browser.newContext({
    viewport: options.mobile ? { width:390, height:844 } : { width:1440, height:900 }
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    if (options.noWebGL) {
      await page.addInitScript(() => {
        const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function(kind,...args) {
          if (String(kind).toLowerCase().includes('webgl')) return null;
          return original.call(this,kind,...args);
        };
      });
    }
    await page.goto(baseURL + (options.path || '/'), { waitUntil:'domcontentloaded' });
    if (!options.path) await loaded(page);
    await verify(page);
    assert.deepEqual(errors, [], 'Uncaught browser JavaScript errors');
  } catch(e) {
    await mkdir('test-results', { recursive:true });
    await page.screenshot({ path:join('test-results',name+'.png'), fullPage:true, timeout:6000 }).catch(()=>{});
    console.error(name + ': uncaught errors', errors);
    throw e;
  } finally { await context.close(); }
}

async function loaded(page) {
  await page.waitForFunction(() => {
    const el = document.querySelector('#loading');
    return el && getComputedStyle(el).display === 'none';
  }, null, { timeout:60000 });
}

test('Bundled GLB files contain meshes and animation clips', () => {
  for (const file of ['atlas-09.glb','aether-02.glb']) {
    const b = readFileSync(join(dist,file));
    assert.equal(b.toString('utf8',0,4),'glTF');
    assert.equal(b.readUInt32LE(4),2);
    assert.equal(b.readUInt32LE(8),b.length);
    assert.equal(b.toString('utf8',16,20),'JSON');
    const d = JSON.parse(b.toString('utf8',20,20+b.readUInt32LE(12)));
    assert(d.meshes?.length > 0,file+' missing meshes');
    assert(d.animations?.length > 0,file+' missing animations');
    console.log(file+': '+d.meshes.length+' meshes, '+d.animations.length+' clips');
  }
});

test('Chromium renders WebGL mechs and firing-sector controls', { timeout:120000 }, async () => {
  await withPage('webgl', {}, async page => {
    assert.equal(await page.locator('#viewport canvas').count(),1);
    assert.equal(await page.locator('#labels .mechlabel').count(),4);
    assert.equal(await page.locator('#allies [data-unit]').count(),2);
    assert.equal(await page.locator('#enemies [data-unit]').count(),2);
    const c = await page.locator('#viewport canvas').evaluate(el => ({
      width:el.width,height:el.height,webgl:!!(el.getContext('webgl2')||el.getContext('webgl'))
    }));
    assert(c.width > 100 && c.height > 100,'Canvas is sized');
    assert(c.webgl,'WebGL context unavailable; do not silently pass fallback');
    assert.match(await page.locator('#arcinfo').textContent(),/гексов/);
    await page.locator('#arctoggle').click();
    assert.equal(await page.locator('#arctoggle').getAttribute('aria-pressed'),'false');
    await page.locator('#arctoggle').click();
    assert.equal(await page.locator('#arctoggle').getAttribute('aria-pressed'),'true');
    await page.locator('#rotateR').click();
    await page.locator('#zoomIn').click();
    await page.locator('#resetcam').click();
  });
});

test('Record sheet and initiative dice do not leave a stuck dialog', { timeout:120000 }, async () => {
  await withPage('initiative',{ noWebGL:true },async page => {
    await page.locator('#sheet').click();
    assert.equal(await page.locator('#modal').evaluate(e => e.open),true);
    assert(await page.locator('#modal .recordpaper').count()>0);
    assert(await page.locator('#modal .mechdiagram').count()>=2);
    await page.locator('#close').click();
    assert.equal(await page.locator('#modal').evaluate(e => e.open),false);
    await page.locator('#gamemode').selectOption('hotseat');
    await page.locator('#next').click();
    await page.locator('.dice-tray:not([hidden])').waitFor({ timeout:15000 });
    await page.locator('#hold').waitFor({ timeout:50000 });
    assert.equal((await page.locator('#phase').textContent()).trim(),'ДВИЖЕНИЕ');
    assert.equal(await page.locator('#modal').evaluate(e => e.open),false);
    assert(await page.locator('.die-cube').count()>=2);
  });
});

async function completeOrders(page, label) {
  for (let i=0;i<8;i++) {
    if (await page.locator('#next').isEnabled()) return;
    await page.locator('#hold').waitFor({ timeout:12000 });
    await page.locator('#hold').click();
    await page.waitForTimeout(100);
  }
  assert(await page.locator('#next').isEnabled(),label+' did not complete');
}

test('Hotseat completes all battle phases and returns to initiative', { timeout:150000 }, async () => {
  await withPage('round',{ noWebGL:true },async page => {
    await page.locator('#gamemode').selectOption('hotseat');
    await page.locator('#next').click();
    await page.locator('#hold').waitFor({ timeout:50000 });
    await completeOrders(page,'movement');
    await page.locator('#next').click();
    assert.match(await page.locator('#phase').textContent(),/СТРЕЛЬБА/);
    await completeOrders(page,'fire');
    await page.locator('#next').click();
    assert.match(await page.locator('#phase').textContent(),/ФИЗИЧЕСКИЕ АТАКИ/);
    await completeOrders(page,'physical');
    await page.locator('#next').click();
    assert.equal((await page.locator('#phase').textContent()).trim(),'НАГРЕВ');
    await page.locator('#next').click();
    assert.equal((await page.locator('#phase').textContent()).trim(),'КОНЕЦ ХОДА');
    await page.locator('#next').click();
    assert.match(await page.locator('#phase').textContent(),/ИНИЦИАТИВА/);
  });
});

test('Mechlab validates and launches a custom chassis', { timeout:120000 }, async () => {
  await withPage('mechlab',{path:'/mechlab.html'},async page => {
    await page.locator('#name').fill('IRONHEX CI');
    await page.locator('#check').click();
    assert.match(await page.locator('#results').textContent(),/Конструкция допустима/);
    assert.equal(await page.locator('#launch').isDisabled(),false);
    await page.locator('#launch').click();
    await page.waitForURL('**/index.html?custom=1');
    await loaded(page);
    assert.match(await page.locator('#selected h2').textContent(),/IRONHEX CI/);
  });
});

test('Mobile Canvas fallback keeps controls and dialogs accessible', { timeout:120000 }, async () => {
  await withPage('mobile',{ mobile:true,noWebGL:true },async page => {
    assert.equal(await page.locator('#viewport canvas').count(),1);
    assert.equal(await page.locator('#labels .mechlabel').count(),4);
    assert.match(await page.locator('#toast').textContent(),/резервная/);
    await page.locator('#sheet').click();
    assert.equal(await page.locator('#modal').evaluate(e => e.open),true);
    await page.locator('#close').click();
    await page.locator('#help').click();
    assert.equal(await page.locator('#modal').evaluate(e => e.open),true);
    await page.locator('#close').click();
  });
});
