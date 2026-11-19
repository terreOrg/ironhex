import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createReadStream, readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { once } from 'node:events';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createBrowserCoverage } from './browser-coverage.mjs';
import { Game as TestBattleGame } from '../packages/engine/engine.js';
import { runTacticalOrder } from '../apps/api/src/server-combat.mjs';

const dist = resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8', '.glb':'model/gltf-binary' };
let server, browser, baseURL;
const browserPilots=[];
const browserCoverage=await createBrowserCoverage();

function serve(req,res) {
  let urlPath;
  try { urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch { res.writeHead(400).end('Bad URL'); return; }
  // A tiny same-origin authentication stub isolates the browser UI tests from PostgreSQL.
  // The real registration/login flow is covered by container-smoke PostgreSQL tests.
  if (urlPath.startsWith('/api/')) {
    const authenticated = /(?:^|;\s*)ironhex_session=[a-f0-9]{64}(?:;|$)/.test(req.headers.cookie || '');
    const commander = {id:'test-commander',handle:'TestCommander',email:'test@example.invalid'};
    const reply = (status,body,cookie=null) => {
      res.writeHead(status,{
        'Content-Type':'application/json',
        'Cache-Control':'no-store',
        ...(cookie ? {'Set-Cookie': cookie} : {})
      });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'GET' && urlPath === '/api/v1/auth/me')
      return reply(200,{authenticated,user:authenticated?commander:null});
    if (req.method === 'GET' && urlPath === '/api/v1/pilots')
      return reply(200,{items:browserPilots});
    if (req.method === 'POST' && urlPath === '/api/v1/pilots') {
      req.resume();
      const item={id:'a'.repeat(8)+'-aaaa-aaaa-aaaa-'+'a'.repeat(12),
        fullName:'Mara Voss',callsign:'Raven',faction:'mercenary',
        portrait:3,rank:'cadet',gunnery:4,piloting:5,experience:0,
        battles:0,wins:0,losses:0,kills:0,wounds:0,
        assignedMechId:null,assignedChassis:null};
      browserPilots.push(item);
      return reply(201,{item});
    }
    if (req.method === 'GET' && urlPath === '/api/v1/economy')
      return authenticated?reply(200,{balance:150000,stock:{},catalog:[],repairs:[],
        ledger:[],contracts:[{id:'patrol',name:'Приграничный патруль',victory:32000}]}) :
        reply(401,{error:'unauthorized'});
    if (req.method === 'GET' && urlPath === '/api/v1/hangar')
      return authenticated ? reply(200,{items:[]}) : reply(401,{error:'unauthorized'});
    if (req.method === 'POST' && ['/api/v1/auth/login','/api/v1/auth/register'].includes(urlPath)) {
      req.resume();
      return reply(urlPath.endsWith('register') ? 201 : 200,
        {authenticated:true,user:commander},
        'ironhex_session='+'a'.repeat(64)+'; Path=/api/; HttpOnly; SameSite=Strict');
    }
    if (req.method === 'POST' && urlPath === '/api/v1/auth/request-reset') {
      req.resume();return reply(200,{ok:true});
    }
    if (req.method === 'POST' && urlPath === '/api/v1/auth/reset-password') {
      req.resume();
      return reply(200,{ok:true},
        'ironhex_session=; Path=/api/; HttpOnly; SameSite=Strict; Max-Age=0');
    }
    if (req.method === 'POST' && urlPath === '/api/v1/auth/verify-email') {
      req.resume();return reply(200,{ok:true});
    }
    if (req.method === 'POST' && urlPath === '/api/v1/auth/resend-verification') {
      req.resume();return reply(200,{ok:true});
    }
    if (req.method === 'POST' && urlPath === '/api/v1/auth/logout') {
      req.resume();
      return reply(200,{ok:true},
        'ironhex_session=; Path=/api/; HttpOnly; SameSite=Strict; Max-Age=0');
    }
    return reply(404,{error:'not_found'});
  }
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
  try { await browserCoverage?.write(); }
  finally {
    await browser?.close();
    if (server?.listening) await new Promise(done => server.close(done));
  }
});

async function withPage(name, options, verify) {
  const context = await browser.newContext({
    viewport: options.mobile ? { width:390, height:844 } : { width:1440, height:900 }
  });
  if (!options.unauthenticated) {
    await context.addCookies([{
      name:'ironhex_session', value:'a'.repeat(64),
      url:baseURL + '/api/', httpOnly:true, sameSite:'Strict'
    }]);
  }
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    if(browserCoverage)await page.coverage.startJSCoverage({resetOnNavigation:false});
    if (options.noWebGL) {
      await page.addInitScript(() => {
        const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function(kind,...args) {
          if (String(kind).toLowerCase().includes('webgl')) return null;
          return original.call(this,kind,...args);
        };
      });
    }
    const path=options.path || (options.hub || options.unauthenticated ? '/' : '/index.html?battle=1');
    await page.goto(baseURL+path,{waitUntil:'domcontentloaded'});
    if (!options.path && !options.unauthenticated) {
      if(options.hub)await page.locator('#hub-battle').waitFor({state:'visible',timeout:20000});
      else await loaded(page);
    }
    await verify(page);
    assert.deepEqual(errors, [], 'Uncaught browser JavaScript errors');
    if(browserCoverage)await browserCoverage.add(await page.coverage.stopJSCoverage(),baseURL);
  } catch(e) {
    await mkdir('test-results', { recursive:true });
    await page.screenshot({ path:join('test-results',name+'.png'), fullPage:true, timeout:6000 }).catch(()=>{});
    console.error(name + ': uncaught errors', errors);
    throw e;
  } finally { await context.close(); }
}

async function setMechToggle(locator,checked){
  assert.equal(await locator.evaluate(el=>el.localName),'mech-toggle');
  if(await locator.evaluate(el=>el.checked)!==checked)await locator.getByRole('switch').click();
  assert.equal(await locator.evaluate(el=>el.checked),checked);
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
    await page.locator('#arctoggle').getByRole('switch').click();
    assert.equal(await page.locator('#arctoggle').evaluate(el=>el.checked),false);
    await page.locator('#arctoggle').getByRole('switch').click();
    assert.equal(await page.locator('#arctoggle').evaluate(el=>el.checked),true);
    await page.locator('#rotateR').click();
    await page.locator('#zoomIn').click();
    await page.locator('#resetcam').click();
  });
});


test('Mobile 3D battlefield rotates on drag and zooms with a two-finger gesture',
  {timeout:120000},async()=>{
    await withPage('mobile-battle-gestures',{mobile:true,noWebGL:true},async page=>{
      const hud=page.locator('.visor-reticle span');
      const baseline=await hud.textContent();
      assert(baseline.includes('AZIMUTH')&&baseline.includes('ZOOM 12.0'));
      await page.evaluate(()=>{
        const canvas=document.querySelector('#viewport canvas');
        const send=(type,id,x,y)=>canvas.dispatchEvent(new PointerEvent(type,{
          bubbles:true,pointerType:'touch',pointerId:id,isPrimary:id===1,
          clientX:x,clientY:y,button:0,buttons:type==='pointerup'?0:1
        }));
        send('pointerdown',1,120,190);
        send('pointermove',1,200,190);
        send('pointerup',1,200,190);
      });
      const rotated=await hud.textContent();
      assert.notEqual(rotated,baseline,'Dragging must rotate the camera');
      await page.evaluate(()=>{
        const canvas=document.querySelector('#viewport canvas');
        const send=(type,id,x,y)=>canvas.dispatchEvent(new PointerEvent(type,{
          bubbles:true,pointerType:'touch',pointerId:id,isPrimary:id===1,
          clientX:x,clientY:y,button:0,buttons:type==='pointerup'?0:1
        }));
        send('pointerdown',1,110,200);
        send('pointerdown',2,170,200);
        send('pointermove',2,230,200);
        send('pointerup',2,230,200);
        send('pointerup',1,110,200);
      });
      const zoomed=await hud.textContent();
      assert.notEqual(zoomed,rotated,'Pinching must change camera zoom');
      assert(zoomed.includes('ZOOM 6.0'),'Pinch zoom level must be applied');
      await page.locator('#resetcam').click();
      assert.equal(await hud.textContent(),baseline,
        'Reset must restore the original camera position and zoom');
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

test('AGoAC p.4: inspecting enemy record sheet preserves active unit and target selection', {timeout:120000}, async()=>{
  await withPage('agoac-open-records',{noWebGL:true},async page=>{
    await page.locator('#gamemode').selectOption('hotseat');
    await page.locator('#next').click();
    await page.locator('#hold').waitFor({timeout:50000});
    const active=page.locator('.unitcard.active');
    const id=await active.getAttribute('data-unit');
    const enemy=await active.evaluate(e=>e.classList.contains('enemy'));
    const opposing=page.locator(enemy?'#allies [data-unit]':'#enemies [data-unit]').first();
    const opposingName=await opposing.locator('strong').textContent();
    await opposing.click();
    await page.locator('#target-sheet').click();
    assert.equal(await page.locator('#modal').evaluate(e=>e.open),true);
    assert.equal(await page.locator('#modal .recordhead b').textContent(),opposingName);
    await page.locator('#close').click();
    assert.equal(await page.locator('.unitcard.active').getAttribute('data-unit'),id);
    assert.equal(await page.locator('#target-sheet').count(),1);
    assert.equal((await page.locator('#phase').textContent()).trim(),'ДВИЖЕНИЕ');
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

test('AGoAC pp.4,45-48: every unit record remains open throughout all six battle phases', {timeout:180000},async()=>{
 await withPage('agoac-all-records',{noWebGL:true},async page=>{
  await page.locator('#gamemode').selectOption('hotseat');
  async function inspect(){
   const phase=await page.locator('#phase').textContent();
   const active=await page.locator('.unitcard.active').getAttribute('data-unit');
   const enabled=await page.locator('#next').isEnabled();
   const units=await page.locator('.unitcard').evaluateAll(cards=>cards.map(c=>({id:c.dataset.unit,name:c.querySelector('strong').textContent})));
   for(const unit of units){
    await page.locator('#all-records').click();
    assert.equal(await page.locator('#record-list [data-record-id]').count(),units.length);
    await page.locator('#record-list [data-record-id="'+unit.id+'"]').click();
    assert.equal(await page.locator('#modal .recordhead b').textContent(),unit.name);
    await page.locator('#close').click();
    assert.equal(await page.locator('.unitcard.active').getAttribute('data-unit'),active);
    assert.equal(await page.locator('#phase').textContent(),phase);
    assert.equal(await page.locator('#next').isEnabled(),enabled);
   }
  }
  await inspect();
  await page.locator('#next').click();await page.locator('#hold').waitFor({timeout:50000});
  for(const phase of ['movement','fire','physical']){
   await inspect();await completeOrders(page,phase);await page.locator('#next').click();
  }
  await inspect();await page.locator('#next').click();await inspect();
 });
});

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
    await page.locator('#setup-approve-green').waitFor({state:'visible'});
    assert(await page.locator('#confirmreset').isDisabled());
    await setMechToggle(page.locator('#setup-approve-green'),true);
    await page.locator('#confirmreset').click();
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

test('Guest sees the login/registration landing screen before the 3D game starts',
  {timeout:120000},async()=>{
    await withPage('auth-landing',{unauthenticated:true,noWebGL:true},async page=>{
      await page.locator('#auth-login').waitFor({state:'visible'});
      assert.equal(await page.locator('#auth-dialog').evaluate(el=>el.open),true);
      assert.equal(await page.locator('body').evaluate(el=>el.classList.contains('auth-locked')),true);
      assert.equal(await page.locator('body > main').isVisible(),false);
      assert.equal(await page.locator('#viewport canvas').count(),0,
        'The battle engine must not start before authentication');
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#auth-dialog').evaluate(el=>el.open),true,
        'A guest must not close the access gate');
      await page.locator('#auth-tab-register').click();
      assert.equal(await page.locator('#auth-register').isVisible(),true);
      assert.equal(await page.locator('#auth-login').isVisible(),false);
      await page.locator('#auth-register input[name=handle]').fill('NewCommander');
      await page.locator('#auth-register input[name=email]').fill('new@example.invalid');
      await page.locator('#auth-register input[name=password]').fill('Private-Test-Password-2026!');
      await page.locator('#auth-register input[name=confirm]').fill('Private-Test-Password-2026!');
      await page.locator('#auth-register button[type=submit]').click();
      await page.locator('#hub-battle').waitFor({state:'visible'});
      assert.equal(await page.locator('body').evaluate(el=>el.classList.contains('auth-locked')),false);
      assert.equal(await page.locator('#auth-dialog').evaluate(el=>el.open),false);
      assert.equal(await page.locator('#viewport canvas').count(),0);
      await page.locator('#hub-battle').click();
      await page.locator('#hub-battle-frame').waitFor({state:'visible'});
      const battle=page.frameLocator('#hub-battle-frame');
      await battle.locator('#loading').waitFor({state:'hidden',timeout:60000});
      await battle.locator('#allies [data-unit]').first().waitFor({state:'visible',timeout:10000});
      assert.equal(await battle.locator('#allies [data-unit]').count(),2,
        'The tactical interface must open even when WebGL is unavailable');
      assert.equal(await page.locator('#viewport canvas').count(),0);
      await page.reload();
      await page.locator('#hub-battle').waitFor({state:'visible'});
      assert.equal(await page.locator('#auth-dialog').evaluate(el=>el.open),false,
        'An existing commander session should open the game automatically');
    });
  });

test('Commander login and logout return to the protected landing screen',
  {timeout:120000},async()=>{
    await withPage('auth-logout',{unauthenticated:true,noWebGL:true},async page=>{
      await page.locator('#auth-login').waitFor({state:'visible'});
      await page.locator('#auth-login input[name=identity]').fill('TestCommander');
      await page.locator('#auth-login input[name=password]').fill('Private-Test-Password-2026!');
      await page.locator('#auth-login button[type=submit]').click();
      await page.locator('#hub-battle').waitFor({state:'visible'});
      await page.locator('#hub-battle').click();
      await page.locator('#hub-battle-frame').waitFor({state:'visible'});
      await page.locator('#hub-profile-button').click();
      assert.equal(await page.locator('#auth-profile').isVisible(),true);
      await page.locator('#auth-logout').click();
      await page.locator('#auth-login').waitFor({state:'visible'});
      assert.equal(await page.locator('#viewport canvas').count(),0,
        'Logging out should unload the game before showing the login screen');
    });
  });

test('Direct MechLab navigation also requires login',
  {timeout:120000},async()=>{
    await withPage('mechlab-guest',{path:'/mechlab.html',unauthenticated:true},async page=>{
      await page.locator('#auth-login').waitFor({state:'visible'});
      assert.equal(await page.locator('body > main').isVisible(),false);
      assert.equal(await page.locator('#core > *').count(),0);
      await page.locator('#auth-login input[name=identity]').fill('TestCommander');
      await page.locator('#auth-login input[name=password]').fill('Private-Test-Password-2026!');
      await page.locator('#auth-login button[type=submit]').click();
      await page.locator('#name').waitFor({state:'visible'});
      assert.equal(await page.locator('body > main').isVisible(),true);
    });
  });


test('Authenticated commander headquarters lists the hangar and routes to MechLab',
  {timeout:120000},async()=>{
    await withPage('headquarters',{hub:true},async page=>{
      assert.equal(await page.locator('body').evaluate(el=>el.classList.contains('hub-open')),true);
      assert.equal(await page.locator('body > main').isVisible(),false);
      assert.equal(await page.locator('#viewport canvas').count(),0);
      await page.locator('#hub-hangar-button').click();
      await page.waitForFunction(() =>
        document.querySelector('#hub-hangar-status')?.textContent.includes('Ангар пуст'),
        {timeout:12000}
      );
      assert.match(await page.locator('#hub-hangar-status').textContent(),/Ангар пуст/);
      const workbox=await page.locator('#hub-workarea').boundingBox();
      const railbox=await page.locator('.hub-operations').boundingBox();
      assert(workbox.x>railbox.x+railbox.width-5,
        'Section panel should open to the right of the command rail');
      await page.locator('#hub-hangar a[href="mechlab.html"]').click();
      await page.frameLocator('#hub-mechlab-frame').locator('#name').waitFor({state:'visible'});
      assert.equal(await page.locator('#hub-work-title').textContent(),'Конструктор мехов');
      assert.equal(new URL(page.url()).pathname,'/');
    });
  });


test('Password recovery opens from login and accepts a one-time link',
  {timeout:120000},async()=>{
    await withPage('password-recovery',{unauthenticated:true},async page=>{
      await page.locator('#auth-login').waitFor({state:'visible'});
      await page.locator('#auth-forgot-link').click();
      await page.locator('#auth-forgot input[name=email]').fill('test@example.invalid');
      await page.locator('#auth-forgot button[type=submit]').click();
      await page.getByText('Если этот адрес зарегистрирован').waitFor();
      await page.goto(baseURL+'/#reset='+'a'.repeat(64));
      await page.reload();
      await page.locator('#auth-new-password').waitFor({state:'visible'});
      await page.locator('#auth-new-password input[name=password]').fill('Another-Long-Pass-2026!');
      await page.locator('#auth-new-password input[name=confirm]').fill('Another-Long-Pass-2026!');
      await page.locator('#auth-new-password button[type=submit]').click();
      await page.getByText('Пароль изменён.').waitFor();
      assert.equal(await page.locator('#auth-login').isVisible(),true);
      assert.equal(new URL(page.url()).hash,'');
    });
  });


test('Personnel ID card renders portrait, serial, rank, and combat skills',
  {timeout:120000},async()=>{
    await withPage('pilot-id-cards',{hub:true},async page=>{
      await page.locator('#hub-pilots-button').click();
      await page.locator('#pilot-editor input[name=fullName]').fill('Mara Voss');
      await page.locator('#pilot-editor input[name=callsign]').fill('Raven');
      await page.locator('#pilot-editor select[name=portrait]').selectOption('3');
      await page.locator('#pilot-save').click();
      await page.locator('.pilot-id-card').waitFor({state:'visible'});
      assert.equal(await page.locator('.pilot-id-photo svg').count(),1);
      assert.match(await page.locator('.pilot-id-top').textContent(),/MECHWARRIOR/);
      assert.match(await page.locator('.pilot-id-card').textContent(),/RAVEN/);
      assert.match(await page.locator('.pilot-id-card').textContent(),/GUNNERY/);
      assert.match(await page.locator('.pilot-id-card').textContent(),/PILOTING/);
      assert.match(await page.locator('.pilot-id-card').textContent(),/IX-/);
      await page.locator('#hub-hangar-button').click();
      assert.equal(await page.locator('#hub-roster').isVisible(),false);
    });
  });


test('Every headquarters menu section docks the cards left and renders centered content',
  {timeout:120000},async()=>{
    await withPage('commander-rail',{hub:true},async page=>{
      const operations=page.locator('.hub-operations');
      const homePos=await operations.boundingBox();
      assert.equal(await page.locator('#hub-workarea').isVisible(),false);
      assert.equal(await page.locator('#hub-home-button').isVisible(),false);
      const examples=[
        ['#hub-hangar-button','Ангар','#hub-hangar'],
        ['#hub-pilots-button','Личный состав','#hub-roster'],
        ['#hub-campaigns-button','Боевые операции','#hub-campaigns-panel'],
        ['#hub-market-button','Рынок','#hub-market-panel'],
        ['#hub-mechlab-button','Конструктор мехов','#hub-mechlab-panel'],
        ['#hub-battle','Быстрый бой','#hub-battle-panel']
      ];
      for (const [button,title,panel] of examples) {
        await page.locator(button).click();
        await page.locator(panel).waitFor({state:'visible',timeout:15000});
        assert.equal(await page.locator('#hub-work-title').textContent(),title);
        assert.equal(await page.locator(button).getAttribute('aria-current'),'page');
        assert.equal(await page.locator('#hub-home-button').isVisible(),true);
        assert.equal(await page.locator('.hub-intro').isVisible(),false);
        const work=await page.locator('#hub-workarea').boundingBox();
        const docked=await operations.boundingBox();
        assert(work.x > docked.x+docked.width-5,
          title+': content must open to the right of the rail');
        assert(docked.x < homePos.x - 90,
          title+': navigation should move substantially left');
      }
      await page.frameLocator('#hub-battle-frame').locator('#loading')
        .waitFor({state:'hidden',timeout:60000});
      await page.locator('#hub-home-button').click();
      assert.equal(await page.locator('#hub-workarea').isVisible(),false);
      assert.equal(await page.locator('.hub-intro').isVisible(),true);
      assert.equal(await page.locator('#hub-home-button').isVisible(),false);
    });
  });

test('Mobile headquarters uses a scrollable compact command rail without clipped content',
  {timeout:120000},async()=>{
    await withPage('commander-mobile-rail',{hub:true,mobile:true},async page=>{
      await page.locator('#hub-pilots-button').click();
      await page.locator('#hub-roster').waitFor({state:'visible'});
      const result=await page.evaluate(()=>{
        const nav=document.querySelector('.hub-operations');
        const main=document.querySelector('#hub-workarea');
        return {
          width:innerWidth,
          scrollWidth:document.documentElement.scrollWidth,
          navDirection:getComputedStyle(nav).flexDirection,
          navScroll:nav.scrollWidth,
          navVisible:nav.clientWidth,
          contentWidth:main.getBoundingClientRect().width
        };
      });
      assert.equal(result.navDirection,'row');
      assert(result.contentWidth>260);
      assert(result.scrollWidth<=result.width+2,
        'Content should not overflow the mobile viewport');
      assert(result.navScroll>result.navVisible,'Navigation should scroll horizontally');
      await page.locator('#hub-home-button').click();
      assert.equal(await page.locator('.hub-intro').isVisible(),true);
    });
  });



test('Commander market displays C-Bills and submits only SKU and quantity',
  {timeout:120000},async()=>{
    await withPage('market-purchase',{hub:true},async page=>{
      let purchases=0;
      const respond=(route,status,body)=>route.fulfill({
        status,contentType:'application/json',body:JSON.stringify(body)
      });
      await page.route('**/api/v1/economy**',route=>{
        const request=route.request();
        if(request.method()==='POST'){
          assert.equal(new URL(request.url()).pathname,'/api/v1/economy/purchase');
          assert.deepEqual(request.postDataJSON(),{sku:'armor_patch',quantity:1});
          purchases++;
          return respond(route,200,{item:{sku:'armor_patch',spent:900,quantity:purchases}});
        }
        return respond(route,200,{
          balance:150000-purchases*900,
          stock:{armor_patch:purchases},
          contracts:[{id:'patrol',name:'Приграничный патруль',victory:32000}],
          catalog:[{sku:'armor_patch',name:'Комплект бронепластин',price:900,restore:10}],
          repairs:[],ledger:[{amount:150000,reason:'Стартовый капитал'}]
        });
      });
      page.on('dialog',dialog=>void dialog.accept());
      await page.locator('#hub-market-button').click();
      await page.locator('#economy-wallet strong').waitFor({state:'visible'});
      assert.match(await page.locator('#economy-wallet strong').textContent(),/150/);
      await page.locator('#economy-supplies button').click();
      await page.waitForFunction(()=>document.querySelector('#economy-supplies small')
        ?.textContent.includes('На складе: 1'));
      assert.equal(purchases,1);
      await page.waitForFunction(()=>document.querySelector('#economy-message')
        ?.textContent.includes('Заказ выполнен'));
      await page.locator('#hub-home-button').click();
      assert.equal(await page.locator('.hub-intro').isVisible(),true);
    });
  });

test('Market reload consumes an owned ammo pack and displays server magazine state',
  {timeout:120000},async()=>{
    await withPage('market-reload',{hub:true},async page=>{
      const id='11111111-1111-4111-8111-111111111111';
      let stock=1,rounds=0,reloads=0;
      const respond=(route,status,body)=>route.fulfill({status,
        contentType:'application/json',body:JSON.stringify(body)});
      await page.route('**/api/v1/economy**',route=>{
        const request=route.request(),url=new URL(request.url());
        if(url.pathname==='/api/v1/economy/reload'){
          assert.deepEqual(request.postDataJSON(),
            {mechId:id,location:'RT',slot:5});
          assert.equal(request.method(),'POST');
          assert.equal(stock,1);
          stock--;rounds=12;reloads++;
          return respond(route,200,{item:{mechId:id,weapon:'LRM 10',
            location:'RT',slot:5,rounds,spent:0}});
        }
        if(url.pathname==='/api/v1/economy'){
          return respond(route,200,{
            balance:150000,stock:{},equipmentStock:{'ammo:LRM 10':stock},
            catalog:[{sku:'ammo:LRM 10',name:'Боезапас LRM 10',
              price:600,kind:'ammo'}],
            magazines:[{mechId:id,chassis:'Griffin',weapon:'LRM 10',
              location:'RT',slot:5,rounds,capacity:12,
              reloadSku:'ammo:LRM 10',licensed:true,damaged:false}],
            mechOffers:[],repairs:[],ledger:[]
          });
        }
        return respond(route,200,{total:4305,available:6,items:[],
          matches:0,page:1,pages:0});
      });
      page.on('dialog',dialog=>void dialog.accept());
      await page.locator('#hub-market-button').click();
      await page.locator('#economy-magazines button').waitFor({state:'visible'});
      assert.match(await page.locator('#economy-magazines').textContent(),/0 \/ 12/);
      assert.match(await page.locator('#economy-supplies').textContent(),/На складе: 1/);
      await page.locator('#economy-magazines button').click();
      await page.waitForFunction(()=>document.querySelector('#economy-magazines')
        ?.textContent.includes('12 / 12'));
      assert.equal(reloads,1);
      assert.equal(stock,0);
      assert.equal(await page.locator('#economy-magazines button').count(),0);
      await page.waitForFunction(()=>document.querySelector('#economy-message')
        ?.textContent.includes('Боезапас LRM 10 пополнен'));
    });
  });

test('Critical repair panel uses server prices and replaces one damaged part',
  {timeout:120000},async()=>{
    await withPage('critical-repair',{hub:true},async page=>{
      const mechId='11111111-1111-4111-8111-111111111111';
      let repaired=0;
      const respond=(route,status,body)=>route.fulfill({
        status,contentType:'application/json',body:JSON.stringify(body)});
      await page.route('**/api/v1/economy**',route=>{
        const request=route.request();
        const {pathname}=new URL(request.url());
        if(pathname==='/api/v1/economy/components/repair'){
          assert.equal(request.method(),'POST');
          assert.deepEqual(request.postDataJSON(),
            {mechId,partId:'CT:1'});
          repaired++;
          return respond(route,200,{item:{mechId,partId:'CT:1',
            name:'Двигатель',spent:6000,remaining:0}});
        }
        if(pathname==='/api/v1/economy')
          return respond(route,200,{
            balance:150000-repaired*6000,stock:{},equipmentStock:{},
            mechOffers:[],catalog:[],repairs:[],magazines:[],
            components:repaired?[]:[{
              mechId,chassis:'Griffin',id:'CT:1',name:'Двигатель',
              kind:'service',sku:null,location:'CT',slot:1,
              damagedSlots:1,serviceCost:6000,licensed:true,
              requiredStock:null
            }],
            ledger:[]
          });
        return respond(route,200,{total:4305,available:6,items:[],
          matches:0,page:1,pages:0});
      });
      page.on('dialog',dialog=>void dialog.accept());
      await page.locator('#hub-market-button').click();
      await page.locator('#economy-components button').waitFor({state:'visible'});
      assert.match(await page.locator('#economy-components').textContent(),
        /Двигатель/);
      assert.match(await page.locator('#economy-components').textContent(),
        /6\s*000/);
      await page.locator('#economy-components button').click();
      await page.waitForFunction(()=>document.querySelector('#economy-components')
        ?.textContent.includes('Все критические системы'));
      assert.equal(repaired,1);
      assert.match(await page.locator('#economy-wallet').textContent(),/144/);
      await page.waitForFunction(()=>document.querySelector('#economy-message')
        ?.textContent.includes('Компонент «Двигатель» восстановлен'));
      assert.match(await page.locator('#economy-message').textContent(),
        /Компонент «Двигатель» восстановлен/);
    });
  });

test('Commander catalog supports combined mass filters and opens a complete Mech dossier',
  {timeout:120000},async()=>{
    await withPage('market-mech-dossier',{hub:true},async page=>{
      const calls=[];
      const respond=(route,status,body)=>route.fulfill({status,
        contentType:'application/json',body:JSON.stringify(body)});
      const path='data/mekfiles/meks/3025 CCE/Medium/Griffin GRF-1M.mtf';
      const offer={id:'mm-grf-1m',offerId:'mm-grf-1m',
        sourcePath:path,name:'Griffin GRF-1M',tonnage:55,
        price:55000,era:3025,role:'Striker',
        weapons:['LRM 20'],description:'55 т · LRM 20',
        available:true,weightClass:'medium'};
      await page.route('**/api/v1/economy**',route=>{
        const request=route.request(),url=new URL(request.url());
        if(url.pathname==='/api/v1/economy')return respond(route,200,{
          balance:150000,stock:{},equipmentStock:{},
          mechOffers:[offer],catalog:[],repairs:[],ledger:[],contracts:[]
        });
        if(url.pathname==='/api/v1/economy/mechs'){
          calls.push(Object.fromEntries(url.searchParams));
          return respond(route,200,{total:4305,available:8,matches:1,
            page:1,pages:1,items:[offer]});
        }
        if(url.pathname==='/api/v1/economy/mechs/detail'){
          assert.equal(url.searchParams.get('path'),path);
          return respond(route,200,{item:{...offer,sourceLicense:'CC-BY-NC-SA-4.0',
            techBase:'Inner Sphere',engineRating:275,
            movement:{walk:5,run:8,jump:5},heatSinks:12,
            remainingTonnage:0,armor:[
              {location:'CT',front:20,rear:7,structure:18},
              {location:'HD',front:9,rear:null,structure:3}
            ],
            weapons:[{name:'LRM 20',location:'RT',damage:1,heat:6,
              minimum:6,range:[7,14,21],ammo:18,rack:20,rear:false}],
            equipment:[{type:'LRM 20',location:'RT',slot:3},
              {type:'ammo',location:'RT',slot:8,mass:1,weapon:'LRM 20'}],
            criticalSlots:{RT:['LRM 20',null,'Боезапас LRM 20']},
            sourceUrl:'https://github.com/MegaMek/mm-data/blob/pinned/path.mtf'
          }});
        }
        return respond(route,404,{error:'not_found'});
      });
      await page.locator('#hub-market-button').click();
      await page.locator('#economy-mechs .economy-name').waitFor({state:'visible'});
      await page.locator('#economy-mechs .economy-name').click();
      await page.locator('#economy-detail-dialog[open] h2').filter({hasText:'Griffin GRF-1M'}).waitFor({state:'visible'});
      assert.match(await page.locator('#economy-detail-dialog').textContent(),/Griffin GRF-1M/);
      assert.match(await page.locator('#economy-detail-dialog').textContent(),/275 Fusion/);
      assert.match(await page.locator('#economy-detail-dialog').textContent(),/LRM 20/);
      assert.match(await page.locator('#economy-detail-dialog').textContent(),/ВНУТРЕННЯЯ СТРУКТУРА/);
      await page.locator('#economy-detail-dialog .economy-critical summary').click();
      assert.match(await page.locator('#economy-detail-dialog').textContent(),/Боезапас LRM 20/);
      await page.locator('#economy-detail-dialog .economy-detail-close').click();
      assert.equal(await page.locator('#economy-detail-dialog').evaluate(e=>e.open),false);
      await page.locator('#economy-weight-class').selectOption('medium');
      await page.locator('#economy-tonnage-min').selectOption('50');
      await page.locator('#economy-tonnage-max').selectOption('60');
      const filteredReply=page.waitForResponse(response=>{
        const u=new URL(response.url());
        return u.pathname==='/api/v1/economy/mechs'&&
          u.searchParams.get('weightClass')==='medium'&&
          u.searchParams.get('tonnageMin')==='50'&&
          u.searchParams.get('tonnageMax')==='60'&&
          u.searchParams.get('sort')==='tonnage';
      });
      await page.locator('#economy-sort').selectOption('tonnage');
      await filteredReply;
      assert(calls.some(c=>c.weightClass==='medium'&&c.tonnageMin==='50'&&
        c.tonnageMax==='60'&&c.sort==='tonnage'),
        'The complete set of filters must reach the server');
      const resetReply=page.waitForResponse(response=>{
        const u=new URL(response.url());
        return u.pathname==='/api/v1/economy/mechs'&&
          u.searchParams.get('weightClass')===''&&
          u.searchParams.get('tonnageMin')==='';
      });
      await page.locator('#economy-reset-filters').click();
      await resetReply;
      assert.equal(await page.locator('#economy-tonnage-min').inputValue(),'');
      assert.equal(await page.locator('#economy-weight-class').inputValue(),'');
      assert(calls.some(c=>c.tonnageMin===''&&c.weightClass===''));
    });
  });

test('Operation briefing creates a roster and displays a trusted after-action report',
  {timeout:120000},async()=>{
    await withPage('operations-briefing',{hub:true},async page=>{
      const mechId='11111111-1111-4111-8111-111111111111';
      const opId='22222222-2222-4222-8222-222222222222';
      const roster=[{mechId,chassis:'Griffin 1N',tonnage:55,pilot:null}];
      let operation=null,version=0;
      const json=(route,status,body)=>route.fulfill({status,
        contentType:'application/json',body:JSON.stringify(body)});
      await page.route('**/api/v1/hangar',route=>json(route,200,{
        items:[{id:mechId,chassis:'Griffin 1N',
          state:{config:{tonnage:55}},pilotId:null}]
      }));
      await page.route('**/api/v1/operations**',async route=>{
        const request=route.request();
        const {pathname}=new URL(request.url());
        const method=request.method();
        if(pathname==='/api/v1/operations'&&method==='GET')
          return json(route,200,{items:operation?[operation]:[]});
        if(pathname==='/api/v1/operations'&&method==='POST'){
          const body=request.postDataJSON();
          assert.deepEqual(body.mechIds,[mechId]);
          operation={id:opId,title:body.title,status:'draft',version:0,
            roster,state:null,report:null,result:null};
          return json(route,201,{item:operation});
        }
        if(pathname==='/api/v1/operations/'+opId&&method==='GET')
          return json(route,200,{item:operation});
        if(pathname.endsWith('/launch')&&method==='POST'){
          operation={...operation,status:'active',version:++version,
            state:{round:1,phase:'initiative',units:[],log:[]}};
          return json(route,200,{item:operation});
        }
        if(pathname.endsWith('/advance')&&method==='POST'){
          operation={...operation,status:'completed',version:++version,
            state:{round:2,phase:'end',units:[],log:['Победа']},
            report:{result:'victory',rounds:1,log:['Победа'],
              rewards:[{mechId,chassis:'Griffin 1N',pilotId:null,callsign:null,
                experience:0,wounds:0,destroyed:false,
                armorLost:2,structureLost:0}],
              equipmentNote:'Ремонт пока недоступен.'}};
          return json(route,200,{item:operation});
        }
        return json(route,404,{error:'not_found'});
      });
      await page.locator('#hub-campaigns-button').click();
      await page.locator('#op-create-form').waitFor({state:'visible'});
      await setMechToggle(page.locator('#op-mech-list mech-toggle[name=mechId]'),true);
      await setMechToggle(page.locator('#op-create-form mech-toggle[name=interactive]'),false);
      await page.locator('#op-create').click();
      await page.locator('#op-current .op-overline').waitFor({state:'visible'});
      assert.match(await page.locator('#op-current').textContent(),/ПОДГОТОВКА/);
      await page.getByRole('button',{name:'НАЧАТЬ ОПЕРАЦИЮ'}).click();
      await page.getByRole('button',{name:'ПРОВЕСТИ СЛЕДУЮЩИЙ РАУНД'}).waitFor();
      await page.getByRole('button',{name:'ПРОВЕСТИ СЛЕДУЮЩИЙ РАУНД'}).click();
      await page.locator('.op-outcome.victory').waitFor({state:'visible'});
      assert.match(await page.locator('#op-current').textContent(),/ПОСЛЕБОЕВОЙ РАПОРТ/);
      assert.match(await page.locator('#op-current').textContent(),/Броня −2/);
      await page.locator('.op-history-entry').first().click();
      await page.locator('.op-outcome.victory').waitFor({state:'visible'});
    });
  });


test('Authoritative 3D mode loads a saved snapshot and never applies a rejected dice/phase command',
  {timeout:120000},async()=>{
    const operationId='33333333-3333-4333-8333-333333333333';
    await withPage('server-3d-commands',{
      path:'/index.html?battle=1&operation='+operationId,
      noWebGL:true
    },async page=>{
      const referee=new TestBattleGame();
      let calls=0,snapshotCalls=0;
      const snapshot=()=>JSON.parse(JSON.stringify(referee,
        (key,value)=>key==='map'||key==='rng'?undefined:value));
      const respond=(route,status,item)=>route.fulfill({
        status,contentType:'application/json',body:JSON.stringify(item)
      });
      await page.route('**/api/v1/operations/'+operationId+'/*',async route=>{
        const url=new URL(route.request().url());
        if(url.pathname.endsWith('/snapshot')){
          if(++snapshotCalls===1)return respond(route,503,{error:'temporarily_unavailable'});
          return respond(route,200,{item:{
            id:operationId,controlMode:'interactive',status:'active',
            version:1,game:snapshot()
          }});
        }
        if(url.pathname.endsWith('/command')){
          const payload=route.request().postDataJSON();
          assert.equal(payload.type,'next');
          assert.equal(payload.version,1);
          calls++;
          if(calls===1)return respond(route,422,{error:'illegal_tactical_order'});
          const result=referee.nextPhase();
          assert.equal(result.ok,true);
          return respond(route,200,{item:{
            id:operationId,controlMode:'interactive',status:'active',
            version:2,game:snapshot(),
            effect:{type:'next',result,rolls:[],resolution:[],afterRolls:[],ai:[]}
          }});
        }
        return respond(route,404,{error:'not_found'});
      });
      await loaded(page);
      const retry=page.getByRole('button',{name:'ПОВТОРИТЬ ПОДКЛЮЧЕНИЕ'});
      await retry.waitFor();await retry.click();
      await page.getByText('СЕРВЕРНЫЙ БОЙ:',{exact:false}).waitFor();
      assert.equal(snapshotCalls,2,'A failed snapshot must allow a fresh connection');
      assert.match(await page.locator('#phase').textContent(),/ИНИЦИАТИВА/);
      await page.locator('#next').click();
      await page.getByText('СЕРВЕР ОТКЛОНИЛ ПРИКАЗ',{exact:false}).waitFor();
      assert.match(await page.locator('#phase').textContent(),/ИНИЦИАТИВА/,
        'The browser must not advance if the server rejects an order');
      await page.locator('#next').click();
      await page.waitForFunction(()=>document.querySelector('#phase')
        ?.textContent.includes('ДВИЖЕНИЕ'),null,{timeout:20000});
      assert.equal(calls,2);
      assert.match(await page.locator('#phase').textContent(),/ДВИЖЕНИЕ/);
    });
  });


test('Commander launches an interactive 3D operation from the mission briefing',
  {timeout:120000},async()=>{
    const mechId='44444444-4444-4444-8444-444444444444';
    const id='55555555-5555-4555-8555-555555555555';
    await withPage('interactive-operation-entry',{hub:true,noWebGL:true},async page=>{
      let operation=null;
      const simulation=new TestBattleGame();
      assert(simulation.startStandardDeployment().ok);
      const game=JSON.parse(JSON.stringify(simulation,
        (key,value)=>key==='map'||key==='rng'?undefined:value));
      const result=(route,code,obj)=>route.fulfill({
        status:code,contentType:'application/json',body:JSON.stringify(obj)});
      await page.route('**/api/v1/hangar',route=>result(route,200,{
        items:[{id:mechId,chassis:'Shadow Hawk',state:{config:{tonnage:55}}}]
      }));
      await page.route('**/api/v1/operations**',async route=>{
        const {pathname}=new URL(route.request().url());
        const method=route.request().method();
        if(pathname==='/api/v1/operations'&&method==='GET')
          return result(route,200,{items:operation?[operation]:[]});
        if(pathname==='/api/v1/operations'&&method==='POST'){
          const body=route.request().postDataJSON();
          assert.equal(body.mode,'interactive');
          assert.equal(body.deploymentMode,'standard');
          assert.deepEqual(body.mechIds,[mechId]);
          operation={id,title:body.title,status:'draft',version:0,
            controlMode:'interactive',deploymentMode:body.deploymentMode,roster:[{mechId,chassis:'Shadow Hawk',
              tonnage:55,pilot:null}],state:null,report:null};
          return result(route,201,{item:operation});
        }
        if(pathname.endsWith('/snapshot')&&method==='GET')
          return result(route,200,{item:{...operation,game}});
        if(pathname.endsWith('/launch')&&method==='POST'){
          operation={...operation,status:'active',version:1,
            state:{round:1,phase:'setup',units:[],log:[]}};
          return result(route,200,{item:operation});
        }
        if(pathname==='/api/v1/operations/'+id&&method==='GET')
          return result(route,200,{item:operation});
        return result(route,404,{error:'not_found'});
      });
      await page.locator('#hub-campaigns-button').click();
      await setMechToggle(page.locator('#op-mech-list mech-toggle[name=mechId]'),true);
      assert.equal(await page.locator('#op-create-form mech-toggle[name=interactive]').isChecked(),true);
      await page.locator('#op-create-form select[name=deploymentMode]').selectOption('standard');
      await page.locator('#op-create').click();
      await page.getByRole('button',{name:'НАЧАТЬ ОПЕРАЦИЮ'}).click();
      await page.locator('#hub-battle-frame').waitFor({state:'visible'});
      assert.match(await page.locator('#hub-battle-frame').getAttribute('src'),
        /operation=55555555-5555-4555-8555-555555555555/);
      await page.waitForFunction(()=>{
        const frame=document.querySelector('#hub-battle-frame');
        return frame?.contentDocument?.querySelector('#status')?.textContent
          .includes('SERVER VERIFIED');
      },null,{timeout:60000});
      assert.equal(await page.locator('#hub-work-title').textContent(),'Быстрый бой');
    });
  });

test('Authoritative displacement choice survives reconnect and submits the selected legal hex',
 {timeout:120000},async()=>{
  const operationId='66666666-6666-4666-8666-666666666666';
  await withPage('server-displacement-choice',{
   path:'/index.html?battle=1&operation='+operationId,noWebGL:true
  },async page=>{
   let draws=0,version=1,commands=0;
   const referee=new TestBattleGame({rng:()=>{draws++;return .99;}}),[t,b,a,other]=referee.units;
   for(const tile of referee.tiles)Object.assign(tile,{type:'plain',height:0,depth:0,surface:0});
   Object.assign(a,{q:-1,r:0,facing:0});Object.assign(t,{q:0,r:0});
   Object.assign(b,{q:1,r:0,facing:1,moveMode:'walk',spent:0});
   other.dead=true;referee.phase='physical';referee.initiativeWinner=0;referee.queue=[];referee.activeTeam=null;
   const preview=referee.physicalPreview(a.id,t.id,'push','LA');assert(preview.legal,preview.reason);
   referee.physicalDeclarations=[{id:a.id,target:t.id,type:'push',limb:'LA',...preview}];
   const snapshot=()=>JSON.parse(JSON.stringify(referee,
    (key,value)=>['map','rng','_resolutionReplay'].includes(key)?undefined:value));
   const reply=(route,status,body)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
   await page.route('**/api/v1/operations/'+operationId+'/*',async route=>{
    const url=new URL(route.request().url());
    const item=()=>({id:operationId,controlMode:'interactive',status:'active',version,game:snapshot()});
    if(url.pathname.endsWith('/snapshot'))return reply(route,200,{item:item()});
    if(url.pathname.endsWith('/command')){
     const payload=route.request().postDataJSON();
     assert.equal(payload.type,'next');assert.equal(payload.version,version);
     commands++;
     if(commands===1)assert.equal(payload.choice,undefined);
     if(commands===2)assert.deepEqual(payload.choice,{key:referee.pendingChoice.key,option:'back'});
     const result=referee.nextPhaseWithChoices({humanTeams:[0],choice:payload.choice});
     assert.equal(result.ok,true);version++;
     return reply(route,200,{item:{...item(),effect:{type:'next',result,rolls:[],resolution:[],afterRolls:[],ai:[]}}});
    }
    return reply(route,404,{error:'not_found'});
   });
   await page.reload({waitUntil:'domcontentloaded'});await loaded(page);
   await page.waitForFunction(()=>document.querySelector('#status')?.textContent.includes('v1'));
   await page.locator('#next').click();
   const backward=page.locator('[data-resolution-option="back"]');
   await backward.waitFor({state:'visible'});
   assert(await page.locator('#next').isDisabled());
   assert.match(await page.locator('#actions').textContent(),/PSR 12\//);
   assert.match(await page.locator('#phase').textContent(),/ФИЗИЧЕСКИЕ АТАКИ/);
   assert.equal(draws,4);assert.equal(commands,1);
   const pending=structuredClone(referee.pendingChoice),destination=pending.options.find(o=>o.id==='back');
   await page.reload({waitUntil:'domcontentloaded'});await loaded(page);
   await backward.waitFor({state:'visible'});
   assert.equal(draws,4);assert.equal(commands,1);
   assert.match(await backward.textContent(),new RegExp(destination.q+', '+destination.r));
   await backward.click();
   await page.waitForFunction(()=>document.querySelector('#phase')?.textContent==='НАГРЕВ');
   assert.equal(commands,2);assert.equal(draws,6);
   assert.equal(referee.pendingChoice,null);
   assert.deepEqual([referee.unit(b.id).q,referee.unit(b.id).r],[destination.q,destination.r]);
   assert.equal(await page.locator('[data-resolution-option]').count(),0);
  });
 });

test('Local standard AGoAC deployment selects an entry edge and enters a first full hex',{timeout:120000},async()=>{
 await withPage('local-standard-deployment',{noWebGL:true},async page=>{
  await page.locator('#gamemode').selectOption('hotseat');
  await page.locator('#new').click();
  await page.locator('#confirmstandard').click();
  assert.match(await page.locator('#phase').textContent(),/РАЗВЁРТЫВАНИЕ/);
  assert.equal(await page.locator('#labels .mechlabel[data-on-map="false"]').count(),4);
  await page.locator('#next').click();
  await page.locator('[data-resolution-option="0"]').waitFor({state:'visible'});
  assert.equal(await page.locator('[data-resolution-option]').count(),6);
  await page.locator('[data-resolution-option="0"]').click();
  await page.waitForFunction(()=>document.querySelector('#phase')?.textContent==='ИНИЦИАТИВА'&&!document.querySelector('#next')?.disabled,null,{timeout:60000});
  await page.locator('#next').click();
  await page.locator('#entry-hex').waitFor({state:'visible',timeout:60000});
  assert.equal(await page.locator('#entry-hex option').count(),7);
  await page.locator('#enter-field').click();
  await page.locator('#hold').waitFor({state:'visible',timeout:60000});
  await page.waitForFunction(()=>!document.querySelector('#hold')?.disabled&&document.querySelectorAll('#labels [data-on-map="true"]').length===1);
  assert.match(await page.locator('#actions').textContent(),/1\s*\//);
  assert.equal(await page.locator('#labels .mechlabel[data-on-map="false"]').count(),3);
 });
});


test('Authoritative weapon roll and damage order are independent and survive reconnect',{timeout:120000},async()=>{
 const operationId='77777777-7777-4777-8777-777777777777';
 await withPage('server-fire-order',{path:'/index.html?battle=1&operation='+operationId,noWebGL:true},async page=>{
  let draws=0,version=1;
  const referee=new TestBattleGame({rng:()=>{draws++;return .5;}});
  const [u,,t]=referee.units;
  referee.phase='fire';referee.queue=[];referee.activeTeam=null;referee.initiativeWinner=1;
  const shot=(index,name)=>({index,target:t.id,bin:null,aim:null,heatMode:false,
   weapon:{name,rack:0,ammo:null,heat:1,damage:1,location:'RA'},
   preview:{targetNumber:2,side:'front',cover:false,underwaterCover:false}});
  referee.declarations=[{id:u.id,shots:[shot(0,'First gun'),shot(1,'Second gun')]}];
  const snapshot=()=>JSON.parse(JSON.stringify(referee,
   (key,value)=>['map','rng','_resolutionReplay'].includes(key)?undefined:value));
  const send=(route,status,body)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  await page.route('**/api/v1/operations/'+operationId+'/*',async route=>{
   const url=new URL(route.request().url());
   const item=()=>({id:operationId,controlMode:'interactive',status:'active',version,game:snapshot()});
   if(url.pathname.endsWith('/snapshot'))return send(route,200,{item:item()});
   if(url.pathname.endsWith('/command')){
    const payload=route.request().postDataJSON();
    assert.equal(payload.type,'next');assert.equal(payload.version,version);
    if(version===2)assert.equal(payload.choice.option,'1');
    if(version===3)assert.equal(payload.choice.option,'0');
    const result=referee.nextPhaseWithChoices({humanTeams:[0],choice:payload.choice});
    assert(result.ok);version++;
    return send(route,200,{item:{...item(),effect:{type:'next',result,rolls:[],resolution:[],afterRolls:[],ai:[]}}});
   }
   return send(route,404,{error:'not_found'});
  });
  await page.reload({waitUntil:'domcontentloaded'});await loaded(page);
  await page.waitForFunction(()=>document.querySelector('#status')?.textContent.includes('v1'));
  await page.locator('#next').click();
  const second=page.locator('[data-resolution-option="1"]'),first=page.locator('[data-resolution-option="0"]');
  await second.waitFor({state:'visible'});
  assert.match(await page.locator('#actions').textContent(),/ОЧЕРЁДНОСТЬ БРОСКОВ/);
  assert.match(await second.textContent(),/Second gun/);assert.equal(draws,0);
  await second.click();
  await page.waitForFunction(()=>document.querySelector('#actions')?.textContent.includes('ОЧЕРЁДНОСТЬ УРОНА'));
  assert.equal(draws,4);assert.match(await first.textContent(),/First gun.*8\/2/);
  await page.reload({waitUntil:'domcontentloaded'});await loaded(page);
  await first.waitFor({state:'visible'});
  assert.match(await page.locator('#actions').textContent(),/ОЧЕРЁДНОСТЬ УРОНА/);
  assert.equal(draws,4);await first.click();
  await page.waitForFunction(()=>document.querySelector('#phase')?.textContent==='ФИЗИЧЕСКИЕ АТАКИ');
  assert.equal(draws,8);assert.equal(version,4);assert.equal(referee.pendingChoice,null);
  assert.deepEqual(referee.resolution.map(o=>o.shots[0].index),[0,1]);
 });
});

test('AGoAC p.6: hotseat setup selects forces and requires both players to approve custom design',{timeout:120000},async()=>{
 await withPage('setup-forces-consent',{path:'/mechlab.html',noWebGL:true},async page=>{
  await page.locator('#name').fill('CONSENT CI');
  await page.locator('#check').click();await page.locator('#launch').click();
  await page.waitForURL('**/index.html?custom=1');await loaded(page);
  await page.locator('#setup-approve-green').waitFor({state:'visible'});await page.locator('#close').click();
  await page.locator('#gamemode').selectOption('hotseat');await page.locator('#new').click();
  await page.locator('[data-setup-slot="0"]').selectOption('custom');
  await page.locator('[data-setup-slot="1"]').selectOption('none');
  await page.locator('[data-setup-slot="2"]').selectOption('0');
  assert(await page.locator('#confirmstandard').isDisabled());
  await setMechToggle(page.locator('#setup-approve-green'),true);assert(await page.locator('#confirmstandard').isDisabled());
  await setMechToggle(page.locator('#setup-approve-red'),true);assert(await page.locator('#confirmstandard').isEnabled());
  await page.locator('[data-setup-slot="3"]').selectOption('none');
  assert(await page.locator('#confirmstandard').isDisabled());
  await setMechToggle(page.locator('#setup-approve-green'),true);await setMechToggle(page.locator('#setup-approve-red'),true);
  await page.locator('#confirmstandard').click();
  assert.equal(await page.locator('#allies .unitcard').count(),1);assert.equal(await page.locator('#enemies .unitcard').count(),1);
  assert.match(await page.locator('#allies .unitcard strong').textContent(),/CONSENT CI/);
  assert.match(await page.locator('#phase').textContent(),/РАЗВЁРТЫВАНИЕ/);
  await page.locator('#all-records').click();assert.equal(await page.locator('#record-list [data-record-id]').count(),2);
 });
});

test('AGoAC p.6: new battle selects and displays the battlefield and resets to a different map',{timeout:120000},async()=>{
 await withPage('setup-map',{noWebGL:true},async page=>{
  await page.locator('#new').click();await page.locator('#setup-map').selectOption('river');
  await page.locator('#setup-map-rotation').selectOption('2');
  await page.locator('#confirmstandard').click();
  assert.equal(await page.locator('#viewport').getAttribute('data-map-layout'),'river');
  assert.equal(await page.locator('#viewport').getAttribute('data-map-rotation'),'2');
  assert.match(await page.locator('#battle-map-label').textContent(),/Речная долина/);
  assert.match(await page.locator('#phase').textContent(),/РАЗВЁРТЫВАНИЕ/);
  await page.locator('#new').click();await page.locator('#setup-map').selectOption('clear');
  await page.locator('#confirmreset').click();
  assert.equal(await page.locator('#viewport').getAttribute('data-map-layout'),'clear');
  assert.equal(await page.locator('#viewport').getAttribute('data-map-rotation'),'0');
  assert.match(await page.locator('#phase').textContent(),/ИНИЦИАТИВА/);
  assert.equal(await page.locator('#viewport canvas').count(),1);
 });
});

test('AGoAC p.6: joined mapsheets can be selected independently in local battle setup',{timeout:120000},async()=>{
 await withPage('setup-sheets',{noWebGL:true},async page=>{
  await page.locator('#new').click();
  assert.equal(await page.locator('#setup-second-sheet').isVisible(),false);
  await page.locator('#setup-layout').selectOption('horizontal');
  assert.equal(await page.locator('#setup-second-sheet').isVisible(),true);
  await page.locator('#setup-layout').selectOption('sheet');
  assert.equal(await page.locator('#setup-second-sheet').isVisible(),false);
  await page.locator('#setup-layout').selectOption('vertical');
  assert.equal(await page.locator('#setup-second-sheet').isVisible(),true);
  await page.locator('#setup-layout').selectOption('horizontal');
  await page.locator('#setup-map').selectOption('clear');
  await page.locator('#setup-map-2').selectOption('river');
  await page.locator('#setup-map-rotation-2').selectOption('3');
  await page.locator('#confirmstandard').click();
  assert.equal(await page.locator('#viewport').getAttribute('data-sheet-layout'),'horizontal');
  assert.equal(await page.locator('#viewport').getAttribute('data-hex-count'),'544');
  assert.match(await page.locator('#battle-map-label').textContent(),/Открытая равнина.*Речная долина/);
  await page.locator('#new').click();await page.locator('#confirmreset').click();
  assert.equal(await page.locator('#viewport').getAttribute('data-hex-count'),'127');
 });
});

test('AGoAC p.6: additional local Mech models and records follow roster changes',{timeout:120000},async()=>{
 await withPage('expanded-local-roster',{noWebGL:true},async page=>{
  await page.locator('#new').click();
  await page.locator('#setup-add-green').click();await page.locator('#setup-add-green').click();
  await page.locator('#setup-add-red').click();
  assert.equal(await page.locator('[data-extra-team="0"]').count(),2);
  await page.locator('[data-remove-extra="0"]').first().click();
  await page.locator('[data-extra-team="0"]').selectOption('3');
  await page.locator('#confirmreset').click();
  assert.equal(await page.locator('#allies .unitcard').count(),3);assert.equal(await page.locator('#enemies .unitcard').count(),3);
  assert.equal(await page.locator('#labels .mechlabel[data-on-map="true"]').count(),6);
  await page.locator('#all-records').click();assert.equal(await page.locator('#record-list [data-record-id]').count(),6);
  await page.locator('#close').click();await page.locator('#new').click();await page.locator('#confirmreset').click();
  assert.equal(await page.locator('#labels .mechlabel').count(),4);
  assert.equal(await page.locator('#allies .unitcard').count(),2);
 });
});


test('AGoAC p.7: hotseat round-limit victory terms require fresh approval by both sides',{timeout:120000},async()=>{
 await withPage('setup-victory-consent',{noWebGL:true},async page=>{
  await page.locator('#gamemode').selectOption('hotseat');await page.locator('#new').click();
  assert(await page.locator('#confirmreset').isEnabled());
  await page.locator('#setup-victory').selectOption('limit');
  assert(await page.locator('#confirmreset').isDisabled());
  await setMechToggle(page.locator('#setup-victory-green'),true);assert(await page.locator('#confirmreset').isDisabled());
  await setMechToggle(page.locator('#setup-victory-red'),true);assert(await page.locator('#confirmreset').isEnabled());
  await page.locator('#setup-round-limit').fill('2');await page.locator('#setup-round-limit').blur();
  assert(await page.locator('#confirmreset').isDisabled());assert(!(await page.locator('#setup-victory-green').isChecked()));assert(!(await page.locator('#setup-victory-red').isChecked()));
  await setMechToggle(page.locator('#setup-victory-green'),true);await setMechToggle(page.locator('#setup-victory-red'),true);
  await page.locator('#confirmreset').click();await page.locator('#modal').waitFor({state:'hidden'});
  assert.match(await page.locator('#phase').textContent(),/ИНИЦИАТИВА/);
 });
});


test('AGoAC p.7: custom local victory terms require agreement and are rendered as plain text',{timeout:180000},async()=>{
 await withPage('custom-victory-consent',{noWebGL:true},async page=>{
  await page.locator('#new').click();
  assert.equal(await page.locator('#setup-victory option[value="custom"]').evaluate(option=>option.disabled),true);
  await page.locator('#close').click();
  await page.locator('#gamemode').selectOption('hotseat');await page.locator('#new').click();await page.locator('#setup-victory').selectOption('custom');
  await page.locator('#setup-condition').fill('Hold <b>A</b>');await setMechToggle(page.locator('#setup-victory-green'),true);assert(await page.locator('#confirmreset').isDisabled());
  await setMechToggle(page.locator('#setup-victory-red'),true);assert(await page.locator('#confirmreset').isEnabled());
  await page.locator('#setup-condition').fill('Hold <b>B</b>');assert(await page.locator('#confirmreset').isDisabled());
  await setMechToggle(page.locator('#setup-victory-green'),true);await setMechToggle(page.locator('#setup-victory-red'),true);await page.locator('#confirmreset').click();
  assert.match(await page.locator('#agreed-victory-condition').textContent(),/Hold <b>B<\/b>/);assert.equal(await page.locator('#agreed-victory-condition b').count(),0);assert.equal(await page.locator('#adjudicate-victory').count(),0);
  await page.locator('#next').click();await page.locator('#hold').waitFor({timeout:50000});
  for(const phase of ['movement','fire','physical']){await completeOrders(page,phase);await page.locator('#next').click();}
  await page.locator('#next').click();await page.locator('#next').click();
  await page.locator('#adjudicate-victory').click();
  assert.equal(await page.locator('#verdict-condition').textContent(),'Hold <b>B</b>');
  await setMechToggle(page.locator('#verdict-green'),true);assert(await page.locator('#verdict-confirm').isDisabled());
  await setMechToggle(page.locator('#verdict-red'),true);assert(await page.locator('#verdict-confirm').isEnabled());
  await page.locator('#verdict-outcome').selectOption('1');assert(await page.locator('#verdict-confirm').isDisabled());
  await setMechToggle(page.locator('#verdict-green'),true);await setMechToggle(page.locator('#verdict-red'),true);
  await page.locator('#verdict-confirm').click();assert(await page.locator('#next').isDisabled());assert.equal(await page.locator('#adjudicate-victory').count(),0);
 });
});


test('AGoAC p.7: standard two-player stalemate confirmation is available only at the round boundary',{timeout:180000},async()=>{
 await withPage('local-stalemate-verdict',{noWebGL:true},async page=>{
  await page.locator('#gamemode').selectOption('hotseat');
  assert.equal(await page.locator('#adjudicate-stalemate').count(),0);
  await page.locator('#next').click();await page.locator('#hold').waitFor({timeout:50000});
  for(const phase of ['movement','fire','physical']){await completeOrders(page,phase);await page.locator('#next').click();}
  await page.locator('#next').click();await page.locator('#next').click();
  await page.locator('#adjudicate-stalemate').click();assert(await page.locator('#stalemate-confirm').isDisabled());
  await setMechToggle(page.locator('#stalemate-green'),true);assert(await page.locator('#stalemate-confirm').isDisabled());
  await setMechToggle(page.locator('#stalemate-red'),true);assert(await page.locator('#stalemate-confirm').isEnabled());
  await page.locator('#stalemate-confirm').click();assert(await page.locator('#next').isDisabled());assert.equal(await page.locator('#adjudicate-stalemate').count(),0);
 });
});


test('AGoAC pp.6–7: ordinary physical Mech order choices survive reconnect and keep every attack roll',{timeout:120000},async()=>{
 const operationId='88888888-8888-4888-8888-888888888888';
 await withPage('server-physical-order',{path:'/index.html?battle=1&operation='+operationId,noWebGL:true},async page=>{
  let draws=0,version=1;
  const referee=new TestBattleGame({rng:()=>{draws++;return .5;}}),[a,b,t]=referee.units;
  referee.phase='physical';referee.queue=[];referee.activeTeam=null;referee.initiativeWinner=1;
  referee.physicalDeclarations=[a,b].map(u=>({id:u.id,target:t.id,type:'punch',limb:'LA',targetNumber:2,damage:1,side:'front',table:'punch'}));
  referee.physicalDeclarations.push({...referee.physicalDeclarations[0],limb:'RA'});
  const snapshot=()=>JSON.parse(JSON.stringify(referee,(key,value)=>['map','rng','_resolutionReplay'].includes(key)?undefined:value));
  const send=(route,status,body)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  await page.route('**/api/v1/operations/'+operationId+'/*',async route=>{
   const url=new URL(route.request().url());
   const item=()=>({id:operationId,controlMode:'interactive',status:'active',version,game:snapshot()});
   if(url.pathname.endsWith('/snapshot'))return send(route,200,{item:item()});
   if(url.pathname.endsWith('/command')){
    const payload=route.request().postDataJSON();assert.equal(payload.type,'next');assert.equal(payload.version,version);
    if(version===2)assert.equal(payload.choice.option,String(b.id));
    if(version===3){assert.equal(referee.pendingChoice.context.scope,'attack');assert.equal(payload.choice.option,'1');}
    if(version===4)assert.equal(payload.choice.option,String(a.id));
    if(version===5){assert.equal(referee.pendingChoice.context.scope,'attack');assert.equal(payload.choice.option,'1');}
    const result=referee.nextPhaseWithChoices({humanTeams:[0],choice:payload.choice});assert(result.ok);version++;
    return send(route,200,{item:{...item(),effect:{type:'next',result,rolls:[],resolution:[],afterRolls:[],ai:[]}}});
   }
   return send(route,404,{error:'not_found'});
  });
  await page.reload({waitUntil:'domcontentloaded'});await loaded(page);
  await page.waitForFunction(()=>document.querySelector('#status')?.textContent.includes('v1'));
  await page.locator('#next').click();
  const second=page.locator('[data-resolution-option="'+b.id+'"]'),first=page.locator('[data-resolution-option="'+a.id+'"]');
  await second.waitFor({state:'visible'});assert.match(await page.locator('#actions').textContent(),/ПОРЯДОК БРОСКОВ/);assert.equal(draws,0);
  await second.click();
  await page.waitForFunction(()=>document.querySelector('#actions .controltitle')?.textContent.includes('ПОРЯДОК БРОСКОВ · УДАР'));
  await page.getByRole('button',{name:/правая рука/}).waitFor({state:'visible'});
  assert.equal(referee.pendingChoice.context.scope,'attack');
  await page.getByRole('button',{name:/правая рука/}).click();
  await page.waitForFunction(()=>document.querySelector('#actions')?.textContent.includes('ПОРЯДОК УРОНА'));
  assert.equal(draws,6);assert.equal(referee.pendingChoice.context.stage,'damage');
  await page.reload({waitUntil:'domcontentloaded'});await loaded(page);await first.waitFor({state:'visible'});
  assert.match(await page.locator('#actions').textContent(),/ПОРЯДОК УРОНА/);assert.equal(draws,6);
  await first.click();
  await page.waitForFunction(()=>document.querySelector('#actions .controltitle')?.textContent.includes('ПОРЯДОК УРОНА · УДАР'));
  await page.getByRole('button',{name:/левая рука/}).waitFor({state:'visible'});
  assert.equal(referee.pendingChoice.context.scope,'attack');assert.equal(draws,6);
  await page.getByRole('button',{name:/левая рука/}).click();
  await page.waitForFunction(()=>document.querySelector('#phase')?.textContent==='НАГРЕВ');
  assert.equal(version,6);assert.equal(referee.pendingChoice,null);assert(draws>6);
  assert.deepEqual(referee.resolution.map(o=>o.id),[a.id,a.id,b.id]);
 });
});

test('AGoAC p.21: browser selects LRM spotter, submits server declaration and restores the committed shot',{timeout:120000},async()=>{
 const operationId='99999999-9999-4999-8999-999999999999';
 await withPage('server-indirect-lrm',{path:'/index.html?battle=1&operation='+operationId,noWebGL:true},async page=>{
  let version=1,commands=0;
  const g=new TestBattleGame({rng:()=>.5});
  const [u,s,t,other]=g.units;
 for(const h of g.tiles)Object.assign(h,{type:'plain',depth:0,height:0,surface:0});
 Object.assign(u,{q:0,r:0,facing:0,prone:false,twist:0,moveMode:'stand',fired:false});
 Object.assign(s,{q:4,r:-3,facing:5,prone:false,twist:0,moveMode:'stand',fired:false});
 Object.assign(t,{q:4,r:0,prone:false,moveMode:'stand',fired:false});
 Object.assign(other,{q:-3,r:0});
 g.tile(2,0).height=2;
 u.weapons=[{name:'LRM 10',heat:4,damage:1,min:6,ammo:24,location:'RT',ranges:[7,14,21],rack:10}];
 u.bins=[{weapon:0,location:'RT',slot:1,shots:24,destroyed:false}];
 g.phase='fire';g.activeTeam=u.team;g.queue=[u.team,s.team,t.team];g.actingId=u.id;
  const snapshot=()=>JSON.parse(JSON.stringify(g,(key,value)=>['map','rng','_resolutionReplay'].includes(key)?undefined:value));
  const send=(route,status,body)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  await page.route('**/api/v1/operations/'+operationId+'/*',async route=>{
   const url=new URL(route.request().url());
   const item=()=>({id:operationId,controlMode:'interactive',status:'active',version,game:snapshot()});
   if(url.pathname.endsWith('/snapshot'))return send(route,200,{item:item()});
   if(url.pathname.endsWith('/command')){
    const payload=route.request().postDataJSON();
    assert.equal(payload.type,'fire');assert.equal(payload.version,version);assert.equal(payload.id,u.id);
    assert.equal(payload.primaryTarget,t.id);assert.equal(payload.shots.length,1);
    assert.equal(payload.shots[0].spotter,s.id);assert.equal(payload.shots[0].target,t.id);
    const effect=runTacticalOrder(g,payload);
    assert(effect.result.ok&&effect.result.declared);commands++;version++;
    return send(route,200,{item:{...item(),effect}});
   }
   return send(route,404,{error:'not_found'});
  });
  await page.reload({waitUntil:'domcontentloaded'});await loaded(page);
  await page.waitForFunction(()=>document.querySelector('#status')?.textContent.includes('v1'));
  const target=page.locator('[data-target="0"]'),spotter=page.locator('[data-spotter="0"]');
  await target.selectOption(String(t.id));
  assert.match(await page.locator('.weapon').first().textContent(),/Линия огня перекрыта/);
  await spotter.selectOption(String(s.id));
  assert.match(await page.locator('.weapon').first().textContent(),/\d+\+ · \d+%/);
  await page.locator('#fire').click();
  await page.waitForFunction(()=>document.querySelector('#status')?.textContent.includes('v2'));
  assert.equal(commands,1);assert.equal(g.declarations[0].shots[0].spotter,s.id);assert.equal(u.bins[0].shots,23);
  await page.reload({waitUntil:'domcontentloaded'});await loaded(page);
  await page.waitForFunction(()=>document.querySelector('#status')?.textContent.includes('v2'));
  assert.equal(commands,1);assert.equal(u.bins[0].shots,23);
 });
});
test('AGoAC p.21: browser declares aimed and ordinary weapons independently',{timeout:120000},async()=>{
 const operationId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 await withPage('server-per-weapon-aim',{path:'/index.html?battle=1&operation='+operationId,noWebGL:true},async page=>{
  let version=1,commands=0;
  const g=new TestBattleGame({rng:()=>.5}),[u,s,t,other]=g.units;
  for(const h of g.tiles)Object.assign(h,{type:'plain',depth:0,height:0,surface:0});
  Object.assign(u,{q:0,r:0,facing:0,prone:false,twist:0,moveMode:'stand',fired:false});
  Object.assign(s,{q:-3,r:-1});Object.assign(t,{q:3,r:0,prone:false,shutdown:true});Object.assign(other,{q:-3,r:1});
  const laser={name:'Medium Laser',heat:3,damage:5,min:0,ammo:null,location:'CT',ranges:[3,6,9],rack:0};
  u.weapons=[laser,{...laser,location:'RT'}];
  g.phase='fire';g.activeTeam=u.team;g.queue=[u.team,s.team,t.team];g.actingId=u.id;
  const snapshot=()=>JSON.parse(JSON.stringify(g,(key,value)=>['map','rng','_resolutionReplay'].includes(key)?undefined:value));
  const send=(route,status,body)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  await page.route('**/api/v1/operations/'+operationId+'/*',async route=>{
   const item=()=>({id:operationId,controlMode:'interactive',status:'active',version,game:snapshot()});
   const path=new URL(route.request().url()).pathname;
   if(path.endsWith('/snapshot'))return send(route,200,{item:item()});
   if(path.endsWith('/command')){
    const payload=route.request().postDataJSON();
    assert.equal(payload.type,'fire');assert.equal(payload.shots.length,2);
    assert.equal(payload.shots[0].aim,'CT');assert.equal(payload.shots[1].aim,null);
    const effect=runTacticalOrder(g,payload);
    assert(effect.result.ok&&effect.result.declared);commands++;version++;
    return send(route,200,{item:{...item(),effect}});
   }
   return send(route,404,{error:'not_found'});
  });
  await page.reload({waitUntil:'domcontentloaded'});await loaded(page);
  await page.waitForFunction(()=>document.querySelector('#status')?.textContent.includes('v1'));
  await page.locator('[data-target="0"]').selectOption(String(t.id));
  await page.locator('[data-target="1"]').selectOption(String(t.id));
  await page.locator('[data-aim="0"]').selectOption('CT');
  assert.equal(await page.locator('[data-aim="1"]').inputValue(),'');
  await page.locator('#fire').click();
  await page.waitForFunction(()=>document.querySelector('#status')?.textContent.includes('v2'));
  assert.equal(commands,1);assert.deepEqual(g.declarations[0].shots.map(s=>s.aim),['CT',null]);
 });
});

 test('Mechanical cockpit toggles retain independent state, keyboard and disabled semantics',{timeout:120000},async()=>{
  await withPage('mech-toggle-controls',{noWebGL:true},async page=>{
   const arcs=page.locator('#arctoggle');
   const night=page.locator('#night'),gale=page.locator('#gale');
   assert.equal(await page.locator('input[type=checkbox]').count(),0);
   await setMechToggle(arcs,false);
   await arcs.getByRole('switch').focus();await page.keyboard.press('Space');
   assert.equal(await arcs.evaluate(el=>el.checked),true);
   assert.equal(await arcs.getByRole('switch').getAttribute('aria-checked'),'true');
   await setMechToggle(night,true);assert.equal(await gale.evaluate(el=>el.checked),false);
   await setMechToggle(gale,true);
   await night.evaluate(el=>{el.disabled=true;});
   assert(await night.getByRole('switch').isDisabled());
   assert.equal(await night.evaluate(el=>el.checked),true);
   await night.evaluate(el=>{el.disabled=false;});await setMechToggle(night,false);
   assert.equal(await gale.evaluate(el=>el.checked),true);
  });
 });
