import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Game,defaultMechWarriorSkills,DIRS,distance,AGOAC_PRINTED_SCENARIOS,AGOAC_SCALE,rangeMeters,elapsedBattleSeconds,normalizeMapHex} from '../dist/engine.js';
import {recordSheet} from '../dist/record-sheet.js';
import {firingArcTiles} from '../dist/fire-arcs.js';
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
  if(q.topicId==='agoac-hit-location'){
   const gate=q.audit.mainQualityGate;
   assert(gate,q.id+' missing main Quality Gate evidence');
   assert.equal(gate.name,'Ironhex SonarQube');
   assert.equal(gate.headSha,q.audit.mergedSha);
   assert.equal(gate.conclusion,'success');
   assert(Number.isSafeInteger(gate.runId)&&Number.isSafeInteger(gate.jobId));
  }
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
  // Build a damaged fixture while prone: genuine immediate leg-loss
  // falls must not add wounds/dice before the separate seatbelt assertion.
  u.prone=true;
  for(let i=0;i<4;i++)if(mask&(1<<i))g.destroyLocation(u,limbs[i]);
  u.prone=false;u.psrs=[];u.phaseDamage=0;
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
  // Destruction setup happens prone to avoid an earlier automatic fall.
  u.prone=true;
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
test('AGoAC p.29: prohibited push retains positions and queues a phase-end PSR',()=>{
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
  const expected=submerged?14:28;
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
test('CAT3500D p.41: PSR situation table modifiers use the printed target numbers',()=>{
 const cases=[
  ['Удар ногой',0],['Толчок',0],['Промах ногой',0],
  ['Таран',2],['Попадание тарана',2],
  ['Посадка DFA',4],['Попадание DFA',2],
  ['Подъём',0],['Обломки',0],
  ['Вода глубина 1',-1],['Вода глубина 2',0],['Вода глубина 3',1],
  ['Отключение реактора',3]
 ];
 for(const [reason,modifier] of cases){
  const g=fresh(),u=g.units[0];
  for(const other of g.units.slice(1))other.dead=true;
  u.piloting=5;g.rng=()=>.99;
  assert.equal(g.psr(u,modifier,reason,true,0,reason==='Отключение реактора'),true,reason);
  assert.equal(g.phaseRolls.at(-1).target,5+modifier,reason);
 }
 for(const [source,setup,expected] of [
  ['gyro hit',u=>{u.gyroHits=1;},3],
  ['hip hit',u=>{u.actuators.LL.hip=true;},2],
  ['lower leg actuator',u=>{u.actuators.LL.lower=true;},1],
  ['destroyed biped leg',u=>{u.structure.LL=0;},5],
  ['gyro and hip',u=>{u.gyroHits=1;u.actuators.LL.hip=true;},5]
 ]){
  const g=fresh(),u=g.units[0];for(const other of g.units.slice(1))other.dead=true;
  u.piloting=5;setup(u);g.rng=()=>.99;
  assert.equal(g.psrMod(u,true),expected,source);
  assert.equal(g.psr(u,0,source,true),true,source);
  assert.equal(g.phaseRolls.at(-1).target,5+expected,source);
 }
 // Every PSR at the end of one attack phase shares the cumulative TN.
 // The 20+ damage row adds only one event, even if more than 20 was taken.
 const g=fresh(),u=g.units[0];
 for(const other of g.units.slice(1))other.dead=true;
 u.piloting=5;u.phaseDamage=43;
 u.psrs.push({modifier:0,reason:'Удар ногой'},{modifier:2,reason:'Попадание тарана'});
 g.rng=()=>.99;
 g.endPSR();
 assert.equal(g.phaseRolls.length,3);
 assert.deepEqual(g.phaseRolls.map(r=>r.target),[8,8,8]);
 assert.deepEqual(u.psrs,[]);
 assert.equal(u.phaseDamage,0);
});

test('CAT3500D pp.42-43: all six falling facings select the exact new hexside and hit-location arc',()=>{
 const arcs=['front','right','right','rear','left','left'];
 for(let die=1;die<=6;die++){
  const g=fresh(),u=g.units[0],before=4;
  for(const v of g.units.slice(1))v.dead=true;
  Object.assign(u,{facing:before,tonnage:65});
  const sequence=[(die-.5)/6,...diceFor(12)],impacts=[];
  g.rng=()=>{assert(sequence.length,'Unexpected additional die');return sequence.shift();};
  g.packets=(victim,damage,side)=>{assert.equal(victim,u);impacts.push([damage,side]);};
  g.fall(u,0);
  assert.equal(u.prone,true);
  assert.equal(u.facing,(before-(die-1)+6)%6);
  assert.equal(u.lastFallSide,arcs[die-1]);
  assert.deepEqual(impacts,[[7,arcs[die-1]]]);
  assert.equal(sequence.length,0);
 }
});

test('CAT3500D p.43: dry falling damage matches tonnage, level and exact 5-point packets',()=>{
 for(const tonnage of [20,25,50,65,70,85,100])for(const levels of [0,1,2,3,4]){
  const g=fresh(),u=g.units[0],packets=[];
  for(const v of g.units.slice(1))v.dead=true;
  Object.assign(u,{q:0,r:0,tonnage,facing:0});
  Object.assign(g.tile(0,0),{type:'plain',height:0,depth:0,surface:0});
  g.rng=()=>.99;
  g.hit=(victim,damage,side,table)=>{
   assert.equal(victim,u);assert.equal(side,'left');
   packets.push(damage);return {damage,hits:[]};
  };
  g.fall(u,levels);
  const expected=Math.ceil(tonnage/10)*(levels+1);
  const expectedPackets=Array(Math.floor(expected/5)).fill(5);
  if(expected%5)expectedPackets.push(expected%5);
  assert.deepEqual(packets,expectedPackets,
   'Dry fall tonnage='+tonnage+' levels='+levels);
  assert.equal(u.prone,true);
 }
});

test('CAT3500D p.44 + errata v8.01: accidental impact uses corrected standing/prone level and submersion matrix',()=>{
 for(const drop of [2,3,5])for(const tonnage of [20,65,85])
 for(const prone of [false,true])for(const depth of [0,1,2]){
  const g=fresh(),[u,target,a,b]=g.units,impacts=[],falls=[],checks=[];
  for(const tile of g.tiles)Object.assign(tile,{type:'plain',height:0,depth:0,surface:0});
  Object.assign(u,{q:0,r:0,tonnage,facing:0});
  Object.assign(target,{q:1,r:0,prone,facing:3,distanceMoved:0,moveMode:'walk'});
  a.dead=b.dead=true;
  Object.assign(g.tile(0,0),{height:drop,surface:drop});
  Object.assign(g.tile(1,0),{type:depth?'water':'plain',depth,surface:depth?depth:0});
  g.rng=()=>.99;
  g.hit=(victim,amount,side,table)=>{
   assert.equal(victim,target);assert.equal(table,'punch');
   impacts.push(amount);return {damage:amount,hits:[]};
  };
  g.fall=(victim,levels,tn,side)=>{falls.push([victim.id,levels,side]);victim.prone=true;};
  g.psr=(victim,modifier,reason,immediate)=>{checks.push([victim.id,modifier,reason,immediate]);return true;};
  assert(g.displace(u,0));
  const base=Math.ceil(tonnage/10)*(drop-(prone?0:1));
  const expected=depth>=(prone?1:2)?Math.floor(base/2):base;
  const expectedPackets=Array(Math.floor(expected/5)).fill(5);
  if(expected%5)expectedPackets.push(expected%5);
  assert.deepEqual(impacts,expectedPackets,
   'Impact drop='+drop+' tonnage='+tonnage+' prone='+prone+' depth='+depth);
  assert.deepEqual(falls,[[u.id,drop,'rear']]);
  assert.deepEqual(checks,[[target.id,2,'Падение сверху',true]]);
  assert.notDeepEqual([u.q,u.r],[target.q,target.r]);
 }
});

test('CAT3500D p.44: struck target random legal displacement and forbidden-hex destruction',()=>{
 for(const choice of ['first','last','blocked']){
  const g=fresh(),[falling,target,a,b]=g.units;
  for(const hex of g.tiles)Object.assign(hex,{type:'plain',height:4,depth:0,surface:4});
  Object.assign(falling,{q:0,r:0,facing:0,tonnage:20});
  Object.assign(target,{q:1,r:0,facing:3,prone:false});
  a.dead=b.dead=true;
  Object.assign(g.tile(0,0),{height:5,surface:5});
  Object.assign(g.tile(1,0),{height:0,surface:0});
  const neighbors=DIRS.map(([dq,dr])=>g.tile(1+dq,dr))
   .filter(hex=>hex&&!(hex.q===0&&hex.r===0));
  assert(neighbors.length>=2);
  if(choice!=='blocked')for(const hex of neighbors.slice(0,2))
   Object.assign(hex,{height:0,surface:0});
  const legal=g.fallNeighborOptions(g.tile(1,0));
  assert.equal(legal.length,choice==='blocked'?0:2);
  const hits=[],falls=[],checks=[];
  g.hit=(victim,amount,side,table)=>{
   assert.equal(victim,target);assert.equal(table,'punch');
   hits.push(amount);return {damage:amount,hits:[]};
  };
  g.fall=(victim,levels,tn,side)=>{
   falls.push([victim.id,levels,side]);victim.prone=true;
  };
  g.psr=(victim,modifier,reason,immediate)=>{
   checks.push([victim.id,modifier,reason,immediate]);return true;
  };
  g.rng=()=>choice==='first'?0.01:0.99;
  g.accidentalFallHit(falling,target,g.tile(0,0),g.tile(1,0),0);
  assert.deepEqual(hits,[5,3]);
  assert.deepEqual(falls,[[falling.id,5,'rear']]);
  assert.deepEqual([falling.q,falling.r],[1,0]);
  if(choice==='blocked'){
   assert.equal(target.dead,true);
   assert.deepEqual(checks,[]);
  }else{
   const expected=legal[choice==='first'?0:1].tile;
   assert.equal(target.dead,false);
   assert.deepEqual([target.q,target.r],[expected.q,expected.r]);
   assert.deepEqual(checks,[[target.id,2,'Падение сверху',true]]);
  }
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
test('AGoAC pp.29,30,42,44: push displacement permits a later kick before defender phase-end fall',()=>{
 const g=fresh(),[pusher,kicker,t,other]=g.units;
 for(const tile of g.tiles)Object.assign(tile,{type:'plain',height:0,depth:0,surface:0});
 Object.assign(pusher,{q:-1,r:0,facing:0});
 Object.assign(kicker,{q:1,r:-1,facing:4});
 Object.assign(t,{q:0,r:0,facing:3,pilotWounds:5,unconscious:false});
 g.phase='physical';g.initiativeWinner=1;g.queue=[];g.activeTeam=null;
 const push=g.physicalPreview(pusher.id,t.id,'push','LA'),kick=g.physicalPreview(kicker.id,t.id,'kick','RL');
 assert(push.legal,push.reason);assert(kick.legal,kick.reason);
 g.physicalDeclarations=[{id:pusher.id,target:t.id,type:'push',limb:'LA',...push},{id:kicker.id,target:t.id,type:'kick',limb:'RL',...kick}];
 // Successful push first. Any later PSR and injury rolls deliberately
 // fail; unlike displacement, the fall itself occurs only at phase-end.
 let draws=0,kickRolls=0;const events=[];
 g.rng=()=>draws++<2?.99:.01;
 const realRoll=g.roll.bind(g);
 g.roll=(name,tn)=>{
  if(name===kicker.name+' · kick'){kickRolls++;events.push('kick');}
  return realRoll(name,tn);
 };
 const realFall=g.fall.bind(g);
 g.fall=(victim,...args)=>{
  if(victim===t)events.push('fall');
  return realFall(victim,...args);
 };
 const originalWound=g.wound.bind(g);let deathObserved=false;
 g.wound=(victim,n)=>{
  originalWound(victim,n);
  if(victim===t&&t.dead){
   assert.equal(t.pilotWounds,6);assert.equal(g.onMap(t),true);
   assert.equal(g.occupied(t.q,t.r),true);assert.deepEqual([t.q,t.r],[1,0]);
   deathObserved=true;
  }
 };
 assert(g.nextPhase().ok);assert(deathObserved);assert.equal(kickRolls,1);
 assert(events.includes('fall')&&events.indexOf('kick')<events.indexOf('fall'),
  'the still-legal kick must resolve before the defender checks for falling');
 const shot=g.resolution.find(r=>r.id===kicker.id).shots[0];
 assert.equal(shot.cancelled,false);assert.equal(shot.roll,2);
 assert.equal(shot.hit,false);assert.equal(shot.damage,0);
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

test('CAT3500D p.39: heat ammo explosion automatically selects the same-type bin with most shots',()=>{
 const g=fresh(),u=g.units[0];
 g.phase='heat';g.queue=[];g.activeTeam=null;
 for(const tile of g.tiles)Object.assign(tile,{type:'plain',depth:0,height:0,surface:0});
 const base=u.bins[0],other=base.location==='LT'?'RT':'LT';
 u.bins=[{...base,shots:1},{...base,location:other,slot:11,shots:5}];
 u.prone=true;u.shutdown=true;u.voluntaryShutdown=true;u.heat=19+u.sinks;u.pendingHeat=0;
 let draws=0;g.rng=()=>{draws++;return 0;};
 assert(g.nextPhaseWithChoices({humanTeams:[0]}).ok);
 const resolved=g.units[0];
 assert.equal(g.pendingChoice,null,'same-type bins are never a controller choice');
 assert(draws>=2,'the explosion check rolls two dice before any wound consciousness rolls');
 assert.equal(resolved.bins[0].shots,1);
 assert.equal(resolved.bins[1].destroyed,true);
 assert.equal(resolved.bins[1].shots,0);
 assert.equal(g.phaseRolls.filter(r=>r.kind.includes('Перегрев боезапаса')).length,1);
 assert.equal(resolved.dead,true,'five full ammunition shots destroy the chassis');
 assert.equal(resolved.pilotWounds,6,'lethal ammo transfer kills the pilot after the explosion wounds');
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

test('AGoAC p.33 errata v8.01: biped hip damage rounds Walking MP upward before penalties',()=>{
 for(const leg of ['LL','RL'])for(let base=0;base<=12;base++)for(const heat of [0,5,10,25]){
  const g=fresh(),u=g.units[0];u.walk=base;u.heat=heat;
  u.actuators[leg].hip=true;
  const walk=Math.max(0,Math.ceil(base/2)-Math.min(5,Math.floor(heat/5)));
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
 hit('LL',0);assert.equal(g.mp(u),3);assert.equal(g.psrMod(u),3); // Same-phase lower leg damage remains cumulative.
 // The lower-leg hit in round 2 remains relevant even in later rounds.
 g.round=3;assert.equal(g.mp(u),3);
 hit('LL',3);assert.equal(g.mp(u),2);assert.equal(g.psrMod(u),4);
 hit('RL',1);assert.equal(g.mp(u),1);assert.equal(g.psrMod(u),5);
 assert.deepEqual(u.actuatorHitRounds,{LL:{upper:1,lower:2,hip:2,foot:3},RL:{upper:3}});
 const restored=new Game({rng:()=>.5});
 Object.assign(restored,JSON.parse(JSON.stringify(g,(k,v)=>['map','rng'].includes(k)?undefined:v)));
 restored.rebuildMap();assert.equal(restored.mp(restored.unit(u.id)),1);
 assert.equal(restored.psrMod(restored.unit(u.id)),5);
});
test('AGoAC p.33 errata v8.01: hip movement permits only the rounded-up MP budget',()=>{
 const g=fresh(),u=g.units[0];g.phase='move';g.activeTeam=0;g.queue=[0,1,0,1];
 Object.assign(u,{q:0,r:0,facing:0,walk:5,heat:0,moveStart:{q:0,r:0}});
 for(const t of g.tiles)Object.assign(t,{type:'plain',depth:0,height:0,surface:0});
 u.actuators.LL.hip=true;
 assert(g.reachable(u,'walk').some(p=>p.q===2&&p.r===0));
 assert(g.reachable(u,'walk').some(p=>p.q===3&&p.r===0));
 assert(!g.reachable(u,'walk').some(p=>p.q===4&&p.r===0));
 assert(g.reachable(u,'run').some(p=>p.q===5&&p.r===0));
 assert(!g.reachable(u,'run').some(p=>p.q===6&&p.r===0));
 const before=JSON.stringify(u);assert.equal(g.move(u.id,6,0,'run').ok,false);
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
  g.rng=()=>{throw Error('no critical roll on destroyed non-ammo torso');};
  g.damage(u,side,u.structure[side],{internal:true});
  assert.equal(u.engineHits,count);assert.equal(u.structure[side],0);
  assert(u.crit[side].every(Boolean));assert.equal(u.dead,count===3);
  assert.equal(u.structure[side==='LT'?'LA':'RA'],0);
  assert.equal(u.pilotWounds,0);
  g.destroyLocation(u,side);assert.equal(u.engineHits,count);
  if(count===3){assert(g.onMap(u));g.removeDestroyedMechs();assert(!g.onMap(u));}
 }
});
test('AGoAC pp.33–34: section destruction counts all sink and jump slots without a false critical roll',()=>{
 for(const type of ['sink','jump']){
  const g=fresh(),u=g.units[0],loc='LT';
  u.slots[loc]=[type,type,...Array(10).fill(null)];u.crit[loc]=Array(12).fill(false);
  g.rng=()=>{throw Error('no destroyed-section critical roll without ammunition');};
  g.damage(u,loc,u.structure[loc],{internal:true});
  const field=type==='sink'?'sinksLost':'jumpLost';assert.equal(u[field],2);g.destroyLocation(u,loc);assert.equal(u[field],2);
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
 const checks=[],falls=[];
 g.psr=(v,mod,reason,immediate)=>{checks.push([v.id,mod,reason,immediate]);return true;};
 g.fall=(v,levels,tn)=>{assert.equal(v,u);falls.push([levels,tn]);v.prone=true;};
 // All four gyro slots can be marked, but only two have gameplay effects.
 for(const [i,slot] of [3,4,5,6].entries()){
  const dice=[...diceFor(8),slot<6?.5/6:5.5/6,((slot%6)+.5)/6];
  g.rng=()=>{assert(dice.length);return dice.shift();};
  g.criticalHit(u,'CT');assert.equal(dice.length,0);assert(u.crit.CT[slot]);
  assert.equal(u.gyroHits,Math.min(i+1,2));assert.equal(g.psrMod(u),3*Math.min(i+1,2));
 }
 assert.deepEqual(checks,[[u.id,0,'Гироскоп',true]],'first gyro PSR resolves immediately as corrected by errata');
 assert.deepEqual(falls,[[0,u.piloting+6]],'second gyro hit causes immediate forced fall');
 g.rng=()=>{throw Error('Gyro PSR must not be rolled again at the phase boundary');};g.endPSR();
 assert.equal(falls.length,1);assert(u.prone);assert(!g.isImmobile(u));
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
 assert.equal(river.tile(3,0).type,'bridge');assert.equal(river.tile(0,0).depth,2);assert.equal(river.terrainCost(river.tile(0,0)),4);
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


test('AGoAC p.7: optional agreed pregame victory terms are locked and checked only after a complete round',()=>{
 const g=fresh();assert.equal(g.victoryTerms,null);
 for(const [roundLimit,approvals] of [[0,[true,true]],[1001,[true,true]],[1.5,[true,true]],[2,[true,false]],[2,[true]],[2,[1,1]]]){
  assert(!g.configureVictoryTerms({roundLimit,approvals}).ok);assert.equal(g.victoryTerms,null);
 }
 const approvals=[true,true];assert(g.configureVictoryTerms({roundLimit:2,approvals}).ok);approvals[0]=false;
 assert.deepEqual(g.victoryTerms,{roundLimit:2,approvals:[true,true]});assert(!g.configureVictoryTerms({roundLimit:4,approvals:[true,true]}).ok);
 g.phase='end';g.queue=[];g.activeTeam=null;assert(g.nextPhase().ok);assert.equal(g.round,2);assert.equal(g.winner,null);
 g.checkWin();assert.equal(g.winner,null);
 g.phase='end';assert(g.nextPhase().ok);assert.equal(g.winner,'draw');assert.equal(g.phase,'end');assert(g.log.some(x=>x.includes('лимит раундов')));
 assert(!g.nextPhase().ok);g.reset();assert.equal(g.victoryTerms,null);
 const started=fresh();assert(started.startStandardDeployment().ok);assert(!started.configureVictoryTerms({roundLimit:2,approvals:[true,true]}).ok);
 const win=fresh();assert(win.configureVictoryTerms({roundLimit:1,approvals:[true,true]}).ok);win.phase='end';win.queue=[];for(const u of win.units.filter(u=>u.team===1))win.destroyMech(u);assert(win.nextPhase().ok);assert.equal(win.winner,0);
 const standard=fresh();standard.round=1001;standard.checkWin({stalemate:true});assert.equal(standard.winner,null);
});


test('AGoAC pp.6–7: fire resolution restarts with initiative loser even after no-fire declarations',()=>{
 for(const winner of [0,1]){
  const g=fresh();g.phase='fire';g.initiativeWinner=winner;
  const losing=g.units.filter(u=>u.team!==winner),winning=g.units.filter(u=>u.team===winner);
  const shot=(target,name)=>({index:0,target:target.id,bin:null,aim:null,heatMode:false,
   weapon:{name,rack:0,ammo:null,heat:0,damage:1,location:'CT'},
   preview:{targetNumber:2,side:'front',cover:false,underwaterCover:false}});
  const empty={id:losing[0].id,shots:[]},firstWinner={id:winning[0].id,shots:[shot(losing[1],'W1')]},
   laterLoser={id:losing[1].id,shots:[shot(winning[0],'L2')]},secondWinner={id:winning[1].id,shots:[shot(losing[1],'W2')]};
  // The loser used its first selection without firing. Test both empty
  // declaration and hold (no declaration object) representations.
  for(const declarations of [[empty,firstWinner,laterLoser,secondWinner],[firstWinner,laterLoser,secondWinner]]){
   const actual=[];g.orderFireMechs(declarations,'roll',d=>actual.push(d.id));
   assert.deepEqual(actual,[losing[1].id,winning[0].id,winning[1].id]);
   const damage=[];g.orderFireMechs(declarations.map(d=>({id:d.id,attacks:d.shots.map(s=>({s,hit:false}))})),'damage',d=>damage.push(d.id));
   assert.deepEqual(damage,actual);
  }
  g.declarations=[empty,firstWinner,laterLoser,secondWinner];g.rng=()=>.99;
  g.hit=(target,damage)=>({location:'CT',damage,hits:[]});
  const results=g.resolveFire();
  assert.deepEqual(results.map(r=>r.id),[losing[1].id,winning[0].id,winning[1].id]);
  assert.equal(g.phaseRolls.length,3);
 }
});


test('AGoAC pp.6–7: ordinary physical resolution alternates grouped Mechs from initiative loser',()=>{
 for(const winner of [0,1]){
  const g=fresh();g.phase='physical';g.initiativeWinner=winner;
  const losing=g.units.filter(u=>u.team!==winner),winning=g.units.filter(u=>u.team===winner);
  const punch=(u,t,limb='LA')=>({id:u.id,target:t.id,type:'punch',limb,targetNumber:2,damage:1,side:'front',table:'punch'});
  const a=punch(losing[0],winning[0]),b=punch(winning[0],losing[0]),c=punch(losing[1],winning[1]),d=punch(winning[1],losing[1]),second={...a,limb:'RA'};
  g.physicalDeclarations=[b,d,a,c,second];
  assert.deepEqual(g.physicalOrder(),[a,second,b,c,d]);
  g.rng=()=>.99;const hits=[];
  g.hit=(target,damage)=>{hits.push(target.id);assert.equal(g.phaseRolls.length,5,'all ordinary attacks rolled first');return {location:'CT',damage,hits:[]};};
  assert.deepEqual(g.resolvePhysical().map(r=>r.id),[a.id,a.id,b.id,c.id,d.id]);
  assert.deepEqual(hits,[a.target,a.target,b.target,c.target,d.target]);
  g.physicalDeclarations=[b,d,c];
  assert.deepEqual(g.physicalOrder(),[c,b,d],'no-attack selection does not take the first resolution turn');
  const push={...a,type:'push'};g.physicalDeclarations=[b,c,push,d];
  assert.deepEqual(g.physicalOrder(),[c,b,push,d],'mixed displacement must retain the printed alternating declaration slots');
 }
});


test('AGoAC p.7: arbitrary pregame victory agreement is immutable and jointly adjudicated at a round boundary',()=>{
 const g=fresh();for(const bad of [{condition:' '},{condition:'a'.repeat(501)},{condition:'x',roundLimit:2},{condition:'x',approvals:[true,false]}])assert(!g.configureVictoryTerms({approvals:[true,true],...bad}).ok);
 assert(g.configureVictoryTerms({condition:'  Hold objective A  ',approvals:[true,true]}).ok);assert.equal(g.victoryTerms.condition,'Hold objective A');
 assert(!g.canAdjudicateVictory());assert(!g.adjudicateVictory({winner:0,approvals:[true,true]}).ok);
 assert(!g.configureVictoryTerms({condition:'Changed',approvals:[true,true]}).ok);
 g.phase='end';g.queue=[];assert(g.nextPhase().ok);assert.equal(g.round,2);assert(g.canAdjudicateVictory());
 for(const bad of [{winner:'0',approvals:[true,true]},{winner:0,approvals:[true,false]}])assert(!g.adjudicateVictory(bad).ok);
 assert(g.adjudicateVictory({winner:1,approvals:[true,true]}).ok);assert.equal(g.winner,1);assert(!g.canAdjudicateVictory());assert(!g.nextPhase().ok);
 const override=fresh();assert(override.configureVictoryTerms({condition:'Alternative outcome',approvals:[true,true]}).ok);override.winner=0;assert(override.adjudicateVictory({winner:'draw',approvals:[true,true]}).ok);assert.equal(override.winner,'draw');
 override.reset();assert.equal(override.victoryTerms,null);assert.equal(override.victoryAdjudicated,false);
});


test('AGoAC p.7: exceptional standard stalemate requires both conditions confirmed by both sides at a round boundary',()=>{
 const g=fresh(),yes={cannotMove:true,cannotDamage:true},confirmed=[yes,yes];
 assert(!g.adjudicateStalemate({confirmations:confirmed}).ok);g.phase='end';g.queue=[];assert(g.nextPhase().ok);assert(g.canAdjudicateStalemate());assert.equal(g.winner,null);
 for(const confirmations of [[],[yes],[yes,{cannotMove:true,cannotDamage:false}],[{cannotMove:false,cannotDamage:true},yes]]){
  assert(!g.adjudicateStalemate({confirmations}).ok);assert.equal(g.winner,null);
 }
 g.pendingChoice={kind:'x'};assert(!g.adjudicateStalemate({confirmations:confirmed}).ok);g.pendingChoice=null;
 g.units[0].deployed=false;assert(!g.adjudicateStalemate({confirmations:confirmed}).ok);g.units[0].deployed=true;
 assert(g.adjudicateStalemate({confirmations:confirmed}).ok);assert.equal(g.winner,'draw');assert(!g.nextPhase().ok);assert(!g.adjudicateStalemate({confirmations:confirmed}).ok);
 const custom=fresh();assert(custom.configureVictoryTerms({roundLimit:5,approvals:[true,true]}).ok);custom.phase='end';custom.queue=[];assert(custom.nextPhase().ok);assert(!custom.canAdjudicateStalemate());
});


test('AGoAC p.6: a destroyed intended target never cancels previously declared ordinary attacks',()=>{
 for(const phase of ['fire','physical']){
  const g=fresh(),[a,b,t,other]=g.units;
  g.phase=phase;g.initiativeWinner=1;g.queue=[];g.activeTeam=null;g.rng=()=>.99;
  const weapon=(id,name)=>({id,shots:[{index:0,target:t.id,bin:null,aim:null,heatMode:false,
   weapon:{name,rack:0,ammo:null,heat:1,damage:1,location:'CT'},preview:{targetNumber:2,side:'front',cover:false,underwaterCover:false}}]});
  const physical=id=>({id,target:t.id,type:'punch',limb:'LA',targetNumber:2,damage:1,side:'front',table:'punch'});
  if(phase==='fire')g.declarations=[weapon(a.id,'First declared gun'),weapon(b.id,'Second declared gun')];
  else g.physicalDeclarations=[physical(a.id),physical(b.id)];
  let applied=0;
  g.hit=(target,damage)=>{
   assert.equal(target.id,t.id);assert.equal(g.phaseRolls.filter(r=>r.target===2).length,2,'every declaration rolled before damage');
   if(++applied===1)g.destroyMech(target);
   return {location:'CT',damage,hits:[]};
  };
  const results=phase==='fire'?g.resolveFire():g.resolvePhysical();
  assert.equal(t.dead,true);assert.equal(other.dead,false);assert.equal(g.onMap(t),false);
  assert.deepEqual(results.map(r=>r.id),[a.id,b.id]);
  for(const r of results){assert.equal(r.target,t.id);assert.equal(r.shots[0].roll,12);assert.equal(r.shots[0].hit,true);assert.notEqual(r.shots[0].cancelled,true);}
  if(phase==='fire'){assert.equal(a.pendingHeat,1);assert.equal(b.pendingHeat,1);assert(a.firedLocations.includes('CT'));assert(b.firedLocations.includes('CT'));}
 }
});


test('AGoAC pp.6–7: ordinary physical resolution lets controllers choose Mechs without changing team slots',()=>{
 for(const winner of [0,1]){
  const g=fresh(),[a,b]=g.units.filter(u=>u.team!==winner),[c,d]=g.units.filter(u=>u.team===winner);
  g.phase='physical';g.initiativeWinner=winner;g.queue=[];g.activeTeam=null;g.rng=()=>.99;
  const punch=(u,t,limb)=>({id:u.id,target:t.id,type:'punch',limb,targetNumber:2,damage:1,side:'front',table:'punch'});
  g.physicalDeclarations=[punch(a,c,'LA'),punch(a,c,'RA'),punch(b,d,'LA'),punch(c,a,'LA'),punch(d,b,'LA')];
  const rollOrder=[],damageOrder=[],requests=[];
  const roll=g.rollPhysical.bind(g),damage=g.resolveRolledPhysical.bind(g);
  g.rollPhysical=(order,snapshot)=>{rollOrder.push(order.id);return roll(order,snapshot);};
  g.resolveRolledPhysical=attack=>{assert.equal(rollOrder.length,5);damageOrder.push(attack.d.id);return damage(attack);};
  g.hit=(target,amount)=>({location:'CT',damage:amount,hits:[]});
  g._resolutionChooser=(request,fallback)=>{
   assert.equal(request.kind,'physical-order');
   if(request.context.scope==='attack')return fallback;
   requests.push([request.context.stage,request.team]);
   if(request.context.stage==='roll')return request.options.at(-1).id;
   assert.equal(rollOrder.length,5);return fallback;
  };
  g.resolvePhysical();
  assert.deepEqual(rollOrder,[b.id,d.id,a.id,a.id,c.id]);
  assert.deepEqual(damageOrder,[a.id,a.id,c.id,b.id,d.id]);
  assert.deepEqual(requests,[['roll',1-winner],['roll',winner],['damage',1-winner],['damage',winner]]);
 }
});


test('AGoAC pp.6–7: two ordinary punches have independent roll and damage order',()=>{
 for(const oneMiss of [false,true]){
  const g=fresh(),[u]=g.units.filter(x=>x.team===0),[t]=g.units.filter(x=>x.team===1);
  g.phase='physical';g.initiativeWinner=1;g.queue=[];g.activeTeam=null;
  const punch=(limb,targetNumber)=>({id:u.id,target:t.id,type:'punch',limb,targetNumber,damage:1,side:'front',table:'punch'});
  g.physicalDeclarations=[punch('LA',oneMiss?12:2),punch('RA',2)];
  g.rng=()=>.5;
  const rollOrder=[],damageOrder=[],requests=[];
  const roll=g.rollPhysical.bind(g),damage=g.resolveRolledPhysical.bind(g);
  g.rollPhysical=(order,snapshot)=>{rollOrder.push(order.limb);return roll(order,snapshot);};
  g.resolveRolledPhysical=attack=>{assert.equal(rollOrder.length,2);damageOrder.push([attack.d.limb,attack.hit]);return damage(attack);};
  g.hit=(target,amount)=>({location:'CT',damage:amount,hits:[]});
  g._resolutionChooser=(request)=>{
   assert.equal(request.kind,'physical-order');assert.equal(request.context.scope,'attack');
   assert.equal(request.unitId,u.id);requests.push(request.context.stage);
   const desired=request.context.stage==='roll'?'RA':'LA';
   return request.options.find(o=>o.attacks[0].limb===desired).id;
  };
  g.resolvePhysical();
  assert.deepEqual(rollOrder,['RA','LA']);
  assert.deepEqual(damageOrder,oneMiss?[['RA',true],['LA',false]]:[['LA',true],['RA',true]]);
  assert.deepEqual(requests,oneMiss?['roll']:['roll','damage']);
 }
});


test('AGoAC p.8: standing still spends no MP and unsupported movement modes cannot move',()=>{
 for(const mode of ['stand','invalid','minimum','evade']){
  const g=fresh(),u=g.units[0];
  g.phase='move';g.activeTeam=0;g.queue=[0,1];
  Object.assign(u,{q:0,r:0,facing:0,walk:4,moveMode:'stand',spent:0});
  for(const tile of g.tiles)Object.assign(tile,{type:'plain',height:0,depth:0,surface:0});
  const before=JSON.stringify(u);
  assert.deepEqual(g.reachable(u,mode),[]);
  assert.equal(g.move(u.id,1,0,mode).ok,false);
  assert.equal(JSON.stringify(u),before);
  assert(g.hold(u.id).ok);
  assert.equal(u.moveMode,'stand');assert.equal(u.spent,0);
  assert.equal(u.pendingHeat,0);assert.equal(u.distanceMoved,0);
  assert.deepEqual([u.q,u.r,u.facing],[0,0,0]);
 }
});


test('AGoAC p.8: one-legged bipeds cannot select jumping even with intact jets',()=>{
 for(const limb of ['LL','RL']){
  const g=fresh(),u=g.units[0];
  g.phase='move';g.activeTeam=0;g.queue=[0,1];
  Object.assign(u,{q:0,r:0,facing:0,walk:4,jump:3,jumpLost:0,heat:0,moveMode:'stand',spent:0,prone:false,proneAtStart:false});
  for(const tile of g.tiles)Object.assign(tile,{type:'plain',height:0,depth:0,surface:0});
  assert.equal(g.mp(u,'jump'),3);
  u.structure[limb]=0;
  assert.equal(g.mp(u,'walk'),1);assert.equal(g.mp(u,'run'),0);assert.equal(g.mp(u,'jump'),0);
  const before=JSON.stringify(u);
  assert.deepEqual(g.reachable(u,'jump'),[]);assert.deepEqual(g.reachable(u,'run'),[]);
  assert.equal(g.move(u.id,0,0,'jump').ok,false);
  assert.equal(g.move(u.id,1,0,'run').ok,false);
  assert.equal(JSON.stringify(u),before);
 }
});


test('AGoAC p.8: zero-distance ground movement commits mode and generates heat exactly once',()=>{
 for(const [mode,heat,other] of [['walk',1,'run'],['run',2,'walk']]){
  const g=fresh(),u=g.units[0];
  g.phase='move';g.activeTeam=0;g.queue=[0,1];
  Object.assign(u,{q:0,r:0,facing:0,walk:4,moveMode:'stand',spent:0,pendingHeat:0,distanceMoved:0});
  for(const tile of g.tiles)Object.assign(tile,{type:'plain',height:0,depth:0,surface:0});
  assert(g.move(u.id,u.q,u.r,mode).ok);
  assert.equal(u.moveMode,mode);
  assert.equal(u.spent,0);assert.equal(u.distanceMoved,0);
  assert.equal(g.tmm(u),0);assert.equal(u.pendingHeat,0);
  const before=JSON.stringify(u);
  for(const invalid of [other,'jump','stand']){
   assert.deepEqual(g.reachable(u,invalid),[]);
   assert.equal(g.move(u.id,u.q,u.r,invalid).ok,false);
   assert.equal(JSON.stringify(u),before);
  }
  assert(g.hold(u.id).ok);
  assert.equal(u.pendingHeat,heat);
  assert.equal(u.moveMode,mode);
  assert.deepEqual([u.q,u.r,u.facing],[0,0,0]);
  assert.equal(g.hold(u.id).ok,false);
  assert.equal(u.pendingHeat,heat);
 }
});


test('AGoAC p.8: undamaged walking and running allowances and reverse travel',()=>{
 for(const walking of [1,2,3,4,5,6,7,8]){
  for(const mode of ['walk','run']){
   const g=fresh(),u=g.units[0];
   g.phase='move';g.activeTeam=0;g.queue=[0,1];
   Object.assign(u,{q:0,r:0,facing:0,walk:walking,heat:0,spent:0,moveMode:'stand',distanceMoved:0,pendingHeat:0});
   for(const tile of g.tiles)Object.assign(tile,{type:'plain',height:0,depth:0,surface:0});
   const allowance=mode==='walk'?walking:Math.ceil(walking*1.5);
   assert.equal(g.mp(u,mode),allowance);
   const routes=g.reachable(u,mode);
   assert(routes.length);
   assert(routes.every(route=>route.cost<=allowance));
   for(const route of routes){
    let previous={q:u.q,r:u.r,facing:u.facing};
    for(const step of route.path){
     if(mode==='run'&&(step.q!==previous.q||step.r!==previous.r)){
      const [dq,dr]=DIRS[previous.facing];
      assert.deepEqual([step.q-previous.q,step.r-previous.r],[dq,dr]);
     }
     previous=step;
    }
   }
   const [dq,dr]=DIRS[3],reverse=routes.find(t=>t.q===dq&&t.r===dr);
   if(mode==='walk'&&g.tile(dq,dr)&&!g.occupied(dq,dr,u.id))assert.equal(reverse?.cost,1);
   if(mode==='run'&&reverse)assert(reverse.cost>1);
   u.spent=allowance;
   assert(g.reachable(u,mode).every(t=>t.cost===0));
  }
 }
});


test('AGoAC p.8: jump allowance and minimum heat at each reachable distance',()=>{
 for(const jets of [1,2,3,4,5,6])for(let travelled=1;travelled<=jets;travelled++){
  const g=fresh(),u=g.units[0];
  g.phase='move';g.activeTeam=0;g.queue=[0,1];
  Object.assign(u,{q:0,r:0,facing:0,jump:jets,jumpLost:0,heat:0,spent:0,moveMode:'stand',distanceMoved:0,pendingHeat:0,prone:false,proneAtStart:false,moveStart:{q:0,r:0}});
  for(const tile of g.tiles)Object.assign(tile,{type:'plain',height:0,depth:0,surface:0});
  assert.equal(g.mp(u,'jump'),jets);
  const routes=g.reachable(u,'jump');
  assert(routes.every(t=>t.cost<=jets&&distance(u,t)<=jets));
  const t=routes.find(t=>distance(u,t)===travelled);
  assert(t,'missing legal jump at distance '+travelled);
  assert(g.move(u.id,t.q,t.r,'jump').ok);
  assert.equal(u.spent,travelled);assert.equal(u.distanceMoved,travelled);
  assert.equal(u.pendingHeat,Math.max(3,travelled));
  assert.deepEqual(g.reachable(u,'walk'),[]);
  assert.deepEqual(g.reachable(u,'run'),[]);
  assert.deepEqual(g.reachable(u,'jump'),[]);
  assert(g.hold(u.id).ok);
  assert.equal(u.pendingHeat,Math.max(3,travelled));
 }
});


test('AGoAC p.8: gyro and hip damage trigger movement PSR only for run and jump',()=>{
 for(const damage of ['none','gyro','hip','both'])for(const mode of ['walk','run','jump']){
  const g=fresh(),u=g.units[0];
  g.phase='move';g.activeTeam=0;g.queue=[0,1];
  Object.assign(u,{q:0,r:0,facing:0,walk:6,jump:3,jumpLost:0,heat:0,spent:0,moveMode:'stand',distanceMoved:0,pendingHeat:0,prone:false,proneAtStart:false,moveStart:{q:0,r:0}});
  for(const tile of g.tiles)Object.assign(tile,{type:'plain',height:0,depth:0,surface:0});
  if(damage==='gyro'||damage==='both')u.gyroHits=1;
  if(damage==='hip'||damage==='both')u.actuators.LL.hip=true;
  const calls=[];g.psr=(...args)=>{calls.push(args);return true;};
  const t=g.reachable(u,mode).find(t=>distance(u,t)===1&&t.cost===1);
  assert(t);assert(g.move(u.id,t.q,t.r,mode).ok);
  assert.equal(calls.length,mode==='jump'&&damage!=='none'?1:0);
  assert(g.hold(u.id).ok);
  assert.equal(calls.length,mode!=='walk'&&damage!=='none'?1:0);
  if(calls.length){assert.equal(calls[0][0],u);assert.equal(calls[0][3],true);}
 }
});


test('AGoAC p.8: movement modes export attacker and target modifiers independently of heat',()=>{
 const g=fresh(),u=g.units[0],t=g.units.find(x=>x.team!==u.team);
 for(const tile of g.tiles)Object.assign(tile,{type:'plain',height:0,depth:0,surface:0});
 Object.assign(u,{q:0,r:0,facing:0,heat:0,skidded:false});
 Object.assign(t,{q:1,r:0,heat:0,skidded:false,prone:false});
 g.tacticalOptions={};
 for(const [mode,attacker] of [['stand',0],['walk',1],['run',2],['jump',3]]){
  u.moveMode=mode;
  for(const [d,base] of [[0,0],[2,0],[3,1],[4,1],[5,2],[6,2],[7,3],[9,3],[10,4],[17,4],[18,5],[24,5],[25,6]]){
   t.distanceMoved=d;t.moveMode=mode;
   const expected=base+Number(mode==='jump');
   assert.equal(g.tmm(t),expected);
   assert.equal(g.targetMovementModifier(t),expected);
   const p=g.preview(u.id,t.id,0);
   assert.equal(p.mods.attacker,attacker);
   assert.equal(p.mods.target,expected);
  }
 }
});


test('AGoAC p.9: facing wraps through six hexsides and spends one MP per hexside',()=>{
 for(let start=0;start<6;start++)for(const delta of [-3,-2,-1,1,2,3])for(const mode of ['walk','run']){
  const g=fresh(),u=g.units[0];g.phase='move';g.activeTeam=0;g.queue=[0,1];
  Object.assign(u,{q:0,r:0,facing:start,twist:1,walk:4,heat:0,spent:0,moveMode:'stand',distanceMoved:0,pendingHeat:0});
  for(const t of g.tiles)Object.assign(t,{type:'plain',height:0,depth:0,surface:0});
  assert(g.rotate(u.id,delta,{mode}).ok);
  assert.equal(u.facing,(start+delta+6)%6);
  assert.equal(u.spent,Math.abs(delta));assert.equal(u.distanceMoved,0);
  assert.equal(u.q,0);assert.equal(u.r,0);assert.equal(u.twist,1);
  assert.equal(u.moveMode,mode);
  for(const invalid of [0,4,-4,0.5]){
   const before=JSON.stringify(u);
   assert.equal(g.rotate(u.id,invalid,{mode}).ok,false);
   assert.equal(JSON.stringify(u),before);
  }
  const before=JSON.stringify(u);
  assert.equal(g.rotate(u.id,1,{mode:mode==='walk'?'run':'walk'}).ok,false);
  assert.equal(JSON.stringify(u),before);
  u.spent=g.mp(u,mode);
  const exhausted=JSON.stringify(u);
  assert.equal(g.rotate(u.id,1,{mode}).ok,false);
  assert.equal(JSON.stringify(u),exhausted);
 }
});


test('AGoAC p.9: forward elevation costs and reverse level restrictions',()=>{
 for(const mode of ['walk','run'])for(const delta of [-3,-2,-1,0,1,2,3])for(const rear of [false,true]){
  const g=fresh(),u=g.units[0];g.phase='move';g.activeTeam=0;g.queue=[0,1];
  Object.assign(u,{q:0,r:0,facing:0,walk:8,heat:0,spent:0,moveMode:'stand',distanceMoved:0,pendingHeat:0});
  for(const t of g.tiles)Object.assign(t,{type:'plain',height:8,depth:0,surface:8});
  g.tile(0,0).height=0;
  const [q,r]=DIRS[rear?3:0],tile=g.tile(q,r);
  assert(tile);tile.height=delta;
  for(const v of g.units)if(v!==u)v.deployed=false;
  const route=g.reachable(u,mode).find(t=>t.q===q&&t.r===r);
  if(Math.abs(delta)>2){assert.equal(route,undefined);continue;}
  const reverse=rear&&mode==='walk'&&delta===0;
  const expected=1+Math.abs(delta)+(rear&&!reverse?3:0);
  assert.equal(route?.cost,expected);
  assert(g.move(u.id,q,r,mode).ok);
  assert.equal(u.spent,expected);assert.equal(u.distanceMoved,1);
  assert.equal(u.facing,rear&&!reverse?3:0);
 }
});


test('AGoAC p.9: ground transit distinguishes friendly and enemy occupied hexes',()=>{
 for(const mode of ['walk','run'])for(const occupant of ['none','friendly','enemy'])for(const prone of [false,true]){
  const g=fresh(),u=g.units[0],v=g.units.find(x=>x.team!==u.team);
  g.phase='move';g.activeTeam=0;g.queue=[0,1];
  Object.assign(u,{q:0,r:0,facing:0,walk:4,heat:0,spent:0,moveMode:'stand',distanceMoved:0});
  for(const t of g.tiles)Object.assign(t,{type:'plain',height:8,depth:0,surface:8});
  const [dq,dr]=DIRS[0];
  for(let i=0;i<=2;i++)g.tile(i*dq,i*dr).height=0;
  for(const other of g.units)if(other!==u)other.deployed=false;
  Object.assign(v,{q:dq,r:dr,team:occupant==='friendly'?u.team:1-u.team,prone,deployed:occupant!=='none'});
  const routes=g.reachable(u,mode);
  assert.equal(routes.some(t=>t.q===dq&&t.r===dr),occupant==='none');
  assert.equal(routes.some(t=>t.q===2*dq&&t.r===2*dr),occupant!=='enemy');
  const before=JSON.stringify(u);
  assert.equal(g.move(u.id,999,999,mode).ok,false);
  assert.equal(JSON.stringify(u),before);
  if(occupant!=='none'){
   assert.equal(g.move(u.id,dq,dr,mode).ok,false);
   assert.equal(JSON.stringify(u),before);
  }
  if(occupant!=='enemy'){
   assert(g.move(u.id,2*dq,2*dr,mode).ok);
   assert.equal(u.spent,2);assert.equal(u.distanceMoved,2);
  }
 }
});


test('AGoAC p.10: basic terrain entry costs constrain the actual remaining movement budget',()=>{
 for(const [type,depth,cost] of [['plain',0,1],['road',0,1],['pavement',0,1],['rough',0,2],['woods',0,2],['heavy',0,3],['rubble',0,2],['water',1,2],['water',2,4],['water',3,4]])for(const mode of ['walk','run'])for(const remaining of [cost-1,cost]){
  const g=fresh(),u=g.units[0];g.phase='move';g.activeTeam=0;g.queue=[0,1];
  Object.assign(u,{q:0,r:0,facing:0,walk:6,heat:0,spent:0,moveMode:'stand',distanceMoved:0,pendingHeat:0});
  for(const t of g.tiles)Object.assign(t,{type:'plain',height:8,depth:0,surface:8});
  for(const v of g.units)if(v!==u)v.deployed=false;
  g.tile(0,0).height=0;
  const [q,r]=DIRS[0],tile=g.tile(q,r);
  Object.assign(tile,{type,depth,height:0,surface:0});
  u.spent=g.mp(u,mode)-remaining;u.moveMode=mode;
  assert.equal(g.terrainCost(tile),cost);
  const route=g.reachable(u,mode).find(t=>t.q===q&&t.r===r);
  const legal=remaining===cost&&!(depth&&mode==='run');
  assert.equal(Boolean(route),legal);
  if(legal)assert.equal(route.cost,cost);
  else{const before=JSON.stringify(u);assert.equal(g.move(u.id,q,r,mode).ok,false);assert.equal(JSON.stringify(u),before);}
 }
});


test('AGoAC p.10: ground terrain PSR dispatch uses the entered hex and depth',()=>{
 for(const [type,depth,modifier] of [['plain',0,null],['rough',0,null],['woods',0,null],['heavy',0,null],['rubble',0,0],['water',1,-1],['water',2,0],['water',3,1]]){
  const g=fresh(),u=g.units[0];g.phase='move';g.activeTeam=0;g.queue=[0,1];
  Object.assign(u,{q:0,r:0,facing:0,walk:6,heat:0,spent:0,moveMode:'stand',distanceMoved:0,pendingHeat:0});
  for(const t of g.tiles)Object.assign(t,{type:'plain',height:8,depth:0,surface:8});
  for(const v of g.units)if(v!==u)v.deployed=false;
  g.tile(0,0).height=0;
  const [q,r]=DIRS[0];Object.assign(g.tile(q,r),{type,depth,height:0,surface:0});
  const calls=[];g.psr=(unit,mod,reason,immediate)=>{calls.push({unit,mod,reason,immediate,q:unit.q,r:unit.r});return true;};
  assert(g.move(u.id,q,r,'walk').ok);
  assert.equal(calls.length,modifier===null?0:1);
  if(calls.length){
   assert.equal(calls[0].unit,u);assert.equal(calls[0].mod,modifier);
   assert.equal(calls[0].immediate,true);assert.deepEqual([calls[0].q,calls[0].r],[q,r]);
  }
  assert(g.hold(u.id).ok);
  assert.equal(calls.length,modifier===null?0:1);
 }
});



test('AGoAC p.10: rubble entry invokes a terrain PSR for walking and running, not clear ground',()=>{
 for(const mode of ['walk','run'])for(const type of ['plain','rough','woods','heavy','rubble']){
  const g=fresh(),u=g.units[0];
  g.phase='move';g.activeTeam=0;g.queue=[0,1];
  Object.assign(u,{q:0,r:0,facing:0,walk:6});
  for(const tile of g.tiles)Object.assign(tile,{type:'plain',height:0,depth:0,surface:0});
  for(const v of g.units)if(v!==u)v.deployed=false;
  g.tile(1,0).type=type;g.rng=()=>.99;
  const rolls=[],roll=g.roll.bind(g);
  g.roll=(...args)=>{rolls.push(args);return roll(...args);};
  assert(g.move(u.id,1,0,mode).ok);
  assert.equal(rolls.length,type==='rubble'?1:0);
  assert.equal(u.distanceMoved,1);
  assert.equal(u.prone,false);
 }
});

test('AGoAC p.10: road discount requires matching entry and exit edges',()=>{
 for(const connected of [false,true]){
  const g=fresh(),u=g.units[0];g.phase='move';g.activeTeam=0;g.queue=[0,1];
  Object.assign(u,{q:0,r:0,facing:0,walk:4,heat:0,spent:0,moveMode:'stand'});
  for(const t of g.tiles)Object.assign(t,{type:'plain',height:8,depth:0,surface:8});
  for(const v of g.units)if(v!==u)v.deployed=false;
  const a=g.tile(0,0),b=g.tile(1,0);
  Object.assign(a,{height:0,roadEdges:[0]});
  Object.assign(b,{height:0,type:'heavy',roadEdges:[connected?3:2]});
  const expected=connected?1:3;
  assert.equal(g.terrainCost(b,a),expected);
  assert.equal(g.terrainCost(b),3);
  assert.equal(g.reachable(u,'walk').find(t=>t.q===1&&t.r===0)?.cost,expected);
  assert(g.move(u.id,1,0,'walk').ok);
  assert.equal(u.spent,expected);
 }
});

test('AGoAC p.10: Woodland preset supplies connected road edges on rectangular sheets',()=>{
 const g=fresh();
 assert(g.configureRectangularSheets('sheet',[{id:'woodland',rotation:0}]).ok);
 const road=g.tiles.filter(t=>t.roadEdges?.length);
 assert.equal(road.length,16);
 for(const a of road){
  const b=g.tile(a.q+1,a.r);
  if(b?.roadEdges?.length){
   assert(g.roadConnection(a,b));assert(g.roadConnection(b,a));
   assert.equal(g.terrainCost(b,a),1);
  }
 }
});


test('AGoAC p.10: rotated woodland road edges remain reciprocal on native hex maps',()=>{
 for(let rotation=0;rotation<6;rotation++){
  const g=fresh();
  assert(g.configureSetupMap({id:'woodland',rotation}).ok);
  const road=g.tiles.filter(t=>t.roadEdges?.length);
  assert(road.length>1);
  let connections=0;
  for(const a of road)for(const d of a.roadEdges){
   const [dq,dr]=DIRS[d],b=g.tile(a.q+dq,a.r+dr);
   if(!b?.roadEdges?.length)continue;
   assert(b.roadEdges.includes((d+3)%6));
   assert(g.roadConnection(a,b));
   assert(g.roadConnection(b,a));
   connections++;
  }
  assert.equal(connections,2*(road.length-1));
 }
});

test('AGoAC p.10: river preset bridge deck permits ground running without water checks',()=>{
 const g=fresh();
 assert(g.configureRectangularSheets('sheet',[{id:'river',rotation:0}]).ok);
 const deck=g.tiles.find(t=>t.type==='bridge');
 assert(deck);assert.equal(deck.depth,0);assert.equal(deck.height,0);
 assert.equal(g.terrainCost(deck),1);
 assert(g.isPaved(deck));
 const u=g.units[0],a=g.tile(deck.q-1,deck.r);
 Object.assign(a,{type:'plain',height:0,depth:0,surface:0});
 g.phase='move';g.activeTeam=0;g.queue=[0,1];
 Object.assign(u,{q:a.q,r:a.r,facing:0,walk:4,heat:0,spent:0,moveMode:'stand'});
 for(const v of g.units)if(v!==u)v.deployed=false;
 const calls=[];g.psr=(...args)=>{calls.push(args);return true;};
 assert(g.move(u.id,deck.q,deck.r,'run').ok);
 assert.equal(u.spent,1);assert.equal(calls.length,0);
});

test('AGoAC p.10: bridge and adjacent water retain distinct running eligibility',()=>{
 for(const rotation of [0,3]){
  const g=fresh();
  assert(g.configureRectangularSheets('sheet',[{id:'river',rotation}]).ok);
  const deck=g.tiles.find(t=>t.type==='bridge');
  assert(deck);assert.equal(deck.depth,0);
  for(const [dq,dr] of DIRS){
   const water=g.tile(deck.q+dq,deck.r+dr);
   if(!water?.depth)continue;
   const u=g.units[0];g.phase='move';g.activeTeam=0;g.queue=[0,1];
   Object.assign(u,{q:deck.q,r:deck.r,facing:DIRS.findIndex(([x,y])=>x===dq&&y===dr),walk:6,heat:0,spent:0,moveMode:'stand'});
   for(const v of g.units)if(v!==u)v.deployed=false;
   assert(g.reachable(u,'walk').some(t=>t.q===water.q&&t.r===water.r));
   assert(!g.reachable(u,'run').some(t=>t.q===water.q&&t.r===water.r));
   const before=JSON.stringify(u);
   assert.equal(g.move(u.id,water.q,water.r,'run').ok,false);
   assert.equal(JSON.stringify(u),before);
  }
  assert(DIRS.some(([dq,dr])=>g.tile(deck.q+dq,deck.r+dr)?.depth>0));
 }
});

test('AGoAC p.11: minimum movement preserves facing and respects elevation and occupied hex limits',()=>{
 for(const delta of [-3,-2,-1,0,1,2,3])for(const occupied of [false,true]){
  const g=fresh(),u=g.units[0];g.phase='move';g.activeTeam=0;g.queue=[0,1];
  Object.assign(u,{q:0,r:0,facing:0,walk:1,heat:0,spent:0,moveMode:'stand',moveStart:{q:0,r:0}});
  for(const v of g.units)if(v!==u)v.deployed=false;
  Object.assign(g.tile(0,0),{type:'plain',depth:0,height:0,surface:0});
  Object.assign(g.tile(1,0),{type:'heavy',depth:0,height:delta,surface:delta});
  if(occupied)Object.assign(g.units[2],{q:1,r:0,deployed:true});
  const before=JSON.stringify(u),result=g.minimumMove(u.id);
  const legal=!occupied&&Math.abs(delta)<=2;
  assert.equal(result.ok,legal);
  if(legal){
   assert(result.ended);assert.equal(u.facing,0);assert.equal(u.q,1);
   assert.equal(u.distanceMoved,1);assert.equal(u.pendingHeat,2);assert(u.moved);
  }else assert.equal(JSON.stringify(u),before);
 }
});


test('AGoAC p.11: zero ground MP alone is not immobility and cannot suppress intact jump MP',()=>{
 for(const cause of ['zero-walk','shutdown','unconscious','limbless']){
  const g=fresh(),u=g.units[0];g.phase='move';g.activeTeam=0;g.queue=[0,1];
  Object.assign(u,{q:0,r:0,walk:0,jump:3,jumpLost:0,spent:0,prone:false,proneAtStart:false,moveMode:'stand'});
  for(const tile of g.tiles)Object.assign(tile,{type:'plain',height:0,surface:0,depth:0});
  if(cause==='shutdown')u.shutdown=true;
  if(cause==='unconscious')u.unconscious=true;
  if(cause==='limbless')for(const limb of ['LA','RA','LL','RL'])u.structure[limb]=0;
  const mobile=cause==='zero-walk';
  assert.equal(g.isImmobile(u),!mobile,cause);
  assert.equal(g.mp(u,'walk'),0,cause);assert.equal(g.mp(u,'run'),0,cause);
  assert.equal(g.mp(u,'jump'),mobile?3:0,cause);
  assert.equal(g.reachable(u,'jump').some(t=>t.q===1&&t.r===0),mobile,cause);
  if(!mobile){
   assert.equal(g.minimumMove(u.id).ok,false,cause);
   assert.equal(g.rotate(u.id,1).ok,false,cause);
   assert(g.hold(u.id).ok);assert.equal(u.pendingHeat,0,cause);
  }
 }
});

test('AGoAC p.11: jumping over occupied hexes is allowed but ordinary occupied landings are rejected',()=>{
 for(const friendly of [false,true])for(const prone of [false,true]){
  const g=fresh(),u=g.units[0],v=g.units[2];
  g.phase='move';g.activeTeam=0;g.queue=[0,1];
  Object.assign(u,{q:0,r:0,facing:0,jump:3,jumpLost:0,heat:0,spent:0,moveMode:'stand',moveStart:{q:0,r:0}});
  for(const tile of g.tiles)Object.assign(tile,{type:'plain',height:0,surface:0,depth:0});
  for(const other of g.units)if(other!==u)other.deployed=false;
  Object.assign(v,{q:1,r:0,team:friendly?u.team:1-u.team,prone,deployed:true});
  const before=JSON.stringify(u),occupant=JSON.stringify(v);
  assert(!g.reachable(u,'jump').some(t=>t.q===1&&t.r===0));
  assert.equal(g.move(u.id,1,0,'jump').ok,false);
  assert.equal(JSON.stringify(u),before);
  assert(g.reachable(u,'jump').some(t=>t.q===2&&t.r===0));
  assert(g.move(u.id,2,0,'jump').ok);
  assert.equal(u.spent,2);assert.equal(u.distanceMoved,2);
  assert.equal(JSON.stringify(v),occupant);
 }
});

test('AGoAC p.12: jump ceiling is relative to starting elevation and includes landing hex',()=>{
 for(const start of [-1,0,3])for(const obstacle of [2,3,4])for(const landing of [3,4]){
  const g=fresh(),u=g.units[0];g.phase='move';g.activeTeam=0;g.queue=[0,1];
  Object.assign(u,{q:0,r:0,facing:0,jump:3,jumpLost:0,heat:0,spent:0,moveMode:'stand',moveStart:{q:0,r:0}});
  for(const tile of g.tiles)Object.assign(tile,{type:'plain',height:start,surface:start,depth:0});
  for(const v of g.units)if(v!==u)v.deployed=false;
  Object.assign(g.tile(1,0),{height:start+obstacle,surface:start+obstacle});
  Object.assign(g.tile(2,0),{height:start+landing,surface:start+landing});
  const legal=obstacle<=3&&landing<=3;
  assert.equal(g.reachable(u,'jump').some(t=>t.q===2&&t.r===0),legal);
  const before=JSON.stringify(u),result=g.move(u.id,2,0,'jump');
  assert.equal(result.ok,legal);
  if(legal){assert.equal(u.spent,2);assert.equal(u.pendingHeat,3);}
  else assert.equal(JSON.stringify(u),before);
 }
});

test('AGoAC p.12: submerged leg jump jets reduce launch MP at depth one and depth two prevents launch',()=>{
 for(const depth of [0,1,2,3])for(const legJets of [0,1,2]){
  const g=fresh(),u=g.units[0];g.phase='move';g.activeTeam=0;g.queue=[0,1];
  Object.assign(u,{q:0,r:0,facing:0,jump:3,jumpLost:0,heat:0,spent:0,moveMode:'stand',moveStart:{q:0,r:0}});
  for(const tile of g.tiles)Object.assign(tile,{type:'plain',height:0,surface:0,depth:0});
  for(const v of g.units)if(v!==u)v.deployed=false;
  for(const l of ['LL','RL']){
   u.slots[l]=u.slots[l].map(s=>s==='jump'?'empty':s);
   u.crit[l]=u.crit[l].map(()=>false);
  }
  if(legJets>=1)u.slots.LL[0]='jump';
  if(legJets>=2)u.slots.RL[0]='jump';
  Object.assign(g.tile(0,0),{type:depth?'water':'plain',depth,height:-depth,surface:0});
  const expected=depth>=2?0:depth===1?3-legJets:3;
  assert.equal(g.mp(u,'jump'),expected);
  assert.equal(g.reachable(u,'jump').some(t=>t.q===1&&t.r===0),expected>0);
  assert.equal(g.reachable(u,'jump').some(t=>t.q===3&&t.r===0),expected===3);
 }
});

test('AGoAC p.12: repeated standing attempts each consume two MP and one heat until budget exhausted',()=>{
 for(const mode of ['walk','run']){
  const g=fresh(),u=g.units[0];g.phase='move';g.activeTeam=0;g.queue=[0,1];
  Object.assign(u,{q:0,r:0,facing:0,walk:4,heat:0,spent:0,prone:true,proneAtStart:true,moveMode:'stand'});
  let attempts=0;
  // Isolate the movement accounting from the later falling-damage rules.
  g.psr=(unit)=>{attempts++;unit.prone=true;return false;};
  const budget=g.mp(u,mode);
  for(let i=1;i<=Math.floor(budget/2);i++){
   assert(g.stand(u.id,5,{mode}).ok);
   assert(u.prone);assert.equal(u.facing,0);assert.equal(u.spent,2*i);
   assert.equal(u.pendingHeat,i);assert.equal(attempts,i);
  }
  const before=JSON.stringify(u);
  assert.equal(g.stand(u.id,5,{mode}).ok,false);
  assert.equal(JSON.stringify(u),before);
  assert.equal(attempts,Math.floor(budget/2));
 }
});

test('AGoAC p.8: non-hip leg actuator damage requires a jump landing PSR but not an ordinary running PSR',()=>{
 for(const leg of ['LL','RL'])for(const part of ['upper','lower','foot'])for(const mode of ['walk','run','jump']){
  const g=fresh(),u=g.units[0];g.phase='move';g.activeTeam=0;g.queue=[0,1];
  Object.assign(u,{q:0,r:0,facing:0,walk:6,jump:3,jumpLost:0,heat:0,spent:0,moveMode:'stand',prone:false,proneAtStart:false,moveStart:{q:0,r:0}});
  for(const tile of g.tiles)Object.assign(tile,{type:'plain',height:0,surface:0,depth:0});
  for(const v of g.units)if(v!==u)v.deployed=false;
  u.actuators[leg][part]=true;
  assert.equal(g.psrMod(u),1);
  const calls=[];g.psr=(...args)=>{calls.push(args);return true;};
  assert(g.move(u.id,1,0,mode).ok);
  assert(g.hold(u.id).ok);
  assert.equal(calls.length,mode==='jump'?1:0);
  if(calls.length){assert.equal(calls[0][0],u);assert.equal(calls[0][3],true);}
 }
});

test('AGoAC pp.9,11–12: forced level boundary, same-hex jump and repeated water entry',()=>{
 for(const delta of [2,3]){
  const g=fresh(),u=g.units[0];Object.assign(u,{q:0,r:0,facing:0});
  for(const v of g.units)if(v!==u)v.deployed=false;
  g.tile(0,0).height=0;g.tile(1,0).height=delta;
  assert.equal(g.displace(u,0),delta===2);
  assert.equal(u.q,delta===2?1:0);
 }
 {
  const g=fresh(),u=g.units[0];g.phase='move';g.activeTeam=0;g.queue=[0,1];
  Object.assign(u,{q:0,r:0,walk:6,jump:3,jumpLost:0,heat:0,spent:0,prone:false,proneAtStart:false,moveMode:'stand',moveStart:{q:0,r:0},pendingHeat:0});
  for(const tile of g.tiles)Object.assign(tile,{type:'plain',height:0,surface:0,depth:0});
  for(const v of g.units)if(v!==u)v.deployed=false;
  assert(g.move(u.id,0,0,'jump',{facing:4}).ok);
  assert.equal(u.spent,1);assert.equal(u.pendingHeat,3);assert.equal(u.distanceMoved,0);assert.equal(u.facing,4);
 }
 {
  const g=fresh(),u=g.units[0];g.phase='move';g.activeTeam=0;g.queue=[0,1];
  Object.assign(u,{q:0,r:0,facing:0,walk:8,heat:0,spent:0,prone:false,moveMode:'stand'});
  for(const tile of g.tiles)Object.assign(tile,{type:'plain',height:8,surface:8,depth:0});
  for(const v of g.units)if(v!==u)v.deployed=false;
  g.tile(0,0).height=0;
  for(const q of [1,2])Object.assign(g.tile(q,0),{type:'water',height:0,surface:1,depth:1});
  const calls=[];g.psr=(...args)=>{calls.push(args);return true;};
  assert(g.move(u.id,2,0,'walk').ok);assert.equal(u.spent,4);
  assert.equal(calls.length,2);assert(calls.every(x=>x[1]===-1&&x[3]===true));
  assert(g.rotate(u.id,1,{mode:'walk'}).ok);assert.equal(calls.length,2);
  assert(g.hold(u.id).ok);assert.equal(calls.length,2);
 }
});

test('AGoAC p.13: discrete LOS elevation thresholds and target woods',()=>{
 for(const [q,height,blocked] of [[2,4,false],[2,6,true],[1,2,true],[3,4,false],[3,6,true]]){
  const g=fresh(),a=g.units[0],b=g.units[2];
  for(const t of g.tiles)Object.assign(t,{type:'plain',depth:0,height:0,surface:0});
  Object.assign(a,{q:0,r:0,prone:false});Object.assign(b,{q:4,r:0,prone:false});
  g.tile(4,0).height=4;g.tile(q,0).height=height;
  assert.equal(g.los(a,b).blocked,blocked);assert.equal(g.los(b,a).blocked,blocked);
 }
 const g=fresh(),a=g.units[0],b=g.units[2];
 for(const t of g.tiles)Object.assign(t,{type:'plain',depth:0,height:0,surface:0});
 Object.assign(a,{q:0,r:0,prone:false});Object.assign(b,{q:4,r:0,prone:false});
 g.tile(1,0).type='heavy';g.tile(4,0).type='woods';
 assert.equal(g.los(a,b).blocked,false);assert.equal(g.los(a,b).woods,3);
});

test('AGoAC p.14: own partial cover obstructs leg weapons but not torso weapons',()=>{
 const g=fresh(),u=g.units[0],v=g.units[2];
 for(const t of g.tiles)Object.assign(t,{type:'plain',depth:0,height:0,surface:0});
 Object.assign(u,{q:0,r:0,facing:0,twist:0,prone:false});Object.assign(v,{q:3,r:0,prone:false});g.tile(1,0).height=1;
 const w={name:'Medium Laser',damage:5,heat:3,ranges:[3,6,9],min:0,ammo:null,rack:0,location:'LL'};u.weapons=[w,{...w,location:'CT'}];
 assert.equal(g.los(v,u).cover,true);assert.equal(g.preview(u.id,v.id,0).legal,false);assert.equal(g.preview(u.id,v.id,1).legal,true);
 g.tile(1,0).height=0;assert.equal(g.preview(u.id,v.id,0).legal,true);
});

test('AGoAC p.13: shared-edge LOS exposes both reciprocal terrain paths',()=>{
 const g=fresh(),a=g.units[0],b=g.units[2];
 for(const t of g.tiles)Object.assign(t,{type:'plain',depth:0,height:0,surface:0});
 Object.assign(a,{q:0,r:0,prone:false});Object.assign(b,{q:1,r:1,prone:false});g.tile(1,0).height=2;
 const paths=g.losAlternatives(a,b),back=g.losAlternatives(b,a);
 assert.equal(paths.length,2);assert.deepEqual(paths.map(p=>p.blocked).sort(),[false,true]);
 for(const p of paths){const reverse=back.find(x=>x.choice===-p.choice);assert.deepEqual(reverse.path,[...p.path].reverse());assert.equal(reverse.blocked,p.blocked);}
 b.q=2;b.r=0;assert.equal(g.losAlternatives(a,b).length,1);
});

test('AGoAC p.13: defender LOS choice persists reciprocally for the round',()=>{
 const g=fresh(),a=g.units[0],b=g.units[2];g.phase='fire';
 for(const t of g.tiles)Object.assign(t,{type:'plain',depth:0,height:0,surface:0});
 Object.assign(a,{q:0,r:0,prone:false,fired:false});Object.assign(b,{q:1,r:1,prone:false,fired:false});g.tile(1,0).height=2;
 const blocked=g.losAlternatives(a,b).find(x=>x.blocked).choice;
 assert.equal(g.chooseLosPath(a.id,b.id,blocked,a.team).ok,false);
 assert(g.chooseLosPath(a.id,b.id,blocked,b.team).ok);
 assert.equal(g.los(a,b).blocked,true);assert.equal(g.los(b,a).blocked,true);
 assert.equal(g.chooseLosPath(b.id,a.id,blocked,a.team).ok,false);
 g.round++;assert(g.chooseLosPath(a.id,b.id,-blocked,b.team).ok);
 assert.equal(g.los(a,b).blocked,false);assert.equal(g.los(b,a).blocked,false);
});

test('AGoAC pp.13–14: adjacent endpoints and intervening Mechs never obstruct surface LOS',()=>{
 const g=fresh(),a=g.units[0],b=g.units[2],c=g.units[1];
 for(const t of g.tiles)Object.assign(t,{type:'plain',depth:0,height:0,surface:0});
 Object.assign(a,{q:0,r:0,prone:false});Object.assign(b,{q:1,r:0,prone:false});
 g.tile(0,0).type='heavy';g.tile(1,0).type='heavy';
 assert.equal(g.los(a,b).blocked,false);assert.equal(g.los(b,a).blocked,false);
 assert.equal(g.los(a,b).woods,2);assert.equal(g.los(b,a).woods,2);
 Object.assign(b,{q:4,r:0});Object.assign(c,{q:2,r:0,deployed:true,dead:false,prone:false});
 g.tile(1,0).type='plain';
 assert.equal(g.los(a,b).blocked,false);assert.equal(g.los(b,a).blocked,false);
 c.prone=true;assert.equal(g.los(a,b).blocked,false);
});

test('AGoAC p.13: prone height changes mutual LOS at middle and adjacent elevation thresholds',()=>{
 const g=fresh(),a=g.units[0],b=g.units[2];
 for(const t of g.tiles)Object.assign(t,{type:'plain',depth:0,height:0,surface:0});
 Object.assign(a,{q:0,r:0,prone:false});Object.assign(b,{q:4,r:0,prone:false});
 const mutual=blocked=>{assert.equal(g.los(a,b).blocked,blocked);assert.equal(g.los(b,a).blocked,blocked);};
 g.tile(2,0).height=1;mutual(false);
 a.prone=true;mutual(false);
 b.prone=true;mutual(true);
 b.prone=false;g.tile(2,0).height=0;g.tile(1,0).height=1;mutual(true);
 a.prone=false;mutual(false);
});

test('AGoAC p.17: partial cover is standing only, negated downhill except depth-one water',()=>{
 const g=fresh(),a=g.units[0],b=g.units[2];
 for(const t of g.tiles)Object.assign(t,{type:'plain',depth:0,height:0,surface:0});
 Object.assign(a,{q:0,r:0,prone:false});Object.assign(b,{q:3,r:0,prone:false});
 g.tile(2,0).height=1;
 assert.equal(g.los(a,b).blocked,false);assert.equal(g.los(a,b).cover,true);
 g.tile(0,0).height=2;assert.equal(g.los(a,b).cover,false);
 g.tile(0,0).height=0;b.prone=true;
 assert.equal(g.los(a,b).cover,false);assert.equal(g.los(a,b).blocked,true);
 b.prone=false;g.tile(2,0).height=0;g.tile(2,0).type='woods';
 assert.equal(g.los(a,b).cover,false);assert.equal(g.los(a,b).woods,1);
 g.tile(2,0).type='plain';g.tile(0,0).height=2;
 Object.assign(g.tile(3,0),{type:'water',depth:1,height:-1,surface:0});
 assert.equal(g.los(a,b).blocked,false);assert.equal(g.los(a,b).cover,true);
});

test('AGoAC p.13: exact LOS includes corner-only and non-sampled hexes in both directions',()=>{
 const g=fresh(),a=g.units[0],b=g.units[2];
 for(const t of g.tiles)Object.assign(t,{type:'plain',depth:0,height:0,surface:0});
 Object.assign(a,{q:0,r:0,prone:false});Object.assign(b,{q:4,r:1,prone:false});
 const paths=g.losAlternatives(a,b),reverse=g.losAlternatives(b,a);
 assert.equal(paths.length,1);assert.equal(reverse.length,1);
 assert.deepEqual(reverse[0].path,[...paths[0].path].reverse());
 for(const [q,r] of [[1,1],[3,0]]){
  assert(paths[0].path.some(p=>p.q===q&&p.r===r));
  const t=g.tile(q,r);t.height=2;
  assert.equal(g.los(a,b).blocked,true);assert.equal(g.los(b,a).blocked,true);
  t.height=0;
 }
 g.tile(1,1).type='heavy';g.tile(3,0).type='woods';
 assert.equal(g.los(a,b).blocked,true);
 g.tile(3,0).type='plain';assert.equal(g.los(a,b).blocked,false);
 assert.equal(g.los(b,a).woods,2);
});

test('AGoAC pp.13,17: both physically adjacent terrain cells affect elevation and partial cover',()=>{
 const g=fresh(),a=g.units[0],b=g.units[2];
 for(const t of g.tiles)Object.assign(t,{type:'plain',depth:0,height:0,surface:0});
 Object.assign(a,{q:0,r:0,prone:false});Object.assign(b,{q:3,r:1,prone:false});
 // One side of the traversed line is adjacent to each endpoint even
 // when it is not the first or last sampled cell.
 const path=g.losAlternatives(a,b)[0].path;
 assert.deepEqual(path,[{q:1,r:0},{q:1,r:1},{q:2,r:0},{q:2,r:1}]);
 g.tile(0,0).height=3;g.tile(2,1).height=2;
 assert.equal(g.los(a,b).blocked,true);assert.equal(g.los(b,a).blocked,true);
 g.tile(2,1).height=1;assert.equal(g.los(a,b).blocked,false);assert.equal(g.los(a,b).cover,false);
 g.tile(0,0).height=0;assert.equal(g.los(a,b).cover,true);
});

test('AGoAC p.13: defender chooses ambiguous fire path before commitment and cannot change it',()=>{
 const g=fresh(),a=g.units[0],b=g.units[2];
 for(const t of g.tiles)Object.assign(t,{type:'plain',depth:0,height:0,surface:0});
 Object.assign(a,{q:0,r:0,prone:false,facing:0,fired:false});
 Object.assign(b,{q:1,r:1,prone:false,fired:false});
 g.phase='fire';g.queue=[a.team,b.team];g.activeTeam=a.team;g.actingId=a.id;
 g.tile(1,0).height=2;
 const command=[{index:0,target:b.id}];
 const result=g.declareFireWithLosChoices(a.id,command,null,{humanTeams:[0,1]});
 assert(result.pending);assert(!a.fired);assert.equal(g.declarations.length,0);
 const p=g.pendingChoice;assert.equal(p.team,b.team);
 const blocked=p.options.find(o=>o.blocked);
 assert.equal(g.resolveFireLosChoice({key:p.key,option:blocked.id},[a.team]).ok,false);
 assert.equal(g.resolveFireLosChoice({key:p.key,option:'0'},[b.team]).ok,false);
 assert(g.nextPhaseWithChoices({humanTeams:[0,1],choice:{key:p.key,option:blocked.id}}).ok);
 assert.equal(g.pendingChoice,null);assert(g.los(a,b).blocked);assert(g.los(b,a).blocked);
 assert.equal(g.declareFireWithLosChoices(a.id,command,null,{humanTeams:[0,1]}).ok,false);
 assert.equal(g.declarations.length,0);assert(!a.fired);
 assert.equal(g.chooseLosPath(a.id,b.id,-blocked.choice,b.team).ok,false);
});
test('AGoAC p.13: automated defender selects obstruction before an interactive attack',()=>{
 const g=fresh(),a=g.units[0],b=g.units[2];
 for(const t of g.tiles)Object.assign(t,{type:'plain',depth:0,height:0,surface:0});
 Object.assign(a,{q:0,r:0,prone:false,facing:0,fired:false});
 Object.assign(b,{q:1,r:1,prone:false,fired:false});
 g.phase='fire';g.queue=[a.team,b.team];g.activeTeam=a.team;g.actingId=a.id;
 g.tile(1,0).height=2;
 const r=g.prepareFireLos(a.id,[b.id,b.id],[a.team]);
 assert(r.ok&&r.losPrepared&&!r.pending);assert(g.los(a,b).blocked);
 assert.equal(g.prepareFireLos(a.id,[b.id],[a.team]).losPrepared,false);
 g.round++;assert.equal(g.selectedLosPath(a,b),0);
});

test('AGoAC pp.14–15: biped firing sectors rotate with torso except legs and reversed arms reset',()=>{
 const g=fresh(),u=g.units[0],t=g.units[2];
 Object.assign(u,{q:0,r:0,config:'Biped',facing:0,twist:0,prone:false,flip:false});
 const at=(q,r)=>Object.assign(t,{q,r});
 const weapon=(location,rear=false)=>({location,rear});
 at(1,0);assert(g.arc(u,t,weapon('CT')));assert(g.arc(u,t,weapon('LL')));
 at(-1,0);assert(!g.arc(u,t,weapon('CT')));assert(g.arc(u,t,weapon('CT',true)));assert(g.arc(u,t,weapon('RL',true)));
 // Side and forward sectors follow torso twist; legs retain feet facing.
 u.twist=1;at(0,-1);
 assert(g.arc(u,t,weapon('CT')));assert(!g.arc(u,t,weapon('LL')));
 at(0,1);assert(!g.arc(u,t,weapon('CT')));assert(g.arc(u,t,weapon('LL')));
 u.twist=0;u.prone=true;
 assert(g.arc(u,t,weapon('CT')));assert(g.arc(u,t,weapon('LA')));assert(g.arc(u,t,weapon('RA')));
 g.phase='fire';g.activeTeam=u.team;g.queue=[u.team,t.team];g.actingId=u.id;
 assert.equal(g.twist(u.id,1).ok,false);assert.equal(g.flipArms(u.id,true).ok,false);
 u.prone=false;
 for(const l of ['LA','RA']){u.slots[l][2]=null;u.slots[l][3]=null;}
 u.weapons=u.weapons.filter(w=>!w.locations?.some(l=>['CT','LT','RT'].includes(l))||!w.locations.some(l=>['LA','RA'].includes(l)));
 assert(g.flipArms(u.id,true).ok);at(-1,0);
 assert(g.arc(u,t,weapon('LA')));assert(g.arc(u,t,weapon('RA')));assert(!g.arc(u,t,weapon('CT')));
 at(1,0);assert(!g.arc(u,t,weapon('RA')));
 assert(!g.twist(u.id,1).ok);
 g.endPhase();assert.equal(u.flip,false);assert.equal(u.twist,0);
});

test('AGoAC p.15: arm reversal eligibility comes from the original critical layout even after arm loss',()=>{
 for(const missing of ['none','LA','RA','both']){
  const g=fresh(),u=g.units[0];g.phase='fire';g.activeTeam=u.team;g.queue=[u.team,1-u.team];g.actingId=u.id;
  u.prone=false;
  for(const l of ['LA','RA']){
   u.slots[l][2]='lower';u.slots[l][3]='hand';
   if(missing==='both'||missing===l){u.slots[l][2]=null;u.slots[l][3]=null;}
   u.actuators[l].lower=true;u.actuators[l].hand=true;
  }
  assert.equal(g.flipArms(u.id,true).ok,missing==='both');
 }
 for(const configured of [true,false]){
  const g=fresh(),u=g.units[0];g.phase='fire';g.activeTeam=u.team;g.queue=[u.team,1-u.team];g.actingId=u.id;
  u.prone=false;
  for(const l of ['LA','RA']){u.slots[l][2]=configured?null:'lower';u.slots[l][3]=configured?null:'hand';}
  g.destroyLocation(u,'LA');
  assert.equal(g.flipArms(u.id,true).ok,configured);
 }
});
test('AGoAC p.17: twisted torso and forward leg arcs allow one primary across both sectors',()=>{
 const g=fresh(),u=g.units[0],a=g.units[2],b=g.units[3];
 Object.assign(u,{q:0,r:0,facing:0,twist:1,prone:false});
 Object.assign(a,{q:0,r:-2});Object.assign(b,{q:0,r:2});
 const w={name:'Medium Laser',damage:5,heat:3,ranges:[3,6,9],min:0,ammo:null,rack:0,rear:false};
 u.weapons=[{...w,location:'CT'},{...w,location:'LL'}];
 const orders=[{index:0,target:a.id},{index:1,target:b.id}];
 assert(g.inForwardFireArc(u,a));assert(g.inForwardFireArc(u,b));
 assert.deepEqual(g.primaryTargetChoices(u.id,orders),[a.id,b.id]);
 assert.equal(g.preview(u.id,b.id,1,{secondary:true}).mods.secondary,1);
 u.weapons[1].rear=true;
 assert(!g.inForwardFireArc(u,b));assert.deepEqual(g.primaryTargetChoices(u.id,orders),[a.id]);
 assert.equal(g.preview(u.id,b.id,1,{secondary:true}).mods.secondary,2);
});
test('AGoAC pp.16–21: immobility and movement modifiers accumulate and aimed head only replaces minus four',()=>{
 const g=fresh(),u=g.units[0],t=g.units[2];
 for(const h of g.tiles)Object.assign(h,{type:'plain',depth:0,height:0,surface:0});
 Object.assign(u,{q:0,r:0,facing:0,twist:0,prone:false,moveMode:'stand'});
 Object.assign(t,{q:3,r:0,prone:false,moveMode:'jump',distanceMoved:5,shutdown:true});
 const w={name:'Medium Laser',damage:5,heat:3,ranges:[3,6,9],min:0,ammo:null,rack:0,location:'CT'};
 u.weapons=[w];
 assert.equal(g.targetMovementModifier(t),-1);
 const normal=g.preview(u.id,t.id,0),head=g.preview(u.id,t.id,0,{aim:'HD'});
 assert(normal.legal&&head.legal);assert.equal(normal.mods.target,-1);assert.equal(head.mods.target,3);
 assert.equal(head.targetNumber-normal.targetNumber,7);
 t.prone=true;assert.equal(g.preview(u.id,t.id,0).mods.targetProne,1);
 t.q=1;assert.equal(g.preview(u.id,t.id,0).mods.targetProne,-2);
 t.shutdown=false;assert.equal(g.targetMovementModifier(t),3);
});

test('AGoAC p.19: immobilized movement remains cumulative without optional mobile-only TO bonuses',()=>{
 const g=fresh(),t=g.units[2];
 g.tacticalOptions.standingStill=true;g.tacticalOptions.evading=true;
 Object.assign(t,{shutdown:true,moveMode:'stand',distanceMoved:0,spent:0,prone:false,skidded:false});
 assert.equal(g.targetMovementModifier(t),-4);
 assert.equal(g.targetMovementModifier(t,{includeImmobile:false}),0);
 Object.assign(t,{moveMode:'evade',distanceMoved:5,spent:5});
 assert.equal(g.targetMovementModifier(t),-2);
 assert.equal(g.targetMovementModifier(t,{includeImmobile:false}),2);
 t.shutdown=false;assert.equal(g.targetMovementModifier(t),3);
 Object.assign(t,{moveMode:'stand',distanceMoved:0,spent:0});
 assert.equal(g.targetMovementModifier(t),-1);
});

test('AGoAC p.17: bridge decks never grant partial cover to either endpoint',()=>{
 const g=fresh(),a=g.units[0],b=g.units[2];
 for(const h of g.tiles)Object.assign(h,{type:'plain',depth:0,height:0,surface:0});
 Object.assign(a,{q:0,r:0,prone:false,facing:0});
 Object.assign(b,{q:3,r:0,prone:false,facing:3});
 const nearB=g.tile(2,0),nearA=g.tile(1,0);
 Object.assign(nearB,{type:'bridge',height:1,surface:1});
 Object.assign(nearA,{type:'bridge',height:1,surface:1});
 assert.equal(g.los(a,b).blocked,false);assert.equal(g.los(b,a).blocked,false);
 assert.equal(g.los(a,b).cover,false);assert.equal(g.los(b,a).cover,false);
 nearB.type='plain';nearA.type='plain';
 assert.equal(g.los(a,b).cover,true);assert.equal(g.los(b,a).cover,true);
 nearB.type='bridge';nearA.type='bridge';
 Object.assign(g.tile(b.q,b.r),{type:'water',depth:1,height:-1,surface:0});
 nearB.height=0;
 assert.equal(g.los(a,b).cover,true,'depth-one water remains cover independently of the bridge');
});
test('AGoAC pp.11,17,19: zero MP does not imply immobility and true immobilizing states stack with movement',()=>{
 const g=fresh(),t=g.units[2];
 Object.assign(t,{shutdown:false,unconscious:false,abandoned:false,walk:0,jump:0,moveMode:'stand',distanceMoved:0,spent:0});
 assert.equal(g.mp(t,'walk'),0);assert.equal(g.isImmobile(t),false);assert.equal(g.targetMovementModifier(t),0);
 Object.assign(t,{moveMode:'run',distanceMoved:7,spent:7});
 for(const field of ['shutdown','unconscious','abandoned']){
  t[field]=true;assert.equal(g.isImmobile(t),true);assert.equal(g.targetMovementModifier(t),-1);t[field]=false;
 }
 for(const l of ['LL','RL','LA'])t.structure[l]=0;
 assert.equal(g.isImmobile(t),false);assert.equal(g.targetMovementModifier(t),3);
 t.structure.RA=0;
 assert.equal(g.isImmobile(t),true);assert.equal(g.targetMovementModifier(t),-1);
});
test('AGoAC pp.14–17: facing-based attack direction persists when torso is twisted',()=>{
 const g=fresh(),u=g.units[0],a=g.units[2];
 Object.assign(u,{q:0,r:0,facing:0,twist:0,prone:false});
 Object.assign(a,{q:0,r:-2});
 const side=g.hitSide(u,a);const weapon={location:'CT',rear:false};
 assert.equal(g.arc(u,a,weapon),false);
 u.twist=1;
 assert.equal(g.arc(u,a,weapon),true);assert.equal(g.hitSide(u,a),side);
});

test('AGoAC p.17: actual multi-weapon declarations apply one primary and one secondary modifier per shot',()=>{
 for(const primaryIndex of [0,1]){
  const g=fresh(),u=g.units[0],a=g.units[2],b=g.units[3];
  for(const h of g.tiles)Object.assign(h,{type:'plain',depth:0,height:0,surface:0});
  Object.assign(u,{q:0,r:0,facing:0,twist:0,prone:false,moveMode:'stand',heat:0});
  Object.assign(a,{q:2,r:0,prone:false,moveMode:'stand',distanceMoved:0});
  Object.assign(b,{q:2,r:-1,prone:false,moveMode:'stand',distanceMoved:0});
  const w={name:'Medium Laser',damage:5,heat:3,ranges:[3,6,9],min:0,ammo:null,location:'CT',rack:0};
  u.weapons=Array.from({length:4},()=>({...w}));
  g.phase='fire';g.queue=[u.team,a.team];g.activeTeam=u.team;g.actingId=u.id;
  const orders=[{index:0,target:a.id},{index:1,target:b.id},{index:2,target:b.id},{index:3,target:a.id}];
  const primary=[a,b][primaryIndex].id;
  assert.deepEqual(g.primaryTargetChoices(u.id,orders),[a.id,b.id]);
  assert(g.declareFire(u.id,orders,primary).ok);
  const shots=g.declarations.at(-1).shots;
  assert.equal(shots.length,4);
  for(const s of shots)assert.equal(s.preview.mods.secondary,s.target===primary?0:1);
 }
});
test('AGoAC pp.16–20: direct GATOR composes damage heat movement terrain and minimum range',()=>{
 const g=fresh(),u=g.units[0],t=g.units[2];
 for(const h of g.tiles)Object.assign(h,{type:'plain',depth:0,height:0,surface:0});
 Object.assign(u,{q:0,r:0,facing:0,twist:0,prone:false,gunnery:3,heat:13,moveMode:'walk',sensorHits:1,skidded:false});
 Object.assign(t,{q:3,r:0,prone:false,moveMode:'run',distanceMoved:5,skidded:false});
 const w={name:'PPC',damage:10,heat:10,ranges:[6,12,18],min:3,ammo:null,location:'RA',rack:0};
 u.weapons=[w];
 u.slots.RA[1]='upper';u.slots.RA[2]='lower';
 Object.assign(u.actuators.RA,{upper:true,lower:true,shoulder:false});
 g.tile(1,0).type='woods';g.tile(2,0).height=1;
 const p=g.preview(u.id,t.id,0);
 assert(p.legal,p.reason);
 const expected={gunnery:3,attacker:1,target:2,terrain:1,cover:1,heat:2,range:0,minimum:1,sensor:2,arm:2};
 for(const [k,n] of Object.entries(expected))assert.equal(p.mods[k],n,k);
 assert.equal(p.targetNumber,15);assert.equal(p.chance,0);
 u.actuators.RA.shoulder=true;assert.equal(g.preview(u.id,t.id,0).mods.arm,4);
 u.actuators.RA.shoulder=false;u.slots.RA[2]=null;
 assert.equal(g.preview(u.id,t.id,0).mods.arm,1);
 g.tile(1,0).type='plain';g.tile(2,0).height=0;
 Object.assign(u,{heat:0,sensorHits:0,moveMode:'stand'});u.actuators.RA.upper=false;
 Object.assign(t,{distanceMoved:0,moveMode:'stand'});
 const clear=g.preview(u.id,t.id,0);
 assert.equal(clear.targetNumber,4);assert.equal(clear.chance,92);
});

test('AGoAC pp.13–14,19: submerged endpoints and submerged leg weapons cannot fire by default',()=>{
 const g=fresh(),a=g.units[0],b=g.units[2];
 for(const h of g.tiles)Object.assign(h,{type:'plain',depth:0,height:0,surface:0});
 Object.assign(a,{q:0,r:0,facing:0,twist:0,prone:false});
 Object.assign(b,{q:1,r:0,facing:3,twist:0,prone:false});
 const w={name:'Medium Laser',heat:3,damage:5,min:0,ammo:null,location:'CT',ranges:[3,6,9],rack:0};
 a.weapons=[w,{...w,location:'LL'}];b.weapons=[{...w}];
 const water=(u,depth)=>Object.assign(g.tile(u.q,u.r),{type:depth?'water':'plain',depth,height:-depth,surface:0});
 assert.equal(g.tacticalOptions.underwaterFire,false);
 for(const [ad,bd,prone,expected] of [[0,0,false,true],[0,1,false,true],[1,0,false,true],[1,1,false,true],[2,2,false,false],[2,1,false,false],[1,2,false,false],[0,2,false,false],[0,1,true,false]]){
  water(a,ad);water(b,bd);b.prone=prone;
  assert.equal(g.los(a,b).blocked,!expected);assert.equal(g.los(b,a).blocked,!expected);
  assert.equal(g.preview(a.id,b.id,0).legal,expected);
  if(ad===1)assert.equal(g.preview(a.id,b.id,1).legal,false);
 }
 water(a,2);water(b,1);b.prone=false;g.tacticalOptions.underwaterFire=true;
 assert(g.preview(a.id,b.id,0).legal);
});
test('AGoAC pp.13–14,17: water intervenes at surface elevation only when it reaches LOS',()=>{
 const g=fresh(),a=g.units[0],b=g.units[2];
 for(const h of g.tiles)Object.assign(h,{type:'plain',depth:0,height:0,surface:0});
 Object.assign(a,{q:0,r:0,prone:false});Object.assign(b,{q:3,r:0,prone:false});
 const t=g.tile(1,0);Object.assign(t,{type:'water',depth:2,height:-2,surface:0});
 assert.equal(g.los(a,b).blocked,false);
 Object.assign(t,{height:0,surface:2});
 assert.equal(g.los(a,b).blocked,true);assert.equal(g.los(b,a).blocked,true);
});

test('AGoAC p.16: only walking distance since the last forward backward reversal modifies the target number',()=>{
 const g=fresh(),u=g.units[0];
 for(const h of g.tiles)Object.assign(h,{type:'plain',depth:0,height:0,surface:0});
 for(const v of g.units)if(v!==u)v.dead=true;
 Object.assign(u,{q:0,r:0,facing:0,walk:10,heat:0,spent:0,moveMode:'stand',distanceMoved:0,prone:false,moveStart:{q:0,r:0}});
 g.phase='move';g.activeTeam=u.team;g.queue=[u.team];g.actingId=u.id;
 assert(g.move(u.id,-3,0,'walk').ok);assert.equal(u.distanceMoved,3);assert.equal(g.tmm(u),1);
 assert(g.move(u.id,-1,0,'walk').ok);assert.equal(u.distanceMoved,5);assert.equal(g.tmm(u),0);
 assert(g.move(u.id,0,0,'walk').ok);assert.equal(u.distanceMoved,6);assert.equal(g.tmm(u),1);
 assert(g.move(u.id,-1,0,'walk').ok);assert.equal(u.distanceMoved,7);assert.equal(g.tmm(u),0);
 g.endPhase();assert.equal(g.tmm(u),0);assert.equal(u.tmmTravel,null);
});
test('AGoAC pp.14,17: normal direct leg hits are absorbed by terrain and water partial cover',()=>{
 for(const water of [false,true]){
  const g=fresh(),a=g.units[0],b=g.units[2];
  for(const h of g.tiles)Object.assign(h,{type:'plain',depth:0,height:0,surface:0});
  Object.assign(a,{q:0,r:0,facing:0,prone:false,twist:0});Object.assign(b,{q:3,r:0,facing:3,prone:false});
  if(water)Object.assign(g.tile(3,0),{type:'water',depth:1,height:-1,surface:0});
  else g.tile(2,0).height=1;
  const p=g.preview(a.id,b.id,0);
  assert(p.legal,p.reason);assert.equal(p.mods.cover,1);assert.equal(p.cover,true);
  const before=b.armor.RL,dice=diceFor(5);g.rng=()=>dice.shift()??.5;
  const out=g.hit(b,5,'front','normal',null,p.cover,p.underwaterCover);
  assert.equal(out.location,'RL');assert.equal(out.damage,0);assert.equal(b.armor.RL,before);
 }
});
test('AGoAC pp.19–21: prone bracing and modifiers agree across weapon preview and firing arcs',()=>{
 const g=fresh(),u=g.units[0],v=g.units[2];
 for(const h of g.tiles)Object.assign(h,{type:'plain',depth:0,height:0,surface:0});
 Object.assign(u,{q:0,r:0,facing:0,twist:0,prone:true,moveMode:'run',brace:'LA'});
 Object.assign(v,{q:3,r:0,prone:false});
 const w={name:'Medium Laser',heat:3,damage:5,min:0,ammo:null,location:'CT',ranges:[3,6,9],rack:0};
 u.weapons=[w,{...w,location:'LA'},{...w,location:'RA'},{...w,location:'LL'},{...w,location:'LT',locations:['LA','LT']}];
 for(const brace of ['LA','RA']){
  u.brace=brace;
  const legal=brace==='LA'?[true,false,true,false,false]:[true,true,false,false,true];
  for(const [i,expected] of legal.entries()){
   const p=g.preview(u.id,v.id,i);assert.equal(p.legal,expected,p.reason);
   assert.equal(firingArcTiles(g,u,[i]).has('3,0'),expected);
   if(expected){assert.equal(p.mods.attacker,2);assert.equal(p.mods.prone,2);}
  }
 }
 u.structure.LA=0;
 assert.equal(g.preview(u.id,v.id,0).legal,false);assert.equal(firingArcTiles(g,u,[0]).size,0);
});

test('AGoAC pp.15,21–22: exact ammunition slots are debited atomically at declaration and never again',()=>{
 const g=fresh(),u=g.units[0],t=g.units[2];
 for(const h of g.tiles)Object.assign(h,{type:'plain',depth:0,height:0,surface:0});
 Object.assign(u,{q:0,r:0,facing:0,twist:0,prone:false,moveMode:'stand'});
 Object.assign(t,{q:4,r:0,prone:false,moveMode:'stand'});
 g.phase='fire';g.activeTeam=u.team;g.queue=[u.team,t.team];g.actingId=u.id;
 const index=u.weapons.length;u.weapons.push({...u.weapons[1],shared:1});
 u.bins[0].shots=1;u.bins[1].shots=2;g.syncAmmo(u);
 const before=u.bins.map(b=>b.shots);
 assert(!g.declareFire(u.id,[{index:1,target:t.id,bin:0},{index,target:t.id,bin:0}]).ok);
 assert.deepEqual(u.bins.map(b=>b.shots),before);assert.equal(u.fired,false);
 assert(!g.declareFire(u.id,[{index:1,target:t.id},{index,target:u.id}]).ok);
 assert.deepEqual(u.bins.map(b=>b.shots),before);assert.equal(g.declarations.length,0);
 assert(g.declareFire(u.id,[{index:1,target:t.id},{index,target:t.id,bin:0}]).ok);
 const d=g.declarations.at(-1);assert.equal(d.ammoSpent,true);
 assert.deepEqual(d.shots.map(s=>s.bin),[1,0]);
 assert.deepEqual(u.bins.slice(0,2).map(b=>b.shots),[0,1]);
 assert.equal(u.weapons[1].ammo,1);assert.equal(u.weapons[index].ammo,1);
 // Round-trip the declaration marker as an authoritative saved snapshot.
 g.declarations=JSON.parse(JSON.stringify(g.declarations));
 g.rng=()=>.99;g.resolveFire();
 assert.deepEqual(u.bins.slice(0,2).map(b=>b.shots),[0,1]);
});
test('AGoAC pp.15,19: impossible attack misses even on twelve but a target number of two succeeds',()=>{
 for(const [tn,roll,hit] of [[13,12,false],[12,12,true],[2,2,true],[1,2,true]]){
  const g=fresh(),u=g.units[0],t=g.units[2];
  const d={id:u.id,ammoSpent:true,shots:[{index:0,target:t.id,bin:null,aim:null,heatMode:false,
   weapon:{...u.weapons[0],ammo:null},preview:{targetNumber:tn,side:'front'}}]};
  const dice=diceFor(roll);g.rng=()=>{assert(dice.length);return dice.shift();};
  const [a]=g.rollDeclaredFire(d);
  assert.equal(a.roll,roll);assert.equal(a.hit,hit);
 }
});

test('AGoAC p.13: AI requests a defender LOS choice only for its nominated attack and preserves that target',()=>{
 const g=fresh(),u=g.units[2],a=g.units[0],b=g.units[1];
 for(const t of g.tiles)Object.assign(t,{type:'plain',depth:0,height:0,surface:0});
 Object.assign(u,{q:0,r:0,facing:0,prone:false,heat:0,moveMode:'stand',fired:false});
 Object.assign(a,{q:1,r:1,prone:false,fired:false});
 Object.assign(b,{q:2,r:-1,prone:false,fired:false});
 u.weapons=[{name:'Medium Laser',location:'CT',heat:3,damage:5,min:0,ammo:null,ranges:[3,6,9],rack:0}];
 g.phase='fire';g.queue=[u.team,a.team];g.activeTeam=u.team;g.actingId=u.id;
 g.planAiFire=()=>({target:a.id,indices:[0],twist:0,score:50});
 const result=g.aiAttackWithLosChoices(u.id,{humanTeams:[a.team]});
 assert(result.pending);assert.equal(g.pendingChoice.unitId,a.id);
 assert.equal(g.selectedLosPath(u,b),0);assert.equal(g.declarations.length,0);
 const p=g.pendingChoice;
 g.planAiFire=()=>{throw Error('Must keep nominated target after defender choice');};
 assert(g.resolveFireLosChoice({key:p.key,option:p.options[0].id},[a.team]).ok);
 assert(g.aiAttackWithLosChoices(u.id,{humanTeams:[a.team]}).ok);
 assert.equal(g.selectedLosPath(u,b),0);assert.equal(g.declarations.at(-1).shots[0].target,a.id);
 assert.equal(u.aiFirePlan,undefined);
});
test('AGoAC pp.15,22: cancel impossible declared attack without heat or ammunition expenditure or retargeting',()=>{
 for(const cancel of [true,false]){
  const g=fresh(),u=g.units[0],t=g.units[2];
  for(const h of g.tiles)Object.assign(h,{type:'plain',depth:0,height:0,surface:0});
  Object.assign(u,{q:0,r:0,facing:0,twist:0,prone:false,moveMode:'stand',gunnery:13});
  Object.assign(t,{q:4,r:0,prone:false,moveMode:'stand'});
  g.phase='fire';g.activeTeam=u.team;g.queue=[u.team,t.team];g.actingId=u.id;
  const initial=u.bins[0].shots,heat=u.pendingHeat;
  assert(g.declareFire(u.id,[{index:1,target:t.id,bin:0}]).ok);
  assert.equal(u.bins[0].shots,initial-1);
  const decisions=[];
  g._resolutionChooser=(request,fallback)=>{
   if(request.kind!=='fire-impossible')return fallback;
   decisions.push(request.context);return cancel?'cancel':'fire';
  };
  g.rng=()=>.99;
  const results=g.resolveFire();
  assert.equal(decisions.length,1);assert.equal(decisions[0].targetId,t.id);
  assert.equal(u.bins[0].shots,initial-Number(!cancel));
  assert.equal(u.pendingHeat,heat+(cancel?0:u.weapons[1].heat));
  if(cancel){assert.equal(results.length,0);assert.equal(u.firedLocations.length,0);}
  else{assert.equal(results.length,1);assert.equal(results[0].shots[0].hit,false);}
 }
});

test('AGoAC p.21: aimed location check is independent of normal hit location and cover rerolls',()=>{
 for(const [sums,expected,cover,aim] of [[[6],'HD',false,'HD'],[[8],'LT',false,'LT'],[[2,3],'RA',false,'HD'],[[5,5,6],'RT',true,'HD'],[[9,7],'CT',false,'HD']]){
  const g=fresh(),u=g.units[2],draws=sums.flatMap(diceFor),applied=[];
  g.rng=()=>{assert(draws.length,'unexpected roll');return draws.shift();};
  g.damage=(target,loc,amount,opts)=>{applied.push({loc,amount,tac:!!opts.tac});return [];};
  const result=g.hit(u,5,'front','normal',aim,cover);
  assert.equal(result.location,expected);assert.equal(result.damage,5);
  assert.deepEqual(applied,[{loc:expected,amount:5,tac:false}]);
  assert.equal(draws.length,0);assert.equal(g.phaseRolls.length,sums.length);
 }
});
test('AGoAC pp.15,21–22: interactive cancellation replay refunds exactly one reserved round while the other attack misses',()=>{
 const g=fresh(),u=g.units[0],t=g.units[2];
 for(const h of g.tiles)Object.assign(h,{type:'plain',depth:0,height:0,surface:0});
 Object.assign(u,{q:0,r:0,facing:0,twist:0,prone:false,moveMode:'stand',gunnery:13});
 Object.assign(t,{q:4,r:0,prone:false,moveMode:'stand'});
 const index=u.weapons.length;u.weapons.push({...u.weapons[1],shared:1});
 g.phase='fire';g.activeTeam=u.team;g.queue=[u.team,t.team];g.actingId=u.id;
 const initial=u.bins.slice(0,2).map(b=>b.shots),heat=u.pendingHeat;
 assert(g.declareFire(u.id,[{index:1,target:t.id,bin:0},{index,target:t.id,bin:1}]).ok);
 g.queue=[];g.activeTeam=null;g.actingId=null;g.initiativeWinner=1;
 let draws=0;g.rng=()=>{draws++;return .99;};
 const respond=option=>g.nextPhaseWithChoices({humanTeams:[0],choice:{key:g.pendingChoice.key,option}});
 assert(g.nextPhaseWithChoices({humanTeams:[0]}).pending);
 assert.equal(g.pendingChoice.kind,'fire-roll-weapon');
 assert(respond('1').pending);assert.equal(g.pendingChoice.kind,'fire-impossible');
 assert.equal(draws,0);
 assert(respond('cancel').pending);assert.equal(g.pendingChoice.kind,'fire-impossible');
 assert.deepEqual(g.units[0].bins.slice(0,2).map(b=>b.shots),initial.map(n=>n-1));
 const saved=JSON.parse(JSON.stringify({choice:g.pendingChoice,journal:g._resolutionReplay}));
 g.pendingChoice=saved.choice;g._resolutionReplay=saved.journal;
 assert.equal(respond('forged').ok,false);assert.equal(draws,0);
 assert(respond('fire').ok);
 assert.equal(g.pendingChoice,null);assert.equal(g.phase,'physical');assert.equal(draws,2);
 assert.deepEqual(g.units[0].bins.slice(0,2).map(b=>b.shots),[initial[0],initial[1]-1]);
 assert.equal(g.units[0].pendingHeat,heat+u.weapons[index].heat);
 assert.equal(g.resolution.length,1);assert.equal(g.resolution[0].shots[0].index,index);
 assert.equal(g.resolution[0].shots[0].hit,false);
});

test('AGoAC pp.13,15,17: empty hex attacks use immobility and mixed target modifiers with normal ammo and heat',()=>{
 const g=fresh(),u=g.units[0],t=g.units[2],ally=g.units[1];
 for(const h of g.tiles)Object.assign(h,{type:'plain',depth:0,height:0,surface:0});
 Object.assign(u,{q:0,r:0,facing:0,prone:false,twist:0,moveMode:'stand'});
 Object.assign(t,{q:3,r:0,prone:false,moveMode:'stand'});
 Object.assign(ally,{q:1,r:0,prone:false});
 const hex='hex:4,0';
 assert.equal(g.fireTarget('hex:1,0'),null);assert.equal(g.fireTarget('hex:3,0'),null);
 assert.equal(g.fireTarget('hex:999,999'),null);assert.equal(g.fireTarget('hex:04,0'),null);
 assert.equal(g.preview(u.id,hex,1).mods.target,-4);
 assert.equal(g.preview(u.id,hex,1,{aim:'HD'}).legal,false);
 assert.deepEqual(g.primaryTargetChoices(u.id,[{target:t.id},{target:hex}]),[t.id,hex]);
 g.phase='fire';g.activeTeam=u.team;g.queue=[u.team,t.team];g.actingId=u.id;
 const ammo=u.bins[0].shots,heat=u.pendingHeat;
 const result=g.declareFire(u.id,[{index:0,target:t.id},{index:1,target:hex,bin:0}],t.id);
 assert(result.ok,result.error);
 assert.equal(u.bins[0].shots,ammo-1);
 assert.equal(g.declarations[0].shots[1].preview.mods.secondary,1);
 assert.equal(g.declarations[0].shots[1].preview.mods.target,-4);
 g.rng=()=>.99;g.resolveFire();
 const empty=g.resolution.find(x=>x.target===hex);
 assert(empty);assert.equal(empty.shots[0].damage,0);
 assert.equal(u.pendingHeat,heat+u.weapons[0].heat+u.weapons[1].heat);
 assert.equal(u.bins[0].shots,ammo-1);
});
test('AGoAC p.13: an empty hex edge LOS is randomized once per attacker and round',()=>{
 for(const [draw,expected] of [[.1,1],[.9,-1]]){
  const g=fresh(),u=g.units[0];
  for(const h of g.tiles)Object.assign(h,{type:'plain',depth:0,height:0,surface:0});
  Object.assign(u,{q:0,r:0,facing:0,prone:false});
  for(const [i,v] of g.units.entries())if(v!==u)Object.assign(v,{q:-3,r:i-2});
  g.phase='fire';g.activeTeam=u.team;g.queue=[u.team,1-u.team];g.actingId=u.id;
  const hex='hex:1,1',v=g.fireTarget(hex);
  assert(v);assert.equal(g.losAlternatives(u,v).length,2);
  let draws=0;g.rng=()=>{draws++;return draw;};
  assert(g.prepareFireLos(u.id,[hex,hex],[0,1]).losPrepared);
  assert.equal(g.selectedLosPath(u,v),expected);assert.equal(g.selectedLosPath(v,u),-expected);
  assert.equal(draws,1);assert.equal(g.pendingChoice,null);
  assert.equal(g.prepareFireLos(u.id,[hex],[0,1]).losPrepared,false);assert.equal(draws,1);
  g.round++;assert.equal(g.selectedLosPath(u,v),0);
  assert(g.prepareFireLos(u.id,[hex],[0,1]).losPrepared);assert.equal(draws,2);
 }
});

test('AGoAC p.13: surface hex LOS permits level ground but a higher adjacent ridge blocks reciprocally',()=>{
 const g=fresh(),u=g.units[0],v=g.units[2];
 for(const h of g.tiles)Object.assign(h,{type:'plain',depth:0,height:0,surface:0});
 Object.assign(u,{q:0,r:0,facing:0,prone:false,twist:0});
 Object.assign(v,{q:4,r:-1,prone:false});
 for(const [i,x] of g.units.entries())if(x!==u&&x!==v)Object.assign(x,{q:-3,r:i-2});
 const hex=g.fireTarget('hex:4,0');assert(hex);
 const check=blocked=>{
  assert.equal(g.los(u,hex).blocked,blocked);
  assert.equal(g.los(hex,u).blocked,blocked);
 };
 check(false);
 const ridge=g.tile(3,0);ridge.height=1;ridge.surface=1;check(true);
 ridge.height=0;ridge.surface=0;check(false);
 ridge.type='woods';check(false);assert.equal(g.los(u,hex).woods,1);
 ridge.type='plain';
 Object.assign(g.tile(4,0),{type:'water',depth:1,height:-1,surface:0});check(false);
 // A Mech-to-Mech endpoint retains the inclusive elevation threshold.
 Object.assign(v,{q:4,r:0});ridge.height=2;ridge.surface=2;
 assert.equal(g.los(u,v).blocked,true);assert.equal(g.los(v,u).blocked,true);
});

test('AGoAC p.21: indirect LRM modifiers use spotter movement and terrain but attacker range, with later spotter firing penalty',()=>{
 const g=fresh(),u=g.units[0],s=g.units[1],t=g.units[2],other=g.units[3];
 for(const h of g.tiles)Object.assign(h,{type:'plain',depth:0,height:0,surface:0});
 Object.assign(u,{q:0,r:0,facing:0,prone:false,twist:0,moveMode:'walk'});
 Object.assign(s,{q:4,r:-3,facing:5,prone:false,twist:0,moveMode:'run'});
 Object.assign(t,{q:4,r:0,prone:false,moveMode:'run',distanceMoved:5});
 Object.assign(other,{q:-3,r:0});
 g.tile(2,0).height=2;g.tile(4,0).type='woods';
 const w={name:'LRM 10',heat:4,damage:1,min:6,ammo:24,location:'RT',ranges:[7,14,21],rack:10};
 u.weapons=[w];u.bins=[{weapon:0,location:'RT',slot:1,shots:24,destroyed:false}];
 s.weapons=[{name:'Medium Laser',heat:3,damage:5,min:0,ammo:null,location:'CT',ranges:[3,6,9],rack:0}];
 assert(g.los(u,t).blocked);assert(!g.los(s,t).blocked);
 const p=g.preview(u.id,t.id,0,{spotter:s.id});
 assert(p.legal,p.reason);assert.equal(p.mods.attacker,1);assert.equal(p.mods.target,2);
 assert.equal(p.mods.spotter,2);assert.equal(p.mods.indirect,1);assert.equal(p.mods.terrain,1);
 assert.equal(p.mods.minimum,3);assert.equal(p.range,4);
 assert.equal(p.mods.spotterFires,0);
 g.phase='fire';g.activeTeam=u.team;g.queue=[u.team,u.team,t.team];g.actingId=u.id;
 const first=g.declareFire(u.id,[{index:0,target:t.id,spotter:s.id}]);assert(first.ok,first.error);
 g.activeTeam=s.team;g.actingId=s.id;g.queue=[s.team,t.team];
 const second=g.declareFire(s.id,[{index:0,target:t.id}]);assert(second.ok,second.error);
 const direct=g.declarations[1].shots[0].preview;
 assert.equal(direct.mods.spotting,1);
 const shot=g.declarations[0].shots[0].preview,tn=shot.targetNumber;
 g.finalizeSpottingModifiers();assert.equal(shot.mods.spotterFires,1);assert.equal(shot.targetNumber,tn+1);
 g.finalizeSpottingModifiers();assert.equal(shot.targetNumber,tn+1);
 assert.equal(u.bins[0].shots,23);
});
test('AGoAC p.21: one spotter per target, multiple launchers, direct LOS and non-LRM exclusions',()=>{
 const g=fresh(),u=g.units[0],s=g.units[1],a=g.units[2],b=g.units[3];
 for(const h of g.tiles)Object.assign(h,{type:'plain',depth:0,height:0,surface:0});
 Object.assign(u,{q:0,r:0,facing:0,prone:false,twist:0});
 Object.assign(s,{q:4,r:-3,prone:false});
 Object.assign(a,{q:4,r:0,prone:false});
 Object.assign(b,{q:5,r:0,prone:false});
 const lrm={name:'LRM 10',heat:4,damage:1,min:6,ammo:24,location:'RT',ranges:[7,14,21],rack:10};
 u.weapons=[lrm,{...lrm,location:'CT'},{...lrm,name:'SRM 6'}];
 assert.equal(g.preview(u.id,a.id,0,{spotter:s.id}).legal,false,'direct LOS exists');
 g.tile(2,0).height=2;
 assert(g.preview(u.id,a.id,0,{spotter:s.id}).legal);
 assert.equal(g.preview(u.id,a.id,2,{spotter:s.id}).legal,false);
 assert.equal(g.preview(u.id,a.id,0,{spotter:u.id}).legal,false);
 assert.equal(g.preview(u.id,a.id,0,{spotter:b.id}).legal,false);
 assert.equal(g.preview(u.id,a.id,0,{spotter:s.id,aim:'CT'}).legal,false);
 s.charge={target:a.id};assert(!g.preview(u.id,a.id,0,{spotter:s.id}).legal);s.charge=null;
 g.declarations=[{id:u.id,shots:[{target:a.id,spotter:s.id}]}];
 assert(g.preview(u.id,a.id,1,{spotter:s.id}).legal);
 assert(!g.preview(u.id,b.id,1,{spotter:s.id}).legal);
 // A terrain ridge gives a modifier, but only water stops indirect leg hits.
 g.tile(4,-1).height=1;
 const covered=g.preview(u.id,a.id,0,{spotter:s.id});
 assert(covered.legal,covered.reason);assert.equal(covered.mods.cover,1);assert.equal(covered.cover,false);
 Object.assign(g.tile(4,0),{type:'water',depth:1,height:-1,surface:0});g.tile(4,-1).height=0;
 const wet=g.preview(u.id,a.id,0,{spotter:s.id});assert.equal(wet.cover,true);
});

test('AGoAC pp.13,15: direct declaration cannot bypass a defender LOS and records selected path',()=>{
 for(const blocked of [true,false]){
  const g=fresh(),a=g.units[0],b=g.units[2];
  for(const h of g.tiles)Object.assign(h,{type:'plain',depth:0,height:0,surface:0});
  Object.assign(a,{q:0,r:0,facing:0,twist:0,prone:false});
  Object.assign(b,{q:1,r:1,prone:false});
  if(blocked)g.tile(1,0).height=2;
  a.weapons=[{name:'Medium Laser',heat:3,damage:5,min:0,ammo:null,location:'CT',ranges:[3,6,9],rack:0}];
  g.phase='fire';g.queue=[a.team,b.team];g.activeTeam=a.team;g.actingId=a.id;
  const result=g.declareFire(a.id,[{index:0,target:b.id}]);
  assert.equal(result.ok,!blocked,result.error);
  const chosen=g.selectedLosPath(a,b);assert([-1,1].includes(chosen));
  assert.equal(g.selectedLosPath(b,a),-chosen);
  if(blocked){assert.equal(a.fired,false);assert.equal(g.declarations.length,0);}
  else assert.equal(g.declarations[0].shots[0].losChoice,chosen);
 }
});
test('AGoAC p.21: cancelled spotter fire removes the extra modifier before all rolls',()=>{
 for(const cancel of [false,true]){
  const g=fresh(),u=g.units[0],s=g.units[1],t=g.units[2];
  const weapon={name:'Medium Laser',rack:0,heat:3,ammo:null,damage:5,location:'CT'};
  const shot=(index,spotter,targetNumber,mods)=>({index,target:t.id,bin:null,aim:null,heatMode:false,
   weapon:{...weapon},preview:{targetNumber,mods,side:'front',cover:false,underwaterCover:false},...(spotter==null?{}:{spotter})});
  const indirect=shot(0,s.id,13,{spotterFires:1}),direct=shot(0,null,14,{spotting:1});
  g.declarations=[{id:u.id,ammoSpent:true,shots:[indirect]},{id:s.id,ammoSpent:true,shots:[direct]}];
  const decisions=[];
  g._resolutionChooser=(request,fallback)=>{
   if(request.kind!=='fire-impossible')return fallback;
   decisions.push(request.unitId);return request.unitId===s.id&&cancel?'cancel':'fire';
  };
  let draws=0;g.rng=()=>{draws++;return .99;};
  const omitted=g.prepareSpottingCancellations();
  assert.equal(draws,0);assert.equal(omitted.has(direct),cancel);
  assert.equal(indirect.preview.targetNumber,cancel?12:13);
  assert.deepEqual(decisions,cancel?[s.id]:[s.id,u.id]);
  assert.equal(g.rollDeclaredFire(g.declarations[0],{cancelled:omitted})[0].hit,cancel);
  assert.equal(g.rollDeclaredFire(g.declarations[1],{cancelled:omitted}).length,cancel?0:1);
  assert.equal(s.pendingHeat,cancel?0:3);
 }
});
test('AGoAC pp.13,21: already-fired spotter defender choice resumes without another selection or ammo debit',()=>{
 const g=fresh(),u=g.units[0],s=g.units[1],t=g.units[2],b=g.units[3];
 for(const h of g.tiles)Object.assign(h,{type:'plain',depth:0,height:0,surface:0});
 Object.assign(u,{q:0,r:0,facing:0,twist:0,prone:false});
 Object.assign(s,{q:3,r:-1,prone:false,fired:true});
 Object.assign(t,{q:4,r:0,prone:false});
 Object.assign(b,{q:-3,r:0});
 g.tile(2,0).height=2;
 u.weapons=[{name:'LRM 10',heat:4,damage:1,min:6,ammo:24,location:'RT',ranges:[7,14,21],rack:10}];
 u.bins=[{weapon:0,location:'RT',slot:1,shots:24,destroyed:false}];
 g.phase='fire';g.queue=[u.team,t.team];g.activeTeam=u.team;g.actingId=u.id;
 const orders=[{index:0,target:t.id,spotter:s.id}];
 const a=g.declareFireWithLosChoices(u.id,orders,null,{humanTeams:[0,1]});
 assert(a.pending);assert.equal(g.pendingChoice.context.attackerId,s.id);
 assert.equal(g.pendingChoice.context.spotting,true);assert.equal(u.bins[0].shots,24);
 const p=JSON.parse(JSON.stringify(g.pendingChoice));g.pendingChoice=p;
 assert(g.resolveFireLosChoice({key:p.key,option:p.options[0].id},[0,1]).ok);
 const result=g.declareFireWithLosChoices(u.id,orders,null,{humanTeams:[0,1]});
 assert(result.ok,result.error);assert(result.declared);
 assert.equal(g.pendingChoice,null);assert.equal(u.bins[0].shots,23);
 assert.equal(g.declarations.at(-1).shots[0].spotterLosChoice,Number(p.options[0].id));
});
test('AGoAC pp.19,21: prone spotter adds cumulative movement modifier to indirect attacks',()=>{
 const g=fresh(),u=g.units[0],s=g.units[1],t=g.units[2];
 for(const h of g.tiles)Object.assign(h,{type:'plain',depth:0,height:0,surface:0});
 Object.assign(u,{q:0,r:0,facing:0,prone:false,twist:0,moveMode:'stand'});
 Object.assign(s,{q:4,r:-3,config:'Biped',prone:false,moveMode:'run'});
 Object.assign(t,{q:4,r:0,prone:false,moveMode:'stand'});
 g.tile(2,0).height=2;
 u.weapons=[{name:'LRM 10',heat:4,damage:1,min:6,ammo:24,location:'RT',ranges:[7,14,21],rack:10}];
 const standing=g.preview(u.id,t.id,0,{spotter:s.id});
 assert(standing.legal,standing.reason);assert.equal(standing.mods.spotter,2);
 s.prone=true;
 const prone=g.preview(u.id,t.id,0,{spotter:s.id});
 assert(prone.legal,prone.reason);assert.equal(prone.mods.spotter,4);
 assert.equal(prone.targetNumber,standing.targetNumber+2);
});

// Chapter 6: printed Attack Direction Diagram and both p.23 tables.
test('AGoAC p.22: six neighboring directions, four boundary rays and target body facing',()=>{
 const g=fresh(),t=g.units[0],a=g.units[2];
 Object.assign(t,{q:0,r:0,facing:0,twist:0,prone:false});
 const cases=[[[1,0],['front']],[[1,-1],['front']],[[0,-1],['left']],
  [[-1,0],['rear']],[[-1,1],['right']],[[0,1],['front']],
  [[1,-2],['front','left']],[[-1,2],['front','right']],
  [[-2,1],['right','rear']],[[-1,-1],['left','rear']]];
 const rotate=([q,r])=>[-r,q+r]; // one clockwise axial step
 for(let facing=0;facing<6;facing++){
  t.facing=facing;t.twist=1;t.prone=!!(facing%2);
  for(const [coords,expected] of cases){
   // relative() uses mathematical counterclockwise facing; invert rotation.
   let p=coords;for(let i=0;i<(6-facing)%6;i++)p=rotate(p);
   Object.assign(a,{q:p[0],r:p[1]});
   assert.deepEqual(g.hitSideOptions(t,a),expected,'facing '+facing+' from '+p);
  }
 }
});
test('AGoAC p.23: every normal hit location and through-armor opportunity by direction',()=>{
 const columns={front:['CT','RA','RA','RL','RT','CT','LT','LL','LA','LA','HD'],
 rear:['CT','RA','RA','RL','RT','CT','LT','LL','LA','LA','HD'],
 left:['LT','LL','LA','LA','LL','LT','CT','RT','RA','RL','HD'],
 right:['RT','RL','RA','RA','RL','RT','CT','LT','LA','LL','HD']};
 for(const [side,locations] of Object.entries(columns))for(let roll=2;roll<=12;roll++){
  const g=fresh(),t=g.units[2],dice=diceFor(roll);g.rng=()=>{assert(dice.length);return dice.shift();};
  let applied;g.damage=(u,loc,amount,options)=>{applied={loc,amount,...options};return [];};
  const result=g.hit(t,5,side);
  assert.equal(result.location,locations[roll-2]);
  assert.deepEqual(applied,{loc:locations[roll-2],amount:5,rear:side==='rear',tac:roll===2});
  assert.equal(dice.length,0);
 }
});
test('AGoAC pp.23–24: all base launcher cluster rolls allocate separate SRM or five-point LRM packets',()=>{
 const columns={2:[1,1,1,1,1,1,2,2,2,2,2],4:[1,2,2,2,2,3,3,3,3,4,4],
  5:[1,2,2,3,3,3,3,4,4,5,5],6:[2,2,3,3,4,4,4,5,5,6,6],
  10:[3,3,4,6,6,6,6,8,8,10,10],15:[5,5,6,9,9,9,9,12,12,15,15],
  20:[6,6,9,12,12,12,12,16,16,20,20]};
 for(const [rack,values] of Object.entries(columns))for(let roll=2;roll<=12;roll++){
  const g=fresh(),n=values[roll-2],srm=[2,4,6].includes(+rack),dice=diceFor(roll);
  const s={weapon:{name:(srm?'SRM ':'LRM ')+rack,rack:+rack,damage:srm?2:1}};
  g.rng=()=>{assert(dice.length);return dice.shift();};
  assert.deepEqual(g.fireAmounts(s,false),[]);
  const out=g.fireAmounts(s,true);
  assert.deepEqual(out,srm?Array(n).fill(2):[...Array(Math.floor(n/5)).fill(5),...(n%5?[n%5]:[])]);
  assert.equal(dice.length,0);
 }
});
test('AGoAC p.22: defender selects a boundary side before location rolls and saved replay preserves dice',()=>{
 const g=fresh(),u=g.units[0],t=g.units[2];
 Object.assign(u,{q:-1,r:-1,facing:5,prone:false});
 Object.assign(t,{q:0,r:0,facing:0,twist:1,prone:false});
 g.phase='fire';g.activeTeam=null;g.queue=[];g.initiativeWinner=1;
 const options=g.hitSideOptions(t,u);assert.deepEqual(options,['left','rear']);
 g.declarations=[{id:u.id,ammoSpent:true,shots:[{index:0,target:t.id,aim:null,bin:null,heatMode:false,
  weapon:{name:'Medium Laser',rack:0,ammo:null,heat:3,damage:5,location:'CT'},
  preview:{targetNumber:2,side:options[0],sideOptions:options,cover:false,underwaterCover:false}}]}];
 const dice=[...diceFor(8),...diceFor(7)];let draws=0;g.rng=()=>{draws++;return dice.shift()??.99;};
 const rear=t.rear.CT,front=t.armor.CT;
 assert(g.nextPhaseWithChoices({humanTeams:[0,1]}).pending);
 const choice=g.pendingChoice;assert.equal(choice.kind,'hit-direction');assert.equal(choice.team,t.team);
 assert.deepEqual(choice.options.map(o=>o.id),['left','rear']);assert.equal(draws,2);
 assert.equal(g.nextPhaseWithChoices({choice:{key:choice.key,option:'front'}}).ok,false);
 assert.equal(draws,2);assert.equal(g.units[2].rear.CT,rear);
 assert(g.nextPhaseWithChoices({choice:{key:choice.key,option:'rear'}}).ok);
 assert.equal(g.pendingChoice,null);assert.equal(draws,4);
 assert.equal(g.units[2].rear.CT,rear-5);assert.equal(g.units[2].armor.CT,front);
});

test('AGoAC p.24: LRM20 example resolves twelve missiles as three independent hit locations',()=>{
 const g=fresh(),a=g.units[0],t=g.units[2];
 Object.assign(t,{q:0,r:0,facing:0,prone:false});
 Object.assign(a,{q:0,r:-2});
 assert.deepEqual(g.hitSideOptions(t,a),['left']);
 g.phase='fire';g.queue=[];g.activeTeam=null;g.initiativeWinner=1;
 const s={index:0,target:t.id,bin:null,aim:null,heatMode:false,
  weapon:{name:'LRM 20',rack:20,ammo:null,heat:6,damage:1,location:'CT'},
  preview:{targetNumber:2,side:'left',sideOptions:['left'],cover:false,underwaterCover:false}};
 g.declarations=[{id:a.id,ammoSpent:true,shots:[s]}];
 const dice=[...diceFor(10),...diceFor(8),...diceFor(8),...diceFor(4),...diceFor(11)];
 g.rng=()=>{assert(dice.length,'Unexpected die');return dice.shift();};
 const hits=[];
 g.damage=(u,loc,amount,opts)=>{assert.equal(u.id,t.id);hits.push([loc,amount,opts.rear]);return [];};
 const result=g.resolveFire();
 assert.deepEqual(hits,[['CT',5,false],['LA',5,false],['RL',2,false]]);
 assert.equal(result[0].shots[0].damage,12);
 assert.equal(result[0].shots[0].rolls.length,5);assert.equal(dice.length,0);
});


test('AGoAC pp.22–24: partial cover absorbs only its own missile hit packets',()=>{
 for(const water of [false,true]){
  const g=fresh(),u=g.units[0],t=g.units[2];
  Object.assign(t,{q:0,r:0,facing:0,prone:false});Object.assign(u,{q:2,r:0});
  for(const hex of g.tiles)Object.assign(hex,{type:'plain',depth:0,height:0,surface:0});
  if(water)Object.assign(g.tile(0,0),{type:'water',depth:1,height:-1,surface:0});
  const before={...t.armor};
  const dice=[10,12,5,7,9,6].flatMap(diceFor);
  g.rng=()=>{assert(dice.length,'Unexpected die');return dice.shift();};
  g.phase='fire';g.queue=[];g.activeTeam=null;g.initiativeWinner=1;
  g.declarations=[{id:u.id,ammoSpent:true,shots:[{index:0,target:t.id,bin:null,aim:null,heatMode:false,
   weapon:{name:'SRM 4',rack:4,ammo:null,heat:3,damage:2,location:'CT'},
   // Above-water fire against a depth-one target obscures legs, not its torso.
   preview:{targetNumber:2,side:'front',sideOptions:['front'],cover:true,underwaterCover:false}}]}];
  const r=g.resolveFire()[0].shots[0];
  assert.equal(r.damage,4);assert.equal(r.rolls.length,6);
  assert.equal(t.armor.RL,before.RL);assert.equal(t.armor.LL,before.LL);
  assert.equal(t.armor.CT,before.CT-2);assert.equal(t.armor.RT,before.RT-2);
  assert.equal(dice.length,0);
 }
});
test('AGoAC p.24: weapon damage accumulates before phase-end PSR and physical attacks',()=>{
 for(const damage of [9,10]){
  const g=fresh(),u=g.units[0],t=g.units[2];
  Object.assign(t,{q:0,r:0,facing:0,prone:false,unconscious:false,shutdown:false});
  Object.assign(u,{q:2,r:0,facing:3});
  t.armor.CT=t.armor.RT=30;
  g.phase='fire';g.queue=[];g.activeTeam=null;g.initiativeWinner=1;
  const shot=index=>({index,target:t.id,bin:null,aim:null,heatMode:false,
   weapon:{name:'Test laser '+index,rack:0,ammo:null,heat:1,damage,location:'CT'},
   preview:{targetNumber:2,side:'front',sideOptions:['front'],cover:false,underwaterCover:false}});
  g.declarations=[{id:u.id,ammoSpent:true,shots:[shot(0),shot(1)]}];
  const dice=[10,10,7,6,...(damage===10?[12]:[])].flatMap(diceFor);
  g.rng=()=>{assert(dice.length,'Unexpected die');return dice.shift();};
  assert(g.nextPhase().ok);assert.equal(g.phase,'physical');
  assert.deepEqual(g.resolution.map(r=>r.shots[0].damage),[damage,damage]);
  assert.equal(t.armor.CT,30-damage);assert.equal(t.armor.RT,30-damage);
  assert.equal(t.phaseDamage,0);assert.deepEqual(t.psrs,[]);assert.equal(t.prone,false);
  assert.equal(g.afterRolls.length,damage===10?1:0);
  if(damage===10){assert.match(g.afterRolls[0].kind,/20\+ урона/);assert.equal(g.afterRolls[0].target,t.piloting+1);}
  assert.equal(dice.length,0);
 }
});
test('AGoAC p.22: AI defender resolves a legal boundary without requesting a human choice',()=>{
 const g=fresh(),u=g.units[0],t=g.units[2];
 Object.assign(u,{q:-1,r:-1});Object.assign(t,{q:0,r:0,facing:0,prone:false});
 g.phase='fire';g.queue=[];g.activeTeam=null;g.initiativeWinner=1;
 const options=g.hitSideOptions(t,u);assert.deepEqual(options,['left','rear']);
 g.declarations=[{id:u.id,ammoSpent:true,shots:[{index:0,target:t.id,bin:null,aim:null,heatMode:false,
  weapon:{name:'Medium Laser',rack:0,ammo:null,heat:3,damage:1,location:'CT'},
  preview:{targetNumber:2,side:options[0],sideOptions:options,cover:false,underwaterCover:false}}]}];
 const before=t.armor.LT,dice=[10,7].flatMap(diceFor);let draws=0;
 g.rng=()=>{assert(dice.length,'Unexpected die');draws++;return dice.shift();};
 const result=g.nextPhaseWithChoices({humanTeams:[0]});
 assert(result.ok&&!result.pending);assert.equal(g.pendingChoice,null);assert.equal(draws,4);
 assert.equal(g.unit(t.id).armor.LT,before-1);assert.equal(g.phase,'physical');
});


function physicalBlockFixture(){
 const g=fresh(),u=g.units[0],t=g.units[2];
 for(const h of g.tiles)Object.assign(h,{type:'plain',height:0,surface:0,depth:0});
 Object.assign(u,{q:0,r:0,facing:0,prone:false,club:true,moveMode:'stand',twist:0});
 Object.assign(t,{q:1,r:0,facing:3,prone:false,moveMode:'stand',distanceMoved:0});
 // Separate the hatchet arm from the arm tested for punches.
 u.hatchets=[{location:'LA',slots:1}];u.slots.LA[7]='hatchet';
 return {g,u,t};
}
test('AGoAC p.25: standing and prone elevation matrix selects legal physical attacks and hit tables',()=>{
 const attacks=[['punch','RA'],['kick','RL'],['club','RA'],['hatchet','LA'],['push','RA']];
 const cases=[
  [false,0,['punch','kick','normal','normal','normal']],
  [false,1,['kick',null,'kick','kick',null]],
  [false,-1,[null,'punch','punch','punch',null]],
  [true,0,[null,'normal','normal','normal',null]],
  [true,1,['normal',null,'normal','normal',null]],
  [true,-1,[null,null,null,null,null]]
 ];
 for(const [prone,height,tables] of cases){
  const {g,u,t}=physicalBlockFixture();t.prone=prone;g.tile(t.q,t.r).height=height;
  for(let i=0;i<attacks.length;i++){
   const p=g.physicalPreview(u.id,t.id,...attacks[i]);
   assert.equal(p.legal,tables[i]!==null,JSON.stringify([prone,height,attacks[i],p.reason]));
   if(p.legal)assert.equal(p.table,tables[i]);
  }
 }
});
test('AGoAC pp.24–25: physical TN uses piloting and movement not heat sensors or PSR-only gyro damage',()=>{
 const {g,u,t}=physicalBlockFixture();
 u.piloting=5;u.heat=25;u.sensorHits=2;u.gyroHits=1;
 u.moveMode='walk';t.moveMode='stand';
 g.tile(t.q,t.r).type='woods';
 const p=g.physicalPreview(u.id,t.id,'punch','RA');
 assert(p.legal,p.reason);assert.equal(p.targetNumber,7);
 t.prone=true;g.tile(t.q,t.r).height=1;
 const prone=g.physicalPreview(u.id,t.id,'punch','RA');
 assert(prone.legal,prone.reason);assert.equal(prone.targetNumber,p.targetNumber-2);
});
test('AGoAC p.25: standing depth-one biped cover excludes kicks and absorbs covered club hits',()=>{
 const {g,u,t}=physicalBlockFixture();
 Object.assign(g.tile(t.q,t.r),{type:'water',depth:1,height:-1,surface:0});
 const club=g.physicalPreview(u.id,t.id,'club','RA'),kick=g.physicalPreview(u.id,t.id,'kick','RL');
 assert(club.legal&&kick.legal);assert.equal(club.table,'punch');assert.equal(kick.table,'punch');
 assert.equal(club.physicalCover,false);assert.equal(kick.physicalCover,false);
 assert.equal(club.targetNumber,kick.targetNumber+1);
 // Equal underlying height: normal club may roll a submerged leg; kick does not test cover.
 Object.assign(g.tile(u.q,u.r),{type:'water',depth:1,height:-1,surface:0});
 const same=g.physicalPreview(u.id,t.id,'club','RA');
 assert(same.legal);assert.equal(same.table,'normal');assert(same.physicalCover);
 const dice=diceFor(5);g.rng=()=>{assert(dice.length);return dice.shift();};
 const before=t.armor.RL;
 g.resolveRolledPhysical({u,t,d:{...same,type:'club'},roll:12,hit:true,cancelled:false,attackRoll:null});
 assert.equal(t.armor.RL,before);assert.equal(g.resolution.at(-1).shots[0].damage,0);
 assert.equal(dice.length,0);
});
test('AGoAC p.25: cancelling impossible kick avoids missed-kick PSR and reuses no dice',()=>{
 const {g,u,t}=physicalBlockFixture();
 g.phase='physical';g.queue=[];g.initiativeWinner=1;g.activeTeam=null;
 g.physicalDeclarations=[{id:u.id,target:t.id,type:'kick',limb:'RL',damage:10,table:'kick',side:'front',targetNumber:13}];
 let draws=0;g.rng=()=>{draws++;return .99;};
 assert(g.nextPhaseWithChoices({humanTeams:[0]}).pending);
 const p=g.pendingChoice;assert.equal(p.kind,'physical-impossible');assert.equal(draws,0);
 assert.equal(p.team,u.team);assert.equal(p.context.targetNumber,13);
 assert(!g.nextPhaseWithChoices({choice:{key:p.key,option:'hit'}}).ok);
 assert(g.nextPhaseWithChoices({choice:{key:p.key,option:'cancel'}}).ok);
 assert.equal(draws,0);assert.equal(g.phase,'heat');
 assert.equal(g.resolution[0].shots[0].cancelled,true);
 assert.equal(g.resolution[0].shots[0].roll,null);assert.deepEqual(g.afterRolls,[]);
});
test('AGoAC p.25: fully submerged ordinary attacks use half damage and depth-one exceptions',()=>{
 const {g,u,t}=physicalBlockFixture();
 const normal=g.physicalPreview(u.id,t.id,'punch','RA').damage;
 for(const x of [u,t])Object.assign(g.tile(x.q,x.r),{type:'water',height:-2,surface:0,depth:2});
 assert.equal(g.physicalPreview(u.id,t.id,'punch','RA').damage,normal); // nominal, not prematurely halved
 Object.assign(g.tile(u.q,u.r),{type:'water',height:-1,surface:0,depth:1});t.prone=true;
 assert.equal(g.physicalPreview(u.id,t.id,'punch','RA').legal,false); // target below AND prone
 Object.assign(g.tile(t.q,t.r),{type:'water',height:-1,surface:0,depth:1});
 const kick=g.physicalPreview(u.id,t.id,'kick','RL');
 assert(kick.legal,kick.reason);assert(kick.underwaterPhysical);assert.equal(kick.damage,Math.floor(u.tonnage/5)); // actual underwater leg hit is halved on resolution
 assert(!g.physicalPreview(u.id,t.id,'club','RA').legal);
});


test('AGoAC p.28: independent fists select different legal targets atomically',()=>{
 const g=fresh(),u=g.units[0],a=g.units[2],b=g.units[3];
 for(const tile of g.tiles)Object.assign(tile,{type:'plain',height:0,surface:0,depth:0});
 Object.assign(u,{q:0,r:0,facing:0,prone:false,moveMode:'stand'});
 Object.assign(a,{q:0,r:-1,prone:false,moveMode:'stand'});
 Object.assign(b,{q:-1,r:1,prone:false,moveMode:'stand'});
 g.phase='physical';g.queue=[u.team];g.activeTeam=u.team;g.actingId=u.id;
 const wrong=g.declarePhysical(u.id,b.id,'punch','both',{rightTarget:a.id});
 assert.equal(wrong.ok,false);assert.equal(g.physicalDeclarations.length,0);
 const result=g.declarePhysical(u.id,a.id,'punch','both',{rightTarget:b.id});assert(result.ok,result.reason||result.error);
 assert.deepEqual(g.physicalDeclarations.map(d=>[d.limb,d.target,d.targetNumber]),[['LA',a.id,u.piloting],['RA',b.id,u.piloting]]);
});
test('AGoAC p.28: hatchet side arc and optional hit tables apply four only when not forced',()=>{
 const {g,u,t}=physicalBlockFixture();Object.assign(t,{q:0,r:-1});
 const base=g.physicalPreview(u.id,t.id,'hatchet','LA');assert(base.legal,base.reason);
 for(const table of ['punch','kick']){
  const p=g.physicalPreview(u.id,t.id,'hatchet','LA',{locationTable:table});
  assert(p.legal);assert.equal(p.table,table);assert.equal(p.targetNumber,base.targetNumber+4);assert.equal(p.damage,base.damage);
  g.tile(t.q,t.r).height=1;
  const forced=g.physicalPreview(u.id,t.id,'hatchet','LA',{locationTable:table});
  assert(forced.legal);assert.equal(forced.table,'kick');assert.equal(forced.targetNumber,base.targetNumber);
  g.tile(t.q,t.r).height=0;
 }
 assert(!g.physicalPreview(u.id,t.id,'hatchet','LA',{locationTable:'bad'}).legal);
});
test('AGoAC p.26: tree club is consumed on success while limb club is reusable and collected once',()=>{
 for(const limb of [false,true]){
  const g=fresh(),u=g.units[0],t=g.units[2];
  for(const tile of g.tiles)Object.assign(tile,{type:'plain',height:0,surface:0,depth:0});
  Object.assign(u,{q:0,r:0,facing:0,prone:false,club:false,moveMode:'stand'});
  Object.assign(t,{q:1,r:0,prone:false,moveMode:'stand'});
  const tile=g.tile(u.q,u.r);tile.type=limb?'plain':'woods';tile.club=limb;
  g.phase='physical';g.queue=[u.team];g.activeTeam=u.team;g.actingId=u.id;
  assert(g.takeClub(u.id).ok);assert.equal(u.clubKind,limb?'limb':'tree');assert.equal(tile.club,false);
  const d={type:'club',damage:1,side:'front',table:'normal',targetNumber:2};
  g.resolveRolledPhysical({u,t,d,roll:1,hit:false,cancelled:false,attackRoll:null});assert(u.club);
  g.hit=()=>({location:'CT',damage:1,hits:[]});
  g.resolveRolledPhysical({u,t,d,roll:12,hit:true,cancelled:false,attackRoll:null});assert.equal(u.club,limb);
 }
});
test('AGoAC p.26: blown-off limbs and side torso arm loss supply club stock once',()=>{
 const g=fresh(),u=g.units[0],tile=g.tile(u.q,u.r);tile.club=false;tile.clubCount=0;
 g.rng=()=>.99;g.criticalHit(u,'LL');assert.equal(tile.clubCount,1);
 g.destroyLocation(u,'LT');assert.equal(tile.clubCount,2);
 g.destroyLocation(u,'LT');assert.equal(tile.clubCount,2);assert(tile.club);
});
test('AGoAC p.28: every biped punch and kick location table entry matches printed tables',()=>{
 const punch={front:['LA','LT','CT','RT','RA','HD'],rear:['LA','LT','CT','RT','RA','HD'],left:['LT','LT','CT','LA','LA','HD'],right:['RT','RT','CT','RA','RA','HD']};
 const kick={front:['RL','RL','RL','LL','LL','LL'],rear:['RL','RL','RL','LL','LL','LL'],left:Array(6).fill('LL'),right:Array(6).fill('RL')};
 for(const [type,table] of [['punch',punch],['kick',kick]])for(const [side,locations] of Object.entries(table))for(let i=0;i<6;i++){
  const g=fresh(),t=g.units[2];let rolls=0;g.rng=()=>{rolls++;return (i+.5)/6;};
  g.damage=()=>[];assert.equal(g.hit(t,5,side,type).location,locations[i]);assert.equal(rolls,1);
 }
});

test('AGoAC p.28: both punch arcs include exact sixty and one hundred twenty degree hexes for every facing',()=>{
 const {g,u,t}=physicalBlockFixture();u.slots.LA[7]=null;u.hatchets=[];
 for(let facing=0;facing<6;facing++){
  u.facing=facing;
  for(let offset=0;offset<6;offset++){
   const [dq,dr]=DIRS[(facing+offset)%6];t.q=u.q+dq;t.r=u.r+dr;
   for(const limb of ['LA','RA']){
    const allowed=(limb==='LA'?[0,1,2,5]:[0,1,4,5]).includes(offset);
    const p=g.physicalPreview(u.id,t.id,'punch',limb);
    assert.equal(p.legal,allowed,JSON.stringify({facing,offset,limb,angle:g.relative(u,t),reason:p.reason}));
   }
  }
 }
});


test('AGoAC pp.24–27: comparative physical TN combines target movement and immobility and DFA ignores all terrain',()=>{
 const {g,u,t}=physicalBlockFixture();
 Object.assign(u,{piloting:5,moveMode:'run'});Object.assign(t,{piloting:3,moveMode:'jump',distanceMoved:7,shutdown:true});
 Object.assign(g.tile(t.q,t.r),{type:'heavy'});
 assert.equal(g.specialPhysicalTN(u,t,false),11);
 assert.equal(g.specialPhysicalTN(u,t,true),10);
 t.prone=true;assert.equal(g.specialPhysicalTN(u,t,true),8);
 Object.assign(t,{prone:false,shutdown:false});assert.equal(g.specialPhysicalTN(u,t,false),15);
 Object.assign(g.tile(t.q,t.r),{type:'water',height:-1,depth:1,surface:0});
 assert.equal(g.specialPhysicalTN(u,t,false),14);assert.equal(g.specialPhysicalTN(u,t,true),14);
});
test('AGoAC p.26: missed charge attacker chooses either legal flanking hex with replay preserving attack dice',()=>{
 const {g,u,t}=physicalBlockFixture();g.phase='physical';g.queue=[];g.activeTeam=null;g.initiativeWinner=1;
 Object.assign(u,{moveMode:'run',piloting:5,charge:{type:'charge',target:t.id,dir:0,hexes:2,targetPos:{q:t.q,r:t.r}}});
 t.piloting=5;
 let draws=0;g.rng=()=>{draws++;return 0;};
 assert(g.nextPhaseWithChoices({humanTeams:[0]}).pending);
 const p=structuredClone(g.pendingChoice);assert.equal(p.kind,'charge-miss');assert.equal(p.unitId,u.id);assert.equal(draws,2);
 assert.equal(p.options.length,2);
 assert(!g.nextPhaseWithChoices({choice:{key:p.key,option:'3'}}).ok);assert.equal(draws,2);
 const chosen=p.options.at(-1);assert(g.nextPhaseWithChoices({choice:{key:p.key,option:chosen.id}}).ok);
 assert.equal(draws,2);assert.deepEqual([g.unit(u.id).q,g.unit(u.id).r],[chosen.q,chosen.r]);
 assert.equal(g.resolution[0].shots[0].hit,false);
});
test('AGoAC p.25: fully submerged DFA is illegal before movement and charge requires an adjacent legal ground entry',()=>{
 for(const [originDepth,targetDepth,prone,mode] of [[2,0,false,'dfa'],[0,2,false,'dfa'],[1,1,true,'dfa'],[0,1,false,'charge']]){
  const {g,u,t}=physicalBlockFixture();u.jump=5;t.moved=true;t.prone=prone;
  for(const [v,depth] of [[u,originDepth],[t,targetDepth]])Object.assign(g.tile(v.q,v.r),{type:depth?'water':'plain',depth,height:-depth,surface:0});
  g.phase='move';g.queue=[0];g.activeTeam=0;g.actingId=u.id;
  const before=[u.q,u.r,u.spent];const result=g.declareCharge(u.id,t.id,mode);
  assert.equal(result.ok,false);assert.deepEqual([u.q,u.r,u.spent],before);assert(!u.charge);
 }
});
test('AGoAC p.26: underwater charge halves both rounded damage amounts and cancelled or fallen charge cannot advance',()=>{
 for(const variant of ['underwater','fallen','cancel']){
  const {g,u,t}=physicalBlockFixture();Object.assign(u,{moveMode:'walk',tonnage:65,piloting:5,charge:{type:'charge',dir:0,target:t.id,hexes:5,targetPos:{q:t.q,r:t.r}}});t.tonnage=45;t.piloting=5;
  if(variant==='underwater')for(const v of [u,t])Object.assign(g.tile(v.q,v.r),{type:'water',height:-2,depth:2,surface:0});
  else if(variant==='fallen')u.prone=true;
  else{u.piloting=12;g._resolutionChooser=p=>{assert.equal(p.kind,'physical-impossible');return 'cancel';};}
  const packets=[];g.packets=(v,amount)=>packets.push([v.id,amount]);
  g.rng=()=>{assert.equal(variant,'underwater');return .99;};
  g.resolveSpecial(u);assert(u.charge.resolved);
  assert.deepEqual(packets,variant==='underwater'?[[t.id,33],[u.id,5]]:[]); // full packets; hit locations halve individually
  if(variant!=='underwater'){assert.deepEqual([u.q,u.r],[0,0]);assert.equal(g.resolution[0].shots[0].roll,null);}
 }
});


test('AGoAC p.27 errata: airborne DFA LOS is height five above the level-one target and excludes approach terrain',()=>{
 const {g,u,t}=physicalBlockFixture(),observer=g.units[3];
 Object.assign(u,{q:0,r:0,airborne:true,charge:{type:'dfa',target:t.id,targetPos:{q:1,r:0}}});
 Object.assign(t,{q:1,r:0});Object.assign(g.tile(1,0),{height:1,surface:1});
 assert.equal(g.losLevel(u),5);
 Object.assign(g.tile(0,0),{type:'water',height:-2,depth:2,surface:0});
 Object.assign(observer,{q:-2,r:0,facing:0});
 assert.equal(g.losLevel(u),5);assert.equal(g.los(observer,u).blocked,false);assert.equal(g.los(observer,u).cover,false);
 Object.assign(g.tile(0,0),{type:'heavy',height:3,depth:0,surface:3});
 assert.equal(g.losLevel(u),7);assert.equal(g.los(observer,u).woods,0);
});
test('AGoAC pp.26–27: DFA approach allows an occupied hex and defers landing while counting only traveled hexes',()=>{
 const g=fresh(),[u,ally,t,other]=g.units;
 for(const x of g.tiles)Object.assign(x,{type:'plain',height:0,depth:0,surface:0});
 Object.assign(u,{q:-2,r:0,facing:0,jump:5,jumpLost:0,prone:false,moveStart:{q:-2,r:0},pendingHeat:0,spent:0,moveMode:'stand',distanceMoved:0});
 Object.assign(t,{q:1,r:0,moved:true,prone:false});
 Object.assign(ally,{q:0,r:0});other.dead=true;
 g.phase='move';g.activeTeam=u.team;g.queue=[u.team];g.actingId=null;
 let draws=0;g.rng=()=>{draws++;return .5;};
 const r=g.declareCharge(u.id,t.id,'dfa');assert(r.ok,r.error||r.reason);
 assert.deepEqual([u.q,u.r,u.facing],[0,0,0]);
 assert(u.airborne);assert.equal(u.distanceMoved,2);assert.equal(u.spent,3);assert.equal(u.pendingHeat,3);
 assert.equal(g.tmm(u),1);assert.equal(draws,0);assert(!g.occupied(0,0,ally.id));
});
test('AGoAC p.27 errata: destroyed DFA attacker cannot displace its target',()=>{
 const {g,u,t}=physicalBlockFixture();u.dead=true;u.airborne=false;
 const before=[t.q,t.r];g.resolveDFALanding(u,t,0,true,{q:t.q,r:t.r});
 assert.deepEqual([t.q,t.r],before);assert.deepEqual(t.psrs,[]);
});


test('AGoAC pp.20,28: hatchet actuator hits add modifiers without reducing damage and destroyed hand forbids attack',()=>{
 const {g,u,t}=physicalBlockFixture();
 const base=g.physicalPreview(u.id,t.id,'hatchet','LA');assert(base.legal,base.reason);
 for(let mask=0;mask<4;mask++){
  u.actuators.LA.upper=!!(mask&1);u.actuators.LA.lower=!!(mask&2);
  const p=g.physicalPreview(u.id,t.id,'hatchet','LA');assert(p.legal,p.reason);
  assert.equal(p.targetNumber,base.targetNumber+2*(Number(!!(mask&1))+Number(!!(mask&2))));
  assert.equal(p.damage,base.damage);
 }
 u.actuators.LA.hand=true;assert(!g.physicalPreview(u.id,t.id,'hatchet','LA').legal);
 u.actuators.LA.hand=false;u.actuators.LA.shoulder=true;assert(!g.physicalPreview(u.id,t.id,'hatchet','LA').legal);
});
test('AGoAC p.26 errata: destroyed charge target allows standing attacker to enter without attack or PSR',()=>{
 for(const prone of [false,true]){
  const {g,u,t}=physicalBlockFixture();Object.assign(u,{prone,moveMode:'run',charge:{type:'charge',target:t.id,dir:0,hexes:2,targetPos:{q:1,r:0}}});
  g.destroyMech(t);assert(g.onMap(t),'wreck remains pending removal throughout Physical Phase');
  g.rng=()=>{throw Error('Destroyed target must not need dice');};
  g.resolveSpecial(u);assert(u.charge.resolved);assert.equal(u.q,prone?0:1);assert.deepEqual(u.psrs,[]);assert.equal(g.resolution.length,0);
  assert(g.onMap(t),'pending wreck still present until phase cleanup');
  g.removeDestroyedMechs();assert(!g.onMap(t));
 }
});
test('AGoAC p.27 errata: destroyed DFA target becomes a normal landing in the target hex without DFA damage',()=>{
 const {g,u,t}=physicalBlockFixture();Object.assign(u,{airborne:true,moveMode:'jump',spent:3,pendingHeat:3,distanceMoved:2,charge:{type:'dfa',target:t.id,dir:0,targetPos:{q:1,r:0},startPos:{q:-2,r:0}}});
 g.phase='fire';g.destroyMech(t);assert(g.onMap(t),'wreck pending during endPSR');
 g.rng=()=>{throw Error('Plain landing needs no dice');};
 g.endPSR();
 assert(!u.airborne);assert(u.charge.resolved);assert.equal(u.q,1);assert.equal(u.distanceMoved,3);assert.equal(u.pendingHeat,3);
 assert.deepEqual(u.psrs,[]);assert.equal(g.resolution.length,0);
 assert(g.onMap(t));g.removeDestroyedMechs();assert(!g.onMap(t));
});
test('AGoAC p.27 errata: unconscious airborne pilot automatically misses even without a queued PSR',()=>{
 for(const [queued,damage] of [[0,0],[2,0],[2,20]]){
 const {g,u,t}=physicalBlockFixture();Object.assign(u,{airborne:true,unconscious:true,moveMode:'jump',charge:{type:'dfa',target:t.id,dir:0,targetPos:{q:1,r:0},startPos:{q:-2,r:0}}});g.phase='fire';
 assert.deepEqual(u.psrs,[]);if(queued)u.psrs.push({modifier:queued,reason:'test queued PSR'});u.phaseDamage=damage;
 const expectedTN=u.piloting+g.psrMod(u,true)+queued+(damage>=20?1:0);const falls=[];g.fall=(v,levels,tn,side)=>{falls.push([v.id,levels,tn,side]);v.prone=true;};
 g.packets=()=>{throw Error('Automatic miss must not deal DFA damage');};g.rng=()=>{throw Error('Automatic miss needs no attack dice');};
 g.endPSR();assert(u.charge.resolved);assert(!u.airborne);assert(u.prone);assert.deepEqual(falls,[[u.id,2,expectedTN,'rear']]);assert.equal(u.q,1);
 assert.notDeepEqual([t.q,t.r],[1,0]);
 g.phase='physical';g.resolveSpecial(u);assert.equal(falls.length,1);
 }
});

 
test('CAT3500D p.25 + errata v8.01 p.3: depth-one water cover uses hit table and equal LOS level',()=>{
 const {g,u,t}=physicalBlockFixture(),from=g.tile(u.q,u.r),to=g.tile(t.q,t.r);
 Object.assign(from,{type:'water',depth:1,height:-1,surface:0});
 Object.assign(to,{type:'plain',depth:0,height:-1,surface:-1});
 const dryClub=g.physicalPreview(u.id,t.id,'club','RA');
 const dryPunch=g.physicalPreview(u.id,t.id,'punch','RA');
 Object.assign(to,{type:'water',depth:1,height:-1,surface:0});
 const wetClub=g.physicalPreview(u.id,t.id,'club','RA');
 const wetPunch=g.physicalPreview(u.id,t.id,'punch','RA');
 const wetKick=g.physicalPreview(u.id,t.id,'kick','RL');
 assert(wetClub.legal&&wetPunch.legal&&wetKick.legal);
 assert.equal(wetClub.table,'normal');assert.equal(wetClub.physicalCover,true);
 assert.equal(wetClub.targetNumber,dryClub.targetNumber+1);
 assert.equal(wetPunch.table,'punch');assert.equal(wetPunch.physicalCover,false);
 assert.equal(wetPunch.targetNumber,dryPunch.targetNumber);
 assert.equal(wetKick.table,'kick');assert.equal(wetKick.physicalCover,false);
 Object.assign(from,{type:'plain',depth:0,height:0,surface:0});
 const downClub=g.physicalPreview(u.id,t.id,'club','RA');
 const downKick=g.physicalPreview(u.id,t.id,'kick','RL');
 assert.equal(downClub.table,'punch');assert(!downClub.physicalCover);
 assert.equal(downKick.table,'punch');assert(!downKick.physicalCover);
});

test('CAT3500D p.25 + errata v8.01 p.3: physical damage is halved per submerged location',()=>{
 const {g,t}=physicalBlockFixture(),tile=g.tile(t.q,t.r);
 const applied=[];
 g.damage=(v,location,amount)=>{applied.push([location,amount]);return [];};
 const strike=(roll,n=9)=>{
  const dice=diceFor(roll);g.rng=()=>{assert(dice.length);return dice.shift();};
  return g.hit(t,n,'front','normal',null,false,false,true);
 };
 Object.assign(tile,{type:'water',depth:1,height:-1,surface:0});
 assert.equal(strike(5).damage,4); // standing: right leg under water
 assert.equal(strike(7).damage,9); // torso above water
 Object.assign(tile,{type:'water',depth:2,height:-2,surface:0});
 assert.equal(strike(7).damage,4); // torso now under water
 Object.assign(tile,{type:'water',depth:1,height:-1,surface:0});t.prone=true;
 assert.equal(strike(7).damage,4); // prone: torso also under water
 assert.deepEqual(applied,[['RL',4],['CT',9],['CT',4],['CT',4]]);
});

test('CAT3500D p.26 + errata v8.01 p.3: charge packets halve independently by struck water location',()=>{
 const {g,t}=physicalBlockFixture(),tile=g.tile(t.q,t.r);
 Object.assign(tile,{type:'water',depth:1,height:-1,surface:0});
 const applied=[];g.damage=(v,location,n)=>{applied.push([location,n]);return [];};
 const dice=[...diceFor(5),...diceFor(7)];
 g.rng=()=>{assert(dice.length);return dice.shift();};
 const total=g.packets(t,6,'front','normal',true);
 assert.equal(total,3);
 assert.deepEqual(applied,[['RL',2],['CT',1]]);
 assert.equal(dice.length,0);
});

test('CAT3500D p.25 + errata v8.01 p.3: charging receives depth-one cover modifier even from depth-two water',()=>{
 const {g,u,t}=physicalBlockFixture(),from=g.tile(u.q,u.r),to=g.tile(t.q,t.r);
 Object.assign(from,{type:'water',height:-2,depth:2,surface:0});
 Object.assign(to,{type:'plain',height:-1,depth:0,surface:-1});
 const normal=g.specialPhysicalTN(u,t,false);
 Object.assign(to,{type:'water',height:-1,depth:1,surface:0});
 assert.equal(g.specialPhysicalTN(u,t,false),normal+1);
});

 
test('CAT3500D p.15 and errata v8.01 p.2: flipped arms cannot punch or attack with an arm-mounted hatchet',()=>{
 const {g,u,t}=physicalBlockFixture();
 const punch=g.physicalPreview(u.id,t.id,'punch','RA');
 const axe=g.physicalPreview(u.id,t.id,'hatchet','LA');
 const kick=g.physicalPreview(u.id,t.id,'kick','RL');
 assert(punch.legal,punch.reason);assert(axe.legal,axe.reason);assert(kick.legal,kick.reason);
 u.flip=true;
 assert(!g.physicalPreview(u.id,t.id,'punch','RA').legal);
 assert(!g.physicalPreview(u.id,t.id,'hatchet','LA').legal);
 assert(!g.physicalPreview(u.id,t.id,'punch','both').legal);
 assert(g.physicalPreview(u.id,t.id,'kick','RL').legal);
 g.phase='physical';g.queue=[u.team];g.activeTeam=u.team;g.actingId=u.id;
 assert.equal(g.declarePhysical(u.id,t.id,'punch','RA').ok,false);
 assert.equal(g.declarePhysical(u.id,t.id,'hatchet','LA').ok,false);
 assert.equal(g.physicalDeclarations.length,0);
});

test('CAT3500D p.25 and errata v8.01 p.3: legal charge turns to face the target and spends its MP',()=>{
 for(const facing of [0,1,2,3,4,5]){
  const g=fresh(),[u,a,t,b]=g.units;
  for(const tile of g.tiles)Object.assign(tile,{type:'plain',height:0,depth:0,surface:0});
  Object.assign(u,{q:0,r:0,facing,prone:false,spent:0,moveMode:'stand',moveStart:{q:0,r:0}});
  Object.assign(t,{q:1,r:0,prone:false,moved:true});a.dead=b.dead=true;
  g.phase='move';g.queue=[u.team];g.activeTeam=u.team;g.actingId=u.id;
  const turnCost=Math.min(facing,6-facing);
  const r=g.declareCharge(u.id,t.id,'charge','walk');
  assert(r.ok,r.error||r.reason||JSON.stringify({facing}));
  assert.equal(u.facing,0);assert.equal(r.turnMp,turnCost);
  assert.equal(u.spent,turnCost);assert.equal(u.charge.dir,0);
 }
});

test('CAT3500D p.25 and errata v8.01 p.3: charge rejects an approach without MP for final facing',()=>{
 const g=fresh(),[u,a,t,b]=g.units;
 for(const tile of g.tiles)Object.assign(tile,{type:'plain',height:0,depth:0,surface:0});
 Object.assign(u,{q:0,r:0,facing:3,prone:false,spent:0,moveMode:'stand'});
 Object.assign(t,{q:1,r:0,prone:false,moved:true});a.dead=b.dead=true;
 g.phase='move';g.queue=[u.team];g.activeTeam=u.team;g.actingId=u.id;
 const mp=g.mp.bind(g);g.mp=(unit,mode)=>mode==='walk'?3:mp(unit,mode);
 const before=[u.q,u.r,u.spent,u.facing];
 const r=g.declareCharge(u.id,t.id,'charge','walk');
 assert(!r.ok);assert.deepEqual([u.q,u.r,u.spent,u.facing],before);assert(!u.charge);
});

 
test('CAT3500D p.29: push and opposed pushes queue all PSRs until phase-end',()=>{
 for(const opposed of [false,true]){
  const g=fresh(),u=g.units[0],t=g.units[2];g.phase='physical';
  for(const tile of g.tiles)Object.assign(tile,{type:'plain',depth:0,height:0,surface:0});
  Object.assign(u,{q:0,r:0,facing:0});Object.assign(t,{q:1,r:0,facing:3});
  const first={id:u.id,target:t.id,type:'push',targetNumber:2};
  const counter={id:t.id,target:u.id,type:'push',targetNumber:2};
  g.rng=()=>.99;
  g.resolvePush(first,opposed?counter:null);
  assert.equal(g.phaseRolls.length,opposed?2:1,'only attack rolls during push resolution');
  assert.deepEqual(t.psrs.map(p=>p.reason),[opposed?'Встречный толчок':'Толчок']);
  assert.deepEqual(u.psrs.map(p=>p.reason),opposed?['Встречный толчок']:[]);
  const before=g.phaseRolls.length;g.endPSR();
  assert.equal(g.phaseRolls.length,before+(opposed?2:1),'PSR dice are rolled at end of phase');
  assert.deepEqual(t.psrs,[]);assert.deepEqual(u.psrs,[]);
 }
});

test('CAT3500D p.29: pushed target uses preceding ordinary physical damage for its phase-end PSR',()=>{
 const {g,puncher,pusher,t}=sameSidePriorityGame();
 g._resolutionChooser=(request,fallback)=>
  request.kind==='physical-order'&&request.options.some(o=>o.attackerId===puncher.id)?
   String(puncher.id):fallback;
 const events=[],actualRoll=g.roll.bind(g);
 g.roll=(name,tn)=>{events.push({kind:'roll',name,tn,damage:t.phaseDamage});return actualRoll(name,tn);};
 g.hit=(victim,n)=>{if(victim===t){victim.phaseDamage+=20;events.push({kind:'damage',damage:victim.phaseDamage});}return {damage:n,hits:[]};};
 g.rng=()=>.99;
 const result=g.resolvePhysical();
 assert(result.some(r=>r.id===pusher.id&&r.shots[0].hit));
 assert(result.some(r=>r.id===puncher.id&&r.shots[0].hit));
 const check=events.find(e=>e.kind==='roll'&&e.name===t.name+' · Толчок');
 assert(check,'push PSR must occur at phase-end');
 assert.equal(check.damage,20,'ordinary damage precedes the push PSR');
 assert.equal(check.tn,t.piloting+1,'20-point damage contributes to the push PSR target number');
 assert(events.findIndex(e=>e.kind==='damage')<events.indexOf(check));
});

test('CAT3500D pp.24,29: mixed pushes preserve independent two-punch roll and damage choices',()=>{
 const {g,puncher,pusher,t}=sameSidePriorityGame();
 const first=g.physicalDeclarations[1];
 g.physicalDeclarations.push({...first,limb:'RA'});
 const rolls=[],damage=[],choices=[];
 const oldRoll=g.rollPhysical.bind(g),oldResolve=g.resolveRolledPhysical.bind(g);
 g.rollPhysical=(d,snap)=>{rolls.push(d.limb);return oldRoll(d,snap);};
 g.resolveRolledPhysical=attack=>{damage.push(attack.d.limb);return oldResolve(attack);};
 g._resolutionChooser=(request,fallback)=>{
  if(request.kind!=='physical-order')return fallback;
  if(request.context?.scope==='attack'){
   choices.push(request.context.stage);
   return '1'; // after RA,LA roll staging, damage entry 1 is LA
  }
  if(request.options.some(o=>o.attackerId===puncher.id))return String(puncher.id);
  return fallback;
 };
 g.rng=()=>.99;g.hit=(v,n)=>({damage:n,hits:[]});
 const result=g.resolvePhysical();
 assert.deepEqual(choices,['roll','damage']);
 assert.deepEqual(rolls,['RA','LA']);
 assert.deepEqual(damage,['LA','RA']);
 assert.equal(result.filter(r=>r.id===puncher.id).length,2);
 assert(result.some(r=>r.id===pusher.id&&r.shots[0].hit));
});

 
test('CAT3500D p.26 and errata v8.01 p.3: destroyed charge target is no longer a collision blocker before cleanup',()=>{
 for(const blocked of [false,true]){
  const {g,u,t}=physicalBlockFixture(),occupant=g.units[3];
  Object.assign(u,{moveMode:'run',charge:{type:'charge',target:t.id,dir:0,hexes:2,targetPos:{q:t.q,r:t.r}}});
  if(blocked)Object.assign(occupant,{q:t.q,r:t.r,dead:false,deployed:true,airborne:false});
  g.destroyMech(t);
  assert(g.onMap(t));
  assert.equal(g.occupied(t.q,t.r,u.id),true,'temporary wreck still occupies for ordinary attacks');
  g.rng=()=>{throw Error('no charge hit dice after target destruction');};
  g.resolveSpecial(u);
  assert(u.charge.resolved);
  assert.deepEqual([u.q,u.r],blocked?[0,0]:[1,0],
   'destroyed target alone must never prevent the declared advance');
  assert.deepEqual(u.psrs,[]);assert.deepEqual(g.resolution,[]);
  assert(g.onMap(t),'wreck cleanup must stay deferred');
 }
});

test('CAT3500D p.27 and errata v8.01 p.4: DFA converts to a normal water landing with a pending destroyed target',()=>{
 const {g,u,t}=physicalBlockFixture(),tile=g.tile(t.q,t.r);
 Object.assign(tile,{type:'water',height:-1,depth:1,surface:0});
 Object.assign(u,{airborne:true,moveMode:'jump',spent:4,pendingHeat:4,distanceMoved:2,
  charge:{type:'dfa',target:t.id,dir:0,targetPos:{q:t.q,r:t.r},startPos:{q:-2,r:0}}});
 g.phase='fire';g.destroyMech(t);assert(g.onMap(t));
 const checks=[];g.psr=(v,mod,reason,immediate,fallLevels)=>{
  checks.push([v.id,mod,reason,immediate,fallLevels]);return true;
 };
 g.rng=()=>{throw Error('destroyed target has no DFA hit/location rolls');};
 g.endPSR();
 assert.deepEqual([u.q,u.r],[1,0]);assert.equal(u.airborne,false);
 assert.equal(u.charge.resolved,true);assert.equal(u.distanceMoved,3);
 assert.deepEqual(checks,[[u.id,0,'Посадка в воду',true,1]],
  'only the normal water-jump landing check may happen');
 assert.equal(u.pendingHeat,4);assert.deepEqual(g.resolution,[]);
 assert(g.onMap(t));
});

test('CAT3500D p.27 and errata v8.01 p.4: converted DFA cannot land in a second live occupied hex',()=>{
 const {g,u,t}=physicalBlockFixture(),other=g.units[3];
 Object.assign(other,{q:t.q,r:t.r,dead:false,deployed:true,airborne:false});
 Object.assign(u,{airborne:true,moveMode:'jump',charge:{type:'dfa',target:t.id,dir:0,targetPos:{q:t.q,r:t.r},startPos:{q:-2,r:0}}});
 g.phase='fire';g.destroyMech(t);
 const psrs=[];g.psr=(...args)=>{psrs.push(args);return true;};
 g.rng=()=>{throw Error('no attack rolls');};
 g.endPSR();
 assert.deepEqual([u.q,u.r],[0,0]);
 assert.equal(u.airborne,false);assert(u.charge.resolved);
 assert.deepEqual(psrs,[]);assert(g.onMap(t));
});

 
test('CAT3500D pp.24–25: physical TN matrix includes type modifiers and excludes weapon-only penalties',()=>{
 const {g,u,t}=physicalBlockFixture();
 u.piloting=5;u.heat=30;u.sensorHits=2;u.gyroHits=1;
 for(const [type,limb,modifier] of [
  ['punch','RA',0],['kick','RL',-2],['club','RA',-1],
  ['hatchet','LA',-1],['push','RA',-1]
 ]){
  const p=g.physicalPreview(u.id,t.id,type,limb);
  assert(p.legal,type+': '+p.reason);
  assert.equal(p.targetNumber,5+modifier,type+' Piloting-based TN');
 }
});

test('CAT3500D p.25 / errata v8.01 p.3: Depth-1 Punch table has no cover, Kick table has +1 but never masks leg damage',()=>{
 const {g,u,t}=physicalBlockFixture(),from=g.tile(u.q,u.r),to=g.tile(t.q,t.r);
 Object.assign(from,{type:'water',depth:1,height:-1,surface:0});
 Object.assign(to,{type:'water',depth:1,height:-1,surface:0});
 const fist=g.physicalPreview(u.id,t.id,'punch','RA');
 const kick=g.physicalPreview(u.id,t.id,'kick','RL');
 const club=g.physicalPreview(u.id,t.id,'club','RA');
 assert(fist.legal&&kick.legal&&club.legal);
 assert.equal(fist.table,'punch');assert.equal(fist.physicalCover,false);
 assert.equal(kick.table,'kick');assert.equal(kick.physicalCover,false);
 assert.equal(club.table,'normal');assert.equal(club.physicalCover,true);
 assert.equal(kick.targetNumber,u.piloting-2+1);
 assert.equal(club.targetNumber,u.piloting-1+1);
 assert.equal(fist.targetNumber,u.piloting);
 g.rng=()=>.99;g.damage=()=>[];
 const n=9;
 const hit=g.hit(t,n,'front','kick',null,false,false,true);
 assert.equal(hit.damage,Math.floor(n/2));
 assert(['RL','LL'].includes(hit.location));
});

 
// Source-to-engine certification block: CAT3500D pp.26,28 (club, physical
// weapon and punch attacks). These cross-check edge cases not covered by
// individual implementation patches; verification is committed separately.
test('CAT3500D p.26: club arm penalties are additive and never halve 1-per-5-ton damage',()=>{
 const {g,u,t}=physicalBlockFixture();
 const base=g.physicalPreview(u.id,t.id,'club','RA');
 assert(base.legal,base.reason);
 assert.equal(base.targetNumber,u.piloting-1);
 assert.equal(base.damage,Math.ceil(u.tonnage/5));
 u.actuators.LA.upper=true;
 u.actuators.RA.lower=true;
 const damaged=g.physicalPreview(u.id,t.id,'club','RA');
 assert(damaged.legal,damaged.reason);
 assert.equal(damaged.targetNumber,base.targetNumber+4);
 assert.equal(damaged.damage,base.damage);
 u.firedLocations=['CT'];
 assert(g.physicalPreview(u.id,t.id,'club','RA').legal,
  'torso-mounted fire does not disqualify a club attack');
 u.firedLocations=['LA'];
 assert.equal(g.physicalPreview(u.id,t.id,'club','RA').legal,false);
 u.firedLocations=[];u.actuators.LA.shoulder=true;
 assert.equal(g.physicalPreview(u.id,t.id,'club','RA').legal,false);
 u.actuators.LA.shoulder=false;u.actuators.RA.hand=true;
 assert.equal(g.physicalPreview(u.id,t.id,'club','RA').legal,false);
 u.actuators.RA.hand=false;
 t.q=-1;t.r=0;
 assert.equal(g.physicalPreview(u.id,t.id,'club','RA').legal,false,
  'club attacks are limited to the forward firing arc');
});

test('CAT3500D p.26: finding a club consumes physical action and disallows prior fire',()=>{
 const {g,u,t}=physicalBlockFixture();
 const tile=g.tile(u.q,u.r);
 Object.assign(tile,{type:'woods',depth:0,height:0,surface:0});
 u.club=false;u.clubKind=null;u.firedLocations=['CT'];
 g.phase='physical';g.queue=[u.team];g.activeTeam=u.team;g.actingId=u.id;
 assert.equal(g.takeClub(u.id).ok,false);
 assert.equal(u.club,false);
 assert.equal(u.physicalDone,false);
 u.firedLocations=[];
 assert(g.takeClub(u.id).ok);
 assert.equal(u.club,true);assert.equal(u.clubKind,'tree');
 assert.equal(u.physicalDone,true);
 assert(!g.canAct(u));
 assert.equal(g.declarePhysical(u.id,t.id,'club','RA').ok,false,
  'pickup cannot be combined with a club strike in the same phase');
});

test('CAT3500D p.28: physical weapon damage, actuator TN and forced hit table matrix',()=>{
 const {g,u,t}=physicalBlockFixture();
 const base=g.physicalPreview(u.id,t.id,'hatchet','LA');
 assert(base.legal,base.reason);
 assert.equal(base.damage,Math.ceil(u.tonnage/5));
 assert.equal(base.targetNumber,u.piloting-1);
 for(const part of ['upper','lower']){
  u.actuators.LA[part]=true;
  const damaged=g.physicalPreview(u.id,t.id,'hatchet','LA');
  assert(damaged.legal,part+': '+damaged.reason);
  assert.equal(damaged.targetNumber,base.targetNumber+2);
  assert.equal(damaged.damage,base.damage);
  u.actuators.LA[part]=false;
 }
 const called=g.physicalPreview(u.id,t.id,'hatchet','LA',{locationTable:'punch'});
 assert(called.legal);
 assert.equal(called.table,'punch');assert.equal(called.targetNumber,base.targetNumber+4);
 g.tile(t.q,t.r).height=1;
 const forced=g.physicalPreview(u.id,t.id,'hatchet','LA',{locationTable:'punch'});
 assert(forced.legal,forced.reason);assert.equal(forced.table,'kick');
 assert.equal(forced.targetNumber,base.targetNumber);
 g.tile(t.q,t.r).height=0;
 u.firedLocations=['RA'];
 assert(g.physicalPreview(u.id,t.id,'hatchet','LA').legal,
  'firing the opposite arm cannot forbid this hatchet');
 u.firedLocations=['LA'];
 assert.equal(g.physicalPreview(u.id,t.id,'hatchet','LA').legal,false);
 u.firedLocations=[];u.actuators.LA.hand=true;
 assert.equal(g.physicalPreview(u.id,t.id,'hatchet','LA').legal,false);
 u.actuators.LA.hand=false;u.actuators.LA.shoulder=true;
 assert.equal(g.physicalPreview(u.id,t.id,'hatchet','LA').legal,false);
});

test('CAT3500D p.28: missing-by-design punch actuators stack TN and quarter damage at minimum one',()=>{
 const {g,u,t}=physicalBlockFixture();
 const base=g.physicalPreview(u.id,t.id,'punch','RA');
 assert(base.legal,base.reason);
 assert.equal(base.targetNumber,u.piloting);
 assert.equal(base.damage,Math.max(1,Math.ceil(u.tonnage/10)));
 u.slots.RA[1]=null;u.slots.RA[2]=null;
 const reduced=g.physicalPreview(u.id,t.id,'punch','RA');
 assert(reduced.legal,reduced.reason);
 assert.equal(reduced.targetNumber,base.targetNumber+4);
 assert.equal(reduced.damage,Math.max(1,Math.floor(base.damage/4)));
 u.slots.RA[3]=null;
 assert.equal(g.physicalPreview(u.id,t.id,'punch','RA').targetNumber,base.targetNumber+5);
 u.slots.RA[1]='upper';u.slots.RA[2]='lower';u.slots.RA[3]='hand';
 u.firedLocations=['RA'];
 assert.equal(g.physicalPreview(u.id,t.id,'punch','RA').legal,false);
 u.firedLocations=[];
 u.hatchets.push({location:'RA',slots:1});u.slots.RA[7]='hatchet';
 assert.equal(g.physicalPreview(u.id,t.id,'punch','RA').legal,false);
 u.slots.RA[7]=null;u.hatchets=u.hatchets.filter(h=>h.location!=='RA');
 u.actuators.RA.shoulder=true;
 assert.equal(g.physicalPreview(u.id,t.id,'punch','RA').legal,false);
});


test('CAT3500D pp.7,24: mixed push, kick and punches alternate initiative team slots',()=>{
 for(const winner of [0,1]){
  const g=fresh(),losers=g.units.filter(u=>u.team!==winner),winners=g.units.filter(u=>u.team===winner);
  g.phase='physical';g.initiativeWinner=winner;
  const [lo0,lo1]=losers,[hi0,hi1]=winners;
  const attack=(u,target,type='punch',limb='LA')=>({id:u.id,target:target.id,type,limb,targetNumber:2,damage:1,side:'front',table:'normal'});
  const push=attack(lo0,hi0,'push'),punch=attack(lo1,hi1),
   kick=attack(hi0,lo0,'kick','RL'),counter=attack(hi1,lo1);
  // Deliberately shuffled declarations. Every slot is a whole Mech;
  // the mere presence of a push must not reorder the whole team.
  g.physicalDeclarations=[kick,counter,punch,push];
  assert.deepEqual(g.physicalOrder(),[punch,kick,push,counter]);
  const events=[];
  g.resolvePush=(d)=>{events.push([d.id,'push']);};
  g.rollPhysical=(d)=>{events.push([d.id,d.type]);return {u:g.unit(d.id),t:g.unit(d.target),d,roll:2,hit:false,cancelled:false,attackRoll:null};};
  g.resolveRolledPhysical=()=>{};
  g.endPSR=()=>{};
  g.resolvePhysical();
  assert.deepEqual(events,[[lo1.id,'punch'],[hi0.id,'kick'],[lo0.id,'push'],[hi1.id,'punch']]);
 }
});

test('CAT3500D p.7: unequal mixed physical declarations preserve the 2-to-1 initiative batches',()=>{
 for(const winner of [0,1]){
  const g=fresh();g.phase='physical';g.initiativeWinner=winner;
  const losing=g.units.filter(u=>u.team!==winner),winning=g.units.filter(u=>u.team===winner);
  winning[1].dead=true;
  const [a,b]=losing,[c]=winning;
  const mk=(u,target,type,limb='LA')=>({id:u.id,target:target.id,type,limb,damage:1,targetNumber:2,side:'front',table:'normal'});
  const p=mk(a,c,'push'),p2=mk(b,c,'punch'),p3=mk(c,a,'punch');
  g.physicalDeclarations=[p3,p2,p];
  // The larger side gets two declarations in the first pair, following
  // the same 2:1 rule as movement and weapon declarations. The default
  // order inside one side remains the recorded declaration order; its
  // controller can separately choose a different order when applicable.
  assert.deepEqual(g.physicalOrder(),[p2,p,p3]);
  g.physicalDeclarations=[p3,p2,{...p,type:'kick',limb:'RL'}];
  assert.deepEqual(g.physicalOrder().map(x=>x.id),[b.id,a.id,c.id]);
 }
});

test('CAT3500D pp.24,29: a mixed phase still offers a same-side choice before a push interrupts punches',()=>{
 const {g,puncher,pusher,t}=sameSidePriorityGame();
 const first=g.physicalDeclarations.find(d=>d.type==='punch');
 const second={...first,limb:'RA'};
 g.physicalDeclarations.push(second);
 // No opponents remain to act, so the owner may choose the order of
 // its two fists versus the push, with both fists kept in one slot.
 const events=[];
 g._resolutionChooser=(request,fallback)=>{
  if(request.kind==='physical-order'&&request.context?.scope!=='attack'&&request.options?.some(o=>o.attackerId===puncher.id)){
   assert.equal(request.options.find(o=>o.attackerId===puncher.id).attacks.length,2);
   return String(puncher.id);
  }
  return fallback;
 };
 g.rollPhysical=(d)=>{events.push(d.limb);return {u:g.unit(d.id),t:g.unit(d.target),d,roll:2,hit:false,cancelled:false,attackRoll:null};};
 g.resolveRolledPhysical=()=>{};
 g.resolvePush=(d)=>{events.push('push');};
 g.endPSR=()=>{};
 g.resolvePhysical();
 assert.deepEqual(events,['LA','RA','push']);
});


test('CAT3500D p.24: one physical type per turn, with two separate punches as the sole exception',()=>{
 for(const type of ['punch','kick','club','hatchet','push']){
  const {g,u,t}=physicalBlockFixture();
  g.phase='physical';g.queue=[u.team];g.activeTeam=u.team;g.actingId=u.id;
  const limb=type==='punch'?'RA':type==='kick'?'RL':type==='hatchet'?'LA':'RA';
  const result=g.declarePhysical(u.id,t.id,type,limb);
  assert(result.ok,type+': '+(result.error||''));
  assert.equal(g.physicalDeclarations.length,1);
  assert.equal(g.declarePhysical(u.id,t.id,'kick','RL').ok,false,
   'one declared physical type ends this Mech selection');
 }
 const {g,u,t}=physicalBlockFixture();
 u.slots.LA[7]=null;u.hatchets=[];
 g.phase='physical';g.queue=[u.team];g.activeTeam=u.team;g.actingId=u.id;
 const both=g.declarePhysical(u.id,t.id,'punch','both');
 assert(both.ok,both.error);
 assert.deepEqual(g.physicalDeclarations.map(d=>d.limb),['LA','RA']);
 assert(g.physicalDeclarations.every(d=>d.type==='punch'));
 assert.equal(g.declarePhysical(u.id,t.id,'club','RA').ok,false);
});

test('CAT3500D p.29: push uses feet-facing, both shoulders, same level and no arm weapon fire',()=>{
 const {g,u,t}=physicalBlockFixture();
 const base=g.physicalPreview(u.id,t.id,'push','LA');
 assert(base.legal,base.reason);
 assert.equal(base.targetNumber,u.piloting-1);
 u.twist=1;
 assert(g.physicalPreview(u.id,t.id,'push','LA').legal,'torso twist does not change a push arc');
 u.actuators.LA.shoulder=true;
 assert.equal(g.physicalPreview(u.id,t.id,'push','LA').targetNumber,base.targetNumber+2);
 u.actuators.RA.shoulder=true;
 assert.equal(g.physicalPreview(u.id,t.id,'push','LA').targetNumber,base.targetNumber+4);
 u.actuators.LA.shoulder=false;u.actuators.RA.shoulder=false;
 u.firedLocations=['CT'];
 assert(g.physicalPreview(u.id,t.id,'push','LA').legal);
 u.firedLocations=['RA'];
 assert(!g.physicalPreview(u.id,t.id,'push','LA').legal);
 u.firedLocations=[];
 t.prone=true;
 assert(!g.physicalPreview(u.id,t.id,'push','LA').legal);
 t.prone=false;g.tile(t.q,t.r).height=1;
 assert(!g.physicalPreview(u.id,t.id,'push','LA').legal);
 g.tile(t.q,t.r).height=0;
 u.facing=3;
 assert(!g.physicalPreview(u.id,t.id,'push','LA').legal);
 u.facing=0;t.charge={type:'dfa',target:u.id};
 assert(!g.physicalPreview(u.id,t.id,'push','LA').legal);
});


test('CAT3500D pp.24,29: lethal charge recoil does not erase an already declared punch',()=>{
 const g=fresh(),[charger,ally,target,puncher]=g.units;
 for(const tile of g.tiles)Object.assign(tile,{type:'plain',height:0,depth:0,surface:0});
 Object.assign(charger,{q:0,r:0,facing:0,tonnage:65,moveMode:'run',
  charge:{type:'charge',target:target.id,dir:0,hexes:3,targetPos:{q:1,r:0}}});
 Object.assign(target,{q:1,r:0,facing:3});
 Object.assign(puncher,{q:-1,r:0,facing:0});
 ally.dead=true;g.phase='physical';g.initiativeWinner=1;g.rng=()=>.99;
 const preview=g.physicalPreview(puncher.id,charger.id,'punch','RA');
 assert(preview.legal,preview.reason);
 g.physicalDeclarations=[{id:puncher.id,target:charger.id,type:'punch',limb:'RA',...preview}];
 const damage=[];
 g.packets=(victim,amount)=>{
  damage.push([victim.id,amount]);
  if(victim===charger)g.destroyMech(charger);
  return amount;
 };
 const result=g.resolvePhysical();
 const punch=result.find(r=>r.id===puncher.id)?.shots[0];
 assert(charger.dead,'attacker destroys itself with its charge recoil');
 assert.deepEqual([charger.q,charger.r],[0,0],'a destroyed charger cannot advance');
 assert(punch,'the separately declared punch still resolves');
 assert.equal(punch.cancelled,false);
 assert.equal(punch.roll,12);
 assert.equal(punch.hit,true);
 assert.deepEqual(g.phaseRolls.slice(0,2).map(r=>r.kind),
  [charger.name+' · Таран',puncher.name+' · punch']);
 assert.deepEqual(damage.map(d=>d[0]),[target.id,charger.id]);
});

test('CAT3500D pp.24,29: lethal charge damage alone does not cancel another Mechs hit roll',()=>{
 const g=fresh(),[charger,puncher,target,other]=g.units;
 for(const tile of g.tiles)Object.assign(tile,{type:'plain',height:0,depth:0,surface:0});
 Object.assign(charger,{q:0,r:0,facing:0,tonnage:65,moveMode:'run',
  charge:{type:'charge',target:target.id,dir:0,hexes:3,targetPos:{q:1,r:0}}});
 Object.assign(target,{q:1,r:0,facing:3});
 Object.assign(puncher,{q:2,r:0,facing:3});
 other.dead=true;g.phase='physical';g.initiativeWinner=1;g.rng=()=>.99;
 const preview=g.physicalPreview(puncher.id,target.id,'punch','RA');
 assert(preview.legal,preview.reason);
 g.physicalDeclarations=[{id:puncher.id,target:target.id,type:'punch',limb:'RA',...preview}];
 g.packets=(victim,amount)=>{
  if(victim===target)g.destroyMech(target);
  return amount;
 };
 const result=g.resolvePhysical();
 const punch=result.find(r=>r.id===puncher.id)?.shots[0];
 assert(target.dead);
 assert.deepEqual([target.q,target.r],[1,0],'the destroyed target remains pending at its original hex');
 assert(punch,'a charge-killed target does not erase a previously committed roll');
 assert.equal(punch.cancelled,false);
 assert.equal(punch.roll,12);
 assert.equal(punch.hit,true);
 assert.deepEqual(g.phaseRolls.slice(0,2).map(r=>r.kind),
  [charger.name+' · Таран',puncher.name+' · punch']);
});

test('CAT3500D p.29: reciprocal push PSRs include later punch damage and remain phase-end',()=>{
 const g=fresh(),[pusher,puncher,target,other]=g.units;
 for(const tile of g.tiles)Object.assign(tile,{type:'plain',height:0,depth:0,surface:0});
 Object.assign(pusher,{q:0,r:0,facing:0});
 Object.assign(target,{q:1,r:0,facing:3});
 Object.assign(puncher,{q:2,r:0,facing:3});
 other.dead=true;g.phase='physical';g.initiativeWinner=1;g.rng=()=>.99;
 const preview=g.physicalPreview(puncher.id,target.id,'punch','RA');
 assert(preview.legal,preview.reason);
 g.physicalDeclarations=[
  {id:pusher.id,target:target.id,type:'push',targetNumber:2},
  {id:target.id,target:pusher.id,type:'push',targetNumber:2},
  {id:puncher.id,target:target.id,type:'punch',limb:'RA',...preview}
 ];
 const events=[],oldRoll=g.roll.bind(g);
 g.roll=(name,tn)=>{
  events.push({name,tn,damage:target.phaseDamage});
  return oldRoll(name,tn);
 };
 g.hit=(victim,amount)=>{
  if(victim===target){victim.phaseDamage+=20;events.push({name:'damage',damage:victim.phaseDamage});}
  return {damage:amount,hits:[]};
 };
 const result=g.resolvePhysical();
 assert.deepEqual([pusher.q,pusher.r,target.q,target.r],[0,0,1,0]);
 assert.equal(result.filter(r=>r.shots[0].weapon==='push').length,2);
 assert.equal(result.find(r=>r.id===puncher.id).shots[0].hit,true);
 const pushed=events.find(e=>e.name===target.name+' · Встречный толчок');
 assert(pushed,'both successful opposed pushes require phase-end piloting');
 assert.equal(pushed.damage,20);
 assert.equal(pushed.tn,target.piloting+1);
 assert(events.findIndex(e=>e.name==='damage')<events.indexOf(pushed));
 assert.deepEqual(g.afterRolls.map(r=>r.kind),[
  pusher.name+' · Встречный толчок',
  target.name+' · Встречный толчок',
  target.name+' · 20+ урона'
 ],'both opposed pushes and the independent 20+ damage PSR resolve after physical damage');
 assert(g.afterRolls.every(r=>r.target===target.piloting+1 || r.target===pusher.piloting),
  'cumulative 20+ damage modifies the target PSR threshold');
});

test('CAT3500D pp.25–26: Charge packet totals and post-impact displacement across tonnage and travel',()=>{
 for(const [weight,hexes,targetWeight] of [[45,1,65],[55,3,45],[65,5,85],[100,2,20]]){
  const {g,u,t}=physicalBlockFixture();
  g.units[1].dead=g.units[3].dead=true;
  Object.assign(u,{tonnage:weight,moveMode:'run',
   charge:{type:'charge',target:t.id,dir:0,hexes,targetPos:{q:t.q,r:t.r}}});
  t.tonnage=targetWeight;
  const impacts=[];
  g.packets=(unit,amount,side,table)=>{
   impacts.push({id:unit.id,amount,side,table});return amount;
  };
  g.rng=()=>.99;g.resolveSpecial(u);
  const expectedTarget=Math.ceil(weight/10*hexes),expectedSelf=Math.ceil(targetWeight/10);
  assert.deepEqual(impacts.map(x=>[x.id,x.amount]),
   [[t.id,expectedTarget],[u.id,expectedSelf]]);
  assert.deepEqual(impacts.map(x=>[x.side,x.table]),[['front','normal'],['front','normal']]);
  assert.deepEqual([u.q,u.r,t.q,t.r],[1,0,2,0]);
  assert.equal(u.charge.resolved,true);
  assert.equal(g.resolution[0].shots[0].hit,true);
  assert.equal(g.resolution[0].shots[0].damage,expectedTarget);
  assert(u.psrs.some(p=>p.modifier===2&&p.reason==='Таран'));
  assert(t.psrs.some(p=>p.modifier===2&&p.reason==='Попадание тарана'));
 }
});

test('CAT3500D p.26 errata v8.01: lethal Charge recoil prevents attacker advance even on hit',()=>{
 const {g,u,t}=physicalBlockFixture();
 g.units[1].dead=g.units[3].dead=true;
 Object.assign(u,{moveMode:'run',tonnage:65,
  charge:{type:'charge',target:t.id,dir:0,hexes:4,targetPos:{q:t.q,r:t.r}}});
 g.rng=()=>.99;
 const packets=[];
 g.packets=(unit,amount)=>{
  packets.push([unit.id,amount]);
  if(unit===u)g.destroyMech(u);
  return amount;
 };
 g.resolveSpecial(u);
 assert.deepEqual(packets,[[t.id,26],[u.id,Math.ceil(t.tonnage/10)]]);
 assert(u.dead);assert.equal(u.charge.resolved,true);
 assert.deepEqual([u.q,u.r],[0,0],'a destroyed charging attacker cannot enter the target hex');
 assert.equal(g.resolution[0].shots[0].hit,true);
});

test('CAT3500D pp.26–28: DFA damage groups, hit tables, displacement and phase-end PSRs',()=>{
 for(const [weight,targetProne,table,side] of [
  [55,false,'punch','front'],
  [65,true,'normal','rear']
 ]){
  const {g,u,t}=physicalBlockFixture();
  g.units[1].dead=g.units[3].dead=true;
  Object.assign(u,{tonnage:weight,airborne:true,moveMode:'jump',
   charge:{type:'dfa',target:t.id,dir:0,targetPos:{q:t.q,r:t.r},startPos:{q:-2,r:0}}});
  t.prone=targetProne;
  const impacts=[];
  g.packets=(unit,amount,hitSide,locationTable)=>{
   impacts.push([unit.id,amount,hitSide,locationTable]);return amount;
  };
  g.rng=()=>.99;g.resolveSpecial(u);
  assert.deepEqual(impacts,[
   [t.id,Math.ceil(weight/10*3),side,table],
   [u.id,weight/5,'front','kick']
  ]);
  assert.deepEqual([u.q,u.r,t.q,t.r],[1,0,2,0]);
  assert.equal(u.charge.resolved,true);assert(!u.airborne);
  assert.equal(g.resolution[0].shots[0].damage,Math.ceil(weight/10*3));
  assert(u.psrs.some(p=>p.modifier===4&&p.reason==='Посадка DFA'));
  assert.equal(t.psrs.some(p=>p.modifier===2&&p.reason==='Попадание DFA'),!targetProne);
 }
});

test('CAT3500D p.27 errata v8.01: lethal DFA recoil does not displace surviving target',()=>{
 const {g,u,t}=physicalBlockFixture();
 g.units[1].dead=g.units[3].dead=true;
 Object.assign(u,{tonnage:55,airborne:true,moveMode:'jump',
  charge:{type:'dfa',target:t.id,dir:0,targetPos:{q:t.q,r:t.r},startPos:{q:-2,r:0}}});
 const impacts=[];g.rng=()=>.99;
 g.packets=(unit,amount,side,table)=>{
  impacts.push([unit.id,amount,side,table]);
  if(unit===u)g.destroyMech(u);
  return amount;
 };
 g.resolveSpecial(u);
 assert.deepEqual(impacts.map(x=>[x[0],x[1]]),[[t.id,17],[u.id,11]]);
 assert(u.dead);assert.equal(u.charge.resolved,true);assert(!u.airborne);
 assert.deepEqual([t.q,t.r],[1,0],'target cannot be displaced by destroyed DFA attacker');
 assert.deepEqual(t.psrs,[],'no DFA hit PSR when its dead attacker cannot displace');
 assert.equal(g.resolution[0].shots[0].hit,true);
});

test('CAT3500D pp.24–29: Chapter 7 closes only with fifteen source-reviewed physical requirements',()=>{
 const r=JSON.parse(readFileSync(new URL('../rules/agoac-audit.json',import.meta.url),'utf8'));
 const t=r.topics.find(x=>x.id==='agoac-physical');
 const rules=r.requirements.filter(x=>x.topicId===t.id);
 assert.equal(t.status,'verified');
 assert(t.audit.sourceChecked&&t.audit.edgeCasesChecked&&t.audit.inventoryComplete);
 assert.equal(rules.length,15,'missing or duplicate chapter 7 requirement');
 assert.deepEqual(t.audit.requirementIds,[...rules.map(x=>x.id)]);
 assert(rules.every(x=>x.status==='verified'&&x.audit?.sourceChecked&&x.audit?.edgeCasesChecked));
 assert(rules.every(x=>Array.isArray(x.evidence)&&x.evidence.length));
 assert.equal(t.audit.testedSha,t.audit.mainQualityGate.headSha);
 assert.equal(t.audit.mainQualityGate.conclusion,'success');
 assert.deepEqual(t.audit.checks.map(c=>c.name).sort(),
  ['Ironhex Browser E2E','Ironhex CI','Ironhex Container Smoke']);
 assert(t.audit.checks.every(c=>c.conclusion==='success'));
 assert.equal(r.currentTopicId,r.topics.find(x=>x.status!=='verified')?.id??null);
});



test('CAT3500D pp.30–36: Chapter 8 closes only with twelve source-reviewed damage requirements',()=>{
 const r=JSON.parse(readFileSync(new URL('../rules/agoac-audit.json',import.meta.url),'utf8'));
 const chapter=r.topics.find(x=>x.id==='agoac-damage');
 const rules=r.requirements.filter(x=>x.topicId==='agoac-damage');
 assert.equal(chapter.status,'verified');
 assert.equal(rules.length,12,'missing, duplicate or extra Chapter 8 requirement');
 assert.equal(chapter.audit.inventoryComplete,true);
 assert.equal(chapter.audit.sourceChecked,true);
 assert.equal(chapter.audit.edgeCasesChecked,true);
 assert.deepEqual(chapter.audit.requirementIds,rules.map(x=>x.id));
 assert(rules.every(x=>x.status==='verified'&&x.audit?.sourceChecked&&x.audit?.edgeCasesChecked&&x.evidence?.length>0));
 assert.equal(chapter.audit.testedSha,chapter.audit.mainQualityGate.headSha);
 assert.equal(chapter.audit.mainQualityGate.conclusion,'success');
 assert.deepEqual(chapter.audit.checks.map(x=>x.name).sort(),['Ironhex Browser E2E','Ironhex CI','Ironhex Container Smoke']);
 assert(chapter.audit.checks.every(x=>x.conclusion==='success'&&Number.isInteger(x.runId)));
 const crit=r.requirements.find(x=>x.id==='agoac-108');
 const criticalTests=readFileSync(new URL('./agoac-ch8-critical-components.mjs',import.meta.url),'utf8');
 assert(criticalTests.split("test('").length-1>=21,'full component effects matrix must not disappear');
 assert(crit.evidence.some(x=>x.file==='tests/agoac-ch8-critical-components.mjs'));
 assert.equal(r.currentTopicId,r.topics.find(x=>x.status!=='verified')?.id??null,'cursor must point at next unverified chapter without starting it');
});

test('CAT3500D p.32 and errata v8.01 p.4: first gyro hit immediately rolls its PSR',()=>{
 const g=fresh(),u=g.units[0];g.phase='fire';u.piloting=5;
 const dice=[...diceFor(8),.5/6,3.5/6,...diceFor(12)];
 g.rng=()=>{assert(dice.length,'immediate gyro PSR must consume a fresh roll');return dice.shift();};
 g.criticalHit(u,'CT');
 assert.equal(dice.length,0);assert.equal(u.gyroHits,1);assert(!u.prone);
 const events=g.phaseRolls.map(x=>x.kind);
 assert(events[0].includes('Критические повреждения'));
 const psrIndex=events.findIndex(k=>k.includes('Гироскоп'));
 assert(psrIndex>0&&psrIndex===events.length-1,'gyro PSR follows slot assignment immediately');
 assert.deepEqual(u.psrs,[]);
});

test('CAT3500D pp.30,34,36: destroyed non-ammo section needs no crit roll and counts residual armor',()=>{
 const g=fresh(),u=g.units[0];g.phase='fire';
 u.armor.LT=0;u.rear.LT=18;u.structure.LT=2;
 u.slots.LT=['sink',...Array(11).fill(null)];
 u.crit.LT=Array(12).fill(false);
 const before=u.phaseDamage;
 g.rng=()=>{throw Error('No critical dice for destroyed non-ammunition section');};
 g.damage(u,'LT',2,{internal:true});
 assert.equal(u.structure.LT,0);assert.equal(u.armor.LT,0);assert.equal(u.rear.LT,0);
 assert.equal(u.phaseDamage-before,20,'two structure plus eighteen rear armor count for 20+ PSR');
 assert.equal(g.phaseRolls.filter(x=>x.kind.includes('Критические повреждения')).length,0);
 g.rng=()=>.99;g.endPSR();
 assert(g.phaseRolls.some(x=>x.kind.includes('20+ урона')));
});

test('CAT3500D p.36 Step 5: destroyed ammo section rolls once but ignores non-ammo critical effects',()=>{
 const g=fresh(),u=g.units[0];g.phase='fire';
 u.armor.LT=0;u.structure.LT=1;
 u.slots.LT=['engine','ammo:0:2',...Array(10).fill(null)];
 u.crit.LT=Array(12).fill(false);
 const bin={weapon:0,location:'LT',slot:1,shots:2,destroyed:false};
 u.bins.push(bin);
 const initialEngine=u.engineHits;
 const dice=[...diceFor(8),.5/6];
 g.rng=()=>{assert(dice.length,'only one critical table check, one slot selection');return dice.shift();};
 g.damage(u,'LT',1,{internal:true});
 assert.equal(dice.length,0);
 assert.equal(u.engineHits,initialEngine+1,'engine slot is lost to destruction, not to the discarded critical');
 assert.equal(u.structure.LT,0);
 assert.equal(bin.shots,0);assert(bin.destroyed);
 assert.equal(g.phaseRolls.filter(x=>x.kind.includes('Критические повреждения')).length,1);
});

test('CAT3500D pp.32–34: blown-off leg loses no additional armor or structure for 20+ PSR',()=>{
 const g=fresh(),u=g.units[0];g.phase='fire';
 u.armor.LL=22;u.structure.LL=11;
 const before=u.phaseDamage,dice=diceFor(12);
 // Isolate damage accounting from the separately tested automatic fall.
 let falls=0;g.fall=v=>{assert.equal(v,u);v.prone=true;falls++;};
 g.rng=()=>{assert(dice.length);return dice.shift();};
 g.criticalHit(u,'LL');
 assert.equal(falls,1);assert.equal(dice.length,0);assert.equal(u.structure.LL,0);
 assert.equal(u.armor.LL,0);assert.equal(u.phaseDamage,before);
 assert(g.tile(u.q,u.r).club,'blown-off limb is available as a club');
});

test('CAT3500D pp.30,34,36: excess arm damage transfers to same-side torso armor',()=>{
 const g=fresh(),u=g.units[0];g.phase='fire';
 u.armor.LA=0;u.structure.LA=1;u.armor.LT=10;u.structure.LT=10;
 u.slots.LA=Array(12).fill(null);u.crit.LA=Array(12).fill(false);
 g.rng=()=>{throw Error('No critical roll when a non-ammo arm is fully destroyed');};
 const before=u.phaseDamage;
 g.damage(u,'LA',5);
 assert.equal(u.structure.LA,0);assert.equal(u.armor.LT,6);
 assert.equal(u.phaseDamage-before,5);
});


test('CAT3500D pp.30,34–36: rear armor survives front damage and receives same-side transfers',()=>{
 const g=fresh(),u=g.units[0];g.phase='fire';
 u.armor.LT=0;u.rear.LT=0;u.structure.LT=1;
 u.armor.CT=9;u.rear.CT=6;u.structure.CT=10;
 u.slots.LT=Array(12).fill(null);u.crit.LT=Array(12).fill(false);
 const before=u.phaseDamage;
 g.rng=()=>{throw Error('Destroyed non-ammo torso needs no critical-location roll');};
 g.damage(u,'LT',4,{rear:true});
 assert.equal(u.structure.LT,0);
 assert.equal(u.armor.CT,9,'the undamaged front center torso armor is preserved');
 assert.equal(u.rear.CT,3,'the three transferred points strike rear center torso armor');
 assert.equal(u.phaseDamage-before,4);
});

test('CAT3500D p.36 Step 5: ammo critical in destroyed section is resolved, not discarded',()=>{
 const g=fresh(),u=g.units[0];g.phase='fire';u.armor.LT=0;u.structure.LT=1;
 u.slots.LT=['ammo:0:2',...Array(11).fill(null)];
 u.crit.LT=Array(12).fill(false);
 u.bins=u.bins.filter(b=>b.location!=='LT');
 const bin={weapon:0,location:'LT',slot:0,shots:2,destroyed:false};u.bins.push(bin);
 const events=[],dice=[...diceFor(8),.5/6];
 g.rng=()=>{assert(dice.length,'only critical-table and ammo-slot rolls expected');return dice.shift();};
 g.explode=(v,b)=>{events.push([v.id,b.slot,b.shots]);b.shots=0;b.destroyed=true;};
 g.damage(u,'LT',1,{internal:true});
 assert.equal(dice.length,0);
 assert.deepEqual(events,[[u.id,0,2]],'the ammunition hit still explodes before section cleanup');
 assert.equal(bin.destroyed,true);
 assert.equal(g.phaseRolls.filter(x=>x.kind.includes('Критические повреждения')).length,1);
});


test('CAT3500D p.31: prior-phase exhausted arm criticals transfer to ipsilateral torso',()=>{
 const g=fresh(),u=g.units[0];g.phase='fire';
 u.slots.LA=Array(12).fill('w:0');u.crit.LA=Array(12).fill(true);
 u.slots.LT=['sink',...Array(11).fill(null)];u.crit.LT=Array(12).fill(false);
 const before=u.sinksLost,dice=[...diceFor(8),.5/6];
 g.rng=()=>{assert(dice.length,'critical transfer must not repeat a location roll');return dice.shift();};
 g.criticalHit(u,'LA');
 assert.equal(dice.length,0);assert(u.crit.LT[0]);assert.equal(u.sinksLost,before+1);
 assert.equal(g.phaseRolls.filter(x=>x.kind.includes('Критические повреждения')).length,1);
});

test('CAT3500D pp.31–32: same-phase exhausted critical slots do not transfer',()=>{
 const g=fresh(),u=g.units[0];g.phase='fire';
 u.slots.LA=['w:0',...Array(11).fill(null)];u.crit.LA=Array(12).fill(false);
 u.slots.LT=['engine',...Array(11).fill(null)];u.crit.LT=Array(12).fill(false);
 const before=u.engineHits,dice=[...diceFor(10),.5/6];
 g.rng=()=>{assert(dice.length,'the second inapplicable critical is lost without a transfer roll');return dice.shift();};
 g.criticalHit(u,'LA');
 assert.equal(dice.length,0);assert(u.crit.LA[0]);assert.equal(u.crit.LT[0],false);
 assert.equal(u.engineHits,before);
 assert.equal(u.critMarkedThisPhase.includes('LA'),true);
});

test('CAT3500D p.31: fully inapplicable torso/arm critical block uses one D6',()=>{
 const g=fresh(),u=g.units[0];g.phase='fire';
 u.slots.RA=Array(12).fill(null);u.slots.RA[7]='sink';
 u.crit.RA=Array(12).fill(false);
 const before=u.sinksLost,dice=[...diceFor(8),(1.5)/6];
 g.rng=()=>{assert(dice.length,'inapplicable six-slot block must never be rolled');return dice.shift();};
 g.criticalHit(u,'RA');
 assert.equal(dice.length,0);assert(u.crit.RA[7]);assert.equal(u.sinksLost,before+1);
});

test('CAT3500D p.31: inapplicable torso/arm slot rerolls the full pair of dice',()=>{
 const g=fresh(),u=g.units[0];g.phase='fire';
 u.slots.RA=Array(12).fill(null);u.slots.RA[0]='sink';u.slots.RA[7]='jump';
 u.crit.RA=Array(12).fill(false);
 const sinkBefore=u.sinksLost,jumpBefore=u.jumpLost;
 const dice=[...diceFor(8),(3.5)/6,.5/6,.5/6,.5/6];
 g.rng=()=>{assert(dice.length,'a used/empty slot rerolls block AND position, not merely position');return dice.shift();};
 g.criticalHit(u,'RA');
 assert.equal(dice.length,0);assert(u.crit.RA[0]);assert(!u.crit.RA[7]);
 assert.equal(u.sinksLost,sinkBefore+1);assert.equal(u.jumpLost,jumpBefore);
});

test('CAT3500D pp.30–32: roll 12 on destroyed ammo-carrying leg checks three slots',()=>{
 const g=fresh(),u=g.units[0];g.phase='fire';
 u.armor.RL=0;u.structure.RL=1;
 u.slots.RL=['ammo:0:1',...Array(5).fill(null)];u.crit.RL=Array(6).fill(false);
 const bin={weapon:0,location:'RL',slot:0,shots:1,destroyed:false};
 u.bins.push(bin);
 const explosion=[];g.explode=(v,b)=>{explosion.push([v.id,b.location,b.shots]);b.shots=0;b.destroyed=true;};
 // Fall is checked in its own end-to-end test; isolate critical slot RNG.
 let falls=0;g.fall=v=>{assert.equal(v,u);v.prone=true;falls++;};
 const dice=[...diceFor(12),.5/6];
 g.rng=()=>{assert(dice.length,'a 12 in destroyed ammo section must resolve its explosive slots');return dice.shift();};
 g.damage(u,'RL',1,{internal:true});
 assert.equal(dice.length,0);
 assert.deepEqual(explosion,[[u.id,'RL',1]]);
 assert.equal(falls,1,'newly destroyed standing leg triggers immediate fall');
 assert.equal(bin.destroyed,true);assert.equal(u.structure.RL,0);
 assert.equal(g.phaseRolls.filter(x=>x.kind.includes('Критические повреждения')).length,1);
});

test('CAT3500D p.32: ammunition explosion uses remaining shots times missile count and inflicts two wounds',()=>{
 const g=fresh(),u=g.units[0];g.phase='fire';
 const w=u.weapons[0];w.damage=2;w.rack=6;
 const bin={weapon:0,location:'LA',slot:9,shots:3,destroyed:false};
 u.bins.push(bin);
 let wounds=0;const applied=[];
 g.wound=(v,n)=>{assert.equal(v,u);wounds+=n;};
 g.damage=(v,l,n,opts)=>{applied.push([v.id,l,n,opts]);return [];};
 g.explode(u,bin);
 assert.deepEqual(applied,[[u.id,'LA',36,{internal:true,explosion:true}]]);
 assert.equal(wounds,2);assert(bin.destroyed);assert.equal(bin.shots,0);
 g.explode(u,bin);assert.equal(wounds,2);assert.equal(applied.length,1);
});

test('CAT3500D pp.32,35: ammunition explosion bypasses armor on inward transfer',()=>{
 const g=fresh(),u=g.units[0];g.phase='fire';
 const bin=u.bins.find(b=>b.location==='RT');assert(bin);
 u.weapons[bin.weapon].damage=2;u.weapons[bin.weapon].rack=1;bin.shots=2;
 u.slots.RT=Array(12).fill(null);u.crit.RT=Array(12).fill(false);
 u.structure.RT=2;u.structure.CT=10;
 u.armor.RT=14;u.armor.CT=18;u.rear.CT=8;
 const before=[u.armor.RT,u.armor.CT,u.rear.CT];
 g.rng=()=>.99;
 g.explode(u,bin);
 assert.equal(u.structure.RT,0);assert.equal(u.structure.CT,8);
 assert.equal(u.armor.CT,before[1]);assert.equal(u.rear.CT,before[2]);
 assert.equal(u.pilotWounds,2);assert(bin.destroyed);
});


test('AGOAC errata v8.01 p.4: hip PSR preserves only same/later-phase leg actuator penalties',()=>{
 const scenarios=[
  {name:'earlier phase of same turn',events:[['upper',4,'move'],['hip',4,'fire']],psr:2,mp:2},
  {name:'same phase before hip',events:[['upper',4,'fire'],['hip',4,'fire']],psr:3,mp:2},
  {name:'later phase of same turn',events:[['hip',4,'move'],['upper',4,'fire']],psr:3,mp:2},
  {name:'previous turn',events:[['upper',3,'fire'],['hip',4,'fire']],psr:2,mp:3},
  {name:'next turn',events:[['hip',3,'fire'],['upper',4,'move']],psr:3,mp:2},
  {name:'multiple later phases',events:[['hip',4,'move'],['lower',4,'fire'],['foot',4,'physical']],psr:4,mp:1}
 ];
 for(const {name,events,psr,mp} of scenarios){
  const g=fresh(),u=g.units[0];u.walk=5;u.heat=0;
  const slot={hip:0,upper:1,lower:2,foot:3};
  for(const [part,round,phase] of events){
   g.round=round;g.phase=phase;
   const dice=[...diceFor(8),(slot[part]+.5)/6];
   g.rng=()=>{assert(dice.length,name+': missing critical die');return dice.shift();};
   g.criticalHit(u,'LL');assert.equal(dice.length,0,name);
  }
  assert.equal(g.psrMod(u),psr,name+': PSR uses phase-accurate actuator chronology');
  assert.equal(g.mp(u,'walk'),mp,name+': movement deliberately uses turn-level chronology');
  assert.equal(g.mp(u,'run'),Math.ceil(mp*1.5),name);
  const snap=JSON.parse(JSON.stringify(g,(k,v)=>['map','rng'].includes(k)?undefined:v));
  const restored=new Game({rng:()=>.5});
  Object.assign(restored,snap);restored.rebuildMap();
  assert.equal(restored.psrMod(restored.unit(u.id)),psr,name+' serialized PSR');
  assert.equal(restored.mp(restored.unit(u.id),'walk'),mp,name+' serialized MP');
 }
});

test('AGOAC errata v8.01 p.4: hip critical PSR suppression does not erase other-leg damage',()=>{
 const g=fresh(),u=g.units[0];u.round=5;g.round=5;g.phase='fire';
 const dice=[...diceFor(8),.5/6];g.rng=()=>{assert(dice.length);return dice.shift();};
 g.criticalHit(u,'LL');assert.equal(dice.length,0);
 u.actuators.RL.upper=true;
 assert.equal(g.psrMod(u),3,'hip +2 and unaffected opposite-leg upper actuator +1');
 delete u.actuatorHitPhases;
 u.actuators.LL.lower=true;
 assert.equal(g.psrMod(u),3,'legacy undated same-leg actuator is not invented as a new hit');
});


test('CAT3500D p.34: biped leg destruction causes immediate automatic fall without a deferred PSR',()=>{
 for(const leg of ['LL','RL']){
  const g=fresh(),u=g.units[0];g.phase='fire';
  u.armor[leg]=0;u.structure[leg]=1;
  u.slots[leg]=Array(6).fill(null);u.crit[leg]=Array(6).fill(false);
  const falls=[];g.fall=(v,levels=0,tn=null)=>{
   assert.equal(v,u);falls.push([levels,tn,g.phase]);v.prone=true;
  };
  g.rng=()=>{throw Error('leg with no explosive slots must not make a destroyed-section crit roll');};
  g.damage(u,leg,1,{internal:true});
  assert.equal(u.structure[leg],0);assert(u.prone);
  assert.deepEqual(falls,[[0,null,'fire']],'automatic fall occurs during the damaging hit');
  assert.equal(u.moveEndedByLegLoss,true);
  assert(!u.psrs.some(p=>p.reason==='Потеря ноги'),'no replacement end-phase PSR');
  g.endPSR();assert.equal(falls.length,1,'end of phase cannot repeat immediate fall');
 }
});

test('CAT3500D p.34: destroyed biped leg never causes a second fall while prone or already falling',()=>{
 for(const [prone,falling] of [[true,false],[false,true]]){
  const g=fresh(),u=g.units[0];g.phase='fire';u.prone=prone;u.falling=falling;
  g.fall=()=>{throw Error('already prone/falling mech must not fall a second time');};
  g.destroyLocation(u,'LL');
  assert.equal(u.moveEndedByLegLoss,true);
  assert.equal(u.structure.LL,0);
  assert.equal(u.prone,prone);
 }
});

test('CAT3500D p.34: one-legged prone biped may rotate one hexside on a later turn',()=>{
 const g=fresh(),u=g.units[0];g.phase='move';g.activeTeam=u.team;
 g.queue=[u.team];g.actingId=null;
 g.fall=(v)=>{assert.equal(v,u);v.prone=true;};
 g.destroyLocation(u,'LL');
 assert.equal(g.rotate(u.id,1).ok,false,'leg-loss movement ends for the current turn');
 u.moveEndedByLegLoss=false;u.spent=0;u.moveMode='stand';
 assert.equal(g.mp(u,'walk'),1);
 assert(g.rotate(u.id,1).ok,'later-turn prone facing change uses one walking MP');
 assert.equal(g.rotate(u.id,1).ok,false,'the second turn step lacks the MP');
});


test('CAT3500D pp.30–36: five core damage groups retain exact source and CI evidence after chapter closure',()=>{
 const reg=JSON.parse(readFileSync(new URL('../rules/agoac-audit.json',import.meta.url),'utf8'));
 const ids=['agoac-037','agoac-104','agoac-105','agoac-106','agoac-107'];
 for(const id of ids){
  const r=reg.requirements.find(x=>x.id===id);
  assert(r&&r.status==='verified'&&r.audit?.sourceChecked&&r.audit?.edgeCasesChecked,id);
  assert(r.evidence.length>=4&&r.audit.checks.length===3,id);
  assert(r.audit.checks.every(c=>c.conclusion==='success'),id);
  assert.equal(r.audit.mainQualityGate.conclusion,'success',id);
 }
 assert.equal(reg.topics.find(x=>x.id==='agoac-damage').status,'verified');
 assert.equal(reg.requirements.find(x=>x.id==='agoac-108').status,'verified',
  'component effects and mandatory natural-12 head/limb blowoff must be audited');
});


test('CAT3500D p.37: water cooling counts submerged leg sinks and caps additional cooling at six',()=>{
 const scenarios=[
  {depth:0,prone:false,lost:0,expected:20},
  {depth:1,prone:false,lost:0,expected:18},
  {depth:1,prone:true,lost:0,expected:14},
  {depth:2,prone:false,lost:0,expected:14},
  {depth:1,prone:false,lost:3,expected:21}
 ];
 for(const {depth,prone,lost,expected} of scenarios){
  const g=fresh(),u=g.units[0];
  g.units=[u];g.phase='heat';
  u.heat=30;u.pendingHeat=0;u.sinks=10;u.sinksLost=lost;
  u.shutdown=true;u.voluntaryShutdown=true;u.bins=[];u.prone=prone;
  for(const loc of ['LL','RL']){
   u.slots[loc]=u.slots[loc].map(()=>null);
   u.crit[loc]=u.slots[loc].map(()=>false);
   u.slots[loc][0]='sink';
  }
  Object.assign(g.tile(u.q,u.r),{depth,type:depth?'water':'plain',height:-depth,surface:0});
  g.heatPhase();
  assert.equal(u.heat,expected,'depth '+depth+' prone '+prone+' lost '+lost);
 }
});

test('CAT3500D p.37: Heat Phase preserves overflow and never cools below zero',()=>{
 const g=fresh(),u=g.units[0];
 g.units=[u];g.phase='heat';
 u.bins=[];u.sinks=3;u.sinksLost=0;
 u.shutdown=true;u.voluntaryShutdown=true;u.heat=29;u.pendingHeat=12;
 g.heatPhase();
 assert.equal(u.heat,38,'heat above 30 must remain in state for future turns');
 assert.equal(u.pendingHeat,0,'generated heat must be committed exactly once');
 g.heatPhase();
 assert.equal(u.heat,35,'a later Heat Phase must dissipate previous overflow');
 u.heat=1;u.pendingHeat=0;
 g.heatPhase();
 assert.equal(u.heat,0,'cooling cannot reduce current heat below zero');
});

test('CAT3500D p.38: heat movement and weapon penalties activate at every printed threshold',()=>{
 const g=fresh(),u=g.units[0],enemy=g.units.find(x=>x.team!==u.team);
 Object.assign(u,{q:0,r:0,facing:0,moveMode:'stand'});
 Object.assign(enemy,{q:1,r:0});
 for(const tile of g.tiles)Object.assign(tile,{type:'plain',depth:0,height:0,surface:0});
 const baseWalk=g.mp(u,'walk'),baseJump=g.mp(u,'jump');
 for(const heat of [0,4,5,7,8,9,10,12,13,14,15,16,17,19,20,23,24,25,30,45]){
  u.heat=heat;
  const walk=Math.max(0,baseWalk-Math.min(5,Math.floor(heat/5)));
  assert.equal(g.mp(u,'walk'),walk,'walking at heat '+heat);
  assert.equal(g.mp(u,'run'),Math.ceil(walk*1.5),'running at heat '+heat);
  assert.equal(g.mp(u,'jump'),baseJump,'jump MP is unaffected at heat '+heat);
  assert.equal(g.preview(u.id,enemy.id,0).mods.heat,[8,13,17,24].filter(h=>heat>=h).length,'weapon target modifier at heat '+heat);
 }
});


test('CAT3500D p.39: identical-shot ammo bins use RNG, never controller choice',()=>{
 for(const [random,expected] of [[0,0],[.49,0],[.5,1],[.99,1]]){
  const g=fresh(),u=g.units[0],base=u.bins[0];
  u.bins=[{...base,shots:3},{...base,location:'RT',slot:11,shots:3}];
  g.phaseRolls=[];g.rng=()=>random;
  g._resolutionChooser=()=>{throw Error('No player choice for the same ammo type');};
  const selected=g.heatExplosionBin(u,u.bins);
  assert.equal(selected,u.bins[expected],'RNG sample '+random);
  assert.equal(g.phaseRolls.at(-1).kind.includes('Случайный магазин'),true);
 }
});

test('CAT3500D pp.38–39: tied damage across types allows controller choice, but not same-type bin choice',()=>{
 const g=fresh(),u=g.units[0],base=u.bins[0];
 u.weapons=[{name:'SRM 6',damage:2,rack:6},{name:'Medium AC',damage:12,rack:0}];
 u.bins=[{...base,weapon:0,shots:9},{...base,weapon:0,location:'LT',slot:11,shots:2},
  {...base,weapon:1,location:'RT',slot:11,shots:4}];
 g._resolutionChooser=({kind,options},fallback)=>{
  assert.equal(kind,'heat-ammo-bin');
  assert.deepEqual(options.map(o=>[o.id,o.shots]),[['0',9],['2',4]]);
  return '0';
 };
 assert.equal(g.heatExplosionBin(u,u.bins),u.bins[0]);
});

test('AGOAC errata v8.01 p.4: all heat checks resolve before shutdown, ammo and life-support effects',()=>{
 const g=fresh(),u=g.units[0];
 for(const other of g.units.slice(1))other.dead=true;
 u.heat=30;u.pendingHeat=0;u.sinks=0;u.lifeSupport=true;
 u.shutdown=false;u.voluntaryShutdown=false;u.bins=[{...u.bins[0],shots:1}];
 const steps=[];
 g.heatRequiresShutdown=()=>{steps.push('shutdown-check');return true;};
 g.roll=(kind,target)=>{
  if(kind.includes('Перегрев боезапаса')){steps.push('ammo-check');return 2;}
  throw Error('Unexpected roll '+kind+' '+target);
 };
 g.psr=()=>{steps.push('shutdown-effect');return true;};
 g.explode=()=>{steps.push('ammo-effect');};
 g.wound=(unit,n)=>{assert.equal(n,2);steps.push('life-support-effect');};
 g.consciousness=()=>{};
 g.endPSR=()=>{};
 g.heatPhase();
 assert.deepEqual(steps,['shutdown-check','ammo-check','shutdown-effect','ammo-effect','life-support-effect']);
 assert.equal(u.heat,30);
 assert.equal(u.shutdown,true);
});

test('AGOAC errata v8.01 p.4: concurrent heat effects survive a shutdown PSR changing pilot state',()=>{
 const g=fresh(),u=g.units[0];
 for(const other of g.units.slice(1))other.dead=true;
 u.heat=30;u.pendingHeat=0;u.sinks=0;u.lifeSupport=true;
 u.shutdown=false;u.voluntaryShutdown=false;u.bins=[{...u.bins[0],shots:1}];
 const events=[];
 g.roll=(kind)=>{if(kind.includes('Перегрев боезапаса')){events.push('ammo-check');return 2;}return 2;};
 g.psr=(unit)=>{events.push('shutdown-psr');unit.unconscious=true;return false;};
 g.explode=()=>{events.push('ammo-explosion');};
 g.wound=(unit,n)=>{events.push('life-support-'+n);};
 g.consciousness=()=>{};
 g.endPSR=()=>{};
 g.heatPhase();
 assert.deepEqual(events,['ammo-check','shutdown-psr','ammo-explosion','life-support-2']);
 assert.equal(u.unconscious,true);
});


test('CAT3500D pp.37–39: completed Heat chapter retains twelve source-reviewed rules and exact green main gates',()=>{
 const reg=JSON.parse(readFileSync(new URL('../rules/agoac-audit.json',import.meta.url),'utf8'));
 const chapter=reg.topics.find(x=>x.id==='agoac-heat');
 const requirements=reg.requirements.filter(x=>x.topicId==='agoac-heat');
 assert.equal(chapter.status,'verified');
 assert.equal(chapter.audit.inventoryComplete,true);
 assert.equal(chapter.audit.sourceChecked,true);
 assert.equal(chapter.audit.edgeCasesChecked,true);
 assert.equal(requirements.length,12);
 assert.deepEqual(requirements.map(x=>x.id),Array.from({length:12},(_,i)=>'agoac-'+(i+109)));
 assert.deepEqual(chapter.audit.requirementIds,requirements.map(x=>x.id));
 assert(requirements.every(x=>x.status==='verified'&&x.audit?.sourceChecked&&x.audit?.edgeCasesChecked&&x.evidence?.length));
 assert.equal(chapter.audit.testedSha,chapter.audit.mergedSha);
 assert.equal(chapter.audit.mainQualityGate.headSha,chapter.audit.mergedSha);
 assert.equal(chapter.audit.mainQualityGate.conclusion,'success');
 assert.deepEqual(chapter.audit.checks.map(x=>x.name).sort(),['Ironhex Browser E2E','Ironhex CI','Ironhex Container Smoke']);
 assert(chapter.audit.checks.every(x=>x.conclusion==='success'&&Number.isInteger(x.runId)));
 assert.equal(reg.currentTopicId,reg.topics.find(t=>t.status!=='verified')?.id??null);
 const suite=readFileSync(new URL('./agoac-foundations.mjs',import.meta.url),'utf8');
 const required={
  'agoac-118':['CAT3500D p.39: heat ammo explosion automatically selects the same-type bin with most shots','CAT3500D p.39: identical-shot ammo bins use RNG, never controller choice','CAT3500D pp.38–39: tied damage across types allows controller choice, but not same-type bin choice'],
  'agoac-120':['AGOAC errata v8.01 p.4: all heat checks resolve before shutdown, ammo and life-support effects','AGOAC errata v8.01 p.4: concurrent heat effects survive a shutdown PSR changing pilot state']
 };
 for(const [id,names] of Object.entries(required)){
  const entry=requirements.find(x=>x.id===id);
  assert(entry&&entry.audit.testedSha===chapter.audit.testedSha);
  for(const name of names){
   assert(entry.evidence.some(x=>x.test===name),id+' missing source-linked evidence');
   assert(suite.includes("test('"+name+"'"),id+' missing deterministic regression');
  }
 }
 assert(reg.topics.slice(0,9).every(x=>x.status==='verified'),
  'The first nine chapters through Heat must remain source-verified');
});

test('CAT3500D pp.40–44: completed Piloting chapter keeps 19 source-reviewed rules and exact main quality gates',()=>{
 const reg=JSON.parse(readFileSync(new URL('../rules/agoac-audit.json',import.meta.url),'utf8'));
 const chapter=reg.topics.find(x=>x.id==='agoac-psr');
 const requirements=reg.requirements.filter(x=>x.topicId==='agoac-psr');
 assert.equal(chapter.status,'verified');
 assert.equal(chapter.audit.inventoryComplete,true);
 assert(chapter.audit.sourceChecked&&chapter.audit.edgeCasesChecked);
 assert.equal(requirements.length,19);
 assert.deepEqual(requirements.map(x=>x.id),Array.from({length:19},(_,i)=>'agoac-'+(i+121)));
 assert.deepEqual(chapter.audit.requirementIds,requirements.map(x=>x.id));
 assert(requirements.every(x=>x.status==='verified'&&x.audit?.sourceChecked&&x.audit?.edgeCasesChecked&&x.evidence?.length));
 assert.equal(chapter.audit.testedSha,chapter.audit.mergedSha);
 assert.equal(chapter.audit.mainQualityGate.headSha,chapter.audit.mergedSha);
 assert.equal(chapter.audit.mainQualityGate.conclusion,'success');
 assert.deepEqual(chapter.audit.checks.map(x=>x.name).sort(),
  ['Ironhex Browser E2E','Ironhex CI','Ironhex Container Smoke']);
 assert(chapter.audit.checks.every(x=>x.conclusion==='success'&&Number.isInteger(x.runId)));
 assert.equal(reg.currentTopicId,'agoac-scenarios');
 const suite=readFileSync(new URL('./agoac-foundations.mjs',import.meta.url),'utf8');
 for(const title of [
  'CAT3500D p.41: PSR situation table modifiers use the printed target numbers',
  'CAT3500D pp.42-43: all six falling facings select the exact new hexside and hit-location arc',
  'CAT3500D p.43: dry falling damage matches tonnage, level and exact 5-point packets',
  'CAT3500D p.44 + errata v8.01: accidental impact uses corrected standing/prone level and submersion matrix',
  'CAT3500D p.44: struck target random legal displacement and forbidden-hex destruction'
 ])assert(suite.includes("test('"+title+"'"),title);
});


test('CAT3500D p.48: Full Moon Night adds one movement point per ground-entered hex',()=>{
 const g=fresh(),from=g.tile(0,0),to=g.tile(1,0);
 for(const [type,depth] of [['plain',0],['woods',0],['heavy',0],['rough',0],['rubble',0],['water',1],['water',2]]){
  Object.assign(from,{type:'plain',height:0,depth:0,surface:0,roadEdges:[]});
  Object.assign(to,{type,depth,height:-depth,surface:0,roadEdges:[]});
  g.weather.night=false;const ordinary=g.terrainCost(to,from);
  g.weather.night=true;
  assert.equal(g.terrainCost(to,from),ordinary+1,type+': one additional MP');
 }
 Object.assign(from,{type:'plain',roadEdges:[0],height:0,depth:0});
 Object.assign(to,{type:'woods',roadEdges:[3],height:0,depth:0});
 g.weather.night=false;assert.equal(g.terrainCost(to,from),1);
 g.weather.night=true;assert.equal(g.terrainCost(to,from),2);
});

test('CAT3500D p.48: Full Moon Night weapon penalty decreases at 20-point target heat thresholds',()=>{
 const g=fresh(),u=g.units[1],target=g.units[2];
 for(const tile of g.tiles)Object.assign(tile,{type:'plain',height:0,depth:0,surface:0});
 Object.assign(u,{q:0,r:0,facing:0,moveMode:'stand',heat:0});
 Object.assign(target,{q:2,r:0,facing:3,moveMode:'stand'});
 for(const heat of [0,1,19,20,21,39,40,41,60]){
  target.heat=heat;g.weather.night=false;
  const physicalBaseline=g.specialPhysicalTN(u,target,false);
  const baseline=g.preview(u.id,target.id,1);assert(baseline.legal);
  g.weather.night=true;
  const moon=g.preview(u.id,target.id,1);
  const modifier=Math.max(0,2-Math.floor(heat/20));
  assert(moon.legal);
  assert.equal(moon.mods.night,modifier,'heat '+heat);
  assert.equal(moon.targetNumber-baseline.targetNumber,modifier,'heat '+heat);
  assert.equal(g.specialPhysicalTN(u,target,false),physicalBaseline,
   'night penalties must never affect physical attacks');
 }
});

test('CAT3500D p.48: Strong Gale modifies missiles and ballistic weapons but not energy fire',()=>{
 const g=fresh(),u=g.units[1],target=g.units[2];
 for(const tile of g.tiles)Object.assign(tile,{type:'plain',height:0,depth:0,surface:0});
 Object.assign(u,{q:0,r:0,facing:0,moveMode:'stand'});
 Object.assign(target,{q:2,r:0,facing:3,moveMode:'stand'});
 for(const [index,kind,modifier] of [[0,'AC/5',1],[1,'Medium Laser',0],[2,'SRM 6',2]]){
  assert.equal(u.weapons[index].name,kind);
  g.weather.gale=false;const baseline=g.preview(u.id,target.id,index);assert(baseline.legal,kind);
  g.weather.gale=true;const gale=g.preview(u.id,target.id,index);assert(gale.legal,kind);
  assert.equal(gale.mods.wind,modifier,kind);
  assert.equal(gale.targetNumber-baseline.targetNumber,modifier,kind);
 }
 const machineGun=g.units[3].weapons.find(w=>w.name==='Machine Gun A');
 assert(machineGun,'Default Thunderbolt must expose a machine gun');
 u.weapons[1]={...machineGun,location:'RA'};
 g.weather.gale=false;const calmMG=g.preview(u.id,target.id,1);
 g.weather.gale=true;const windyMG=g.preview(u.id,target.id,1);
 assert(calmMG.legal&&windyMG.legal);
 assert.equal(windyMG.mods.wind,1);
 assert.equal(windyMG.targetNumber-calmMG.targetNumber,1);
});

test('CAT3500D p.48: Strong Gale adds one to Piloting Skill Roll modifiers',()=>{
 const g=fresh(),u=g.units[1];
 for(const gyroHits of [0,1,2])for(const actuatorDamage of [false,true]){
  u.gyroHits=gyroHits;u.actuators.LL.lower=actuatorDamage;
  g.weather.gale=false;const baseline=g.psrMod(u);
  g.weather.gale=true;assert.equal(g.psrMod(u),baseline+1,
   'gyro '+gyroHits+' lower actuator '+actuatorDamage);
  assert.equal(g.psrMod(u,true),baseline+1);
 }
});


test('CAT3500D p.45: both players roll 2D6 and winner chooses attacker or defender exactly once',()=>{
 for(const winner of [0,1])for(const role of ['attacker','defender'])for(const reroll of [false,true]){
  const g=fresh();assert(g.configureScenario('divide-and-conquer').ok);
  assert.equal(g.nextPhase().ok,false,'unresolved sides block Initiative');
  const dice=reroll?[...diceFor(7),...diceFor(7)]:[];
  dice.push(...diceFor(winner===0?12:2),...diceFor(winner===0?2:12));
  g.rng=()=>{assert(dice.length,'unexpected side roll');return dice.shift();};
  const decision=g.rollScenarioSides();
  assert(decision.ok);assert.equal(decision.winner,winner);
  assert.equal(decision.rolls.length,reroll?4:2);
  assert.equal(dice.length,0);
  assert.equal(g.rollScenarioSides().ok,false,'selection roll cannot repeat');
  assert.equal(g.chooseScenarioSide(1-winner,role).ok,false,'loser cannot choose');
  assert.equal(g.chooseScenarioSide(winner,'invalid').ok,false);
  const result=g.chooseScenarioSide(winner,role);assert(result.ok);
  assert.equal(result.attackerTeam,role==='attacker'?winner:1-winner);
  assert.equal(result.defenderTeam,1-result.attackerTeam);
  assert.equal(g.chooseScenarioSide(winner,role).ok,false,'role cannot change');
  assert.equal(g.configureScenario('trial-by-fire').ok,false,'scenario cannot change');
 }
 const g=fresh();
 assert.equal(g.configureScenario('other').ok,false);
 assert.equal(g.rollScenarioSides().ok,false);
 assert.equal(g.chooseScenarioSide(0,'attacker').ok,false);
});

test('CAT3500D p.47: Trial by Fire defender wins first-turn Initiative without dice',()=>{
 for(const defender of [0,1]){
  const g=fresh();assert(g.configureScenario('trial-by-fire').ok);
  const sides=[...diceFor(defender===0?12:2),...diceFor(defender===0?2:12)];
  g.rng=()=>{assert(sides.length);return sides.shift();};
  assert.equal(g.rollScenarioSides().winner,defender);
  assert(g.chooseScenarioSide(defender,'defender').ok);
  g.rng=()=>{throw Error('First-turn Initiative must not use dice');};
  assert(g.nextPhase().ok);assert.equal(g.initiativeWinner,defender);
  assert.deepEqual(g.phaseRolls,[]);
  assert.equal(g.activeTeam,1-defender,'initiative loser declares first');
  g.round=2;g.phase='initiative';g.queue=[];g.activeTeam=null;
  const turn=[...diceFor(defender===0?2:12),...diceFor(defender===0?12:2)];
  g.rng=()=>{assert(turn.length);return turn.shift();};
  assert(g.nextPhase().ok);assert.equal(g.initiativeWinner,1-defender);
  assert.equal(g.phaseRolls.length,2);assert.equal(turn.length,0);
 }
});

test('CAT3500D p.48: Divide and Conquer defender suffers -2 initiative for every roll and reroll',()=>{
 for(const defender of [0,1])for(const lateTurn of [false,true]){
  const g=fresh();assert(g.configureScenario('divide-and-conquer').ok);
  const sides=[...diceFor(defender===0?12:2),...diceFor(defender===0?2:12)];
  g.rng=()=>sides.shift();
  assert.equal(g.rollScenarioSides().winner,defender);
  assert(g.chooseScenarioSide(defender,'defender').ok);
  g.round=lateTurn?5:1;
  const raw=defender===0?[8,6]:[6,8];
  const dice=[...diceFor(raw[0]),...diceFor(raw[1]),
   ...diceFor(defender===0?12:2),...diceFor(defender===0?2:12)];
  g.rng=()=>{assert(dice.length,'unexpected Initiative roll');return dice.shift();};
  g.initiative();
  assert.equal(g.phaseRolls.length,4,'tie after modifier requires reroll');
  assert.deepEqual(g.phaseRolls.map(r=>r.scenarioModifier),
   defender===0?[-2,0,-2,0]:[0,-2,0,-2]);
  assert.deepEqual(g.phaseRolls.slice(0,2).map(r=>r.adjustedTotal),
   [raw[0]-(defender===0?2:0),raw[1]-(defender===1?2:0)]);
  assert.equal(g.phaseRolls[0].adjustedTotal,g.phaseRolls[1].adjustedTotal);
  assert.equal(g.initiativeWinner,defender);
  assert.equal(g.activeTeam,1-defender);
  assert.equal(dice.length,0);
 }
 const ordinary=fresh();const dice=[...diceFor(8),...diceFor(6)];
 ordinary.rng=()=>dice.shift();ordinary.initiative();
 assert.equal(ordinary.initiativeWinner,0);
 assert.equal(ordinary.phaseRolls[0].scenarioModifier,undefined);
});

test('CAT3500D p.48: Full Moon Night jump MP pays one surcharge per hex both on map and entry',()=>{
 for(const night of [false,true]){
  const g=fresh(),u=g.units[0];
  for(const tile of g.tiles)Object.assign(tile,{type:'plain',depth:0,height:0,surface:0});
  Object.assign(u,{q:0,r:0,facing:0,jump:5,jumpLost:0,moveStart:{q:0,r:0},proneAtStart:false});
  g.phase='move';g.queue=[0,1];g.activeTeam=0;g.weather.night=night;
  const routes=g.reachable(u,'jump'),cost=night?4:2;
  assert(routes.some(p=>p.q===2&&p.r===0&&p.cost===cost),'two-hex jump MP');
  assert.equal(routes.some(p=>p.q===3&&p.r===0),!night);
  assert(routes.every(p=>p.cost<=5));
  assert(g.move(u.id,2,0,'jump').ok);
  assert.equal(u.spent,cost);
  assert.equal(u.pendingHeat,3,'night MP costs do not increase jump heat');
  assert.equal(u.distanceMoved,2,'TMM uses travelled hexes');
 }
 for(const night of [false,true]){
  const g=standardSetupGame(0),u=g.units.find(x=>g.canAct(x));
  u.jump=5;u.jumpLost=0;u.proneAtStart=false;g.weather.night=night;
  const routes=g.reachable(u,'jump'),step=night?2:1;
  const candidate=routes.find(p=>p.cost===2*step);
  assert(candidate,'a two-hex first-board-entry jump must be reachable');
  assert.equal(routes.some(p=>p.cost===3*step),!night,'first full hex costs MP');
  assert(g.move(u.id,candidate.q,candidate.r,'jump').ok);
  assert.equal(u.spent,2*step);
  assert.equal(u.distanceMoved,2);
  assert.equal(u.pendingHeat,3);
 }
});


const scenarioVictoryFixture=(name)=>{
 const g=fresh();
 assert(g.configureScenario(name).ok);
 g.scenario.sideRollWinner=0; // Side-roll transaction is exercised separately above.
 assert(g.chooseScenarioSide(0,'attacker').ok);
 return g;
};

test('CAT3500D pp.46,48: crippling is leg loss, all destroyed weapons, destroyed gyro or two engine hits',()=>{
 const g=scenarioVictoryFixture('final-exam'),u=g.units[2];
 assert.equal(g.scenarioCrippled(u),false);
 u.unconscious=true;u.shutdown=true;
 u.weapons.forEach(w=>{if(w.ammo!==null)w.ammo=0;});
 assert.equal(g.scenarioCrippled(u),false,'pilot state and empty ammo do not mean destroyed weapons');
 u.unconscious=false;u.shutdown=false;
 for(const [mutation,label] of [
  [x=>x.structure.LL=0,'left leg'],
  [x=>x.structure.RL=0,'right leg'],
  [x=>x.gyroHits=2,'destroyed gyro'],
  [x=>x.engineHits=2,'two engine criticals'],
  [x=>x.weapons.forEach(w=>w.destroyed=true),'all weapons destroyed']
 ]){
  const v=structuredClone(u);mutation(v);
  assert.equal(g.scenarioCrippled(v),true,label);
 }
 const one=structuredClone(u);one.weapons.slice(1).forEach(w=>w.destroyed=true);
 assert.equal(g.scenarioCrippled(one),false,'one surviving weapon is enough');
 const ignored=structuredClone(u);ignored.notFielded=true;
 assert.equal(g.scenarioCrippled(ignored),false,'unused roster slot is not an enemy');
});

test('CAT3500D pp.46,48: Final Exam and Divide and Conquer resolve cripple victory without requiring destruction',()=>{
 for(const scenario of ['final-exam','divide-and-conquer']){
  const g=scenarioVictoryFixture(scenario);
  g.units[2].engineHits=2;g.checkWin();assert.equal(g.winner,null,scenario);
  g.units[3].engineHits=2;g.checkWin();assert.equal(g.winner,0,scenario);
  const draw=scenarioVictoryFixture(scenario);
  for(const u of draw.units)u.gyroHits=2;
  draw.checkWin();assert.equal(draw.winner,'draw',scenario);
 }
 const normal=fresh();normal.units[2].engineHits=2;normal.units[3].engineHits=2;
 normal.checkWin();assert.equal(normal.winner,null,'ordinary skirmish still uses destruction');
});

test('CAT3500D p.47: Trial by Fire objective requires one defender, not an arbitrary two-versus-two game',()=>{
 const invalid=scenarioVictoryFixture('trial-by-fire');
 invalid.destroyMech(invalid.units[2]);invalid.checkWin();
 assert.equal(invalid.winner,null,'two defender units cannot masquerade as the printed lone BattleMaster');
 for(const outcome of ['attacker','defender','both']){
  const g=scenarioVictoryFixture('trial-by-fire');
  g.units[3].notFielded=true;g.units[3].dead=true;
  if(outcome==='attacker'||outcome==='both')g.destroyMech(g.units[2]);
  if(outcome==='defender'||outcome==='both')
   for(const u of g.units.filter(x=>x.team===0))g.destroyMech(u);
  g.checkWin();
  assert.equal(g.winner,{attacker:0,defender:1,both:'draw'}[outcome],outcome);
 }
});

test('CAT3500D pp.46-48: voluntary exit must be a legal movement order from the correct map edge',()=>{
 for(const scenario of ['final-exam','divide-and-conquer','trial-by-fire']){
  const g=scenarioVictoryFixture(scenario),defender=g.units[2];
  if(scenario==='trial-by-fire'){g.units[3].notFielded=true;g.units[3].dead=true;}
  g.phase='move';g.queue=[1,0];g.activeTeam=1;
  assert.equal(g.exitScenarioMap(defender.id,3,'walk').ok,false,'cannot teleport to an edge');
  Object.assign(defender,{q:6,r:0,moveMode:'stand',spent:0});
  assert.equal(g.exitScenarioMap(defender.id,0,'walk').ok,false,'wrong edge claim rejected');
  const result=g.exitScenarioMap(defender.id,3,'walk');
  assert(result.ok,scenario);assert.equal(defender.dead,true);
  assert.equal(defender.escaped,true);
  assert.equal(defender.safeScenarioExit,scenario==='trial-by-fire');
  assert.equal(result.destroyed,scenario!=='trial-by-fire');
  assert.equal(g.winner,scenario==='trial-by-fire'?1:null);
  assert.equal(g.exitScenarioMap(defender.id,3,'walk').ok,false,'cannot exit twice');
 }
 const bad=scenarioVictoryFixture('trial-by-fire'),u=bad.units[2];
 bad.units[3].notFielded=true;bad.units[3].dead=true;
 Object.assign(u,{q:-6,r:0});
 bad.phase='move';bad.queue=[1,0];bad.activeTeam=1;
 assert(bad.exitScenarioMap(u.id,0,'walk').ok);
 assert.equal(bad.winner,0,'wrong-edge defender is destroyed and attackers win');
 const blocked=scenarioVictoryFixture('trial-by-fire'),v=blocked.units[2];
 Object.assign(v,{q:6,r:0,spent:blocked.mp(v,'walk')});
 blocked.phase='move';blocked.queue=[1,0];blocked.activeTeam=1;
 assert.equal(blocked.exitScenarioMap(v.id,3,'walk').ok,false,'no movement points left');
 const none=fresh();none.phase='move';none.queue=[0,1];none.activeTeam=0;none.units[0].q=6;none.units[0].r=0;
 assert.equal(none.exitScenarioMap(0,3,'walk').ok,false,'ordinary battles cannot use scenario exit');
});

test('CAT3500D p.47: forced displacement east lets Trial defender escape, other edges destroy it',()=>{
 for(const [q,dir,expected] of [[6,0,1],[-6,3,0]]){
  const g=scenarioVictoryFixture('trial-by-fire');
  g.units[3].notFielded=true;g.units[3].dead=true;
  const u=g.units[2];Object.assign(u,{q,r:0});
  assert.equal(g.displace(u,dir),true);
  assert.equal(u.dead,true);
  assert.equal(u.safeScenarioExit,expected===1);
  g.checkWin();assert.equal(g.winner,expected);
 }
});


test('CAT3500D pp.45-48 plus errata v8.01: printed scenario manifests carry exact sheets, forces and pilot skills',async()=>{
 const {AGOAC_PRINTED_SCENARIOS:s}=await import('../dist/engine.js');
 assert.deepEqual(Object.keys(s),['final-exam','trial-by-fire','divide-and-conquer']);
 assert.deepEqual(Object.values(s).map(x=>x.sheets.map(y=>y.name)),[
  ['Desert #3','Grassland #2'],['Desert #2','Grassland #3'],['Desert #2','Grassland #3']
 ]);
 assert.deepEqual(Object.values(s).map(x=>[x.defender.length,x.attacker.length]),[[4,4],[1,3],[6,4]]);
 const tuples=x=>x.map(u=>[u.pilot,u.variant,u.piloting,u.gunnery,u.lance??null]);
 assert.deepEqual(tuples(s['final-exam'].defender),[
  ['Horace','CPLT-C1',5,4,null],['Winston','LCT-1V',5,4,null],
  ['Johansson','COM-2D',5,4,null],['Rodriguez','SHD-2H',5,4,null]]);
 assert.deepEqual(tuples(s['final-exam'].attacker),[
  ['Pushkin','CPLT-C1',5,4,null],['Shotugama','LCT-1V',5,4,null],
  ['Armstrong','COM-2D',5,4,null],['Keenan','SHD-2H',5,4,null]]);
 assert.deepEqual(tuples(s['trial-by-fire'].defender),[['Thompson','BLR-1G',5,4,null]]);
 assert.deepEqual(tuples(s['trial-by-fire'].attacker),[
  ['Hoffmann','WVR-6M',5,5,null],['Adjani','LCT-1V',6,5,null],['Lucas','COM-3A',6,5,null]]);
 assert.deepEqual(tuples(s['divide-and-conquer'].defender),[
  ['Blake','CPLT-K2',3,2,'command'],['Petersen','TDR-5S',4,3,'command'],
  ['Lee','SHD-2H',5,4,'command'],['Alvarez','LCT-1V',4,4,'recon'],
  ['Theissen','COM-3A',5,4,'recon'],['Jones','COM-2D',5,4,'recon']]);
 assert.deepEqual(tuples(s['divide-and-conquer'].attacker),[
  ['Seymore','AWS-8Q',3,3,null],['Marks','TDR-5SE',5,4,null],
  ['Kanazawa','WVR-6M',4,3,null],["O'Rourke",'GRF-1N',4,3,null]]);
 for(const x of Object.values(s)){
  assert(Object.isFrozen(x)&&Object.isFrozen(x.sheets));
  assert(x.sheets.every(Object.isFrozen));
  assert(Object.isFrozen(x.attacker)&&Object.isFrozen(x.defender));
  assert(x.attacker.concat(x.defender).every(Object.isFrozen));
  assert.equal(x.exactMapImplemented,false);
  assert.equal(x.exactRecordSheetsImplemented,false);
 }
});

const sourceRectScenario=(id)=>{
 const g=fresh();
 assert(g.configureRectangularSheets('horizontal',[
  {id:'clear',rotation:0},{id:'clear',rotation:0}]).ok);
 assert(g.configureScenario(id).ok);
 g.scenario.sideRollWinner=0;
 assert(g.chooseScenarioSide(0,'attacker').ok);
 return g;
};
const rectAt=(g,column,row)=>g.tiles.find(t=>t.q+Math.floor(t.r/2)===column&&t.r===row);

test('CAT3500D pp.45-48: corrected geometric scenario zones constrain opposing edges, clear level-0 and two defender lances',()=>{
 const final=sourceRectScenario('final-exam');
 const cols=final.tiles.map(t=>t.q+Math.floor(t.r/2));
 const west=Math.min(...cols),east=Math.max(...cols);
 const is=(g,team,c,row,options={})=>{
  const t=rectAt(g,c,row);
  assert(t,'fixture position exists');
  return g.scenarioZoneAllowed(team,t.q,t.r,options);
 };
 assert(is(final,1,west,0));
 assert(is(final,0,east,0));
 assert(!is(final,1,west+1,0));
 assert(!is(final,0,east-1,0));
 assert(!is(final,0,west,0));
 assert(!is(final,1,east,0));
 assert(!is(final,1,west,0,{facing:6}));
 const trial=sourceRectScenario('trial-by-fire');
 assert(is(trial,0,east-6,0),'attack within six eastern hexes');
 assert(!is(trial,0,east-7,0));
 assert(is(trial,1,west+3,0));
 assert(!is(trial,1,west+4,0));
 const attackerHex=rectAt(trial,east-6,0);
 attackerHex.type='woods';
 assert(!is(trial,0,east-6,0),'attacker requires Clear Level 0');
 attackerHex.type='plain';attackerHex.height=1;
 assert(!is(trial,0,east-6,0),'attacker level zero');
 const defenderHex=rectAt(trial,west+3,0);
 defenderHex.type='woods';
 assert(is(trial,1,west+3,0),'defender need not be on clear ground');
 const divide=sourceRectScenario('divide-and-conquer');
 assert(is(divide,1,west+6,-8+6,{lance:'command'}));
 assert(!is(divide,1,west+7,-8+6,{lance:'command'}));
 assert(!is(divide,1,west+6,-8+7,{lance:'command'}));
 assert(is(divide,1,east-6,8-6,{lance:'recon'}));
 assert(!is(divide,1,east-7,8-6,{lance:'recon'}));
 assert(!is(divide,1,east-6,8-7,{lance:'recon'}));
 assert(!is(divide,1,west+6,-8+6,{lance:'recon'}));
 assert(!is(divide,1,west+6,-8+6));
 assert(!is(divide,0,east,0),'printed 1510-1517 attacker rows not inferred');
 const noMap=fresh();assert(noMap.configureScenario('final-exam').ok);
 noMap.scenario.sideRollWinner=0;assert(noMap.chooseScenarioSide(0,'attacker').ok);
 assert(!noMap.scenarioZoneAllowed(1,-6,0),'synthetic hex preset is not printed rectangular map');
});

test('CAT3500D p.46: Trial by Fire inflicts exactly four front 5-point hits, rerolls head, never rolls criticals',()=>{
 const g=fresh();assert(g.configureScenario('trial-by-fire').ok);
 g.scenario.sideRollWinner=0;assert(g.chooseScenarioSide(0,'attacker').ok);
 const u=g.units[2];g.units[3].notFielded=true;g.units[3].dead=true;
 assert.equal(g.applyTrialByFirePreDamage(u.id).ok,false,'no stand-in Shadow Hawk may replace BattleMaster');
 Object.assign(u,{name:'BattleMaster',variant:'BLR-1G',phaseDamage:0});
 u.armor.CT=0;const originalStructure=u.structure.CT;
 const before=structuredClone(u.armor),wanted=[2,12,4,6,8],dice=wanted.flatMap(diceFor);
 g.rng=()=>{assert(dice.length);return dice.shift();};
 g.criticalHit=()=>{throw Error('critical dice prohibited by printed mission');};
 const result=g.applyTrialByFirePreDamage(u.id);assert(result.ok);
 assert.equal(dice.length,0);
 assert.equal(result.rolls.length,5,'one head reroll');
 assert.deepEqual(result.hits.map(x=>x.location),['CT','RA','RT','LT']);
 assert.deepEqual(result.hits.map(x=>x.damage),[5,5,5,5]);
 assert.equal(u.structure.CT,originalStructure-5);
 assert.equal(u.armor.RA,before.RA-5);
 assert.equal(u.armor.RT,before.RT-5);
 assert.equal(u.armor.LT,before.LT-5);
 assert.equal(u.phaseDamage,0,'pre-battle damage must not trigger phase PSR');
 assert.equal(u.pilotWounds,0);
 assert.equal(g.scenario.preDamageApplied,true);
 assert.equal(g.applyTrialByFirePreDamage(u.id).ok,false,'pre-existing damage applies once');
 const other=fresh();assert.equal(other.applyTrialByFirePreDamage(other.units[2].id).ok,false);
});


const cardScenarioFixture=()=>{
 const g=new Game({rng:()=>.5});
 assert(g.configureScenario('final-exam').ok);
 g.scenario.sideRollWinner=0;
 assert(g.chooseScenarioSide(0,'attacker').ok);
 const cards=[
  {team:0,unitId:0,cardId:'Alpha',cost:2,gunnery:2,piloting:4},
  {team:1,unitId:2,cardId:'Beta',cost:2,gunnery:3,piloting:3}
 ];
 const mirrors=[{sourceTeam:0,unitId:3},{sourceTeam:1,unitId:1}];
 return {g,cards,mirrors};
};

test('CAT3500D p.48: equal-cost MechWarrior Cards replace pilot values and mirror improvement to opponent',()=>{
 const {g,cards,mirrors}=cardScenarioFixture();
 const original=g.units.map(u=>[u.gunnery,u.piloting]);
 const result=g.configureScenarioCards({cards,mirrors,agreedCost:2});
 assert(result.ok);assert.equal(result.cost,2);assert.equal(result.die,null);
 assert.deepEqual(g.units.map(u=>[u.gunnery,u.piloting]),[
  [2,4],[original[1][0]-1,original[1][1]-2],
  [3,3],[original[3][0]-2,original[3][1]-1]
 ]);
 assert.deepEqual(result.bonuses,[
  {sourceTeam:0,unitId:3,gunnery:2,piloting:1},
  {sourceTeam:1,unitId:1,gunnery:1,piloting:2}
 ]);
 assert.equal(g.units[0].scenarioCard.id,'Alpha');
 assert.equal(g.units[2].scenarioCard.id,'Beta');
 assert.equal(g.configureScenarioCards({cards,mirrors,agreedCost:2}).ok,false,'cannot reapply');
 const invalid=cardScenarioFixture();
 assert.equal(invalid.g.configureScenarioCards({cards:[cards[0],{...cards[1],team:0}],mirrors,agreedCost:2}).ok,false);
 assert.equal(invalid.g.configureScenarioCards({cards:[cards[0],{...cards[1],cost:1}],mirrors,agreedCost:2}).ok,false);
 assert.equal(invalid.g.configureScenarioCards({cards,mirrors:[{sourceTeam:0,unitId:2},mirrors[1]],agreedCost:2}).ok,false);
 assert.equal(invalid.g.configureScenarioCards({cards,mirrors,agreedCost:1}).ok,false);
 assert(invalid.g.configureScenarioCards({cards,mirrors,agreedCost:2}).ok,'invalid requests do not mutate state');
});

test('CAT3500D p.48: card-cost disagreement uses exactly one D6 and floor(D6/2)',()=>{
 for(let die=1;die<=6;die++){
  const {g,cards,mirrors}=cardScenarioFixture();
  for(const c of cards)c.cost=Math.floor(die/2);
  const dice=[(die-.5)/6];g.rng=()=>{assert(dice.length);return dice.shift();};
  const result=g.configureScenarioCards({cards,mirrors});
  assert(result.ok);assert.equal(result.cost,Math.floor(die/2));
  assert.equal(result.die,die);assert.equal(g.phaseRolls.at(-1).dice.length,1);
  assert.equal(dice.length,0);
 }
 const {g,cards,mirrors}=cardScenarioFixture();
 const before=JSON.stringify(g.units);g.rng=()=>.99;
 const miss=g.configureScenarioCards({cards,mirrors});
 assert.equal(miss.ok,false);assert.equal(miss.chosenCost,3);
 assert.equal(JSON.stringify(g.units),before,'mismatch must not mutate units');
 assert.equal(g.scenario.cardSetup,undefined);
 assert.deepEqual(g.scenario.cardCostRoll,{die:6,cost:3});
 g.rng=()=>{throw Error('Cannot reroll an already settled card cost');};
 assert(g.configureScenarioCards({cards:cards.map(c=>({...c,cost:3})),mirrors}).ok);
});

const looseSheetFixture=()=>{
 const {g}=cardScenarioFixture();
 assert(g.configureRectangularSheets('horizontal',[
  {id:'clear',rotation:0},{id:'clear',rotation:0}]).ok);
 return g;
};
const atSheetCoord=(g,col,row)=>g.tiles.find(t=>
 t.q+Math.floor(t.r/2)+Math.floor(g.setupMap.width/2)===col&&
 t.r+Math.floor(g.setupMap.height/2)===row);

test('CAT3500D p.48: each 16x17 mapsheet has its own two-hex exclusion zone',()=>{
 const g=looseSheetFixture();
 for(const [col,row,expected]of [
  [0,8,false],[1,8,false],[2,8,false],[3,8,true],
  [12,8,true],[13,8,false],[15,8,false],[16,8,false],
  [18,8,false],[19,8,true],[28,8,true],[29,8,false],
  [8,0,false],[8,1,false],[8,2,false],[8,3,true],
  [8,13,true],[8,14,false],[24,2,false],[24,3,true],
  [24,13,true],[24,14,false]
 ]){
  const t=atSheetCoord(g,col,row);
  assert(t,'sheet coordinate exists');
  assert.equal(g.looseTerrainZoneAllowed(t.q,t.r),expected,col+','+row);
 }
 const normal=cardScenarioFixture().g;
 assert.equal(normal.looseTerrainZoneAllowed(0,0),false);
});

test('CAT3500D p.48: optional terrain requires equal pieces, alternate one each and 3 empty hexes between',()=>{
 const g=looseSheetFixture(),dice=[(4-.5)/6];
 g.rng=()=>{assert(dice.length);return dice.shift();};
 const begin=g.startScenarioLooseTerrain({piecesPerTeam:2});
 assert(begin.ok);assert.equal(begin.firstTeam,1);assert.equal(begin.roll,4);
 const put=(team,col,row)=>{
  const t=atSheetCoord(g,col,row);assert(t);
  return g.placeScenarioLooseTerrain({team,q:t.q,r:t.r,label:'woods'});
 };
 assert.equal(put(0,5,8).ok,false,'not the starting player');
 assert(put(1,5,8).ok);
 assert.equal(put(1,11,8).ok,false,'one at a time');
 assert.equal(put(0,8,8).ok,false,'distance of three leaves only two intervening hexes');
 assert(put(0,9,8).ok,'four-hex separation legal');
 assert(put(1,19,8).ok);
 const before=JSON.stringify(g.scenario.looseTerrain);
 assert.equal(put(0,17,8).ok,false,'inner seam boundary still counts');
 assert.equal(JSON.stringify(g.scenario.looseTerrain),before);
 assert(put(0,24,8).ok);
 assert.deepEqual(g.scenario.looseTerrain.pieces.map(x=>x.team),[1,0,1,0]);
 assert(g.scenario.looseTerrain.complete);
 assert.equal(g.scenario.looseTerrain.nextTeam,null);
 assert.equal(g.scenario.looseTerrain.visualAssetsLoaded,false,
  'punch-out graphics and terrain effects not silently invented');
 assert.equal(put(1,28,9).ok,false,'quota complete');
 assert.equal(g.startScenarioLooseTerrain({piecesPerTeam:2}).ok,false);
 const bad=looseSheetFixture();
 assert.equal(bad.startScenarioLooseTerrain({piecesPerTeam:0}).ok,false);
 assert(bad.startScenarioLooseTerrain({piecesPerTeam:1,startingTeam:0}).ok);
 assert.equal(bad.scenario.looseTerrain.roll,null);
});



test('CAT3500D p.48: multi-hex terrain-piece footprints are connected and keep three empty hexes across all edges',()=>{
 const g=looseSheetFixture();
 assert(g.startScenarioLooseTerrain({piecesPerTeam:1,startingTeam:0}).ok);
 const at=(col,row)=>{const tile=atSheetCoord(g,col,row);assert(tile);return tile;};
 const place=(team,col,row,footprint)=>g.placeScenarioLooseTerrain({
  team,...at(col,row),label:'woods',footprint
 });
 const snapshot=()=>JSON.stringify(g.scenario.looseTerrain);
 const initial=snapshot();
 assert.equal(place(0,5,8,[{q:0,r:0},{q:0,r:0}]).ok,false,'duplicate occupied hex');
 assert.equal(place(0,5,8,[{q:0,r:0},{q:2,r:0}]).ok,false,'disconnected piece');
 assert.equal(place(0,5,8,[{q:1,r:0}]).ok,false,'missing origin');
 assert.equal(place(0,12,8,[{q:0,r:0},{q:1,r:0}]).ok,false,'each hex must avoid sheet edge');
 assert.equal(snapshot(),initial,'invalid piece requests never mutate turn or quota');
 assert(place(0,5,8,[{q:0,r:0},{q:1,r:0}]).ok);
 const afterFirst=snapshot();
 assert.equal(place(1,9,8,[{q:0,r:0}]).ok,false,
  'distance three from second cell leaves only two intervening hexes');
 assert.equal(snapshot(),afterFirst);
 assert(place(1,10,8,[{q:0,r:0},{q:1,r:0}]).ok,
  'at least four-hex separation between all occupied cells is allowed');
 assert.deepEqual(g.scenario.looseTerrain.pieces.map(p=>p.hexes.length),[2,2]);
 assert.equal(g.scenario.looseTerrain.complete,true);
 assert.equal(g.scenario.looseTerrain.visualAssetsLoaded,false,
  'actual punch-out artwork and terrain effects are not fabricated');
});

test('CAT3500D p.48: D6 chooses alternating terrain starter exactly once for all six faces',()=>{
 for(let face=1;face<=6;face++){
  const g=looseSheetFixture();
  let calls=0;
  g.rng=()=>{calls++;return (face-.5)/6;};
  const result=g.startScenarioLooseTerrain({piecesPerTeam:1});
  assert(result.ok);
  assert.equal(calls,1,'no tie reroll needed for a single D6');
  assert.equal(result.roll,face);
  assert.equal(result.firstTeam,(face-1)%2);
 }
});

test('CAT3500D p.48: source printed scenarios require finishing optional terrain before placing Mechs',async()=>{
 const {prepareAgoacPrintedScenario}=await import('../apps/api/src/agoac-scenario-setup.mjs');
 const g=fresh();
 assert(g.configureScenario('final-exam').ok);
 g.scenario.sideRollWinner=0;
 assert(g.chooseScenarioSide(0,'attacker').ok);
 prepareAgoacPrintedScenario(g,'final-exam');
 assert(g.startScenarioLooseTerrain({piecesPerTeam:1,startingTeam:0}).ok);
 assert.match(g.nextPhase().error,/местности/,
  'initiative cannot bypass unfinished loose terrain setup');
 assert.equal(beginPrintedScenarioTest(g).ok,false,
  'placement must not begin while optional terrain is incomplete');
 const west=atSheetCoord(g,5,8),east=atSheetCoord(g,25,8);
 assert(g.placeScenarioLooseTerrain({team:0,q:west.q,r:west.r,label:'woods'}).ok);
 assert(g.placeScenarioLooseTerrain({team:1,q:east.q,r:east.r,label:'rough'}).ok);
 assert(g.scenario.looseTerrain.complete);
 assert(beginPrintedScenarioTest(g).ok);
 assert.equal(g.placeScenarioLooseTerrain({team:0,q:west.q,r:west.r,label:'woods'}).ok,false);
 assert.equal(g.startScenarioLooseTerrain({piecesPerTeam:1,startingTeam:0}).ok,false);
});

test('CAT3500D pp.46,48: exact alternative Final Exam chassis and shortened 6-defender vs 4-attacker scenario',async()=>{
 const {AGOAC_SCENARIO_VARIATIONS:variants,AGOAC_PRINTED_SCENARIOS:scenarios}=await import('../dist/engine.js');
 const s1=variants['final-exam'].alternateForces;
 assert.deepEqual(s1.defender,['TDR-5S','GRF-1N','LCT-1E','COM-2D']);
 assert.deepEqual(s1.attacker,['TDR-5SE','WVR-6R','LCT-1V','COM-3A']);
 assert.deepEqual(variants['final-exam'].terrainVariations,[
  'turn-sheets-180','join-short-sides','substitute-terrain']);
 const regular=scenarios['divide-and-conquer'];
 assert.equal(regular.defender.length,6);
 assert.equal(regular.attacker.length,4,'the original has just FOUR attackers; Trial by Fire pilots are NOT transferred');
 assert.deepEqual(regular.attacker.map(u=>u.pilot),['Seymore','Marks','Kanazawa',"O'Rourke"]);
 const reduced=variants['divide-and-conquer'].shortened;
 assert.deepEqual(reduced.defender.map(u=>u.variant),['CPLT-K2','TDR-5S','COM-3A','COM-2D']);
 assert.deepEqual(reduced.attacker.map(u=>u.variant),['AWS-8Q','WVR-6M','GRF-1N']);
 assert.deepEqual(reduced.removed.defender,['SHD-2H','LCT-1V']);
 assert.deepEqual(reduced.removed.attacker,['TDR-5SE']);
 assert(regular.defender.length===reduced.defender.length+2);
 assert(regular.attacker.length===reduced.attacker.length+1);
 assert(Object.isFrozen(reduced)&&Object.isFrozen(reduced.defender)&&
  Object.isFrozen(reduced.attacker)&&Object.isFrozen(variants));
 assert.equal(regular.exactRecordSheetsImplemented,false,'source manifests are not fabricated unit sheets');
});

test('CAT3500D p.48: shared defenders arbitrate by 2D6 with tie rerolls once PER phase',()=>{
 const g=fresh();
 assert(g.configureScenario('divide-and-conquer').ok);
 g.scenario.sideRollWinner=0;
 assert(g.chooseScenarioSide(0,'attacker').ok);
 assert.equal(g.configureSharedDefenderLances({
  commandController:'captain',reconController:'captain'}).ok,false);
 assert(g.configureSharedDefenderLances({commandController:'captain',reconController:'scout'}).ok);
 assert.equal(g.scenario.sharedLances.serverAuthorizationImplemented,false);
 assert.equal(g.configureSharedDefenderLances({commandController:'other',reconController:'scout'}).ok,false);
 const [commander,recon]=[g.units[2],g.units[3]];
 commander.lance='command';recon.lance='recon';
 g.phase='move';
 g.phaseRolls.push({kind:'existing attack roll',total:7});
 assert.equal(g.arbitrateSharedDefenderChoice({
  commandChoice:g.units[0].id,reconChoice:recon.id}).ok,false,'attacker cannot arbitrate');
 assert.equal(g.arbitrateSharedDefenderChoice({
  commandChoice:recon.id,reconChoice:commander.id}).ok,false,'cross-lance selection invalid');
 const dice=[...diceFor(6),...diceFor(6),...diceFor(4),...diceFor(12)];
 g.rng=()=>{assert(dice.length,'unexpected dice');return dice.shift();};
 const first=g.arbitrateSharedDefenderChoice({commandChoice:commander.id,reconChoice:recon.id});
 assert(first.ok);assert.equal(first.controller,'recon');assert.equal(first.unitId,recon.id);
 assert.equal(first.reused,false);assert.equal(first.rolls.length,4);
 assert.equal(g.phaseRolls[0].kind,'existing attack roll','arbitration preserves previous combat rolls');
 assert.equal(dice.length,0);
 g.rng=()=>{throw Error('same-phase dispute must NOT reroll');};
 const repeat=g.arbitrateSharedDefenderChoice({commandChoice:commander.id,reconChoice:recon.id});
 assert(repeat.ok);assert.equal(repeat.reused,true);
 assert.equal(repeat.controller,'recon');assert.equal(repeat.rolls.length,0);
 // The same winning player may select a different 'Mech later in the phase.
 const reserve=structuredClone(recon);reserve.id=g.units.length;reserve.lance='recon';
 g.units.push(reserve);
 const continuing=g.arbitrateSharedDefenderChoice({commandChoice:commander.id,reconChoice:reserve.id});
 assert(continuing.ok);assert.equal(continuing.reused,true);
 assert.equal(continuing.unitId,reserve.id);
 g.phase='fire';
 const fireDice=[...diceFor(12),...diceFor(2)];
 g.rng=()=>{assert(fireDice.length);return fireDice.shift();};
 const next=g.arbitrateSharedDefenderChoice({commandChoice:commander.id,reconChoice:recon.id});
 assert(next.ok);assert.equal(next.controller,'command');
 assert.equal(next.unitId,commander.id);
 assert.equal(fireDice.length,0);
 g.phase='physical';
 assert.equal(g.arbitrateSharedDefenderChoice({
  commandChoice:commander.id,reconChoice:recon.id}).ok,false);
 g.phase='move';g.round=2;
 const newRound=[...diceFor(2),...diceFor(12)];
 g.rng=()=>{assert(newRound.length);return newRound.shift();};
 const later=g.arbitrateSharedDefenderChoice({commandChoice:commander.id,reconChoice:recon.id});
 assert(later.ok);assert.equal(later.reused,false);
 assert.equal(later.controller,'recon');
 assert.equal(newRound.length,0);
});



// The positions below exercise engine geometry, not a transcription of
// the licensed p.47 diagram. A real game requires player confirmation.
const prepareScenario3IllustrationForTest=g=>{
 if(!g.scenario?.picturedTerrain?.required||g.scenario.picturedTerrain.confirmed)return;
 assert.equal(g.beginPrintedScenarioPlacement().ok,false,
  'Scenario 3 must not bypass the four mandatory die-cut figures');
 assert(g.startScenarioLooseTerrain({piecesPerTeam:2,startingTeam:0}).ok);
 const positions=[
  [0,5,5,'depth1',[{q:0,r:0},{q:1,r:0}]],
  [1,10,11,'level1',[{q:0,r:0},{q:1,r:0},{q:1,r:-1}]],
  [0,21,5,'depth2',[{q:0,r:0},{q:1,r:0}]],
  [1,26,11,'level2',[{q:0,r:0},{q:1,r:0},{q:1,r:-1}]]
 ];
 for(const [team,col,row,terrainType,footprint]of positions){
  const tile=g.tiles.find(t=>t.q+Math.floor(t.r/2)+Math.floor(g.setupMap.width/2)===col&&
   t.r+Math.floor(g.setupMap.height/2)===row);
  assert(tile,'fixture tile '+col+','+row);
  const placed=g.placeScenarioLooseTerrain({team,q:tile.q,r:tile.r,
   label:terrainType,terrainType,footprint});
  assert(placed.ok,placed.error);
 }
 const confirmed=g.confirmDivideAndConquerIllustratedTerrain({sourceDiagramReviewed:true});
 assert(confirmed.ok,confirmed.error);
};
const beginPrintedScenarioTest=g=>{
 prepareScenario3IllustrationForTest(g);
 return g.beginPrintedScenarioPlacement();
};

const printedDeploymentFixture=(name,sheets=[{id:'clear',rotation:0},{id:'clear',rotation:0}])=>{
 const g=fresh();
 assert(g.configureScenario(name).ok);
 g.scenario.sideRollWinner=0;
 assert(g.chooseScenarioSide(0,'attacker').ok);
 assert(g.configureRectangularSheets('horizontal',sheets).ok);
 const bases=g.units.map(u=>structuredClone(u));
 const manifest=AGOAC_PRINTED_SCENARIOS[name];
 const units=[];
 for(const [team,roster]of [[0,manifest.attacker],[1,manifest.defender]]){
  for(const pilot of roster){
   const unit=structuredClone(bases[team*2]);
   Object.assign(unit,{
    id:units.length,team,pilot:pilot.pilot,variant:pilot.variant,
    gunnery:pilot.gunnery,piloting:pilot.piloting,
    name:pilot.variant==='BLR-1G'?'BattleMaster BLR-1G':pilot.variant,
    lance:pilot.lance??null,dead:false,notFielded:false
   });
   units.push(unit);
  }
 }
 g.units=units;
 const get=(col,row)=>{
  const t=g.tiles.find(t=>t.q+Math.floor(t.r/2)+Math.floor(g.setupMap.width/2)===col&&
   t.r+Math.floor(g.setupMap.height/2)===row);
  assert(t,'mapsheet position '+col+','+row);
  return t;
 };
 const place=(id,col,row,facing=0)=>{const t=get(col,row);return g.placePrintedScenarioMech(id,t.q,t.r,facing);};
 return {g,place,get,defenders:g.units.filter(u=>u.team===1),
  attackers:g.units.filter(u=>u.team===0)};
};

test('CAT3500D pp.46-47: Final Exam alternates west defenders and east attackers before initiative',()=>{
 const {g,place,defenders,attackers}=printedDeploymentFixture('final-exam');
 const original=structuredClone(g.units);
 const wrong=printedDeploymentFixture('final-exam');
 wrong.g.units[0].variant='LCT-1E';
 assert.equal(wrong.beginPrintedScenarioTest(g).ok,false,'reject fabricated original force');
 assert.deepEqual(wrong.g.units.map(u=>u.deployed),original.map(u=>u.deployed),
  'invalid setup does not change roster');
 const started=beginPrintedScenarioTest(g);
 assert(started.ok);assert.equal(started.steps,8);
 assert.equal(started.exactMapImplemented,false);
 assert.equal(started.recordSheetsImported,false);
 assert.equal(g.nextPhase().ok,false,'initiative locked during placement');
 assert.equal(g.startStandardDeployment().ok,false,'cannot evade source order');
 assert.equal(g.configureSetupForces({slots:[0,1,2,3]}).ok,false);
 assert.equal(place(attackers[0].id,31,0).ok,false,'defender first');
 for(let i=0;i<4;i++){
  assert(place(defenders[i].id,0,i).ok,'defender west edge');
  if(i===0)assert.equal(place(attackers[i].id,0,i).ok,false,'attacker needs east edge');
  assert(place(attackers[i].id,31,i).ok,'attacker east edge');
 }
 assert.equal(g.scenario.placement.complete,true);
 assert.deepEqual(g.scenario.placement.placed.map(p=>p.team),[1,0,1,0,1,0,1,0]);
 assert.equal(g.scenario.placement.placed.length,8);
 assert.equal(g.placePrintedScenarioMech(attackers[0].id,31,0).ok,false,'cannot double place');
 const dice=[...diceFor(12),...diceFor(2)];
 g.rng=()=>{assert(dice.length);return dice.shift();};
 assert(g.nextPhase().ok,'initiative can run after all eight placements');
 assert.equal(g.phase,'move');assert.equal(dice.length,0);
});

test('CAT3500D p.47: Trial by Fire attacker-first clear/level-zero setup and defender-after deployment',()=>{
 const {g,place,get,defenders,attackers}=printedDeploymentFixture('trial-by-fire');
 assert(beginPrintedScenarioTest(g).ok);
 assert.equal(place(defenders[0].id,0,6).ok,false,'defender cannot deploy first');
 const invalid=get(25,5);invalid.type='woods';
 assert.equal(place(attackers[0].id,25,5).ok,false,'attacker needs Clear');
 invalid.type='plain';invalid.height=1;
 assert.equal(place(attackers[0].id,25,5).ok,false,'attacker needs Level 0');
 invalid.height=0;
 assert.equal(place(attackers[0].id,24,5).ok,false,'attacker too far west');
 assert(place(attackers[0].id,25,5,3).ok);
 assert.equal(place(attackers[1].id,25,5).ok,false,'occupied hex forbidden');
 assert(place(attackers[1].id,26,6,4).ok);
 assert(place(attackers[2].id,31,7,1).ok);
 assert.equal(place(defenders[0].id,4,8).ok,false,'defender must remain within three western hexes');
 assert(place(defenders[0].id,3,8,5).ok,'defender sets any facing');
 assert(g.scenario.placement.complete);
 assert.deepEqual(g.scenario.placement.placed.map(p=>p.team),[0,0,0,1]);
 assert.equal(g.nextPhase().ok,false,'printed four 5-point pre-damage strikes are mandatory');
 const pre=g.applyTrialByFirePreDamage(defenders[0].id);
 assert(pre.ok);assert.equal(pre.hits.length,4);
 assert(g.nextPhase().ok);
 assert.equal(g.initiativeWinner,1,'defender wins first-turn initiative automatically');
});

test('CAT3500D p.48 / errata v8.01: defenders first, attacker chooses one numbered row',()=>{
 const {g,place,defenders,attackers}=printedDeploymentFixture('divide-and-conquer');
 assert.equal(defenders.length,6);assert.equal(attackers.length,4);
 assert(beginPrintedScenarioTest(g).ok);
 assert.equal(g.scenario.placement.steps.length,10);
 assert.equal(g.chooseDivideAndConquerAttackerRow('east').ok,false,'no choice before both defender lances');
 assert.equal(place(attackers[0].id,31,15).ok,false,'attacker must wait for both defending lances');
 assert.equal(place(defenders[3].id,31,0).ok,false,'recon cannot replace first command lance');
 for(let k=0;k<3;k++)assert(place(defenders[k].id,k,k).ok,'command NW placements');
 for(let k=3;k<6;k++)assert(place(defenders[k].id,31-(k-3),16-(k-3)).ok,'recon SE placements');
 assert.deepEqual(g.scenario.placement.placed.map(p=>p.lance),
  ['command','command','command','recon','recon','recon']);
 assert.equal(place(attackers[0].id,31,15).ok,false,'no arbitrary attacker entry');
 assert.equal(g.nextPhase().ok,false,'cannot start before attacker placement');
 const east=g.divideAndConquerPrintedRow('east'),west=g.divideAndConquerPrintedRow('west');
 assert.deepEqual(east.map(h=>h.printedHex),[1510,1511,1512,1513,1514,1515,1516,1517]);
 assert.equal(east.length,8);assert.equal(west.length,8);
 assert.equal(g.chooseDivideAndConquerAttackerRow('north').ok,false,'no invented third zone');
 const choice=g.chooseDivideAndConquerAttackerRow('east');
 assert(choice.ok);assert.deepEqual(choice.hexes,east);
 assert.equal(g.chooseDivideAndConquerAttackerRow('west').ok,false,'no change or mixed deployment');
 assert.equal(g.scenarioZoneAllowed(0,west[0].q,west[0].r),false);
 assert.equal(g.placePrintedScenarioMech(attackers[0].id,west[0].q,west[0].r).ok,false);
 assert(g.placePrintedScenarioMech(attackers[0].id,east[0].q,east[0].r,5).ok);
 assert.equal(g.placePrintedScenarioMech(attackers[1].id,east[0].q,east[0].r).ok,false,'collision');
 for(let k=1;k<4;k++)assert(g.placePrintedScenarioMech(attackers[k].id,east[k].q,east[k].r,k).ok);
 assert(g.scenario.placement.complete);
 assert.equal(g.scenario.placement.exactMapImplemented,false,'authentic terrain not fabricated');
 assert.equal(g.scenario.placement.recordSheetsImported,false,'original unit sheets still absent');
 assert.equal(g.chooseDivideAndConquerAttackerRow('east').ok,false);
 g.rng=()=>0.96;
 assert(g.nextPhase().ok,'full ten-Mech placement permits first Initiative');
 assert.equal(g.phase,'move');
});

test('CAT3500D p.48: 1510–1517 mapsheet coordinates rotate independently by 180 degrees',()=>{
 for(const [westRot,eastRot,side,col,firstRow]of [
  [0,0,'west',14,9],[0,0,'east',30,9],
  [3,0,'west',1,7],[0,3,'east',17,7]
 ]){
  const {g}=printedDeploymentFixture('divide-and-conquer',[
   {id:'clear',rotation:westRot},{id:'clear',rotation:eastRot}
  ]);
  const hexes=g.divideAndConquerPrintedRow(side);
  assert.equal(hexes.length,8);
  for(const [k,h]of hexes.entries()){
   assert.equal(h.printedHex,1510+k);
   assert.equal(h.sheet,side);
   const tile=g.tile(h.q,h.r);
   assert.equal(tile.sheet,side==='west'?0:1);
   assert.equal(h.q+Math.floor(h.r/2)+16,col);
   assert.equal(h.r+8,firstRow+(firstRow===7?-k:k));
  }
  assert.equal(new Set(hexes.map(h=>h.q+','+h.r)).size,8);
 }
 const {g}=printedDeploymentFixture('final-exam');
 assert.deepEqual(g.divideAndConquerPrintedRow('east'),[],'no foreign-scenario row');
});

test('CAT3500D p.48: shared defender Initiative alternates by turn, not by tie reroll',()=>{
 const {g}=printedDeploymentFixture('divide-and-conquer');
 assert.equal(g.configureSharedDefenderLances({
  commandController:'captain',reconController:'scout',firstInitiativeController:'unknown'}).ok,false);
 assert(g.configureSharedDefenderLances({
  commandController:'captain',reconController:'scout',firstInitiativeController:'recon'}).ok);
 const first=[...diceFor(5),...diceFor(7),...diceFor(12),...diceFor(2)];
 g.rng=()=>{assert(first.length,'unexpected dice');return first.shift();};
 g.initiative();
 assert.equal(g.scenario.sharedLances.initiativeController,'recon');
 assert.equal(g.scenario.sharedLances.initiativeRound,1);
 assert.equal(g.phaseRolls.length,4,'one tied Initiative requires one reroll');
 for(const roll of [g.phaseRolls[1],g.phaseRolls[3]]){
  assert.equal(roll.defenderInitiativeController,'recon');
  assert.equal(roll.defenderInitiativePlayer,'scout');
  assert.equal(roll.scenarioModifier,-2);
 }
 assert.equal(first.length,0);
 for(const [round,expected,player]of [[2,'command','captain'],[3,'recon','scout']]){
  g.round=round;g.phase='initiative';
  const dice=[...diceFor(12),...diceFor(2)];
  g.rng=()=>{assert(dice.length);return dice.shift();};
  g.initiative();
  assert.equal(g.scenario.sharedLances.initiativeController,expected);
  assert.equal(g.scenario.sharedLances.initiativeRound,round);
  assert.equal(g.phaseRolls[1].defenderInitiativeController,expected);
  assert.equal(g.phaseRolls[1].defenderInitiativePlayer,player);
  assert.equal(g.phaseRolls[1].scenarioModifier,-2);
  assert.equal(dice.length,0);
 }
 assert.equal(g.scenario.sharedLances.serverAuthorizationImplemented,false);
});

test('CAT3500D pp.45-48: printed force comparison is order-independent and locale-aware',()=>{
 const {g}=printedDeploymentFixture('final-exam');
 const reversed=[...g.units].reverse().map((unit,i)=>({...unit,id:i}));
 g.units=reversed;
 const started=beginPrintedScenarioTest(g);
 assert(started.ok,'the same roster in a different order must remain legal');
 assert.equal(started.steps,8);
 const invalid=printedDeploymentFixture('divide-and-conquer');
 invalid.g.units[0].gunnery=1;
 assert.equal(invalid.beginPrintedScenarioTest(g).ok,false,
  'matching variants with unprinted pilot skills cannot bypass roster verification');
});


test('CAT3500D p.47: Trial by Fire chase places defender alone, reserves attackers through Turn 1',()=>{
 const {g,place,defenders,attackers}=printedDeploymentFixture('trial-by-fire');
 assert(g.configureTrialByFireChase().ok);
 assert.equal(g.nextPhase().ok,false,'chase cannot start without lone-defender placement');
 assert.equal(g.configureTrialByFireChase().ok,false,'no second chase setup');
 const start=beginPrintedScenarioTest(g);
 assert(start.ok);assert.equal(start.steps,1,'only the defender is placed before battle');
 assert.equal(g.scenario.placement.complete,false);
 assert.equal(place(attackers[0].id,0,7).ok,false,'attacker cannot deploy in chase setup');
 assert(place(defenders[0].id,3,8,5).ok);
 assert(g.scenario.placement.complete,'defender-only initial placement is complete');
 for(const u of attackers){
  assert.equal(u.deployed,false);
  assert.equal(u.scenarioArrivalRound,2);
  assert.equal(u.scenarioReserve,'trial-by-fire-chase');
 }
 assert.equal(g.nextPhase().ok,false,'pre-damage still mandatory in chase');
 assert(g.applyTrialByFirePreDamage(defenders[0].id).ok);
 attackers[0].heat=9;attackers[0].pendingHeat=2;
 assert(g.nextPhase().ok);
 assert.equal(g.phase,'move');assert.equal(g.round,1);
 assert.deepEqual(g.queue,[1],'only lone defender receives first-turn movement');
 assert.equal(g.canAct(attackers[0]),false);
 assert.equal(g.deploymentEntryRoutes(attackers[0],'walk').length,0);
 assert(g.hold(defenders[0].id).ok);
 assert(g.nextPhase().ok,'future attackers must not block first-turn movement');
 assert.equal(g.phase,'fire');assert.deepEqual(g.queue,[1],'no attacker weapons before turn two');
 assert(g.hold(defenders[0].id).ok);
 assert(g.nextPhase().ok);
 assert.equal(g.phase,'physical');assert.deepEqual(g.queue,[1]);
 assert(g.hold(defenders[0].id).ok);
 assert(g.nextPhase().ok);assert.equal(g.phase,'heat');
 assert(g.nextPhase().ok);assert.equal(g.phase,'end');
 assert.equal(attackers[0].heat,9,'off-board reserves do not overheat');
 assert.equal(attackers[0].pendingHeat,2,'off-board reserves keep their pending state');
 assert(g.nextPhase().ok);
 assert.equal(g.round,2);assert.equal(g.phase,'initiative');
 const dice=[...diceFor(12),...diceFor(2)];
 g.rng=()=>{assert(dice.length);return dice.shift();};
 assert(g.nextPhase().ok);
 assert.equal(dice.length,0);assert.equal(g.phase,'move');
 assert.equal(g.queue.filter(t=>t===0).length,3,'three attackers join the second-turn Movement queue');
 assert.equal(g.queue.filter(t=>t===1).length,1);
 g.activeTeam=0;g.actingId=null;
 const route=g.deploymentEntryRoutes(attackers[0],'walk').find(p=>p.cost===1);
 assert(route,'a full west-edge entry is available with one MP on clear ground');
 const western=g.deploymentEdgeTiles(0).some(t=>t.q===route.q&&t.r===route.r);
 assert(western,'route starts on the printed west edge');
 const enter=g.enterDeployment(attackers[0],route.q,route.r,'walk');
 assert(enter.ok);assert.equal(enter.entry,true);
 assert.equal(attackers[0].deployed,true);
 assert.equal(attackers[0].distanceMoved,1,'first full hex is the first movement hex');
 assert.equal(attackers[0].spent,1,'first full hex costs ordinary movement MP');
 assert.deepEqual(attackers[0].moveStart,route.entryFrom);
 assert.equal(g.enterDeployment(attackers[0],route.q,route.r,'walk').ok,false,'cannot enter twice');
 assert(g.hold(attackers[0].id).ok);
});

test('CAT3500D p.48: linked Final Exam survivors carry damage and ammo to defender reinforcements on Turn 5 west edge',()=>{
 const origin=printedDeploymentFixture('final-exam');
 const source=origin.g,sourceTeam=source.scenario.defenderTeam;
 const survivors=origin.defenders.slice(0,2),lost=origin.defenders[2];
 source.winner=sourceTeam;
 survivors[0].armor.CT-=7;
 survivors[0].rear.CT-=3;
 survivors[0].structure.LA-=1;
 survivors[0].crit.LA[0]=true;
 survivors[0].pilotWounds=1;
 survivors[0].heat=9;
 assert(survivors[0].bins.length,'source uses real engine ammo container');
 survivors[0].bins[0].shots=Math.max(0,survivors[0].bins[0].shots-4);
 survivors[1].gyroHits=1;
 lost.dead=true;
 const original=survivors.map(u=>structuredClone({
  armor:u.armor,rear:u.rear,structure:u.structure,crit:u.crit,bins:u.bins,
  pilotWounds:u.pilotWounds,heat:u.heat,gyroHits:u.gyroHits
 }));
 const target=printedDeploymentFixture('divide-and-conquer').g;
 assert.equal(target.configureLinkedScenarioReinforcements({
  sourceGame:source,sourceIds:[lost.id]}).ok,false,'destroyed units never reinforce');
 assert.equal(target.configureLinkedScenarioReinforcements({
  sourceGame:source,sourceIds:[survivors[0].id,survivors[0].id]}).ok,false,'no duplicate transfers');
 const result=target.configureLinkedScenarioReinforcements({
  sourceGame:source,sourceIds:survivors.map(u=>u.id)
 });
 assert(result.ok);assert.equal(result.arrivalRound,5);assert.equal(result.entryEdge,0);
 assert.equal(target.configureLinkedScenarioReinforcements({
  sourceGame:source,sourceIds:[survivors[0].id]}).ok,false,'cannot import a second time');
 assert.equal(target.scenario.campaign.damageCarried,true);
 assert.equal(target.scenario.campaign.exactMapImplemented,false);
 assert.equal(target.scenario.campaign.recordSheetsImported,false);
 const imported=result.unitIds.map(id=>target.unit(id));
 assert.equal(imported.length,2);
 for(let i=0;i<imported.length;i++){
  const u=imported[i],prior=original[i];
  assert.equal(u.team,target.scenario.defenderTeam);
  assert.equal(u.deployed,false);
  assert.equal(u.scenarioArrivalRound,5);
  assert.equal(u.scenarioReserve,'linked-scenario');
  for(const field of ['armor','rear','structure','crit','bins',
   'pilotWounds','heat','gyroHits'])assert.deepEqual(u[field],prior[field],
   field+' must carry source damage and ammunition');
 }
 const preview=printedDeploymentFixture('divide-and-conquer').g;
 const linked=preview.configureLinkedScenarioReinforcements({
  sourceGame:source,sourceIds:survivors.map(u=>u.id)
 });
 assert(linked.ok);
 const printed=beginPrintedScenarioTest(preview);
 assert(printed.ok,'campaign reserves must not invalidate the six-vs-four published setup');
 assert.equal(printed.steps,10);
 for(const id of linked.unitIds)assert.equal(preview.unit(id).deployed,false);
 assert.notEqual(imported[0].armor,survivors[0].armor,'campaign state is detached');
 const before=imported[0].armor.CT;survivors[0].armor.CT--;
 assert.equal(imported[0].armor.CT,before,'source cannot mutate registered reinforcement');
 target.phase='initiative';target.round=4;target.initiative();
 assert.equal(target.phase,'move');assert.equal(target.queue.length,10,'Turn 4 roster excludes both waiting reinforcements');
 target.activeTeam=target.scenario.defenderTeam;target.actingId=null;
 assert.equal(target.canAct(imported[0]),false,'reinforcement cannot act on Turn 4');
 assert.equal(target.deploymentEntryRoutes(imported[0],'walk').length,0);
 target.phase='heat';target.heatPhase();
 assert.equal(imported[0].heat,9,'waiting reinforcements do not cool or gain heat offboard');
 target.phase='end';target.endPhase();
 assert.equal(target.round,5);
 assert.equal(imported[0].heat,9);
 assert.equal(imported[0].armor.CT,before);
 target.phase='initiative';target.initiative();
 assert.equal(target.phase,'move');
 assert.equal(target.queue.length,12,'Turn 5 Movement includes both reinforcements');
 target.activeTeam=target.scenario.defenderTeam;target.actingId=null;
 const paths=target.deploymentEntryRoutes(imported[0],'walk');
 const route=paths.find(t=>t.cost===1);
 assert(route,'clear western edge offers a standard one-MP first-hex entry');
 assert(target.deploymentEdgeTiles(0).some(t=>t.q===route.q&&t.r===route.r));
 const entry=target.enterDeployment(imported[0],route.q,route.r,'walk');
 assert(entry.ok);assert.equal(entry.entry,true);
 assert.equal(imported[0].deployed,true);assert.equal(imported[0].spent,1);
 assert.equal(imported[0].distanceMoved,1);
 assert.deepEqual(imported[0].moveStart,route.entryFrom);
 assert.equal(imported[0].armor.CT,before);
 assert.deepEqual(imported[0].bins,original[0].bins);
 assert(target.hold(imported[0].id).ok,'reinforcement can complete normal Turn 5 movement');
});

test('CAT3500D pp.47-48: other scenarios and invalid campaign sources cannot claim scheduled reinforcements',()=>{
 const ordinary=fresh();
 assert.equal(ordinary.configureTrialByFireChase().ok,false);
 assert.equal(ordinary.configureLinkedScenarioReinforcements({}).ok,false);
 const trial=printedDeploymentFixture('trial-by-fire');
 const source=printedDeploymentFixture('final-exam');
 source.g.winner=source.g.scenario.defenderTeam;
 assert.equal(trial.g.configureLinkedScenarioReinforcements({
  sourceGame:source.g,sourceIds:[source.defenders[0].id]}).ok,false);
 const target=printedDeploymentFixture('divide-and-conquer');
 assert.equal(target.g.configureLinkedScenarioReinforcements({
  sourceGame:source.g,sourceIds:[source.attackers[0].id]}).ok,false,
 'default source team is Scenario 1 defender; cross-team imports are rejected');
 assert(target.g.configureLinkedScenarioReinforcements({
  sourceGame:source.g,sourceIds:[source.defenders[0].id]}).ok);
 const bad=printedDeploymentFixture('divide-and-conquer');
 source.g.winner=undefined;
 assert.equal(bad.g.configureLinkedScenarioReinforcements({sourceGame:source.g,sourceIds:[source.defenders[0].id]}).ok,false,
  'an absent result is not a finished scenario');
 source.g.winner=null;
 assert.equal(bad.g.configureLinkedScenarioReinforcements({
  sourceGame:source.g,sourceIds:[source.defenders[0].id]}).ok,false,
 'unfinished Scenario 1 cannot provide certified survivors');
});

test('CAT3500D pp.45-48: pinned AGoAC maps preserve four 16x17 source elevations, water and bridge records',async()=>{
 const {buildAgoacSheet,AGOAC_BOARD_NAMES,AGOAC_BOARD_SOURCE}=await import('../dist/agoac-boards.js');
 assert.deepEqual(AGOAC_BOARD_NAMES,['Desert #2','Desert #3','Grassland #2','Grassland #3']);
 assert.equal(AGOAC_BOARD_SOURCE.revision,'5ee1b15ff2877611db4b0ffa864a57d0b9f72938');
 const pick=(tiles,label)=>tiles.find(t=>t.printedHex===label);
 for(const name of AGOAC_BOARD_NAMES){
  const west=buildAgoacSheet(name,{sheet:0,rotation:0});
  assert.equal(west.length,272,name);
  assert.equal(new Set(west.map(t=>t.q+','+t.r)).size,272,name);
  assert(west.every(t=>t.printedSheet===name&&Number.isInteger(t.height)));
  const east=buildAgoacSheet(name,{sheet:1,rotation:3});
  assert.equal(east.length,272);
  assert.equal(pick(east,'0101').r,8,'180-degree sheet rotation flips north/south');
  assert.equal(pick(east,'0101').q+Math.floor(pick(east,'0101').r/2)+16,31,
   '180-degree sheet rotation flips east/west per mapsheet');
 }
 const d2=buildAgoacSheet('Desert #2');
 assert.equal(pick(d2,'0403').height,1,'source Desert #2 printed level-1 elevation');
 assert.equal(pick(d2,'0607').type,'water');
 assert.equal(pick(d2,'0607').depth,1);
 const g2=buildAgoacSheet('Grassland #2');
 assert.equal(pick(g2,'0903').type,'heavy','printed heavy woods');
 assert.equal(pick(g2,'0808').type,'bridge','pinned bridge at 0808');
 assert.equal(pick(g2,'0808').bridge.cf,90,'source bridge CF');
 assert.equal(pick(g2,'0808').bridge.elevation,1);
 const g3=buildAgoacSheet('Grassland #3');
 assert(g3.some(t=>t.type==='woods'||t.type==='heavy'));
 assert.throws(()=>buildAgoacSheet('Desert #1'),/Unknown AGoAC/);
 assert.throws(()=>buildAgoacSheet('Desert #2',{sheet:0,rotation:1}),/Unknown AGoAC/);
});

test('CAT3500D pp.45-48: pinned MegaMek MTF data construct all printed AGoAC technical designs',async()=>{
 const {loadAgoacPrintedDesigns,AGOAC_PINNED_RECORD_SOURCE}=await import('../apps/api/src/agoac-scenario-setup.mjs');
 const {construct}=await import('../dist/construction.js');
 assert.equal(AGOAC_PINNED_RECORD_SOURCE.revision,'5ee1b15ff2877611db4b0ffa864a57d0b9f72938');
 const counts={'final-exam':4,'trial-by-fire':4,'divide-and-conquer':10};
 const variants=new Set();
 for(const [id,count]of Object.entries(counts)){
  const designs=loadAgoacPrintedDesigns(id);
  assert.equal(Object.keys(designs).length,count,id);
  for(const [variant,config]of Object.entries(designs)){
   variants.add(variant);
   assert(config.name.endsWith(' '+variant));
   const built=construct(config);
   assert.equal(built.errors.length,0,id+' '+variant+' '+built.errors.join(';'));
   assert(built.unit.weapons.length>0,'source technical equipment present: '+variant);
   assert(Object.keys(built.unit.crit).length>=8,'real critical-slot layout');
   assert(built.unit.tonnage>=20&&built.unit.tonnage<=100);
  }
 }
 assert.equal(variants.size,12,'all 12 distinct published variants use actual source designs');
 assert.throws(()=>loadAgoacPrintedDesigns('not-a-scenario'),/unknown_agoac/);
});

test('CAT3500D pp.45-48: three source-backed scenarios load true maps and Mech records, not demo units',async()=>{
 const {prepareAgoacPrintedScenario,loadAgoacPrintedDesigns}=await import('../apps/api/src/agoac-scenario-setup.mjs');
 for(const [id,expected] of [['final-exam',8],['trial-by-fire',4],['divide-and-conquer',10]]){
  const g=fresh();
  assert(g.configureScenario(id).ok);
  g.scenario.sideRollWinner=0;
  assert(g.chooseScenarioSide(0,'attacker').ok);
  const missing=g.configurePrintedScenarioForces({designs:loadAgoacPrintedDesigns(id)});
  assert.equal(missing.ok,false,'source map must be present before mech roster');
  const loaded=prepareAgoacPrintedScenario(g,id);
  assert.equal(loaded.map.tiles,544);
  assert.equal(loaded.records.units,expected);
  assert.equal(g.units.length,expected);
  assert.equal(g.setupMap.printedScenario,id);
  assert.deepEqual(g.setupMap.sheets.map(s=>s.name),AGOAC_PRINTED_SCENARIOS[id].sheets.map(s=>s.name));
  assert(g.tiles.every(t=>t.printedHex&&t.printedSheet&&typeof t.sourceTerrain==='string'));
  assert(g.units.every(u=>u.recordSource==='MegaMek/mm-data'&&u.recordSourceRevision===g.setupMap.sourceRevision));
  assert.equal(g.units.every(u=>u.deployed===false),true);
  assert.equal(g.nextPhase().ok,false,'cannot bypass source scenario without deployment');
  assert.equal(g.startStandardDeployment().ok,false,'cannot silently use generic deployment');
  assert.equal(g.configureSetupForces({slots:[0,1,2,3]}).ok,false);
  const before=JSON.stringify(g.units);
  assert.equal(g.configurePrintedScenarioForces({designs:loadAgoacPrintedDesigns(id)}).ok,false,'cannot replace once loaded');
  assert.equal(JSON.stringify(g.units),before);
  const start=beginPrintedScenarioTest(g);
  assert(start.ok,id);
  assert.equal(start.exactMapImplemented,true);
  assert.equal(start.recordSheetsImported,true);
  assert.equal(start.steps,expected);
  assert.equal(g.scenario.placement.complete,false);
  assert(g.units.some(u=>u.tonnage!==55),'not demo duplicates');
 }
});

test('CAT3500D pp.46-48: source BattleMaster gets four pregame 5-point hits without head/crit',async()=>{
 const {prepareAgoacPrintedScenario}=await import('../apps/api/src/agoac-scenario-setup.mjs');
 const g=fresh();
 assert(g.configureScenario('trial-by-fire').ok);
 g.scenario.sideRollWinner=0;
 assert(g.chooseScenarioSide(0,'attacker').ok);
 prepareAgoacPrintedScenario(g,'trial-by-fire');
 assert(beginPrintedScenarioTest(g).ok);
 for(const stage of g.scenario.placement.steps){
  const unit=g.units.find(u=>u.team===stage.team&&!u.deployed);
  assert(unit);
  const location=g.tiles.find(t=>g.scenarioZoneAllowed(unit.team,t.q,t.r,{lance:unit.lance,facing:0})&&
   !g.scenario.placement.placed.some(p=>p.q===t.q&&p.r===t.r));
  assert(location,'source terrain includes legal setup hex for '+unit.variant);
  assert(g.placePrintedScenarioMech(unit.id,location.q,location.r).ok);
 }
 const defender=g.units.find(u=>u.team===g.scenario.defenderTeam);
 assert.equal(defender.variant,'BLR-1G');
 assert.equal(defender.tonnage,85);
 assert.equal(g.nextPhase().ok,false,'printed prematch damage required');
 // Deterministic 2D6 sum 7 hits center torso, never head.
 g.rng=()=>.5;
 const pre=g.applyTrialByFirePreDamage(defender.id);
 assert(pre.ok);
 assert.equal(pre.hits.length,4);
 assert(pre.hits.every(h=>h.damage===5&&h.location!=='HD'));
 assert.equal(g.scenario.preDamageApplied,true);
 assert(g.nextPhase().ok,'source-backed scenario may enter Initiative after prematch damage');
 assert.equal(g.initiativeWinner,g.scenario.defenderTeam);
});


test('CAT3500D p.48 errata v8.01: battlefield minimum axial r is north; command NW and recon SE hold under sheet rotations',()=>{
 for(const rotations of [[0,0],[3,3],[3,0],[0,3]]){
  for(const role of ['attacker','defender']){
   const g=fresh();
   assert(g.configureScenario('divide-and-conquer').ok);
   g.scenario.sideRollWinner=0;
   assert(g.chooseScenarioSide(0,role).ok);
   assert(g.configurePrintedScenarioMap({rotations}).ok);
   const can=(lance,col,row)=>{
    const t=atSheetCoord(g,col,row);assert(t);
    return g.scenarioZoneAllowed(g.scenario.defenderTeam,t.q,t.r,{lance,facing:0});
   };
   assert(can('command',0,0),'command NW corner: '+rotations+' '+role);
   assert(can('command',6,6),'command inclusive north+west six-hex boundary');
   assert.equal(can('command',0,16),false,'command must NOT enter south-west instead of north-west');
   assert.equal(can('command',6,7),false,'command must NOT cross northern six-hex band');
   assert.equal(can('command',7,6),false,'command must NOT cross western six-hex band');
   assert(can('recon',31,16),'recon SE corner: '+rotations+' '+role);
   assert(can('recon',25,10),'recon inclusive south+east six-hex boundary');
   assert.equal(can('recon',31,0),false,'recon must NOT enter north-east instead of south-east');
   assert.equal(can('recon',25,9),false,'recon must NOT cross southern six-hex band');
   assert.equal(can('recon',24,10),false,'recon must NOT cross eastern six-hex band');
   assert.equal(can('unexpected',0,0),false,'only source-defined defender lance names qualify');
  }
 }
});

test('CAT3500D p.48 errata: real 6+4 and shortened 4+3 defenders obey NW/SE physical deployment',async()=>{
 const {prepareAgoacPrintedScenario}=await import('../apps/api/src/agoac-scenario-setup.mjs');
 for(const variation of [null,'shortened']){
  const g=fresh();
  assert(g.configureScenario('divide-and-conquer').ok);
  g.scenario.sideRollWinner=0;
  assert(g.chooseScenarioSide(0,'defender').ok);
  if(variation)assert(g.configurePrintedScenarioVariation(variation).ok);
  prepareAgoacPrintedScenario(g,'divide-and-conquer',{rotations:[3,0]});
  assert(beginPrintedScenarioTest(g).ok);
  const steps=g.scenario.placement.steps;
  const commandCount=steps.filter(s=>s.lance==='command').length;
  const reconCount=steps.filter(s=>s.lance==='recon').length;
  assert.equal(commandCount,variation?2:3);
  assert.equal(reconCount,variation?2:3);
  const wrongCommand=atSheetCoord(g,0,16),wrongRecon=atSheetCoord(g,31,0);
  const command=g.units.find(u=>u.lance==='command');
  assert.equal(g.placePrintedScenarioMech(command.id,wrongCommand.q,wrongCommand.r).ok,false,
   'wrong south-west zone cannot be accepted in actual deployment');
  const rightCommand=atSheetCoord(g,0,0);
  assert(g.placePrintedScenarioMech(command.id,rightCommand.q,rightCommand.r).ok);
  for(let i=1;i<commandCount;i++){
   const unit=g.units.find(u=>u.lance==='command'&&!u.deployed);
   const target=atSheetCoord(g,i,0);
   assert(g.placePrintedScenarioMech(unit.id,target.q,target.r).ok);
  }
  const recon=g.units.find(u=>u.lance==='recon');
  assert.equal(g.placePrintedScenarioMech(recon.id,wrongRecon.q,wrongRecon.r).ok,false,
   'wrong north-east zone cannot be accepted in actual deployment');
  const rightRecon=atSheetCoord(g,31,16);
  assert(g.placePrintedScenarioMech(recon.id,rightRecon.q,rightRecon.r).ok);
  for(let i=1;i<reconCount;i++){
   const unit=g.units.find(u=>u.lance==='recon'&&!u.deployed);
   const target=atSheetCoord(g,31-i,16);
   assert(g.placePrintedScenarioMech(unit.id,target.q,target.r).ok);
  }
  assert.equal(g.scenario.placement.placed.length,commandCount+reconCount);
  assert(g.chooseDivideAndConquerAttackerRow('west').ok);
  const row=g.divideAndConquerPrintedRow('west');
  for(let i=0;i<(variation?3:4);i++){
   const unit=g.units.find(u=>u.team===g.scenario.attackerTeam&&!u.deployed);
   assert(g.placePrintedScenarioMech(unit.id,row[i].q,row[i].r).ok);
  }
  assert(g.scenario.placement.complete,'full source roster deployed after correct corners');
 }
});


test('CAT3500D p.47: printed Scenario 3 mandates four diagram counters with real height/depth before initiative',async()=>{
 const {prepareAgoacPrintedScenario}=await import('../apps/api/src/agoac-scenario-setup.mjs');
 const g=fresh();
 assert(g.configureScenario('divide-and-conquer').ok);
 g.scenario.sideRollWinner=0;assert(g.chooseScenarioSide(0,'defender').ok);
 prepareAgoacPrintedScenario(g,'divide-and-conquer');
 assert.equal(g.beginPrintedScenarioPlacement().ok,false);
 assert.equal(g.confirmDivideAndConquerIllustratedTerrain({sourceDiagramReviewed:true}).ok,false);
 prepareScenario3IllustrationForTest(g);
 assert(g.beginPrintedScenarioPlacement().ok);
 assert.equal(g.scenario.picturedTerrain.pieces.length,4);
 assert.equal(g.scenario.picturedTerrain.sourcePage,47);
 assert(g.tiles.some(t=>t.overlayTerrain?.terrainType==='level1'&&t.height===1));
 assert(g.tiles.some(t=>t.overlayTerrain?.terrainType==='level2'&&t.height===2));
 assert(g.tiles.some(t=>t.overlayTerrain?.terrainType==='depth1'&&t.depth===1));
 assert(g.tiles.some(t=>t.overlayTerrain?.terrainType==='depth2'&&t.depth===2));
});
test('CAT3500D p.48: source-backed Divide and Conquer completes corrected defender-first ten-Mech setup',async()=>{
 const {prepareAgoacPrintedScenario}=await import('../apps/api/src/agoac-scenario-setup.mjs');
 const g=fresh();
 assert(g.configureScenario('divide-and-conquer').ok);
 g.scenario.sideRollWinner=0;
 assert(g.chooseScenarioSide(0,'attacker').ok);
 prepareAgoacPrintedScenario(g,'divide-and-conquer');
 assert(beginPrintedScenarioTest(g).ok);
 for(let k=0;k<6;k++){
  const stage=g.scenario.placement.steps[k];
  const unit=g.units.find(u=>u.team===stage.team&&u.lance===stage.lance&&!u.deployed);
  assert(unit);
  const eastRow=g.divideAndConquerPrintedRow('east');
  const candidate=g.tiles.find(t=>g.scenarioZoneAllowed(unit.team,t.q,t.r,{lance:unit.lance,facing:0})&&
   !eastRow.some(v=>v.q===t.q&&v.r===t.r)&&
   !g.scenario.placement.placed.some(p=>p.q===t.q&&p.r===t.r));
  assert(candidate);
  assert(g.placePrintedScenarioMech(unit.id,candidate.q,candidate.r).ok);
 }
 assert(g.chooseDivideAndConquerAttackerRow('east').ok);
 const row=g.divideAndConquerPrintedRow('east');
 for(let k=0;k<4;k++){
  const unit=g.units.find(u=>u.team===g.scenario.attackerTeam&&!u.deployed);
  assert(unit);
  assert(g.placePrintedScenarioMech(unit.id,row[k].q,row[k].r).ok,'printed east row attacker '+k);
 }
 assert(g.scenario.placement.complete);
 g.rng=()=>.9;
 assert(g.nextPhase().ok);
 assert.equal(g.phase,'move');
 assert.equal(g.queue.length,10,'correct printed 6 defenders vs 4 attackers');
});
test('CAT3500D p.48: shortened Divide and Conquer loads 4 defenders and 3 attackers with real records',async()=>{
 const {prepareAgoacPrintedScenario,loadAgoacPrintedDesigns}=await import('../apps/api/src/agoac-scenario-setup.mjs');
 assert.throws(()=>loadAgoacPrintedDesigns('final-exam',{variation:'shortened'}),/unsupported_printed/);
 assert.throws(()=>loadAgoacPrintedDesigns('divide-and-conquer',{variation:'unknown'}),/unsupported_printed/);
 const shortened=loadAgoacPrintedDesigns('divide-and-conquer',{variation:'shortened'});
 assert.deepEqual(Object.keys(shortened).sort(),['AWS-8Q','COM-2D','COM-3A','CPLT-K2','GRF-1N','TDR-5S','WVR-6M']);
 assert.equal(Object.keys(loadAgoacPrintedDesigns('divide-and-conquer')).length,10,
  'ordinary published scenario still retains ten real variants');
 for(const role of ['attacker','defender']){
  const g=fresh();
  assert(g.configureScenario('divide-and-conquer').ok);
  g.scenario.sideRollWinner=0;
  assert(g.chooseScenarioSide(0,role).ok);
  assert.equal(g.configurePrintedScenarioVariation('unknown').ok,false);
  assert(g.configurePrintedScenarioVariation('shortened').ok);
  assert.equal(g.configurePrintedScenarioVariation('shortened').ok,false,'one-time variation lock');
  const loaded=prepareAgoacPrintedScenario(g,'divide-and-conquer',{
   rotations:role==='defender'?[3,0]:[0,3]
  });
  assert.equal(loaded.records.units,7);
  assert.equal(g.units.length,7);
  assert.equal(g.setupForces.variation,'shortened');
  assert.deepEqual(g.units.filter(u=>u.team===g.scenario.defenderTeam).map(u=>u.variant),
   ['CPLT-K2','TDR-5S','COM-3A','COM-2D']);
  assert.deepEqual(g.units.filter(u=>u.team===g.scenario.attackerTeam).map(u=>u.variant),
   ['AWS-8Q','WVR-6M','GRF-1N']);
  assert(g.units.every(u=>u.recordSource==='MegaMek/mm-data'&&u.recordSourceRevision===g.setupMap.sourceRevision));
  assert.equal(g.configurePrintedScenarioVariation('shortened').ok,false,'cannot swap after force load');
  assert(beginPrintedScenarioTest(g).ok);
  assert.deepEqual(g.scenario.placement.steps.map(x=>x.lance),
   ['command','command','recon','recon','printed-row','printed-row','printed-row']);
  assert.equal(g.chooseDivideAndConquerAttackerRow('west').ok,false,
   'printed attacker deployment waits for all four shortened defenders');
  for(const stage of g.scenario.placement.steps.slice(0,4)){
   const unit=g.units.find(u=>u.team===stage.team&&u.lance===stage.lance&&!u.deployed);
   assert(unit,'printed defender of specified lance exists');
   const hex=g.tiles.find(t=>g.scenarioZoneAllowed(unit.team,t.q,t.r,{lance:unit.lance,facing:0})&&
    !g.scenario.placement.placed.some(p=>p.q===t.q&&p.r===t.r));
   assert(hex,'legal printed defender placement exists');
   assert(g.placePrintedScenarioMech(unit.id,hex.q,hex.r).ok);
  }
  assert(g.chooseDivideAndConquerAttackerRow('west').ok);
  const row=g.divideAndConquerPrintedRow('west');
  assert.equal(row.length,8,'printed 1510–1517 still valid after 0/180 rotation');
  for(let k=0;k<3;k++){
   const unit=g.units.find(u=>u.team===g.scenario.attackerTeam&&!u.deployed);
   assert(unit);
   assert(g.placePrintedScenarioMech(unit.id,row[k].q,row[k].r).ok);
  }
  assert(g.scenario.placement.complete);
  assert.equal(g.scenario.placement.placed.length,7);
  g.rng=()=>.83;
  assert(g.nextPhase().ok);
  assert.equal(g.phase,'move');
  assert.equal(g.queue.length,7,'all shortened forces participate in turn one');
 }
});

test('CAT3500D p.48: shortened roster selection rejects mismatched full force records atomically',async()=>{
 const {loadAgoacPrintedDesigns}=await import('../apps/api/src/agoac-scenario-setup.mjs');
 const g=fresh();
 assert(g.configureScenario('divide-and-conquer').ok);
 g.scenario.sideRollWinner=0;
 assert(g.chooseScenarioSide(0,'attacker').ok);
 assert(g.configurePrintedScenarioVariation('shortened').ok);
 assert(g.configurePrintedScenarioMap().ok);
 const before=JSON.stringify(g.units);
 assert.equal(g.configurePrintedScenarioForces({designs:loadAgoacPrintedDesigns('divide-and-conquer')}).ok,false);
 assert.equal(JSON.stringify(g.units),before,'wrong 10-unit file set cannot alter game');
 assert.equal(g.setupForces,null);
 assert(g.configurePrintedScenarioForces({designs:
  loadAgoacPrintedDesigns('divide-and-conquer',{variation:'shortened'})}).ok);
 assert.equal(g.setupForces.variants.length,7);
});


test('CAT3500D pp.45-46: Final Exam optional source-based alternative forces are 4v4, not substituted demo units',async()=>{
 const {prepareAgoacPrintedScenario,loadAgoacPrintedDesigns}=await import('../apps/api/src/agoac-scenario-setup.mjs');
 const {construct}=await import('../packages/engine/construction.js');
 assert.throws(()=>loadAgoacPrintedDesigns('trial-by-fire',{variation:'alternate-forces'}),/unsupported_printed/);
 const designs=loadAgoacPrintedDesigns('final-exam',{variation:'alternate-forces'});
 assert.deepEqual(Object.keys(designs).sort(),
  ['COM-2D','COM-3A','GRF-1N','LCT-1E','LCT-1V','TDR-5S','TDR-5SE','WVR-6R'].sort());
 for(const [variant,design]of Object.entries(designs)){
  const result=construct(design);
  assert.equal(result.errors.length,0,'source chassis '+variant+': '+result.errors.join('; '));
  assert(result.unit.tonnage>=20&&result.unit.tonnage<=100);
 }
 for(const role of ['attacker','defender']){
  const g=fresh();
  assert(g.configureScenario('final-exam').ok);
  g.scenario.sideRollWinner=0;
  assert(g.chooseScenarioSide(0,role).ok);
  assert.equal(g.configurePrintedScenarioVariation('shortened').ok,false);
  assert(g.configurePrintedScenarioVariation('alternate-forces').ok);
  assert.equal(g.configurePrintedScenarioVariation('alternate-forces').ok,false);
  const loaded=prepareAgoacPrintedScenario(g,'final-exam');
  assert.equal(loaded.records.units,8);
  assert.deepEqual(g.units.filter(u=>u.team===g.scenario.defenderTeam).map(u=>u.variant),
   ['TDR-5S','GRF-1N','LCT-1E','COM-2D']);
  assert.deepEqual(g.units.filter(u=>u.team===g.scenario.attackerTeam).map(u=>u.variant),
   ['TDR-5SE','WVR-6R','LCT-1V','COM-3A']);
  assert(g.units.every(u=>u.recordSource==='MegaMek/mm-data'&&u.piloting===5&&u.gunnery===4));
  assert.equal(g.configurePrintedScenarioVariation('alternate-forces').ok,false,'locked after technical source import');
  assert(beginPrintedScenarioTest(g).ok);
  assert.equal(g.scenario.placement.steps.length,8);
 }
});
test('CAT3500D p.46: Final Exam reshapes authentic source maps to short edges and keeps printed rotations',async()=>{
 const {prepareAgoacPrintedScenario}=await import('../apps/api/src/agoac-scenario-setup.mjs');
 for(const rotations of [[0,0],[3,0],[0,3],[3,3]]){
  const g=fresh();
  assert(g.configureScenario('final-exam').ok);
  g.scenario.sideRollWinner=0;
  assert(g.chooseScenarioSide(0,'defender').ok);
  const loaded=prepareAgoacPrintedScenario(g,'final-exam',{rotations,layout:'vertical'});
  assert.equal(loaded.map.tiles,544);
  assert.equal(g.setupMap.layout,'vertical');
  assert.equal(g.setupMap.width,16);
  assert.equal(g.setupMap.height,34);
  assert.deepEqual(g.setupMap.sheets.map(s=>s.name),['Desert #3','Grassland #2']);
  assert.equal(new Set(g.tiles.map(t=>t.q+','+t.r)).size,544,'no overlap after short-side join');
  assert.deepEqual(g.tiles.map(t=>t.sheet).reduce((acc,s)=>(acc[s]=(acc[s]??0)+1,acc),{}),
   {0:272,1:272});
  for(const index of [0,1]){
   const sheet=g.tiles.filter(t=>t.sheet===index);
   assert.equal(new Set(sheet.map(t=>t.printedHex)).size,272);
   assert(sheet.every(t=>t.printedSheet===(index?'Grassland #2':'Desert #3')));
  }
  assert.equal(g.configurePrintedScenarioMap({layout:'horizontal'}).ok,false,'no second layout');
  assert(beginPrintedScenarioTest(g).ok);
  const defender=g.units.find(u=>u.team===g.scenario.defenderTeam&&!u.deployed);
  const west=g.tiles.find(t=>t.q+Math.floor(t.r/2)===-8);
  assert(west&&g.scenarioZoneAllowed(defender.team,west.q,west.r));
  assert(g.placePrintedScenarioMech(defender.id,west.q,west.r).ok);
 }
 const trial=fresh();
 assert(trial.configureScenario('trial-by-fire').ok);
 trial.scenario.sideRollWinner=0;assert(trial.chooseScenarioSide(0,'attacker').ok);
 assert.equal(trial.configurePrintedScenarioMap({layout:'vertical'}).ok,false,
  'short-side published alternative is limited to Final Exam');
});
test('CAT3500D p.48: optional playable terrain overlays change movement and LOS terrain, with atomic geometry and type rejection',()=>{
 const g=looseSheetFixture();
 assert(g.startScenarioLooseTerrain({piecesPerTeam:1,startingTeam:0}).ok);
 const at=(col,row)=>atSheetCoord(g,col,row);
 const first=at(5,8),second=at(23,8);
 const a=g.tile(first.q,first.r),b=g.tile(second.q,second.r);
 const beforeA=a.type,beforeB=b.type;
 assert.equal(g.placeScenarioLooseTerrain({team:0,q:first.q,r:first.r,label:'wrong',terrainType:'lava'}).ok,false);
 assert.equal(g.placeScenarioLooseTerrain({team:0,q:first.q,r:first.r,label:'woods',
  terrainType:'heavy',footprint:[{q:0,r:0},{q:2,r:0}]}).ok,false,'disconnected overlay');
 assert.equal(a.type,beforeA,'invalid placement has no terrain effect');
 assert(g.placeScenarioLooseTerrain({team:0,q:first.q,r:first.r,label:'Heavy woods',
  terrainType:'heavy'}).ok);
 assert.equal(g.tile(first.q,first.r).type,'heavy','engine reads actual heavy woods');
 assert.equal(g.tile(first.q,first.r).baseTerrainType,beforeA);
 assert.equal(g.placeScenarioLooseTerrain({team:1,q:second.q,r:second.r,label:'Rubble',
  terrainType:'rubble'}).ok,true);
 assert.equal(g.tile(second.q,second.r).type,'rubble');
 assert.equal(g.tile(second.q,second.r).baseTerrainType,beforeB);
 assert(g.scenario.looseTerrain.complete);
 assert(g.scenario.looseTerrain.pieces.every(p=>p.terrainType!==null));
 assert.equal(g.scenario.looseTerrain.visualAssetsLoaded,false,'licensed punch-out graphics not fabricated');
});


test('CAT3500D Ch11 browser technical manifest uses identical source MTF constructor data for every printed variation',async()=>{
 const {readFileSync}=await import('node:fs');
 const {loadAgoacPrintedDesigns}=await import('../apps/api/src/agoac-scenario-setup.mjs');
 const {loadAgoacBrowserDesigns}=await import('../dist/agoac-scenario-loader.js');
 const {AGOAC_BOARD_SOURCE}=await import('../packages/engine/agoac-boards.js');
 const bundle=JSON.parse(readFileSync(new URL('../dist/agoac-records.json',import.meta.url),'utf8'));
 assert.equal(bundle.sourceRevision,AGOAC_BOARD_SOURCE.revision);
 assert.equal(bundle.licenseId,'CC-BY-NC-SA-4.0');
 assert.equal(bundle.records.length,14);
 for(const [id,variation]of [['final-exam',null],['final-exam','alternate-forces'],
  ['trial-by-fire',null],['divide-and-conquer',null],['divide-and-conquer','shortened']]){
  const actual=await loadAgoacBrowserDesigns(id,{variation,readCatalog:async()=>bundle});
  const expected=loadAgoacPrintedDesigns(id,{variation});
  assert.deepEqual(Object.keys(actual).sort(),Object.keys(expected).sort());
  for(const variant of Object.keys(expected))
   assert.deepEqual(actual[variant],expected[variant],id+' '+(variation||'original')+' '+variant);
 }
 await assert.rejects(()=>loadAgoacBrowserDesigns('final-exam',{
  readCatalog:async()=>({...bundle,sourceRevision:'untrusted'})}),/revision/);
 await assert.rejects(()=>loadAgoacBrowserDesigns('trial-by-fire',{variation:'shortened',
  readCatalog:async()=>bundle}),/unsupported_printed/);
});

test('CAT3500D p.46: Final Exam substitute terrain variation uses only independently pinned boards',async()=>{
 const {prepareAgoacPrintedScenario}=await import('../apps/api/src/agoac-scenario-setup.mjs');
 const g=fresh();
 assert(g.configureScenario('final-exam').ok);
 g.scenario.sideRollWinner=0;assert(g.chooseScenarioSide(0,'attacker').ok);
 assert.equal(g.configurePrintedScenarioMap({names:['Fake #0','Grassland #3']}).ok,false);
 assert.equal(g.setupMap,null,'unknown source maps must not commit setup');
 const loaded=prepareAgoacPrintedScenario(g,'final-exam',{
  layout:'vertical',rotations:[3,0],names:['Desert #2','Grassland #3']});
 assert.equal(loaded.records.units,8);
 assert.deepEqual(g.setupMap.sheets.map(s=>s.name),['Desert #2','Grassland #3']);
 assert(g.tiles.filter(t=>t.sheet===0).every(t=>t.printedSheet==='Desert #2'));
 assert(g.tiles.filter(t=>t.sheet===1).every(t=>t.printedSheet==='Grassland #3'));
 assert(beginPrintedScenarioTest(g).ok);
 const trial=fresh();assert(trial.configureScenario('trial-by-fire').ok);
 trial.scenario.sideRollWinner=0;assert(trial.chooseScenarioSide(0,'attacker').ok);
 assert.equal(trial.configurePrintedScenarioMap({names:['Desert #2','Grassland #2']}).ok,false);
});

test('CAT3500D p.48: Awesome AWS-8Q source MTF retains lower arm actuator but omits hand',async()=>{
 const {loadAgoacPrintedDesigns}=await import('../apps/api/src/agoac-scenario-setup.mjs');
 const {construct}=await import('../dist/construction.js');
 const config=loadAgoacPrintedDesigns('divide-and-conquer')['AWS-8Q'];
 assert(config,'source model found');
 assert.deepEqual(config.removeHandActuators,['RA']);
 assert.equal(config.removeActuators?.includes('RA')??false,false);
 const real=construct(config);
 assert.equal(real.errors.length,0,real.errors.join(';'));
 assert.equal(real.unit.slots.RA[2],'lower','preserve the lower arm actuator');
 assert.equal(real.unit.slots.RA[3],'sink','print-defined heat sink replaces only the hand');
 const incompatible={...config,removeHandActuators:[],removeActuators:[]};
 const invalid=construct(incompatible);
 assert(invalid.errors.length>0,'cannot silently accept heat sink overlapping a hand actuator');
});



// Source-certification packet I: original CAT3500D pp.45-48 plus official
// v8.01 errata, with all active map and Mech records loaded from pinned
// MegaMek/mm-data, NOT synthetic demo sheets or stock four-unit fixtures.
const chapter11SourceGame=async(id,attackerTeam=0,rotations=[0,0])=>{
 const {prepareAgoacPrintedScenario}=await import('../apps/api/src/agoac-scenario-setup.mjs');
 const g=fresh();
 assert(g.configureScenario(id).ok);
 g.scenario.sideRollWinner=attackerTeam;
 assert(g.chooseScenarioSide(attackerTeam,'attacker').ok);
 const loaded=prepareAgoacPrintedScenario(g,id,{rotations});
 assert.equal(loaded.map.tiles,544);
 assert.equal(g.setupMap.printedScenario,id);
 assert(g.tiles.every(t=>t.printedHex&&t.printedSheet&&t.sourceTerrain!==undefined));
 assert(g.units.every(u=>u.recordSource==='MegaMek/mm-data'&&
  u.recordSourceRevision===g.setupMap.sourceRevision&&u.weapons.length));
 return g;
};
const chapter11SourceColumn=(g,t)=>t.q+Math.floor(t.r/2)+Math.floor(g.setupMap.width/2);
const chapter11SourceDeployAll=g=>{
 const start=beginPrintedScenarioTest(g);
 assert(start.ok);
 let attempts=0;
 while(!g.scenario.placement.complete){
  assert(++attempts<=12,'deployment must finish after the full printed roster');
  const state=g.scenario.placement;
  if(g.scenario.id==='divide-and-conquer'&&state.placed.length===6)
   assert(g.chooseDivideAndConquerAttackerRow('east').ok);
  const stage=state.steps[state.placed.length];
  const unit=g.units.find(u=>u.team===stage.team&&!u.deployed&&
   (stage.lance===null||stage.lance==='printed-row'||u.lance===stage.lance));
  assert(unit,'a real printed unit exists for this placement');
  const options=stage.lance==='printed-row'?
   state.attackerRow.hexes:g.tiles;
  const position=options.find(t=>
   g.scenarioZoneAllowed(stage.team,t.q,t.r,{lance:stage.lance,facing:0})&&
   !state.placed.some(p=>p.q===t.q&&p.r===t.r));
  assert(position,'a real legal source hex exists for every printed step');
  assert(g.placePrintedScenarioMech(unit.id,position.q,position.r,0).ok);
 }
 assert.equal(g.scenario.placement.placed.length,
  g.units.filter(u=>!u.scenarioArrivalRound).length,
  'future campaign reinforcements are excluded from initial printed deployment');
 return g;
};

test('CAT3500D p.45 plus errata 8.01: source-backed Final Exam alternates all 8 west/east deployments',async()=>{
 for(const attackerTeam of [0,1]){
  const g=await chapter11SourceGame('final-exam',attackerTeam);
  assert.deepEqual(g.setupMap.sheets.map(s=>s.name),['Desert #3','Grassland #2']);
  const defender=g.units.filter(u=>u.team===1-attackerTeam);
  const attacker=g.units.filter(u=>u.team===attackerTeam);
  assert.equal(defender.length,4);assert.equal(attacker.length,4);
  assert(beginPrintedScenarioTest(g).ok);
  assert.equal(g.scenario.placement.exactMapImplemented,true);
  assert.equal(g.scenario.placement.recordSheetsImported,true);
  assert.equal(g.nextPhase().ok,false,'no first initiative until eight placements');
  const west=g.tiles.filter(t=>chapter11SourceColumn(g,t)===0);
  const east=g.tiles.filter(t=>chapter11SourceColumn(g,t)===31);
  assert.equal(west.length,17);assert.equal(east.length,17);
  assert.equal(g.placePrintedScenarioMech(attacker[0].id,east[0].q,east[0].r).ok,false,
   'attacker cannot pre-empt first defender');
  for(let i=0;i<4;i++){
   assert.equal(g.placePrintedScenarioMech(defender[i].id,east[i].q,east[i].r).ok,false,
    'defender cannot enter from east');
   assert(g.placePrintedScenarioMech(defender[i].id,west[i].q,west[i].r,i).ok);
   assert.equal(g.placePrintedScenarioMech(attacker[i].id,west[i].q,west[i].r).ok,false,
    'attacker cannot use west/occupied hex');
   assert(g.placePrintedScenarioMech(attacker[i].id,east[i].q,east[i].r,5-i).ok);
  }
  assert(g.scenario.placement.complete);
  assert.deepEqual(g.scenario.placement.placed.map(p=>p.team),
   [1-attackerTeam,attackerTeam,1-attackerTeam,attackerTeam,
    1-attackerTeam,attackerTeam,1-attackerTeam,attackerTeam]);
  assert.equal(g.placePrintedScenarioMech(defender[0].id,west[9].q,west[9].r).ok,false,
   'no additional deployment after setup');
  const roll=[...diceFor(12),...diceFor(2)];
  g.rng=()=>{assert(roll.length);return roll.shift();};
  assert(g.nextPhase().ok);
  assert.equal(g.phase,'move');
  assert.equal(g.queue.length,8,'all eight true MTF units enter first movement phase');
  assert.equal(roll.length,0);
 }
});

test('CAT3500D pp.46-47: source-backed Trial by Fire deploys 3 clear eastern attackers before BLR-1G west',async()=>{
 for(const rotations of [[0,0],[3,0]]){
  const g=await chapter11SourceGame('trial-by-fire',0,rotations);
  assert.deepEqual(g.setupMap.sheets.map(s=>s.name),['Desert #2','Grassland #3']);
  const attacker=g.units.filter(u=>u.team===0),defender=g.units.find(u=>u.team===1);
  assert.equal(attacker.length,3);assert.equal(defender.variant,'BLR-1G');
  assert.equal(defender.tonnage,85);
  assert(beginPrintedScenarioTest(g).ok);
  assert.equal(g.placePrintedScenarioMech(defender.id,0,0).ok,false,'defender must wait');
  assert.equal(g.nextPhase().ok,false);
  const east=g.tiles.filter(t=>chapter11SourceColumn(g,t)>=25);
  assert(east.some(t=>!g.scenarioZoneAllowed(0,t.q,t.r)),
   'not all eastern source terrain is level-0 Clear');
  const legal=east.filter(t=>g.scenarioZoneAllowed(0,t.q,t.r));
  assert(legal.length>=3,'three real level-0 Clear hexes exist');
  assert(legal.every(t=>t.type==='plain'&&t.height===0&&t.depth===0));
  for(let i=0;i<3;i++){
   assert.equal(g.placePrintedScenarioMech(attacker[i].id,0,0).ok,false,
    'an attacker cannot use the defending edge');
   assert(g.placePrintedScenarioMech(attacker[i].id,legal[i].q,legal[i].r,i+1).ok);
  }
  assert.equal(g.nextPhase().ok,false,'defender still to deploy');
  const western=g.tiles.filter(t=>chapter11SourceColumn(g,t)===3);
  assert.equal(western.length,17);
  const far=g.tiles.find(t=>chapter11SourceColumn(g,t)===4);
  assert.equal(g.placePrintedScenarioMech(defender.id,far.q,far.r).ok,false,
   'west edge distance limit is enforced');
  const target=western.find(t=>!g.scenario.placement.placed.some(p=>p.q===t.q&&p.r===t.r));
  assert(g.placePrintedScenarioMech(defender.id,target.q,target.r,5).ok,'defender facing unrestricted');
  assert(g.scenario.placement.complete);
  assert.deepEqual(g.scenario.placement.placed.map(p=>p.team),[0,0,0,1]);
  assert.equal(g.nextPhase().ok,false,'four mandatory front pre-hits must resolve');
  g.rng=()=>.5;
  const pre=g.applyTrialByFirePreDamage(defender.id);
  assert(pre.ok);assert.equal(pre.hits.length,4);
  assert(pre.hits.every(h=>h.damage===5&&h.location!=='HD'&&h.side==='front'));
  assert(g.nextPhase().ok);
  assert.equal(g.initiativeWinner,1,'defender wins turn 1 without initiative contest');
  assert.equal(g.phase,'move');
  assert.equal(g.queue.length,4);
 }
});

test('CAT3500D pp.45,47-48: real Final Exam and Divide win only after ALL enemy Mechs are crippled',async()=>{
 for(const id of ['final-exam','divide-and-conquer']){
  const g=await chapter11SourceGame(id);
  chapter11SourceDeployAll(g);
  const attacker=g.units.filter(u=>u.team===g.scenario.attackerTeam);
  assert([4].includes(attacker.length));
  const defender=g.units.filter(u=>u.team===g.scenario.defenderTeam);
  assert.equal(defender.length,id==='final-exam'?4:6);
  const unit=attacker[0],original=structuredClone(unit);
  const damaged={...original,engineHits:1,gyroHits:1,
   weapons:original.weapons.map(w=>({...w,ammo:w.ammo===null?null:0}))};
  assert.equal(g.scenarioCrippled(damaged),false,
   'no ammo or one engine/gyro critical alone is not defined as crippled');
  for(const condition of [
   u=>{u.structure.LL=0;},
   u=>{u.structure.RL=0;},
   u=>{u.gyroHits=2;},
   u=>{u.engineHits=2;},
   u=>{for(const w of u.weapons)w.destroyed=true;}
  ]){
   const sample=structuredClone(original);
   condition(sample);
   assert(g.scenarioCrippled(sample),'all five source cripple cases are recognized');
  }
  for(let i=0;i<attacker.length-1;i++)attacker[i].structure.LL=0;
  g.checkWin();
  assert.equal(g.winner,null,'one combat-capable enemy prevents early victory');
  const last=attacker.at(-1);
  for(const w of last.weapons)w.destroyed=true;
  g.checkWin();
  assert.equal(g.winner,g.scenario.defenderTeam,'only full enemy cripple ends encounter');
  assert.equal(g.activeTeam,null);
  assert(defender.some(u=>!g.scenarioCrippled(u)));
 }
});

test('CAT3500D pp.47-48: source-backed Divide forced/voluntary exits count as destroyed',async()=>{
 const g=await chapter11SourceGame('divide-and-conquer');
 chapter11SourceDeployAll(g);
 const attacking=g.units.filter(u=>u.team===g.scenario.attackerTeam);
 const defending=g.units.filter(u=>u.team===g.scenario.defenderTeam);
 attacking.slice(0,-1).forEach(u=>{u.engineHits=2;});
 g.checkWin();assert.equal(g.winner,null);
 const remaining=attacking.at(-1);
 // Exiting the printed area destroys a Mech instead of allowing re-entry;
 // use a legal edge and the actual Movement-phase order.
 const roll=[...diceFor(12),...diceFor(2)];
 g.rng=()=>roll.shift()??.5;
 assert(g.nextPhase().ok);
 assert.equal(g.phase,'move');
 g.activeTeam=remaining.team;g.actingId=null;remaining.moveMode='stand';
 const edge=g.deploymentEdgeTiles(3).find(t=>!g.occupied(t.q,t.r,remaining.id));
 assert(edge);
 remaining.q=edge.q;remaining.r=edge.r;remaining.spent=0;remaining.moved=false;
 const result=g.exitScenarioMap(remaining.id,3,'walk');
 assert(result.ok);assert(result.destroyed);assert.equal(result.escaped,false);
 assert(remaining.dead);assert(remaining.escaped);
 assert.equal(g.winner,g.scenario.defenderTeam);
 assert(defending.some(u=>!u.dead));
});

test('CAT3500D p.47: real Trial by Fire wins for BattleMaster east exit or destruction of all attackers',async()=>{
 for(const cause of ['east-exit','west-exit','all-attackers','destroy-battlemaster','attacker-exit']){
  const g=await chapter11SourceGame('trial-by-fire');
  chapter11SourceDeployAll(g);
  const master=g.units.find(u=>u.team===g.scenario.defenderTeam);
  const attackers=g.units.filter(u=>u.team===g.scenario.attackerTeam);
  g.rng=()=>.5;assert(g.applyTrialByFirePreDamage(master.id).ok);
  if(cause==='all-attackers'){
   for(const a of attackers)a.dead=true;
   g.checkWin();assert.equal(g.winner,master.team);
   continue;
  }
  if(cause==='destroy-battlemaster'){
   master.dead=true;g.checkWin();assert.equal(g.winner,g.scenario.attackerTeam);
   continue;
  }
  const dice=[...diceFor(12),...diceFor(2)];
  g.rng=()=>dice.shift()??.5;
  assert(g.nextPhase().ok);
  assert.equal(g.initiativeWinner,master.team,'first round Initiative defender auto-wins');
  const unit=cause==='attacker-exit'?attackers[0]:master;
  g.phase='move';g.activeTeam=unit.team;g.actingId=null;
  unit.moved=false;unit.spent=0;unit.moveMode='stand';
  const edgeId=cause==='west-exit'||cause==='attacker-exit'?0:3;
  const target=g.deploymentEdgeTiles(edgeId).find(t=>!g.occupied(t.q,t.r,unit.id));
  assert(target);
  unit.q=target.q;unit.r=target.r;
  const result=g.exitScenarioMap(unit.id,edgeId);
  assert(result.ok,'actual edge order executed from real map');
  if(cause==='east-exit'){
   assert(result.escaped);assert(!result.destroyed);assert.equal(g.winner,master.team);
  }else if(cause==='west-exit'){
   assert(!result.escaped);assert(result.destroyed);assert.equal(g.winner,g.scenario.attackerTeam);
  }else{
   assert(!result.escaped);assert(result.destroyed);
   assert.equal(g.winner,null,'one attacker exit does not end battle while two remain');
  }
 }
});


// Source-backed Chapter 11 certification packet II: the original printed
// scenarios and pinned technical records, rather than demo-only Mechs.
test('CAT3500D p.48: source-backed Final Exam permits equal-cost cards and mirrored pilot skills before printed deployment',async()=>{
 for(const attackerTeam of [0,1]){
  const g=await chapter11SourceGame('final-exam',attackerTeam);
  const attacker=g.units.filter(u=>u.team===attackerTeam);
  const defender=g.units.filter(u=>u.team===1-attackerTeam);
  assert.equal(attacker.length,4);assert.equal(defender.length,4);
  const cards=[
   {team:attackerTeam,unitId:attacker[0].id,cardId:'Alpha',cost:2,gunnery:2,piloting:4},
   {team:1-attackerTeam,unitId:defender[0].id,cardId:'Beta',cost:2,gunnery:3,piloting:4}
  ];
  const mirrors=[
   {sourceTeam:attackerTeam,unitId:defender[1].id},
   {sourceTeam:1-attackerTeam,unitId:attacker[1].id}
  ];
  assert(g.setupForces.type==='agoac-printed-records');
  assert.equal(g.configureScenarioCards({cards:[cards[0],{...cards[1],cost:1}],mirrors,agreedCost:2}).ok,false);
  assert.equal(g.scenario.cardSetup,undefined);
  const applied=g.configureScenarioCards({cards,mirrors,agreedCost:2});
  assert(applied.ok);assert.equal(applied.cost,2);assert.equal(applied.die,null);
  assert.deepEqual([attacker[0].gunnery,attacker[0].piloting],[2,4]);
  assert.deepEqual([defender[0].gunnery,defender[0].piloting],[3,4]);
  assert.deepEqual([defender[1].gunnery,defender[1].piloting],[2,4]);
  assert.deepEqual([attacker[1].gunnery,attacker[1].piloting],[3,4]);
  assert(g.units.slice(2).some(u=>!u.scenarioCard),'unmodified printed pilots remain original');
  assert.equal(g.configureScenarioCards({cards,mirrors,agreedCost:2}).ok,false);
  const started=beginPrintedScenarioTest(g);
  assert(started.ok,'printed roster allows *authorized* card skills');
  assert.equal(started.steps,8);
  assert.equal(g.configureScenarioCards({cards,mirrors,agreedCost:2}).ok,false,
   'cannot change cards after deployment begins');
  // A booked card never substitutes for the printed BattleMech identity.
  const forged=await chapter11SourceGame('final-exam',attackerTeam);
  const forgedAttack=forged.units.filter(u=>u.team===attackerTeam);
  const forgedDef=forged.units.filter(u=>u.team===1-attackerTeam);
  const forgedCards=cards.map((c,i)=>({...c,unitId:i===0?forgedAttack[0].id:forgedDef[0].id}));
  const forgedMirrors=mirrors.map((m,i)=>({...m,unitId:i===0?forgedDef[1].id:forgedAttack[1].id}));
  assert(forged.configureScenarioCards({cards:forgedCards,mirrors:forgedMirrors,agreedCost:2}).ok);
  forgedAttack[0].gunnery=0;
  assert.equal(forged.beginPrintedScenarioPlacement().ok,false,'unapproved skill change must not bypass roster');
  forgedAttack[0].gunnery=2;
  forgedAttack[0].variant='LCT-1E';
  assert.equal(forged.beginPrintedScenarioPlacement().ok,false,'card cannot disguise variant substitution');
 }
});

test('CAT3500D p.48: all D6 card costs are binding on actual source Mech rosters with no double roll',async()=>{
 for(let die=1;die<=6;die++){
  const g=await chapter11SourceGame('final-exam');
  const atk=g.units.filter(u=>u.team===g.scenario.attackerTeam);
  const def=g.units.filter(u=>u.team===g.scenario.defenderTeam);
  const cost=Math.floor(die/2),cards=[
   {team:atk[0].team,unitId:atk[0].id,cardId:'Cost A',cost,gunnery:3,piloting:4},
   {team:def[0].team,unitId:def[0].id,cardId:'Cost B',cost,gunnery:3,piloting:4}
  ];
  const mirrors=[
   {sourceTeam:atk[0].team,unitId:def[1].id},
   {sourceTeam:def[0].team,unitId:atk[1].id}
  ];
  const rolls=[(die-.5)/6];
  g.rng=()=>{assert(rolls.length);return rolls.shift();};
  const r=g.configureScenarioCards({cards,mirrors});
  assert(r.ok,'valid result for die '+die);
  assert.equal(r.die,die);assert.equal(r.cost,cost);
  assert.equal(rolls.length,0);
  assert.equal(g.phaseRolls.at(-1).dice.length,1);
  assert(beginPrintedScenarioTest(g).ok,'allowed cost does not block scenario setup');
 }
 const g=await chapter11SourceGame('final-exam');
 const atk=g.units.filter(u=>u.team===g.scenario.attackerTeam),
  def=g.units.filter(u=>u.team===g.scenario.defenderTeam);
 const cards=[
  {team:atk[0].team,unitId:atk[0].id,cardId:'A',cost:2,gunnery:3,piloting:4},
  {team:def[0].team,unitId:def[0].id,cardId:'B',cost:2,gunnery:3,piloting:4}
 ];
 const mirrors=[
  {sourceTeam:atk[0].team,unitId:def[1].id},
  {sourceTeam:def[0].team,unitId:atk[1].id}
 ];
 const old=JSON.stringify(g.units);
 g.rng=()=>.99;
 const rejected=g.configureScenarioCards({cards,mirrors});
 assert.equal(rejected.ok,false);assert.equal(rejected.chosenCost,3);
 assert.equal(JSON.stringify(g.units),old,'rejected cost cannot mutate actual MTF pilots');
 assert.deepEqual(g.scenario.cardCostRoll,{die:6,cost:3});
 g.rng=()=>{throw Error('D6 fallback must not be rerolled');};
 assert.equal(g.configureScenarioCards({cards,mirrors,agreedCost:3}).ok,false,'cannot supersede established D6 by agreement');
 assert(g.configureScenarioCards({cards:cards.map(c=>({...c,cost:3})),mirrors}).ok);
 assert(beginPrintedScenarioTest(g).ok);
});

test('CAT3500D p.47: source Trial by Fire chase provides defender-only turn and west attacker arrival on second Movement',async()=>{
 for(const rotation of [[0,0],[3,0]]){
  const g=await chapter11SourceGame('trial-by-fire',0,rotation);
  const defender=g.units.find(u=>u.team===g.scenario.defenderTeam);
  const attackers=g.units.filter(u=>u.team===g.scenario.attackerTeam);
  assert.equal(defender.variant,'BLR-1G');assert.equal(attackers.length,3);
  assert(g.configureTrialByFireChase().ok);
  assert.equal(g.configureTrialByFireChase().ok,false);
  const setup=beginPrintedScenarioTest(g);
  assert(setup.ok);assert.equal(setup.steps,1);
  assert.equal(g.scenario.placement.complete,false);
  assert.equal(g.placePrintedScenarioMech(attackers[0].id,0,0).ok,false,'attacker may not enter during initial placement');
  const home=g.tiles.find(tile=>g.scenarioZoneAllowed(defender.team,tile.q,tile.r)&&tile.type==='plain');
  assert(home);
  assert(g.placePrintedScenarioMech(defender.id,home.q,home.r,4).ok);
  assert(g.scenario.placement.complete);
  for(const u of attackers){
   assert.equal(u.deployed,false);assert.equal(u.scenarioArrivalRound,2);
   assert.equal(u.scenarioReserve,'trial-by-fire-chase');
   assert.equal(g.deploymentEntryRoutes(u,'walk').length,0);
  }
  assert.equal(g.nextPhase().ok,false,'source BLR-1G pre-damage still mandatory');
  g.rng=()=>.5;
  assert(g.applyTrialByFirePreDamage(defender.id).ok);
  const stored=attackers[0].armor.CT;attackers[0].heat=7;attackers[0].pendingHeat=3;
  assert(g.nextPhase().ok);
  assert.equal(g.round,1);assert.equal(g.phase,'move');
  assert.deepEqual(g.queue,[defender.team]);
  assert(g.hold(defender.id).ok);
  assert(g.nextPhase().ok);assert.equal(g.phase,'fire');
  assert.deepEqual(g.queue,[defender.team]);
  assert(g.hold(defender.id).ok);
  assert(g.nextPhase().ok);assert.equal(g.phase,'physical');
  assert(g.hold(defender.id).ok);
  assert(g.nextPhase().ok);assert.equal(g.phase,'heat');
  assert(g.nextPhase().ok);assert.equal(g.phase,'end');
  assert.equal(attackers[0].heat,7);
  assert.equal(attackers[0].pendingHeat,3);
  assert.equal(attackers[0].armor.CT,stored);
  assert(g.nextPhase().ok);assert.equal(g.round,2);assert.equal(g.phase,'initiative');
  const dice=[...diceFor(12),...diceFor(2)];
  g.rng=()=>{assert(dice.length);return dice.shift();};
  assert(g.nextPhase().ok);assert.equal(g.phase,'move');
  assert.equal(g.queue.filter(t=>t===g.scenario.attackerTeam).length,3);
  g.activeTeam=g.scenario.attackerTeam;g.actingId=null;
  const routes=g.deploymentEntryRoutes(attackers[0],'walk');
  const route=routes.find(x=>x.path.length===1&&!x.transit);
  assert(route,'a real Desert #2 west-edge first hex is accessible');
  assert(g.deploymentEdgeTiles(0).some(t=>t.q===route.q&&t.r===route.r));
  const arrived=g.enterDeployment(attackers[0],route.q,route.r,'walk');
  assert(arrived.ok);assert.equal(arrived.entry,true);
  assert.equal(attackers[0].deployed,true);
  assert.equal(attackers[0].spent,route.cost);
  assert.equal(attackers[0].distanceMoved,1);
  assert.deepEqual(attackers[0].moveStart,route.entryFrom);
  assert.equal(g.enterDeployment(attackers[0],route.q,route.r,'walk').ok,false);
 }
});

test('CAT3500D p.48: source Final Exam survivor damage and ammunition enter real Divide on Turn 5 west edge',async()=>{
 const source=await chapter11SourceGame('final-exam');
 chapter11SourceDeployAll(source);
 const sourceTeam=source.scenario.defenderTeam;
 const survivors=source.units.filter(u=>u.team===sourceTeam).slice(0,2);
 const lost=source.units.find(u=>u.team===sourceTeam&&!survivors.includes(u));
 assert.equal(survivors.length,2);
 source.winner=sourceTeam;
 const first=survivors[0];
 assert.equal(first.variant,'CPLT-C1');
 first.armor.CT-=8;first.rear.CT-=2;first.structure.LA-=1;
 first.crit.LA[0]=true;first.pilotWounds=1;first.heat=9;
 assert(first.bins.length,'true Catapult has LRM ammunition');
 first.bins[0].shots=Math.max(0,first.bins[0].shots-3);
 survivors[1].gyroHits=1;
 lost.dead=true;
 const snapshot=survivors.map(u=>structuredClone({
  armor:u.armor,rear:u.rear,structure:u.structure,crit:u.crit,
  bins:u.bins,heat:u.heat,pilotWounds:u.pilotWounds,gyroHits:u.gyroHits,
  name:u.name,variant:u.variant,pilot:u.pilot
 }));
 const target=await chapter11SourceGame('divide-and-conquer');
 assert.equal(target.setupMap.printedScenario,'divide-and-conquer');
 assert.equal(target.units.length,10);
 assert.equal(target.configureLinkedScenarioReinforcements({
  sourceGame:source,sourceIds:[lost.id]}).ok,false,'dead source is ineligible');
 assert.equal(target.configureLinkedScenarioReinforcements({
  sourceGame:source,sourceIds:[survivors[0].id,survivors[0].id]}).ok,false,'duplicate source is invalid');
 const added=target.configureLinkedScenarioReinforcements({
  sourceGame:source,sourceIds:survivors.map(u=>u.id)});
 assert(added.ok);assert.equal(added.arrivalRound,5);assert.equal(added.entryEdge,0);
 assert.equal(target.scenario.campaign.exactMapImplemented,true);
 assert.equal(target.scenario.campaign.recordSheetsImported,true);
 const imported=added.unitIds.map(id=>target.unit(id));
 assert.equal(imported.length,2);assert.equal(target.units.length,12);
 for(const [idx,u] of imported.entries()){
  for(const field of Object.keys(snapshot[idx]))assert.deepEqual(u[field],snapshot[idx][field],field);
  assert.equal(u.team,target.scenario.defenderTeam);
  assert.equal(u.deployed,false);assert.equal(u.scenarioArrivalRound,5);
  assert.equal(u.scenarioReserve,'linked-scenario');
 }
 assert.notEqual(imported[0].armor,survivors[0].armor);
 const preserved=imported[0].armor.CT;survivors[0].armor.CT--;
 assert.equal(imported[0].armor.CT,preserved);
 chapter11SourceDeployAll(target);
 assert.equal(target.scenario.placement.placed.length,10,
  'reinforcements never replace the source-correct initial 6+4 deployment');
 target.round=4;target.phase='initiative';
 const roll4=[...diceFor(12),...diceFor(2)];
 target.rng=()=>roll4.shift()??.5;
 target.initiative();
 assert.equal(target.phase,'move');
 assert.equal(target.queue.length,10);
 target.activeTeam=target.scenario.defenderTeam;target.actingId=null;
 assert.equal(target.canAct(imported[0]),false);
 assert.equal(target.deploymentEntryRoutes(imported[0],'walk').length,0);
 target.phase='heat';target.heatPhase();
 assert.equal(imported[0].heat,9,'offboard reinforcements do not cool or gain heat');
 target.round=5;target.phase='initiative';
 const roll5=[...diceFor(12),...diceFor(2)];
 target.rng=()=>roll5.shift()??.5;
 target.initiative();
 assert.equal(target.phase,'move');assert.equal(target.queue.length,12);
 target.activeTeam=target.scenario.defenderTeam;target.actingId=null;
 const route=target.deploymentEntryRoutes(imported[0],'walk').find(x=>x.path.length===1&&!x.transit);
 assert(route,'source Desert #2 has an accessible western reinforcement edge');
 assert(target.deploymentEdgeTiles(0).some(tile=>tile.q===route.q&&tile.r===route.r));
 const arrived=target.enterDeployment(imported[0],route.q,route.r,'walk');
 assert(arrived.ok);assert.equal(arrived.entry,true);assert.equal(imported[0].deployed,true);
 assert.equal(imported[0].spent,route.cost);assert.equal(imported[0].distanceMoved,1);
 assert.deepEqual(imported[0].moveStart,route.entryFrom);
 assert.equal(imported[0].armor.CT,preserved);
 assert.deepEqual(imported[0].bins,snapshot[0].bins);
 assert.equal(imported[0].pilotWounds,1);
});

test('CAT3500D pp.47-48: source setup rejects premature campaign import and forged card identities',async()=>{
 const source=await chapter11SourceGame('final-exam');
 chapter11SourceDeployAll(source);source.winner=source.scenario.defenderTeam;
 const survivor=source.units.find(u=>u.team===source.scenario.defenderTeam);
 const early=fresh();
 assert(early.configureScenario('divide-and-conquer').ok);
 early.scenario.sideRollWinner=0;
 assert(early.chooseScenarioSide(0,'attacker').ok);
 assert(early.configurePrintedScenarioMap().ok);
 assert.equal(early.configureLinkedScenarioReinforcements({
  sourceGame:source,sourceIds:[survivor.id]}).ok,false,
  'unloaded printed MTF roster cannot be displaced by campaign import');
 assert.equal(early.units.length,4);
 const game=await chapter11SourceGame('final-exam');
 const att=game.units.filter(u=>u.team===game.scenario.attackerTeam);
 const def=game.units.filter(u=>u.team===game.scenario.defenderTeam);
 const cards=[
  {team:att[0].team,unitId:att[0].id,cardId:'Same',cost:2,gunnery:2,piloting:4},
  {team:def[0].team,unitId:def[0].id,cardId:'Same',cost:2,gunnery:3,piloting:4}
 ];
 const mirrors=[
  {sourceTeam:att[0].team,unitId:def[1].id},
  {sourceTeam:def[0].team,unitId:att[1].id}
 ];
 assert(game.configureScenarioCards({cards,mirrors,agreedCost:2}).ok);
 game.units.find(u=>u.id===cards[0].unitId).scenarioCard.id='forged';
 assert.equal(game.beginPrintedScenarioPlacement().ok,false,'forged card ID rejected');
});
