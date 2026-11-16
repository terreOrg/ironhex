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
const browserPilots=[];

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
  await browser?.close();
  if (server?.listening) await new Promise(done => server.close(done));
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
      await page.locator('#op-mech-list input[name=mechId]').check();
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
