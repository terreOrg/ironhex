import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Game,defaultMechWarriorSkills,DIRS,distance,AGOAC_SCALE,rangeMeters,elapsedBattleSeconds,normalizeMapHex} from '../dist/engine.js';
import {recordSheet} from '../dist/record-sheet.js';
import {readFileSync} from 'node:fs';

const fresh=()=>new Game({rng:()=>.5});
const diceFor=sum=>{const a=Math.max(1,sum-6);return [a,sum-a].map(v=>(v-.5)/6);};

test('AGoAC p.6: initiative handles every non-tied sum and rerolls all tied sums',()=>{
 for(let a=2;a<=12;a++)for(let b=2;b<=12;b++){
  const g=fresh(),dice=[...diceFor(a),...diceFor(b)];
  if(a===b)dice.push(...diceFor(12),...diceFor(2));
  g.rng=()=>{assert(dice.length,'Unexpected die');return dice.shift();};
  g.initiative();
  const winner=a===b||a>b?0:1;
  assert.equal(g.initiativeWinner,winner);
  assert.equal(g.activeTeam,1-winner);
  assert.equal(g.phase,'move');
  assert.equal(g.phaseRolls.length,a===b?4:2);
  assert.equal(dice.length,0);
 }
});

test('AGoAC pp.6-7: six-phase round and pending-order protection preserve state',()=>{
 const g=fresh(),round=g.round,dice=[...diceFor(12),...diceFor(2)];
 g.rng=()=>dice.shift()??.5;
 assert.equal(g.phase,'initiative');
 assert(g.nextPhase().ok);
 for(const [phase,next] of [['move','fire'],['fire','physical'],['physical','heat']]){
  assert.equal(g.phase,phase);
  const before=JSON.stringify({queue:g.queue,activeTeam:g.activeTeam,phaseRolls:g.phaseRolls,resolution:g.resolution,afterRolls:g.afterRolls});
  assert.equal(g.nextPhase().ok,false);
  assert.equal(JSON.stringify({queue:g.queue,activeTeam:g.activeTeam,phaseRolls:g.phaseRolls,resolution:g.resolution,afterRolls:g.afterRolls}),before);
  while(g.queue.length){
   const u=g.units.find(u=>g.canAct(u));assert(u);
   assert(g.hold(u.id).ok);
  }
  assert(g.nextPhase().ok);
  assert.equal(g.phase,next);
 }
 assert(g.nextPhase().ok);assert.equal(g.phase,'end');
 assert(g.nextPhase().ok);assert.equal(g.phase,'initiative');
 assert.equal(g.round,round+1);
});

test('AGoAC p.7: unequal force batches match both printed examples and either initiative winner',()=>{
 for(const winner of [0,1])for(const [small,large,sizes] of [
  [10,18,[1,1,2,2,2,2,2,2,2,2]],
  [5,14,[2,3,3,3,3]]
 ]){
  const g=fresh();g.initiativeWinner=winner;
  for(const bigTeam of [0,1]){
   g.units=Array.from({length:large+small},(_,id)=>({id,team:id<large?bigTeam:1-bigTeam,dead:false}));
   g.buildQueue();
   const expected=sizes.flatMap(n=>[1-winner,winner].flatMap(team=>Array(team===bigTeam?n:1).fill(team)));
   assert.deepEqual(g.queue,expected);
  }
 }
});

test('AGoAC audit never promotes a topic without complete reviewed child evidence',()=>{
 const r=JSON.parse(readFileSync(new URL('../rules/agoac-audit.json',import.meta.url),'utf8'));
 const ids=new Set(r.topics.map(t=>t.id));
 assert.equal(ids.size,r.topics.length);
 assert.equal(r.currentTopicId,r.topics.find(t=>t.status!=='verified')?.id??null);
 const reqIds=new Set();
 for(const q of r.requirements){
  assert(ids.has(q.topicId));assert(!reqIds.has(q.id));reqIds.add(q.id);
  assert(Array.isArray(q.pages)&&q.pages.length);
  for(const e of q.evidence||[])assert(readFileSync(new URL('../'+e.file,import.meta.url),'utf8').includes("test('"+e.test+"'"));
 }
 for(const q of r.requirements.filter(q=>q.status==='verified')){
  assert(q.evidence?.length,q.id+' missing test evidence');
  assert(q.audit?.sourceChecked&&q.audit?.edgeCasesChecked,q.id+' missing source review');
  assert.match(q.audit.testedSha,/^[0-9a-f]{40}$/);
  assert.match(q.audit.testedTree,/^[0-9a-f]{40}$/);
  assert.match(q.audit.mergedSha,/^[0-9a-f]{40}$/);
  assert.deepEqual(q.audit.checks.map(c=>c.name).sort(),['Ironhex Browser E2E','Ironhex CI','Ironhex Container Smoke']);
  assert(q.audit.checks.every(c=>Number.isSafeInteger(c.runId)&&c.conclusion==='success'));
 }
 for(const t of r.topics.filter(t=>t.status==='verified')){
  const children=r.requirements.filter(q=>q.topicId===t.id);
  assert(t.audit?.sourceChecked&&t.audit?.edgeCasesChecked&&t.audit?.inventoryComplete);
  assert(children.length&&children.every(q=>q.status==='verified'&&q.evidence?.length));
 }
 console.log('AGoAC audited topics:',r.topics.filter(t=>t.status==='verified').length,'/',r.topics.length);
});

test('AGoAC pp.4-5: record sheet displays front and rear damage, current pilot skills and heat overflow',()=>{
 const g=fresh(),u=g.units[0];
 u.gunnery=2;u.piloting=3;u.pilotWounds=2;
 u.armor.CT=u.maxArmor.CT-1;u.rear.CT=u.maxRear.CT-2;
 u.structure.CT=u.maxStructure.CT-1;u.crit.CT[0]=true;u.sinksLost=1;
 for(const heat of [0,29,30,31,36,75]){
  u.heat=heat;
  const html=recordSheet(u);
  assert(html.includes('Стрельба: <b>2</b>'));
  assert(html.includes('Пилотирование: <b>3</b>'));
  assert(html.includes('Ранения: 2/6'));
  assert(html.includes('Структура: '+u.structure.CT+' / '+u.maxStructure.CT));
  assert(html.includes('Центр торса: '+u.armor.CT+' / '+u.maxArmor.CT));
  assert(html.includes('<span>'+u.rear.CT+' / '+u.maxRear.CT+'</span>'));
  assert(html.includes('● Двигатель'));
  assert(html.includes('Радиаторы: '+(u.sinks-u.sinksLost)));
  assert(html.includes('title="Heat Overflow / нагрев сверх 30">+'+Math.max(0,heat-30)+'</span>'));
 }
});

test('AGoAC p.5: base pilot defaults and skill-dependent attack targets',()=>{
 const g=fresh(),u=g.units[0],t=g.units[2];
 assert.deepEqual(defaultMechWarriorSkills('Inner Sphere'),{gunnery:4,piloting:5});
 assert.equal(u.gunnery,4);assert.equal(u.piloting,5);
 for(const tile of g.tiles)Object.assign(tile,{depth:0,height:0,surface:0,type:'plain'});
 u.q=0;u.r=0;u.facing=0;t.q=1;t.r=0;u.moveMode='stand';t.moveMode='stand';
 const p=g.preview(u.id,t.id,0),k=g.physicalPreview(u.id,t.id,'kick','LL');
 assert.equal(p.legal,true,p.reason);assert.equal(k.legal,true,k.reason);
 u.gunnery=2;u.piloting=3;
 assert.equal(g.preview(u.id,t.id,0).targetNumber,p.targetNumber-2);
 assert.equal(g.physicalPreview(u.id,t.id,'kick','LL').targetNumber,k.targetNumber-2);
});

test('AGoAC pp.4-5,44: Warrior Data displays escaped pilot name, wound state and consciousness threshold',()=>{const u=fresh().units[0];u.pilotName='<Vega & Co>';for(let wounds=0;wounds<=6;wounds++){u.pilotWounds=wounds;u.unconscious=wounds===2;const html=recordSheet(u);assert(html.includes('&lt;Vega &amp; Co&gt;'));assert(!html.includes('<Vega & Co>'));assert(html.includes('Порог сознания: '+(['—',3,5,7,10,11,'—'][wounds])));if(wounds===6)assert(html.includes('Ранения: 6/6 · Погиб'));}delete u.pilotName;assert(recordSheet(u).includes('Пилот 1 /'));});

test('AGoAC p.5: Heat Data distinguishes installed and destroyed heat sinks',()=>{const u=fresh().units[0];for(let lost=0;lost<=u.sinks;lost++){u.sinksLost=lost;const html=recordSheet(u);assert(html.includes('Теплоотводы: '+(u.sinks-lost)+' / '+u.sinks+' · '+'○'.repeat(u.sinks-lost)+'●'.repeat(lost)));}});

test('AGoAC pp.6,44: delayed consciousness rolls retain each wound threshold',()=>{
 const thresholds=[0,3,5,7,10,11];
 for(let start=0;start<5;start++)for(let count=1;count<=5-start;count++){
  for(const failAt of [-1,...Array.from({length:count},(_,i)=>i)]){
   const g=fresh(),u=g.units[0];u.pilotWounds=start;
   g.deferConsciousness=true;g.wound(u,count);
   assert.equal(g.phaseRolls.length,0);assert.equal(u.pilotWounds,start+count);
   // A saved phase retains the numeric pending count and total wounds.
   Object.assign(u,JSON.parse(JSON.stringify(u)));
   const expected=thresholds.slice(start+1,start+count+1);
   const dice=expected.slice(0,failAt===-1?count:failAt+1).flatMap((tn,i)=>diceFor(i===failAt?tn-1:tn));
   g.rng=()=>{assert(dice.length);return dice.shift();};
   g.deferConsciousness=false;g.consciousness(u);
   assert.deepEqual(g.phaseRolls.map(r=>r.target),expected.slice(0,failAt===-1?count:failAt+1));
   assert.equal(u.unconscious,failAt!==-1);assert.equal(u.consciousChecks,0);assert.equal(dice.length,0);
  }
 }
 const g=fresh(),u=g.units[0];u.pilotWounds=4;g.deferConsciousness=true;g.wound(u,2);
 assert.equal(u.dead,true);assert.equal(u.pilotWounds,6);g.consciousness(u);
 assert.equal(u.consciousChecks,0);assert.equal(g.phaseRolls.length,0);
});

test('AGoAC pp.6,44: all pilots roll consciousness before any phase PSR',()=>{
 const g=fresh();g.deferConsciousness=true;
 for(const u of g.units){g.wound(u,1);g.psr(u,0,'AGoAC phase PSR');}
 g.deferConsciousness=false;g.rng=()=>.99;
 g.endPSR();
 const labels=g.phaseRolls.map(r=>r.kind.includes('Сознание')?'conscious':r.kind.includes('AGoAC phase PSR')?'psr':'other');
 assert.deepEqual(labels,['conscious','conscious','conscious','conscious','psr','psr','psr','psr']);
});

test('AGoAC p.44: recovery starts only in the next turn and uses current wounds',()=>{
 for(let wounds=1;wounds<=5;wounds++){
  const g=fresh(),u=g.units[0];u.pilotWounds=wounds;u.unconscious=true;u.wasUnconscious=false;
  for(const tile of g.tiles)Object.assign(tile,{type:'plain',height:0,depth:0,surface:0});
  const tn=[0,3,5,7,10,11][wounds];
  g.rng=()=>{throw Error('Should not roll in the turn of unconsciousness');};
  g.endPhase();assert.equal(u.unconscious,true);assert.equal(u.wasUnconscious,true);
  let dice=diceFor(tn-1);g.rng=()=>dice.shift();g.endPhase();
  assert.equal(u.unconscious,true);assert.equal(g.phaseRolls.at(-1).target,tn);
  dice=diceFor(tn);g.rng=()=>dice.shift();g.endPhase();
  assert.equal(u.unconscious,false);assert.equal(u.wasUnconscious,false);
 }
});

test('AGoAC p.3: all six die faces and all 36 independent two-die combinations',()=>{
 const g=fresh();
 for(let a=1;a<=6;a++){
  let dice=[(a-.5)/6];g.rng=()=>dice.shift();
  assert.equal(g.d6('1D6'),a);assert.deepEqual(g.lastDice,[a]);assert.equal(dice.length,0);
  for(let b=1;b<=6;b++){
   dice=[(a-.5)/6,(b-.5)/6];g.rng=()=>dice.shift();
   assert.equal(g.roll('2D6'),a+b);assert.deepEqual(g.lastDice,[a,b]);assert.equal(dice.length,0);
  }
 }
});

test('AGoAC p.44: head hits wound the pilot even when armor holds',()=>{
 const g=fresh(),u=g.units[0];g.rng=()=>.99;
 const hd=u.armor.HD;assert(hd>=2);
 g.damage(u,'HD',1);assert.equal(u.armor.HD,hd-1);assert.equal(u.pilotWounds,1);
 g.damage(u,'CT',1);assert.equal(u.pilotWounds,1);
 g.damage(u,'HD',1);assert.equal(u.pilotWounds,2);
 assert.deepEqual(g.phaseRolls.filter(r=>r.kind.includes('Сознание')).map(r=>r.target),[3,5]);
});

test('AGoAC pp.39,44: internal ammunition explosion wounds a surviving pilot twice',()=>{
 const g=fresh(),u=g.units[0],bin=u.bins[0];bin.shots=1;
 // The test fixture's standard SRM bin causes nonlethal internal damage.
 const loc=bin.location,armor=u.armor[loc];
 const dice=[...diceFor(3),...diceFor(5),...diceFor(2)];
 g.rng=()=>dice.shift()??0;
 g.explode(u,bin);
 assert.equal(u.dead,false);assert.equal(u.pilotWounds,2);assert.equal(u.unconscious,false);
 assert.equal(bin.shots,0);assert.equal(bin.destroyed,true);
 assert.equal(u.armor[loc],armor);
 assert.deepEqual(g.phaseRolls.filter(r=>r.kind.includes('Сознание')).map(r=>r.target),[3,5]);
});

test('AGoAC pp.33,39,44: damaged life support heat wounds at exact thresholds',()=>{
 for(const lifeSupport of [false,true])for(const heat of [0,14,15,25,26,30,45]){
  const g=fresh(),u=g.units[0];g.rng=()=>.99;
  for(const tile of g.tiles)Object.assign(tile,{type:'plain',height:0,depth:0,surface:0});
  for(const bin of u.bins)bin.shots=0;
  u.lifeSupport=lifeSupport;u.heat=heat+u.sinks;u.pendingHeat=0;
  u.shutdown=true;u.voluntaryShutdown=true;u.prone=true;
  g.heatPhase();
  assert.equal(u.heat,heat);
  assert.equal(u.pilotWounds,lifeSupport?(heat>=26?2:heat>=15?1:0):0);
 }
});

test('AGoAC pp.7,33,44: submerged life support wounds and lethal wounds cannot recover',()=>{
 for(const lifeSupport of [false,true])for(const depth of [0,1,2,3])for(const prone of [false,true]){
  const g=fresh(),u=g.units[0];g.rng=()=>.99;u.lifeSupport=lifeSupport;u.prone=prone;
  Object.assign(g.tile(u.q,u.r),{depth,height:-depth,type:depth?'water':'plain'});
  g.endPhase();
  assert.equal(u.pilotWounds,lifeSupport&&depth>=(prone?1:2)?1:0);
 }
 const g=fresh(),u=g.units[0];u.lifeSupport=true;u.pilotWounds=5;u.unconscious=true;u.wasUnconscious=true;
 Object.assign(g.tile(u.q,u.r),{type:'water',depth:2,height:-2});
 g.rng=()=>{throw Error('A dead pilot cannot attempt to recover');};
 g.endPhase();assert.equal(u.dead,true);assert.equal(u.pilotWounds,6);assert.equal(g.phaseRolls.length,0);
});

test('AGoAC pp.43-44: fall seatbelt checks occur before damage with elevation modifiers',()=>{
 for(const levels of [0,1,2,3])for(const success of [false,true]){
  const g=fresh(),u=g.units[0];const tn=5+Math.max(0,levels-1);
  Object.assign(g.tile(u.q,u.r),{depth:0,height:0,type:'plain'});
  // Facing roll, seatbelt roll, optional consciousness check. All subsequent
  // location and critical throws remain deterministic.
  const values=[0,...diceFor(success?tn:tn-1),...(!success?diceFor(3):[])];
  g.rng=()=>values.shift()??.5;
  g.fall(u,levels,5);
  const i=g.phaseRolls.findIndex(r=>r.kind.includes('Травма при падении'));
  const j=g.phaseRolls.findIndex(r=>r.kind.includes('Локация попадания'));
  assert(i>=0&&j>i);assert.equal(g.phaseRolls[i].target,tn);
  assert.equal(u.pilotWounds,success?0:1);
 }
 for(const reason of ['shutdown','unconscious','target-over-12']){
  const g=fresh(),u=g.units[0];u[reason]=true;g.rng=()=>.5;
  g.fall(u,0,reason==='target-over-12'?13:5);
  assert.equal(u.pilotWounds,1);
  assert.equal(g.phaseRolls.some(r=>r.kind.includes('Травма при падении')),false);
 }
});

test('AGoAC pp.11,43-44: only genuine immobility makes seatbelt damage automatic',()=>{
 const limbs=['LA','RA','LL','RL'];
 for(let mask=0;mask<16;mask++){
  const g=fresh(),u=g.units[0];
  for(let i=0;i<4;i++)if(mask&(1<<i))g.destroyLocation(u,limbs[i]);
  u.psrs=[];u.phaseDamage=0;
  g.rng=()=>.5;
  assert.equal(g.isImmobile(u),mask===15);
  g.fall(u,0,5);
  assert.equal(u.pilotWounds,mask===15?1:0,'limbs '+mask);
  assert.equal(g.phaseRolls.some(r=>r.kind.includes('Травма при падении')),mask!==15);
 }
 for(const flag of ['shutdown','unconscious','abandoned']){
  const g=fresh(),u=g.units[0];u[flag]=true;g.rng=()=>.5;
  assert(g.isImmobile(u));g.fall(u,0,5);
  assert.equal(u.pilotWounds,1);
  assert.equal(g.phaseRolls.some(r=>r.kind.includes('Травма при падении')),false);
 }
 for(const mutate of [u=>u.heat=30,u=>u.gyroHits=2,u=>u.prone=true,u=>{u.actuators.LL.hip=true;u.actuators.RL.hip=true;}]) {
  const g=fresh(),u=g.units[0];mutate(u);assert.equal(g.isImmobile(u),false);
 }
});

test('AGoAC pp.11,40: standing limbless unit fails PSR automatically while prone unit need not roll',()=>{
 for(const prone of [false,true])for(const immediate of [false,true]){
  const g=fresh(),u=g.units[0];g.rng=()=>.5;
  for(const l of ['LA','RA','LL','RL'])g.destroyLocation(u,l);
  u.prone=prone;u.psrs=[];u.phaseDamage=0;
  g.psr(u,0,'AGoAC immobile check',immediate);
  if(!immediate)g.endPSR();
  assert.equal(u.prone,true);assert.equal(u.pilotWounds,prone?0:1);
  assert.equal(g.phaseRolls.some(r=>r.kind.includes('AGoAC immobile check')),false);
  assert.equal(g.mp(u,'walk'),0);assert.equal(g.mp(u,'jump'),0);
 }
});

test('AGoAC pp.11,17,21: limb-loss immobility applies minus four and allows aimed head shots',()=>{
 const g=fresh(),u=g.units[0],t=g.units[2];
 for(const tile of g.tiles)Object.assign(tile,{type:'plain',height:0,surface:0,depth:0});
 Object.assign(u,{q:0,r:0,facing:0,moveMode:'stand'});
 Object.assign(t,{q:2,r:0,moveMode:'stand',distanceMoved:0});
 g.phase='fire';
 assert.equal(g.targetMovementModifier(t),0);
 g.destroyLocation(t,'LL');g.destroyLocation(t,'RL');
 assert.equal(g.targetMovementModifier(t),0);
 g.destroyLocation(t,'LA');g.destroyLocation(t,'RA');
 assert.equal(g.targetMovementModifier(t),-4);
 const normal=g.preview(u.id,t.id,0),head=g.preview(u.id,t.id,0,{aim:'HD'});
 assert.equal(normal.legal,true,normal.reason);assert.equal(normal.mods.target,-4);
 assert.equal(head.legal,true,head.reason);assert.equal(head.mods.target,0);assert.equal(head.mods.aim,3);
});

test('AGoAC pp.3-4,18: logical scale and shortest hex distance independent of height',()=>{
 assert.deepEqual(AGOAC_SCALE,{hexMeters:30,levelMeters:6,turnSeconds:10,standingMechLevels:2});
 const g=fresh(),radius=6;
 // Independent breadth-first reference instead of repeating the axial formula.
 for(const start of g.tiles){
  const key=(q,r)=>q+','+r,seen=new Map([[key(start.q,start.r),0]]),queue=[start];
  for(let i=0;i<queue.length;i++){
   const p=queue[i],n=seen.get(key(p.q,p.r));
   for(const [dq,dr] of DIRS){const q=p.q+dq,r=p.r+dr,k=key(q,r);
    if(Math.max(Math.abs(q),Math.abs(r),Math.abs(q+r))>radius||seen.has(k))continue;
    seen.set(k,n+1);queue.push({q,r});}
  }
  for(const target of g.tiles){const expected=seen.get(key(target.q,target.r));
   assert.equal(distance({...start,height:99},{...target,height:-3}),expected);
   assert.equal(rangeMeters(start,target),30*expected);}
 }
 for(let round=1;round<=100;round++)assert.equal(elapsedBattleSeconds(round),10*(round-1));
});

test('AGoAC pp.5,15: rear-mounted weapon is identified in inventory and critical slots',()=>{
 const u=fresh().units[0],w=u.weapons[0];
 w.name='Audit Laser';w.rear=true;
 const rear=recordSheet(u);
 assert(rear.includes('<td>Audit Laser (R)</td>'));
 assert(rear.includes('○ Audit Laser (R)</div>'));
 w.rear=false;const front=recordSheet(u);
 assert(front.includes('<td>Audit Laser</td>'));
 assert(front.includes('○ Audit Laser</div>'));
 assert(!front.includes('Audit Laser (R)'));
});

test('AGoAC p.5: critical summary shows engine gyro sensors and life support hits',()=>{
 for(let engine=0;engine<=3;engine++)for(let gyro=0;gyro<=2;gyro++)for(let sensors=0;sensors<=2;sensors++)for(const lifeSupport of [false,true]){
  const u=fresh().units[0];Object.assign(u,{engineHits:engine,gyroHits:gyro,sensorHits:sensors,lifeSupport});
  const html=recordSheet(u);
  for(const [id,label,count,max] of [['engine','Двигатель',engine,3],['gyro','Гироскоп',gyro,2],['sensors','Датчики',sensors,2],['life','Жизнеобеспечение',Number(lifeSupport),1]]){
   assert(html.includes('data-critical="'+id+'">'+label+': '+count+' / '+max+' · '+'●'.repeat(count)+'○'.repeat(max-count)));
  }
 }
});
test('AGoAC p.5: individual ammunition slots report capacity and remaining rounds',()=>{
 const g=fresh(),u=g.units[0],bins=u.bins;
 assert(bins.length>=2);
 const [a,b]=bins;
 assert.equal(a.weapon,b.weapon);
 a.shots=4;b.shots=9;g.syncAmmo(u);
 let html=recordSheet(u);
 const n=u.weapons[a.weapon].name;
 assert(html.includes('Боезапас '+n+' · 4 / 12'));
 assert(html.includes('Боезапас '+n+' · 9 / 12'));
 a.destroyed=true;g.syncAmmo(u);html=recordSheet(u);
 assert(html.includes('Боезапас '+n+' · 0 / 12 · уничтожен'));
 assert(html.includes('Боезапас '+n+' · 9 / 12'));
});

test('AGoAC pp.3-4: unmarked terrain and level default independently and survive map reload',()=>{
 const g=fresh();
 const tiles=[{q:0,r:0},{q:1,r:0,height:3},{q:2,r:0,type:'woods'},{q:3,r:0,type:'heavy',height:-2},{q:4,r:0,type:'water',depth:2},{q:5,r:0,type:'water',depth:1,surface:3},{q:6,r:0,type:'water',height:-1,depth:1,surface:0},{q:7,r:0,type:'pavement',height:0,road:true},{q:8,r:0,type:'rubble',height:2},{q:9,r:0,type:'rough',height:-1}];
 const expected=[['plain',0,0,0],['plain',3,0,3],['woods',0,0,0],['heavy',-2,0,-2],['water',-2,2,0],['water',2,1,3],['water',-1,1,0],['pavement',0,0,0],['rubble',2,0,2],['rough',-1,0,-1]];
 g.tiles=JSON.parse(JSON.stringify(tiles));g.rebuildMap();
 for(let i=0;i<expected.length;i++){
  const t=g.tile(i,0);assert.equal(t,g.tiles[i]);
  assert.deepEqual([t.type,t.height,t.depth,t.surface],expected[i]);
  const before=JSON.stringify(t);assert.equal(normalizeMapHex(t),t);assert.equal(JSON.stringify(t),before);
 }
 assert.equal(g.tile(7,0).road,true);
 const old=fresh();const before=JSON.stringify(old.tiles);old.rebuildMap();assert.equal(JSON.stringify(old.tiles),before);
});
