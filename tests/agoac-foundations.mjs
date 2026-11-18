import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Game,defaultMechWarriorSkills,DIRS,distance,AGOAC_SCALE,rangeMeters,elapsedBattleSeconds,normalizeMapHex} from '../dist/engine.js';
import {recordSheet} from '../dist/record-sheet.js';
import {example as setupExample} from '../dist/construction.js';
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

test('AGoAC pp.5,37-38: all heat scale levels mark effects and preserve current overflow',()=>{
 const u=fresh().units[0],effects=new Map([[5,'−1 MP'],[8,'+1 к оружейной атаке'],[10,'−2 MP'],[13,'+2 к оружейной атаке'],[14,'Реактор: 4+'],[15,'−3 MP'],[17,'+3 к оружейной атаке'],[18,'Реактор: 6+'],[19,'Боезапас: 4+'],[20,'−4 MP'],[22,'Реактор: 8+'],[23,'Боезапас: 6+'],[24,'+4 к оружейной атаке'],[25,'−5 MP'],[26,'Реактор: 10+'],[28,'Боезапас: 8+'],[30,'Автоматическое отключение']]);
 for(let heat=0;heat<=60;heat++){
  u.heat=heat;const html=recordSheet(u);
  const cells=[...html.matchAll(/<span data-heat-level="(\d+)" class="([^"]*)"(?: title="([^"]*)")?>([^<]*)<\/span>/g)];
  assert.equal(cells.length,31);
  const current=Math.min(heat,30);
  for(let i=0;i<31;i++){
   const [,value,cls,title,label]=cells[i],n=30-i;
   assert.equal(Number(value),n);
   assert.equal(cls.split(' ').includes('filled'),n>0&&n<=current);
   assert.equal(cls.split(' ').includes('current'),n===current);
   assert.equal(title,effects.get(n));assert.equal(label,String(n)+(effects.has(n)?'*':''));
  }
  assert(html.includes('title="Heat Overflow / нагрев сверх 30">+'+Math.max(0,heat-30)+'</span>'));
 }
});

test('AGoAC pp.5,44: Warrior Data shows all six injury steps and the exact consciousness table',()=>{
 const u=fresh().units[0];
 for(let wounds=0;wounds<=6;wounds++){
  u.pilotWounds=wounds;
  const html=recordSheet(u);
  const hitCells=[...html.matchAll(/data-wound="(\d+)" data-hit="(true|false)"/g)];
  assert.deepEqual(hitCells.map(m=>[Number(m[1]),m[2]==='true']),
    Array.from({length:6},(_,i)=>[i+1,i+1<=wounds]));
  const cells=[...html.matchAll(/data-consciousness="(\d+)"( class="wound-current")?>([^<]*)<\/td>/g)];
  assert.deepEqual(cells.map(m=>m[3]),['3','5','7','10','11','Dead']);
  assert.deepEqual(cells.filter(m=>m[2]).map(m=>Number(m[1])),wounds?[wounds]:[]);
 }
});
test('AGoAC pp.4-5: armor and structure dots track every section independently',()=>{
 const locations=['HD','CT','RT','LT','RA','LA','RL','LL'];
 for(const u of fresh().units){
  for(const damaged of [false,true]){
   for(const [i,l] of locations.entries()){
    u.armor[l]=damaged?Math.max(0,u.maxArmor[l]-i-1):u.maxArmor[l];
    u.structure[l]=damaged?Math.max(0,u.maxStructure[l]-2*i-1):u.maxStructure[l];
   }
   for(const l of ['RT','CT','LT'])u.rear[l]=damaged?0:u.maxRear[l];
   const html=recordSheet(u);
   const groups=[...html.matchAll(/<g data-record-location="([^"]+)" data-record-kind="(armor|structure)">([\s\S]*?)<\/g>/g)];
   assert.equal(groups.length,16);
   for(const [kind,current,max] of [['armor',u.armor,u.maxArmor],['structure',u.structure,u.maxStructure]]){
    for(const l of locations){
     const group=groups.find(m=>m[1]===l&&m[2]===kind);
     assert(group,l+' '+kind);
     assert.equal([...group[3].matchAll(/<circle /g)].length,max[l]);
     assert.equal([...group[3].matchAll(/fill="white"/g)].length,current[l]);
     assert.equal([...group[3].matchAll(/fill="#171717"/g)].length,max[l]-current[l]);
    }
   }
   const rear=[...html.matchAll(/data-record-location="([^"]+)" data-record-kind="rear"><b>[^<]*<\/b><p>([○●]*)<\/p>/g)];
   assert.deepEqual(rear.map(m=>m[1]),['RT','CT','LT']);
   for(const [,l,dots] of rear)assert.equal(dots,'○'.repeat(u.rear[l])+'●'.repeat(u.maxRear[l]-u.rear[l]));
  }
 }
});
test('AGoAC p.5: Mech Data uses actual chassis metadata with escaped text',()=>{
 const u=fresh().units[0];
 Object.assign(u,{name:'<Atlas & Co>',variant:'<AS7>',techBase:'Inner Sphere',walk:5,jump:3});
 const html=recordSheet(u);
 assert(html.includes('Тип: &lt;Atlas &amp; Co&gt; &lt;AS7&gt;'));
 assert(html.includes('Ходьба: <b>5</b>'));
 assert(html.includes('Бег: <b>8</b>'));
 assert(html.includes('Прыжок: <b>3</b>'));
 assert(html.includes('Масса: <b>'+u.tonnage+' т</b>'));
 assert(!html.includes('<Atlas & Co>'));assert(!html.includes('<AS7>'));
});

test('AGoAC pp.6,11,44: unconscious pilot cannot issue voluntary orders but can pass selections',()=>{
  for(const phase of ['move','fire','physical']){
   const g=fresh(),u=g.units[0],t=g.units[2];
   g.phase=phase;g.initiativeWinner=1;g.buildQueue();
   u.pilotWounds=1;u.unconscious=true;
   assert(g.canAct(u));assert(g.isImmobile(u));
   Object.assign(g.tile(u.q,u.r),{type:'woods',depth:0,height:0,surface:0});
   const before=JSON.stringify({u,queue:g.queue,rolls:g.phaseRolls});
   const commands=phase==='move'?[()=>g.rotate(u.id,1),()=>g.drop(u.id),()=>g.orderDump(u.id,0),()=>g.orderShutdown(u.id)]:phase==='fire'?[()=>g.twist(u.id,1),()=>g.flipArms(u.id,false),()=>g.setBrace(u.id,'LA'),()=>g.attack(u.id,t.id,[0])]:[()=>g.takeClub(u.id),()=>g.declarePhysical(u.id,t.id,'kick','LL')];
   for(const command of commands){assert.equal(command().ok,false);assert.equal(JSON.stringify({u,queue:g.queue,rolls:g.phaseRolls}),before);}
   assert.equal(g.hold(u.id).ok,true);
  }
 });

test('AGoAC p.6: surviving immobile or unarmed units retain declaration selections',()=>{
 for(const phase of ['move','fire','physical']){
  const g=fresh(),[unconscious,unarmed,shutdown,destroyed]=g.units;
  g.phase=phase;g.initiativeWinner=1;
  unconscious.unconscious=true;unarmed.weapons=[];shutdown.shutdown=true;destroyed.dead=true;
  g.buildQueue();
  assert.deepEqual(g.queue,[0,0,1]);
  for(const u of [unconscious,unarmed,shutdown]){
   assert.equal(g.canAct(u),true);
   assert.equal(g.canAct(destroyed),false);
   assert.equal(g.hold(u.id).ok,true);
   assert.equal(g.done(u),true);
  }
  assert.equal(g.queue.length,0);
 }
});
test('AGoAC p.7: elimination and mutual destruction produce the correct result',()=>{
 for(const [live0,live1,winner] of [[true,true,null],[true,false,0],[false,true,1],[false,false,'draw']]){
  const g=fresh();
  for(const u of g.units)u.dead=!(u.team===0?live0:live1);
  g.checkWin();assert.equal(g.winner,winner);
 }
});

test('AGoAC pp.35,44: lethal pilot or component damage leaves map presence until phase end',()=>{
 for(const cause of ['wounds','head','center','cockpit','engine']){
  const g=fresh(),u=g.units[0];
  g.phase='move';g.queue=[];g.activeTeam=null;
  if(cause==='wounds'){u.pilotWounds=5;g.wound(u,1);}
  if(cause==='head')g.destroyLocation(u,'HD');
  if(cause==='center')g.destroyLocation(u,'CT');
  if(cause==='cockpit'||cause==='engine'){
   if(cause==='engine')u.engineHits=2;
   const dice=[...diceFor(8),...(cause==='engine'?[0,0]:[(3-.5)/6])];
   g.rng=()=>{assert(dice.length);return dice.shift();};
   g.criticalHit(u,cause==='engine'?'CT':'HD');
   assert.equal(dice.length,0);
  }
  assert.equal(u.dead,true,cause);assert.equal(g.onMap(u),true,cause);
  assert.equal(g.occupied(u.q,u.r),true,cause);assert.equal(g.canAct(u),false);
  const saved=JSON.parse(JSON.stringify(u));
  Object.assign(u,saved);
  assert.equal(g.onMap(u),true,'pending removal survives a JSON round trip');
  assert.equal(g.nextPhase().ok,true);
  assert.equal(g.phase,'fire');assert.equal(g.onMap(u),false,cause);
  assert.equal(g.occupied(u.q,u.r),false,cause);
  assert.equal(g.unit(u.id),u,'historical sheet remains available');
 }
});
test('AGoAC pp.6,7,35: destroyed map presence is cleared at each phase boundary',()=>{
 for(const phase of ['fire','physical','heat','end']){
  const g=fresh(),u=g.units[0];g.phase=phase;
  g.queue=[];g.activeTeam=null;g.initiativeWinner=1;
  g.destroyMech(u);
  assert.equal(g.onMap(u),true);
  assert(g.nextPhase().ok);
  assert.equal(g.onMap(u),false,phase);
  assert.equal(g.occupied(u.q,u.r),false);
 }
 const g=fresh(),u=g.units[0];
 u.dead=true;
 assert.equal(g.onMap(u),false,'legacy snapshots and absent roster slots do not reappear');
 g.reset();assert.equal(g.onMap(g.units[0]),true);
});

test('AGoAC pp.6,21,30: every weapon attack rolls and spends ammo before damage, even a destroyed shooter',()=>{
 const g=fresh(),a=g.units[0],b=g.units[2],ammo=a.bins[0];
 g.phase='fire';g.rng=()=>.99;
 const shot=(u,target,index,bin=null)=>({index,target:target.id,bin,aim:null,heatMode:false,
  weapon:{...u.weapons[index],rack:0},
  preview:{targetNumber:2,side:'front',cover:false,underwaterCover:false}});
 const before=ammo.shots,observed=[];
 g.declarations=[{id:b.id,shots:[shot(b,a,1)]},{id:a.id,shots:[shot(a,b,1,0)]}];
 g.hit=(target,damage)=>{
  observed.push(target.id);
  assert.equal(ammo.shots,before-1,'Ammunition spent before any damage');
  assert.deepEqual(g.phaseRolls.slice(0,2).map(r=>r.kind),
   [b.name+' · '+b.weapons[1].name,a.name+' · '+a.weapons[1].name]);
  if(target===a)g.destroyMech(a);
  return {location:'CT',damage,hits:[]};
 };
 const results=g.resolveFire();
 assert.deepEqual(observed,[a.id,b.id]);
 assert.equal(a.dead,true);assert.equal(g.onMap(a),false);
 assert.equal(results.length,2);
 assert.equal(results[1].shots[0].damage,a.weapons[1].damage);
 assert.deepEqual(results.map(r=>r.shots[0].rolls.length),[1,1]);
 assert.deepEqual(results.map(r=>r.shots[0].rolls[0].kind),g.phaseRolls.slice(0,2).map(r=>r.kind));
});
test('AGoAC pp.21,30: resolve each target and each missile packet completely in declared order',()=>{
 const g=fresh(),u=g.units[0],a=g.units[2],b=g.units[3];
 g.phase='fire';g.rng=()=>.99;
 const shot=(target,index,weapon)=>({index,target:target.id,bin:null,aim:null,heatMode:false,
  weapon:{...weapon,ammo:null},preview:{targetNumber:2,side:'front',cover:false,underwaterCover:false}});
 g.declarations=[{id:u.id,shots:[
  shot(a,0,{name:'SRM 2',rack:2,heat:2,damage:2,location:'RA'}),
  shot(b,1,{name:'Medium Laser B',rack:0,heat:3,damage:5,location:'RA'}),
  shot(a,2,{name:'Medium Laser A',rack:0,heat:3,damage:5,location:'RA'})
 ]}];
 const packets=[];
 g.hit=(target,damage)=>{
  assert.equal(g.phaseRolls.slice(0,3).filter(r=>r.target===2).length,3);
  packets.push([target.id,damage]);
  g.roll('Packet '+target.id+' '+damage,2);
  return {location:'CT',damage,hits:[]};
 };
 const result=g.resolveFire();
 assert.deepEqual(packets,[[a.id,2],[a.id,2],[a.id,5],[b.id,5]]);
 assert.deepEqual(result.map(r=>r.target),[a.id,a.id,b.id]);
 assert.deepEqual(result[0].shots[0].rolls.map(r=>r.kind),
  [u.name+' · SRM 2','Ракетный кластер','Packet '+a.id+' 2','Packet '+a.id+' 2']);
});

test('AGoAC p.38: unconscious pilots cannot override thermal shutdown and auto restart below 14',()=>{
 for(const was of [false,true])for(let heat=0;heat<=35;heat++){
  const g=fresh(),u=g.units[0];g.phase='heat';
  for(const other of g.units.slice(1))other.dead=true;
  for(const bin of u.bins)bin.shots=0;
  u.sinks=0;u.heat=heat;u.prone=true;u.unconscious=true;u.pilotWounds=1;
  u.shutdown=was;u.voluntaryShutdown=false;
  g.rng=()=>{throw Error('An unconscious pilot cannot attempt a thermal override');};
  g.heatPhase();assert.equal(u.heat,heat);
  assert.equal(u.shutdown,heat>=14,'heat '+heat+' prior shutdown '+was);
  assert.equal(g.phaseRolls.length,0);
 }
});
test('AGoAC p.38: conscious pilot rolls only the highest thermal threshold and never at 30 or more',()=>{
 for(const was of [false,true])for(const heat of [0,13,14,17,18,21,22,25,26,29,30,35]){
  const tn=heat>=30?99:heat>=26?10:heat>=22?8:heat>=18?6:heat>=14?4:0;
  for(const sum of [2,4,6,8,10,12]){
   const g=fresh(),u=g.units[0];g.phase='heat';
   for(const other of g.units.slice(1))other.dead=true;
   for(const bin of u.bins)bin.shots=0;
   u.sinks=0;u.heat=heat;u.prone=true;u.shutdown=was;
   const dice=tn>0&&tn<99?diceFor(sum):[];
   g.rng=()=>{assert(dice.length);return dice.shift();};
   g.heatPhase();
   assert.equal(u.shutdown,tn===99||tn>0&&sum<tn);
   assert.deepEqual(g.phaseRolls.map(r=>r.target),tn>0&&tn<99?[tn]:[]);
   assert.equal(dice.length,0);
  }
 }
});

test('AGoAC pp.26,42: successful charge against a prohibited displacement hex still deals damage and requires PSRs',()=>{
 for(const [rise,lethal,expectedAttacker,expectedTarget] of [[0,false,1,2],[3,false,0,1],[3,true,1,1]]){
  const g=fresh(),u=g.units[0],t=g.units[2];g.phase='physical';
  for(const tile of g.tiles)Object.assign(tile,{type:'plain',depth:0,height:0,surface:0});
  Object.assign(u,{q:0,r:0,facing:0,tonnage:65,moveMode:'run',piloting:5,
   charge:{target:t.id,type:'charge',dir:0,hexes:5,targetPos:{q:1,r:0}}});
  Object.assign(t,{q:1,r:0,tonnage:45,piloting:5,moveMode:'stand',distanceMoved:0});
  g.tile(2,0).height=rise;g.tile(2,0).surface=rise;g.rng=()=>.99;
  const damage=[];
  g.packets=(victim,amount)=>{damage.push([victim.id,amount]);if(victim===t&&lethal)g.destroyMech(t);};
  g.resolveSpecial(u);
  assert.equal(g.resolution[0].shots[0].hit,true);
  assert.deepEqual(damage,[[t.id,33],[u.id,5]],'Round up only after multiplying the attacker tonnage by traveled hexes');
  assert.equal(t.dead,lethal,'Prohibited displacement is not lethal for an ordinary charge');
  assert.deepEqual([u.q,t.q],[expectedAttacker,expectedTarget]);
  assert(u.psrs.some(p=>p.modifier===2),'Attacker must check for falling');
  if(!lethal)assert(t.psrs.some(p=>p.modifier===2),'Surviving target must check for falling');
 }
});

test('AGoAC pp.29,42: opposite pushes resolve both rolls before either displacement',()=>{
 for(const [left,right] of [[false,false],[true,false],[false,true],[true,true]]){
  const g=fresh(),u=g.units[0],t=g.units[2];g.phase='physical';
  for(const tile of g.tiles)Object.assign(tile,{type:'plain',depth:0,height:0,surface:0});
  for(const v of [g.units[1],g.units[3]])v.dead=true;
  Object.assign(u,{q:0,r:0,facing:0});Object.assign(t,{q:1,r:0,facing:3});
  const dice=[...diceFor(left?12:2),...diceFor(right?12:2),
   ...Array.from({length:Number(left)+Number(right)},()=>diceFor(12)).flat()];
  g.rng=()=>{assert(dice.length);return dice.shift();};
  g.physicalDeclarations=[
   {id:u.id,target:t.id,type:'push',targetNumber:7},
   {id:t.id,target:u.id,type:'push',targetNumber:7}
  ];
  const results=g.resolvePhysical();
  assert.deepEqual(results.map(r=>r.shots[0].hit),[left,right]);
  assert.deepEqual(results.map(r=>r.shots[0].damage),[0,0]);
  assert.deepEqual([u.q,t.q],left===right?[0,1]:left?[1,2]:[-1,0]);
  assert.deepEqual(g.phaseRolls.slice(0,2).map(r=>r.total),[left?12:2,right?12:2]);
  assert.equal(g.phaseRolls.filter(r=>r.kind.includes('Толчок')||r.kind.includes('Встречный толчок')).length,Number(left)+Number(right));
  assert.equal(dice.length,0);
 }
});
test('AGoAC pp.29,42: prohibited push retains positions but still requires an immediate PSR',()=>{
 const g=fresh(),u=g.units[0],t=g.units[2];g.phase='physical';
 for(const tile of g.tiles)Object.assign(tile,{type:'plain',depth:0,height:0,surface:0});
 Object.assign(u,{q:0,r:0,facing:0});Object.assign(t,{q:1,r:0,facing:3});
 g.tile(2,0).height=3;
 const dice=[...diceFor(12),...diceFor(2)];
 g.rng=()=>{assert(dice.length);return dice.shift();};
 const fall=[];g.fall=(v,levels)=>{fall.push([v.id,v.q,v.r,levels]);v.prone=true;};
 g.physicalDeclarations=[{id:u.id,target:t.id,type:'push',targetNumber:7}];
 assert(g.resolvePhysical()[0].shots[0].hit);
 assert.deepEqual([u.q,t.q],[0,1]);
 assert.deepEqual(fall,[[t.id,1,0,0]]);
 assert.equal(t.dead,false);
 assert.equal(dice.length,0);
});

test('AGoAC p.42: domino checks occur before chain displacement and failures fall in destination',()=>{
 for(const [firstPass,lastPass] of [[false,false],[false,true],[true,false],[true,true]]){
  const g=fresh(),[a,b,c,d]=g.units;
  for(const tile of g.tiles)Object.assign(tile,{type:'plain',height:0,depth:0,surface:0});
  Object.assign(a,{q:0,r:0});Object.assign(b,{q:1,r:0,spent:99});
  Object.assign(c,{q:2,r:0,spent:99});d.dead=true;
  const events=[];
  const dice=[...diceFor(firstPass?12:2),...diceFor(lastPass?12:2)];
  g.rng=()=>{assert(dice.length);return dice.shift();};
  const roll=g.roll.bind(g);
  g.roll=(kind,tn)=>{events.push(['roll',kind,b.q,c.q]);return roll(kind,tn);};
  g.fall=(u,levels,tn)=>{events.push(['fall',u.id,u.q,u.r,levels,tn]);u.prone=true;};
  assert.equal(g.displace(a,0),true);
  assert.deepEqual([a.q,b.q,c.q],[1,2,3]);
  assert.deepEqual(events.slice(0,2),[['roll',b.name+' · Домино',1,2],['roll',c.name+' · Домино',1,2]]);
  assert.equal(b.prone,!firstPass);assert.equal(c.prone,!lastPass);
  const expected=[];
  if(!lastPass)expected.push(['fall',c.id,3,0,0,c.piloting]);
  if(!firstPass)expected.push(['fall',b.id,2,0,0,b.piloting]);
  assert.deepEqual(events.slice(2),expected);
  assert.equal(dice.length,0);
 }
});
test('AGoAC p.42: immobile and prone domino targets do not roll; blocked final target is destroyed',()=>{
 for(const state of ['unconscious','prone','blocked']){
  const g=fresh(),[a,b,c,d]=g.units;
  for(const tile of g.tiles)Object.assign(tile,{type:'plain',height:0,depth:0,surface:0});
  Object.assign(a,{q:0,r:0});Object.assign(b,{q:1,r:0,spent:99});c.dead=d.dead=true;
  if(state==='unconscious'){b.unconscious=true;b.pilotWounds=1;}
  if(state==='prone')b.prone=true;
  if(state==='blocked')g.tile(2,0).height=3;
  const dice=state==='blocked'?diceFor(12):[];
  g.rng=()=>{assert(dice.length);return dice.shift();};
  let fell=false;g.fall=(u,levels)=>{assert.equal(u,b);assert.equal(u.q,2);assert.equal(levels,0);fell=true;u.prone=true;};
  assert(g.displace(a,0));assert.equal(a.q,1);
  assert.equal(b.dead,state==='blocked');
  assert.equal(b.q,state==='blocked'?1:2);
  assert.equal(fell,state==='unconscious');
  if(state==='blocked'){assert(g.onMap(b));g.removeDestroyedMechs();assert(!g.onMap(b));}
  assert.equal(dice.length,0);
 }
});

test('AGoAC p.44: accidental fall uses movement and terrain, punch packets, rear fall and displaced target PSR',()=>{
 for(const submerged of [false,true]){
  const g=fresh(),[u,t,a,b]=g.units;
  for(const tile of g.tiles)Object.assign(tile,{type:'plain',height:0,depth:0,surface:0});
  Object.assign(u,{q:0,r:0,tonnage:65,facing:0});
  Object.assign(t,{q:1,r:0,prone:false,facing:3,distanceMoved:3,moveMode:'walk'});
  a.dead=b.dead=true;
  Object.assign(g.tile(0,0),{height:5,surface:5});
  Object.assign(g.tile(1,0),{type:submerged?'water':'woods',depth:submerged?2:0});
  const events=[];
  g.rng=()=>.99;
  g.hit=(victim,amount,side,table)=>{events.push(['packet',victim.id,amount,side,table]);return {damage:amount,hits:[]};};
  g.fall=(victim,levels,tn,side)=>{events.push(['fall',victim.id,victim.q,victim.r,levels,side]);victim.prone=true;};
  g.psr=(victim,mod,reason,immediate)=>{events.push(['psr',victim.id,mod,reason,immediate]);return true;};
  const expected=submerged?10:21;
  assert(g.displace(u,0));
  assert.equal(g.phaseRolls[0].target,submerged?8:9);
  const packets=events.filter(v=>v[0]==='packet');
  assert.equal(packets.reduce((n,v)=>n+v[2],0),expected);
  assert(packets.every(v=>v[1]===t.id&&v[2]<=5&&v[4]==='punch'));
  assert.deepEqual(events.at(-2),['fall',u.id,1,0,5,'rear']);
  assert.deepEqual(events.at(-1),['psr',t.id,2,'Падение сверху',true]);
  assert.equal(distance(u,t),1);assert.notEqual(t.q+','+t.r,'0,0');
 }
});
test('AGoAC p.44: missed accidental fall selects a nearest legal hex or destroys the falling Mech',()=>{
 for(const blocked of [false,true]){
  const g=fresh(),[u,t,a,b]=g.units;
  for(const tile of g.tiles)Object.assign(tile,{type:'plain',height:0,depth:0,surface:0});
  Object.assign(u,{q:0,r:0});Object.assign(t,{q:1,r:0});a.dead=b.dead=true;
  g.tile(0,0).height=5;
  if(blocked)for(const [dq,dr] of DIRS)g.tile(t.q+dq,t.r+dr).height=5;
  g.rng=()=>0;
  const events=[];g.fall=(victim,levels)=>{events.push([victim.id,victim.q,victim.r,levels]);victim.prone=true;};
  g.packets=()=>{assert.fail('A missed collision cannot damage its target');};
  assert(g.displace(u,0));
  assert.equal(t.dead,false);assert.deepEqual([t.q,t.r],[1,0]);
  assert.equal(u.dead,blocked);
  if(blocked)assert.equal(events.length,0);
  else{
   assert.equal(distance(u,t),1);assert.equal(distance(u,{q:0,r:0}),1);
   assert.deepEqual(events,[[u.id,u.q,u.r,5]]);
  }
 }
});

test('AGoAC p.43: falling from dry elevation into water resolves surface and bottom damage independently',()=>{
 for(const tonnage of [20,65,85,100])for(const depth of [1,2,3])for(const above of [0,1,2,3]){
  const g=fresh(),u=g.units[0];
  for(const tile of g.tiles)Object.assign(tile,{type:'plain',height:0,depth:0,surface:0});
  for(const v of g.units.slice(1))v.dead=true;
  Object.assign(u,{q:0,r:0,tonnage,facing:0});
  Object.assign(g.tile(0,0),{height:above,surface:above});
  Object.assign(g.tile(1,0),{type:'water',height:-depth,depth,surface:0});
  const base=Math.ceil(tonnage/10),actual=[];
  g.rng=()=>.99;
  g.packets=(v,amount,side)=>{assert.equal(v,u);actual.push([amount,side]);};
  if(above+depth>=2)assert(g.displace(u,0));
  else{
   const origin=g.tile(u.q,u.r);u.q=1;u.r=0;
   g.fall(u,above+depth,null,null,0,origin);
  }
  assert.equal(u.prone,true);
  assert.deepEqual(actual,[[Math.floor(base*(above+1)/2),'left'],[Math.floor(base*(depth+1)/2),'left']]);
 }
});
test('AGoAC p.43: standing in water uses one halved impact and surface and bottom packets never combine',()=>{
 const g=fresh(),u=g.units[0];
 Object.assign(u,{q:0,r:0,tonnage:65});
 Object.assign(g.tile(0,0),{type:'water',height:-2,depth:2,surface:0});
 g.rng=()=>.99;
 const packets=[];
 g.hit=(v,amount,side)=>{assert.equal(v,u);packets.push(amount);return {damage:amount,hits:[]};};
 g.fall(u,0);assert.deepEqual(packets,[3]);
 packets.length=0;u.prone=false;
 g.fall(u,3,null,'rear',0,{height:1,depth:0});
 assert.deepEqual(packets,[5,2,5,5],'7 surface plus 10 bottom; do not combine into 17 before packetization');
});

test('AGoAC pp.26–29: displacement declarations reserve a target across attack types and reject airborne targets',()=>{
 const prepare=()=>{
  const g=fresh(),[u,a,t,b]=g.units;
  for(const tile of g.tiles)Object.assign(tile,{type:'plain',height:0,depth:0,surface:0});
  Object.assign(u,{q:0,r:0,facing:0});Object.assign(a,{q:2,r:0,facing:3});
  Object.assign(t,{q:1,r:0,facing:3,moved:true});Object.assign(b,{q:3,r:0});
  g.phase='physical';g.activeTeam=u.team;g.queue=[u.team,u.team];g.actingId=null;
  return {g,u,a,t,b};
 };
 for(const type of ['charge','dfa']){
  const {g,u,a,t,b}=prepare();
  a.charge={type,target:t.id};
  assert.equal(g.physicalPreview(u.id,t.id,'push','LA').legal,false);
  const saved=JSON.stringify({units:g.units,queue:g.queue,orders:g.physicalDeclarations});
  assert.equal(g.declarePhysical(u.id,t.id,'push','LA').ok,false);
  assert.equal(JSON.stringify({units:g.units,queue:g.queue,orders:g.physicalDeclarations}),saved);
  a.charge=null;t.charge={type,target:b.id};t.airborne=type==='dfa';
  assert.equal(g.physicalPreview(u.id,t.id,'push','LA').legal,false);
  if(type==='dfa')for(const attack of ['punch','kick','club','hatchet']){
   assert.equal(g.physicalPreview(u.id,t.id,attack,'LA').legal,false);
  }
  g.phase='move';g.queue=[u.team];g.activeTeam=u.team;g.actingId=null;
  const before=JSON.stringify({units:g.units,queue:g.queue});
  for(const kind of ['charge','dfa'])assert.equal(g.declareCharge(u.id,t.id,kind).ok,false);
  assert.equal(JSON.stringify({units:g.units,queue:g.queue}),before);
 }
 const {g,u,a,t}=prepare();
 assert(g.declarePhysical(u.id,t.id,'push','LA').ok);
 assert.equal(g.declarePhysical(a.id,t.id,'push','LA').ok,false);
 assert.equal(g.physicalDeclarations.length,1);
 // A reservation restricts displacement attacks, not ordinary kicks.
 assert.equal(g.physicalPreview(a.id,t.id,'kick','RL').legal,true);
 // Reciprocal pushes have different target IDs and remain legal.
 g.activeTeam=t.team;g.queue=[t.team];
 assert(g.declarePhysical(t.id,u.id,'push','LA').ok);
});
test('AGoAC pp.25–27: prone completed target is eligible for DFA but not charge',()=>{
 const g=fresh(),[u,a,t,b]=g.units;
 for(const tile of g.tiles)Object.assign(tile,{type:'plain',height:0,depth:0,surface:0});
 Object.assign(u,{q:-2,r:0,facing:0,jump:5,jumpLost:0});
 Object.assign(t,{q:1,r:0,moved:true,prone:true});
 a.dead=b.dead=true;
 g.phase='move';g.activeTeam=u.team;g.queue=[u.team];g.actingId=null;
 assert.equal(g.declareCharge(u.id,t.id,'charge').ok,false);
 const result=g.declareCharge(u.id,t.id,'dfa');
 assert(result.ok,result.error);
 assert.equal(u.charge.type,'dfa');assert.equal(u.airborne,true);
 assert.equal(u.charge.target,t.id);
});

test('AGoAC pp.7,29–30: ordinary physical attacks all roll before damage, including a destroyed attacker',()=>{
 const g=fresh(),a=g.units[0],b=g.units[2];g.phase='physical';g.initiativeWinner=1;
 for(const tile of g.tiles)Object.assign(tile,{type:'plain',height:0,depth:0,surface:0});
 Object.assign(a,{q:0,r:0,facing:0});Object.assign(b,{q:1,r:0,facing:3});
 const orders=[{id:a.id,target:b.id},{id:b.id,target:a.id}].map(d=>({...d,type:'punch',limb:'LA',
  targetNumber:2,damage:5,side:'front',table:'punch'}));
 g.physicalDeclarations=orders;g.rng=()=>.99;
 const victims=[];g.hit=(victim,damage)=>{
  assert.deepEqual(g.phaseRolls.slice(0,2).map(r=>r.kind),[a.name+' · punch',b.name+' · punch']);
  victims.push(victim.id);if(victim===b)g.destroyMech(b);
  return {damage,hits:[]};
 };
 const result=g.resolvePhysical();
 assert.deepEqual(victims,[b.id,a.id]);
 assert.equal(b.dead,true);
 assert.deepEqual(result.map(r=>r.shots[0].damage),[5,5]);
 assert.equal(g.phaseRolls.length,2);
});
test('AGoAC p.42: displacement does not cancel a still-valid adjacent physical attack',()=>{
 for(const winner of [0,1]){
  const g=fresh(),[a,ally,t,enemy]=g.units;g.phase='physical';g.initiativeWinner=winner;
  for(const tile of g.tiles)Object.assign(tile,{type:'plain',height:0,depth:0,surface:0});
  Object.assign(a,{q:-1,r:0,facing:0});Object.assign(t,{q:0,r:0,facing:3});
  Object.assign(ally,{q:3,r:0});enemy.dead=true;
  // a pushes t east and follows; a remains adjacent in t's forward arc.
  const preview=g.physicalPreview(t.id,a.id,'punch','LA');
  assert(preview.legal,preview.reason);
  g.physicalDeclarations=[
   {id:t.id,target:a.id,type:'punch',limb:'LA',...preview},
   {id:a.id,target:t.id,type:'push',limb:'LA',targetNumber:2,damage:0}
  ];
  g.rng=()=>.99;const damage=[];
  g.hit=(victim,n)=>{damage.push([victim.id,n]);return {damage:n,hits:[]};};
  const result=g.resolvePhysical(),punch=result.find(r=>r.id===t.id).shots[0];
  assert.deepEqual([a.q,t.q],[0,1]);
  // a follows the pushed target. The resulting front/back facing relation
  // remains adjacent; use a third stationary target to test interruption below.
  assert.equal(punch.cancelled,false);
  assert.equal(punch.hit,true);
  assert.deepEqual(damage,[[a.id,preview.damage]]);
 }
});
test('AGoAC p.42: displacement invalidates an unmade attack against a stationary third Mech',()=>{
 for(const winner of [0,1]){
  const g=fresh(),[a,ally,t,enemy]=g.units;g.phase='physical';g.initiativeWinner=winner;
  for(const tile of g.tiles)Object.assign(tile,{type:'plain',height:0,depth:0,surface:0});
  Object.assign(a,{q:-1,r:0,facing:0});Object.assign(t,{q:0,r:0,facing:3});
  Object.assign(ally,{q:0,r:-1,facing:1});enemy.dead=true;
  g.physicalDeclarations=[
   {id:t.id,target:ally.id,type:'punch',limb:'LA',targetNumber:2,damage:5,side:'front',table:'punch'},
   {id:a.id,target:t.id,type:'push',limb:'LA',targetNumber:2,damage:0}
  ];
  g.rng=()=>.99;const damage=[];
  g.hit=(victim,n)=>{damage.push([victim.id,n]);return {damage:n,hits:[]};};
  const result=g.resolvePhysical(),punch=result.find(r=>r.id===t.id).shots[0];
  assert.deepEqual([a.q,t.q],[0,1]);
  const pushFirst=winner===1;
  assert.equal(punch.cancelled,pushFirst);
  assert.equal(punch.hit,!pushFirst);
  assert.equal(punch.roll,pushFirst?null:12);
  assert.deepEqual(damage,pushFirst?[]:[[ally.id,5]]);
 }
});

test('AGoAC pp.27–28: DFA searches legal directions by angular distance, with occupied and offboard destinations allowed',()=>{
 const g=fresh(),[u,t,a,b]=g.units;
 for(const tile of g.tiles)Object.assign(tile,{type:'plain',height:0,depth:0,surface:0});
 Object.assign(u,{q:0,r:0,airborne:true});Object.assign(t,{q:1,r:0});a.dead=b.dead=true;
 const neighbor=dir=>g.tile(t.q+DIRS[dir][0],t.r+DIRS[dir][1]);
 assert.equal(g.occupied(u.q,u.r,t.id),false,'DFA in flight does not count for stacking');
 assert.deepEqual(g.dfaDisplacementOptions(t,0,true),[0]);
 neighbor(0).height=3;
 assert.deepEqual(g.dfaDisplacementOptions(t,0,true),[1,5]);
 Object.assign(a,{dead:false,q:neighbor(1).q,r:neighbor(1).r});
 assert.deepEqual(g.dfaDisplacementOptions(t,0,true),[1,5],'occupied landing is legal');
 neighbor(1).height=3;neighbor(5).height=3;
 assert.deepEqual(g.dfaDisplacementOptions(t,0,true),[2,4]);
 assert.deepEqual(g.dfaDisplacementOptions(t,0,false),[2,4,3],'miss allows any legal neighbor');
 for(let dir=0;dir<6;dir++)neighbor(dir).height=3;
 assert.deepEqual(g.dfaDisplacementOptions(t,0,true),[]);
 assert.deepEqual(g.dfaDisplacementOptions(t,0,false),[]);
 Object.assign(t,{q:6,r:0});
 assert(!g.tile(7,0));
 assert.deepEqual(g.dfaDisplacementOptions(t,0,true),[0],'forced offboard is legal');
});
test('AGoAC pp.27–28: successful and missed DFA land in target hex; impassable surroundings determine destruction',()=>{
 for(const hit of [true,false])for(const blocked of [false,true]){
  const g=fresh(),[u,t,a,b]=g.units;
  for(const tile of g.tiles)Object.assign(tile,{type:'plain',height:0,depth:0,surface:0});
  Object.assign(u,{q:0,r:0,airborne:true,tonnage:55,moveMode:'jump',charge:{target:t.id,type:'dfa',dir:0,targetPos:{q:1,r:0},startPos:{q:-2,r:0}}});
  Object.assign(t,{q:1,r:0,moveMode:'stand',distanceMoved:0});a.dead=b.dead=true;
  const neighbor=dir=>g.tile(t.q+DIRS[dir][0],t.r+DIRS[dir][1]);
  neighbor(0).height=3;
  if(blocked)for(let dir=1;dir<6;dir++)neighbor(dir).height=3;
  g.rng=()=>hit?.99:0;
  const damage=[],falls=[],checks=[];
  g.packets=(v,n,side,table)=>damage.push([v.id,n,side,table]);
  g.fall=(v,levels,tn,side)=>{falls.push([v.id,levels,side,v.q,v.r]);v.prone=true;};
  g.psr=(v,mod)=>{checks.push([v.id,mod]);return true;};
  const dest={q:neighbor(1).q,r:neighbor(1).r};
  g.resolveSpecial(u);
  assert.equal(u.airborne,false);
  assert.equal(g.resolution[0].shots[0].hit,hit);
  assert.equal(u.dead,!hit&&blocked);assert.equal(t.dead,hit&&blocked);
  if(!u.dead)assert.deepEqual([u.q,u.r],[1,0]);
  if(!blocked)assert.deepEqual([t.q,t.r],[dest.q,dest.r]);
  else assert.deepEqual([t.q,t.r],[1,0]);
  if(hit){
   assert.equal(damage[0][1],17);assert.deepEqual(damage[1],[u.id,11,'front','kick']);
   assert(checks.some(([id,mod])=>id===u.id&&mod===4));
   assert.equal(falls.length,0);
  }else{
   assert.equal(damage.length,0);
   assert.deepEqual(falls,blocked?[]:[[u.id,2,'rear',1,0]]);
  }
 }
});

function dominoChoiceGame(){
 const g=fresh(),[t,b,a,other]=g.units;
 for(const tile of g.tiles)Object.assign(tile,{type:'plain',height:0,depth:0,surface:0});
 Object.assign(a,{q:-1,r:0,facing:0});Object.assign(t,{q:0,r:0});
 Object.assign(b,{q:1,r:0,facing:1,moveMode:'walk',spent:0});
 other.dead=true;g.phase='physical';g.initiativeWinner=0;g.queue=[];g.activeTeam=null;
 const push=g.physicalPreview(a.id,t.id,'push','LA');assert(push.legal,push.reason);
 g.physicalDeclarations=[{id:a.id,target:t.id,type:'push',limb:'LA',...push}];
 return {g,t,b,a};
}
test('AGoAC p.42: domino dodge eligibility, direction, MP, occupied hexes and movement mode',()=>{
 const {g,b}=dominoChoiceGame();
 assert.deepEqual(g.dominoDodgeOptions(b,0).map(o=>o.id),['forward','back']);
 assert.deepEqual(g.dominoDodgeOptions(b,b.facing),[]);
 assert.deepEqual(g.dominoDodgeOptions(b,(b.facing+3)%6),[]);
 for(const mode of ['jump','run','walk']){
  b.moveMode=mode;b.spent=0;
  assert.deepEqual(g.dominoDodgeOptions(b,0).map(o=>o.id),mode==='jump'?[]:mode==='run'?['forward']:['forward','back']);
 }
 const [ahead,behind]=g.dominoDodgeOptions(b,0);
 g.tile(ahead.q,ahead.r).type='woods';b.spent=g.mp(b,'walk')-1;
 assert.deepEqual(g.dominoDodgeOptions(b,0).map(o=>o.id),['back']);
 Object.assign(g.units[3],{dead:false,q:behind.q,r:behind.r});
 assert.deepEqual(g.dominoDodgeOptions(b,0),[]);
 b.spent=0;b.prone=true;assert.deepEqual(g.dominoDodgeOptions(b,0),[]);
 b.prone=false;b.unconscious=true;assert.deepEqual(g.dominoDodgeOptions(b,0),[]);
});
test('AGoAC p.42: voluntary domino choice pauses after successful PSR and restores without rerolling',()=>{
 for(const option of ['forward','back','decline']){
  const {g,b}=dominoChoiceGame();let draws=0;g.rng=()=>{draws++;return .99;};
  const initial=JSON.stringify(g.units);
  assert.deepEqual(g.nextPhaseWithChoices({humanTeams:[0]}),{ok:true,pending:true});
  const choice=structuredClone(g.pendingChoice);
  assert.equal(choice.kind,'domino');assert.equal(choice.unitId,b.id);
  assert.deepEqual(choice.options.map(o=>o.id),['decline','forward','back']);
  assert.equal(choice.context.roll.total,12);
  assert.equal(g.phase,'physical');assert.equal(JSON.stringify(g.units),initial);
  assert.equal(draws,4);
  assert.equal(g.nextPhaseWithChoices({choice:{key:choice.key,option:'illegal'}}).ok,false);
  assert.equal(draws,4);
  const saved=JSON.parse(JSON.stringify(g,(k,v)=>['map','rng'].includes(k)?undefined:v));
  const restored=fresh();Object.assign(restored,saved);restored.rebuildMap();
  restored.rng=()=>{draws++;return .99;};
  assert(restored.nextPhaseWithChoices({choice:{key:choice.key,option}}).ok);
  assert.equal(restored.pendingChoice,null);assert.equal(restored._resolutionReplay,null);
  assert.equal(restored.phase,'heat');assert.equal(draws,6,'previous four samples must not be regenerated');
  const moved=restored.unit(b.id),chosen=choice.options.find(o=>o.id===option);
  assert.deepEqual([moved.q,moved.r,moved.spent],option==='decline'?[2,0,0]:[chosen.q,chosen.r,chosen.cost]);
  assert.equal(restored.phaseRolls.filter(r=>r.kind.includes('Домино')).length,1);
 }
});
test('AGoAC pp.27–28: target controller selects an equal DFA displacement direction after the attack',()=>{
 const g=fresh(),[t,ally,u,other]=g.units;
 for(const tile of g.tiles)Object.assign(tile,{type:'plain',height:0,depth:0,surface:0});
 ally.dead=other.dead=true;Object.assign(t,{q:1,r:0,facing:0});
 Object.assign(u,{q:0,r:0,airborne:true,moveMode:'jump',tonnage:55,
  charge:{target:t.id,type:'dfa',dir:0,targetPos:{q:1,r:0},startPos:{q:-2,r:0}}});
 g.tile(2,0).height=3;g.phase='physical';g.initiativeWinner=0;g.queue=[];g.activeTeam=null;
 // 2 for the DFA to-hit; the remaining successful PSR/packet dice use 7.
 let draws=0;g.rng=()=>{draws++;return draws<=2?0:.5;};
 assert(g.nextPhaseWithChoices({humanTeams:[0]}).pending);
 const choice=structuredClone(g.pendingChoice);
 assert.equal(choice.kind,'dfa');assert.equal(choice.unitId,t.id);assert.equal(choice.context.hit,false);
 assert.equal(draws,2);assert(choice.options.length>1);
 const option=choice.options.at(-1);
 assert(g.nextPhaseWithChoices({choice:{key:choice.key,option:option.id}}).ok);
 assert.equal(g.pendingChoice,null);
 assert.deepEqual([g.unit(t.id).q,g.unit(t.id).r],[option.q,option.r]);
 assert.deepEqual([g.unit(u.id).q,g.unit(u.id).r],[1,0]);
 assert.equal(g.phaseRolls.filter(r=>r.kind===u.name+' · DFA').length,1);
 assert(g.unit(u.id).prone||g.unit(u.id).dead);
});

function sameSidePriorityGame(){
 const g=fresh(),[puncher,pusher,t,other]=g.units;
 for(const tile of g.tiles)Object.assign(tile,{type:'plain',height:0,depth:0,surface:0});
 Object.assign(pusher,{q:-1,r:0,facing:0});
 Object.assign(puncher,{q:0,r:-1,facing:DIRS.findIndex(d=>d[0]===0&&d[1]===1)});
 Object.assign(t,{q:0,r:0,facing:3});
 other.dead=true;g.phase='physical';g.initiativeWinner=1;g.queue=[];g.activeTeam=null;
 const punch=g.physicalPreview(puncher.id,t.id,'punch','LA');
 const push=g.physicalPreview(pusher.id,t.id,'push','LA');
 assert(punch.legal,punch.reason);assert(push.legal,push.reason);
 g.physicalDeclarations=[
  {id:pusher.id,target:t.id,type:'push',limb:'LA',...push},
  {id:puncher.id,target:t.id,type:'punch',limb:'LA',...punch}
 ];
 return {g,puncher,pusher,t};
}
test('AGoAC p.42: controller can order a conflicting punch and push before either is rolled',()=>{
 for(const first of ['punch','push']){
  const {g,puncher,pusher,t}=sameSidePriorityGame();let draws=0;g.rng=()=>{draws++;return .99;};
  assert.equal(g.nextPhaseWithChoices({humanTeams:[0]}).pending,true);
  const request=structuredClone(g.pendingChoice);
  assert.equal(request.kind,'physical-order');assert.equal(request.team,0);
  assert.deepEqual(request.options.map(o=>o.attackerId),[pusher.id,puncher.id]);
  assert.equal(draws,0,'controller decides before either attack roll');
  const id=first==='punch'?puncher.id:pusher.id;
  const result=g.nextPhaseWithChoices({choice:{key:request.key,option:String(id)}});
  assert(result.ok);assert.equal(g.pendingChoice,null);assert.equal(g.phase,'heat');
  const punch=g.resolution.find(r=>r.id===puncher.id).shots[0];
  assert.equal(punch.cancelled,first==='push');assert.equal(punch.hit,first==='punch');
  assert.equal(g.phaseRolls[0].kind,first==='push'?pusher.name+' · push':puncher.name+' · punch');
  assert.deepEqual([g.unit(t.id).q,g.unit(t.id).r],[1,0]);
 }
});
test('AGoAC pp.6–7,42: same-side choice groups both punches and leaves opponent initiative priority intact',()=>{
 const {g,puncher,pusher,t}=sameSidePriorityGame();
 const original=g.physicalDeclarations[1];
 g.physicalDeclarations.push({...original,limb:'RA'});
 const enemy={id:t.id,target:pusher.id,type:'punch',limb:'LA',targetNumber:2,damage:5,side:'front',table:'punch'};
 g.physicalDeclarations.push(enemy);g.initiativeWinner=0;
 const ordered=g.physicalOrder(),handled=new Set([enemy]);
 assert.equal(ordered[0],enemy);
 let asked=0;g._resolutionChooser=(request)=>{
  asked++;assert.equal(request.team,0);assert.equal(request.options.length,2);
  assert.equal(request.options.find(o=>o.attackerId===puncher.id).attacks.length,2);
  return String(puncher.id);
 };
 const group=g.nextPhysicalAttacker(ordered,handled);
 assert.deepEqual(group.map(d=>d.limb),['LA','RA']);
 assert(group.every(d=>d.id===puncher.id));assert.equal(asked,1);
 group.forEach(d=>handled.add(d));
 assert.deepEqual(g.nextPhysicalAttacker(ordered,handled).map(d=>d.id),[pusher.id]);
 assert.equal(asked,1,'no choice with only one attacker remaining');
 g.physicalDeclarations=g.physicalDeclarations.filter(d=>d.type!=='push');
 assert.equal(g.nextPhysicalAttacker(g.physicalOrder(),new Set([enemy])).length,2);
 assert.equal(asked,1,'ordinary-only attack order needs no displacement prompt');
});

function weaponPhaseDFAGame(){
 const g=fresh(),[target,ally,attacker,other]=g.units;
 for(const tile of g.tiles)Object.assign(tile,{type:'plain',height:0,depth:0,surface:0});
 Object.assign(attacker,{q:0,r:0,facing:0,tonnage:55,moveMode:'jump',
  airborne:true,charge:{target:target.id,type:'dfa',dir:0,targetPos:{q:1,r:0},startPos:{q:-2,r:0}}});
 Object.assign(target,{q:1,r:0,facing:3});ally.dead=other.dead=true;
 g.phase='fire';g.initiativeWinner=0;g.queue=[];g.activeTeam=null;
 return {g,attacker,target};
}
test('AGoAC pp.27–28,40,44: weapon phase DFA PSR failure lands as an automatic miss, retaining the cause TN',()=>{
 for(const cause of ['damage-fail','damage-pass','unconscious','leg-loss','gyro']){
  const {g,attacker:u,target:t}=weaponPhaseDFAGame();
  const falls=[],impacts=[];let draws=0;
  const fall=g.fall.bind(g);
  g.fall=(unit,levels,tn,side,...rest)=>{
   if(unit===u&&levels===2)falls.push([levels,tn,side,unit.q,unit.r]);
   return fall(unit,levels,tn,side,...rest);
  };
  g.packets=(unit,n,side)=>impacts.push([unit.id,n,side]);
  u.phaseDamage=20;
  if(cause==='unconscious'){u.unconscious=true;u.pilotWounds=1;}
  if(cause==='leg-loss')g.destroyLocation(u,'LL');
  if(cause==='gyro')u.gyroHits=2;
  const expectedTN=u.piloting+g.psrMod(u,true)+1;
  g.rng=()=>{draws++;return cause==='damage-fail'&&draws<=2?0:.99;};
  g.resolveFire();
  if(cause==='damage-pass'){
   assert.equal(u.airborne,true);assert.equal(u.charge.resolved,undefined);
   assert.equal(u.prone,false);assert.equal(falls.length,0);
   assert.deepEqual([u.q,u.r,t.q,t.r],[0,0,1,0]);
   continue;
  }
  assert.equal(u.airborne,false);assert.equal(u.charge.resolved,true);assert.equal(u.prone,true);
  assert.deepEqual([u.q,u.r],[1,0]);
  assert.equal(distance(u,t),1);
  assert.deepEqual(falls,[[2,expectedTN,'rear',1,0]],cause);
  assert.deepEqual(impacts,[[u.id,18,'rear']],cause);
  assert.equal(g.phaseRolls.filter(r=>r.kind===u.name+' · DFA').length,0);
  assert(g.displacementTargetReserved(t.id),'the declared DFA retains its per-turn target reservation');
  g.phase='physical';assert(!g.physicalOrder().some(d=>d.id===u.id&&d.special));
  const before=JSON.stringify({units:g.units,rolls:g.phaseRolls});
  g.resolveSpecial(u);assert.equal(JSON.stringify({units:g.units,rolls:g.phaseRolls}),before);
 }
});
test('AGoAC pp.27–28: weapon phase DFA miss waits for the target controller without repeating the failed PSR',()=>{
 const {g,attacker:u,target:t}=weaponPhaseDFAGame();u.phaseDamage=20;
 let draws=0;g.rng=()=>{draws++;return draws<=2?0:.4;};
 const original=JSON.stringify(g.units);
 const r=g.nextPhaseWithChoices({humanTeams:[0]});assert(r.pending);
 const choice=structuredClone(g.pendingChoice);
 assert.equal(choice.kind,'dfa');assert.equal(choice.team,t.team);
 assert.equal(choice.context.hit,false);assert.equal(draws,2);
 assert.equal(g.phase,'fire');assert.equal(JSON.stringify(g.units),original);
 const selected=choice.options.find(o=>o.q===0&&o.r===0);
 assert(selected,'airborne attacker does not occupy its adjacent hex');
 const done=g.nextPhaseWithChoices({choice:{key:choice.key,option:selected.id}});
 assert(done.ok);assert.equal(g.pendingChoice,null);assert.equal(g.phase,'physical');
 assert.equal(g.unit(u.id).charge.resolved,true);assert.equal(g.unit(u.id).airborne,false);
 assert.equal(g.unit(u.id).prone,true);assert.equal(g.unit(u.id).lastFallSide,'rear');
 assert.deepEqual([g.unit(u.id).q,g.unit(u.id).r],[1,0]);
 assert.deepEqual([g.unit(t.id).q,g.unit(t.id).r],[0,0]);
 assert.equal(g.phaseRolls.filter(r=>r.kind===u.name+' · 20+ урона').length,1);
 assert.equal(g.phaseRolls.filter(r=>r.kind===u.name+' · DFA').length,0);
 assert(!g.physicalOrder().some(d=>d.id===u.id&&d.special));
});

test('AGoAC pp.30,35,44: actual sixth head wound in an attack phase preserves declared return fire and punches until cleanup',()=>{
 for(const phase of ['fire','physical']){
  const g=fresh(),[a,ally,b,enemy]=g.units;
  for(const tile of g.tiles)Object.assign(tile,{type:'plain',height:0,depth:0,surface:0});
  Object.assign(a,{q:0,r:0,facing:0,pilotWounds:5,unconscious:false});
  Object.assign(b,{q:phase==='fire'?4:1,r:0,facing:3});
  g.phase=phase;g.initiativeWinner=0;g.buildQueue();
  const declare=(u,t)=>phase==='fire'?g.declareFire(u.id,[{index:u===a?0:1,target:t.id}]):g.declarePhysical(u.id,t.id,'punch','LA');
  const first=declare(b,a);assert(first.ok,first.error);
  const second=declare(a,b);assert(second.ok,second.error);
  assert(g.hold(enemy.id).ok);assert(g.hold(ally.id).ok);
  assert.equal(g.queue.length,0);
  const initialHead=a.armor.HD,initialBCT=b.armor.CT;
  const dice=[...diceFor(12),...diceFor(12),...(phase==='fire'?[...diceFor(12),...diceFor(7)]:[5.5/6,2.5/6])];
  g.rng=()=>{assert(dice.length,'unexpected die');return dice.shift();};
  const originalDamage=g.damage.bind(g);let lethalObserved=false,returnObserved=false;
  g.damage=(victim,loc,n,opts)=>{
   if(victim===b){
    assert(lethalObserved);assert.equal(a.pilotWounds,6);assert.equal(a.dead,true);
    assert.equal(g.onMap(a),true);assert.equal(g.occupied(a.q,a.r),true);
    returnObserved=true;
   }
   const result=originalDamage(victim,loc,n,opts);
   if(victim===a){
    assert.equal(loc,'HD');assert.equal(a.pilotWounds,6);assert.equal(a.dead,true);
    assert(a.armor.HD<initialHead);assert(a.structure.HD>0);
    assert(g.onMap(a));assert(g.occupied(a.q,a.r));assert(!g.canAct(a));
    lethalObserved=true;
   }
   return result;
  };
  assert(g.nextPhase().ok);
  assert(lethalObserved&&returnObserved);assert.equal(dice.length,0);
  assert.equal(g.resolution.length,2);assert(g.resolution.every(r=>r.shots[0].hit));
  assert.equal(g.resolution[1].id,a.id);assert(b.armor.CT<initialBCT);
  assert.equal(g.onMap(a),false);assert.equal(g.occupied(a.q,a.r),false);
  assert.equal(g.unit(a.id),a);assert.equal(a.pilotWounds,6);
  assert.equal(g.phase,phase==='fire'?'physical':'heat');assert(!g.canAct(a));
 }
});
test('AGoAC pp.30,42,44: lethal immediate fall invalidates an unmade physical attack against the fallen Mech',()=>{
 const g=fresh(),[pusher,kicker,t,other]=g.units;
 for(const tile of g.tiles)Object.assign(tile,{type:'plain',height:0,depth:0,surface:0});
 Object.assign(pusher,{q:-1,r:0,facing:0});
 Object.assign(kicker,{q:1,r:-1,facing:4});
 Object.assign(t,{q:0,r:0,facing:3,pilotWounds:5,unconscious:false});
 g.phase='physical';g.initiativeWinner=1;g.queue=[];g.activeTeam=null;
 const push=g.physicalPreview(pusher.id,t.id,'push','LA'),kick=g.physicalPreview(kicker.id,t.id,'kick','RL');
 assert(push.legal,push.reason);assert(kick.legal,kick.reason);
 g.physicalDeclarations=[{id:pusher.id,target:t.id,type:'push',limb:'LA',...push},{id:kicker.id,target:t.id,type:'kick',limb:'RL',...kick}];
 const dice=[...diceFor(12),...diceFor(2),.5/6,...diceFor(2)];
 g.rng=()=>{assert(dice.length,'an invalidated kick should not roll');return dice.shift();};
 const originalWound=g.wound.bind(g);let deathObserved=false;
 g.wound=(victim,n)=>{
  originalWound(victim,n);
  if(victim===t&&t.dead){
   assert.equal(t.pilotWounds,6);assert.equal(g.onMap(t),true);
   assert.equal(g.occupied(t.q,t.r),true);assert.deepEqual([t.q,t.r],[1,0]);
   deathObserved=true;
  }
 };
 assert(g.nextPhase().ok);assert(deathObserved);assert.equal(dice.length,0);
 const shot=g.resolution.find(r=>r.id===kicker.id).shots[0];
 assert.equal(shot.cancelled,true);assert.equal(shot.roll,null);assert.equal(shot.damage,0);
 assert.equal(g.onMap(t),false);assert.equal(g.occupied(1,0),false);
 assert.equal(g.phase,'heat');assert.equal(other.dead,false);
});

function standardSetupGame(edge=0,winner=0){
 const g=fresh();
 for(const tile of g.tiles)Object.assign(tile,{type:'plain',height:0,depth:0,surface:0});
 assert(g.startStandardDeployment().ok);
 const dice=[...diceFor(7),...diceFor(7),...diceFor(winner===0?12:2),...diceFor(winner===0?2:12)];
 g.rng=()=>{assert(dice.length);return dice.shift();};
 assert(g.nextPhaseWithChoices({humanTeams:[0,1]}).pending);
 const request=g.pendingChoice;
 assert.equal(request.kind,'deployment-edge');assert.equal(request.team,winner);
 assert.equal(request.options.length,6);assert.equal(dice.length,0);
 assert(g.nextPhaseWithChoices({choice:{key:request.key,option:String(edge)}}).ok);
 assert.equal(g.phase,'initiative');
 assert.equal(g.deployment.edges[winner],edge);
 assert.equal(g.deployment.edges[1-winner],(edge+3)%6);
 assert(g.units.every(u=>!g.onMap(u)));
 assert.equal(g.phaseRolls.length,4);
 const turnDice=[...diceFor(12),...diceFor(2)];
 g.rng=()=>{assert(turnDice.length);return turnDice.shift();};
 assert(g.nextPhase().ok);assert.equal(g.phase,'move');assert.equal(turnDice.length,0);
 assert.equal(g.initiativeWinner,0);return g;
}
test('AGoAC p.6: setup roll, all six opposite edges, separate turn initiative and no phantom occupants',()=>{
 for(const winner of [0,1])for(let edge=0;edge<6;edge++){
  const g=standardSetupGame(edge,winner),a=g.deploymentEdgeTiles(edge),b=g.deploymentEdgeTiles((edge+3)%6);
  assert.equal(a.length,7);assert.equal(b.length,7);assert(a.every(t=>!b.includes(t)));
  const [dq,dr]=DIRS[edge];assert(a.every(t=>!g.tile(t.q-dq,t.r-dr)));
  assert(g.units.every(u=>!g.occupied(u.q,u.r)));
  const active=g.units.find(u=>g.canAct(u)),legal=g.reachable(active,'walk');
  assert(legal.length>0);assert(legal.every(p=>g.deploymentEdgeTiles(g.deployment.edges[active.team]).some(t=>t.q===p.q&&t.r===p.r)));
  assert.equal(g.hold(active.id).ok,false);assert.equal(g.move(active.id,0,0,'walk').ok,false);
 }
 const normal=fresh();assert.equal(normal.phase,'initiative');assert(normal.units.every(u=>normal.onMap(u)));
});
test('AGoAC pp.6,8–12: walk and run charge first full hex terrain cost, then continue with remaining MP',()=>{
 for(const mode of ['walk','run']){
  const g=standardSetupGame(0),u=g.units.find(x=>g.canAct(x)),route=g.reachable(u,mode).find(p=>p.r===0);assert(route);
  g.tile(route.q,route.r).type='woods';
  assert.equal(g.reachable(u,mode).find(p=>p.q===route.q&&p.r===route.r).cost,2);
  const initial=g.mp(u,mode);
  assert(g.move(u.id,route.q,route.r,mode).ok);assert(g.onMap(u));assert.equal(u.spent,2);assert.equal(u.distanceMoved,1);
  assert(g.reachable(u,mode).every(p=>p.cost<=initial-2));
  const [dq,dr]=DIRS[u.facing];assert(g.move(u.id,u.q+dq,u.r+dr,mode).ok);
  assert.equal(u.spent,3);assert.equal(u.distanceMoved,2);assert(g.hold(u.id).ok);assert.equal(u.pendingHeat,mode==='walk'?1:2);
 }
});
test('AGoAC pp.6,8,11–12: jumping entry counts the first full hex, consumes jump MP and excludes occupied landings',()=>{
 const g=standardSetupGame(0),u=g.units.find(x=>g.canAct(x)),options=g.reachable(u,'jump');assert(options.length>7);
 assert(options.some(p=>p.cost===1));assert(options.some(p=>p.cost===g.mp(u,'jump')));
 const route=options.find(p=>p.cost===3);assert(route);
 const other=g.units.find(x=>x.id!==u.id);Object.assign(other,{deployed:true,q:route.q,r:route.r});
 assert(!g.reachable(u,'jump').some(p=>p.q===route.q&&p.r===route.r));other.deployed=false;
 assert(g.move(u.id,route.q,route.r,'jump').ok);assert(g.onMap(u));assert.equal(u.spent,3);assert.equal(u.distanceMoved,3);
 assert.equal(u.pendingHeat,3);assert.equal(g.reachable(u,'jump').length,0);assert(g.hold(u.id).ok);
});

// AGoAC pp.6,9–11: minimum movement is a single forward running step;
 // a truly blocked entry is an unresolved scenario, not automatic destruction.
test('AGoAC pp.6,11: minimum entry into water spends the movement action and running heat',()=>{
 const g=standardSetupGame(0),u=g.units.find(x=>g.canAct(x));
 g.rng=()=>.99;
 const edge=g.deployment.edges[u.team],t=g.deploymentEdgeTiles(edge)[0];
 Object.assign(t,{type:'water',depth:1,surface:0,height:-1});
 assert(!g.reachable(u,'run').some(p=>p.q===t.q&&p.r===t.r));
 assert(g.reachable(u,'minimum').some(p=>p.q===t.q&&p.r===t.r));
 const total=g.mp(u,'run'),result=g.move(u.id,t.q,t.r,'minimum');
 assert(result.ok);assert(result.ended);assert.equal(result.mode,'run');
 assert(u.deployed);assert(u.moved);assert.equal(u.spent,total);
 assert.equal(u.distanceMoved,1);assert.equal(u.pendingHeat,2);
 assert.equal(g.rotate(u.id,1).ok,false);
});
test('AGoAC pp.6,9: ground entry rejects excessive descent, blocked AI never fabricates a move or death',()=>{
 const g=standardSetupGame(0),u=g.units.find(x=>g.canAct(x));
 g.rng=()=>.99;
 for(const t of g.deploymentEdgeTiles(g.deployment.edges[u.team])){
  Object.assign(t,{type:'water',depth:3,surface:0,height:-3});
 }
 u.jump=0;
 assert.equal(g.deploymentOptions(u).length,0);
 assert.equal(g.hold(u.id).ok,false);
 const other=g.units.find(x=>x!==u&&x.team===u.team);
 other.jump=3;other.jumpLost=0;
 assert(g.deploymentOptions(other).length>0);
 assert.equal(g.aiSelection().id,other.id);
 const before=JSON.stringify(u),result=g.aiMove(u.id);
 assert.equal(result.code,'deployment_blocked');assert.equal(JSON.stringify(u),before);
 assert.equal(g.winner,null);assert(!u.dead);assert.equal(u.deployed,false);
});

test('AGoAC p.6: undeployed mechs cannot be targets or phantom displacement occupants',()=>{
 const g=standardSetupGame(0),u=g.units[0],t=g.units[2];
 Object.assign(u,{deployed:true,q:0,r:0,facing:0});
 Object.assign(t,{deployed:false,q:1,r:0,facing:3});
 assert.equal(g.preview(u.id,t.id,0).legal,false);
 assert.equal(g.preview(t.id,u.id,0).legal,false);
 assert.equal(g.physicalPreview(u.id,t.id,'kick','RL').legal,false);
 assert.equal(g.physicalPreview(t.id,u.id,'kick','RL').legal,false);
 const before=JSON.stringify(t);
 g.rng=()=>{throw Error('An undeployed unit cannot trigger domino dice');};
 assert(g.displace(u,0));
 assert.deepEqual([u.q,u.r],[1,0]);assert.equal(JSON.stringify(t),before);
 assert.equal(g.onMap(t),false);
});

test('AGoAC pp.6,21,30: independent controller choices for to-hit and damage order replay without rerolling',()=>{
 const g=fresh(),u=g.units[0],t=g.units[2];
 g.phase='fire';g.queue=[];g.activeTeam=null;g.initiativeWinner=1;
 const shot=(index,name)=>({index,target:t.id,bin:null,aim:null,heatMode:false,
  weapon:{name,rack:0,ammo:null,heat:1,damage:1,location:'RA'},
  preview:{targetNumber:2,side:'front',cover:false,underwaterCover:false}});
 g.declarations=[{id:u.id,shots:[shot(0,'First gun'),shot(1,'Second gun')]}];
 let draws=0;g.rng=()=>{draws++;return .5;};
 assert(g.nextPhaseWithChoices({humanTeams:[0]}).pending);
 let pending=g.pendingChoice;
 assert.equal(pending.kind,'fire-roll-weapon');assert.equal(draws,0);
 assert.deepEqual(pending.options.map(o=>o.id),['0','1']);
 assert(g.nextPhaseWithChoices({choice:{key:pending.key,option:'1'}}).pending);
 pending=g.pendingChoice;
 assert.equal(pending.kind,'fire-damage-weapon');assert.equal(draws,4);
 assert.deepEqual(pending.options.map(o=>o.id),['1','0']);
 assert(pending.options.every(o=>o.roll===8));
 const before=g.units[2].armor.CT;
 assert.equal(g.nextPhaseWithChoices({choice:{key:pending.key,option:'forged'}}).ok,false);
 assert.equal(draws,4);assert.equal(g.units[2].armor.CT,before);
 assert(g.nextPhaseWithChoices({choice:{key:pending.key,option:'0'}}).ok);
 assert.equal(g.pendingChoice,null);assert.equal(g.phase,'physical');assert.equal(draws,8);
 assert.deepEqual(g.phaseRolls.slice(0,2).map(o=>o.kind),[u.name+' · Second gun',u.name+' · First gun']);
 assert.deepEqual(g.resolution.map(o=>o.shots[0].index),[0,1]);
});
test('AGoAC p.21: attack and damage order remain grouped by target',()=>{
 const g=fresh(),u=g.units[0],a=g.units[2],b=g.units[3];
 const shots=[{index:0,target:a.id,weapon:{name:'A'}},{index:1,target:b.id,weapon:{name:'B'}},
  {index:2,target:a.id,weapon:{name:'C'}}];
 const visited=[];
 g._resolutionChooser=(request,fallback)=>request.kind==='fire-roll-target'?String(b.id):fallback;
 g.orderFireStage(u,shots,'roll',s=>visited.push([s.target,s.index]));
 assert.deepEqual(visited,[[b.id,1],[a.id,0],[a.id,2]]);
});

test('AGoAC pp.6,30: controller chooses Mech order independently while preserving team slots',()=>{
 const g=fresh(),[a,b,c,d]=g.units;
 g.phase='fire';g.queue=[];g.activeTeam=null;g.initiativeWinner=1;
 const shot=(target,name)=>({index:0,target:target.id,bin:null,aim:null,heatMode:false,
  weapon:{name,rack:0,ammo:null,heat:1,damage:1,location:'RA'},
  preview:{targetNumber:2,side:'front',cover:false,underwaterCover:false}});
 g.declarations=[{id:a.id,shots:[shot(c,'A')]},{id:c.id,shots:[shot(a,'C')]},
  {id:b.id,shots:[shot(d,'B')]},{id:d.id,shots:[shot(b,'D')]}];
 let draws=0;g.rng=()=>{draws++;return .5;};
 assert(g.nextPhaseWithChoices({humanTeams:[0]}).pending);
 let pending=g.pendingChoice;
 assert.equal(pending.kind,'fire-roll-mech');assert.equal(draws,0);
 assert.deepEqual(pending.options.map(o=>o.attackerId),[a.id,b.id]);
 assert(g.nextPhaseWithChoices({choice:{key:pending.key,option:String(b.id)}}).pending);
 pending=g.pendingChoice;
 assert.equal(pending.kind,'fire-damage-mech');assert.equal(draws,8);
 assert.deepEqual(pending.options.map(o=>o.attackerId),[a.id,b.id]);
 assert(g.nextPhaseWithChoices({choice:{key:pending.key,option:String(a.id)}}).ok);
 assert.equal(g.phase,'physical');assert.equal(draws,16);
 assert.deepEqual(g.phaseRolls.slice(0,4).map(r=>r.kind),
  [b.name+' · B',c.name+' · C',a.name+' · A',d.name+' · D']);
 assert.deepEqual(g.resolution.map(o=>o.id),[a.id,c.id,b.id,d.id]);
});

test('AGoAC p.38: controller selects tied hottest ammo bin without repeating the failed heat roll',()=>{
 const g=fresh(),u=g.units[0];
 g.phase='heat';g.queue=[];g.activeTeam=null;
 for(const tile of g.tiles)Object.assign(tile,{type:'plain',depth:0,height:0,surface:0});
 const base=u.bins[0],other=base.location==='LT'?'RT':'LT';
 u.bins=[{...base,shots:1},{...base,location:other,slot:11,shots:5}];
 u.prone=true;u.shutdown=true;u.voluntaryShutdown=true;u.heat=19+u.sinks;u.pendingHeat=0;
 let draws=0;g.rng=()=>{draws++;return draws<=2?0:.4;};
 assert(g.nextPhaseWithChoices({humanTeams:[0]}).pending);
 const pending=g.pendingChoice;assert.equal(pending.kind,'heat-ammo-bin');
 assert.equal(draws,2);assert.equal(pending.context.heat,19);
 assert.deepEqual(pending.options.map(o=>[o.id,o.shots]),[['0',1],['1',5]]);
 assert.equal(u.bins[0].shots,1);assert.equal(u.bins[1].shots,5);
 assert.equal(g.nextPhaseWithChoices({choice:{key:pending.key,option:'forged'}}).ok,false);
 assert.equal(draws,2);
 assert(g.nextPhaseWithChoices({choice:{key:pending.key,option:'0'}}).ok);
 const resolved=g.units[0];
 assert.equal(g.phase,'end');assert.equal(g.pendingChoice,null);
 assert.equal(resolved.bins[0].destroyed,true);assert.equal(resolved.bins[0].shots,0);
 assert.equal(resolved.bins[1].shots,5);
 assert.equal(g.phaseRolls.filter(r=>r.kind.includes('Перегрев боезапаса')).length,1);
 assert.equal(resolved.pilotWounds,2);
});
test('AGoAC p.38: only maximum damage per shot enters the heat explosion tie',()=>{
 const g=fresh(),u=g.units[0],base=u.bins[0];
 u.weapons=[{name:'SRM 6',damage:2,rack:6},{name:'LRM 15',damage:1,rack:15},
  {name:'AC/15 fixture',damage:15,rack:0}];
 u.bins=[{...base,weapon:0,shots:100},{...base,weapon:1,shots:1},{...base,weapon:2,shots:2}];
 g._resolutionChooser=(request,fallback)=>{
  assert.deepEqual(request.options.map(o=>o.id),['1','2']);
  assert(request.options.every(o=>o.damagePerShot===15));return '1';
 };
 assert.equal(g.heatExplosionBin(u,u.bins),u.bins[1]);
});

test('AGoAC p.7: last surviving force wins at the movement phase boundary',()=>{
 for(const winner of [0,1,'draw']){
  const g=fresh();g.phase='move';g.queue=[];g.activeTeam=null;
  for(const u of g.units)if(winner==='draw'||u.team!==winner)g.destroyMech(u);
  assert.equal(g.winner,null);
  assert(g.nextPhase().ok);assert.equal(g.winner,winner);
  assert.equal(g.queue.length,0);
  assert(g.units.filter(u=>u.dead).every(u=>!g.onMap(u)));
 }
});
test('AGoAC p.7: permanent mutual inability to move or deal damage produces a draw',()=>{
 const g=fresh();g.phase='end';g.queue=[];g.activeTeam=null;
 for(const u of g.units){
  for(const limb of ['LA','RA','LL','RL'])u.structure[limb]=0;
  for(const w of u.weapons)w.destroyed=true;
  u.heat=0;u.pendingHeat=0;
 }
 assert(g.nextPhase().ok);assert.equal(g.winner,'draw');
 assert(g.log.some(l=>l.includes('не может двигаться')));
});
test('AGoAC p.7: temporary shutdown, heat and unconsciousness cannot cause a false stalemate',()=>{
 for(const disabled of ['shutdown','unconscious','heat']){
  const g=fresh();g.phase='end';
  for(const u of g.units){
   for(const w of u.weapons)w.destroyed=true;
   if(disabled==='heat')u.heat=30;
   else u[disabled]=true;
  }
  g.checkWin({stalemate:true});assert.equal(g.winner,null,disabled);
 }
});
test('AGoAC p.7: stationary Mechs with a surviving in-range weapon are not a stalemate',()=>{
 const g=fresh(),u=g.units[0],target=g.units[2];
 for(const x of g.units){
  for(const limb of ['LA','RA','LL','RL'])x.structure[limb]=0;
  for(const w of x.weapons)w.destroyed=true;
 }
 Object.assign(u,{q:0,r:0});Object.assign(target,{q:1,r:0});
 Object.assign(u.weapons[0],{destroyed:false,location:'CT',locations:['CT'],ammo:null,ranges:[3,6,9]});
 g.checkWin({stalemate:true});assert.equal(g.winner,null);
 u.weapons[0].destroyed=true;
 g.checkWin({stalemate:true});assert.equal(g.winner,'draw');
});
test('AGoAC p.7: unresolved offboard deployment is not a stalemate',()=>{
 const g=fresh();assert(g.startStandardDeployment().ok);
 for(const u of g.units)u.abandoned=true;
 g.checkWin({stalemate:true});assert.equal(g.winner,null);
});

test('AGoAC pp.6,9,11: ground deployment may pass through a friendly occupied entry hex',()=>{
 for(const mode of ['walk','run']){
  const g=standardSetupGame(0),u=g.units.find(x=>g.canAct(x));
  const ally=g.units.find(x=>x!==u&&x.team===u.team),first=g.deploymentEdgeTiles(g.deployment.edges[u.team]).find(t=>t.r===0);
  assert(first);const [dq,dr]=DIRS[g.deployment.edges[u.team]],q=first.q+dq,r=first.r+dr;
  Object.assign(ally,{q:first.q,r:first.r,deployed:true,prone:true});
  assert(!g.reachable(u,mode).some(p=>p.q===first.q&&p.r===first.r));
  const route=g.reachable(u,mode).find(p=>p.q===q&&p.r===r);
  assert(route?.transit);assert.equal(route.cost,2);
  const before=JSON.stringify(ally),result=g.move(u.id,q,r,mode);
  assert(result.ok);assert(result.entry);assert.deepEqual(result.path,[{q:first.q,r:first.r},{q,r}]);
  assert.deepEqual([u.q,u.r,u.spent,u.distanceMoved],[q,r,2,2]);
  assert.equal(JSON.stringify(ally),before);
  assert(g.hold(u.id).ok);assert.equal(u.pendingHeat,mode==='walk'?1:2);
 }
});
test('AGoAC pp.6,9: occupied enemy entry and insufficient transit MP cannot be bypassed',()=>{
 const g=standardSetupGame(0),u=g.units.find(x=>g.canAct(x));
 const enemy=g.units.find(x=>x.team!==u.team),ally=g.units.find(x=>x!==u&&x.team===u.team);
 const first=g.deploymentEdgeTiles(g.deployment.edges[u.team]).find(t=>t.r===0);
 const [dq,dr]=DIRS[g.deployment.edges[u.team]],q=first.q+dq,r=first.r+dr;
 Object.assign(enemy,{q:first.q,r:first.r,deployed:true});
 assert(!g.reachable(u,'walk').some(p=>p.q===q&&p.r===r));
 enemy.deployed=false;Object.assign(ally,{q:first.q,r:first.r,deployed:true});
 u.walk=1;
 assert(!g.reachable(u,'walk').some(p=>p.q===q&&p.r===r));
 assert.equal(g.move(u.id,q,r,'walk').ok,false);assert.equal(u.deployed,false);
});

test('AGoAC pp.11–12: jumping can use any legal shortest path but not a longer detour',()=>{
 const g=fresh(),u=g.units[0],ally=g.units[1];
 g.phase='move';g.queue=[0,1,0,1];g.activeTeam=0;
 for(const t of g.tiles)Object.assign(t,{type:'plain',height:0,surface:0,depth:0});
 Object.assign(u,{q:0,r:0,moveStart:{q:0,r:0},jump:2,jumpLost:0,spent:0,proneAtStart:false});
 Object.assign(ally,{q:0,r:1});const a=g.tile(1,0),b=g.tile(0,1),target=g.tile(1,1);
 Object.assign(a,{height:3,surface:3});
 assert.equal(g.jumpClear(u,target,2),true);
 assert(g.reachable(u,'jump').some(t=>t.q===1&&t.r===1&&t.cost===2));
 assert(!g.reachable(u,'jump').some(t=>t.q===0&&t.r===1));
 Object.assign(b,{height:3,surface:3});assert.equal(g.jumpClear(u,target,2),false);
 assert(!g.reachable(u,'jump').some(t=>t.q===1&&t.r===1));
 Object.assign(a,{height:5,surface:5});Object.assign(b,{height:5,surface:5});
 assert.equal(g.jumpClear(u,target,4),false,'longer route does not legalize a shortest-path obstruction');
 Object.assign(b,{height:1,surface:1,type:'heavy'});assert.equal(g.jumpClear(u,target,2),true);
 const result=g.move(u.id,1,1,'jump');assert(result.ok);assert.equal(u.spent,2);
 assert.equal(u.distanceMoved,2);assert.equal(u.pendingHeat,3);
});
test('AGoAC p.12: voluntary prone posture costs exactly one ground MP, without extra heat or damage',()=>{
 for(const mode of ['walk','run']){
  const g=fresh(),u=g.units[0];g.phase='move';g.queue=[0,1];g.activeTeam=0;
  const before=JSON.stringify(u.armor),facing=u.facing;
  assert(g.drop(u.id,{mode}).ok);assert.equal(u.spent,1);assert.equal(u.moveMode,mode);
  assert.equal(u.pendingHeat,0);assert.equal(u.prone,true);assert.equal(u.facing,facing);
  assert.equal(JSON.stringify(u.armor),before);assert.equal(g.phaseRolls.length,0);
  assert(g.hold(u.id).ok);assert.equal(u.pendingHeat,mode==='walk'?1:2);
 }
});
test('AGoAC p.12: voluntary drop is rejected after a jump, without MP, or outside movement',()=>{
 for(const why of ['jump','zero-mp','fire','mode-change']){
  const g=fresh(),u=g.units[0];g.phase='move';g.activeTeam=0;g.queue=[0,1];
  if(why==='jump'){u.moveMode='jump';u.spent=1;}
  if(why==='zero-mp'){u.moveMode='walk';u.spent=g.mp(u,'walk');}
  if(why==='fire')g.phase='fire';
  if(why==='mode-change')u.moveMode='run';
  const before=JSON.stringify(u);assert.equal(g.drop(u.id,{mode:'walk'}).ok,false);
  assert.equal(JSON.stringify(u),before,why);
 }
});

test('AGoAC pp.9,11,40,42: hazardous friendly entry checks terrain before continuing or displacing',()=>{
 for(const hazard of ['rubble','water'])for(const pass of [true,false]){
  const g=standardSetupGame(0),u=g.units.find(x=>g.canAct(x));
  const ally=g.units.find(x=>x!==u&&x.team===u.team);
  const first=g.deploymentEdgeTiles(g.deployment.edges[u.team]).find(t=>t.r===0);
  const [dq,dr]=DIRS[g.deployment.edges[u.team]],q=first.q+dq,r=first.r+dr;
  Object.assign(first,{type:hazard,depth:hazard==='water'?1:0,height:hazard==='water'?-1:0,surface:0});
  Object.assign(ally,{q:first.q,r:first.r,deployed:true,prone:false});
  u.walk=6;let draws=0;g.rng=()=>{draws++;return !pass&&draws<=2?0:.5;};
  const route=g.reachable(u,'walk').find(p=>p.q===q&&p.r===r);
  assert(route?.transit);assert.equal(route.cost,hazard==='water'?5:3);
  const result=g.move(u.id,q,r,'walk');assert(result.ok);assert(result.entry);
  assert(result.rolls[0].kind.includes(hazard==='water'?'Вода':'Обломки'));
  if(pass){
   assert.deepEqual(result.path,[{q:first.q,r:first.r},{q,r}]);
   assert.deepEqual([u.q,u.r,u.spent,u.distanceMoved],[q,r,route.cost,2]);
   assert.deepEqual([ally.q,ally.r],[first.q,first.r]);
  }else{
   assert.equal(u.prone,true);assert.equal(u.distanceMoved,1);
   assert.deepEqual([u.q,u.r],[first.q,first.r]);
   assert.deepEqual([ally.q,ally.r],[q,r]);
   assert(result.rolls.some(x=>x.kind.includes('Домино')));
  }
  assert.notDeepEqual([u.q,u.r],[ally.q,ally.r]);
 }
});
test('AGoAC p.9: normal ground movement may pass through a prone friendly Mech but not stop on it',()=>{
 const g=fresh(),u=g.units[0],ally=g.units[1];
 g.phase='move';g.queue=[0,1];g.activeTeam=0;
 for(const t of g.tiles)Object.assign(t,{type:'plain',height:0,surface:0,depth:0});
 Object.assign(u,{q:0,r:0,facing:0,walk:4});Object.assign(ally,{q:1,r:0,prone:true});
 for(const v of g.units.filter(v=>v.team!==u.team))v.dead=true;
 const options=g.reachable(u,'walk');
 assert(!options.some(t=>t.q===1&&t.r===0));
 const dest=options.find(t=>t.q===2&&t.r===0);assert.equal(dest.cost,2);
 assert(g.move(u.id,2,0,'walk').ok);assert.equal(u.distanceMoved,2);
 assert.deepEqual([ally.q,ally.r],[1,0]);
});

test('AGoAC p.42: movement domino dodge pauses, survives recovery and reuses its dice',()=>{
 const g=fresh(),u=g.units[0],ally=g.units[1];
 g.phase='move';g.queue=[0,1,0,1];g.activeTeam=0;
 for(const t of g.tiles)Object.assign(t,{type:'plain',depth:0,height:0,surface:0});
 Object.assign(u,{q:0,r:0,facing:0,walk:5,moveStart:{q:0,r:0}});
 Object.assign(ally,{q:1,r:0,facing:1,walk:4,spent:0});
 for(const v of g.units.filter(v=>v.team!==u.team))v.dead=true;
 g.tile(1,0).type='rubble';
 let draws=0;g.rng=()=>{draws++;return draws<=2?0:.5;};
 const before=JSON.stringify(g.units);
 let result=g.moveWithChoices(u.id,2,0,'walk',{humanTeams:[0]});
 assert(result.pending);assert.equal(g.pendingChoice.scope,'movement');
 assert.equal(g.pendingChoice.kind,'domino');assert.equal(g.pendingChoice.unitId,ally.id);
 assert.equal(JSON.stringify(g.units),before);
 const saved=draws,p=structuredClone(g.pendingChoice);
 assert(p.options.some(o=>o.id==='forward'));
 assert.equal(g.moveWithChoices(u.id,2,0,'walk').ok,false);
 assert.equal(g.nextPhaseWithChoices({choice:{key:p.key,option:'invalid'}}).ok,false);
 assert.equal(draws,saved);
 const restored=new Game({rng:()=>{draws++;return .5;}});
 Object.assign(restored,JSON.parse(JSON.stringify(g,(k,v)=>['map','rng'].includes(k)?undefined:v)));
 restored.rebuildMap();
 result=restored.nextPhaseWithChoices({choice:{key:p.key,option:'forward'}});
 assert(result.ok&&!result.pending);
 assert.equal(draws,saved);
 assert.equal(restored.pendingChoice,null);assert.equal(restored.phase,'move');
 assert.deepEqual([restored.unit(u.id).q,restored.unit(u.id).r],[1,0]);
 assert.deepEqual([restored.unit(ally.id).q,restored.unit(ally.id).r],[2,-1]);
 assert.equal(restored.unit(ally.id).spent,1);
 assert.equal(restored.unit(u.id).prone,true);
 assert.deepEqual(restored.queue,[0,1,0,1]);
});


test('AGoAC p.7: permanent stalemate distinguishes usable ammunition and maximum range',()=>{
 for(const condition of ['loaded','empty','destroyed-bin','out-of-range']){
  const g=fresh(),u=g.units[0],target=g.units[2];
  for(const x of g.units){
   for(const limb of ['LA','RA','LL','RL'])x.structure[limb]=0;
   for(const w of x.weapons)w.destroyed=true;
  }
  Object.assign(u,{q:0,r:0,sensorHits:0});
  for(const x of g.units.filter(x=>x.team!==u.team))Object.assign(x,{q:condition==='out-of-range'?4:3,r:0});
  Object.assign(u.weapons[0],{destroyed:false,location:'CT',locations:['CT'],ammo:1,shared:0,ranges:[1,2,3]});
  u.bins=[{weapon:0,location:'CT',shots:condition==='empty'?0:1,destroyed:condition==='destroyed-bin'}];
  assert.equal(g.canEverDamage(u,[target]),condition==='loaded',condition);
  g.checkWin({stalemate:true});
  assert.equal(g.winner,condition==='loaded'?null:'draw',condition);
 }
});

 test('AGoAC pp.7,12: prone Mechs with no ground MP cannot escape by jumping',()=>{
 const g=fresh(),u=g.units[0];
 Object.assign(g.tile(u.q,u.r),{type:'plain',height:0,surface:0,depth:0});
 Object.assign(u,{walk:0,jump:3,jumpLost:0,heat:0,prone:true});
 assert.equal(g.mp(u,'walk'),0);assert(g.mp(u,'jump')>0);
 assert.equal(g.canEverMove(u),false);
 u.prone=false;assert.equal(g.canEverMove(u),true);
 u.prone=true;u.walk=1;assert.equal(g.canEverMove(u),true);
 });

test('AGoAC p.42: AI movement pauses for a human domino victim and resumes the same AI selection',()=>{
 // Pin the AI's chosen route; the actual movement, domino and replay
 // use the shared engine, including the AI's automatic hold.
 class RouteAI extends Game{
  aiMove(id){const r=this.move(id,2,-1,'walk');if(r.ok)this.hold(id);return r;}
 }
 const g=new RouteAI({rng:()=>.5}),[human,other,ai,ally]=g.units;
 g.phase='move';g.queue=[1,0,1,0];g.activeTeam=1;
 for(const t of g.tiles)Object.assign(t,{type:'plain',depth:0,height:0,surface:0});
 Object.assign(ai,{q:0,r:0,facing:0,walk:6,moveStart:{q:0,r:0}});
 Object.assign(ally,{q:1,r:0,facing:0,walk:4,spent:0});
 Object.assign(human,{q:2,r:0,facing:1,walk:4,spent:0});
 Object.assign(other,{q:-4,r:0});g.tile(1,0).type='rubble';
 // Force the AI's route to transit the allied rubble hex first.
 g.tile(1,-1).height=g.tile(1,-1).surface=4;
 let draws=0;g.rng=()=>{draws++;return draws<=2?0:.5;};
 const before=JSON.stringify(g.units);
 const r=g.aiMoveWithChoices(ai.id,{humanTeams:[0]});
 assert(r.pending);assert.equal(g.pendingChoice.unitId,human.id);
 assert.equal(g.pendingChoice.kind,'domino');assert.equal(JSON.stringify(g.units),before);
 const p=g.pendingChoice;assert(p.options.some(o=>o.id==='forward'));
 const saved=draws,restored=new RouteAI({rng:()=>{draws++;return .5;}});
 Object.assign(restored,JSON.parse(JSON.stringify(g,(k,v)=>['map','rng'].includes(k)?undefined:v)));
 restored.rebuildMap();
 const result=restored.nextPhaseWithChoices({choice:{key:p.key,option:'forward'}});
 assert(result.ok&&!result.pending);assert.equal(draws,saved);
 assert.deepEqual(restored.queue,[0,1,0]);assert.equal(restored.unit(ai.id).moved,true);
 assert.deepEqual([restored.unit(human.id).q,restored.unit(human.id).r],[3,-1]);
 assert.deepEqual([restored.unit(ally.id).q,restored.unit(ally.id).r],[2,0]);
});
test('AGoAC pp.26,42: interrupted charge approach cannot declare a phantom attack',()=>{
 const g=fresh(),[u,ally,t,other]=g.units;
 g.phase='move';g.activeTeam=0;g.initiativeWinner=0;g.queue=[0,1,0];
 for(const hex of g.tiles)Object.assign(hex,{type:'plain',depth:0,height:0,surface:0});
 Object.assign(u,{q:0,r:0,facing:0,walk:4,moveStart:{q:0,r:0}});
 Object.assign(ally,{q:1,r:0,facing:1,walk:4,spent:0});
 Object.assign(t,{q:3,r:0,moved:true});Object.assign(other,{q:-4,r:0});
 g.tile(1,0).type='rubble';let draws=0;g.rng=()=>{draws++;return draws<=2?0:.5;};
 const before=JSON.stringify(g.units);
 const r=g.chargeWithChoices(u.id,t.id,'charge',{humanTeams:[0]});
 assert(r.pending);assert.equal(g.pendingChoice.kind,'domino');
 assert.equal(JSON.stringify(g.units),before);
 const p=g.pendingChoice,choice=p.options.find(o=>o.id==='forward');
 assert(choice);const result=g.nextPhaseWithChoices({choice:{key:p.key,option:choice.id}});
 assert(result.ok&&result.chargeInterrupted);assert.equal(g.unit(u.id).charge,null);
 assert.equal(g.unit(u.id).prone,true);assert.equal(g.unit(u.id).moved,true);
 assert.deepEqual([g.unit(u.id).q,g.unit(u.id).r],[1,0]);assert.deepEqual(g.queue,[1,0]);
});

test('AGoAC pp.9,11: minimum movement cannot bypass phase, declared mode or ammunition restrictions',()=>{
 for(const cause of ['fire','physical','walk','jump','dumping','dumpNext','spent']){
  const g=fresh(),u=g.units[0];g.phase='move';g.activeTeam=0;g.queue=[0,1];
  Object.assign(u,{q:0,r:0,facing:0,walk:5});
  Object.assign(g.tile(0,0),{type:'plain',depth:0,height:0,surface:0});
  Object.assign(g.tile(1,0),{type:'plain',depth:0,height:0,surface:0});
  if(cause==='fire'||cause==='physical')g.phase=cause;
  if(cause==='walk'||cause==='jump')u.moveMode=cause;
  if(cause==='dumping'||cause==='dumpNext')u[cause]=[0];
  if(cause==='spent')u.spent=1;
  const before=JSON.stringify(u),queue=[...g.queue];
  assert.equal(g.minimumMove(u.id).ok,false,cause);
  assert.equal(JSON.stringify(u),before);assert.deepEqual(g.queue,queue);
 }
});
test('AGoAC pp.6,11: one remaining walking MP permits minimum entry without ordinary running',()=>{
 const g=standardSetupGame(0),u=g.units.find(x=>g.canAct(x));
 g.rng=()=>.5;u.structure.LL=0;
 const t=g.deploymentEdgeTiles(g.deployment.edges[u.team])[0];
 Object.assign(t,{type:'heavy',depth:0,height:0,surface:0});
 assert.equal(g.mp(u,'walk'),1);assert.equal(g.mp(u,'run'),0);
 assert(!g.reachable(u,'walk').some(p=>p.q===t.q&&p.r===t.r));
 assert(!g.reachable(u,'run').some(p=>p.q===t.q&&p.r===t.r));
 assert(g.reachable(u,'minimum').some(p=>p.q===t.q&&p.r===t.r&&p.cost===1));
 const result=g.move(u.id,t.q,t.r,'minimum');
 assert(result.ok&&result.ended);assert.equal(u.pendingHeat,2);
 assert.equal(u.spent,1);assert.equal(u.moveMode,'run');assert.equal(u.moved,true);
});
test('AGoAC pp.11–12: minimum water step resolves required terrain PSR and consumes selection',()=>{
 const g=fresh(),u=g.units[0];g.phase='move';g.activeTeam=0;g.queue=[0,1];
 Object.assign(u,{q:0,r:0,facing:0,walk:1,moveStart:{q:0,r:0}});
 Object.assign(g.tile(0,0),{type:'plain',depth:0,height:0,surface:0});
 Object.assign(g.tile(1,0),{type:'water',depth:1,height:-1,surface:0});
 let draws=0;g.rng=()=>{draws++;return .5;};
 const result=g.minimumMove(u.id);
 assert(result.ok&&result.ended);assert.deepEqual(result.path,[{q:1,r:0}]);
 assert.equal(draws,2);assert.equal(result.rolls[0].target,u.piloting-1);
 assert.equal(u.pendingHeat,2);assert.equal(u.distanceMoved,1);assert.equal(u.moved,true);
 assert.equal(g.rotate(u.id,1).ok,false);
});

test('AGoAC pp.7,38: optional reactor orders can be made and cancelled during End Phase',()=>{
 const g=fresh(),u=g.units[0];g.phase='end';g.queue=[];g.activeTeam=null;
 assert(g.canOrderShutdown(u));assert(g.orderShutdown(u.id).ok);assert(u.shutdownNext);
 assert(!u.shutdown);assert(g.orderShutdown(u.id).ok);assert(!u.shutdownNext);
 assert(g.orderShutdown(u.id).ok);g.endPhase();
 assert(u.shutdown&&u.voluntaryShutdown);assert(!u.shutdownNext);
 g.phase='end';u.heat=14;let dice=diceFor(3);g.rng=()=>dice.shift()??.5;
 assert(g.orderShutdown(u.id).ok);g.endPhase();assert(u.shutdown);
 assert.equal(g.phaseRolls.filter(r=>r.kind.includes('Добровольный перезапуск')).length,1);
 g.phase='end';dice=diceFor(4);assert(g.orderShutdown(u.id).ok);g.endPhase();
 assert(!u.shutdown&&!u.voluntaryShutdown);
});
test('AGoAC pp.7,38,44: an unavailable pilot cannot execute a previously queued reactor command',()=>{
 const g=fresh(),u=g.units[0];g.phase='move';g.activeTeam=0;g.queue=[0,1];
 assert(g.orderShutdown(u.id).ok);u.unconscious=true;u.pilotWounds=1;
 g.phase='end';g.activeTeam=null;g.queue=[];
 g.endPhase();assert.equal(u.shutdown,false);assert.equal(u.shutdownNext,false);
 assert.equal(g.canOrderShutdown(u),false);
});
test('AGoAC pp.7,44: Initiative captures actual recovery eligibility for the current turn',()=>{
 const g=fresh(),u=g.units[0],v=g.units[1];
 Object.assign(u,{unconscious:true,pilotWounds:1,wasUnconscious:false});
 Object.assign(v,{unconscious:false,pilotWounds:0,wasUnconscious:true});
 let dice=[...diceFor(12),...diceFor(2)];g.rng=()=>dice.shift()??.99;
 g.initiative();assert.equal(u.wasUnconscious,true);assert.equal(v.wasUnconscious,false);
 v.unconscious=true;v.pilotWounds=1;g.endPhase();
 assert.equal(u.unconscious,false);assert.equal(v.unconscious,true);
 assert.equal(g.phaseRolls.filter(r=>r.kind.includes('Пробуждение')).length,1);
});

test('AGoAC pp.7,38,44: recovered pilot can choose reactor state with exactly-once recovery and restart dice',()=>{
 for(const heat of [0,14,30]){
  const g=fresh(),u=g.units[0];g.phase='end';g.activeTeam=null;g.queue=[];
  for(const tile of g.tiles)Object.assign(tile,{type:'plain',height:0,depth:0,surface:0});
  Object.assign(u,{unconscious:true,wasUnconscious:true,pilotWounds:1,heat,shutdown:heat!==0,voluntaryShutdown:heat!==0});
  const dice=[...diceFor(3),...diceFor(4)];
  let draws=0;g.rng=()=>{draws++;return dice.shift()??.5;};
  const before=JSON.stringify(g.units),r=g.nextPhaseWithChoices({humanTeams:[0]});
  if(heat===30){
   assert(r.ok&&!r.pending);assert.equal(g.unit(u.id).unconscious,false);
   assert.equal(g.unit(u.id).shutdown,true);assert.equal(draws,2);continue;
  }
  assert(r.pending);assert.equal(g.pendingChoice.kind,'recovered-reactor');
  assert.equal(JSON.stringify(g.units),before);assert.equal(draws,2);
  const p=g.pendingChoice;
  assert.deepEqual(p.options.map(o=>o.id),['stay',heat?'restart':'shutdown']);
  assert.equal(g.nextPhaseWithChoices({choice:{key:p.key,option:'invalid'}}).ok,false);
  assert.equal(draws,2);
  const restored=new Game({rng:()=>{draws++;return dice.shift()??.5;}});
  Object.assign(restored,JSON.parse(JSON.stringify(g,(k,v)=>['map','rng'].includes(k)?undefined:v)));
  restored.rebuildMap();
  const done=restored.nextPhaseWithChoices({choice:{key:p.key,option:heat?'restart':'shutdown'}});
  assert(done.ok&&!done.pending);assert.equal(restored.unit(u.id).unconscious,false);
  assert.equal(restored.unit(u.id).shutdown,heat===0);assert.equal(draws,heat?4:2);
  assert.equal(restored.phase,'initiative');assert.equal(restored.round,g.round+1);
  assert.equal(restored.phaseRolls.filter(r=>r.kind.includes('Пробуждение')).length,1);
 }
});
test('AGoAC pp.7,44: unsuccessful recovery does not offer reactor choice',()=>{
 const g=fresh(),u=g.units[0];g.phase='end';g.queue=[];g.activeTeam=null;
 Object.assign(u,{unconscious:true,wasUnconscious:true,pilotWounds:2});
 g.rng=()=>0;const r=g.nextPhaseWithChoices({humanTeams:[0]});
 assert(r.ok&&!r.pending);assert(g.unit(u.id).unconscious);assert.equal(g.pendingChoice,null);
});

test('AGoAC pp.11–12: jump chooses any landing facing at no MP cost and cannot rotate after landing',()=>{
 for(let facing=0;facing<6;facing++){
  const g=fresh(),u=g.units[0];g.phase='move';g.activeTeam=0;g.queue=[0,1];
  Object.assign(u,{q:0,r:0,facing:0,moveStart:{q:0,r:0},jump:2,jumpLost:0,proneAtStart:false});
  for(const t of g.tiles)Object.assign(t,{type:'plain',depth:0,height:0,surface:0});
  const result=g.moveWithChoices(u.id,1,0,'jump',{facing,humanTeams:[0]});
  const moved=g.unit(u.id);assert(result.ok&&!result.pending);
  assert.equal(moved.facing,facing);assert.equal(moved.spent,1);assert.equal(moved.pendingHeat,3);
  assert.equal(g.rotate(u.id,1).ok,false);assert.equal(moved.facing,facing);
 }
});
test('AGoAC p.12: failed water landing determines fall facing relative to selected landing orientation',()=>{
 const g=fresh(),u=g.units[0];g.phase='move';g.activeTeam=0;g.queue=[0,1];
 Object.assign(u,{q:0,r:0,facing:0,moveStart:{q:0,r:0},jump:2,jumpLost:0,proneAtStart:false});
 for(const t of g.tiles)Object.assign(t,{type:'plain',depth:0,height:0,surface:0});
 Object.assign(g.tile(1,0),{type:'water',depth:1,height:-1,surface:0});
 const dice=[...diceFor(2),(3-.5)/6];g.rng=()=>dice.shift()??.5;
 assert(g.move(u.id,1,0,'jump',{facing:5}).ok);
 assert(u.prone);assert.equal(u.facing,3);assert.equal(g.rotate(u.id,1).ok,false);
});
test('AGoAC pp.6,12: deployment jump can choose landing facing while ground entry cannot override facing',()=>{
 for(let facing=0;facing<6;facing++){
  const g=standardSetupGame(0),u=g.units.find(x=>g.canAct(x));
  const before=JSON.stringify(u),t=g.reachable(u,'walk')[0];
  assert.equal(g.move(u.id,t.q,t.r,'walk',{facing}).ok,false);
  assert.equal(JSON.stringify(u),before);
  const j=g.reachable(u,'jump').find(x=>x.cost===1);
  assert(g.move(u.id,j.q,j.r,'jump',{facing}).ok);
  assert.equal(u.facing,facing);assert.equal(u.spent,1);
  assert.equal(g.rotate(u.id,1).ok,false);
 }
});

test('AGoAC p.12: one-legged biped stand includes cumulative modifiers in a single PSR',()=>{
 for(const {hip,gyro} of [{hip:true,gyro:0},{hip:false,gyro:1},{hip:true,gyro:1}]){
  const g=fresh(),u=g.units[0];g.phase='move';g.activeTeam=0;g.queue=[0,1];
  u.structure.LL=0;u.actuators.RL.hip=hip;u.gyroHits=gyro;u.piloting=1;u.prone=true;
  let draws=0;g.rng=()=>{draws++;return .99;};
  assert(g.stand(u.id).ok);assert(!u.prone);
  assert.equal(g.phaseRolls[0].target,1+5+(hip?2:0)+gyro*3);
  assert.equal(draws,2);assert.equal(u.spent,2);assert.equal(u.pendingHeat,1);
  assert(g.hold(u.id).ok);assert.equal(draws,2);
  assert.equal(u.pendingHeat,3);assert.equal(u.moved,true);
  g.endPhase();assert.equal(u.restrictedStandThisTurn,false);
 }
});
test('AGoAC pp.12,32: ordinary damaged running still requires its separate PSR',()=>{
 const g=fresh(),u=g.units[0];g.phase='move';g.activeTeam=0;g.queue=[0,1];
 Object.assign(u,{gyroHits:1,moveMode:'run',spent:2,piloting:2});
 let draws=0;g.rng=()=>{draws++;return .99;};
 assert(g.hold(u.id).ok);assert.equal(draws,2);
 assert.equal(g.phaseRolls[0].target,5);
});

test('AGoAC pp.9,12: ground facing change commits the declared movement mode even while prone',()=>{
 for(const prone of [false,true]){
  const g=fresh(),u=g.units[0];g.phase='move';g.activeTeam=0;g.queue=[0,1];
  Object.assign(u,{q:0,r:0,facing:0,walk:4,prone});
  assert(g.rotate(u.id,1,{mode:'run'}).ok);
  assert.equal(u.moveMode,'run');assert.equal(u.spent,1);assert.equal(u.facing,1);
  const before=JSON.stringify(u);
  assert.equal(g.rotate(u.id,-1,{mode:'walk'}).ok,false);
  assert.equal(JSON.stringify(u),before);
  assert(g.hold(u.id).ok);assert.equal(u.pendingHeat,2);
 }
});
test('AGoAC p.12: declared ground mode and free facing are retained on successful standing',()=>{
 for(const mode of ['walk','run']){
  const g=fresh(),u=g.units[0];g.phase='move';g.activeTeam=0;g.queue=[0,1];
  Object.assign(u,{q:0,r:0,facing:0,walk:4,prone:true,proneAtStart:true});
  g.rng=()=>.99;
  assert(g.stand(u.id,5,{mode}).ok);assert.equal(u.prone,false);assert.equal(u.facing,5);
  assert.equal(u.spent,2);assert.equal(u.moveMode,mode);assert.equal(u.pendingHeat,1);
  assert.equal(g.rotate(u.id,1,{mode:mode==='walk'?'run':'walk'}).ok,false);
  assert(!g.reachable(u,'jump').length);assert(g.hold(u.id).ok);
  assert.equal(u.pendingHeat,mode==='walk'?2:3);
 }
});
test('AGoAC pp.9,12: restricted stand cannot silently change a committed walking mode',()=>{
 const g=fresh(),u=g.units[0];g.phase='move';g.activeTeam=0;g.queue=[0,1];
 Object.assign(u,{prone:true,moveMode:'walk',spent:1});u.structure.LL=0;
 const before=JSON.stringify(u);assert.equal(g.stand(u.id).ok,false);
 assert.equal(JSON.stringify(u),before);
});
test('AGoAC p.11: one-MP minimum stand consumes movement and permits free facing on success',()=>{
 const g=fresh(),u=g.units[0];g.phase='move';g.activeTeam=0;g.queue=[0,1];
 Object.assign(u,{q:0,r:0,prone:true,proneAtStart:true,piloting:1});u.structure.LL=0;
 g.rng=()=>.99;
 assert(g.stand(u.id,4,{minimum:true,mode:'run'}).ok);
 assert(!u.prone);assert.equal(u.facing,4);assert.equal(u.spent,1);
 assert.equal(u.moveMode,'run');assert(!g.reachable(u,'run').length);
 assert(!g.rotate(u.id,1,{mode:'run'}).ok);assert(g.hold(u.id).ok);assert.equal(u.pendingHeat,3);
});

test('AGoAC pp.6–7: casualties before selection cannot leave impossible orders',()=>{
 const g=fresh(),[a,b,c,d]=g.units;
 g.phase='move';g.initiativeWinner=1;g.buildQueue();
 assert.deepEqual(g.queue,[0,1,0,1]);
 // The last surviving opponent is destroyed before receiving an order.
 g.destroyMech(c);g.destroyMech(d);
 assert(g.onMap(c));assert(g.onMap(d));
 assert(g.hold(a.id).ok);
 assert.deepEqual(g.queue,[0]);assert.equal(g.activeTeam,0);
 assert(g.canAct(b));assert(g.hold(b.id).ok);
 assert.deepEqual(g.queue,[]);assert.equal(g.activeTeam,null);
 assert(g.nextPhase().ok);assert.equal(g.winner,0);
 assert(!g.onMap(c));assert(!g.onMap(d));
});
test('AGoAC pp.6–7: an immobile survivor keeps its order when a teammate is destroyed',()=>{
 const g=fresh(),[a,b,c,d]=g.units;
 g.phase='move';g.initiativeWinner=1;g.buildQueue();
 g.destroyMech(c);d.shutdown=true;
 assert(g.hold(a.id).ok);assert.deepEqual(g.queue,[1,0]);
 assert(g.canAct(d));assert(g.isImmobile(d));assert(g.hold(d.id).ok);
 assert(g.canAct(b));assert(g.hold(b.id).ok);
 assert.deepEqual(g.queue,[]);assert.equal(g.winner,null);
 assert(g.nextPhase().ok);assert.equal(g.phase,'fire');
});
test('AGoAC p.7: declaration batches obey remaining-force ratio for forces of one to twenty',()=>{
 const g=fresh();
 for(let left=1;left<=20;left++)for(let right=1;right<=20;right++)for(const winner of [0,1]){
  g.initiativeWinner=winner;g.phase='move';
  g.units=[...Array.from({length:left},(_,i)=>({id:i,team:0,dead:false})),
   ...Array.from({length:right},(_,i)=>({id:left+i,team:1,dead:false})),
   {id:left+right,team:0,dead:true},{id:left+right+1,team:1,dead:true}];
  g.buildQueue();
  let cursor=0,a=left,b=right;
  while(a&&b){
   const n0=a>=2*b?Math.floor(a/b):1,n1=b>=2*a?Math.floor(b/a):1;
   const pair=winner===0?[...Array(n1).fill(1),...Array(n0).fill(0)]:[...Array(n0).fill(0),...Array(n1).fill(1)];
   assert.deepEqual(g.queue.slice(cursor,cursor+pair.length),pair,`${left}:${right}, winner ${winner}`);
   cursor+=pair.length;a-=n0;b-=n1;
  }
  assert.deepEqual(g.queue.slice(cursor),[...Array(a).fill(0),...Array(b).fill(1)]);
  assert.equal(g.queue.length,left+right);
 }
});

test('AGoAC p.7: casualties change the next declaration pair ratio, not the unfinished pair',()=>{
 const g=fresh(),template=structuredClone(g.units[0]);
 g.units=Array.from({length:7},(_,id)=>({...structuredClone(template),id,team:id<4?0:1}));
 g.phase='move';g.initiativeWinner=1;g.buildQueue();
 assert.deepEqual(g.queue,[0,1,0,1,0,0,1]);
 g.destroyMech(g.units[6]);
 assert(g.hold(0).ok);
 assert.deepEqual(g.queue,[1,0,0,0,1]);
 assert.equal(g.selectionBatch.remaining,1);
 assert(g.hold(4).ok);
 assert.deepEqual(g.queue,[0,0,0,1]);
 assert.equal(g.selectionBatch.remaining,4);
 for(const id of [1,2,3,5])assert(g.hold(id).ok);
 assert.deepEqual(g.queue,[]);assert.equal(g.activeTeam,null);
});
test('AGoAC p.7: a large-side batch already in progress survives casualty and JSON restore',()=>{
 const g=fresh(),template=structuredClone(g.units[0]);
 g.units=Array.from({length:9},(_,id)=>({...structuredClone(template),id,team:id<6?0:1}));
 g.phase='move';g.initiativeWinner=1;g.buildQueue();
 assert.deepEqual(g.queue,[0,0,1,0,0,1,0,0,1]);
 g.destroyMech(g.units[7]);g.destroyMech(g.units[8]);
 assert(g.hold(0).ok);
 assert.deepEqual(g.queue,[0,1,0,0,0,0]);
 assert.equal(g.selectionBatch.remaining,2);
 const restored=new Game({rng:()=>.5});
 Object.assign(restored,JSON.parse(JSON.stringify(g,(k,v)=>['map','rng'].includes(k)?undefined:v)));
 restored.rebuildMap();
 assert(restored.hold(1).ok);assert.equal(restored.activeTeam,1);
 assert(restored.hold(6).ok);assert.deepEqual(restored.queue,[0,0,0,0]);
 for(const id of [2,3,4,5])assert(restored.hold(id).ok);
 assert.deepEqual(restored.queue,[]);assert.equal(restored.activeTeam,null);
});

test('AGoAC p.7: selection planning terminates for legacy states without an initiative result',()=>{
 for(const missing of [undefined,null]){
  const g=fresh();g.phase='move';g.initiativeWinner=missing;
  g.buildQueue();assert.deepEqual(g.queue,[0,1,0,1]);
  assert.equal(g.activeTeam,0);
  for(const id of [0,2,1,3])assert(g.hold(id).ok);
  assert.deepEqual(g.queue,[]);assert.equal(g.activeTeam,null);
  assert(g.nextPhase().ok);assert.equal(g.phase,'fire');
  assert.deepEqual(g.queue,[0,1,0,1]);
  g.reset();assert.equal(g.selectionBatch,null);
 }
});

test('AGoAC p.33: biped hip damage halves Walking MP downward and derives Running MP upward',()=>{
 for(const leg of ['LL','RL'])for(let base=0;base<=12;base++)for(const heat of [0,5,10,25]){
  const g=fresh(),u=g.units[0];u.walk=base;u.heat=heat;
  u.actuators[leg].hip=true;
  const walk=Math.max(0,Math.floor(base/2)-Math.min(5,Math.floor(heat/5)));
  assert.equal(g.mp(u,'walk'),walk);
  assert.equal(g.mp(u,'run'),Math.ceil(walk*1.5));
  assert.equal(g.psrMod(u),2);
  assert.equal(g.isImmobile(u),false);
  u.actuators[leg==='LL'?'RL':'LL'].hip=true;
  assert.equal(g.mp(u,'walk'),0);assert.equal(g.mp(u,'run'),0);
  assert.equal(g.psrMod(u),4);assert.equal(g.isImmobile(u),false);
 }
});
test('AGoAC pp.32–34: same-leg actuator hits before, during and after hip-hit turn affect MP correctly',()=>{
 const g=fresh(),u=g.units[0];u.walk=7;u.heat=0;g.phase='fire';
 const hit=(leg,slot)=>{const dice=[...diceFor(8),(slot+.5)/6];g.rng=()=>{assert(dice.length);return dice.shift();};
  g.criticalHit(u,leg);assert.equal(dice.length,0);};
 g.round=1;hit('LL',1);assert.equal(g.mp(u),6);
 g.round=2;hit('LL',2);assert.equal(g.mp(u),5);
 hit('LL',0);assert.equal(g.mp(u),2);assert.equal(g.psrMod(u),2);
 // The lower-leg hit in round 2 remains relevant even in later rounds.
 g.round=3;assert.equal(g.mp(u),2);
 hit('LL',3);assert.equal(g.mp(u),1);assert.equal(g.psrMod(u),2);
 hit('RL',1);assert.equal(g.mp(u),0);assert.equal(g.psrMod(u),3);
 assert.deepEqual(u.actuatorHitRounds,{LL:{upper:1,lower:2,hip:2,foot:3},RL:{upper:3}});
 const restored=new Game({rng:()=>.5});
 Object.assign(restored,JSON.parse(JSON.stringify(g,(k,v)=>['map','rng'].includes(k)?undefined:v)));
 restored.rebuildMap();assert.equal(restored.mp(restored.unit(u.id)),0);
 assert.equal(restored.psrMod(restored.unit(u.id)),3);
});
test('AGoAC p.33: hip-limited movement cannot use the extra hex from rounding up',()=>{
 const g=fresh(),u=g.units[0];g.phase='move';g.activeTeam=0;g.queue=[0,1,0,1];
 Object.assign(u,{q:0,r:0,facing:0,walk:5,heat:0,moveStart:{q:0,r:0}});
 for(const t of g.tiles)Object.assign(t,{type:'plain',depth:0,height:0,surface:0});
 u.actuators.LL.hip=true;
 assert(g.reachable(u,'walk').some(p=>p.q===2&&p.r===0));
 assert(!g.reachable(u,'walk').some(p=>p.q===3&&p.r===0));
 assert(g.reachable(u,'run').some(p=>p.q===3&&p.r===0));
 assert(!g.reachable(u,'run').some(p=>p.q===4&&p.r===0));
 const before=JSON.stringify(u);assert.equal(g.move(u.id,4,0,'run').ok,false);
 assert.equal(JSON.stringify(u),before);
});

test('AGoAC pp.28,32–34: all biped kick actuator penalties accumulate across both legs',()=>{
 const parts=['upper','lower','foot'];
 for(const tonnage of [20,55,100]){
  const g=fresh(),u=g.units[0],t=g.units[2];
  for(const tile of g.tiles)Object.assign(tile,{type:'plain',height:0,depth:0,surface:0});
  Object.assign(u,{q:0,r:0,facing:0,moveMode:'stand',tonnage});
  Object.assign(t,{q:1,r:0,moveMode:'stand'});
  const base=g.physicalPreview(u.id,t.id,'kick','LL');
  assert(base.legal,base.reason);
  for(let mask=0;mask<64;mask++){
   let halves=0,feet=0;
   for(const [i,leg] of ['LL','RL'].entries())for(const [j,part] of parts.entries()){
    const damaged=!!(mask&(1<<(i*3+j)));
    u.actuators[leg][part]=damaged;
    if(damaged){if(part==='foot')feet++;else halves++;}
   }
   for(const leg of ['LL','RL']){
    const p=g.physicalPreview(u.id,t.id,'kick',leg);
    assert(p.legal,p.reason);
    assert.equal(p.targetNumber,base.targetNumber+2*halves+feet);
    assert.equal(p.damage,Math.floor(tonnage/5/2**halves));
   }
  }
 }
});
test('AGoAC p.28: either damaged hip forbids kicking and firing a leg forbids its own kick',()=>{
 const g=fresh(),u=g.units[0],t=g.units[2];
 for(const tile of g.tiles)Object.assign(tile,{type:'plain',height:0,depth:0,surface:0});
 Object.assign(u,{q:0,r:0,facing:0,moveMode:'stand'});
 Object.assign(t,{q:1,r:0,moveMode:'stand'});
 for(const leg of ['LL','RL']){
  u.actuators[leg].hip=true;
  for(const kick of ['LL','RL'])assert.equal(g.physicalPreview(u.id,t.id,'kick',kick).legal,false);
  u.actuators[leg].hip=false;
  u.firedLocations=[leg];
  assert.equal(g.physicalPreview(u.id,t.id,'kick',leg).legal,false);
  assert.equal(g.physicalPreview(u.id,t.id,'kick',leg==='LL'?'RL':'LL').legal,true);
  u.firedLocations=[];
 }
 assert.equal(g.physicalPreview(u.id,t.id,'kick','CT').legal,false);
});
test('AGoAC p.28: zero-damage kick cannot trigger a through-armor critical but still requires a PSR',()=>{
 const g=fresh(),u=g.units[0],t=g.units[2];
 const dice=diceFor(2);g.rng=()=>{assert(dice.length,'Zero damage must not roll criticals');return dice.shift();};
 let damageCalls=0;g.damage=()=>{damageCalls++;return [];};
 g.resolveRolledPhysical({u,t,d:{type:'kick',damage:0,side:'front',table:'normal',targetNumber:2},roll:12,hit:true,cancelled:false,attackRoll:null});
 assert.equal(damageCalls,0);
 assert.equal(dice.length,0);
 assert.equal(t.psrs.at(-1).reason,'Удар ногой');
 assert.equal(g.resolution.at(-1).shots[0].damage,0);
});

test('AGoAC pp.32,37–38: engine criticals add five heat each unless shut down and third destroys',()=>{
 for(const shut of [false,true]){
  const g=fresh(),u=g.units[0];for(const t of g.tiles)Object.assign(t,{type:'plain',height:0,depth:0,surface:0});
  u.sinks=10;for(const b of u.bins)b.shots=0;
  for(let n=0;n<=3;n++){
   if(n){
    const dice=[...diceFor(8),.5/6,(n-.5)/6];g.rng=()=>{assert(dice.length);return dice.shift();};
    g.criticalHit(u,'CT');assert.equal(dice.length,0);assert.equal(u.engineHits,n);
   }
   if(n===3){assert(u.dead);assert(g.onMap(u));assert.equal(u.pilotWounds,0);g.removeDestroyedMechs();assert(!g.onMap(u));break;}
   assert(!u.dead);
   Object.assign(u,{shutdown:shut,voluntaryShutdown:shut,heat:0,pendingHeat:10});
   g.rng=()=>.99;g.heatPhase();assert.equal(u.heat,shut?0:n*5);
  }
 }
});
test('AGoAC pp.32,34–35: side torso destruction counts critical and remaining engine slots once',()=>{
 for(const count of [2,3])for(const side of ['LT','RT']){
  const g=fresh(),u=g.units[0];g.phase='fire';
  u.slots[side]=Array.from({length:12},(_,i)=>i<count?'engine':null);
  u.crit[side]=Array(12).fill(false);u.bins=u.bins.filter(b=>b.location!==side);
  const roll=(slot)=>{const dice=[...diceFor(8),(slot+.5)/6];g.rng=()=>{assert(dice.length);return dice.shift();};return dice;};
  let dice=roll(0);g.criticalHit(u,side);assert.equal(dice.length,0);assert.equal(u.engineHits,1);
  dice=roll(1);g.damage(u,side,u.structure[side],{internal:true});
  assert.equal(dice.length,0);assert.equal(u.engineHits,count);assert.equal(u.structure[side],0);
  assert(u.crit[side].every(Boolean));assert.equal(u.dead,count===3);
  assert.equal(u.structure[side==='LT'?'LA':'RA'],0);
  assert.equal(u.pilotWounds,0);
  g.destroyLocation(u,side);assert.equal(u.engineHits,count);
  if(count===3){assert(g.onMap(u));g.removeDestroyedMechs();assert(!g.onMap(u));}
 }
});
test('AGoAC pp.33–34: destroyed section counts sink and jump slots marked by final critical roll',()=>{
 for(const type of ['sink','jump']){
  const g=fresh(),u=g.units[0],loc='LT';
  u.slots[loc]=[type,type,...Array(10).fill(null)];u.crit[loc]=Array(12).fill(false);
  const dice=[...diceFor(8),.5/6];g.rng=()=>{assert(dice.length);return dice.shift();};
  g.damage(u,loc,u.structure[loc],{internal:true});
  const field=type==='sink'?'sinksLost':'jumpLost';
  assert.equal(dice.length,0);assert.equal(u[field],2);g.destroyLocation(u,loc);assert.equal(u[field],2);
 }
});
test('AGoAC p.33: both sensor criticals affect weapons only and the second prevents fire',()=>{
 const g=fresh(),u=g.units[0],t=g.units[2];g.phase='fire';
 for(const tile of g.tiles)Object.assign(tile,{type:'plain',height:0,depth:0,surface:0});
 Object.assign(u,{q:0,r:0,facing:0,moveMode:'stand'});
 Object.assign(t,{q:1,r:0,moveMode:'stand'});
 const fire=g.preview(u.id,t.id,0),kick=g.physicalPreview(u.id,t.id,'kick','RL');
 assert(fire.legal,fire.reason);assert(kick.legal,kick.reason);
 for(const [i,slot] of [1,4].entries()){
  const dice=[...diceFor(8),(slot+.5)/6];g.rng=()=>{assert(dice.length);return dice.shift();};
  g.criticalHit(u,'HD');assert.equal(dice.length,0);assert.equal(u.sensorHits,i+1);
  const current=g.preview(u.id,t.id,0),physical=g.physicalPreview(u.id,t.id,'kick','RL');
  assert.equal(current.legal,i===0);
  if(i===0)assert.equal(current.targetNumber,fire.targetNumber+2);
  assert.deepEqual(physical,kick);
 }
});
test('AGoAC pp.33,39: second life support critical marks its slot without stacking wounds',()=>{
 for(const heat of [15,26]){
  const g=fresh(),u=g.units[0];for(const t of g.tiles)Object.assign(t,{type:'plain',height:0,depth:0,surface:0});
  for(const slot of [0,5]){
   const dice=[...diceFor(8),(slot+.5)/6];g.rng=()=>{assert(dice.length);return dice.shift();};
   g.criticalHit(u,'HD');assert.equal(dice.length,0);assert.equal(u.lifeSupport,true);assert.equal(u.crit.HD[slot],true);
  }
  for(const b of u.bins)b.shots=0;Object.assign(u,{shutdown:true,voluntaryShutdown:true,prone:true,heat:heat+u.sinks,pendingHeat:0});
  g.rng=()=>.99;g.heatPhase();assert.equal(u.heat,heat);assert.equal(u.pilotWounds,heat===26?2:1);
 }
});

test('AGoAC pp.28,32–33: missing and damaged arm actuators affect punches but only damage affects weapon fire',()=>{
 const g=fresh(),u=g.units[0],t=g.units[2];
 for(const tile of g.tiles)Object.assign(tile,{type:'plain',height:0,depth:0,surface:0});
 Object.assign(u,{q:0,r:0,facing:0,tonnage:65,moveMode:'stand'});
 Object.assign(t,{q:1,r:0,moveMode:'stand'});
 for(const leg of ['LA','RA']){
  const original=u.slots[leg].slice(),saved=u.weapons[0].location;u.weapons[0].location=leg;
  const base=g.physicalPreview(u.id,t.id,'punch',leg),fire=g.preview(u.id,t.id,0);
  assert(base.legal,base.reason);assert(fire.legal,fire.reason);
  for(const upper of [0,1,2])for(const lower of [0,1,2])for(const hand of [0,1,2]){
   u.slots[leg]=original.slice();
   for(const [index,part,state] of [[1,'upper',upper],[2,'lower',lower],[3,'hand',hand]]){
    u.actuators[leg][part]=state===1;
    if(state===2)u.slots[leg][index]=null;
   }
   const p=g.physicalPreview(u.id,t.id,'punch',leg);
   assert(p.legal,p.reason);assert.equal(p.targetNumber,base.targetNumber+2*Number(upper>0)+2*Number(lower>0)+Number(hand>0));
   assert.equal(p.damage,Math.max(1,Math.floor(7/2**(Number(upper>0)+Number(lower>0)))));
   assert.equal(g.preview(u.id,t.id,0).targetNumber,fire.targetNumber+Number(upper===1)+Number(lower===1));
   u.actuators[leg].shoulder=true;
   assert.equal(g.physicalPreview(u.id,t.id,'punch',leg).legal,false);
   assert.equal(g.preview(u.id,t.id,0).targetNumber,fire.targetNumber+4);
   u.actuators[leg].shoulder=false;
  }
  u.slots[leg]=original;Object.assign(u.actuators[leg],{upper:false,lower:false,hand:false});
  u.weapons[0].location=saved;
 }
});
test('AGoAC pp.26,32–33: clubbing requires working shoulders and hands but damaged arm joints only add modifiers',()=>{
 const g=fresh(),u=g.units[0],t=g.units[2];
 for(const tile of g.tiles)Object.assign(tile,{type:'plain',height:0,depth:0,surface:0});
 Object.assign(u,{q:0,r:0,facing:0,club:true,moveMode:'stand'});
 Object.assign(t,{q:1,r:0,moveMode:'stand'});
 const base=g.physicalPreview(u.id,t.id,'club','RA');assert(base.legal,base.reason);
 for(let mask=0;mask<16;mask++){
  let hits=0;for(const [i,l] of ['LA','RA'].entries())for(const [j,p] of ['upper','lower'].entries()){
   const hit=!!(mask&(1<<(2*i+j)));u.actuators[l][p]=hit;hits+=Number(hit);
  }
  const p=g.physicalPreview(u.id,t.id,'club','RA');
  assert(p.legal,p.reason);assert.equal(p.targetNumber,base.targetNumber+2*hits);assert.equal(p.damage,base.damage);
 }
 for(const l of ['LA','RA']){
  for(const part of ['shoulder','hand']){
   u.actuators[l][part]=true;assert(!g.physicalPreview(u.id,t.id,'club','RA').legal);u.actuators[l][part]=false;
  }
  u.slots[l][3]=null;assert(!g.physicalPreview(u.id,t.id,'club','RA').legal);u.slots[l][3]='hand';
 }
 g.phase='physical';g.activeTeam=u.team;g.queue=[u.team];g.actingId=null;g.tile(u.q,u.r).type='woods';
 u.club=false;u.firedLocations=['CT'];assert.equal(g.takeClub(u.id).ok,false);
 u.firedLocations=[];assert(g.takeClub(u.id).ok);assert(u.club);
});
test('AGoAC p.28: intact arm-mounted hatchet prevents a punch until destroyed',()=>{
 const g=fresh(),u=g.units[0],t=g.units[2];
 for(const tile of g.tiles)Object.assign(tile,{type:'plain',height:0,depth:0,surface:0});
 Object.assign(u,{q:0,r:0,facing:0,moveMode:'stand'});Object.assign(t,{q:1,r:0,moveMode:'stand'});
 for(const l of ['LA','RA']){
  u.slots[l][11]='hatchet';u.crit[l][11]=false;
  assert(!g.physicalPreview(u.id,t.id,'punch',l).legal);
  u.crit[l][11]=true;assert(g.physicalPreview(u.id,t.id,'punch',l).legal);
 }
});
test('AGoAC pp.32,40,43: second gyro hit makes fall automatic and subsequent hits never raise modifier beyond six',()=>{
 const g=fresh(),u=g.units[0];g.phase='fire';u.prone=false;
 // All four gyro slots can be marked, but only two have gameplay effects.
 for(const [i,slot] of [3,4,5,6].entries()){
  const dice=[...diceFor(8),slot<6?.5/6:5.5/6,((slot%6)+.5)/6];
  g.rng=()=>{assert(dice.length);return dice.shift();};
  g.criticalHit(u,'CT');assert.equal(dice.length,0);assert(u.crit.CT[slot]);
  assert.equal(u.gyroHits,Math.min(i+1,2));assert.equal(g.psrMod(u),3*Math.min(i+1,2));
 }
 assert.equal(u.psrs.length,2);let fell=0;g.fall=(v,levels,tn)=>{assert.equal(v,u);assert.equal(tn,u.piloting+6);v.prone=true;fell++;};
 g.rng=()=>{throw Error('Destroyed gyro must fall without a fall-avoidance roll');};g.endPSR();
 assert.equal(fell,1);assert(u.prone);assert(!g.isImmobile(u));
 g.phase='move';g.activeTeam=u.team;g.queue=[u.team];g.actingId=null;u.moveMode='stand';u.spent=0;
 assert.equal(g.stand(u.id).ok,false);assert(g.rotate(u.id,1).ok);assert.equal(g.rotate(u.id,1).ok,false);
});

test('AGoAC pp.4–5: critical table distinguishes empty reroll slots and destroyed equipment',()=>{
 const u=fresh().units[0];u.slots.LT[0]=null;u.slots.LT[1]='sink';u.slots.LT[2]='jump';
 for(const emptyMarked of [false,true]){
  u.crit.LT[0]=emptyMarked;u.crit.LT[1]=true;u.crit.LT[2]=false;
  const html=recordSheet(u);
  assert.match(html,/data-critical-slot="LT:1" data-slot-state="empty" style="">1\. Повторить бросок<\/div>/);
  assert.match(html,/data-critical-slot="LT:2" data-slot-state="destroyed" style="[^"]+">2\. ● Радиатор<\/div>/);
  assert.match(html,/data-critical-slot="LT:3" data-slot-state="intact" style="">3\. ○ Прыжковый двигатель<\/div>/);
  assert(html.includes('Правая рука / нога → правый торс → центр торса'));
  assert(html.includes('Левая рука / нога → левый торс → центр торса'));
  assert(html.includes('Голова и центр торса: переноса нет'));
 }
});
test('AGoAC p.5: weapons inventory reflects names locations ranges heat damage and ammunition',()=>{
 const g=fresh();
 for(const u of g.units){
  const html=recordSheet(u),tbody=html.match(/<tbody>(<tr><td>[\s\S]*?)<\/tbody>/)[1];
  const rows=[...tbody.matchAll(/<tr>(.*?)<\/tr>/g)];
  assert.equal(rows.length,u.weapons.length);
  for(const [i,w] of u.weapons.entries()){
   const cells=[...rows[i][1].matchAll(/<td>(.*?)<\/td>/g)].map(m=>m[1]);
   assert.deepEqual(cells,[w.name+(w.rear?' (R)':''),w.location,String(w.heat),String(w.rack?w.rack+'×'+w.damage:w.damage),String(w.min||'—'),...w.ranges.map(String),String(w.ammo??'∞')]);
  }
 }
});

test('AGoAC p.4: all seven illustrated terrain types have the stated basic movement costs and rubble requires a PSR',()=>{
 for(const [type,cost] of [['plain',1],['pavement',1],['rough',2],['rubble',2],['woods',2],['heavy',3]]){
  const g=fresh(),u=g.units[0];g.phase='move';g.activeTeam=u.team;g.queue=[u.team,1-u.team];g.actingId=null;
  for(const t of g.tiles)Object.assign(t,{type:'plain',depth:0,height:0,surface:0});
  Object.assign(u,{q:0,r:0,facing:0,walk:6,moveStart:{q:0,r:0},moveMode:'stand'});
  for(const other of g.units.filter(v=>v!==u))other.dead=true;
  const tile=g.tile(1,0);Object.assign(tile,{type});
  assert.equal(g.terrainCost(tile),cost);
  assert.equal(g.reachable(u,'walk').find(p=>p.q===1&&p.r===0)?.cost,cost);
  g.rng=()=>.99;
  assert(g.move(u.id,1,0,'walk').ok);assert.equal(u.spent,cost);
  assert.equal(g.phaseRolls.filter(r=>r.kind.includes('Обломки')).length,type==='rubble'?1:0);
  assert.equal(u.prone,false);
 }
 const g=fresh();for(const [depth,cost] of [[1,2],[2,4],[3,4]]){
  assert.equal(g.terrainCost({type:'water',depth,height:-depth,surface:0}),cost);
 }
});
test('AGoAC p.4: three intervening light woods or either light-heavy order block LOS',()=>{
 for(const [terrain,blocked] of [
  [[],false],[['woods'],false],[['woods','woods'],false],
  [['heavy'],false],[['woods','woods','woods'],true],
  [['woods','heavy'],true],[['heavy','woods'],true]
 ]){
  const g=fresh(),a=g.units[0],b=g.units[2];
  for(const t of g.tiles)Object.assign(t,{type:'plain',depth:0,height:0,surface:0});
  Object.assign(a,{q:0,r:0,prone:false});Object.assign(b,{q:4,r:0,prone:false});
  for(const [i,type] of terrain.entries())g.tile(i+1,0).type=type;
  const los=g.los(a,b);
  assert.equal(los.woods,terrain.reduce((n,t)=>n+(t==='heavy'?2:1),0));
  assert.equal(los.blocked,blocked);
 }
});
test('AGoAC p.5: piloting skill is the independent base for a required terrain PSR',()=>{
 for(const [gunnery,piloting] of [[4,5],[2,7],[7,2]]){
  const g=fresh(),u=g.units[0];g.phase='move';g.activeTeam=u.team;g.queue=[u.team,1-u.team];g.actingId=null;
  for(const t of g.tiles)Object.assign(t,{type:'plain',depth:0,height:0,surface:0});
  for(const v of g.units.filter(v=>v!==u))v.dead=true;
  Object.assign(u,{q:0,r:0,facing:0,walk:6,gunnery,piloting,moveMode:'stand',moveStart:{q:0,r:0}});
  g.tile(1,0).type='rubble';
  const dice=diceFor(12);g.rng=()=>{assert(dice.length);return dice.shift();};
  assert(g.move(u.id,1,0,'walk').ok);assert.equal(dice.length,0);
  assert.equal(g.phaseRolls.length,1);assert.equal(g.phaseRolls[0].target,piloting);
 }
});

test('AGoAC pp.6,9: friendly occupied paved entry is traversable without an invented skid roll',()=>{
 for(const type of ['pavement','road'])for(const mode of ['walk','run']){
  const g=standardSetupGame(0),u=g.units.find(x=>g.canAct(x)),ally=g.units.find(x=>x!==u&&x.team===u.team);
  const first=g.deploymentEdgeTiles(g.deployment.edges[u.team]).find(t=>t.r===0);
  const [dq,dr]=DIRS[g.deployment.edges[u.team]],q=first.q+dq,r=first.r+dr;
  Object.assign(first,{type});Object.assign(ally,{q:first.q,r:first.r,deployed:true});
  assert(!g.reachable(u,mode).some(p=>p.q===first.q&&p.r===first.r));
  const route=g.reachable(u,mode).find(p=>p.q===q&&p.r===r);assert(route?.transit);assert.equal(route.cost,2);
  g.rng=()=>{throw Error('Straight entry and transit must not roll for skid');};
  const before=JSON.stringify(ally),result=g.move(u.id,q,r,mode);
  assert(result.ok&&result.entry);
  assert.deepEqual(result.path,[{q:first.q,r:first.r},{q,r}]);
  assert.deepEqual([u.q,u.r,u.spent,u.distanceMoved],[q,r,2,2]);
  assert.equal(JSON.stringify(ally),before);
  assert.equal(g.phaseRolls.length,0);
 }
});
test('AGoAC pp.6,9: friendly occupied building entry uses the existing building check once before transit',()=>{
 for(const mode of ['walk','run'])for(const success of [false,true]){
  const g=standardSetupGame(0),u=g.units.find(x=>g.canAct(x)),ally=g.units.find(x=>x!==u&&x.team===u.team);
  const first=g.deploymentEdgeTiles(g.deployment.edges[u.team]).find(t=>t.r===0);
  const [dq,dr]=DIRS[g.deployment.edges[u.team]],q=first.q+dq,r=first.r+dr;
  Object.assign(first,{building:{type:'light',cf:15}});u.walk=6;
  Object.assign(ally,{q:first.q,r:first.r,deployed:true});
  const route=g.reachable(u,mode).find(p=>p.q===q&&p.r===r);assert(route?.transit);assert.equal(route.cost,3);
  let damage=[];g.packets=(v,n,side)=>{damage.push([v.id,n,side]);};
  const dice=diceFor(success?12:2);g.rng=()=>{assert(dice.length,'only the first building entry should roll');return dice.shift();};
  const before=JSON.stringify(ally),result=g.move(u.id,q,r,mode);
  assert(result.ok&&result.entry);assert.equal(dice.length,0);
  assert.equal(result.rolls.filter(r=>r.kind.includes('Вход в здание')).length,1);
  assert.deepEqual(damage,success?[]:[[u.id,2,'front']]);
  assert.equal(first.building.cf,15-Math.ceil(u.tonnage/10));
  assert.deepEqual([u.q,u.r,u.spent,u.distanceMoved],[q,r,3,2]);
  assert.equal(JSON.stringify(ally),before);
 }
});
test('AGoAC pp.6,11: setup cannot be restarted and a prone-at-start Mech cannot jump in',()=>{
 const g=fresh();assert(g.startStandardDeployment().ok);
 g.rng=()=>.99;
 const dice=[...diceFor(12),...diceFor(2)];g.rng=()=>dice.shift()??.99;
 assert(g.resolveDeploymentSetup().ok);
 const before=JSON.stringify(g.deployment);
 assert.equal(g.startStandardDeployment().ok,false);assert.equal(JSON.stringify(g.deployment),before);
 const next=[...diceFor(2),...diceFor(12)];g.rng=()=>next.shift()??.99;
 g.initiative();const u=g.units.find(x=>g.canAct(x));u.jump=3;u.proneAtStart=true;
 assert.equal(g.reachable(u,'jump').length,0);assert(g.reachable(u,'walk').length>0);
 u.proneAtStart=false;assert(g.reachable(u,'jump').length>0);
});
test('AGoAC p.6: both sides enter their assigned opposite full hex edges and complete deployment',()=>{
 for(const winner of [0,1])for(let edge=0;edge<6;edge++){
  const g=standardSetupGame(edge,winner);g.rng=()=>.99;
  let count=0;
  while(g.queue.length){
   const u=g.units.find(x=>g.canAct(x));assert(u);assert.equal(u.deployed,false);
   const mode=count%2?'run':'walk',assigned=g.deployment.edges[u.team],routes=g.reachable(u,mode);
   const route=routes.find(p=>!p.transit&&g.deploymentEdgeTiles(assigned).some(t=>t.q===p.q&&t.r===p.r));
   assert(route);assert(g.move(u.id,route.q,route.r,mode).ok);
   assert.equal(u.facing,assigned);assert.equal(u.spent,1);assert.equal(u.distanceMoved,1);
   assert(g.hold(u.id).ok);assert.equal(u.pendingHeat,mode==='run'?2:1);
   count++;
  }
  assert.equal(count,4);assert(g.units.every(u=>g.onMap(u)));
  assert.equal(new Set(g.units.map(u=>u.q+','+u.r)).size,4);
  assert(g.nextPhase().ok);assert.equal(g.phase,'fire');
 }
});

test('AGoAC p.6: selected stock forces preserve slots and absent secondary units are never fielded',()=>{
 const g=fresh(),stock=structuredClone(g.units);
 assert(g.configureSetupForces({slots:[3,null,0,1]}).ok);
 assert.deepEqual(g.units.map(u=>u.name),[stock[3].name,stock[1].name,stock[0].name,stock[1].name]);
 assert.deepEqual(g.units.map(u=>[u.id,u.team,u.q,u.r,u.facing]),stock.map(u=>[u.id,u.team,u.q,u.r,u.facing]));
 assert.equal(g.units[1].notFielded,true);assert.equal(g.onMap(g.units[1]),false);
 assert.equal(g.units[0].weapons[0].name,stock[3].weapons[0].name);
 assert.notEqual(g.units[3].armor,stock[1].armor);
 const configured=JSON.stringify(g.units);assert(!g.configureSetupForces({slots:[0,1,2,3]}).ok);
 assert.equal(JSON.stringify(g.units),configured);
 assert(g.startStandardDeployment().ok);
 let dice=[...diceFor(12),...diceFor(2),...diceFor(2),...diceFor(12)];g.rng=()=>dice.shift()??.99;
 assert(g.resolveDeploymentSetup().ok);g.initiative();
 assert.equal(g.queue.length,3);assert(!g.canAct(g.units[1]));
 let count=0;while(g.queue.length){
  const u=g.units.find(x=>g.canAct(x));assert(u&&!u.notFielded);
  const route=g.reachable(u,'walk')[0];assert(route);assert(g.move(u.id,route.q,route.r,'walk').ok);
  assert(g.hold(u.id).ok);count++;
 }
 assert.equal(count,3);assert(!g.onMap(g.units[1]));assert(g.nextPhase().ok);assert.equal(g.queue.length,3);
});
test('AGoAC p.6: custom force requires unanimous consent and valid construction before any mutation',()=>{
 const custom={config:{...structuredClone(setupExample),name:'Setup Consent'},pilot:{gunnery:3,piloting:4}};
 for(const approvals of [[],[true,false],[false,true],[1,true],[true,true,true]]){
  const g=fresh(),before=JSON.stringify(g.units);assert(!g.configureSetupForces({slots:['custom',1,2,3],custom,approvals}).ok);
  assert.equal(JSON.stringify(g.units),before);assert.equal(g.setupForces,null);
 }
 for(const slots of [[null,1,2,3],[0,1,null,3],[0,9,2,3],['custom',1,'custom',3]]){
  const g=fresh();assert(!g.configureSetupForces({slots,custom,approvals:[true,true]}).ok);assert.equal(g.setupForces,null);
 }
 const g=fresh();assert(!g.configureSetupForces({slots:['custom',1,2,3],custom:{config:{...custom.config,tonnage:1}},approvals:[true,true]}).ok);
 assert(g.configureSetupForces({slots:['custom',null,2,3],custom,approvals:[true,true]}).ok);
 assert.equal(g.units[0].name,'Setup Consent');assert.equal(g.units[0].gunnery,3);assert.equal(g.units[0].piloting,4);
 assert.deepEqual(g.setupForces.customApproved,[true,true]);assert(g.startStandardDeployment().ok);
 const locked=fresh();locked.phase='move';assert(!locked.configureSetupForces({slots:[0,1,2,3]}).ok);
});

test('AGoAC p.6: map presets preserve full hex geometry and lock before force selection',()=>{
 for(const id of ['frontier','clear','woodland','river'])for(let rotation=0;rotation<6;rotation++){
  const g=fresh(),before=g.tiles.length;assert(g.configureSetupMap({id,rotation}).ok);
  assert.equal(g.tiles.length,before);assert.equal(new Set(g.tiles.map(t=>t.q+','+t.r)).size,before);
  assert.deepEqual(g.setupMap,{id,rotation});
  for(let edge=0;edge<6;edge++)assert.equal(g.deploymentEdgeTiles(edge).length,7);
  const saved=JSON.parse(JSON.stringify(g.tiles));g.tiles=saved;g.rebuildMap();
  assert.deepEqual(g.tiles,saved);
  assert(!g.configureSetupMap({id:'clear'}).ok);
  assert(g.configureSetupForces({slots:[0,null,2,3]}).ok);
  assert(g.startStandardDeployment().ok);
 }
 const g=fresh(),before=JSON.stringify(g.tiles);
 for(const choice of [{id:'missing'},{id:'clear',rotation:6},{id:'clear',rotation:1.5}]){
  assert(!g.configureSetupMap(choice).ok);assert.equal(JSON.stringify(g.tiles),before);
 }
 assert(g.configureSetupForces({slots:[0,1,2,3]}).ok);
 assert(!g.configureSetupMap({id:'clear'}).ok);
});
test('AGoAC p.6: selected map terrain changes movement and line of sight and rotates exactly',()=>{
 const clear=fresh(),river=fresh(),rotated=fresh(),wood=fresh();
 assert(clear.configureSetupMap({id:'clear'}).ok);assert(clear.tiles.every(t=>t.type==='plain'&&t.height===0));
 assert(river.configureSetupMap({id:'river'}).ok);
 assert(wood.configureSetupMap({id:'woodland'}).ok);
 assert(rotated.configureSetupMap({id:'river',rotation:1}).ok);
 for(const t of river.tiles){
  const r=rotated.tile(-t.r,t.q+t.r);assert(r);assert.deepEqual([r.type,r.height,r.depth,r.surface],[t.type,t.height,t.depth,t.surface]);
 }
 assert.equal(river.tile(0,0).depth,2);assert.equal(river.terrainCost(river.tile(0,0)),4);
 assert.equal(clear.terrainCost(clear.tile(0,0)),1);
 assert(wood.tiles.some(t=>t.type==='heavy'));
 for(const g of [clear,river]){
  const a=g.units[0],b=g.units[2];Object.assign(a,{q:-4,r:1,prone:false});Object.assign(b,{q:4,r:1,prone:false});
  assert.equal(g.los(a,b).blocked,g===river);
 }
});

test('AGoAC p.6: rectangular mapsheet layouts use only outer edges and exact full hex counts',()=>{
 for(const [layout,width,height] of [['sheet',16,17],['horizontal',32,17],['vertical',16,34]]){
  const g=fresh(),sheets=Array.from({length:layout==='sheet'?1:2},()=>({id:'clear',rotation:0}));
  assert(g.configureSetupMap({layout,sheets}).ok);
  assert.equal(g.tiles.length,width*height);assert.equal(new Set(g.tiles.map(t=>t.q+','+t.r)).size,width*height);
  assert.deepEqual(g.deploymentEdgeIds(),[0,2,3,5]);assert.deepEqual(g.deploymentEdgeTiles(1),[]);
  for(const edge of g.deploymentEdgeIds()){
   const tiles=g.deploymentEdgeTiles(edge),[dq,dr]=DIRS[edge];
   assert.equal(tiles.length,edge===0||edge===3?height:width);
   assert(tiles.every(t=>!g.tile(t.q-dq,t.r-dr)));
   assert(tiles.every(t=>!g.deploymentEdgeTiles((edge+3)%6).includes(t)));
  }
  assert(g.units.every(u=>g.tile(u.q,u.r)));
  assert(g.configureSetupForces({slots:[0,null,2,3]}).ok);assert(g.startStandardDeployment().ok);
  let dice=[...diceFor(12),...diceFor(2),...diceFor(2),...diceFor(12)];g.rng=()=>dice.shift()??.99;
  const first=g.nextPhaseWithChoices({humanTeams:[0,1]});
  assert(first.pending);assert.deepEqual(g.pendingChoice.options.map(o=>Number(o.id)),[0,2,3,5]);
  const choice=g.pendingChoice;assert(g.nextPhaseWithChoices({humanTeams:[0,1],choice:{key:choice.key,option:'2'}}).ok);
  assert.deepEqual(g.deployment.edges,[2,5]);
 }
 const g=fresh(),before=JSON.stringify(g.tiles);
 for(const input of [{layout:'bad',sheets:[]},{layout:'horizontal',sheets:[{id:'clear',rotation:0}]},{layout:'sheet',sheets:[{id:'clear',rotation:1}]}]){
  assert(!g.configureSetupMap(input).ok);assert.equal(JSON.stringify(g.tiles),before);
 }
});
test('AGoAC p.6: movement and LOS cross joined mapsheets without artificial border costs',()=>{
 for(const layout of ['horizontal','vertical']){
  const g=fresh();assert(g.configureSetupMap({layout,sheets:[{id:'clear',rotation:0},{id:'clear',rotation:3}]}).ok);
  const u=g.units[0],v=g.units[2];
  const a=g.tiles.find(t=>t.sheet===0&&DIRS.some(([dq,dr])=>g.tile(t.q+dq,t.r+dr)?.sheet===1));
  const direction=DIRS.findIndex(([dq,dr])=>g.tile(a.q+dq,a.r+dr)?.sheet===1);
  const [dq,dr]=DIRS[direction],b=g.tile(a.q+dq,a.r+dr);
  Object.assign(u,{q:a.q,r:a.r,facing:direction,walk:6,moveStart:{q:a.q,r:a.r}});
  Object.assign(v,{q:b.q,r:b.r,prone:false});
  assert.equal(g.los(u,v).blocked,false);v.dead=true;
  for(const other of g.units.filter(x=>x!==u))other.dead=true;
  Object.assign(g,{phase:'move',activeTeam:u.team,queue:[u.team,1-u.team],actingId:null});
  const route=g.reachable(u,'walk').find(p=>p.q===b.q&&p.r===b.r);assert(route);assert.equal(route.cost,1);
  assert(g.move(u.id,b.q,b.r,'walk').ok);assert.equal(u.spent,1);assert.equal(u.distanceMoved,1);
 }
 const g=fresh();assert(g.configureSetupMap({layout:'horizontal',sheets:[{id:'clear',rotation:0},{id:'river',rotation:3}]}).ok);
 assert(g.tiles.filter(t=>t.sheet===0).every(t=>t.type==='plain'));assert(g.tiles.some(t=>t.sheet===1&&t.depth>0));
});

test('AGoAC p.6: expanded local force composition preserves unique IDs, positions and independent damage state',()=>{
 const g=fresh(),stock=structuredClone(g.units),extra=[...Array.from({length:6},()=>({team:0,stock:1})),...Array.from({length:6},()=>({team:1,stock:0}))];
 assert(g.configureSetupForces({slots:[0,1,2,3],extra}).ok);
 assert.equal(g.units.length,16);assert.deepEqual(g.units.map(u=>u.id),Array.from({length:16},(_,i)=>i));
 assert.deepEqual([0,1].map(t=>g.units.filter(u=>u.team===t&&!u.dead).length),[8,8]);
 assert.equal(new Set(g.units.map(u=>u.q+','+u.r)).size,16);assert(g.units.every(u=>g.tile(u.q,u.r)));
 assert.equal(g.units[4].name,stock[1].name);assert.equal(g.units[10].name,stock[0].name);
 const armor=g.units[5].armor.CT;g.units[4].armor.CT--;assert.equal(g.units[5].armor.CT,armor);
 for(const invalid of [[{team:2,stock:0}],[{team:0,stock:9}],Array.from({length:7},()=>({team:0,stock:0}))]){
  const x=fresh(),before=JSON.stringify(x.units);assert(!x.configureSetupForces({slots:[0,1,2,3],extra:invalid}).ok);
  assert.equal(JSON.stringify(x.units),before);assert.equal(x.setupForces,null);
 }
 const custom={config:structuredClone(setupExample)};
 const x=fresh();assert(!x.configureSetupForces({slots:[0,1,2,3],extra:[{team:1,stock:'custom'}],custom,approvals:[true,false]}).ok);
 assert(x.configureSetupForces({slots:[0,1,2,3],extra:[{team:1,stock:'custom'}],custom,approvals:[true,true]}).ok);
 assert.equal(x.units[4].variant,'CUSTOM');
});
test('AGoAC pp.6–7: expanded unequal forces enter and make exactly one selection per living Mech',()=>{
 const g=fresh();assert(g.configureSetupMap({layout:'horizontal',sheets:[{id:'clear',rotation:0},{id:'clear',rotation:0}]}).ok);
 assert(g.configureSetupForces({slots:[0,1,2,null],extra:[{team:0,stock:0},{team:0,stock:1},{team:0,stock:2},{team:1,stock:3}]}).ok);
 assert(g.startStandardDeployment().ok);
 const dice=[...diceFor(12),...diceFor(2),...diceFor(2),...diceFor(12)];g.rng=()=>dice.shift()??.99;
 assert(g.resolveDeploymentSetup().ok);g.initiative();
 assert.equal(g.queue.length,7);assert.equal(g.queue.filter(t=>t===0).length,5);assert.equal(g.queue.filter(t=>t===1).length,2);
 const seen=new Set();while(g.queue.length){
  const u=g.units.find(u=>g.canAct(u));assert(u&&!u.notFielded);assert(!seen.has(u.id));seen.add(u.id);
  const route=g.reachable(u,'walk').find(r=>!r.transit);assert(route);assert(g.move(u.id,route.q,route.r,'walk').ok);assert(g.hold(u.id).ok);
 }
 assert.equal(seen.size,7);assert.equal(g.units.filter(u=>g.onMap(u)).length,7);
 assert(g.nextPhase().ok);assert.equal(g.phase,'fire');assert.equal(g.queue.length,7);
 assert.equal(g.queue.filter(t=>t===0).length,5);assert.equal(g.queue.filter(t=>t===1).length,2);
});

test('AGoAC pp.6–7: incomplete deployment cannot advance or erase the completed movement results',()=>{
 const g=fresh();assert(g.startStandardDeployment().ok);
 g.phase='move';g.queue=[];g.activeTeam=null;
 g.phaseRolls=[{kind:'Movement',total:7}];g.resolution=[{id:0}];g.afterRolls=[{kind:'PSR',total:9}];
 const before=JSON.stringify(g,(k,v)=>['map','rng'].includes(k)?undefined:v);
 g.rng=()=>{throw Error('Rejected phase advance cannot roll dice');};
 assert(!g.nextPhase().ok);
 assert.equal(JSON.stringify(g,(k,v)=>['map','rng'].includes(k)?undefined:v),before);
});
test('AGoAC p.6: weapon declarations and facing commitments cannot change after selection',()=>{
 const g=fresh(),[u,ally,a,b]=g.units;
 for(const tile of g.tiles)Object.assign(tile,{type:'plain',depth:0,height:0,surface:0});
 Object.assign(u,{q:0,r:0,facing:0});Object.assign(a,{q:1,r:0});Object.assign(b,{q:2,r:0});Object.assign(ally,{q:-2,r:0});
 g.phase='fire';g.initiativeWinner=1;g.buildQueue();
 assert(g.twist(u.id,1).ok);
 const shot=u.weapons.findIndex((w,i)=>g.preview(u.id,a.id,i).legal);
 assert(shot>=0);g.rng=()=>{throw Error('Declaration cannot roll dice');};
 const before=g.phaseRolls.length;
 assert(g.attack(u.id,a.id,[shot]).ok);
 assert.equal(g.phaseRolls.length,before);assert.equal(g.declarations.length,1);
 const declaration=JSON.stringify(g.declarations),twist=u.twist,flip=u.flip;
 assert(!g.attack(u.id,b.id,[shot]).ok);
 assert(!g.twist(u.id,0).ok);assert(!g.flipArms(u.id,true).ok);
 assert(!g.hold(u.id).ok);assert(!g.nextPhase().ok);
 assert.equal(JSON.stringify(g.declarations),declaration);assert.equal(u.twist,twist);assert.equal(u.flip,flip);
 while(g.queue.length){const v=g.units.find(v=>g.canAct(v));assert(v);assert(g.hold(v.id).ok);}
 assert.equal(g.declarations.length,1);assert.equal(g.phase,'fire');
});
test('AGoAC p.7: End Phase restores torso and arm orientation and starts a fresh selection cycle',()=>{
 const g=fresh(),[a,b]=g.units;
 for(const tile of g.tiles)Object.assign(tile,{type:'plain',depth:0,height:0,surface:0});
 g.phase='end';g.queue=[];g.activeTeam=null;
 for(const u of g.units)Object.assign(u,{moved:true,fired:true,physicalDone:true,moveMode:'walk',spent:2,distanceMoved:2});
 a.twist=1;b.flip=true;
 const facing=g.units.map(u=>u.facing),oldRound=g.round;
 g.rng=()=>{throw Error('Resetting orientation has no dice cost');};
 assert(g.nextPhase().ok);
 assert.equal(g.phase,'initiative');assert.equal(g.round,oldRound+1);
 assert.deepEqual(g.units.map(u=>u.facing),facing);
 assert(g.units.every(u=>u.twist===0&&u.flip===false&&!u.moved&&!u.fired&&!u.physicalDone&&u.spent===0&&u.distanceMoved===0));
 const dice=[...diceFor(2),...diceFor(12)];g.rng=()=>{assert(dice.length);return dice.shift();};
 assert(g.nextPhase().ok);assert.equal(g.phase,'move');assert.equal(g.queue.length,4);assert.equal(g.activeTeam,0);
 assert.equal(dice.length,0);
});

test('AGoAC pp.6,40: damage from movement cannot contribute to the weapon phase 20-point PSR',()=>{
 const g=fresh(),u=g.units[0];g.phase='move';g.queue=[];g.activeTeam=null;
 g.rng=()=>{throw Error('Damage below 20 in either phase cannot trigger a PSR');};
 g.damage(u,'CT',19);assert.equal(u.phaseDamage,19);
 assert(g.nextPhase().ok);assert.equal(g.phase,'fire');assert.equal(u.phaseDamage,0);
 g.damage(u,'CT',1);assert.equal(u.phaseDamage,1);
 while(g.queue.length){const v=g.units.find(v=>g.canAct(v));assert(v);assert(g.hold(v.id).ok);}
 assert(g.nextPhase().ok);assert.equal(g.phase,'physical');assert.equal(u.phaseDamage,0);
 assert.equal(u.prone,false);assert(!g.phaseRolls.some(r=>r.kind.includes('20+ урона')));
});
test('AGoAC pp.6,40: unresolved movement damage checks finish before weapon declarations',()=>{
 const g=fresh(),u=g.units[0];g.phase='move';g.queue=[];g.activeTeam=null;
 u.phaseDamage=20;u.psrs.push({modifier:0,reason:'Актуатор LL'});
 const dice=[...diceFor(12),...diceFor(12)];g.rng=()=>{assert(dice.length);return dice.shift();};
 assert(g.nextPhase().ok);assert.equal(g.phase,'fire');assert.equal(dice.length,0);
 assert.equal(u.phaseDamage,0);assert.deepEqual(u.psrs,[]);
 assert(u.prone===false);assert.equal(g.afterRolls.length,2);
 assert(g.afterRolls.every(r=>r.target===u.piloting+1));
 assert.deepEqual(g.phaseRolls.map(r=>r.kind),g.afterRolls.map(r=>r.kind));
});

function strandedBipeds(){
 const g=fresh();
 for(const tile of g.tiles)Object.assign(tile,{type:'plain',depth:0,height:0,surface:0});
 for(const u of g.units){
  Object.assign(u,{config:'Biped',prone:true,heat:0,shutdown:false,unconscious:false});
  u.structure.LL=0;u.structure.RL=0;
  for(const w of u.weapons)w.destroyed=true;
 }
 Object.assign(g.units[0],{q:0,r:0,facing:0});
 Object.assign(g.units[2],{q:1,r:0,facing:3});
 return g;
}
test('AGoAC pp.7,25: permanently prone Mechs with only intact arms cannot prevent a draw',()=>{
 const g=strandedBipeds();
 assert(g.units.every(u=>!g.canEverMove(u)&&u.structure.LA>0&&u.structure.RA>0));
 assert(g.units.every(u=>!g.canEverDamage(u,g.units.filter(t=>t.team!==u.team))));
 g.checkWin({stalemate:true});assert.equal(g.winner,'draw');
});
test('AGoAC pp.7,19: permanently prone bipeds may prevent a draw with legal torso weapons but not leg weapons or a destroyed arm',()=>{
 const g=strandedBipeds(),u=g.units[0],w=u.weapons[0];
 Object.assign(w,{destroyed:false,location:'CT',locations:['CT'],ammo:null,ranges:[3,6,9]});
 g.checkWin({stalemate:true});assert.equal(g.winner,null);
 u.structure.RA=0;
 g.checkWin({stalemate:true});assert.equal(g.winner,'draw');
 const other=strandedBipeds(),v=other.units[0];
 Object.assign(v.weapons[0],{destroyed:false,location:'LL',locations:['LL'],ammo:null,ranges:[3,6,9]});
 other.checkWin({stalemate:true});assert.equal(other.winner,'draw');
});
test('AGoAC p.7: a prone Mech that can recover must not trigger a premature draw',()=>{
 const g=strandedBipeds(),u=g.units[0];u.structure.LL=1;
 assert(g.canEverMove(u));
 g.checkWin({stalemate:true});assert.equal(g.winner,null);
});

function fixedStandingBipeds(){
 const g=fresh();
 for(const tile of g.tiles)Object.assign(tile,{type:'plain',depth:0,height:0,surface:0});
 for(const u of g.units){
  Object.assign(u,{config:'Biped',prone:false,jump:0,heat:0,shutdown:false,unconscious:false});
  u.structure.LA=0;u.structure.RA=0;
  u.actuators.LL.hip=true;u.actuators.RL.hip=true;
  for(const w of u.weapons)w.destroyed=true;
 }
 Object.assign(g.units[0],{q:0,r:0,facing:0});
 Object.assign(g.units[2],{q:1,r:0,facing:3});
 return g;
}
test('AGoAC pp.7,28–29: intact but unusable legs and arms do not prevent stalemate',()=>{
 const g=fixedStandingBipeds();
 assert(g.units.every(u=>!g.canEverMove(u)));
 assert(g.units.every(u=>!g.canEverDamage(u,g.units.filter(t=>t.team!==u.team))));
 g.checkWin({stalemate:true});assert.equal(g.winner,'draw');
 const one=fixedStandingBipeds(),u=one.units[0];
 u.structure.LA=1;u.actuators.LA.shoulder=true;
 one.checkWin({stalemate:true});assert.equal(one.winner,'draw');
});
test('AGoAC pp.7,28–29: available punch or two-arm push prevents premature stalemate',()=>{
 for(const twoArms of [false,true]){
  const g=fixedStandingBipeds(),u=g.units[0];u.structure.LA=1;
  if(twoArms){u.structure.RA=1;u.actuators.LA.shoulder=true;u.actuators.RA.shoulder=true;}
  assert(g.canEverDamage(u,[g.units[2]]));
  g.checkWin({stalemate:true});assert.equal(g.winner,null);
 }
});
test('AGoAC pp.7,19: immobile units separated by water cannot exchange weapon fire',()=>{
 const g=fixedStandingBipeds(),u=g.units[0],v=g.units[2];
 Object.assign(v,{q:2,r:0});
 Object.assign(g.tile(v.q,v.r),{type:'water',depth:2,height:-2,surface:0});
 for(const x of [g.units[1],g.units[3]])x.dead=true;
 const w=u.weapons[0];Object.assign(w,{name:'Medium Laser',destroyed:false,location:'CT',locations:['CT'],ammo:null,ranges:[3,6,9]});
 const z=v.weapons[0];Object.assign(z,{name:'Medium Laser',destroyed:false,location:'CT',locations:['CT'],ammo:null,ranges:[3,6,9]});
 assert(!g.canEverDamage(u,[v]));assert(!g.canEverDamage(v,[u]));
 g.checkWin({stalemate:true});assert.equal(g.winner,'draw');
 const same=fixedStandingBipeds(),a=same.units[0],b=same.units[2];
 Object.assign(b,{q:2,r:0});
 for(const x of [same.units[1],same.units[3]])x.dead=true;
 Object.assign(a.weapons[0],{name:'Medium Laser',destroyed:false,location:'CT',locations:['CT'],ammo:null,ranges:[3,6,9]});
 same.checkWin({stalemate:true});assert.equal(same.winner,null);
});

test('AGoAC pp.7,13,21: immutable high ridge prevents direct fire but preserves possible indirect fire',()=>{
 const g=fixedStandingBipeds(),u=g.units[0],v=g.units[2];
 g.units[1].dead=true;g.units[3].dead=true;
 Object.assign(u,{q:-2,r:0});Object.assign(v,{q:2,r:0});
 const hill=g.tile(0,0);Object.assign(hill,{type:'hill',height:3,depth:0,surface:3});
 const w=u.weapons[0];Object.assign(w,{name:'Medium Laser',destroyed:false,location:'CT',locations:['CT'],ammo:null,rack:0,ranges:[3,6,9]});
 assert(g.permanentHillBlocks(u,v));assert(g.permanentHillBlocks(v,u));
 assert(!g.canEverDamage(u,[v]));
 // No other friendly unit is alive, so even an LRM cannot fire.
 Object.assign(w,{name:'LRM-5',rack:5});
 assert(!g.canEverDamage(u,[v]));
 const spotter=g.units[1];
 Object.assign(spotter,{dead:false,q:2,r:-1});
 assert(g.canEverDamage(u,[v]));
 spotter.dead=true;
 Object.assign(w,{name:'Medium Laser',rack:0});
 hill.height=1;hill.surface=1;assert(g.canEverDamage(u,[v]));
 hill.height=3;hill.surface=3;
 g.checkWin({stalemate:true});assert.equal(g.winner,'draw');
});
test('AGoAC pp.7,19–21: permanently prone fixed-facing Mechs cannot use an out-of-arc weapon',()=>{
 const g=strandedBipeds(),u=g.units[0],v=g.units[2];
 g.units[1].dead=true;g.units[3].dead=true;
 Object.assign(u,{q:0,r:0,facing:3});Object.assign(v,{q:2,r:0});
 const w=u.weapons[0];Object.assign(w,{name:'Medium Laser',destroyed:false,location:'CT',locations:['CT'],ammo:null,rack:0,rear:false,ranges:[3,6,9]});
 const before=JSON.stringify(u);
 assert(!g.canEverDamage(u,[v]));assert.equal(JSON.stringify(u),before);
 w.rear=true;assert(g.canEverDamage(u,[v]));
 w.rear=false;u.facing=0;assert(g.canEverDamage(u,[v]));
 u.facing=3;g.checkWin({stalemate:true});assert.equal(g.winner,'draw');
});


test('AGoAC pp.7,13: an adjacent immutable hill blocks fire independently of the distant Mech height',()=>{
 const g=fixedStandingBipeds(),u=g.units[0],v=g.units[2];
 g.units[1].dead=true;g.units[3].dead=true;
 Object.assign(u,{q:-2,r:0});Object.assign(v,{q:2,r:0});
 Object.assign(g.tile(v.q,v.r),{type:'hill',height:4,surface:4});
 const near=g.tile(-1,0),middle=g.tile(0,0);
 Object.assign(near,{type:'hill',height:2,surface:2});
 const w=u.weapons[0];Object.assign(w,{name:'Medium Laser',destroyed:false,location:'CT',locations:['CT'],ammo:null,rack:0,indirect:false,ranges:[3,6,9]});
 assert(g.permanentHillBlocks(u,v));assert(g.permanentHillBlocks(v,u));
 assert(g.los(u,v).blocked);assert(g.los(v,u).blocked);
 assert(!g.canEverDamage(u,[v]));
 near.height=1;near.surface=1;assert(!g.permanentHillBlocks(u,v));assert(g.canEverDamage(u,[v]));
 near.height=0;near.surface=0;middle.height=2;middle.surface=2;
 assert(!g.permanentHillBlocks(u,v));assert(g.canEverDamage(u,[v]));
 middle.height=0;middle.surface=0;near.height=2;near.surface=2;
 g.checkWin({stalemate:true});assert.equal(g.winner,'draw');
});


test('AGoAC pp.7,21: blocked LRM needs another possible spotter and SRM cannot fire indirectly',()=>{
 const g=fixedStandingBipeds(),u=g.units[0],s=g.units[1],v=g.units[2];
 g.units[3].dead=true;
 Object.assign(u,{q:-2,r:0});Object.assign(s,{q:-1,r:0});Object.assign(v,{q:2,r:0});
 Object.assign(g.tile(0,0),{type:'hill',height:3,depth:0,surface:3});
 const w=u.weapons[0];Object.assign(w,{name:'LRM-5',destroyed:false,location:'CT',locations:['CT'],ammo:null,rack:5,ranges:[3,6,9]});
 assert(!g.canEverDamage(u,[v]));
 Object.assign(s,{q:2,r:-1});assert(g.canEverDamage(u,[v]));
 s.abandoned=true;assert(!g.canEverDamage(u,[v]));s.abandoned=false;
 s.dead=true;assert(!g.canEverDamage(u,[v]));s.dead=false;
 w.name='SRM-6';w.rack=6;assert(!g.canEverDamage(u,[v]));
 w.name='LRM-5';w.rack=5;s.dead=true;
 g.checkWin({stalemate:true});assert.equal(g.winner,'draw');
});


test('AGoAC pp.7,25: fixed adjacent Mechs separated by more than one level cannot make ordinary physical attacks',()=>{
 for(const level of [-2,-1,0,1,2]){
  const g=fixedStandingBipeds(),u=g.units[0],v=g.units[2];
  g.units[1].dead=true;g.units[3].dead=true;
  u.structure.LA=1;u.structure.RA=1;
  Object.assign(g.tile(v.q,v.r),{type:'hill',height:level,surface:level});
  assert(!g.canEverMove(u));assert(!g.canEverMove(v));
  assert.equal(g.canEverDamage(u,[v]),Math.abs(level)<=1);
  g.checkWin({stalemate:true});assert.equal(g.winner,Math.abs(level)>1?'draw':null);
 }
});


test('AGoAC pp.7,25,28–29: fixed biped physical attack capability respects facing and intact limbs',()=>{
 const g=fixedStandingBipeds(),u=g.units[0],v=g.units[2];
 g.units[1].dead=true;g.units[3].dead=true;
 Object.assign(u,{q:0,r:0,facing:0});Object.assign(v,{q:1,r:0});
 u.structure.LA=1;u.structure.RA=1;
 assert(g.canEverDamage(u,[v]));
 u.facing=3;assert(!g.canEverDamage(u,[v]));
 u.twist=1;assert(!g.canEverDamage(u,[v]));
 g.checkWin({stalemate:true});assert.equal(g.winner,'draw');
});


test('AGoAC p.15: split arm-torso weapon prevents arm reversal and reversed arms cannot twist',()=>{
 const g=fresh(),u=g.units[0];
 g.phase='fire';g.initiativeWinner=1;g.buildQueue();
 for(const l of ['LA','RA']){u.slots[l][2]=null;u.slots[l][3]=null;}
 const w=u.weapons[0];w.locations=['LA','LT'];
 assert(!g.flipArms(u.id,true).ok);assert.equal(u.flip,false);
 w.locations=['LA'];
 assert(g.flipArms(u.id,true).ok);assert.equal(u.flip,true);
 assert(!g.twist(u.id,1).ok);assert.equal(u.twist,0);assert.equal(u.flip,true);
 assert(g.flipArms(u.id,false).ok);assert(g.twist(u.id,1).ok);
});


test('AGoAC pp.7,19: permanently submerged prone targets and depth-one leg weapons cannot fire across the water surface',()=>{
 const g=fixedStandingBipeds(),u=g.units[0],v=g.units[2];
 g.units[1].dead=true;g.units[3].dead=true;
 Object.assign(u,{q:0,r:0,facing:0});Object.assign(v,{q:2,r:0,prone:true});
 Object.assign(g.tile(v.q,v.r),{type:'water',depth:1,height:-1,surface:0});
 Object.assign(u.weapons[0],{name:'Medium Laser',destroyed:false,location:'CT',locations:['CT'],ammo:null,ranges:[3,6,9]});
 assert(!g.canEverMove(v));assert(!g.canEverDamage(u,[v]));
 v.prone=false;assert(g.canEverDamage(u,[v]));
 const h=fixedStandingBipeds(),a=h.units[0],b=h.units[2];
 h.units[1].dead=true;h.units[3].dead=true;
 Object.assign(a,{q:0,r:0,facing:0});Object.assign(b,{q:2,r:0});
 Object.assign(h.tile(a.q,a.r),{type:'water',depth:1,height:-1,surface:0});
 Object.assign(a.weapons[0],{name:'Medium Laser',destroyed:false,location:'LL',locations:['LL'],ammo:null,ranges:[3,6,9]});
 assert(!h.canEverDamage(a,[b]));
 Object.assign(a.weapons[0],{location:'CT',locations:['CT']});assert(h.canEverDamage(a,[b]));
});


test('AGoAC pp.6–7: victory terminates the current phase without announcing or executing a following phase',()=>{
 for(const [phase,method] of [['fire','resolveFire'],['physical','resolvePhysical'],['heat','heatPhase'],['end','endPhase']])for(const result of [0,1,'draw']){
  const g=fresh();g.phase=phase;g.queue=[];g.activeTeam=null;g.actingId=null;
  let calls=0;
  g[method]=()=>{calls++;for(const u of g.units)if(result==='draw'||u.team!==result)g.destroyMech(u);g.removeDestroyedMechs();};
  assert(g.nextPhase().ok);assert.equal(g.winner,result,phase);assert.equal(g.phase,phase);
  assert.equal(g.activeTeam,null);assert.equal(g.actingId,null);assert.equal(calls,1);
  const old=JSON.stringify({phase:g.phase,round:g.round,log:g.log,queue:g.queue});
  assert(!g.nextPhase().ok);assert.equal(calls,1);assert.equal(JSON.stringify({phase:g.phase,round:g.round,log:g.log,queue:g.queue}),old);
 }
});
