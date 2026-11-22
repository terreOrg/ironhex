import {firingArcTiles} from './fire-arcs.js';
import {construct,designSubmissionDiagnostics} from './construction.js';
import {outOfBookEquipment} from './rulebook.js';
import {recordSheet} from './record-sheet.js';
import {animateRoll,clearDice} from './dice.js';
import * as THREE from 'three';
import {GLTFLoader} from './GLTFLoader.js';
import {clone} from './SkeletonUtils.js';
import {Game,LOCATIONS,DIRS,distance,PHASES,AGOAC_SCALE,AGOAC_MAP_PRESETS,AGOAC_PRINTED_SCENARIOS,rangeMeters,elapsedBattleSeconds} from './engine.js';
import {loadAgoacBrowserDesigns} from './agoac-scenario-loader.js';
import {AGOAC_BOARD_NAMES} from './agoac-boards.js';
import {hexElevationMark} from './terrain-level-labels.js';
const $=s=>document.querySelector(s),game=new Game();
const requestParams=new URLSearchParams(location.search);
const operationId=requestParams.get('operation');
const scenarioRoomId=requestParams.get('room');
const roomMode=scenarioRoomId!==null;
const remoteMode=operationId!==null||roomMode;
let remoteVersion=0,remoteReady=false,remoteFinished=false;
let remoteRole=null,roomPollHandle=null,roomPollingInFlight=false,roomSceneInitialized=false;
let selected=0,target=null,mode='walk',busy=remoteMode,hotseat=false,team=0,angle=Math.PI/4,zoom=12,reach=[],picked=new Set(),records=new Map(),effects=[];
let sharedDefenderController='command';
const scene=new THREE.Scene();scene.background=new THREE.Color('#28362d');scene.fog=new THREE.Fog('#28362d',30,65);
const camera=new THREE.OrthographicCamera(-15,15,15,-15,.1,240);let software=false;let renderer;try{renderer=new THREE.WebGLRenderer({antialias:true});}catch(e){software=true;const canvas=document.createElement('canvas');renderer={domElement:canvas,shadowMap:{},setPixelRatio(){},setSize(w,h){canvas.width=w;canvas.height=h;},render(){drawFallback();}};}renderer.setPixelRatio(Math.min(devicePixelRatio,1.75));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.15;$('#viewport').appendChild(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xc6ddbf,0x394332,2.5));const sun=new THREE.DirectionalLight(0xffe1a1,3.6);sun.position.set(-10,22,8);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-18,right:18,top:18,bottom:-18,near:1,far:65});sun.shadow.bias=-.001;scene.add(sun);
const world=(q,r)=>new THREE.Vector3(Math.sqrt(3)*(q+r/2),0,1.5*r);const groundY=(q,r)=>.14+game.tile(q,r).height*.45;
const hexgeo=new THREE.CylinderGeometry(.977,.977,.32,6);const tileMeshes=[];const terrainGroup=new THREE.Group();scene.add(terrainGroup);const baseColors={plain:0x627057,woods:0x465d43,heavy:0x3d533e,hill:0x88876a,water:0x436e78,rough:0x8a7c61,rubble:0x777e77};
const levelLabelGroup=new THREE.Group();scene.add(levelLabelGroup);
const levelLabelGeometry=new THREE.PlaneGeometry(1.52,.53);
const levelLabelMaterials=new Map();
let showHexElevation=true,numberOfHexElevationLabels=0;
function levelLabelMaterial(mark){
 const key=mark.type+':'+mark.lines.join('/');
 if(levelLabelMaterials.has(key))return levelLabelMaterials.get(key);
 const canvas=document.createElement('canvas');canvas.width=384;canvas.height=128;
 const ctx=canvas.getContext('2d');
 if(ctx){
  ctx.clearRect(0,0,384,128);
  ctx.fillStyle=mark.type==='depth'?'#073743d8':'#1d2520d7';
  ctx.fillRect(4,20,376,90);
  ctx.strokeStyle=mark.type==='depth'?'#a5d9e4':'#8c977d';
  ctx.lineWidth=4;ctx.strokeRect(6,22,372,86);
  ctx.fillStyle=mark.type==='depth'?'#e9f7fb':mark.type==='sublevel'?'#ffe4c2':'#f3f2db';
  ctx.textAlign='center';ctx.textBaseline='middle';
  if(mark.lines.length===1){
   ctx.font='bold 47px "IBM Plex Sans",Arial,sans-serif';
   ctx.fillText(mark.lines[0],192,64,360);
  }else{
   ctx.font='bold 37px "IBM Plex Sans",Arial,sans-serif';
   ctx.fillText(mark.lines[0],192,49,350);
   ctx.fillText(mark.lines[1],192,89,350);
  }
 }
 const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
 const material=new THREE.MeshBasicMaterial({
  map:texture,transparent:true,depthWrite:false,side:THREE.DoubleSide,
  toneMapped:false,polygonOffset:true,polygonOffsetFactor:-2
 });
 levelLabelMaterials.set(key,material);return material;
}
function syncHexElevationLabels(){
 for(const label of levelLabelGroup.children)label.visible=showHexElevation;
 const viewport=$('#viewport');
 viewport.dataset.elevationLabelCount=String(numberOfHexElevationLabels);
 viewport.dataset.elevationLabelsVisible=String(showHexElevation);
}
function updateHexElevation(){
 showHexElevation=$('#elevationtoggle').checked;
 syncHexElevationLabels();
}
function seeded(n){return Math.abs(Math.sin(n*127.1+311.7)*43758.54)%1;}
function buildTerrain(){
 levelLabelGroup.clear();numberOfHexElevationLabels=0;
 for(const child of [...terrainGroup.children]){
  terrainGroup.remove(child);child.traverse(o=>{
   if(o.geometry&&o.geometry!==hexgeo)o.geometry.dispose();
   if(o.material)o.material.dispose();
  });
 }
 tileMeshes.length=0;
 for(const [i,t]of game.tiles.entries()){
 const mat=new THREE.MeshStandardMaterial({color:baseColors[t.type],roughness:1});mat.color.multiplyScalar(.87+seeded(i)*.22);const h=new THREE.Mesh(hexgeo,mat);h.position.copy(world(t.q,t.r));h.position.y=t.height*.45;h.receiveShadow=true;h.userData.tile=t;terrainGroup.add(h);tileMeshes.push(h);t.mesh=h;t.original=mat.color.clone();
 const mark=hexElevationMark(t);
 if(mark){
  numberOfHexElevationLabels++;
  if(!software){
   const label=new THREE.Mesh(levelLabelGeometry,levelLabelMaterial(mark));
   label.rotation.x=-Math.PI/2;
   label.position.copy(world(t.q,t.r));
   label.position.y=groundY(t.q,t.r)+.09;
   label.position.z+=.43;
   label.renderOrder=3;
   label.userData.hexElevation=mark.lines.join(' / ');
   levelLabelGroup.add(label);
  }
 }
 if(t.height){const side=new THREE.Mesh(new THREE.CylinderGeometry(.97,1,.5,6),new THREE.MeshStandardMaterial({color:0x555a44,roughness:1}));side.position.copy(h.position);side.position.y=-.15;terrainGroup.add(side);side.receiveShadow=true;}
 if(t.type==='woods'||t.type==='heavy')for(let j=0;j<(t.type==='heavy'?5:3);j++){
 const x=(seeded(i*5+j)-.5)*1.2,z=(seeded(i*7+j)-.5)*1.2;const tree=new THREE.Group();const trunk=new THREE.Mesh(new THREE.CylinderGeometry(.04,.06,.5,5),new THREE.MeshStandardMaterial({color:0x423b2b}));trunk.position.y=.25;tree.add(trunk);for(let k=0;k<3;k++){const foliage=new THREE.Mesh(new THREE.ConeGeometry(.25-k*.05,.65,5),new THREE.MeshStandardMaterial({color:[0x263e2c,0x344d32,0x445b38][k],roughness:1}));foliage.position.y=.6+k*.2;foliage.castShadow=true;tree.add(foliage);}tree.position.copy(h.position);tree.position.add(new THREE.Vector3(x,.16,z));terrainGroup.add(tree);
 }else if(seeded(i+40)>.7){let rock=new THREE.Mesh(new THREE.DodecahedronGeometry(.14+seeded(i)*.15,0),new THREE.MeshStandardMaterial({color:0x878775,roughness:1}));rock.position.copy(h.position).add(new THREE.Vector3(.45,.15,-.3));rock.scale.y=.6;rock.castShadow=true;terrainGroup.add(rock);}
}
 syncHexElevationLabels();
}
function refreshMapLabel(){
 if(!$('#battle-map-label')){
  const label=document.createElement('p');label.id='battle-map-label';label.className='hint';
  $('#allies').previousElementSibling.before(label);
 }
 const layout=game.setupMap??{id:'frontier',rotation:0};
 const name=layout.id==='sheets'?layout.sheets.map(s=>s.name??AGOAC_MAP_PRESETS.find(p=>p.id===s.id)?.name??s.id).join(' + '):AGOAC_MAP_PRESETS.find(p=>p.id===layout.id)?.name??layout.id;
 $('#viewport').dataset.mapLayout=layout.id;
 $('#viewport').dataset.mapRotation=String(layout.rotation);$('#viewport').dataset.sheetLayout=layout.layout??'hex';$('#viewport').dataset.hexCount=String(game.tiles.length);
 const label=$('#battle-map-label');
 if(label)label.textContent='КАРТА: '+name+' · '+(layout.id==='sheets'?layout.width+'×'+layout.height+' гексов':(layout.rotation*60)+'°');
}
buildTerrain();
const plane=new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.MeshStandardMaterial({color:0x26382b,roughness:1}));plane.rotation.x=-Math.PI/2;plane.position.y=-2.5;plane.receiveShadow=true;scene.add(plane);
// Military survey markers around the board.
for(let i=0;i<6;i++){const p=world(Math.cos(i*Math.PI/3)*7,Math.sin(i*Math.PI/3)*7);const m=new THREE.Mesh(new THREE.BoxGeometry(.08,.9,.08),new THREE.MeshStandardMaterial({color:0x9ca886}));m.position.copy(p);m.position.y=.1;scene.add(m);}
const selection=new THREE.Mesh(new THREE.RingGeometry(.83,.92,6),new THREE.MeshBasicMaterial({color:0xd7ff87,side:THREE.DoubleSide,transparent:true,opacity:.9}));selection.rotation.x=-Math.PI/2;scene.add(selection);
const targetRing=selection.clone();targetRing.material=new THREE.MeshBasicMaterial({color:0xff977e,side:THREE.DoubleSide});scene.add(targetRing);targetRing.visible=false;
let arcsEnabled=true,arcWeapon='all',arcTiles=new Map();
const arcColors=[0x59dccc,0xe5c578,0xc88d69],arcMeshes=new Map();
const arcGeo=new THREE.CircleGeometry(.93,6);arcGeo.rotateZ(Math.PI/6);arcGeo.rotateX(-Math.PI/2);
const arcMaterials=arcColors.map(color=>new THREE.MeshBasicMaterial({color,side:THREE.DoubleSide,transparent:true,opacity:.24,depthWrite:false}));
function buildArcMeshes(){for(const mesh of arcMeshes.values())scene.remove(mesh);arcMeshes.clear();for(const t of game.tiles){const mesh=new THREE.Mesh(arcGeo,arcMaterials[0]);mesh.position.copy(world(t.q,t.r));mesh.position.y=groundY(t.q,t.r)+.035;mesh.visible=false;mesh.renderOrder=1;scene.add(mesh);arcMeshes.set(t.q+','+t.r,mesh);}}buildArcMeshes();
function updateArcs(){const u=game.units[selected];if(arcWeapon!=='all'&&!u.weapons[+arcWeapon])arcWeapon='all';
 const indices=arcWeapon==='all'?u.weapons.map((_,i)=>i).filter(i=>game.phase!=='fire'||picked.has(i)):[+arcWeapon];
 arcTiles=arcsEnabled&&!busy&&game.onMap(u)?firingArcTiles(game,u,indices):new Map();
 for(const [key,mesh]of arcMeshes){mesh.visible=arcTiles.has(key);if(mesh.visible)mesh.material=arcMaterials[arcTiles.get(key)];}
 $('#arctoggle').checked=arcsEnabled;
 $('#arcweapon').innerHTML='<option value="all">Всё выбранное оружие</option>'+u.weapons.map((w,i)=>`<option value="${i}" ${arcWeapon===String(i)?'selected':''}>${w.name} · ${w.location}${w.rear?' / корма':''}</option>`).join('');
 $('#arcweapon').value=arcWeapon;$('#arcinfo').textContent=arcsEnabled?u.name+' · '+arcTiles.size+' гексов':'Секторы скрыты';$('#arclegend').hidden=!arcsEnabled;
}
$('#arctoggle').onchange=()=>{arcsEnabled=$('#arctoggle').checked;updateArcs();};$('#arcweapon').onchange=()=>{arcWeapon=$('#arcweapon').value;updateArcs();};
$('#elevationtoggle').onchange=updateHexElevation;
function resize(){const w=$('#viewport').clientWidth,h=$('#viewport').clientHeight;renderer.setSize(w,h);const a=w/h;camera.left=-zoom*a;camera.right=zoom*a;camera.top=zoom;camera.bottom=-zoom;camera.updateProjectionMatrix();const hud=$('.visor-reticle span');if(hud)hud.textContent='AZIMUTH '+((Math.round(angle*180/Math.PI)%360+360)%360)+'° · ZOOM '+zoom.toFixed(1);}
function fitBoard(){return game.setupMap?.id==='sheets'?Math.max(14,Math.max(game.setupMap.width,game.setupMap.height)*1.15):12;}
function cam(){const d=Math.max(23,fitBoard()*1.6);camera.position.set(Math.cos(angle)*d,d,Math.sin(angle)*d);camera.lookAt(0,0,0);camera.updateMatrixWorld();resize();}new ResizeObserver(resize).observe($('#viewport'));cam();
const loader=new GLTFLoader();
let modelTemplates=null;
function createModelRecord(u){
 if(!modelTemplates||records.has(u.id))return;
 let gltf=modelTemplates[u.id%2],model=clone(gltf.scene),box=new THREE.Box3().setFromObject(model),size=box.getSize(new THREE.Vector3()),scale=(u.tonnage===65?2.25:2)/size.y;model.scale.setScalar(scale);model.position.y=-box.min.y*scale;const root=new THREE.Group();root.add(model);root.position.copy(world(u.q,u.r));root.position.y=groundY(u.q,u.r);root.rotation.y=u.team? -Math.PI/2:Math.PI/2;model.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});const disc=new THREE.Mesh(new THREE.CylinderGeometry(.55,.55,.055,32),new THREE.MeshStandardMaterial({color:u.team?0xda7560:0xb8df6c,emissive:u.team?0x44211b:0x283b14,roughness:.4}));disc.position.y=.025;root.add(disc);const arrow=new THREE.Mesh(new THREE.ConeGeometry(.13,.4,3),new THREE.MeshBasicMaterial({color:u.team?0xffaa88:0xe0ff9a}));arrow.rotation.x=Math.PI/2;arrow.position.set(0,.08,.8);root.add(arrow);scene.add(root);const mixer=new THREE.AnimationMixer(model),actions={};for(const clip of gltf.animations)actions[clip.name]=mixer.clipAction(clip);const label=document.createElement('div');label.className='mechlabel'+(u.team?' red':'');label.textContent=`${u.id+1} / ${u.name.toUpperCase()}`;$('#labels').appendChild(label);records.set(u.id,{root,model,mixer,actions,label,state:null,dead:false});play(u.id,'Sentinel');
}
function reconcileModelRecords(){
 const ids=new Set(game.units.map(u=>u.id));
 for(const [id,record] of records){
  if(ids.has(id))continue;
  record.mixer.stopAllAction();record.mixer.uncacheRoot(record.model);
  scene.remove(record.root);record.label.remove();records.delete(id);
 }
 for(const u of game.units)createModelRecord(u);
}
async function load(){try{modelTemplates=await Promise.all(['aether-02.glb','atlas-09.glb'].map(f=>loader.loadAsync(f)));reconcileModelRecords();syncModels();$('#loading').style.display='none';if(software)toast('WebGL недоступен: резервная тактическая карта. Для 3D включите аппаратное ускорение.');renderUI();}catch(e){$('#loading').innerHTML='Не удалось загрузить 3D-модели.<br>Обновите страницу для повторной загрузки.';console.error(e);}}
function play(id,name,once=false){let rec=records.get(id);if(!rec)return;let action=rec.actions[name]||rec.actions.Sentinel;if(!action||rec.state===name&&!once)return;Object.values(rec.actions).forEach(a=>a.fadeOut(.18));action.reset().setLoop(once?THREE.LoopOnce:THREE.LoopRepeat,once?1:Infinity);action.clampWhenFinished=once;action.fadeIn(.18).play();rec.state=name;}
const pause=ms=>new Promise(r=>setTimeout(r,ms));
function toast(text){$('#toast').textContent=text;}
function reportActionError(error){
 console.error('Ironhex action failed',error);
 busy=remoteMode&&(!remoteReady||remoteFinished);
 try{renderUI();toast('Ошибка выполнения приказа. Проверьте состояние боя перед повтором.');}
 catch(renderError){console.error('Ironhex recovery rendering failed',renderError);}
}
function sum(o){return Object.values(o).reduce((a,b)=>a+b,0);}

function applyServerState(state){
  if(roomMode){
    const active=state?.units?.filter(u=>!u.notFielded);
    if(!Array.isArray(state?.tiles)||!Array.isArray(state?.units)||
      ![7,10].includes(active?.length)||state.setupMap?.id!=='sheets'||
      !state.scenario?.placement?.complete)
      throw Error('invalid_source_room_snapshot');
    const previous=selected;
    // The demo initially constructed four placeholder records. Their
    // variant/model scale is NOT the same as the source scenario roster.
    // Rebuild those 3D records exactly once on first room activation.
    if(!roomSceneInitialized){
      for(const rec of records.values()){
        rec.mixer.stopAllAction();
        scene.remove(rec.root);rec.label.remove();
      }
      records.clear();
      roomSceneInitialized=true;
    }
    Object.assign(game,state);game.rebuildMap();
    // Original printed maps have 544 hexes and 7/10 units rather than
    // the legacy four-unit demo. Rebuild actual scene geometry and models.
    buildTerrain();buildArcMeshes();reconcileModelRecords();
    // After an authenticated three-seat snapshot, prefer an actionable
    // BattleMech actually owned by this seat. The initial demo selection is
    // ID 0 (usually attacker) and must not strand either defender on a
    // non-actionable enemy card when their turn begins.
    const previousUnit=game.unit(previous);
    const readyOwned=active.find(u=>game.canAct(u)&&roomControls(u));
    selected=readyOwned&&(!previousUnit||!game.canAct(previousUnit)||
      !roomControls(previousUnit))?readyOwned.id:
      previousUnit&&!previousUnit.dead&&!previousUnit.notFielded?previous:
      active.find(u=>roomControls(u))?.id??active[0].id;
    mode=game.unit(selected).moveMode==='stand'?'walk':game.unit(selected).moveMode;
    picked=new Set(game.unit(selected).weapons.map((_,i)=>i));
    target=null;weaponTargets={};weaponBins={};weaponSpotters={};
    weaponAims={};flamerHeat=false;primaryTarget=null;
    zoom=fitBoard();cam();
    syncWeatherSwitches();
    return;
  }
  if(!state||!Array.isArray(state.tiles)||!Array.isArray(state.units)||
     state.units.length!==4)throw Error('invalid_server_snapshot');
  const original=new Map(game.tiles.map(t=>[t.q+','+t.r,
    {mesh:t.mesh,original:t.original}]));
  Object.assign(game,state);
  game.rebuildMap();
  syncWeatherSwitches();
  for(const tile of game.tiles){
    const old=original.get(tile.q+','+tile.r);
    if(old){tile.mesh=old.mesh;tile.original=old.original;
      if(tile.mesh)tile.mesh.userData.tile=tile;}
  }
  const current=game.units[selected];
  if(!current||current.dead)selected=game.units.find(u=>u.team===0&&!u.dead)?.id??0;
  mode=game.units[selected].moveMode==='stand'?'walk':game.units[selected].moveMode;
  picked=new Set(game.units[selected].weapons.map((_,i)=>i));
  target=null;weaponTargets={};weaponBins={};weaponSpotters={};weaponAims={};flamerHeat=false;primaryTarget=null;
}
function reportAccess(){
  if(roomMode||!remoteMode||!remoteFinished)return;
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
function ensureRoomReconnect(){
 if($('#room-reconnect'))return;
 const retry=document.createElement('button');
 retry.id='room-reconnect';retry.type='button';
 retry.textContent='ПЕРЕПОДКЛЮЧИТЬСЯ К СЦЕНАРИЮ';
 retry.onclick=()=>void joinServerBattle();
 $('#actions').append(retry);
}
function freezeRoomConnection(reason){
 // No cached command may be sent while the authoritative response is uncertain.
 remoteReady=false;busy=true;
 renderUI();
 toast('СЕТЕВОЙ СЦЕНАРИЙ: синхронизация потеряна ('+reason+'). Переподключитесь.');
 ensureRoomReconnect();
}
async function joinServerBattle(){
  if(!remoteMode)return;
  busy=true;
  renderUI();
  try{
    const path=roomMode?
      '/api/v1/scenario-rooms/'+encodeURIComponent(scenarioRoomId)+'/snapshot':
      '/api/v1/operations/'+encodeURIComponent(operationId)+'/snapshot';
    const res=await fetch(path,{credentials:'same-origin',cache:'no-store'});
    const body=await res.json();
    if(!res.ok)throw Error(body.error||'HTTP '+res.status);
    if(roomMode){
      if(!body.item||!['attacker','command','recon'].includes(body.item.yourRole))
        throw Error('Вы не участник этой комнаты');
      if(!body.game?.scenario?.placement?.complete)
        throw Error('Сначала завершите расстановку в разделе «Сценарии»');
      remoteRole=body.item.yourRole;
      remoteVersion=body.item.version;
      remoteFinished=body.item.status==='finished';
      applyServerState(body.game);
      remoteReady=true;busy=remoteFinished;
      syncModels();renderUI();startRoomPolling();
      toast('СЕТЕВОЙ СЦЕНАРИЙ: роль '+remoteRole+
        '. Приказы проверяет сервер; чужие ходы обновляются автоматически.');
    }else{
      if(body.item.controlMode!=='interactive'||!body.item.game)
        throw Error('Операция не активна или не поддерживает 3D-команды');
      remoteVersion=body.item.version;
      remoteFinished=body.item.status==='completed';
      applyServerState(body.item.game);
      remoteReady=true;busy=remoteFinished;
      syncModels();renderUI();reportAccess();
      toast(remoteFinished?'Операция завершена. Посмотрите рапорт.':
        'СЕРВЕРНЫЙ БОЙ: приказы проверяются и сохраняются на сервере.');
    }
  }catch(e){
    if(roomMode){freezeRoomConnection(e.message);return;}
    busy=true;remoteReady=false;renderUI();
    toast('Нет связи с серверным боем: '+e.message);
    const button=document.createElement('button');
    button.textContent='ПОВТОРИТЬ ПОДКЛЮЧЕНИЕ';
    button.onclick=()=>void joinServerBattle();
    $('#actions').append(button);
  }
}
// All three browsers poll the versioned server snapshot; there is no
// client-side simulated opponent and no sharing of secret dice state.
function startRoomPolling(){
 if(!roomMode||roomPollHandle!==null)return;
 roomPollHandle=setInterval(async()=>{
  // Continue authoritative sync in background tabs. Browser timer throttling
 // already limits the load; hiding the tab must not suppress disconnect checks.
 if(!remoteReady||busy||roomPollingInFlight)return;
  roomPollingInFlight=true;
  try{
   const response=await fetch(
    '/api/v1/scenario-rooms/'+encodeURIComponent(scenarioRoomId)+'/snapshot',
    {credentials:'same-origin',cache:'no-store'});
   if(!response.ok)throw Error('HTTP '+response.status);
   const body=await response.json();
   if(!body.item||body.item.yourRole!==remoteRole||
    !Number.isSafeInteger(body.item.version)||!body.game)
    throw Error('invalid_signed_room_snapshot');
   // Never overwrite a newer acknowledged local command with a stale poll response.
   if(busy||body.item.version<=remoteVersion)return;
   busy=true;
   remoteFinished=body.item.status==='finished';
   applyServerState(body.game);
   remoteVersion=body.item.version;
   chooseActive();syncModels();
   busy=remoteFinished;renderUI();
   toast('Сервер: получена версия '+remoteVersion+'.');
  }catch(error){
   freezeRoomConnection(error?.message||'network_error');
  }finally{
   roomPollingInFlight=false;
  }
 },3500);
}
async function serverCommand(order){
  if(!remoteMode)return;
  if(!remoteReady||busy||remoteFinished)return;
  if(!order){toast('Этот приказ пока не подключён к серверу.');return;}
  if(roomMode&&!['move','hold','fire','physical','next',
    'rotate','stand','drop','minimum','charge','twist','flip',
    'brace','dump','shutdown','club','propose-dispute',
    'withdraw-dispute'].includes(order.type)){
    toast('Этот приказ пока не разрешён в серверном сценарии.');return;
  }
  // Scenario room validates all command parameters and game permissions
  // again on the signed server. Preserve explicit jump-facing choices.
  const command=order;
  busy=true;renderUI();
  try{
    const endpoint=roomMode?
      '/api/v1/scenario-rooms/'+encodeURIComponent(scenarioRoomId)+'/command':
      '/api/v1/operations/'+encodeURIComponent(operationId)+'/command';
    const payload=roomMode?{version:remoteVersion,action:command}:
      {...order,version:remoteVersion};
    const response=await fetch(endpoint,{
      method:'POST',credentials:'same-origin',cache:'no-store',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(payload)
    });
    const data=await response.json();
    if(!response.ok){
      if(roomMode&&(response.status===401||response.status>=500))
        throw Error('room_transport_http_'+response.status);
      if(response.status===409){
        busy=false;await joinServerBattle();
      }
      throw Error(data.error||'HTTP '+response.status);
    }
    const item=data.item,fx=(roomMode?data.effect:item.effect)||{};
    const movedId=fx.id??order.id;
    if(fx.result?.path?.length&&movedId!==undefined)
      await animateMove(movedId,{...fx.result,ok:true});
    for(const ai of fx.ai||[])
      if(ai.path?.length)await animateMove(ai.id,{...ai,ok:true});
    if(fx.resolution?.length)
      for(const effect of fx.resolution)
        await animateAttack(effect.id,effect.target,effect);
    for(const roll of fx.rolls||[])await animateRoll(roll,'СЕРВЕР · '+(order.type||''));
    for(const roll of fx.afterRolls||[])await animateRoll(roll,'СЕРВЕР · СОСТОЯНИЕ');
    const fireDraft=fx.result?.losPrepared?{selected,target,picked,weaponTargets,weaponBins,weaponSpotters,weaponAims,flamerHeat,primaryTarget}:null;
    applyServerState(roomMode?data.game:item.game);
    remoteVersion=item.version;
    remoteFinished=roomMode?item.status==='finished':item.status==='completed';
    chooseActive();
    if(fireDraft&&game.canAct(game.unit(fireDraft.selected))&&
      (roomMode?roomControls(game.unit(fireDraft.selected)):
        game.unit(fireDraft.selected).team===0)){
      ({selected,target,picked,weaponTargets,weaponBins,weaponSpotters,weaponAims,flamerHeat,primaryTarget}=fireDraft);
    }
    busy=remoteFinished;
    syncModels();renderUI();reportAccess();
    if(remoteFinished)toast('СРАЖЕНИЕ ЗАВЕРШЕНО. Результат подтверждён сервером.');
  }catch(e){
    if(roomMode&&(e instanceof TypeError||e instanceof SyntaxError||
      String(e.message||'').startsWith('room_transport_http_'))){
      freezeRoomConnection(e.message||'network_error');
      return;
    }
    busy=remoteFinished;
    syncWeatherSwitches();
    renderUI();reportAccess();
    const reasons={deployment_blocked:'Нет допустимого входа. Измените условия сценария или отмените операцию.',not_your_turn:'Сейчас не ваша очередь',
      stale_operation_version:'Состояние боя изменилось. Данные обновлены.',
      illegal_tactical_order:'Приказ невозможен по правилам BattleTech',
      phase_pending_orders:'Не все мехи завершили приказы',
      operation_not_active:'Операция завершена или прервана'};
    toast('СЕРВЕР ОТКЛОНИЛ ПРИКАЗ: '+(reasons[e.message]||e.message));
  }finally{
    if(!remoteFinished&&remoteReady)busy=false;
    renderUI();reportAccess();
    if(roomMode&&!remoteReady)ensureRoomReconnect();
  }
}

function roomCanResolvePendingChoice(choice){
 if(!roomMode)return true;
 const unit=Number.isInteger(choice?.unitId)?game.unit(choice.unitId):null;
 if(!unit||![0,1].includes(choice.team)||unit.team!==choice.team)return false;
 if(remoteRole==='attacker')return unit.team===game.scenario?.attackerTeam;
 if(unit.team!==game.scenario?.defenderTeam||
  !['command','recon'].includes(unit.lance))return false;
 const ruling=game.scenario?.sharedLances?.decided;
 const winner=ruling?.round===game.round&&ruling.phase===game.phase?
  ruling.controller:null;
 return winner?remoteRole===winner:unit.lance===remoteRole;
}
function roomCanAdvance(){
 if(!roomMode)return true;
 if(!remoteReady||remoteFinished||game.pendingChoice)return false;
 if(game.phase!=='initiative')return true;
 const first=game.scenario?.sharedLances?.firstInitiativeController;
 if(!['command','recon'].includes(first))return false;
 const designated=game.round%2===1?first:first==='command'?'recon':'command';
 return remoteRole===designated;
}
function roomControls(u){
 if(!roomMode||!u||u.dead||u.notFielded||u.deployed===false||
  u.team!==game.activeTeam)return false;
 if(remoteRole==='attacker')return u.team===game.scenario?.attackerTeam;
 if(!['command','recon'].includes(remoteRole)||
  u.team!==game.scenario?.defenderTeam)return false;
 return game.sharedDefenderCanControl(u,remoteRole);
}
function owned(u){
 if(roomMode)return roomControls(u);
 if(!u||u.dead||!(hotseat?u.team===game.activeTeam:u.team===0))return false;
 const shared=game.scenario?.sharedLances;
 if(!hotseat||!shared||u.team!==game.scenario.defenderTeam)return true;
 const controller=shared.decided?.round===game.round&&shared.decided.phase===game.phase?
  shared.decided.controller:sharedDefenderController;
 return game.sharedDefenderCanControl(u,controller);
}
function readCustomDesign(){
 try{const d=JSON.parse(localStorage.getItem('ironhex-design'));if(!d?.config)return null;
  if(designSubmissionDiagnostics(d.config).length)return null;
  const result=construct(d.config,{strictAgoac:true});return result.errors.length||outOfBookEquipment(d.config).length?null:{...d,name:result.unit.name};
 }catch{return null;}
}
let weaponAims={},weaponBins={},weaponSpotters={},flamerHeat=false,weaponTargets={},primaryTarget=null,physicalType='kick',physicalLimb='RL',physicalRightTarget=null,physicalLocationTable='normal';
function syncModels(){
 for(const u of game.units){
  const r=records.get(u.id);if(!r)continue;
  r.root.position.copy(world(u.q,u.r));r.root.position.y=groundY(u.q,u.r);
  r.root.rotation.y=Math.PI/2+u.facing*Math.PI/3;
  if(u.deployed===false){r.root.visible=false;r.label.style.display='none';r.label.dataset.onMap='false';continue;}
  if(u.dead&&!r.dead){
   r.dead=true;r.label.style.display='none';
   const collapse=r.actions.Collapse||r.actions.Sentinel;
   if(collapse&&r.root.visible&&!software){
    r.removalAnimation=true;
    const finished=event=>{
     if(event.action!==collapse)return;
     r.mixer.removeEventListener('finished',finished);
     r.removalAnimation=false;
     r.root.visible=game.onMap(game.unit(u.id));
    };
    r.mixer.addEventListener('finished',finished);
    play(u.id,'Collapse',true);
   }
  }else if(!u.dead){
   r.dead=false;r.label.style.display='block';
   r.model.rotation.x=u.prone?-Math.PI/2:0;
   r.label.textContent=`${u.id+1} / ${u.name.toUpperCase()}${u.prone?' · ЛЁЖА':''}${u.shutdown?' · OFF':''}${u.unconscious?' · ПИЛОТ БЕЗ СОЗНАНИЯ':''}`;
  }
  // Finishing a visual collapse never makes a removed unit targetable.
  r.root.visible=game.onMap(u)||!!r.removalAnimation;
  r.label.dataset.onMap=String(game.onMap(u));
 }
}
function refreshHighlights(){updateArcs();reach=(!busy&&game.phase==='move'&&owned(game.units[selected]))?game.reachable(selected,mode):[];const keys=new Set(reach.map(t=>t.q+','+t.r));for(const t of game.tiles){if(!t.mesh)continue;t.mesh.material.color.copy(t.original);t.mesh.material.emissive.setHex(keys.has(t.q+','+t.r)?0x254111:0);t.mesh.material.emissiveIntensity=.55;}const u=game.units[selected];selection.visible=game.onMap(u)&&!u.dead;selection.position.copy(world(u.q,u.r));selection.position.y=groundY(u.q,u.r)+.04;const t=game.fireTarget(target);targetRing.visible=!!t&&!t.dead;if(targetRing.visible){targetRing.position.copy(world(t.q,t.r));targetRing.position.y=groundY(t.q,t.r)+.05;}}
function card(u){const ap=sum(u.armor)+sum(u.rear),max=sum(u.maxArmor)+sum(u.maxRear);return `<button class="unitcard ${u.team?'enemy':''} ${u.id===selected?'active':''} ${u.dead?'dead':''}" data-unit="${u.id}"><strong>${u.name.toUpperCase()}</strong><span class="badge">${u.tonnage} T</span><small>${u.variant} / ${u.dead?'УНИЧТОЖЕН':u.deployed===false?'ЗА ПРЕДЕЛАМИ ПОЛЯ':u.unconscious?'ПИЛОТ БЕЗ СОЗНАНИЯ':u.shutdown?'ОТКЛЮЧЕН':u.prone?'ЛЕЖИТ':game.canAct(u)?'ВАША ОЧЕРЕДЬ':game.done(u)?'ПРИКАЗ ПРИНЯТ':'ОЖИДАНИЕ'}</small><div class="bar"><span style="width:${ap/max*100}%"></span></div><div class="cardmeta"><span>БРОНЯ ${ap}/${max}</span><span>НАГРЕВ ${u.heat}°</span></div></button>`;}
function renderRoomDispute(panel){
 if(!roomMode||!remoteReady||busy||
  !['move','fire'].includes(game.phase)||game.winner!==null)return;
 const state=game.scenario?.sharedLances;
 if(!state)return;
 // A resolved 2D6 dispute must remain visible to ALL three signed seats.
 // The authoritative ruling comes from the persisted shared room snapshot,
 // never a local dice roll or a mutable client-side role selection.
 const ruling=state.decided?.round===game.round&&
  state.decided?.phase===game.phase?state.decided:null;
 if(ruling){
  const section=document.createElement('section');
  section.id='room-dispute-result';section.className='advanced';
  section.setAttribute('aria-label','Результат спора 2D6');
  const title=document.createElement('div');
  title.className='controltitle';title.textContent='СПОР ЗАЩИТНИКОВ · 2D6';
  const result=document.createElement('p');
  result.className='hint';
  const winner=ruling.controller==='command'?'командный':'разведывательный';
  const phase=game.phase==='move'?'движения':'стрельбы';
  result.textContent='Победил '+winner+' лэнс. Его командир управляет обоими лэнсами защитников до конца фазы '+phase+'.';
  section.append(title,result);panel.append(section);
  return;
 }
 if(!['command','recon'].includes(remoteRole)||
  game.activeTeam!==game.scenario?.defenderTeam||
  game.pendingChoice)return;
 const proposal=state.pendingServerDispute?.round===game.round&&
  state.pendingServerDispute?.phase===game.phase?
  state.pendingServerDispute:null;
 const mine=proposal?.[remoteRole];
 const section=document.createElement('section');section.id='room-dispute';
 section.className='advanced';
 const title=document.createElement('div');title.className='controltitle';
 title.textContent='СПОР ЗАЩИТНИКОВ · 2D6';section.append(title);
 const hint=document.createElement('p');hint.className='hint';
 hint.textContent='Выберите мех своего лэнса. После предложения второго защитника сервер выполнит 2D6. Победитель распоряжается обоими лэнсами до конца этой фазы.';
 section.append(hint);
 if(mine!==null&&mine!==undefined){
  const status=document.createElement('p');status.className='hint';
  status.textContent='Ваш выбор отправлен. Ожидается второй защитник.';section.append(status);
  const withdraw=document.createElement('button');withdraw.type='button';
  withdraw.id='room-dispute-withdraw';withdraw.textContent='ОТОЗВАТЬ ПРЕДЛОЖЕНИЕ';
  withdraw.onclick=()=>void serverCommand({type:'withdraw-dispute'});
  section.append(withdraw);
 }else{
  const candidates=game.units.filter(u=>u.lance===remoteRole&&
   u.team===game.scenario.defenderTeam&&u.deployed!==false&&
   !u.notFielded&&game.canAct(u));
  const picker=document.createElement('select');picker.id='room-dispute-unit';
  for(const u of candidates){
   const option=document.createElement('option');option.value=String(u.id);
   option.textContent=u.name+' · '+u.variant;picker.append(option);
  }
  section.append(picker);
  const submit=document.createElement('button');submit.id='room-dispute-send';
  submit.type='button';submit.textContent='ПРЕДЛОЖИТЬ МЕХ · 2D6';
  submit.disabled=!candidates.length;
  submit.onclick=()=>void serverCommand({type:'propose-dispute',id:Number(picker.value)});
  section.append(submit);
 }
 panel.append(section);
}
function renderUI(){refreshMapLabel();tacticalSettings();const u=game.units[selected],acting=game.canAct(u)&&owned(u)&&!busy;team=hotseat?(game.activeTeam??0):0;
$('#allies').innerHTML=game.units.filter(u=>u.team===0&&!u.notFielded).map(card).join('');$('#enemies').innerHTML=game.units.filter(u=>u.team===1&&!u.notFielded).map(card).join('');for(const [id,t] of [['#allies',0],['#enemies',1]])$(id).previousElementSibling.querySelector('span').textContent=String(game.units.filter(u=>u.team===t&&!u.notFielded).length).padStart(2,'0');document.querySelectorAll('[data-unit]').forEach(b=>b.onclick=()=>selectUnit(+b.dataset.unit));
$('#round').textContent=`РАУНД ${String(game.round).padStart(2,'0')}`;$('#round').title=`Завершённое игровое время: ${elapsedBattleSeconds(game.round)} с · ${AGOAC_SCALE.turnSeconds} с/ход`;
$('#phase').textContent=PHASES[game.phase].toUpperCase();
$('#selected').innerHTML=`<h2>${u.name.toUpperCase()}</h2><div class="sub">${u.variant} · ${u.tonnage} тонн · Пилот ${u.gunnery}/${u.piloting} · Ранения ${u.pilotWounds}/6</div><div class="stats"><div><b>${sum(u.armor)+sum(u.rear)}</b><small>БРОНЯ</small></div><div><b>${u.heat}<span style="font-size:12px;color:#d9ae6c">+${u.pendingHeat}</span></b><small>НАГРЕВ</small></div><div><b>${game.mp(u,'walk')}/${game.mp(u,'run')}/${game.mp(u,'jump')}</b><small>ХОД / БЕГ / ПРЫЖОК</small></div></div><button class="sheetbtn" id="sheet">▤ &nbsp; ОТКРЫТЬ ЛИСТ МЕХА ↗</button>`;$('#sheet').onclick=()=>sheet(u);
if(hotseat&&game.scenario?.sharedLances&&game.activeTeam===game.scenario.defenderTeam&&
 ['move','fire'].includes(game.phase)){
 const state=game.scenario.sharedLances;
 const locked=state.decided?.round===game.round&&state.decided.phase===game.phase;
 const ctrl=document.createElement('select');ctrl.id='scenario-defender-controller';
 for(const id of ['command','recon']){
  const option=document.createElement('option');option.value=id;
  option.textContent=id==='command'?'Командный лэнс: '+state.commandController:
    'Разведывательный лэнс: '+state.reconController;
  ctrl.append(option);
 }
 ctrl.value=locked?state.decided.controller:sharedDefenderController;
 ctrl.disabled=locked;
 ctrl.onchange=()=>{sharedDefenderController=ctrl.value;renderUI();};
 $('#selected').append(ctrl);
 if(!locked){
  const arbitration=document.createElement('button');
  arbitration.id='scenario-arbitrate';arbitration.className='sheetbtn';
  arbitration.textContent='СПОР О ПОРЯДКЕ ХОДА — 2D6';
  arbitration.onclick=showScenarioDispute;
  $('#selected').append(arbitration);
 }
}
const recordList=document.createElement('button');
recordList.type='button';recordList.className='sheetbtn';recordList.id='all-records';recordList.textContent='▤  ВСЕ ЛИСТЫ МЕХОВ ↗';
recordList.onclick=openRecordList;$('#selected').appendChild(recordList);
// AGoAC p.4: an opponent's sheet is open information, including while targeting.
if(target!==null&&game.units[target]&&target!==selected){
 const targetSheet=document.createElement('button');targetSheet.className='sheetbtn';targetSheet.id='target-sheet';targetSheet.textContent='▤  ЛИСТ ЦЕЛИ ↗';
 targetSheet.title=`Дистанция: ${distance(u,game.units[target])} гексов (${rangeMeters(u,game.units[target])} м по игровому масштабу)`;
 targetSheet.onclick=()=>sheet(game.units[target]);$('#selected').appendChild(targetSheet);
}
const armorRatio=(sum(u.armor)+sum(u.rear))/(sum(u.maxArmor)+sum(u.maxRear));
$('#annunciator').innerHTML=`<div class="panel-serial">СИСТЕМЫ / ${String(u.id+1).padStart(2,'0')}<span>DIAGNOSTIC BUS</span></div><div class="warning-bank">${[[u.dead||u.shutdown?'alarm':u.engineHits?'caution':'ready','РЕАКТОР',u.dead?'ПОТЕРЯН':u.shutdown?'OFF':u.engineHits?'ПОВРЕЖДЁН':'ONLINE'],[u.heat>=14?'alarm':u.heat>=8?'caution':'ready','ТЕМПЕРАТУРА',u.heat+'°'],[u.gyroHits?'alarm':u.prone?'caution':'ready','ГИРОСКОП',u.gyroHits?'ПОВРЕЖДЁН':u.prone?'ЛЁЖА':'СТАБИЛЕН'],[u.unconscious||u.pilotWounds>=6?'alarm':u.pilotWounds?'caution':'ready','ПИЛОТ',u.unconscious?'БЕЗ СОЗНАНИЯ':u.pilotWounds+'/6 РАНЕНИЙ']].map(([state,label,value])=>`<div class="system-lamp ${state}"><i aria-hidden="true"></i><span>${label}<b>${value}</b></span></div>`).join('')}</div><div class="telemetry"><label>БРОНЯ <b>${Math.round(armorRatio*100)}%</b></label><meter min="0" max="1" value="${armorRatio}"></meter><label>ТЕПЛОВАЯ НАГРУЗКА <b>${u.heat} / 30</b></label><meter class="thermal" min="0" max="30" value="${Math.min(30,u.heat)}"></meter></div>`;
const a=$('#actions');if(game.phase==='setup'){a.innerHTML='<p class="hint">Развёртывание AGoAC: бросок обоих отрядов определит, кто выбирает сторону входа. Первый игровой раунд начнётся отдельной инициативой.</p>';}else if(game.phase==='initiative'){a.innerHTML='<p class="hint">Оба отряда бросают 2d6. Проигравший действует первым. Приказы чередуются по одному меху.</p>';}else if(game.phase==='heat'){a.innerHTML='<p class="hint">Следующий шаг разрешит нагрев, отключения и перегрев боезапаса.</p>';}else if(game.phase==='end'){
 a.innerHTML='<div class="controltitle">КОНЕЦ ХОДА · РЕАКТОРЫ</div><p class="hint">По желанию назначьте или отмените отключение/перезапуск. Аварийный перезапуск разрешается в фазе нагрева.</p>';
 for(const unit of game.units.filter(v=>(roomMode?
  (remoteRole==='attacker'?v.team===game.scenario?.attackerTeam:
   v.team===game.scenario?.defenderTeam&&
   game.sharedDefenderCanControl(v,remoteRole)):
  (hotseat||v.team===0))&&game.canOrderShutdown(v))){
  const field=document.createElement('label');field.className='switch-line';
  const toggle=document.createElement('mech-toggle');toggle.dataset.endShutdown=String(unit.id);
  const caption=unit.name+' · '+(unit.shutdown?'Перезапустить реактор':'Отключить реактор');
  toggle.setAttribute('label',caption);toggle.checked=!!unit.shutdownNext;
  toggle.disabled=busy||remoteMode&&!remoteReady;
  toggle.onchange=()=>{toggle.checked=!!unit.shutdownNext;return action(()=>game.orderShutdown(unit.id),false,{type:'shutdown',id:unit.id});};
  field.append(toggle,document.createTextNode(caption));a.append(field);
 }
}else if(!acting){a.innerHTML=`<p class="hint">${busy?'Выполняется приказ…':game.queue.length?'Очередь: '+(game.activeTeam?'красный':'зелёный')+' отряд. Выберите его меха.':'Все приказы приняты. Перейдите к разрешению фазы.'}</p>`;}else if(game.phase==='move'&&u.deployed===false){renderDeploymentEntry(u,a);}else if(game.phase==='move'){
const legs=u.config==='Quad'?['LA','RA','LL','RL']:['LL','RL'];
const lostLegs=legs.filter(l=>!u.structure[l]).length;
const restrictedStand=u.prone&&lostLegs===(u.config==='Quad'?2:1);
const minStand=u.prone&&u.spent===0&&!u.standAttempts&&Math.max(game.mp(u,'walk'),game.mp(u,'run'))===1;
if(u.moveMode!=='stand')mode=u.moveMode;
else if(u.prone&&(minStand||restrictedStand))mode='run';
else if(u.prone&&!['walk','run'].includes(mode))mode='walk';
const standBudget=restrictedStand?2:game.mp(u,mode);
const standDisabled=u.prone&&(!['walk','run'].includes(mode)||restrictedStand&&mode!=='run'||!minStand&&standBudget-u.spent<2||u.gyroHits>=2||u.moveEndedByLegLoss||game.isImmobile(u)||lostLegs>=(u.config==='Quad'?3:2)||restrictedStand&&u.standAttempts>0);
a.innerHTML=`<div class="controltitle">ДВИЖЕНИЕ · ${u.spent} / ${game.mp(u,mode)} MP · КУРС ${u.facing+1}</div><div class="segments">${[['walk','Ходьба'],['run','Бег'],['jump','Прыжок'],...(game.tacticalOptions?.evading?[['evade','Уклонение']]:[])].map(([m,t])=>`<button data-mode="${m}" aria-pressed="${mode===m}" class="${mode===m?'on':''}" ${((m==='jump'&&(!u.jump||u.prone||u.proneAtStart))||(m==='evade'&&(u.prone||u.actuators.LL.hip||u.actuators.RL.hip)))||u.moveMode!=='stand'&&u.moveMode!==m?'disabled':''}>${t}</button>`).join('')}</div><div class="segments" style="margin-top:8px"><button id="turnleft" ${mode==='jump'||u.moveMode==='jump'?'disabled':''}>↶ −1 MP</button><button id="turnright" ${mode==='jump'||u.moveMode==='jump'?'disabled':''}>↷ −1 MP</button><button id="stance" ${standDisabled||!u.prone&&(!['walk','run'].includes(mode)||game.mp(u,mode)-u.spent<1)?'disabled':''}>${u.prone?(minStand?'Встать · 1 MP (мин.)':'Встать · 2 MP'):'Лечь · 1 MP'}</button></div><p class="hint">Светлые гексы — доступные пути с учётом поворотов. Можно продолжать движение до исчерпания MP. Затем подтвердите приказ.</p><button class="primary" id="hold">ЗАВЕРШИТЬ ПРИКАЗ МЕХА</button>`;
if(mode==='jump'&&u.moveMode!=='jump')appendJumpFacing(a,u.facing);
if(u.prone)appendFacingSelector(a,u.facing,'stand-facing','Курс после успешного подъёма (без MP)');
a.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{mode=b.dataset.mode;renderUI();});
$('#turnleft').onclick=()=>action(()=>game.rotate(selected,1,{mode}),false,{type:'rotate',id:selected,delta:1,mode});
$('#turnright').onclick=()=>action(()=>game.rotate(selected,-1,{mode}),false,{type:'rotate',id:selected,delta:-1,mode});
$('#stance').onclick=()=>{
 if(u.prone){
  const facing=Number($('#stand-facing').value),standingMode=minStand||restrictedStand?'run':mode;
  return action(()=>game.stand(selected,facing,{mode:standingMode,minimum:minStand}),false,{type:'stand',id:selected,facing,mode:standingMode,minimum:minStand});
 }
 return action(()=>game.drop(selected,{mode}),false,{type:'drop',id:selected,mode});
};$('#hold').onclick=()=>action(()=>game.hold(selected),true,{type:'hold',id:selected});
 }else if(game.phase==='fire'){
const hexChoices=[...new Set([target,...Object.values(weaponTargets)])].filter(id=>typeof id==='string'&&game.fireTarget(id));
const primaryChoices=game.primaryTargetChoices(u.id,[...picked].map(index=>({target:weaponTargets[index]??target})));
if(!primaryChoices.includes(primaryTarget))primaryTarget=primaryChoices[0]??null;
a.innerHTML=`<div class="controltitle">ТОРС / СЕКТОР ОГНЯ</div><div class="segments">${[-1,0,1].map(n=>`<button data-twist="${n}" aria-pressed="${u.twist===n}" class="${u.twist===n?'on':''}" ${u.prone?'disabled':''}>${n===0?'Прямо':n===1?'Влево':'Вправо'}</button>`).join('')}</div><p class="hint">Каждому орудию можно выбрать цель. Нажмите пустой гекс на карте, чтобы стрелять по нему. Выстрелы разрешаются после деклараций обоих отрядов.</p><label>Основная цель<select id="primary-fire-target" aria-label="Основная цель" ${primaryChoices.length?'':'disabled'}>${primaryChoices.length?primaryChoices.map(id=>`<option value="${id}" ${primaryTarget===id?'selected':''}>${game.fireTarget(id)?.name??'Цель'}</option>`).join(''):'<option>— цель —</option>'}</select></label>${u.weapons.map((w,i)=>{const tid=weaponTargets[i]??target,p=tid!==null&&tid!==undefined?game.preview(u.id,tid,i,{secondary:primaryTarget!==null&&primaryTarget!==tid,aim:fireAim(u,i,tid),spotter:weaponSpotters[i]??null}):null;return `<div class="weapon"><mech-toggle label="Стрелять ${w.name}" data-weapon="${i}" ${picked.has(i)?'checked':''} ${w.destroyed?'disabled':''}></mech-toggle><div><b>${w.name}</b><small>${w.rack?w.rack+' ракет':w.damage+' урона'} · ${w.heat} тепла · ${w.ammo??'∞'}<br>${p?(p.legal?p.targetNumber+'+ · '+p.chance+'%':p.reason):'Выберите цель'}</small><select data-target="${i}" aria-label="Цель ${w.name}"><option value="">— цель —</option>${game.units.filter(v=>v.team!==u.team&&!v.dead).map(v=>`<option value="${v.id}" ${tid===v.id?'selected':''}>${v.name}</option>`).join('')}${hexChoices.map(id=>`<option value="${id}" ${tid===id?'selected':''}>${game.fireTarget(id).name}</option>`).join('')}</select>${!w.rack?`<label class="hint">Прицел<select data-aim="${i}" aria-label="Прицел ${w.name}" ${canAim(u,i,tid)?'':'disabled'}><option value="">Обычный огонь</option>${Object.entries(LOCATIONS).map(([l,n])=>`<option value="${l}" ${fireAim(u,i,tid)===l?'selected':''}>${n}</option>`).join('')}</select></label>`:''}${w.name.startsWith('LRM ')?`<label class="hint">Корректировщик<select data-spotter="${i}" aria-label="Корректировщик ${w.name}"><option value="">Прямой огонь</option>${game.units.filter(v=>v.id!==u.id&&v.team===u.team&&!v.dead&&v.deployed!==false&&!v.charge).map(v=>`<option value="${v.id}" ${weaponSpotters[i]===v.id?'selected':''}>${v.name}</option>`).join('')}</select></label>`:''}</div></div>`;}).join('')}<button class="primary" id="fire">ЗАЯВИТЬ ОГОНЬ</button><button id="hold">Не стрелять</button>`;
a.querySelectorAll('[data-twist]').forEach(b=>b.onclick=()=>action(()=>game.twist(selected,+b.dataset.twist),false,{type:'twist',id:selected,twist:+b.dataset.twist}));a.querySelectorAll('[data-weapon]').forEach(b=>b.onchange=()=>{b.checked?picked.add(+b.dataset.weapon):picked.delete(+b.dataset.weapon);renderUI();});a.querySelectorAll('[data-target]').forEach(b=>b.onchange=()=>{weaponTargets[b.dataset.target]=b.value===''?null:b.value.startsWith('hex:')?b.value:Number(b.value);renderUI();});a.querySelectorAll('[data-aim]').forEach(b=>b.onchange=()=>{weaponAims[b.dataset.aim]=b.value||null;renderUI();});a.querySelectorAll('[data-spotter]').forEach(b=>b.onchange=()=>{weaponSpotters[b.dataset.spotter]=b.value===''?null:Number(b.value);renderUI();});$('#primary-fire-target').onchange=()=>{const value=$('#primary-fire-target').value;primaryTarget=value.startsWith('hex:')?value:Number(value);renderUI();};$('#fire').onclick=fire;$('#hold').onclick=()=>action(()=>game.hold(selected),true,{type:'hold',id:selected});
}else if(game.phase==='physical'){
const physicalOpts={...(physicalType==='punch'&&physicalLimb==='both'&&physicalRightTarget!==null?{rightTarget:physicalRightTarget}:{}),...(physicalType==='hatchet'?{locationTable:physicalLocationTable}:{})};const p=target!==null?game.physicalPreview(selected,target,physicalType,physicalLimb,physicalOpts):null;a.innerHTML=`<div class="controltitle">${target===null?'ВЫБЕРИТЕ СОСЕДНЕГО ВРАГА':'ЦЕЛЬ: '+game.units[target].name.toUpperCase()}</div><select id="ptype"><option value="kick">Удар ногой</option><option value="punch">Удар рукой</option><option value="push">Толчок</option><option value="club">Удар дубиной</option><option value="hatchet">Удар топором</option></select><select id="limb" style="margin-top:8px">${Object.entries({RL:'Правая нога',LL:'Левая нога',RA:'Правая рука',LA:'Левая рука',both:'Обе руки (два броска)'}).map(([v,n])=>`<option value="${v}">${n}</option>`).join('')}</select>${physicalType==='punch'&&physicalLimb==='both'?`<label class="hint">Цель правой руки<select id="physical-right-target"><option value="">Та же цель</option>${game.units.filter(v=>v.team!==u.team&&!v.dead).map(v=>`<option value="${v.id}">${v.name}</option>`).join('')}</select></label>`:''}${physicalType==='hatchet'?'<label class="hint">Таблица попадания<select id="hatchet-table"><option value="normal">Обычная / обязательная по высоте</option><option value="punch">Удар рукой (+4)</option><option value="kick">Удар ногой (+4)</option></select></label>':''}<p class="hint">${p?(p.legal?p.targetNumber+'+ на 2d6 · '+p.damage+' урона':p.reason):'Физическая атака разрешается после всех деклараций.'}</p><button id="physical" class="primary" ${!p?.legal?'disabled':''}>ЗАЯВИТЬ АТАКУ</button><button id="club">Поднять дубину</button><button id="hold">Пропустить</button>`;$('#ptype').value=physicalType;$('#limb').value=physicalLimb;$('#ptype').onchange=()=>{physicalType=$('#ptype').value;physicalLimb=physicalType==='kick'?'RL':'RA';renderUI();};$('#limb').onchange=()=>{physicalLimb=$('#limb').value;renderUI();};if($('#physical-right-target')){$('#physical-right-target').value=physicalRightTarget===null?'':String(physicalRightTarget);$('#physical-right-target').onchange=e=>{physicalRightTarget=e.target.value===''?null:Number(e.target.value);renderUI();};}if($('#hatchet-table')){$('#hatchet-table').value=physicalLocationTable;$('#hatchet-table').onchange=e=>{physicalLocationTable=e.target.value;renderUI();};}$('#physical').onclick=()=>action(()=>game.declarePhysical(selected,target,physicalType,physicalLimb,physicalOpts),true,{type:'physical',id:selected,target,attack:physicalType,limb:physicalLimb,...physicalOpts});$('#club').onclick=()=>action(()=>game.takeClub(selected),true,{type:'club',id:selected});$('#hold').onclick=()=>action(()=>game.hold(selected),true,{type:'hold',id:selected});
}
if(!remoteMode&&hotseat&&game.canAdjudicateStalemate()){
 const button=document.createElement('button');button.type='button';button.id='adjudicate-stalemate';button.textContent='Подтвердить исключительный случай ничьей';button.disabled=busy;
 button.onclick=showStalemateAdjudication;a.append(button);
}
if(!remoteMode&&hotseat&&game.victoryTerms?.condition){
 const agreement=document.createElement('p');agreement.className='hint';agreement.id='agreed-victory-condition';agreement.textContent='Согласованное условие: '+game.victoryTerms.condition;a.append(agreement);
 if(game.canAdjudicateVictory()){
  const button=document.createElement('button');button.type='button';button.id='adjudicate-victory';button.textContent='Подтвердить исход по соглашению';button.disabled=busy;
  button.onclick=showVictoryAdjudication;a.append(button);
 }
}
$('#night').disabled=$('#gale').disabled=game.round!==1||game.phase!=='initiative'||remoteMode&&!remoteReady;if(acting&&u.deployed!==false)advancedControls(u,a);renderRoomDispute(a);
if(game.pendingChoice)renderResolutionChoice(a,game.pendingChoice);$('#next').disabled=busy||game.winner!==null||game.queue.length>0||!!game.pendingChoice||remoteMode&&!remoteReady||roomMode&&!roomCanAdvance();$('#next').textContent=busy?'ВЫПОЛНЕНИЕ ПРИКАЗА…':game.phase==='setup'?'БРОСИТЬ РАЗВЁРТЫВАНИЕ':game.phase==='initiative'?'БРОСИТЬ ИНИЦИАТИВУ':game.phase==='fire'?'РАЗРЕШИТЬ СТРЕЛЬБУ':game.phase==='physical'?'РАЗРЕШИТЬ БЛИЖНИЙ БОЙ':game.phase==='heat'?'РАССЧИТАТЬ НАГРЕВ':game.phase==='end'?'ЗАВЕРШИТЬ ХОД':'К СТРЕЛЬБЕ →';$('#log').innerHTML=game.log.slice(-18).reverse().map(s=>`<p>${s}</p>`).join('');$('#status').textContent=`${PHASES[game.phase]} / ${game.activeTeam===null?'Все приказы приняты':game.activeTeam?'Красный отряд':'Зелёный отряд'}`;if(remoteMode)$('#status').textContent+=remoteReady?' · SERVER VERIFIED / v'+remoteVersion:' · ПОДКЛЮЧЕНИЕ К СЕРВЕРУ';refreshHighlights();if(!busy)syncModels();if(game.winner!==null)toast(game.winner==='draw'?'НИЧЬЯ':`ПОБЕДА: ${game.winner?'КРАСНЫЙ':'ЗЕЛЁНЫЙ'} ОТРЯД`);
}
// AGoAC p.12: select landing orientation before resolving the landing PSR.
function appendJumpFacing(panel,facing){
 return appendFacingSelector(panel,facing,'jump-facing','Курс при приземлении (без MP)');
}
function appendFacingSelector(panel,facing,id,title){
 const label=document.createElement('label');label.className='hint';
 label.textContent=title;
 const select=document.createElement('select');select.id=id;
 select.setAttribute('aria-label',title);
 for(let i=0;i<6;i++){
  const option=document.createElement('option');option.value=String(i);
  option.textContent='Направление '+(i+1);select.append(option);
 }
 select.value=String(facing);label.append(select);panel.append(label);
}
function renderDeploymentEntry(u,panel){
 const options=game.deploymentOptions(u);
 if(!options.some(o=>o.mode===mode)&&options.length)mode=options[0].mode;
 const routes=options.filter(o=>o.mode===mode);
 panel.innerHTML='<div class="controltitle">ВХОД НА ПОЛЕ · СТОРОНА '+(game.deployment.edges[u.team]+1)+'</div>';
 const hint=document.createElement('p');hint.className='hint';
 hint.textContent=!options.length?'Нет допустимого входа. Выберите другой мех, если возможно; иначе измените условия или завершите операцию без результата.':mode==='minimum'?'Минимальное движение: один шаг вперёд бегом, после которого приказ завершается.':'Выберите режим и доступный полный гекс. MP расходуются с первого гекса; после входа можно продолжить движение.';
 panel.append(hint);
 const modes=document.createElement('div');modes.className='segments';
 for(const [value,label] of [['walk','Ходьба'],['run','Бег'],['jump','Прыжок'],['minimum','Мин. шаг']]){
  const button=document.createElement('button');button.dataset.entryMode=value;
  button.textContent=label;button.setAttribute('aria-pressed',String(mode===value));
  button.disabled=game.reachable(u,value).length===0;
  button.onclick=()=>{mode=value;renderUI();};modes.append(button);
 }
 panel.append(modes);
 if(mode==='jump')appendJumpFacing(panel,game.deployment.edges[u.team]);
 const select=document.createElement('select');select.id='entry-hex';select.setAttribute('aria-label','Гекс входа');
 for(const route of routes){
  const option=document.createElement('option');option.value=route.q+','+route.r;
  option.textContent='Гекс '+route.q+', '+route.r+' · '+route.cost+' MP';select.append(option);
 }
 panel.append(select);
 const enter=document.createElement('button');enter.id='enter-field';enter.className='primary';
 enter.textContent='ВОЙТИ НА ПОЛЕ';enter.disabled=!routes.length;
 enter.onclick=()=>{const [q,r]=select.value.split(',').map(Number);void doMove({q,r});};
 panel.append(enter);
}
function renderHitDirectionChoice(panel,choice){
 const title=document.createElement('div');title.className='controltitle';
 title.textContent='ЗАЩИТНИК · СТОРОНА ПОПАДАНИЯ';
 const info=document.createElement('p');info.className='hint';
 info.textContent=(game.unit(choice.unitId)?.name||'Цель')+' · '+(game.unit(choice.context.attackerId)?.name||'Противник')+' · '+choice.context.weaponName+'. Выберите сторону до броска локации.';
 panel.append(title,info);
 const captions={front:'Передняя',left:'Левый борт',right:'Правый борт',rear:'Кормовая'};
 for(const option of choice.options){
  const button=document.createElement('button');button.type='button';button.dataset.resolutionOption=option.id;
  button.textContent=captions[option.id];button.disabled=busy||remoteMode&&!remoteReady;
  button.onclick=()=>advanceInteractivePhase({key:choice.key,option:option.id});
  panel.append(button);
 }
}
function renderResolutionChoice(panel,choice){
 panel.replaceChildren();
 if(roomMode&&!roomCanResolvePendingChoice(choice)){
  const message=document.createElement('p');message.className='hint';
  message.id='room-choice-wait';
  message.textContent='Ожидается решение другого участника. Доступ определяется владельцем меха и текущим спором 2D6.';
  panel.append(message);
  return;
 }
 if(choice.kind==='hit-direction'){renderHitDirectionChoice(panel,choice);return;}
 if(choice.kind==='physical-impossible'){
  const title=document.createElement('div');title.className='controltitle';title.textContent='НЕВОЗМОЖНАЯ ФИЗИЧЕСКАЯ АТАКА';
  const info=document.createElement('p');info.className='hint';info.textContent=(game.unit(choice.unitId)?.name||'Мех')+' · TN '+choice.context.targetNumber+' · '+(game.unit(choice.context.targetId)?.name||'Цель')+'. Отмена исключает последствия промаха.';panel.append(title,info);
  for(const option of choice.options){const b=document.createElement('button');b.type='button';b.dataset.resolutionOption=option.id;b.textContent=option.id==='cancel'?'Отменить атаку':'Атаковать (автоматический промах)';b.disabled=busy||remoteMode&&!remoteReady;b.onclick=()=>advanceInteractivePhase({key:choice.key,option:option.id});panel.append(b);}return;
 }
 const title=document.createElement('div');title.className='controltitle';
 const los=choice.kind==='los-path',impossible=choice.kind==='fire-impossible';
 const firing=choice.kind.startsWith('fire-'),damage=firing&&choice.kind.startsWith('fire-damage-'),heatAmmo=choice.kind==='heat-ammo-bin',recovered=choice.kind==='recovered-reactor';
 title.textContent=impossible?'НЕВОЗМОЖНЫЙ ВЫСТРЕЛ':los?'ЗАЩИТНИК · ВЫБОР ЛИНИИ ОГНЯ':recovered?'КОНЕЦ ХОДА · ПИЛОТ ОЧНУЛСЯ':heatAmmo?'ПЕРЕГРЕВ · ВЫБОР БУНКЕРА':firing?(damage?'ОЧЕРЁДНОСТЬ УРОНА':'ОЧЕРЁДНОСТЬ БРОСКОВ')+(choice.kind.endsWith('-mech')?' · МЕХ':choice.kind.endsWith('-target')?' · ЦЕЛЬ':' · ОРУЖИЕ'):choice.kind==='deployment-edge'?'ВЫБОР СТОРОНЫ ВХОДА':choice.kind==='physical-order'?(choice.context?.stage==='damage'?'ФИЗИЧЕСКИЕ АТАКИ · ПОРЯДОК УРОНА'+(choice.context?.scope==='attack'?' · УДАР':''):choice.context?.stage==='roll'?'ФИЗИЧЕСКИЕ АТАКИ · ПОРЯДОК БРОСКОВ'+(choice.context?.scope==='attack'?' · УДАР':''):'ОЧЕРЁДНОСТЬ ФИЗИЧЕСКИХ АТАК'):choice.kind==='domino'?'УКЛОНЕНИЕ ОТ ДОМИНО':choice.kind==='charge-miss'?'ПРОМАХ ТАРАНОМ · ВЫБОР ГЕКСА':choice.kind==='dfa-approach'?'DFA · ВЫБОР ГЕКСА ПОДЛЁТА':'ВЫТЕСНЕНИЕ ПОСЛЕ DFA';
 panel.append(title);
 const info=document.createElement('p');info.className='hint';
 const pilot=game.unit(choice.unitId),roll=choice.context?.roll;
 info.textContent=impossible?(pilot?.name||'Мех')+' · '+choice.context.weaponName+' · TN '+choice.context.targetNumber+'. Можно отменить выстрел без смены цели.':los?(pilot?.name||'Мех')+' · выберите траекторию атаки '+(game.unit(choice.context.attackerId)?.name||'противника')+'. Она действует до конца раунда в обе стороны.':recovered?(pilot?.name||'Мех')+' · Восстановление сознания: '+roll.total+'/'+roll.target+'+ · Нагрев '+choice.context.heat+'. Можно изменить состояние реактора до конца хода.':heatAmmo?(pilot?.name||'Мех')+' · Нагрев '+choice.context.heat+' · Проверка не пройдена. Выберите один из заполненных бункеров с одинаковым максимальным уроном за выстрел.':firing?(choice.kind.endsWith('-mech')?'Выберите следующий мех своего отряда. Все его атаки на данном этапе разрешаются вместе.':(pilot?.name||'Мех')+' · '+(damage?'Все броски на попадание уже выполнены. Выберите следующий успешный удар.':'Выберите следующую заявленную атаку. Урон будет разрешён только после всех бросков.')+' Все атаки по одной цели сохраняются вместе.'):choice.kind==='deployment-edge'?'Инициатива развёртывания: '+choice.context.green+' : '+choice.context.red+'. '+(choice.team?'Красный':'Зелёный')+' отряд выбирает сторону. Другой отряд получит противоположную.':choice.kind==='physical-order'?(choice.team?'Красный':'Зелёный')+' отряд. '+(choice.context?.scope==='attack'?(choice.context.stage==='roll'?'Выберите следующий удар этого меха. Урон применяется после всех обычных бросков.':'Выберите следующий успешный удар этого меха.'):choice.context?.stage==='roll'?'Выберите следующего меха для бросков. Урон применяется после всех обычных бросков.':choice.context?.stage==='damage'?'Все обычные атаки уже брошены. Выберите следующего меха для применения урона.':'Выберите меха, который разрешит свои атаки первым. Вытеснение может изменить доступность остальных атак.'):(choice.team?'Красный':'Зелёный')+' отряд · '+(pilot?.name||'Мех')+
  ' · гекс '+choice.q+', '+choice.r+(roll?' · PSR '+roll.total+'/'+roll.target+'+':'')+
  '. Выбор выполняется на текущем этапе расчёта; карта обновится после завершения фазы.';
 panel.append(info);
 for(const option of choice.options){
  const button=document.createElement('button');
  button.type='button';button.dataset.resolutionOption=option.id;
  const label=option.id==='decline'?'Не уклоняться':
   option.id==='forward'?'Шаг вперёд':option.id==='back'?'Шаг назад':'Направление '+(Number(option.id)+1);
  const attackNames={punch:'удар рукой',kick:'удар ногой',push:'толчок',charge:'таран',dfa:'DFA',club:'дубина',hatchet:'топор'};
  button.textContent=impossible?(option.id==='cancel'?'Отменить выстрел':'Стрелять (автоматический промах)'):los?'Линия '+(option.choice===1?'A':'B')+' · '+option.path.map(h=>h.q+','+h.r).join(' / ')+(option.blocked?' · перекрыта':' · лес +'+option.woods+(option.cover?' · укрытие':'')):recovered?(option.id==='stay'?'Оставить реактор как есть':option.id==='restart'?'Попытаться перезапустить':'Добровольно отключить'):heatAmmo?option.weaponName+' · '+option.location+' / слот '+option.slot+' · '+option.shots+' выстр. · '+option.damagePerShot+' урона за выстрел':firing?(option.attackerId!==undefined?(game.unit(option.attackerId)?.name||'Мех')+(option.weaponNames.length?' · '+option.weaponNames.join(', '):' · Без попаданий'):option.weaponName===undefined?(game.fireTarget(option.targetId)?.name||'Цель')+' · '+option.weaponNames.join(', '):option.weaponName+' → '+(game.fireTarget(option.targetId)?.name||'Цель')+(option.roll===undefined?'':' · '+option.roll+'/'+option.targetNumber+'+')):choice.kind==='deployment-edge'?'Сторона '+(option.edge+1)+' · '+option.hexes.map(h=>h.q+','+h.r).join(' / '):choice.kind==='physical-order'?
   (game.unit(option.attackerId)?.name||'Мех')+' · '+option.attacks.map(a=>
    (attackNames[a.type]||a.type)+(a.limb?' ('+({LA:'левая рука',RA:'правая рука',LL:'левая нога',RL:'правая нога'}[a.limb]||a.limb)+')':'')+' → '+(game.unit(a.targetId)?.name||'цель')).join('; '):
   label+(option.q===undefined?'':' · '+option.q+', '+option.r)+
   (option.cost===undefined?'':' · '+option.cost+' MP')+(option.offboard?' · за край карты':'');
  button.disabled=busy||remoteMode&&!remoteReady;
  button.onclick=()=>advanceInteractivePhase({key:choice.key,option:option.id});
  panel.append(button);
 }
}
function advancedControls(u,a){const panel=document.createElement('details');panel.className='advanced';panel.innerHTML='<summary>Дополнительные приказы</summary>';if(game.phase==='move'){panel.innerHTML+=`<p class="hint">${target!==null?'Цель: '+game.units[target].name:'Выберите врага для тарана/DFA'}</p><div class="segments"><button id="charge">Таран</button><button id="dfa">DFA</button></div><button id="minimum">Минимальный шаг</button><label class="switch-line"><mech-toggle id="shutdown" label="Отключить реактор в конце хода" ${u.shutdownNext?'checked':''}></mech-toggle> Отключить в конце хода</label><label class="hint">Сброс боезапаса<select id="dumpbin"><option value="">— выбрать бункер —</option>${u.bins.map((b,i)=>`<option value="${i}">${b.location}: ${u.weapons[b.weapon].name} · ${b.shots}</option>`).join('')}</select></label>`;a.appendChild(panel);$('#charge').onclick=()=>specialMove('charge');$('#dfa').onclick=()=>specialMove('dfa');$('#minimum').onclick=()=>action(()=>game.minimumMove(selected),true,{type:'minimum',id:selected});$('#shutdown').onchange=event=>{event.target.checked=!!u.shutdownNext;return action(()=>game.orderShutdown(selected),false,{type:'shutdown',id:selected});};$('#dumpbin').onchange=()=>{const v=$('#dumpbin').value;if(v!=='')action(()=>game.orderDump(selected,+v),false,{type:'dump',id:selected,bin:+v}).catch(reportActionError);};}else if(game.phase==='fire'){panel.innerHTML+=`<label class="switch-line"><mech-toggle id="flip" label="Руки развёрнуты назад" ${u.flip?'checked':''}></mech-toggle> Разворот рук назад</label><label class="hint">Опорная рука лёжа<select id="brace"><option value="LA">Левая</option><option value="RA">Правая</option></select></label>`;panel.innerHTML+=`${u.weapons.some(w=>w.name==='Flamer')?'<label class="hint"><mech-toggle id="flamerheat" label="Огнемёт: нагрев вместо урона"></mech-toggle> Огнемёт: +2 нагрева вместо урона</label>':''}${u.weapons.map((w,i)=>w.ammo!==null?`<label class="hint">Бункер: ${w.name}<select data-binweapon="${i}"><option value="">Автоматически</option>${u.bins.map((b,j)=>b.weapon===(w.shared??i)?`<option value="${j}" ${weaponBins[i]===j?'selected':''}>${b.location} / слот ${b.slot+1}: ${b.shots}</option>`:'').join('')}</select></label>`:'').join('')}`;a.appendChild(panel);panel.querySelectorAll('[data-binweapon]').forEach(el=>el.onchange=()=>{weaponBins[el.dataset.binweapon]=el.value===''?null:+el.value;});if($('#flamerheat')){$('#flamerheat').checked=flamerHeat;$('#flamerheat').onchange=()=>{flamerHeat=$('#flamerheat').checked;};}$('#flip').onchange=event=>{const enabled=event.target.checked;event.target.checked=!!u.flip;return action(()=>game.flipArms(selected,enabled),false,{type:'flip',id:selected,enabled});};$('#brace').value=u.brace||'LA';$('#brace').onchange=()=>action(()=>game.setBrace(selected,$('#brace').value),false,{type:'brace',id:selected,limb:$('#brace').value});}}
async function specialMove(type){if(game.pendingChoice)return;if(target===null){toast('Сначала выберите врага.');return;}if(remoteMode)return serverCommand({type:'charge',id:selected,target,attack:type,mode:'run'});const id=selected,r=game.chargeWithChoices(id,target,type,{humanTeams:hotseat?[0,1]:[0]});return finishLocalMove(id,r,true);}
function selectUnit(id){if(busy)return;const u=game.units[id];if(['move','fire','physical'].includes(game.phase)&&game.canAct(game.units[selected])&&owned(game.units[selected])&&u.team!==game.units[selected].team&&game.onMap(u)&&!u.dead){target=id;renderUI();return;}selected=id;arcWeapon='all';target=null;weaponTargets={};weaponBins={};weaponSpotters={};weaponAims={};flamerHeat=false;primaryTarget=null;picked=new Set(u.weapons.map((_,i)=>i));mode=u.moveMode==='stand'?'walk':u.moveMode;renderUI();}
async function showRolls(rolls){for(const r of rolls||[])await animateRoll(r,PHASES[game.phase]);}
function chooseActive(){if(game.activeTeam!==null){const u=game.units.find(u=>game.canAct(u)&&(!roomMode||roomControls(u)));if(u){selected=u.id;arcWeapon='all';mode=u.moveMode==='stand'?'walk':u.moveMode;}}target=null;weaponTargets={};weaponBins={};weaponSpotters={};weaponAims={};flamerHeat=false;primaryTarget=null;picked=new Set(game.units[selected].weapons.map((_,i)=>i));}
async function pumpAI(){if(remoteMode||hotseat)return;while(!game.pendingChoice&&game.activeTeam===1&&game.winner===null){const u=game.aiSelection();if(!u)break;game.phaseRolls=[];if(game.phase==='move'){const r=game.aiMoveWithChoices(u.id,{humanTeams:[0]});if(!r.ok){toast(r.error);break;}if(r.pending)break;await animateMove(u.id,r);}else if(game.phase==='fire'){const r=game.aiAttackWithLosChoices(u.id,{humanTeams:[0]});if(r.pending)break;}else game.aiPhysical(u.id);await showRolls(game.phaseRolls);syncModels();}}
async function action(fn,advance=false,order=null){if(game.pendingChoice)return;if(remoteMode)return serverCommand(order);if(busy)return;game.phaseRolls=[];const r=fn();if(!r?.ok){toast(r?.error||'Приказ не выполнен');return;}if(r.losPrepared){renderUI();if(!r.pending)toast('Линия огня выбрана. Проверьте цели и подтвердите огонь.');return;}if(game.units[selected].dead&&game.actingId===selected){game.hold(selected);advance=true;}busy=true;renderUI();await showRolls(game.phaseRolls);if(advance){await pumpAI();chooseActive();}busy=false;renderUI();}
const ray=new THREE.Raycaster();const pointer=new THREE.Vector2();const activePointers=new Map();let gestureUsed=false,pinchDistance=null;
function selectEmptyFireHex(t){const id='hex:'+t.q+','+t.r;if(game.phase==='fire'&&owned(game.units[selected])&&game.canAct(game.units[selected])&&game.fireTarget(id)){target=id;renderUI();}}
function pickCanvas(e){if(busy)return;const rect=renderer.domElement.getBoundingClientRect();pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);ray.setFromCamera(pointer,camera);if(software){let coords=[...game.tiles].map(t=>({t,p:project(world(t.q,t.r).add(new THREE.Vector3(0,groundY(t.q,t.r),0)))}));coords.sort((a,b)=>Math.hypot(a.p.x-(e.clientX-rect.left),a.p.y-(e.clientY-rect.top))-Math.hypot(b.p.x-(e.clientX-rect.left),b.p.y-(e.clientY-rect.top)));const t=coords[0].t;let at=game.units.find(u=>game.onMap(u)&&u.q===t.q&&u.r===t.r);if(at)selectUnit(at.id);else if(game.phase==='move'&&owned(game.units[selected]))doMove(t).catch(reportActionError);else selectEmptyFireHex(t);return;}const objects=[...records.entries()].filter(([id])=>game.onMap(game.unit(id))).map(([,r])=>r.root);const hit=ray.intersectObjects(objects,true)[0];if(hit){let o=hit.object;while(o.parent&&o.parent!==scene)o=o.parent;const entry=[...records.entries()].find(([id,r])=>r.root===o);if(entry){selectUnit(entry[0]);return;}}const tilehit=ray.intersectObjects(tileMeshes)[0];if(tilehit){let t=tilehit.object.userData.tile;let at=game.units.find(u=>game.onMap(u)&&u.q===t.q&&u.r===t.r);if(at){selectUnit(at.id);return;}if(game.phase==='move'&&owned(game.units[selected]))doMove(t).catch(reportActionError);else selectEmptyFireHex(t);}}
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
      zoom=THREE.MathUtils.clamp(zoom*pinchDistance/distance,5,Math.max(20,fitBoard()*1.7));
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
renderer.domElement.addEventListener('wheel',e=>{e.preventDefault();zoom=THREE.MathUtils.clamp(zoom+Math.sign(e.deltaY)*.8,5,Math.max(20,fitBoard()*1.7));resize();},{passive:false});
async function animateMove(id,res){if(!res.ok||!res.path?.length)return;const rec=records.get(id);if(!rec)return;if(res.entry){rec.root.visible=true;rec.root.position.copy(world(res.from.q,res.from.r));rec.root.position.y=groundY(res.to.q,res.to.r);}if(software){rec.root.position.copy(world(res.to.q,res.to.r));rec.root.position.y=groundY(res.to.q,res.to.r);await pause(250);return;}play(id,res.mode==='run'?'Run':'Walk');for(const p of res.path){let start=rec.root.position.clone(),end=world(p.q,p.r);end.y=groundY(p.q,p.r);rec.root.rotation.y=Math.atan2(end.x-start.x,end.z-start.z);await new Promise(resolve=>{effects.push({type:'move',rec,start,end,time:0,duration:res.mode==='jump'?.9:res.mode==='run'?.17:.24,jump:res.mode==='jump',resolve});});}play(id,'Sentinel');}
async function doMove(t){if(game.pendingChoice)return;const landing=$('#jump-facing'),facing=mode==='jump'&&landing?Number(landing.value):undefined;if(remoteMode)return serverCommand({type:'move',id:selected,q:t.q,r:t.r,mode,...(facing===undefined?{}:{facing})});if(busy)return;const id=selected,res=game.moveWithChoices(id,t.q,t.r,mode,{facing,humanTeams:hotseat?[0,1]:[0]});return finishLocalMove(id,res);}
async function finishLocalMove(id,res,selectionDone=false){if(!res.ok){toast(res.error);return;}if(res.pending){renderUI();return;}busy=true;renderUI();await animateMove(id,res);await showRolls(res.rolls);if(selectionDone||res.ended||game.units[id].dead){if(!selectionDone&&!res.ended)game.hold(id);await pumpAI();chooseActive();}busy=false;toast(res.ended?'Минимальный шаг выполнен. Приказ завершён.':'Маршрут выполнен. Можно продолжить движение или подтвердить приказ.');renderUI();}
async function animateAttack(id,tid,res){if(!res.ok||!res.shots)return;const rec=records.get(id),tr=records.get(tid);const hex=typeof tid==='string'?game.fireTarget(tid):null;if(!rec||!tr&&!hex){for(const shot of res.shots)await showRolls(shot.rolls);return;}let from=rec.root.position.clone().add(new THREE.Vector3(0,1.3,0)),to=tr?tr.root.position.clone().add(new THREE.Vector3(0,1,0)):world(hex.q,hex.r).add(new THREE.Vector3(0,groundY(hex.q,hex.r),0));rec.root.rotation.y=Math.atan2(to.x-from.x,to.z-from.z);const melee=res.shots.some(s=>['punch','kick','push','club','hatchet','Таран','DFA'].includes(s.weapon));play(id,melee?'PunchCombo':'KneelFire',true);await pause(220);for(const shot of res.shots){for(const roll of shot.rolls||[])await animateRoll(roll,game.units[id].name+' → '+(game.fireTarget(tid)?.name||'Цель')+' / '+shot.weapon);const dest=to.clone();if(!shot.hit)dest.x+=1.2;const geo=new THREE.BufferGeometry().setFromPoints([from,dest]);const line=new THREE.Line(geo,new THREE.LineBasicMaterial({color:shot.weapon.includes('Laser')?0xff5851:shot.weapon==='PPC'?0x80d9ff:0xffdb77,transparent:true,opacity:1}));if(!melee){scene.add(line);effects.push({type:'beam',obj:line,time:0,duration:.38});}else{geo.dispose();line.material.dispose();}for(let j=0;j<12;j++){let spark=new THREE.Mesh(new THREE.SphereGeometry(.045,4,4),new THREE.MeshBasicMaterial({color:shot.hit?0xffb55c:0x9d9e7e}));spark.position.copy(dest);scene.add(spark);effects.push({type:'spark',obj:spark,v:new THREE.Vector3((Math.random()-.5)*3,Math.random()*3,(Math.random()-.5)*3),time:0,duration:.6});}toast(`${shot.weapon} · 2d6: ${shot.roll} / ${shot.targetNumber}+ · ${shot.hit?'ПОПАДАНИЕ −'+shot.damage:'ПРОМАХ'}`);if(shot.hit&&tr&&!tr.dead)play(tid,'HitChest',true);await pause(400);}await pause(250);play(id,'Sentinel');if(tr&&!game.units[tid]?.dead)play(tid,'Sentinel');}
function canAim(u,index,tid){const t=game.fireTarget(tid),w=u?.weapons[index];return !!(w&&!w.rack&&t&&!t.hexTarget&&!t.dead&&t.deployed!==false&&t.team!==u.team&&weaponSpotters[index]==null&&game.isImmobile(t));}
function fireAim(u,index,tid){return canAim(u,index,tid)?weaponAims[index]||null:null;}
async function fire(){const entries=[...picked].map(index=>({index,target:weaponTargets[index]??target,aim:fireAim(game.unit(selected),index,weaponTargets[index]??target),bin:weaponBins[index]??null,heatMode:weaponSpotters[index]==null&&game.unit(selected).weapons[index]?.name==='Flamer'&&flamerHeat,...(weaponSpotters[index]==null?{}:{spotter:weaponSpotters[index]})}));if(!entries.length){toast('Выберите оружие или нажмите «Не стрелять».');return;}await action(()=>game.declareFireWithLosChoices(selected,entries,primaryTarget,{humanTeams:hotseat?[0,1]:[0]}),true,{type:'fire',id:selected,shots:entries,...(primaryTarget===null?{}:{primaryTarget})});}
async function advanceInteractivePhase(choice){
 if(remoteMode)return serverCommand({type:'next',...(choice?{choice}:{})});
 if(busy)return;
 const los=game.pendingChoice?.scope==='los';
 const movement=game.pendingChoice?.scope==='movement'?game._resolutionReplay?.movement:null;
 const r=game.nextPhaseWithChoices({humanTeams:hotseat?[0,1]:[0],choice});
 if(movement)return finishLocalMove(movement.id,r,!!movement.kind);
 if(los&&r?.ok){
  if(!hotseat&&game.activeTeam===1){busy=true;await pumpAI();chooseActive();busy=false;}
  renderUI();return;
 }
 if(!r?.ok){toast(r?.error);return;}
 if(r.pending){renderUI();return;}
 busy=true;renderUI();
 if(game.resolution.length){
  for(const attack of game.resolution)await animateAttack(attack.id,attack.target,attack);
  await showRolls(game.afterRolls);
 }else await showRolls(game.phaseRolls);
 syncModels();await pumpAI();chooseActive();busy=false;renderUI();
 toast(game.winner===null?PHASES[game.phase]+'. Следуйте очередности приказов.':'Бой завершён.');
}
$('#next').onclick=()=>advanceInteractivePhase();
function modal(html){$('#modal').classList.remove('recorddialog');$('#modalbody').innerHTML=html;$('#modal').showModal();}$('#close').onclick=()=>$('#modal').close();$('#modal').addEventListener('click',e=>{if(e.target===$('#modal'))$('#modal').close();});
function sheet(u){modal(recordSheet(u));$('#modal').classList.add('recorddialog');}
function openRecordList(){
 modal('<h2>Листы мехов</h2><p>Открытые данные боя. Просмотр не изменяет текущий приказ.</p><div id="record-list"></div>');
 const list=$('#record-list');
 for(const unit of game.units.filter(u=>!u.notFielded)){
  const button=document.createElement('button');
  button.type='button';button.className='sheetbtn';button.dataset.recordId=String(unit.id);
  button.textContent=unit.name+' · '+(unit.team?'Красный':'Зелёный')+' · '+(unit.dead?'Уничтожен':'В бою');
  button.onclick=()=>sheet(unit);
  list.appendChild(button);
 }
}

const rulesURL='https://static1.squarespace.com/static/5e5f11b6a6b48b3ae5c4ee36/t/5e69a64e3d430e6e35ad7fda/1583982189894/cat3500d+battletech+a+game+of+armored+combat+rulebook.pdf';
$('#help').onclick=()=>modal(`<div class="eyebrow">ПОЛЕВОЕ РУКОВОДСТВО</div><h2>Цикл боя AGoAC</h2><ol><li>Бросьте инициативу. Проигравший отряд действует первым. Выберите меха, у которого указано «Ваша очередь».</li><li>Двигайтесь по подсвеченным гексам. Повороты стоят MP. Можно продолжить маршрут или повернуться, затем нажмите «Завершить приказ меха».</li><li>В оружейной фазе выберите торс, оружие и цели. Приказы обоих отрядов фиксируются до разрешения стрельбы. Уже заявленный выстрел происходит даже при уничтожении стрелка в этой фазе.</li><li>Затем заявите физические атаки соседним мехам или пропустите их. После разрешения боя пройдите нагрев и конец хода.</li></ol><h3>Повреждения и пилот</h3><p>Учитываются кормовая броня, критические слоты, двигатель, гироскоп, актуаторы, датчики, боезапас, ранения и сознание пилота. Падение и подъём проверяются кубиками. Вода влияет на движение, стрельбу и охлаждение.</p><h3>Покрытие книги</h3><p>Текущая реализация расширяет базовый бой. <a href="coverage.html" target="_blank">Полный перечень реализованных правил и оставшихся ограничений</a>. В интерфейсе не обозначаются реализованными правила, для которых ещё нет управления или проверки.</p><p>Игра вдвоём — на одном устройстве. Сетевого режима нет. <a href="${rulesURL}" target="_blank">Исходная книга правил</a>.</p>`);
$('#credits').onclick=()=>modal(`<div class="eyebrow">ИСТОЧНИКИ / ASSET MANIFEST</div><h2>О проекте</h2><p>Неофициальная фан-игра. BattleTech и названия мехов принадлежат их правообладателям. Проект не связан с Catalyst Game Labs.</p><h3>Правила</h3><p><a target="_blank" rel="noopener" href="${rulesURL}">BattleTech: A Game of Armored Combat — Rulebook</a>. Реализовано тактическое подмножество; перечень упрощений — в разделе «Правила».</p><h3>Модели из интернета</h3><p><a href="https://github.com/RamonLinares/atlas-09" target="_blank" rel="noopener">Ramon Linares / FORGE Character Lab</a> — Atlas-09 и Aether-02, лицензия CC0. Настоящие объёмные GLB-модели со скелетной анимацией ходьбы, бега, стрельбы, попаданий и уничтожения.</p><p>Это оригинальные дизайны — визуальные заменители, а не канонические модели Griffin, Wolverine, Shadow Hawk и Thunderbolt.</p><p><a href="ASSET-LICENSE.md" target="_blank">Лицензия моделей</a> · Графика: Three.js (MIT).</p>`);
$('#rotateL').onclick=()=>{angle-=Math.PI/6;cam();};$('#rotateR').onclick=()=>{angle+=Math.PI/6;cam();};$('#zoomIn').onclick=()=>{zoom=Math.max(5,zoom-1.5);resize();};$('#zoomOut').onclick=()=>{zoom=Math.min(Math.max(20,fitBoard()*1.7),zoom+1.5);resize();};$('#resetcam').onclick=()=>{zoom=fitBoard();angle=Math.PI/4;cam();};
function reset(standard=!!game.deployment,setup=null){if(setup){const trial=new Game();const map=trial.configureSetupMap(setup.map);if(!map.ok){toast(map.error);return false;}const valid=trial.configureSetupForces(setup);if(!valid.ok){toast(valid.error);return false;}if(setup.victoryTerms){const result=trial.configureVictoryTerms(setup.victoryTerms);if(!result.ok){toast(result.error);return false;}}}clearDice();game.reset();if(setup){game.configureSetupMap(setup.map);game.configureSetupForces(setup);if(setup.victoryTerms)game.configureVictoryTerms(setup.victoryTerms);}if(standard)game.startStandardDeployment();game.weather={night:$('#night').checked,gale:$('#gale').checked};game.tacticalOptions={standingStill:$('#to-still').checked,evading:$('#to-evade').checked,floatingCriticals:$('#bmm-floating').checked,underwaterFire:$('#bmm-underwater').checked};buildTerrain();buildArcMeshes();reconcileModelRecords();zoom=fitBoard();cam();selected=0;arcWeapon='all';target=null;team=0;mode='walk';picked=new Set(game.units[0].weapons.map((_,i)=>i));for(const u of game.units){const rec=records.get(u.id);if(!rec)continue;rec.dead=false;rec.removalAnimation=false;rec.root.visible=true;rec.root.position.copy(world(u.q,u.r));rec.root.position.y=groundY(u.q,u.r);rec.root.rotation.y=u.team?-Math.PI/2:Math.PI/2;rec.label.style.display='block';play(u.id,'Sentinel');}syncModels();renderUI();toast(standard?'Новый бой. Бросьте развёртывание.':'Новый бой. Бросьте инициативу.');return true;}
function showStalemateAdjudication(){
 if(remoteMode||!hotseat||busy||!game.canAdjudicateStalemate())return;
 modal('<h2>Ничья · AGoAC</h2><p>Ручное подтверждение правила для исключительных случаев: ни один оставшийся мех обеих сторон больше не может двигаться или наносить противнику урон. Временное отключение или отсутствие цели в этом раунде недостаточно. Движок не проверяет истинность подтверждения за игроков.</p><label><mech-toggle id="stalemate-green" label="Зелёные подтверждают оба условия"></mech-toggle> Зелёные подтверждают оба условия для обеих сторон</label><label><mech-toggle id="stalemate-red" label="Красные подтверждают оба условия"></mech-toggle> Красные подтверждают оба условия для обеих сторон</label><button class="primary" id="stalemate-confirm" disabled>ПОДТВЕРДИТЬ НИЧЬЮ</button>');
 const update=()=>{const approved=$('#stalemate-green').checked&&$('#stalemate-red').checked;$('#stalemate-confirm').disabled = !approved;};
 $('#stalemate-green').onchange=update;$('#stalemate-red').onchange=update;
 $('#stalemate-confirm').onclick=()=>{
  const confirmations=['#stalemate-green','#stalemate-red'].map(id=>({cannotMove:$(id).checked,cannotDamage:$(id).checked}));
  const result=game.adjudicateStalemate({confirmations});
  if(!result.ok){toast(result.error);return;}$('#modal').close();renderUI();
 };
}
function showVictoryAdjudication(){
 if(remoteMode||!hotseat||busy||!game.canAdjudicateVictory())return;
 modal('<h2>Итог по согласованному условию</h2><p id="verdict-condition"></p><label>Результат<select id="verdict-outcome"><option value="draw">Ничья</option><option value="0">Победа зелёных</option><option value="1">Победа красных</option></select></label><label><mech-toggle id="verdict-green" label="Зелёные подтверждают итог"></mech-toggle> Зелёные подтверждают</label><label><mech-toggle id="verdict-red" label="Красные подтверждают итог"></mech-toggle> Красные подтверждают</label><button id="verdict-confirm" class="primary" disabled>ПОДТВЕРДИТЬ ИТОГ</button>');
 $('#verdict-condition').textContent=game.victoryTerms.condition;
 const update=()=>{const approved=$('#verdict-green').checked&&$('#verdict-red').checked;$('#verdict-confirm').disabled = !approved;};
 $('#verdict-green').onchange=update;$('#verdict-red').onchange=update;
 $('#verdict-outcome').onchange=()=>{$('#verdict-green').checked=false;$('#verdict-red').checked=false;update();};
 $('#verdict-confirm').onclick=()=>{
  const value=$('#verdict-outcome').value,winner=value==='draw'?value:Number(value);
  const result=game.adjudicateVictory({winner,approvals:[$('#verdict-green').checked,$('#verdict-red').checked]});
  if(!result.ok){toast(result.error);return;}$('#modal').close();renderUI();
 };
}
function showBattleSetup({preferCustom=false}={}){
 const stock=new Game().units,custom=readCustomDesign();
 modal('<h2>Подготовка нового боя</h2><p>Сначала выберите карту, затем состав сторон. Текущий бой будет сброшен.</p><label class="hint">Поле боя<select id="setup-layout"><option value="hex">Шестиугольное (127 гексов)</option><option value="sheet">Одна прямоугольная секция</option><option value="horizontal">Две секции рядом</option><option value="vertical">Две секции в глубину</option></select></label><label class="hint">Карта 1<select id="setup-map"></select></label><label class="hint">Ориентация<select id="setup-map-rotation"></select></label><div id="setup-second-sheet" hidden><label class="hint">Карта 2<select id="setup-map-2"></select></label><label class="hint">Ориентация 2<select id="setup-map-rotation-2"></select></label></div><div id="setup-forces"></div><div id="setup-extra"></div><div class="segments"><button type="button" id="setup-add-green">+ Зелёный мех</button><button type="button" id="setup-add-red">+ Красный мех</button></div>'+
  '<div id="setup-custom-consent" hidden><p>Нестандартный мех: согласие обеих сторон обязательно.</p>'+
  '<label><mech-toggle id="setup-approve-green" label="Зелёная сторона согласна"></mech-toggle> Зелёная сторона согласна</label>'+
  '<label><mech-toggle id="setup-approve-red" label="Красная сторона согласна"></mech-toggle> Красная сторона согласна</label></div>'+
  '<label class="hint">Условия победы<select id="setup-victory"><option value="standard">Стандартные AGoAC</option><option value="limit">Ничья по лимиту раундов (по соглашению)</option><option value="custom">Свои условия (два игрока)</option></select></label>'+
  '<div id="setup-victory-consent" hidden><label id="setup-limit-label">Лимит раундов <input type="number" id="setup-round-limit" min="1" max="1000" value="12"></label><label id="setup-condition-label" hidden>Условие победы (итог подтверждают оба игрока между раундами или после окончания боя)<textarea id="setup-condition" maxlength="500"></textarea></label><label><mech-toggle id="setup-victory-green" label="Зелёная сторона согласна с условиями победы"></mech-toggle> Зелёная сторона согласна</label><label><mech-toggle id="setup-victory-red" label="Красная сторона согласна с условиями победы"></mech-toggle> Красная сторона согласна</label></div>'+
  '<button class="primary" id="confirmstandard">СТАНДАРТНОЕ РАЗВЁРТЫВАНИЕ AGoAC</button><button id="confirmreset">НАЧАТЬ ЗАНОВО · ГОТОВАЯ РАССТАНОВКА</button><button id="setup-printed" type="button">СЦЕНАРИИ ИЗ КНИГИ · ГЛАВА 11</button>');
 for(const id of ['#setup-map','#setup-map-2'])for(const p of AGOAC_MAP_PRESETS){const option=document.createElement('option');option.value=p.id;option.textContent=p.name;$(id).append(option);}
 function updateLayout(){
  const layout=$('#setup-layout').value;
  const joined = layout === 'horizontal' || layout === 'vertical';
  $('#setup-second-sheet').hidden = !joined;
  for(const [id,angles] of [['#setup-map-rotation',layout==='hex'?[0,1,2,3,4,5]:[0,3]],['#setup-map-rotation-2',[0,3]]]){
   const select=$(id),previous=select.value;select.replaceChildren();
   for(const n of angles){const option=document.createElement('option');option.value=String(n);option.textContent=(n*60)+'°';select.append(option);}
   select.value=angles.includes(Number(previous))?String(Number(previous)):'0';
  }
 }
 $('#setup-layout').onchange=updateLayout;updateLayout();
 const fields=[],extraFields=[];
 for(const [i,unit] of stock.entries()){
  const label=document.createElement('label');label.className='hint';
  label.textContent=(unit.team?'Красная':'Зелёная')+' сторона · мех '+(i%2+1);
  const select=document.createElement('select');select.dataset.setupSlot=String(i);
  const add=(value,name)=>{const option=document.createElement('option');option.value=value;option.textContent=name;select.append(option);};
  for(const s of stock)add(String(s.id),s.name+' '+s.variant+' · '+s.tonnage+' т');
  if(i%2===1)add('none','Не выставлять меха');
  if(custom)add('custom',custom.name+' · нестандартный');
  select.value=preferCustom&&custom&&Number(custom.position)===i?'custom':String(i);
  label.append(select);$('#setup-forces').append(label);fields.push(select);
 }
 function resetConsent(){
  $('#setup-approve-green').checked=false;
  $('#setup-approve-red').checked=false;update();
 }
 function addExtra(team){
  if(fields.slice(team*2,team*2+2).filter(x=>x.value!=='none').length+extraFields.filter(x=>Number(x.dataset.extraTeam)===team).length>=8)return;
  const label=document.createElement('label');label.className='hint';
  label.textContent=(team?'Красная':'Зелёная')+' сторона · дополнительный мех';
  const select=document.createElement('select');select.dataset.extraTeam=String(team);
  for(const s of stock){const option=document.createElement('option');option.value=String(s.id);option.textContent=s.name+' '+s.variant+' · '+s.tonnage+' т';select.append(option);}
  if(custom){const option=document.createElement('option');option.value='custom';option.textContent=custom.name+' · нестандартный';select.append(option);}
  select.value=String(team*2);select.onchange=resetConsent;
  const remove=document.createElement('button');remove.type='button';remove.textContent='Убрать';remove.dataset.removeExtra=String(team);
  remove.onclick=()=>{extraFields.splice(extraFields.indexOf(select),1);label.remove();resetConsent();};
  label.append(select,remove);$('#setup-extra').append(label);extraFields.push(select);resetConsent();
 }
 $('#setup-add-green').onclick=()=>addExtra(0);$('#setup-add-red').onclick=()=>addExtra(1);
 function update(){
  const count=[...fields,...extraFields].filter(x=>x.value==='custom').length;
  const sizes=[0,1].map(team=>fields.slice(team*2,team*2+2).filter(x=>x.value!=='none').length+extraFields.filter(x=>Number(x.dataset.extraTeam)===team).length);
  $('#setup-add-green').disabled=sizes[0]>=8;$('#setup-add-red').disabled=sizes[1]>=8;

  $('#setup-custom-consent').hidden=count===0;
  $('#setup-approve-red').disabled=!hotseat;
  if(!hotseat)$('#setup-approve-red').checked=true;
  const valid=sizes.every(n=>n<=8)&&count<=1&&(count===0||$('#setup-approve-green').checked&&$('#setup-approve-red').checked);
  const victoryMode=$('#setup-victory').value,limited=victoryMode==='limit',manual=victoryMode==='custom';
  const roundLimit=Number($('#setup-round-limit').value),condition=$('#setup-condition').value.trim();
  $('#setup-victory-consent').hidden = victoryMode==='standard';
  $('#setup-limit-label').hidden = !limited;$('#setup-condition-label').hidden = !manual;
  $('#setup-victory').querySelector('[value="custom"]').disabled = !hotseat;
  $('#setup-victory-red').disabled = !hotseat;
  if(!hotseat)$('#setup-victory-red').checked=true;
  const validTerms=limited?Number.isInteger(roundLimit)&&roundLimit>=1&&roundLimit<=1000:hotseat&&condition.length>0&&condition.length<=500;
  const agreed=victoryMode==='standard'||validTerms&&$('#setup-victory-green').checked&&$('#setup-victory-red').checked;
  const canStart=valid&&agreed;
  for(const id of ['#confirmstandard','#confirmreset'])$(id).disabled = !canStart;
 }
 for(const field of fields)field.onchange=()=>{
  // Consent covers the currently displayed composition, not a previous one.
  $('#setup-approve-green').checked=false;
  $('#setup-approve-red').checked=false;update();
 };
 for(const id of ['#setup-approve-green','#setup-approve-red','#setup-victory-green','#setup-victory-red'])$(id).onchange=update;
 const resetVictoryConsent=()=>{$('#setup-victory-green').checked=false;$('#setup-victory-red').checked=false;update();};
 for(const id of ['#setup-victory','#setup-round-limit','#setup-condition'])$(id).onchange=resetVictoryConsent;
 $('#setup-condition').oninput=resetVictoryConsent;
 function begin(standard){
  const slots=fields.map(x=>x.value==='custom'?'custom':x.value==='none'?null:Number(x.value));
  const approvals=[$('#setup-approve-green').checked,$('#setup-approve-red').checked];
  const layout=$('#setup-layout').value,first={id:$('#setup-map').value,rotation:Number($('#setup-map-rotation').value)};
  const map=layout==='hex'?first:{layout,sheets:layout==='sheet'?[first]:[first,{id:$('#setup-map-2').value,rotation:Number($('#setup-map-rotation-2').value)}]};
  const extra=extraFields.map(x=>({team:Number(x.dataset.extraTeam),stock:x.value==='custom'?'custom':Number(x.value)}));
  const verdictApprovals=[$('#setup-victory-green').checked,$('#setup-victory-red').checked];
  const victoryMode=$('#setup-victory').value;
  let victoryTerms=null;
  if(victoryMode==='limit')victoryTerms={roundLimit:Number($('#setup-round-limit').value),approvals:verdictApprovals};
  if(victoryMode==='custom')victoryTerms={condition:$('#setup-condition').value,approvals:verdictApprovals};
  if(reset(standard,{slots,extra,custom,approvals,map,victoryTerms}))$('#modal').close();
 }
 $('#confirmstandard').onclick=()=>begin(true);
 $('#confirmreset').onclick=()=>begin(false);
 $('#setup-printed').onclick=showPrintedScenarioSetup;update();
}

function replaceScenarioModal(html){
 if($('#modal').open)$('#modal').close();
 modal(html);
}
function showPrintedScenarioSetup(){
 if(remoteMode||busy)return;
 replaceScenarioModal('<h2>Сценарии · A Game of Armored Combat</h2>'+
  '<p>Три печатных сценария, настоящие карты и исходные MTF-записи. Игра вдвоём на одном устройстве; отдельного сетевого управления тремя игроками пока нет.</p>'+
  '<label>Сценарий<select id="scenario-book-id"><option value="final-exam">1 · Final Exam</option>'+
  '<option value="trial-by-fire">2 · Trial by Fire</option><option value="divide-and-conquer">3 · Divide and Conquer</option></select></label>'+
  '<label>Вариант состава<select id="scenario-book-variant"></select></label>'+
  '<label>Соединение карт<select id="scenario-book-layout"><option value="horizontal">Длинные стороны · как в книге</option>'+
  '<option value="vertical">Короткие стороны · Final Exam, вариация</option></select></label>'+
  '<label>Поворот первой карты<select id="scenario-book-rotation0"><option value="0">0°</option><option value="3">180°</option></select></label>'+
  '<label>Поворот второй карты<select id="scenario-book-rotation1"><option value="0">0°</option><option value="3">180°</option></select></label>'+
  '<label id="scenario-book-replace-wrap"><input id="scenario-book-replace" type="checkbox"> Заменить печатные карты на другие исходные листы</label>'+
  '<label id="scenario-book-board-wrap" hidden>Левый/верхний лист<select id="scenario-book-board0"></select>'+
  'Правый/нижний лист<select id="scenario-book-board1"></select></label>'+
  '<label>Дополнительные элементы местности на игрока<select id="scenario-book-terrain">'+
  '<option value="0">Без накладок</option><option value="1">По одному</option><option value="2">По два</option></select></label>'+
  '<label><input id="scenario-book-three" type="checkbox"> Два отдельных игрока защищают командный и разведывательный лэнсы (локально)</label>'+
  '<button class="primary" id="scenario-book-start">БРОСИТЬ 2D6 И ВЫБРАТЬ СТОРОНУ</button>');
 for(const [i,preset] of ['Desert #3','Grassland #2'].entries()){
  const sel=$('#scenario-book-board'+i);
  for(const name of AGOAC_BOARD_NAMES)sel.append(new Option(name,name));
  sel.value=preset;
 }
 $('#scenario-book-replace').onchange=()=>{
  $('#scenario-book-board-wrap').hidden=!$('#scenario-book-replace').checked;
 };
 const update=()=>{
  const id=$('#scenario-book-id').value,variant=$('#scenario-book-variant');
  const previous=variant.value;variant.replaceChildren();
  for(const [value,label]of [['','Исходный состав'],...(id==='final-exam'?
   [['alternate-forces','Другой печатный состав · 4 против 4']]:
   id==='divide-and-conquer'?[['shortened','Сокращённый состав · 4 против 3']]:[])]){
   const option=new Option(label,value);variant.append(option);
  }
  variant.value=[...variant.options].some(o=>o.value===previous)?previous:'';
  const layout=$('#scenario-book-layout');
  layout.querySelector('[value="vertical"]').disabled=id!=='final-exam';
  if(id!=='final-exam')layout.value='horizontal';
  $('#scenario-book-replace').disabled=id!=='final-exam';
  if(id!=='final-exam')$('#scenario-book-replace').checked=false;
  $('#scenario-book-board-wrap').hidden=!$('#scenario-book-replace').checked;
  $('#scenario-book-three').disabled=id!=='divide-and-conquer';
  if(id!=='divide-and-conquer')$('#scenario-book-three').checked=false;
 };
 $('#scenario-book-id').onchange=update;update();
 $('#scenario-book-start').onclick=async()=>{
  const id=$('#scenario-book-id').value,variation=$('#scenario-book-variant').value||null;
  const options={id,variation,layout:$('#scenario-book-layout').value,
   rotations:[Number($('#scenario-book-rotation0').value),Number($('#scenario-book-rotation1').value)],
   terrainCount:Number($('#scenario-book-terrain').value),
   names:$('#scenario-book-replace').checked?
    [$('#scenario-book-board0').value,$('#scenario-book-board1').value]:null,
   shared:$('#scenario-book-three').checked};
  const button=$('#scenario-book-start');button.disabled=true;
  try{
   const designs=await loadAgoacBrowserDesigns(id,{variation});
   const trial=new Game(),configured=trial.configureScenario(id);
   if(!configured.ok)throw Error(configured.error);
   const rolled=trial.rollScenarioSides();
   if(!rolled.ok)throw Error(rolled.error);
   replaceScenarioModal('<h2>Выбор стороны · '+id+'</h2><p>Победитель броска 2D6: '+
    (rolled.winner===0?'Зелёные':'Красные')+
    ' (зелёные '+rolled.green+', красные '+rolled.red+'). Победитель выбирает роль.</p>'+
    '<button id="scenario-book-attacker" class="primary">ВЫБРАТЬ АТАКУЮЩЕГО</button>'+
    '<button id="scenario-book-defender">ВЫБРАТЬ ЗАЩИТНИКА</button>');
   for(const role of ['attacker','defender'])
    $('#scenario-book-'+role).onclick=()=>installPrintedScenario(trial,rolled.winner,role,options,designs);
  }catch(error){toast('Исходный сценарий не загружен: '+error.message);
   button.disabled=false;}
 };
}
function installPrintedScenario(trial,winner,role,options,designs){
 const choose=trial.chooseScenarioSide(winner,role);
 if(!choose.ok)return void toast(choose.error);
 if(options.variation){
  const variation=trial.configurePrintedScenarioVariation(options.variation);
  if(!variation.ok)return void toast(variation.error);
 }
 const sourceMap=trial.configurePrintedScenarioMap({
  rotations:options.rotations,layout:options.layout,names:options.names});
 if(!sourceMap.ok)return void toast(sourceMap.error);
 const loaded=trial.configurePrintedScenarioForces({designs});
 if(!loaded.ok)return void toast(loaded.error);
 if(options.shared){
  const shared=trial.configureSharedDefenderLances({
   commandController:'Игрок командного лэнса',
   reconController:'Игрок разведывательного лэнса'});
  if(!shared.ok)return void toast(shared.error);
 }
 if(options.terrainCount||trial.scenario.picturedTerrain?.required){
  const started=trial.startScenarioLooseTerrain({piecesPerTeam:
   trial.scenario.picturedTerrain?.required?2:options.terrainCount});
  if(!started.ok)return void toast(started.error);
 }else{
  const placement=trial.beginPrintedScenarioPlacement();
  if(!placement.ok)return void toast(placement.error);
 }
 clearDice();
 for(const rec of records.values()){
  rec.mixer.stopAllAction();scene.remove(rec.root);rec.label.remove();
 }
 records.clear();
 Object.assign(game,trial);game.rebuildMap();
 hotseat=true;$('#gamemode').value='hotseat';sharedDefenderController='command';
 selected=0;target=null;mode='walk';arcWeapon='all';
 picked=new Set(game.units[0].weapons.map((_,i)=>i));
 buildTerrain();buildArcMeshes();reconcileModelRecords();syncModels();
 zoom=fitBoard();cam();renderUI();
 showPrintedPlacementStep();
}
function scenarioHexOptions(select,tiles){
 for(const tile of tiles){
  const option=document.createElement('option');
  option.value=tile.q+','+tile.r;
  const col=tile.q+Math.floor(tile.r/2)+Math.floor(game.setupMap.width/2)+1;
  const row=tile.r+Math.floor(game.setupMap.height/2)+1;
  option.textContent=(tile.printedSheet||'Карта')+' · '+
   (tile.printedHex||String(col).padStart(2,'0')+String(row).padStart(2,'0'))+
   ' · поле '+col+','+row;
  select.append(option);
 }
}

function showIllustratedTerrainDispute(pieceIndex){
 const pictured=game.scenario?.picturedTerrain,setup=game.scenario?.looseTerrain;
 if(!pictured?.required||!setup||setup.pieces.length!==pieceIndex)return;
 const isPair=pieceIndex%2===0;
 const faceOptions=isPair?
  '<option value="depth1">Глубина 1</option><option value="depth2">Глубина 2</option>':
  '<option value="sublevel1">Субуровень −1</option><option value="sublevel2">Субуровень −2</option>';
 const dirOptions=DIRS.map(([q,r],i)=>'<option value="'+i+'">'+
  (i*60)+'° ('+q+','+r+')</option>').join('');
 replaceScenarioModal('<h2>Спор о фигурном элементе · 2D6</h2>'+
  '<p>Страница 47: место и разворот треугольника заданы схемой. Спорить разрешено о стороне элемента, '+
  'а для двойного — также о развороте. При равенстве 2D6 перебрасываются.</p>'+
  [0,1].map(team=>'<label>Игрок '+(team===0?'зелёных':'красных')+
   ': сторона<select id="pictured-dispute-type'+team+'">'+faceOptions+'</select></label>'+
   (isPair?'<label>Разворот<select id="pictured-dispute-rotation'+team+'">'+
    dirOptions+'</select></label>':'')).join('')+
  '<button class="primary" id="pictured-dispute-roll">РАЗРЕШИТЬ СПОР · 2D6</button>');
 $('#pictured-dispute-type0').value=isPair?'depth1':'sublevel1';
 $('#pictured-dispute-type1').value=isPair?'depth2':'sublevel2';
 $('#pictured-dispute-roll').onclick=()=>{
  const proposal=team=>({
   terrainType:$('#pictured-dispute-type'+team).value,
   orientation:isPair?Number($('#pictured-dispute-rotation'+team).value):null
  });
  const result=game.arbitrateIllustratedTerrainDispute({
   pieceIndex,first:proposal(0),second:proposal(1)});
  if(!result.ok)return void toast(result.error);
  showPrintedPlacementStep();
  toast('2D6: решение '+(result.winner===0?'зелёных':'красных')+
   ' обязательно для элемента '+(pieceIndex+1));
 };
}
function showPrintedPlacementStep(){
 const scenario=game.scenario,terrain=scenario?.looseTerrain;
 if(!scenario)return;
 if(terrain&&!terrain.complete){
  const next=terrain.nextTeam,pictured=scenario.picturedTerrain?.required;
  const pieceIndex=terrain.pieces.length;
  const figure=scenario.picturedTerrain?.counters?.[pieceIndex];
  const sourceCells=figure?.printedHexes.map(hex=>game.tiles.find(t=>
   t.sheet===figure.sheet&&t.printedHex===hex))||[];
  replaceScenarioModal('<h2>'+(pictured?'Обязательная местность сценария 3':'Дополнительная местность')+
   ' · шаг '+(terrain.pieces.length+1)+
   ' из '+(terrain.piecesPerTeam*2)+'</h2><p>Ход '+(next===0?'зелёных':'красных')+
   '. Между элементами — три пустых гекса. Правило отступа от края относится к свободной дополнительной местности.</p>'+   (pictured?'<p>Гексы и треугольники закреплены по напечатанной схеме, стр. 47. '+   '<a href="https://static1.squarespace.com/static/5e5f11b6a6b48b3ae5c4ee36/t/5e69a64e3d430e6e35ad7fda/1583982189894/cat3500d%2Bbattletech%2Ba%2Bgame%2Bof%2Barmored%2Bcombat%2Brulebook.pdf#page=49" target="_blank" rel="noopener noreferrer">Схема в книге</a>. '+   'По одному двойному и треугольному контуру на каждом листе.</p>':'')+
   '<label>Тип элемента<select id="scenario-terrain-type">'+
   '<option value="woods">Лёгкий лес</option><option value="heavy">Густой лес</option>'+
   '<option value="rough">Пересечённая местность</option><option value="rubble">Обломки</option>'+   '<option value="level1">Высота +1</option><option value="level2">Высота +2</option>'+   '<option value="sublevel1">Субуровень −1</option><option value="sublevel2">Субуровень −2</option>'+   '<option value="depth1">Вода, глубина 1</option><option value="depth2">Вода, глубина 2</option></select></label>'+
   '<label>Размер<select id="scenario-terrain-shape">'+
   '<option value="1">Один гекс</option><option value="2">Два соседних гекса</option>'+
   '<option value="custom">Контур реального элемента — свои смещения</option></select></label>'+
   '<label id="scenario-terrain-custom-wrap" hidden>Смещения q,r через точку с запятой '+
   '<input id="scenario-terrain-offsets" value="0,0;1,0;1,-1"></label>'+
   '<label>Исходный гекс<select id="scenario-terrain-hex"></select></label>'+
   '<label id="scenario-terrain-rotation-wrap"'+(pictured&&pieceIndex%2===0?'':' hidden')+
   '>Разворот двойного элемента<select id="scenario-terrain-rotation">'+
   DIRS.map(([q,r],i)=>'<option value="'+i+'">'+(i*60)+'° ('+q+','+r+')</option>').join('')+
   '</select></label>'+
   (pictured&&!scenario.picturedTerrain.disputes?.[pieceIndex]?
    '<button id="scenario-terrain-dispute">СПОР О СТОРОНЕ / РАЗВОРОТЕ · 2D6</button>':'')+
   '<button class="primary" id="scenario-terrain-place">РАЗМЕСТИТЬ ЭЛЕМЕНТ</button>');
  scenarioHexOptions($('#scenario-terrain-hex'),pictured?
   sourceCells.slice(0,1):game.tiles.filter(t=>
    game.looseTerrainZoneAllowed(t.q,t.r)));
  if(pictured){
   const allowed=new Set(pieceIndex%2===0?
    ['depth1','depth2']:['sublevel1','sublevel2']);
   for(const option of [...$('#scenario-terrain-type').options])
    if(!allowed.has(option.value))option.remove();
   const ruling=scenario.picturedTerrain.disputes?.[pieceIndex]?.choice;
   if(ruling){
    $('#scenario-terrain-type').value=ruling.terrainType;
    $('#scenario-terrain-type').disabled=true;
    if(pieceIndex%2===0){
     $('#scenario-terrain-rotation').value=String(ruling.orientation);
     $('#scenario-terrain-rotation').disabled=true;
    }
   }
   if(!ruling)$('#scenario-terrain-dispute').onclick=()=>showIllustratedTerrainDispute(pieceIndex);
   $('#scenario-terrain-shape').value=pieceIndex%2===0?'2':'custom';
   $('#scenario-terrain-shape').disabled=true;
   $('#scenario-terrain-custom-wrap').hidden=pieceIndex%2===0;
   if(pieceIndex%2===0&&sourceCells.length===2){
    const direction=DIRS.findIndex(([q,r])=>
     q===sourceCells[1].q-sourceCells[0].q&&
     r===sourceCells[1].r-sourceCells[0].r);
    if(direction>=0&&!ruling)
     $('#scenario-terrain-rotation').value=String(direction);
   }else if(sourceCells.length===3){
    const pattern=sourceCells.map(t=>
     (t.q-sourceCells[0].q)+','+(t.r-sourceCells[0].r)).join(';');
    $('#scenario-terrain-offsets').value=pattern;
    $('#scenario-terrain-offsets').readOnly=true;
   }
  }
  $('#scenario-terrain-shape').onchange=()=>{
   $('#scenario-terrain-custom-wrap').hidden=$('#scenario-terrain-shape').value!=='custom';
  };
  $('#scenario-terrain-place').onclick=()=>{
   const [q,r]=$('#scenario-terrain-hex').value.split(',').map(Number);
   const terrainType=$('#scenario-terrain-type').value;
   let footprint=[{q:0,r:0}];
   if($('#scenario-terrain-shape').value==='2'){
    const [dq,dr]=DIRS[Number($('#scenario-terrain-rotation').value)];
    footprint=[{q:0,r:0},{q:dq,r:dr}];
   }
   if($('#scenario-terrain-shape').value==='custom'){
    const segments=$('#scenario-terrain-offsets').value.split(';');
    if(segments.length>32||!segments.every(s=>/^\s*-?\d+,\s*-?\d+\s*$/.test(s)))
     return void toast('Контур: до 32 координат в формате q,r; q,r');
    footprint=segments.map(s=>{
     const [dq,dr]=s.split(',').map(Number);return {q:dq,r:dr};
    });
   }
   const placed=game.placeScenarioLooseTerrain({team:next,q,r,label:terrainType,
    terrainType,footprint});
   if(!placed.ok)return void toast(placed.error);
   buildTerrain();renderUI();
   if(placed.complete&&!pictured){
    const began=game.beginPrintedScenarioPlacement();
    if(!began.ok)return void toast(began.error);
   }
   showPrintedPlacementStep();
  };
  return;
 }
 if(scenario.picturedTerrain?.required&&!scenario.picturedTerrain.confirmed){
  replaceScenarioModal('<h2>Сверка со схемой, стр. 47</h2>'+   '<p>Размещены четыре обязательных элемента, по одному двойному и треугольному на каждом листе. '+   'Треугольники закреплены в позициях издательской схемы; у пар доступны разрешённые повороты.</p>'+   '<button class="primary" id="scenario-figure-confirm">СВЕРЕНО · НАЧАТЬ РАССТАНОВКУ</button>');
  $('#scenario-figure-confirm').onclick=()=>{
   const verified=game.confirmDivideAndConquerIllustratedTerrain({sourceDiagramReviewed:true});
   if(!verified.ok)return void toast(verified.error);
   const started=game.beginPrintedScenarioPlacement();
   if(!started.ok)return void toast(started.error);
   showPrintedPlacementStep();
  };
  return;
 }
 const state=scenario.placement;
 if(!state||state.complete){
  if(scenario.id==='trial-by-fire'&&!scenario.preDamageApplied){
   const defender=game.units.find(u=>u.team===scenario.defenderTeam);
   const pre=game.applyTrialByFirePreDamage(defender.id);
   if(!pre.ok)return void toast(pre.error);
  }
  if($('#modal').open)$('#modal').close();
  syncModels();renderUI();
  toast('Исходный сценарий готов: все мехи выставлены. Начните фазу инициативы.');
  return;
 }
 const step=state.steps[state.placed.length];
 if(step.lance==='printed-row'&&!state.attackerRow){
  replaceScenarioModal('<h2>Divide and Conquer · сторона атаки</h2>'+
   '<p>После обоих лэнсов защиты выберите одну строку 1510–1517. Смешивать стороны нельзя.</p>'+
   '<button id="scenario-row-west">ЗАПАД · SW</button>'+
   '<button id="scenario-row-east">ВОСТОК · NE</button>');
  for(const side of ['west','east'])$('#scenario-row-'+side).onclick=()=>{
   const chosen=game.chooseDivideAndConquerAttackerRow(side);
   if(!chosen.ok)return void toast(chosen.error);
   showPrintedPlacementStep();
  };
  return;
 }
 const available=game.units.filter(u=>!u.dead&&u.deployed===false&&u.team===step.team&&
  (!step.lance||step.lance==='printed-row'||u.lance===step.lance));
 const tiles=game.tiles.filter(t=>game.scenarioZoneAllowed(step.team,t.q,t.r,{
  lance:step.lance,facing:0})&&!state.placed.some(p=>p.q===t.q&&p.r===t.r));
 replaceScenarioModal('<h2>Размещение · '+(state.placed.length+1)+'/'+state.steps.length+'</h2>'+
  '<p>'+ (step.team===0?'Зелёные':'Красные')+
  (step.lance&&step.lance!=='printed-row'?' · лэнс '+step.lance:'')+
  '. Выберите пилота и разрешённый правилами гекс.</p>'+
  '<label>Мех<select id="scenario-placement-unit"></select></label>'+
  '<label>Гекс<select id="scenario-placement-hex"></select></label>'+
  '<label>Курс<select id="scenario-placement-facing"></select></label>'+
  '<button class="primary" id="scenario-placement-place">РАЗМЕСТИТЬ МЕХА</button>');
 const unitSelect=$('#scenario-placement-unit');
 for(const u of available){
  const option=new Option(u.pilot+' · '+u.variant,String(u.id));unitSelect.append(option);
 }
 scenarioHexOptions($('#scenario-placement-hex'),tiles);
 for(let facing=0;facing<6;facing++)
  $('#scenario-placement-facing').append(new Option(String(facing*60)+'°',String(facing)));
 const place=$('#scenario-placement-place');
 place.disabled=!available.length||!tiles.length;
 place.onclick=()=>{
  const id=Number(unitSelect.value);
  const [q,r]=$('#scenario-placement-hex').value.split(',').map(Number);
  const facing=Number($('#scenario-placement-facing').value);
  const placed=game.placePrintedScenarioMech(id,q,r,facing);
  if(!placed.ok)return void toast(placed.error);
  syncModels();renderUI();
  showPrintedPlacementStep();
 };
}
function showScenarioDispute(){
 const shared=game.scenario?.sharedLances;
 if(!shared||!hotseat||!['move','fire'].includes(game.phase)||
  game.activeTeam!==game.scenario.defenderTeam)return;
 const candidates=lance=>game.units.filter(u=>u.lance===lance&&!u.dead&&
  !u.notFielded&&u.deployed!==false&&u.team===game.scenario.defenderTeam);
 replaceScenarioModal('<h2>Арбитраж · два игрока защиты</h2>'+
  '<p>Оба игрока выбирают мех своего лэнса. При споре каждый бросает 2D6, ничьи перебрасываются.</p>'+
  '<label>Командный лэнс<select id="scenario-dispute-command"></select></label>'+
  '<label>Разведывательный лэнс<select id="scenario-dispute-recon"></select></label>'+
  '<button class="primary" id="scenario-dispute-roll">АРБИТРАЖ 2D6</button>');
 for(const lance of ['command','recon'])for(const u of candidates(lance))
  $('#scenario-dispute-'+lance).append(new Option(u.pilot+' · '+u.variant,String(u.id)));
 $('#scenario-dispute-roll').onclick=()=>{
  const result=game.arbitrateSharedDefenderChoice({
   commandChoice:Number($('#scenario-dispute-command').value),
   reconChoice:Number($('#scenario-dispute-recon').value)});
  if(!result.ok)return void toast(result.error);
  sharedDefenderController=result.controller;
  if($('#modal').open)$('#modal').close();
  selectUnit(result.unitId);renderUI();
  toast('2D6: порядок фазы определяет '+(result.controller==='command'?
   shared.commandController:shared.reconController));
 };
}

$('#new').onclick=()=>{
 if(remoteMode){toast('Перезапуск серверной операции недоступен. Откройте новый боевой контракт в штабе.');return;}
 if(busy)return;showBattleSetup();
};$('#night').onchange=()=>{if(remoteMode)return void serverCommand({type:'weather',night:$('#night').checked,gale:$('#gale').checked,standingStill:$('#to-still').checked,evading:$('#to-evade').checked,floatingCriticals:$('#bmm-floating').checked,underwaterFire:$('#bmm-underwater').checked});game.weather.night=$('#night').checked;renderUI();};$('#gale').onchange=()=>{if(remoteMode)return void serverCommand({type:'weather',night:$('#night').checked,gale:$('#gale').checked,standingStill:$('#to-still').checked,evading:$('#to-evade').checked,floatingCriticals:$('#bmm-floating').checked,underwaterFire:$('#bmm-underwater').checked});game.weather.gale=$('#gale').checked;renderUI();};function syncWeatherSwitches(){
  const values={'#night':game.weather?.night,'#gale':game.weather?.gale,'#to-still':game.tacticalOptions?.standingStill,'#to-evade':game.tacticalOptions?.evading,'#bmm-floating':game.tacticalOptions?.floatingCriticals,'#bmm-underwater':game.tacticalOptions?.underwaterFire};
  for(const [id,value] of Object.entries(values))$(id).checked=!!value;
}
function tacticalSettings(){
  const locked=game.phase!=='initiative'||game.round!==1;
  if(remoteMode){for(const id of ['#night','#gale'])$(id).disabled=busy||!remoteReady||locked;}
  for(const id of ['#to-still','#to-evade','#bmm-floating','#bmm-underwater']){
    const input=$(id);
    input.disabled=locked||(remoteMode&&(busy||!remoteReady));
    if(locked){input.checked=id==='#to-still'?!!game.tacticalOptions?.standingStill:
      id==='#to-evade'?!!game.tacticalOptions?.evading:
      id==='#bmm-floating'?!!game.tacticalOptions?.floatingCriticals:!!game.tacticalOptions?.underwaterFire;}
  }
}
function updateTacticalOptions(){
  if(game.phase!=='initiative'||game.round!==1){
    tacticalSettings();return;
  }
  if(remoteMode){
    void serverCommand({type:'weather',night:$('#night').checked,
      gale:$('#gale').checked,standingStill:$('#to-still').checked,
      evading:$('#to-evade').checked,floatingCriticals:$('#bmm-floating').checked,underwaterFire:$('#bmm-underwater').checked});
  }else{
    game.tacticalOptions={standingStill:$('#to-still').checked,
      evading:$('#to-evade').checked,floatingCriticals:$('#bmm-floating').checked,underwaterFire:$('#bmm-underwater').checked};
    renderUI();
  }
}
$('#to-still').onchange=updateTacticalOptions;
$('#to-evade').onchange=updateTacticalOptions;
$('#bmm-floating').onchange=updateTacticalOptions;
$('#bmm-underwater').onchange=updateTacticalOptions;
$('#gamemode').disabled=remoteMode;$('#gamemode').onchange=()=>{if(remoteMode)return;if(busy){$('#gamemode').value=hotseat?'hotseat':'ai';return;}hotseat=$('#gamemode').value==='hotseat';reset();};
function project(v){v=v.clone().project(camera);return {x:(v.x*.5+.5)*renderer.domElement.width,y:(-v.y*.5+.5)*renderer.domElement.height};}
function drawFallback(){const c=renderer.domElement,ctx=c.getContext('2d');if(!ctx)return;ctx.fillStyle='#28362d';ctx.fillRect(0,0,c.width,c.height);for(const t of [...game.tiles].sort((a,b)=>project(world(a.q,a.r)).y-project(world(b.q,b.r)).y)){const center=world(t.q,t.r);center.y=groundY(t.q,t.r);ctx.beginPath();for(let j=0;j<6;j++){let p=project(center.clone().add(new THREE.Vector3(Math.sin(j*Math.PI/3)*.97,0,Math.cos(j*Math.PI/3)*.97)));j?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y);}ctx.closePath();ctx.fillStyle='#'+t.mesh.material.color.getHexString();ctx.fill();if(reach.some(p=>p.q===t.q&&p.r===t.r)){ctx.fillStyle='#b4e56c44';ctx.fill();}const arcBand=arcTiles.get(t.q+','+t.r);if(arcBand!==undefined){ctx.fillStyle=['#59dccc45','#e5c57838','#c88d692d'][arcBand];ctx.fill();ctx.strokeStyle=['#73efe0aa','#f4d89188','#e9ab8477'][arcBand];ctx.lineWidth=1.6;ctx.stroke();}else{ctx.strokeStyle='#18251f';ctx.lineWidth=1;ctx.stroke();}const p=project(center);if(t.type==='woods'||t.type==='heavy'){ctx.fillStyle='#243d2c';ctx.font='22px sans-serif';ctx.fillText('♠',p.x-8,p.y);}
 if(showHexElevation){
  const mark=hexElevationMark(t);
  if(mark){
   ctx.save();
   const fontSize=Math.max(8,Math.min(13,14/Math.sqrt(zoom/12)));
   ctx.font='bold '+fontSize+'px sans-serif';ctx.textAlign='center';
   const lineHeight=fontSize+1;
   const boxWidth=Math.max(...mark.lines.map(x=>ctx.measureText(x).width))+10;
   const px=p.x,py=p.y+Math.max(9,16*(12/Math.max(12,zoom)));
   ctx.fillStyle=mark.type==='depth'?'#083746de':'#141e1de0';
   ctx.fillRect(px-boxWidth/2,py-12,boxWidth,mark.lines.length*lineHeight+7);
   ctx.fillStyle=mark.type==='depth'?'#e9f7fb':mark.type==='sublevel'?'#ffe4c2':'#f3f2db';
   for(const [i,text]of mark.lines.entries())ctx.fillText(text,px,py+i*lineHeight);
   ctx.restore();
  }
 }
}
for(const u of game.units){if(!game.onMap(u))continue;const rec=records.get(u.id);let p=project(rec?rec.root.position:world(u.q,u.r));let sc=12/zoom;ctx.save();ctx.translate(p.x,p.y);ctx.scale(sc,sc);ctx.fillStyle=u.team?'#e68e74':'#c3ee78';ctx.strokeStyle='#18221b';ctx.lineWidth=2;for(const [x,y,w,h] of [[-11,-31,22,18],[-7,-43,14,11],[-19,-29,7,22],[12,-29,7,22],[-10,-12,8,14],[3,-12,8,14]]){ctx.fillRect(x,y,w,h);ctx.strokeRect(x,y,w,h);}ctx.restore();const d=game.units[u.id].facing,tip=project(world(u.q+Math.cos(d*Math.PI/3)*.3,u.r).add(new THREE.Vector3(0,.05,0)));const dv=[ [1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1] ][d],to=project(world(u.q+dv[0]*.65,u.r+dv[1]*.65));ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(to.x,to.y);ctx.strokeStyle=u.team?'#ffb38e':'#e4ffa5';ctx.lineWidth=3;ctx.stroke();}ctx.fillStyle='#d8dfcb';ctx.font='10px sans-serif';ctx.fillText('РЕЗЕРВНЫЙ РЕЖИМ · WebGL недоступен',18,c.height-42);}
const clock=new THREE.Clock();function frame(){requestAnimationFrame(frame);const dt=Math.min(clock.getDelta(),.05);for(const rec of records.values()){rec.mixer.update(dt);if(!rec.dead){let p=rec.root.position.clone();p.y+=2.5;p.project(camera);rec.label.style.left=(p.x*.5+.5)*$('#viewport').clientWidth+'px';rec.label.style.top=(-p.y*.5+.5)*$('#viewport').clientHeight+'px';}}for(let i=effects.length-1;i>=0;i--){const e=effects[i];e.time+=dt;const t=Math.min(1,e.time/e.duration);if(e.type==='move'){e.rec.root.position.lerpVectors(e.start,e.end,t);if(e.jump)e.rec.root.position.y+=Math.sin(t*Math.PI)*2;}else if(e.type==='beam'){e.obj.material.opacity=1-t;}else{e.obj.position.addScaledVector(e.v,dt);e.v.y-=dt*6;e.obj.scale.setScalar(1-t);}if(t===1){if(e.obj){scene.remove(e.obj);e.obj.geometry.dispose();e.obj.material.dispose();}e.resolve?.();effects.splice(i,1);}}renderer.render(scene,camera);}picked=new Set([0,1]);renderUI();frame();if(remoteMode)load().then(joinServerBattle).catch(reportActionError);else load().then(()=>{if(new URLSearchParams(location.search).has('custom')&&readCustomDesign())showBattleSetup({preferCustom:true});}).catch(reportActionError);
