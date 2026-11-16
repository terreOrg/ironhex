import {firingArcTiles} from './fire-arcs.js';
import {construct} from './construction.js';
import {recordSheet} from './record-sheet.js';
import {animateRoll,clearDice} from './dice.js';
import * as THREE from 'three';
import {GLTFLoader} from './GLTFLoader.js';
import {clone} from './SkeletonUtils.js';
import {Game,LOCATIONS,distance,PHASES} from './engine.js';
const $=s=>document.querySelector(s),game=new Game();
const operationId=new URLSearchParams(location.search).get('operation');
const remoteMode=operationId!==null;
let remoteVersion=0,remoteReady=false,remoteFinished=false;
let selected=0,target=null,mode='walk',busy=remoteMode,hotseat=false,team=0,angle=Math.PI/4,zoom=12,reach=[],picked=new Set(),records=new Map(),effects=[];
const scene=new THREE.Scene();scene.background=new THREE.Color('#28362d');scene.fog=new THREE.Fog('#28362d',30,65);
const camera=new THREE.OrthographicCamera(-15,15,15,-15,.1,100);let software=false;let renderer;try{renderer=new THREE.WebGLRenderer({antialias:true});}catch(e){software=true;const canvas=document.createElement('canvas');renderer={domElement:canvas,shadowMap:{},setPixelRatio(){},setSize(w,h){canvas.width=w;canvas.height=h;},render(){drawFallback();}};}renderer.setPixelRatio(Math.min(devicePixelRatio,1.75));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.15;$('#viewport').appendChild(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xc6ddbf,0x394332,2.5));const sun=new THREE.DirectionalLight(0xffe1a1,3.6);sun.position.set(-10,22,8);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-18,right:18,top:18,bottom:-18,near:1,far:65});sun.shadow.bias=-.001;scene.add(sun);
const world=(q,r)=>new THREE.Vector3(Math.sqrt(3)*(q+r/2),0,1.5*r);const groundY=(q,r)=>.14+game.tile(q,r).height*.45;
const hexgeo=new THREE.CylinderGeometry(.977,.977,.32,6);const tileMeshes=[];const baseColors={plain:0x627057,woods:0x465d43,heavy:0x3d533e,hill:0x88876a,water:0x436e78,rough:0x8a7c61,rubble:0x777e77};
function seeded(n){return Math.abs(Math.sin(n*127.1+311.7)*43758.54)%1;}
for(const [i,t]of game.tiles.entries()){
 const mat=new THREE.MeshStandardMaterial({color:baseColors[t.type],roughness:1});mat.color.multiplyScalar(.87+seeded(i)*.22);const h=new THREE.Mesh(hexgeo,mat);h.position.copy(world(t.q,t.r));h.position.y=t.height*.45;h.receiveShadow=true;h.userData.tile=t;scene.add(h);tileMeshes.push(h);t.mesh=h;t.original=mat.color.clone();
 if(t.height){const side=new THREE.Mesh(new THREE.CylinderGeometry(.97,1,.5,6),new THREE.MeshStandardMaterial({color:0x555a44,roughness:1}));side.position.copy(h.position);side.position.y=-.15;scene.add(side);side.receiveShadow=true;}
 if(t.type==='woods'||t.type==='heavy')for(let j=0;j<(t.type==='heavy'?5:3);j++){
 const x=(seeded(i*5+j)-.5)*1.2,z=(seeded(i*7+j)-.5)*1.2;const tree=new THREE.Group();const trunk=new THREE.Mesh(new THREE.CylinderGeometry(.04,.06,.5,5),new THREE.MeshStandardMaterial({color:0x423b2b}));trunk.position.y=.25;tree.add(trunk);for(let k=0;k<3;k++){const foliage=new THREE.Mesh(new THREE.ConeGeometry(.25-k*.05,.65,5),new THREE.MeshStandardMaterial({color:[0x263e2c,0x344d32,0x445b38][k],roughness:1}));foliage.position.y=.6+k*.2;foliage.castShadow=true;tree.add(foliage);}tree.position.copy(h.position);tree.position.add(new THREE.Vector3(x,.16,z));scene.add(tree);
 }else if(seeded(i+40)>.7){let rock=new THREE.Mesh(new THREE.DodecahedronGeometry(.14+seeded(i)*.15,0),new THREE.MeshStandardMaterial({color:0x878775,roughness:1}));rock.position.copy(h.position).add(new THREE.Vector3(.45,.15,-.3));rock.scale.y=.6;rock.castShadow=true;scene.add(rock);}
}
const plane=new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.MeshStandardMaterial({color:0x26382b,roughness:1}));plane.rotation.x=-Math.PI/2;plane.position.y=-2.5;plane.receiveShadow=true;scene.add(plane);
// Military survey markers around the board.
for(let i=0;i<6;i++){const p=world(Math.cos(i*Math.PI/3)*7,Math.sin(i*Math.PI/3)*7);const m=new THREE.Mesh(new THREE.BoxGeometry(.08,.9,.08),new THREE.MeshStandardMaterial({color:0x9ca886}));m.position.copy(p);m.position.y=.1;scene.add(m);}
const selection=new THREE.Mesh(new THREE.RingGeometry(.83,.92,6),new THREE.MeshBasicMaterial({color:0xd7ff87,side:THREE.DoubleSide,transparent:true,opacity:.9}));selection.rotation.x=-Math.PI/2;scene.add(selection);
const targetRing=selection.clone();targetRing.material=new THREE.MeshBasicMaterial({color:0xff977e,side:THREE.DoubleSide});scene.add(targetRing);targetRing.visible=false;
let arcsEnabled=true,arcWeapon='all',arcTiles=new Map();
const arcColors=[0x59dccc,0xe5c578,0xc88d69],arcMeshes=new Map();
const arcGeo=new THREE.CircleGeometry(.93,6);arcGeo.rotateZ(Math.PI/6);arcGeo.rotateX(-Math.PI/2);
const arcMaterials=arcColors.map(color=>new THREE.MeshBasicMaterial({color,side:THREE.DoubleSide,transparent:true,opacity:.24,depthWrite:false}));
for(const t of game.tiles){const mesh=new THREE.Mesh(arcGeo,arcMaterials[0]);mesh.position.copy(world(t.q,t.r));mesh.position.y=groundY(t.q,t.r)+.035;mesh.visible=false;mesh.renderOrder=1;scene.add(mesh);arcMeshes.set(t.q+','+t.r,mesh);}
function updateArcs(){const u=game.units[selected];if(arcWeapon!=='all'&&!u.weapons[+arcWeapon])arcWeapon='all';
 const indices=arcWeapon==='all'?u.weapons.map((_,i)=>i).filter(i=>game.phase!=='fire'||picked.has(i)):[+arcWeapon];
 arcTiles=arcsEnabled&&!busy?firingArcTiles(game,u,indices):new Map();
 for(const [key,mesh]of arcMeshes){mesh.visible=arcTiles.has(key);if(mesh.visible)mesh.material=arcMaterials[arcTiles.get(key)];}
 $('#arctoggle').setAttribute('aria-pressed',String(arcsEnabled));$('#arctoggle').textContent=arcsEnabled?'СЕКТОР ОГНЯ ●':'СЕКТОР ОГНЯ ○';
 $('#arcweapon').innerHTML='<option value="all">Всё выбранное оружие</option>'+u.weapons.map((w,i)=>`<option value="${i}" ${arcWeapon===String(i)?'selected':''}>${w.name} · ${w.location}${w.rear?' / корма':''}</option>`).join('');
 $('#arcweapon').value=arcWeapon;$('#arcinfo').textContent=arcsEnabled?u.name+' · '+arcTiles.size+' гексов':'Секторы скрыты';$('#arclegend').hidden=!arcsEnabled;
}
$('#arctoggle').onclick=()=>{arcsEnabled=!arcsEnabled;updateArcs();};$('#arcweapon').onchange=()=>{arcWeapon=$('#arcweapon').value;updateArcs();};
function resize(){const w=$('#viewport').clientWidth,h=$('#viewport').clientHeight;renderer.setSize(w,h);const a=w/h;camera.left=-zoom*a;camera.right=zoom*a;camera.top=zoom;camera.bottom=-zoom;camera.updateProjectionMatrix();const hud=$('.visor-reticle span');if(hud)hud.textContent='AZIMUTH '+((Math.round(angle*180/Math.PI)%360+360)%360)+'° · ZOOM '+zoom.toFixed(1);}
function cam(){camera.position.set(Math.cos(angle)*23,23,Math.sin(angle)*23);camera.lookAt(0,0,0);camera.updateMatrixWorld();resize();}new ResizeObserver(resize).observe($('#viewport'));cam();
const loader=new GLTFLoader();
async function load(){try{const templates=await Promise.all(['aether-02.glb','atlas-09.glb'].map(f=>loader.loadAsync(f)));for(const u of game.units){let gltf=templates[u.id%2],model=clone(gltf.scene),box=new THREE.Box3().setFromObject(model),size=box.getSize(new THREE.Vector3()),scale=(u.tonnage===65?2.25:2)/size.y;model.scale.setScalar(scale);model.position.y=-box.min.y*scale;const root=new THREE.Group();root.add(model);root.position.copy(world(u.q,u.r));root.position.y=groundY(u.q,u.r);root.rotation.y=u.team? -Math.PI/2:Math.PI/2;model.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});const disc=new THREE.Mesh(new THREE.CylinderGeometry(.55,.55,.055,32),new THREE.MeshStandardMaterial({color:u.team?0xda7560:0xb8df6c,emissive:u.team?0x44211b:0x283b14,roughness:.4}));disc.position.y=.025;root.add(disc);const arrow=new THREE.Mesh(new THREE.ConeGeometry(.13,.4,3),new THREE.MeshBasicMaterial({color:u.team?0xffaa88:0xe0ff9a}));arrow.rotation.x=Math.PI/2;arrow.position.set(0,.08,.8);root.add(arrow);scene.add(root);const mixer=new THREE.AnimationMixer(model),actions={};for(const clip of gltf.animations)actions[clip.name]=mixer.clipAction(clip);const label=document.createElement('div');label.className='mechlabel'+(u.team?' red':'');label.textContent=`${u.id+1} / ${u.name.toUpperCase()}`;$('#labels').appendChild(label);records.set(u.id,{root,model,mixer,actions,label,state:null,dead:false});play(u.id,'Sentinel');}$('#loading').style.display='none';if(software)toast('WebGL недоступен: резервная тактическая карта. Для 3D включите аппаратное ускорение.');renderUI();}catch(e){$('#loading').innerHTML='Не удалось загрузить 3D-модели.<br>Обновите страницу для повторной загрузки.';console.error(e);}}
function play(id,name,once=false){let rec=records.get(id);if(!rec)return;let action=rec.actions[name]||rec.actions.Sentinel;if(!action||rec.state===name&&!once)return;Object.values(rec.actions).forEach(a=>a.fadeOut(.18));action.reset().setLoop(once?THREE.LoopOnce:THREE.LoopRepeat,once?1:Infinity);action.clampWhenFinished=once;action.fadeIn(.18).play();rec.state=name;}
const pause=ms=>new Promise(r=>setTimeout(r,ms));
function toast(text){$('#toast').textContent=text;}
function sum(o){return Object.values(o).reduce((a,b)=>a+b,0);}

function applyServerState(state){
  if(!state||!Array.isArray(state.tiles)||!Array.isArray(state.units)||
     state.units.length!==4)throw Error('invalid_server_snapshot');
  const original=new Map(game.tiles.map(t=>[t.q+','+t.r,
    {mesh:t.mesh,original:t.original}]));
  Object.assign(game,state);
  game.map=new Map(game.tiles.map(t=>[t.q+','+t.r,t]));
  for(const tile of game.tiles){
    const old=original.get(tile.q+','+tile.r);
    if(old){tile.mesh=old.mesh;tile.original=old.original;
      if(tile.mesh)tile.mesh.userData.tile=tile;}
  }
  const current=game.units[selected];
  if(!current||current.dead)selected=game.units.find(u=>u.team===0&&!u.dead)?.id??0;
  mode=game.units[selected].moveMode==='stand'?'walk':game.units[selected].moveMode;
  picked=new Set(game.units[selected].weapons.map((_,i)=>i));
  target=null;weaponTargets={};weaponBins={};
}
function reportAccess(){
  if(!remoteMode||!remoteFinished)return;
  const panel=$('#actions');
  if($('#server-report-button'))return;
  const button=document.createElement('button');
  button.id='server-report-button';
  button.className='primary';
  button.textContent='▤ ОТКРЫТЬ ПОСЛЕБОЕВОЙ РАПОРТ';
  button.onclick=()=>{
    if(window.parent!==window)
      window.parent.postMessage({type:'ironhex:operation-report',id:operationId},location.origin);
    else location.href='index.html';
  };
  panel.append(button);
}
async function joinServerBattle(){
  if(!remoteMode)return;
  busy=true;
  renderUI();
  try{
    const res=await fetch('/api/v1/operations/'+encodeURIComponent(operationId)+'/snapshot',
      {credentials:'same-origin',cache:'no-store'});
    const body=await res.json();
    if(!res.ok)throw Error(body.error||'HTTP '+res.status);
    if(body.item.controlMode!=='interactive'||!body.item.game)
      throw Error('Операция не активна или не поддерживает 3D-команды');
    remoteVersion=body.item.version;
    remoteFinished=body.item.status==='completed';
    applyServerState(body.item.game);
    remoteReady=true;
    busy=remoteFinished;
    syncModels();renderUI();reportAccess();
    toast(remoteFinished?'Операция завершена. Посмотрите рапорт.':
      'СЕРВЕРНЫЙ БОЙ: приказы проверяются и сохраняются на сервере.');
  }catch(e){
    busy=true;remoteReady=false;renderUI();
    toast('Нет связи с серверным боем: '+e.message);
    const button=document.createElement('button');
    button.textContent='ПОВТОРИТЬ ПОДКЛЮЧЕНИЕ';
    button.onclick=()=>void joinServerBattle();
    $('#actions').append(button);
  }
}
async function serverCommand(order){
  if(!remoteMode)return;
  if(!remoteReady||busy||remoteFinished)return;
  if(!order){toast('Этот приказ пока не подключён к серверу.');return;}
  busy=true;renderUI();
  try{
    const response=await fetch('/api/v1/operations/'+encodeURIComponent(operationId)+'/command',{
      method:'POST',credentials:'same-origin',cache:'no-store',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({...order,version:remoteVersion})
    });
    const data=await response.json();
    if(!response.ok){
      if(response.status===409){
        busy=false;await joinServerBattle();
      }
      throw Error(data.error||'HTTP '+response.status);
    }
    const item=data.item,fx=item.effect||{};
    if(fx.result?.path?.length&&order.id!==undefined)
      await animateMove(order.id,{...fx.result,ok:true});
    for(const ai of fx.ai||[])
      if(ai.path?.length)await animateMove(ai.id,{...ai,ok:true});
    if(fx.resolution?.length)
      for(const effect of fx.resolution)
        await animateAttack(effect.id,effect.target,effect);
    for(const roll of fx.rolls||[])await animateRoll(roll,'СЕРВЕР · '+(order.type||''));
    for(const roll of fx.afterRolls||[])await animateRoll(roll,'СЕРВЕР · СОСТОЯНИЕ');
    applyServerState(item.game);
    remoteVersion=item.version;
    remoteFinished=item.status==='completed';
    chooseActive();
    busy=remoteFinished;
    syncModels();renderUI();reportAccess();
    if(remoteFinished)toast('СРАЖЕНИЕ ЗАВЕРШЕНО. Результат подтверждён сервером.');
  }catch(e){
    busy=remoteFinished;
    renderUI();reportAccess();
    const reasons={not_your_turn:'Сейчас не ваша очередь',
      stale_operation_version:'Состояние боя изменилось. Данные обновлены.',
      illegal_tactical_order:'Приказ невозможен по правилам BattleTech',
      phase_pending_orders:'Не все мехи завершили приказы',
      operation_not_active:'Операция завершена или прервана'};
    toast('СЕРВЕР ОТКЛОНИЛ ПРИКАЗ: '+(reasons[e.message]||e.message));
  }finally{
    if(!remoteFinished&&remoteReady)busy=false;
    renderUI();reportAccess();
  }
}

function owned(u){return !!u&&!u.dead&&(hotseat?u.team===game.activeTeam:u.team===0);}
function applyCustom(){if(!new URLSearchParams(location.search).has('custom'))return;try{const d=JSON.parse(localStorage.getItem('ironhex-design')),r=construct(d.config);if(!r.errors.length&&game.units[d.position]){
  Object.assign(game.units[d.position],r.unit);
  const p=d.pilot;
  if(p&&Number.isInteger(p.gunnery)&&Number.isInteger(p.piloting)&&
     p.gunnery>=0&&p.gunnery<=8&&p.piloting>=0&&p.piloting<=8)
    Object.assign(game.units[d.position],{gunnery:p.gunnery,piloting:p.piloting});
}}catch(e){console.warn('Custom design unavailable',e);}}
applyCustom();
let aimLocation='',weaponBins={},flamerHeat=false,weaponTargets={},physicalType='kick',physicalLimb='RL';
function syncModels(){for(const u of game.units){const r=records.get(u.id);if(!r)continue;r.root.position.copy(world(u.q,u.r));r.root.position.y=groundY(u.q,u.r);r.root.rotation.y=Math.PI/2+u.facing*Math.PI/3;if(u.dead&&!r.dead){r.dead=true;r.label.style.display='none';play(u.id,'Collapse',true);}else if(!u.dead){r.model.rotation.x=u.prone?-Math.PI/2:0;r.label.textContent=`${u.id+1} / ${u.name.toUpperCase()}${u.prone?' · ЛЁЖА':''}${u.shutdown?' · OFF':''}${u.unconscious?' · ПИЛОТ БЕЗ СОЗНАНИЯ':''}`;}}}
function refreshHighlights(){updateArcs();reach=(!busy&&game.phase==='move'&&owned(game.units[selected]))?game.reachable(selected,mode):[];const keys=new Set(reach.map(t=>t.q+','+t.r));for(const t of game.tiles){if(!t.mesh)continue;t.mesh.material.color.copy(t.original);t.mesh.material.emissive.setHex(keys.has(t.q+','+t.r)?0x254111:0);t.mesh.material.emissiveIntensity=.55;}const u=game.units[selected];selection.visible=!u.dead;selection.position.copy(world(u.q,u.r));selection.position.y=groundY(u.q,u.r)+.04;targetRing.visible=target!==null&&!game.units[target].dead;if(targetRing.visible){const t=game.units[target];targetRing.position.copy(world(t.q,t.r));targetRing.position.y=groundY(t.q,t.r)+.05;}}
function card(u){const ap=sum(u.armor)+sum(u.rear),max=sum(u.maxArmor)+sum(u.maxRear);return `<button class="unitcard ${u.team?'enemy':''} ${u.id===selected?'active':''} ${u.dead?'dead':''}" data-unit="${u.id}"><strong>${u.name.toUpperCase()}</strong><span class="badge">${u.tonnage} T</span><small>${u.variant} / ${u.dead?'УНИЧТОЖЕН':u.unconscious?'ПИЛОТ БЕЗ СОЗНАНИЯ':u.shutdown?'ОТКЛЮЧЕН':u.prone?'ЛЕЖИТ':game.canAct(u)?'ВАША ОЧЕРЕДЬ':game.done(u)?'ПРИКАЗ ПРИНЯТ':'ОЖИДАНИЕ'}</small><div class="bar"><span style="width:${ap/max*100}%"></span></div><div class="cardmeta"><span>БРОНЯ ${ap}/${max}</span><span>НАГРЕВ ${u.heat}°</span></div></button>`;}
function renderUI(){const u=game.units[selected],acting=game.canAct(u)&&owned(u)&&!busy;team=hotseat?(game.activeTeam??0):0;
$('#allies').innerHTML=game.units.filter(u=>u.team===0).map(card).join('');$('#enemies').innerHTML=game.units.filter(u=>u.team===1).map(card).join('');document.querySelectorAll('[data-unit]').forEach(b=>b.onclick=()=>selectUnit(+b.dataset.unit));
$('#round').textContent=`РАУНД ${String(game.round).padStart(2,'0')}`;$('#phase').textContent=PHASES[game.phase].toUpperCase();
$('#selected').innerHTML=`<h2>${u.name.toUpperCase()}</h2><div class="sub">${u.variant} · ${u.tonnage} тонн · Пилот ${u.gunnery}/${u.piloting} · Ранения ${u.pilotWounds}/6</div><div class="stats"><div><b>${sum(u.armor)+sum(u.rear)}</b><small>БРОНЯ</small></div><div><b>${u.heat}<span style="font-size:12px;color:#d9ae6c">+${u.pendingHeat}</span></b><small>НАГРЕВ</small></div><div><b>${game.mp(u,'walk')}/${game.mp(u,'run')}/${game.mp(u,'jump')}</b><small>ХОД / БЕГ / ПРЫЖОК</small></div></div><button class="sheetbtn" id="sheet">▤ &nbsp; ОТКРЫТЬ ЛИСТ МЕХА ↗</button>`;$('#sheet').onclick=()=>sheet(u);
const armorRatio=(sum(u.armor)+sum(u.rear))/(sum(u.maxArmor)+sum(u.maxRear));
$('#annunciator').innerHTML=`<div class="panel-serial">СИСТЕМЫ / ${String(u.id+1).padStart(2,'0')}<span>DIAGNOSTIC BUS</span></div><div class="warning-bank">${[[u.dead||u.shutdown?'alarm':u.engineHits?'caution':'ready','РЕАКТОР',u.dead?'ПОТЕРЯН':u.shutdown?'OFF':u.engineHits?'ПОВРЕЖДЁН':'ONLINE'],[u.heat>=14?'alarm':u.heat>=8?'caution':'ready','ТЕМПЕРАТУРА',u.heat+'°'],[u.gyroHits?'alarm':u.prone?'caution':'ready','ГИРОСКОП',u.gyroHits?'ПОВРЕЖДЁН':u.prone?'ЛЁЖА':'СТАБИЛЕН'],[u.unconscious||u.pilotWounds>=6?'alarm':u.pilotWounds?'caution':'ready','ПИЛОТ',u.unconscious?'БЕЗ СОЗНАНИЯ':u.pilotWounds+'/6 РАНЕНИЙ']].map(([state,label,value])=>`<div class="system-lamp ${state}"><i aria-hidden="true"></i><span>${label}<b>${value}</b></span></div>`).join('')}</div><div class="telemetry"><label>БРОНЯ <b>${Math.round(armorRatio*100)}%</b></label><meter min="0" max="1" value="${armorRatio}"></meter><label>ТЕПЛОВАЯ НАГРУЗКА <b>${u.heat} / 30</b></label><meter class="thermal" min="0" max="30" value="${Math.min(30,u.heat)}"></meter></div>`;
const a=$('#actions');if(game.phase==='initiative'){a.innerHTML='<p class="hint">Оба отряда бросают 2d6. Проигравший действует первым. Приказы чередуются по одному меху.</p>';}else if(['heat','end'].includes(game.phase)){a.innerHTML='<p class="hint">Следующий шаг разрешит нагрев, отключения, боезапас или восстановление сознания.</p>';}else if(!acting){a.innerHTML=`<p class="hint">${busy?'Выполняется приказ…':game.queue.length?'Очередь: '+(game.activeTeam?'красный':'зелёный')+' отряд. Выберите его меха.':'Все приказы приняты. Перейдите к разрешению фазы.'}</p>`;}else if(game.phase==='move'){
a.innerHTML=`<div class="controltitle">ДВИЖЕНИЕ · ${u.spent} / ${game.mp(u,mode)} MP · КУРС ${u.facing+1}</div><div class="segments">${[['walk','Ходьба'],['run','Бег'],['jump','Прыжок']].map(([m,t])=>`<button data-mode="${m}" aria-pressed="${mode===m}" class="${mode===m?'on':''}" ${(!u.jump&&m==='jump')||u.moveMode!=='stand'&&u.moveMode!==m?'disabled':''}>${t}</button>`).join('')}</div><div class="segments" style="margin-top:8px"><button id="turnleft">↶ −1 MP</button><button id="turnright">↷ −1 MP</button><button id="stance">${u.prone?'Встать · 2 MP':'Лечь'}</button></div><p class="hint">Светлые гексы — доступные пути с учётом поворотов. Можно продолжать движение до исчерпания MP. Затем подтвердите приказ.</p><button class="primary" id="hold">ЗАВЕРШИТЬ ПРИКАЗ МЕХА</button>`;
a.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{mode=b.dataset.mode;renderUI();});$('#turnleft').onclick=()=>action(()=>game.rotate(selected,1),false,{type:'rotate',id:selected,delta:1});$('#turnright').onclick=()=>action(()=>game.rotate(selected,-1),false,{type:'rotate',id:selected,delta:-1});$('#stance').onclick=()=>action(()=>u.prone?game.stand(selected):game.drop(selected),false,{type:u.prone?'stand':'drop',id:selected});$('#hold').onclick=()=>action(()=>game.hold(selected),true,{type:'hold',id:selected});
}else if(game.phase==='fire'){
a.innerHTML=`<div class="controltitle">ТОРС / СЕКТОР ОГНЯ</div><div class="segments">${[-1,0,1].map(n=>`<button data-twist="${n}" aria-pressed="${u.twist===n}" class="${u.twist===n?'on':''}" ${u.prone?'disabled':''}>${n===0?'Прямо':n===1?'Влево':'Вправо'}</button>`).join('')}</div><p class="hint">Каждому орудию можно выбрать цель. Выстрелы разрешаются после деклараций обоих отрядов.</p>${u.weapons.map((w,i)=>{const tid=weaponTargets[i]??target,p=tid!==null&&tid!==undefined?game.preview(u.id,tid,i):null;return `<div class="weapon"><input aria-label="Стрелять ${w.name}" type="checkbox" data-weapon="${i}" ${picked.has(i)?'checked':''} ${w.destroyed?'disabled':''}><div><b>${w.name}</b><small>${w.rack?w.rack+' ракет':w.damage+' урона'} · ${w.heat} тепла · ${w.ammo??'∞'}<br>${p?(p.legal?p.targetNumber+'+ · '+p.chance+'%':p.reason):'Выберите цель'}</small><select data-target="${i}" aria-label="Цель ${w.name}"><option value="">— цель —</option>${game.units.filter(v=>v.team!==u.team&&!v.dead).map(v=>`<option value="${v.id}" ${tid===v.id?'selected':''}>${v.name}</option>`).join('')}</select></div></div>`;}).join('')}<button class="primary" id="fire">ЗАЯВИТЬ ОГОНЬ</button><button id="hold">Не стрелять</button>`;
a.querySelectorAll('[data-twist]').forEach(b=>b.onclick=()=>action(()=>game.twist(selected,+b.dataset.twist),false,{type:'twist',id:selected,twist:+b.dataset.twist}));a.querySelectorAll('[data-weapon]').forEach(b=>b.onchange=()=>{b.checked?picked.add(+b.dataset.weapon):picked.delete(+b.dataset.weapon);updateArcs();});a.querySelectorAll('[data-target]').forEach(b=>b.onchange=()=>{weaponTargets[b.dataset.target]=b.value===''?null:+b.value;renderUI();});$('#fire').onclick=fire;$('#hold').onclick=()=>action(()=>game.hold(selected),true,{type:'hold',id:selected});
}else if(game.phase==='physical'){
const p=target!==null?game.physicalPreview(selected,target,physicalType,physicalLimb):null;a.innerHTML=`<div class="controltitle">${target===null?'ВЫБЕРИТЕ СОСЕДНЕГО ВРАГА':'ЦЕЛЬ: '+game.units[target].name.toUpperCase()}</div><select id="ptype"><option value="kick">Удар ногой</option><option value="punch">Удар рукой</option><option value="push">Толчок</option><option value="club">Удар дубиной</option><option value="hatchet">Удар топором</option></select><select id="limb" style="margin-top:8px">${Object.entries({RL:'Правая нога',LL:'Левая нога',RA:'Правая рука',LA:'Левая рука',both:'Обе руки (два броска)'}).map(([v,n])=>`<option value="${v}">${n}</option>`).join('')}</select><p class="hint">${p?(p.legal?p.targetNumber+'+ на 2d6 · '+p.damage+' урона':p.reason):'Физическая атака разрешается после всех деклараций.'}</p><button id="physical" class="primary" ${!p?.legal?'disabled':''}>ЗАЯВИТЬ АТАКУ</button><button id="club">Поднять дубину</button><button id="hold">Пропустить</button>`;$('#ptype').value=physicalType;$('#limb').value=physicalLimb;$('#ptype').onchange=()=>{physicalType=$('#ptype').value;physicalLimb=physicalType==='kick'?'RL':'RA';renderUI();};$('#limb').onchange=()=>{physicalLimb=$('#limb').value;renderUI();};$('#physical').onclick=()=>action(()=>game.declarePhysical(selected,target,physicalType,physicalLimb),true,{type:'physical',id:selected,target,attack:physicalType,limb:physicalLimb});$('#club').onclick=()=>action(()=>game.takeClub(selected),true,{type:'club',id:selected});$('#hold').onclick=()=>action(()=>game.hold(selected),true,{type:'hold',id:selected});
}
$('#night').disabled=$('#gale').disabled=game.round!==1||game.phase!=='initiative'||remoteMode&&!remoteReady;if(acting)advancedControls(u,a);$('#next').disabled=busy||game.winner!==null||game.queue.length>0||remoteMode&&!remoteReady;$('#next').textContent=busy?'ВЫПОЛНЕНИЕ ПРИКАЗА…':game.phase==='initiative'?'БРОСИТЬ ИНИЦИАТИВУ':game.phase==='fire'?'РАЗРЕШИТЬ СТРЕЛЬБУ':game.phase==='physical'?'РАЗРЕШИТЬ БЛИЖНИЙ БОЙ':game.phase==='heat'?'РАССЧИТАТЬ НАГРЕВ':game.phase==='end'?'ЗАВЕРШИТЬ ХОД':'К СТРЕЛЬБЕ →';$('#log').innerHTML=game.log.slice(-18).reverse().map(s=>`<p>${s}</p>`).join('');$('#status').textContent=`${PHASES[game.phase]} / ${game.activeTeam===null?'Все приказы приняты':game.activeTeam?'Красный отряд':'Зелёный отряд'}`;if(remoteMode)$('#status').textContent+=remoteReady?' · SERVER VERIFIED / v'+remoteVersion:' · ПОДКЛЮЧЕНИЕ К СЕРВЕРУ';refreshHighlights();if(!busy)syncModels();if(game.winner!==null)toast(game.winner==='draw'?'НИЧЬЯ':`ПОБЕДА: ${game.winner?'КРАСНЫЙ':'ЗЕЛЁНЫЙ'} ОТРЯД`);
}
function advancedControls(u,a){const panel=document.createElement('details');panel.className='advanced';panel.innerHTML='<summary>Дополнительные приказы</summary>';if(game.phase==='move'){panel.innerHTML+=`<p class="hint">${target!==null?'Цель: '+game.units[target].name:'Выберите врага для тарана/DFA'}</p><div class="segments"><button id="charge">Таран</button><button id="dfa">DFA</button></div><button id="minimum">Минимальный шаг</button><button id="shutdown">${u.shutdownNext?'Отменить отключение':'Отключить в конце хода'}</button><label class="hint">Сброс боезапаса<select id="dumpbin"><option value="">— выбрать бункер —</option>${u.bins.map((b,i)=>`<option value="${i}">${b.location}: ${u.weapons[b.weapon].name} · ${b.shots}</option>`).join('')}</select></label>`;a.appendChild(panel);$('#charge').onclick=()=>specialMove('charge');$('#dfa').onclick=()=>specialMove('dfa');$('#minimum').onclick=()=>action(()=>game.minimumMove(selected),true,{type:'minimum',id:selected});$('#shutdown').onclick=()=>action(()=>game.orderShutdown(selected),false,{type:'shutdown',id:selected});$('#dumpbin').onchange=()=>{const v=$('#dumpbin').value;if(v!=='')action(()=>game.orderDump(selected,+v),false,{type:'dump',id:selected,bin:+v});};}else if(game.phase==='fire'){panel.innerHTML+=`<label class="hint">Прицел по обездвиженной цели<select id="aim"><option value="">Обычный огонь</option>${Object.entries(LOCATIONS).map(([l,n])=>`<option value="${l}">${n}</option>`).join('')}</select></label><button id="flip">${u.flip?'Вернуть руки':'Перевернуть руки назад'}</button><label class="hint">Опорная рука лёжа<select id="brace"><option value="LA">Левая</option><option value="RA">Правая</option></select></label>`;panel.innerHTML+=`${u.weapons.some(w=>w.name==='Flamer')?'<label class="hint"><input id="flamerheat" type="checkbox"> Огнемёт: +2 нагрева вместо урона</label>':''}${u.weapons.map((w,i)=>w.ammo!==null?`<label class="hint">Бункер: ${w.name}<select data-binweapon="${i}"><option value="">Автоматически</option>${u.bins.map((b,j)=>b.weapon===(w.shared??i)?`<option value="${j}" ${weaponBins[i]===j?'selected':''}>${b.location} / слот ${b.slot+1}: ${b.shots}</option>`:'').join('')}</select></label>`:'').join('')}`;a.appendChild(panel);panel.querySelectorAll('[data-binweapon]').forEach(el=>el.onchange=()=>{weaponBins[el.dataset.binweapon]=el.value===''?null:+el.value;});if($('#flamerheat')){$('#flamerheat').checked=flamerHeat;$('#flamerheat').onchange=()=>{flamerHeat=$('#flamerheat').checked;};}$('#aim').value=aimLocation;$('#aim').onchange=()=>{aimLocation=$('#aim').value;};$('#flip').onclick=()=>action(()=>game.flipArms(selected,!u.flip),false,{type:'flip',id:selected,enabled:!u.flip});$('#brace').value=u.brace||'LA';$('#brace').onchange=()=>action(()=>game.setBrace(selected,$('#brace').value),false,{type:'brace',id:selected,limb:$('#brace').value});}}
async function specialMove(type){if(remoteMode)return serverCommand({type:'charge',id:selected,target,attack:type});if(target===null){toast('Сначала выберите врага.');return;}const id=selected,r=game.declareCharge(id,target,type);if(!r.ok){toast(r.error);return;}busy=true;renderUI();await animateMove(id,r);await showRolls(r.rolls);await pumpAI();chooseActive();busy=false;renderUI();}
function selectUnit(id){if(busy)return;const u=game.units[id];if(['move','fire','physical'].includes(game.phase)&&game.canAct(game.units[selected])&&owned(game.units[selected])&&u.team!==game.units[selected].team&&!u.dead){target=id;renderUI();return;}selected=id;arcWeapon='all';target=null;weaponTargets={};weaponBins={};picked=new Set(u.weapons.map((_,i)=>i));mode=u.moveMode==='stand'?'walk':u.moveMode;renderUI();}
async function showRolls(rolls){for(const r of rolls||[])await animateRoll(r,PHASES[game.phase]);}
function chooseActive(){if(game.activeTeam!==null){const u=game.units.find(u=>game.canAct(u));if(u){selected=u.id;arcWeapon='all';mode=u.moveMode==='stand'?'walk':u.moveMode;}}target=null;weaponTargets={};weaponBins={};picked=new Set(game.units[selected].weapons.map((_,i)=>i));}
async function pumpAI(){if(remoteMode||hotseat)return;while(game.activeTeam===1&&game.winner===null){const u=game.units.find(u=>game.canAct(u));if(!u)break;game.phaseRolls=[];if(game.phase==='move'){const r=game.aiMove(u.id);await animateMove(u.id,r);}else if(game.phase==='fire')game.aiAttack(u.id);else game.aiPhysical(u.id);await showRolls(game.phaseRolls);syncModels();}}
async function action(fn,advance=false,order=null){if(remoteMode)return serverCommand(order);if(busy)return;game.phaseRolls=[];const r=fn();if(!r?.ok){toast(r?.error||'Приказ не выполнен');return;}if(game.units[selected].dead&&game.actingId===selected){game.hold(selected);advance=true;}busy=true;renderUI();await showRolls(game.phaseRolls);if(advance){await pumpAI();chooseActive();}busy=false;renderUI();}
const ray=new THREE.Raycaster();const pointer=new THREE.Vector2();const activePointers=new Map();let gestureUsed=false,pinchDistance=null;
function pickCanvas(e){if(busy)return;const rect=renderer.domElement.getBoundingClientRect();pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);ray.setFromCamera(pointer,camera);if(software){let coords=[...game.tiles].map(t=>({t,p:project(world(t.q,t.r).add(new THREE.Vector3(0,groundY(t.q,t.r),0)))}));coords.sort((a,b)=>Math.hypot(a.p.x-(e.clientX-rect.left),a.p.y-(e.clientY-rect.top))-Math.hypot(b.p.x-(e.clientX-rect.left),b.p.y-(e.clientY-rect.top)));const t=coords[0].t;let at=game.units.find(u=>!u.dead&&u.q===t.q&&u.r===t.r);if(at)selectUnit(at.id);else if(game.phase==='move'&&owned(game.units[selected]))doMove(t);return;}const objects=[...records.values()].map(r=>r.root);const hit=ray.intersectObjects(objects,true)[0];if(hit){let o=hit.object;while(o.parent&&o.parent!==scene)o=o.parent;const entry=[...records.entries()].find(([id,r])=>r.root===o);if(entry){selectUnit(entry[0]);return;}}const tilehit=ray.intersectObjects(tileMeshes)[0];if(tilehit){let t=tilehit.object.userData.tile;let at=game.units.find(u=>!u.dead&&u.q===t.q&&u.r===t.r);if(at){selectUnit(at.id);return;}if(game.phase==='move'&&owned(game.units[selected]))doMove(t);}}
const gestureCanvas=renderer.domElement;
function pointerDistance(){
  const p=[...activePointers.values()];
  return p.length===2?Math.hypot(p[0].lastX-p[1].lastX,p[0].lastY-p[1].lastY):null;
}
gestureCanvas.addEventListener('pointerdown',e=>{
  if(e.pointerType==='mouse'&&e.button!==0)return;
  if(activePointers.size===0)gestureUsed=false;
  activePointers.set(e.pointerId,{x:e.clientX,y:e.clientY,lastX:e.clientX,lastY:e.clientY});
  if(activePointers.size>1){gestureUsed=true;pinchDistance=pointerDistance();}
  if(e.isTrusted&&gestureCanvas.setPointerCapture){
    try{gestureCanvas.setPointerCapture(e.pointerId);}catch{}
  }
});
gestureCanvas.addEventListener('pointermove',e=>{
  const point=activePointers.get(e.pointerId);
  if(!point)return;
  const dx=e.clientX-point.lastX;
  point.lastX=e.clientX;point.lastY=e.clientY;
  if(activePointers.size===1){
    if(Math.hypot(e.clientX-point.x,e.clientY-point.y)>9)gestureUsed=true;
    if(gestureUsed&&dx){angle+=dx*.008;cam();}
  }else if(activePointers.size===2){
    const distance=pointerDistance();
    if(distance&&pinchDistance){
      zoom=THREE.MathUtils.clamp(zoom*pinchDistance/distance,5,20);
      resize();
    }
    pinchDistance=distance;
  }
});
gestureCanvas.addEventListener('pointerup',e=>{
  const point=activePointers.get(e.pointerId);
  if(!point)return;
  const tap=activePointers.size===1&&!gestureUsed&&
    Math.hypot(e.clientX-point.x,e.clientY-point.y)<=12;
  activePointers.delete(e.pointerId);
  pinchDistance=activePointers.size===2?pointerDistance():null;
  if(tap)pickCanvas(e);
});
gestureCanvas.addEventListener('pointercancel',e=>{
  activePointers.delete(e.pointerId);
  pinchDistance=activePointers.size===2?pointerDistance():null;
  gestureUsed=true;
});
renderer.domElement.addEventListener('wheel',e=>{e.preventDefault();zoom=THREE.MathUtils.clamp(zoom+Math.sign(e.deltaY)*.8,5,20);resize();},{passive:false});
async function animateMove(id,res){if(!res.ok||!res.path?.length)return;const rec=records.get(id);if(!rec)return;if(software){rec.root.position.copy(world(res.to.q,res.to.r));rec.root.position.y=groundY(res.to.q,res.to.r);await pause(250);return;}play(id,res.mode==='run'?'Run':'Walk');for(const p of res.path){let start=rec.root.position.clone(),end=world(p.q,p.r);end.y=groundY(p.q,p.r);rec.root.rotation.y=Math.atan2(end.x-start.x,end.z-start.z);await new Promise(resolve=>{effects.push({type:'move',rec,start,end,time:0,duration:res.mode==='jump'?.9:res.mode==='run'?.17:.24,jump:res.mode==='jump',resolve});});}play(id,'Sentinel');}
async function doMove(t){if(remoteMode)return serverCommand({type:'move',id:selected,q:t.q,r:t.r,mode});if(busy)return;const id=selected,res=game.move(id,t.q,t.r,mode);if(!res.ok){toast(res.error);return;}busy=true;renderUI();await animateMove(id,res);await showRolls(res.rolls);if(game.units[id].dead){game.hold(id);await pumpAI();chooseActive();}busy=false;toast('Маршрут выполнен. Можно продолжить движение или подтвердить приказ.');renderUI();}
async function animateAttack(id,tid,res){if(!res.ok||!res.shots)return;const rec=records.get(id),tr=records.get(tid);if(!rec||!tr)return;let from=rec.root.position.clone().add(new THREE.Vector3(0,1.3,0)),to=tr.root.position.clone().add(new THREE.Vector3(0,1,0));rec.root.rotation.y=Math.atan2(to.x-from.x,to.z-from.z);const melee=res.shots.some(s=>['punch','kick','push','club','hatchet','Таран','DFA'].includes(s.weapon));play(id,melee?'PunchCombo':'KneelFire',true);await pause(220);for(const shot of res.shots){for(const roll of shot.rolls||[])await animateRoll(roll,game.units[id].name+' → '+game.units[tid].name+' / '+shot.weapon);const dest=to.clone();if(!shot.hit)dest.x+=1.2;const geo=new THREE.BufferGeometry().setFromPoints([from,dest]);const line=new THREE.Line(geo,new THREE.LineBasicMaterial({color:shot.weapon.includes('Laser')?0xff5851:shot.weapon==='PPC'?0x80d9ff:0xffdb77,transparent:true,opacity:1}));if(!melee){scene.add(line);effects.push({type:'beam',obj:line,time:0,duration:.38});}else{geo.dispose();line.material.dispose();}for(let j=0;j<12;j++){let spark=new THREE.Mesh(new THREE.SphereGeometry(.045,4,4),new THREE.MeshBasicMaterial({color:shot.hit?0xffb55c:0x9d9e7e}));spark.position.copy(dest);scene.add(spark);effects.push({type:'spark',obj:spark,v:new THREE.Vector3((Math.random()-.5)*3,Math.random()*3,(Math.random()-.5)*3),time:0,duration:.6});}toast(`${shot.weapon} · 2d6: ${shot.roll} / ${shot.targetNumber}+ · ${shot.hit?'ПОПАДАНИЕ −'+shot.damage:'ПРОМАХ'}`);if(shot.hit&&!tr.dead)play(tid,'HitChest',true);await pause(400);}await pause(250);play(id,'Sentinel');if(!game.units[tid].dead)play(tid,'Sentinel');}
async function fire(){const entries=[...picked].map(index=>({index,target:weaponTargets[index]??target,aim:aimLocation||null,bin:weaponBins[index]??null,heatMode:flamerHeat}));if(!entries.length){toast('Выберите оружие или нажмите «Не стрелять».');return;}await action(()=>game.declareFire(selected,entries),true,{type:'fire',id:selected,shots:entries});}
$('#next').onclick=async()=>{if(remoteMode)return serverCommand({type:'next'});if(busy)return;const r=game.nextPhase();if(!r?.ok){toast(r?.error);return;}busy=true;renderUI();if(game.resolution.length){for(const attack of game.resolution)await animateAttack(attack.id,attack.target,attack);await showRolls(game.afterRolls);}else await showRolls(game.phaseRolls);syncModels();await pumpAI();chooseActive();busy=false;renderUI();toast(game.winner===null?PHASES[game.phase]+'. Следуйте очередности приказов.':'Бой завершён.');};
function modal(html){$('#modal').classList.remove('recorddialog');$('#modalbody').innerHTML=html;$('#modal').showModal();}$('#close').onclick=()=>$('#modal').close();$('#modal').addEventListener('click',e=>{if(e.target===$('#modal'))$('#modal').close();});
function sheet(u){modal(recordSheet(u));$('#modal').classList.add('recorddialog');}

const rulesURL='https://static1.squarespace.com/static/5e5f11b6a6b48b3ae5c4ee36/t/5e69a64e3d430e6e35ad7fda/1583982189894/cat3500d+battletech+a+game+of+armored+combat+rulebook.pdf';
$('#help').onclick=()=>modal(`<div class="eyebrow">ПОЛЕВОЕ РУКОВОДСТВО</div><h2>Цикл боя AGoAC</h2><ol><li>Бросьте инициативу. Проигравший отряд действует первым. Выберите меха, у которого указано «Ваша очередь».</li><li>Двигайтесь по подсвеченным гексам. Повороты стоят MP. Можно продолжить маршрут или повернуться, затем нажмите «Завершить приказ меха».</li><li>В оружейной фазе выберите торс, оружие и цели. Приказы обоих отрядов фиксируются до разрешения стрельбы. Уже заявленный выстрел происходит даже при уничтожении стрелка в этой фазе.</li><li>Затем заявите физические атаки соседним мехам или пропустите их. После разрешения боя пройдите нагрев и конец хода.</li></ol><h3>Повреждения и пилот</h3><p>Учитываются кормовая броня, критические слоты, двигатель, гироскоп, актуаторы, датчики, боезапас, ранения и сознание пилота. Падение и подъём проверяются кубиками. Вода влияет на движение, стрельбу и охлаждение.</p><h3>Покрытие книги</h3><p>Текущая реализация расширяет базовый бой. <a href="coverage.html" target="_blank">Полный перечень реализованных правил и оставшихся ограничений</a>. В интерфейсе не обозначаются реализованными правила, для которых ещё нет управления или проверки.</p><p>Игра вдвоём — на одном устройстве. Сетевого режима нет. <a href="${rulesURL}" target="_blank">Исходная книга правил</a>.</p>`);
$('#credits').onclick=()=>modal(`<div class="eyebrow">ИСТОЧНИКИ / ASSET MANIFEST</div><h2>О проекте</h2><p>Неофициальная фан-игра. BattleTech и названия мехов принадлежат их правообладателям. Проект не связан с Catalyst Game Labs.</p><h3>Правила</h3><p><a target="_blank" rel="noopener" href="${rulesURL}">BattleTech: A Game of Armored Combat — Rulebook</a>. Реализовано тактическое подмножество; перечень упрощений — в разделе «Правила».</p><h3>Модели из интернета</h3><p><a href="https://github.com/RamonLinares/atlas-09" target="_blank" rel="noopener">Ramon Linares / FORGE Character Lab</a> — Atlas-09 и Aether-02, лицензия CC0. Настоящие объёмные GLB-модели со скелетной анимацией ходьбы, бега, стрельбы, попаданий и уничтожения.</p><p>Это оригинальные дизайны — визуальные заменители, а не канонические модели Griffin, Wolverine, Shadow Hawk и Thunderbolt.</p><p><a href="ASSET-LICENSE.md" target="_blank">Лицензия моделей</a> · Графика: Three.js (MIT).</p>`);
$('#rotateL').onclick=()=>{angle-=Math.PI/6;cam();};$('#rotateR').onclick=()=>{angle+=Math.PI/6;cam();};$('#zoomIn').onclick=()=>{zoom=Math.max(5,zoom-1.5);resize();};$('#zoomOut').onclick=()=>{zoom=Math.min(20,zoom+1.5);resize();};$('#resetcam').onclick=()=>{zoom=12;angle=Math.PI/4;cam();};
function reset(){clearDice();game.reset();applyCustom();game.weather={night:$('#night').checked,gale:$('#gale').checked};for(const mesh of tileMeshes){const old=mesh.userData.tile,t=game.tile(old.q,old.r);t.mesh=mesh;t.original=old.original;mesh.userData.tile=t;}selected=0;arcWeapon='all';target=null;team=0;mode='walk';picked=new Set(game.units[0].weapons.map((_,i)=>i));for(const u of game.units){const rec=records.get(u.id);if(!rec)continue;rec.dead=false;rec.root.position.copy(world(u.q,u.r));rec.root.position.y=groundY(u.q,u.r);rec.root.rotation.y=u.team?-Math.PI/2:Math.PI/2;rec.label.style.display='block';play(u.id,'Sentinel');}renderUI();toast('Новый бой. Бросьте инициативу.');}
$('#new').onclick=()=>{if(remoteMode){toast('Перезапуск серверной операции недоступен. Откройте новый боевой контракт в штабе.');return;}if(!busy)modal('<h2>Начать новый бой?</h2><p>Текущий бой будет сброшен.</p><button class="primary" id="confirmreset">НАЧАТЬ ЗАНОВО</button>'),$('#confirmreset')&&($('#confirmreset').onclick=()=>{$('#modal').close();reset();});};$('#night').onchange=()=>{if(remoteMode)return void serverCommand({type:'weather',night:$('#night').checked,gale:$('#gale').checked});game.weather.night=$('#night').checked;renderUI();};$('#gale').onchange=()=>{if(remoteMode)return void serverCommand({type:'weather',night:$('#night').checked,gale:$('#gale').checked});game.weather.gale=$('#gale').checked;renderUI();};$('#gamemode').disabled=remoteMode;$('#gamemode').onchange=()=>{if(remoteMode)return;if(busy){$('#gamemode').value=hotseat?'hotseat':'ai';return;}hotseat=$('#gamemode').value==='hotseat';reset();};
function project(v){v=v.clone().project(camera);return {x:(v.x*.5+.5)*renderer.domElement.width,y:(-v.y*.5+.5)*renderer.domElement.height};}
function drawFallback(){const c=renderer.domElement,ctx=c.getContext('2d');if(!ctx)return;ctx.fillStyle='#28362d';ctx.fillRect(0,0,c.width,c.height);for(const t of [...game.tiles].sort((a,b)=>project(world(a.q,a.r)).y-project(world(b.q,b.r)).y)){const center=world(t.q,t.r);center.y=groundY(t.q,t.r);ctx.beginPath();for(let j=0;j<6;j++){let p=project(center.clone().add(new THREE.Vector3(Math.sin(j*Math.PI/3)*.97,0,Math.cos(j*Math.PI/3)*.97)));j?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y);}ctx.closePath();ctx.fillStyle='#'+t.mesh.material.color.getHexString();ctx.fill();if(reach.some(p=>p.q===t.q&&p.r===t.r)){ctx.fillStyle='#b4e56c44';ctx.fill();}const arcBand=arcTiles.get(t.q+','+t.r);if(arcBand!==undefined){ctx.fillStyle=['#59dccc45','#e5c57838','#c88d692d'][arcBand];ctx.fill();ctx.strokeStyle=['#73efe0aa','#f4d89188','#e9ab8477'][arcBand];ctx.lineWidth=1.6;ctx.stroke();}else{ctx.strokeStyle='#18251f';ctx.lineWidth=1;ctx.stroke();}const p=project(center);if(t.type==='woods'||t.type==='heavy'){ctx.fillStyle='#243d2c';ctx.font='22px sans-serif';ctx.fillText('♠',p.x-8,p.y);}}
for(const u of game.units){if(u.dead)continue;const rec=records.get(u.id);let p=project(rec?rec.root.position:world(u.q,u.r));let sc=12/zoom;ctx.save();ctx.translate(p.x,p.y);ctx.scale(sc,sc);ctx.fillStyle=u.team?'#e68e74':'#c3ee78';ctx.strokeStyle='#18221b';ctx.lineWidth=2;for(const [x,y,w,h] of [[-11,-31,22,18],[-7,-43,14,11],[-19,-29,7,22],[12,-29,7,22],[-10,-12,8,14],[3,-12,8,14]]){ctx.fillRect(x,y,w,h);ctx.strokeRect(x,y,w,h);}ctx.restore();const d=game.units[u.id].facing,tip=project(world(u.q+Math.cos(d*Math.PI/3)*.3,u.r).add(new THREE.Vector3(0,.05,0)));const dv=[ [1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1] ][d],to=project(world(u.q+dv[0]*.65,u.r+dv[1]*.65));ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(to.x,to.y);ctx.strokeStyle=u.team?'#ffb38e':'#e4ffa5';ctx.lineWidth=3;ctx.stroke();}ctx.fillStyle='#d8dfcb';ctx.font='10px sans-serif';ctx.fillText('РЕЗЕРВНЫЙ РЕЖИМ · WebGL недоступен',18,c.height-42);}
const clock=new THREE.Clock();function frame(){requestAnimationFrame(frame);const dt=Math.min(clock.getDelta(),.05);for(const rec of records.values()){rec.mixer.update(dt);if(!rec.dead){let p=rec.root.position.clone();p.y+=2.5;p.project(camera);rec.label.style.left=(p.x*.5+.5)*$('#viewport').clientWidth+'px';rec.label.style.top=(-p.y*.5+.5)*$('#viewport').clientHeight+'px';}}for(let i=effects.length-1;i>=0;i--){const e=effects[i];e.time+=dt;const t=Math.min(1,e.time/e.duration);if(e.type==='move'){e.rec.root.position.lerpVectors(e.start,e.end,t);if(e.jump)e.rec.root.position.y+=Math.sin(t*Math.PI)*2;}else if(e.type==='beam'){e.obj.material.opacity=1-t;}else{e.obj.position.addScaledVector(e.v,dt);e.v.y-=dt*6;e.obj.scale.setScalar(1-t);}if(t===1){if(e.obj){scene.remove(e.obj);e.obj.geometry.dispose();e.obj.material.dispose();}e.resolve?.();effects.splice(i,1);}}renderer.render(scene,camera);}picked=new Set([0,1]);renderUI();frame();if(remoteMode)load().then(joinServerBattle);else load();
