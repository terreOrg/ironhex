import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Game,defaultMechWarriorSkills} from '../dist/engine.js';
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
