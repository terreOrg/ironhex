import assert from 'node:assert/strict';
import {Game,chargeTravelHexes,distance,CLUSTER_HITS} from '../dist/engine.js';
let count=0;const test=(name,fn)=>{fn();count++;console.log('PASS',name);};
function game(){const g=new Game({rng:()=>.5});for(const t of g.tiles)Object.assign(t,{type:'plain',height:0,surface:0,depth:0});return g;}
function acting(g,id,phase){g.phase=phase;g.activeTeam=g.units[id].team;g.queue=[g.activeTeam];g.actingId=null;}

test('Last critical slot hit this phase does not transfer later criticals (BMM p.46)',()=>{
 const g=game(),u=g.units[0];g.rng=()=>.5;g.phase='fire';
 u.slots.LT=Array(12).fill(null);u.slots.LT[0]='sink';u.crit.LT=Array(12).fill(false);
 const startCT=u.crit.CT.filter(Boolean).length;
 g.criticalHit(u,'LT');assert.equal(u.crit.LT[0],true);
 g.criticalHit(u,'LT');assert.equal(u.crit.CT.filter(Boolean).length,startCT);
 g.phase='physical';g.criticalHit(u,'LT');
 assert.equal(u.crit.CT.filter(Boolean).length,startCT+1);
});
test('Critical hits can transfer through multiple previously emptied locations (BMM p.46)',()=>{
 const g=game(),u=g.units[0];g.rng=()=>.5;
 u.slots.LA=Array(12).fill(null);u.slots.LT=Array(12).fill(null);
 g.criticalHit(u,'LA');
 assert.equal(u.crit.CT.filter(Boolean).length,1);
});
test('Critical hits in destroyed sections do not transfer to intact torsos (BMM p.46)',()=>{
 const g=game(),u=g.units[0];g.rng=()=>.5;
 u.slots.LT=Array(12).fill(null);
 g.criticalHit(u,'LT',true);
 assert.equal(u.crit.CT.filter(Boolean).length,0);
});
test('Ammunition explosion that destroys center torso kills pilot (BMM p.44)',()=>{
 const g=game(),u=g.units[0],bin=u.bins.find(b=>b.location==='RT');
 assert(bin);bin.shots=5;u.structure.RT=1;u.structure.CT=1;
 g.explode(u,bin);
 assert.equal(u.structure.CT,0);assert.equal(u.dead,true);assert.equal(u.pilotWounds,6);
});
test('Head destruction kills the pilot rather than only disabling the unit (BMM p.44)',()=>{
 const g=game(),u=g.units[0];g.destroyLocation(u,'HD');
 assert.equal(u.dead,true);assert.equal(u.pilotWounds,6);
});

test('Every supported launcher rack follows BattleMech Manual cluster table (BMM p.33)',()=>{
 const expected={
  2:[1,1,1,1,1,1,2,2,2,2,2],
  4:[1,2,2,2,2,3,3,3,3,4,4],
  5:[1,2,2,3,3,3,3,4,4,5,5],
  6:[2,2,3,3,4,4,4,5,5,6,6],
  10:[3,3,4,6,6,6,6,8,8,10,10],
  15:[5,5,6,9,9,9,9,12,12,15,15],
  20:[6,6,9,12,12,12,12,16,16,20,20]
 };
 assert.equal(Object.keys(CLUSTER_HITS).length,7);
 for(const [rack,rolls] of Object.entries(expected)){
  for(let i=0;i<11;i++)assert.equal(CLUSTER_HITS[rack][i],rolls[i],
   'rack '+rack+', 2D6 '+(i+2));
 }
});

test('Rear armor takes rear torso hits before structure',()=>{const g=game(),u=g.units[0],front=u.armor.CT;g.damage(u,'CT',3,{rear:true});assert.equal(u.rear.CT,4);assert.equal(u.armor.CT,front);assert.equal(u.structure.CT,18);});
test('Destroyed torso destroys attached arm and ammunition',()=>{const g=game(),u=g.units[0];g.destroyLocation(u,'RT');assert.equal(u.structure.RA,0);assert.equal(u.weapons[0].destroyed,true);assert.equal(u.weapons[1].ammo,0);});

test('MechWarrior consciousness rolls increase after each wound (BMM p.58)',()=>{
 const g=game(),u=g.units[0];g.rng=()=>.5;
 g.wound(u,2);
 assert.equal(u.pilotWounds,2);assert.equal(u.unconscious,false);
 const checks=g.phaseRolls.filter(r=>r.kind.includes('Сознание'));
 assert.equal(checks.length,2);assert.equal(checks[0].target,3);assert.equal(checks[1].target,5);
});
test('Failed first consciousness check stops later checks, not physical wounds (BMM p.58)',()=>{
 const g=game(),u=g.units[0];g.rng=()=>0;
 g.wound(u,2);
 assert.equal(u.pilotWounds,2);assert.equal(u.unconscious,true);
 assert.equal(g.phaseRolls.filter(r=>r.kind.includes('Сознание')).length,1);
});
test('Later pilot wounds do not reroll while unconscious (BMM p.58)',()=>{
 const g=game(),u=g.units[0];g.rng=()=>0;g.wound(u,1);
 assert.equal(u.unconscious,true);g.wound(u,2);
 assert.equal(u.pilotWounds,3);
 assert.equal(g.phaseRolls.filter(r=>r.kind.includes('Сознание')).length,1);
});
test('Sixth wound kills pilot without making a consciousness check (BMM p.58)',()=>{
 const g=game(),u=g.units[0];u.pilotWounds=5;g.rng=()=>.99;g.wound(u,1);
 assert.equal(u.dead,true);assert.equal(u.pilotWounds,6);
 assert.equal(g.phaseRolls.filter(r=>r.kind.includes('Сознание')).length,0);
});
test('Ammo explosion bypasses armor and wounds pilot twice',()=>{const g=game(),u=g.units[0];u.bins[0].shots=1;const a=u.armor.RT;g.explode(u,u.bins[0]);assert.equal(u.structure.RT,3);assert.equal(u.armor.RT,a);assert.equal(u.pilotWounds,2);});
test('A damaged gyro reduces stability, not base walking MP',()=>{const g=game(),u=g.units[0];u.gyroHits=1;assert.equal(g.psrMod(u),3);assert.equal(g.mp(u),5);u.actuators.LL.hip=true;assert.equal(g.mp(u),3);});
test('Heat reduces walk and derived run',()=>{const g=game(),u=g.units[0];u.heat=10;assert.equal(g.mp(u),3);assert.equal(g.mp(u,'run'),5);});
test('Run may not enter water; jump may land there',()=>{const g=game(),u=g.units[0],t=g.tile(-3,1);Object.assign(t,{type:'water',depth:1,height:-1,surface:0});acting(g,0,'move');assert(!g.reachable(u,'run').some(x=>x.q===t.q&&x.r===t.r));assert(g.reachable(u,'jump').some(x=>x.q===t.q&&x.r===t.r));});
test('Facing change consumes one movement point',()=>{const g=game();acting(g,0,'move');assert(g.rotate(0,1).ok);assert.equal(g.units[0].spent,1);assert.equal(g.units[0].facing,1);});

test('Facing changes cost one MP per hexside and reject over-budget or invalid turns',()=>{
 const g=game(),u=g.units[0];acting(g,0,'move');
 assert(g.rotate(0,3).ok);assert.equal(u.spent,3);assert.equal(u.facing,3);
 assert.equal(g.rotate(0,3).ok,false);assert.equal(u.spent,3);assert.equal(u.facing,3);
 assert.equal(g.rotate(0,1.5).ok,false);assert.equal(g.rotate(0,4).ok,false);
});
test('Jump landing in water uses an unmodified PSR regardless of depth (BMM p.19)',()=>{
 const g=game(),u=g.units[0],t=g.tile(u.q+1,u.r);
 Object.assign(t,{type:'water',depth:2,height:-2,surface:0});g.rng=()=>.99;
 acting(g,0,'move');assert(g.move(0,t.q,t.r,'jump').ok);
 assert.equal(g.phaseRolls[0].target,u.piloting);
 assert.equal(u.prone,false);
});
test('Failed water landing falls the full water depth before halving damage (BMM pp.19,57)',()=>{
 const g=game(),u=g.units[0],t=g.tile(u.q+1,u.r);
 Object.assign(t,{type:'water',depth:2,height:-2,surface:0});g.rng=()=>0;
 acting(g,0,'move');assert(g.move(0,t.q,t.r,'jump').ok);
 assert.equal(g.phaseRolls[0].target,u.piloting);
 assert.equal(u.prone,true);
 assert.equal(u.phaseDamage,Math.floor(Math.ceil(u.tonnage/10)*3/2));
});
test('Turn cannot advance while unit declarations remain',()=>{const g=game();acting(g,0,'move');assert.equal(g.nextPhase().ok,false);g.hold(0);assert(g.nextPhase().ok);assert.equal(g.phase,'fire');});
test('Shared MG pool cannot declare two shots with one round',()=>{const g=game(),u=g.units[3],t=g.units[0];u.q=0;u.r=0;u.facing=0;t.q=1;t.r=0;u.bins.find(b=>b.weapon===6).shots=1;g.syncAmmo(u);acting(g,3,'fire');assert.equal(g.declareFire(3,[{index:6,target:0},{index:7,target:0}]).ok,false);assert.equal(g.declarations.length,0);});



test('Split torso-arm weapon uses restrictive torso firing arc (TechManual p.57)',()=>{
 const g=game(),u=g.units[0],t=g.units[2];u.q=0;u.r=0;u.facing=0;t.q=-1;t.r=1;
 const gun={...u.weapons[0],location:'RA',rear:false,locations:['RA','RT']};
 assert.equal(g.arc(u,t,{...gun,locations:undefined}),true);
 assert.equal(g.arc(u,t,gun),false);
});
test('Fire from split torso-arm weapon occupies both mounts for later physical attacks (TechManual p.57)',()=>{
 const g=game(),u=g.units[0],t=g.units[2];u.q=0;u.r=0;u.facing=0;t.q=1;t.r=0;
 u.weapons[0].locations=['RA','RT'];acting(g,0,'fire');
 assert(g.declareFire(0,[{index:0,target:2}]).ok);g.resolveFire();
 assert(u.firedLocations.includes('RA'));assert(u.firedLocations.includes('RT'));
 assert.equal(g.physicalPreview(0,2,'punch','RA').legal,false);
});
test('Prone fire with both arms intact allows unbraced torso mounts (BMM p.30)',()=>{
 const g=game(),u=g.units[0],t=g.units[2];u.q=0;u.r=0;u.facing=0;t.q=4;t.r=0;u.prone=true;u.brace='LA';
 assert(g.preview(0,2,1).legal);
});
test('Missing either arm prevents prone firing under standard rules (BMM p.30)',()=>{
 const g=game(),u=g.units[0],t=g.units[2];u.q=0;u.r=0;u.facing=0;t.q=4;t.r=0;u.prone=true;u.brace='LA';
 u.structure.RA=0;assert.equal(g.preview(0,2,1).legal,false);
});
test('Prone bracing forbids split weapons occupying the braced arm (BMM p.30)',()=>{
 const g=game(),u=g.units[0],t=g.units[2];u.q=0;u.r=0;u.facing=0;t.q=4;t.r=0;u.prone=true;u.brace='LA';
 u.weapons[1].locations=['RT','LA'];assert.equal(g.preview(0,2,1).legal,false);
 u.weapons[1].locations=['RT'];assert(g.preview(0,2,1).legal);
});
test('Head aimed shot replaces immobile bonus with +3 (BMM p.30)',()=>{
 const g=game(),u=g.units[0],t=g.units[2];u.q=0;u.r=0;u.facing=0;u.gunnery=7;t.q=4;t.r=0;t.shutdown=true;
 const normal=g.preview(0,2,0),aimed=g.preview(0,2,0,{aim:'HD'});
 assert(normal.legal&&aimed.legal);assert.equal(normal.mods.target,-4);
 assert.equal(aimed.mods.target,0);assert.equal(aimed.mods.aim,3);
 assert.equal(aimed.targetNumber-normal.targetNumber,7);
});
test('Cluster launchers cannot aim even at immobile targets (BMM p.30)',()=>{
 const g=game(),u=g.units[0],t=g.units[2];u.q=0;u.r=0;u.facing=0;t.q=4;t.r=0;t.shutdown=true;
 assert.equal(g.preview(0,2,1,{aim:'CT'}).legal,false);
 acting(g,0,'fire');assert.equal(g.declareFire(0,[{index:1,target:2,aim:'CT'}]).ok,false);
});
test('Aimed fire against a mobile mech is disallowed (BMM p.30)',()=>{
 const g=game(),u=g.units[0],t=g.units[2];u.q=0;u.r=0;u.facing=0;t.q=4;t.r=0;
 assert.equal(g.preview(0,2,0,{aim:'CT'}).legal,false);
 acting(g,0,'fire');assert.equal(g.declareFire(0,[{index:0,target:2,aim:'CT'}]).ok,false);
});
test('Aimed fire ignores partial-cover penalty but cannot target hidden legs (BMM p.30)',()=>{
 const g=game(),u=g.units[0],t=g.units[2];u.q=0;u.r=0;u.facing=0;t.q=4;t.r=0;t.shutdown=true;
 Object.assign(g.tile(4,0),{type:'water',depth:1,height:-1,surface:0});
 const normal=g.preview(0,2,0),aimed=g.preview(0,2,0,{aim:'CT'});
 assert.equal(normal.mods.cover,1);assert.equal(aimed.mods.cover,0);
 assert(aimed.legal);assert.equal(g.preview(0,2,0,{aim:'LL'}).legal,false);
});
test('Aimed fire rerolls leg locations obscured by cover (BMM p.30)',()=>{
 const g=game(),u=g.units[2],dice=[.2,.35,.55,.35];g.rng=()=>dice.shift()??.55;
 const prev=u.armor.CT,out=g.hit(u,3,'front','normal','CT',true);
 assert.equal(out.location,'CT');assert.equal(out.damage,3);
 assert.equal(u.armor.CT,prev-3);assert.equal(g.phaseRolls.length,2);
});
test('Declared shot survives destruction of shooter',()=>{const g=game(),u=g.units[0],t=g.units[2];u.q=0;u.r=0;u.facing=0;t.q=4;t.r=0;acting(g,0,'fire');assert(g.declareFire(0,[{index:0,target:2}]).ok);u.dead=true;g.resolveFire();assert.equal(g.resolution.length,1);assert.equal(u.pendingHeat,10);});
test('Two punches declare two independent attack rolls',()=>{const g=game(),u=g.units[0],t=g.units[2];u.q=0;u.r=0;u.facing=0;t.q=1;t.r=0;acting(g,0,'physical');assert(g.declarePhysical(0,2,'punch','both').ok);assert.equal(g.physicalDeclarations.length,2);g.resolvePhysical();assert.equal(g.resolution.length,2);});
test('First involuntary reactor shutdown PSR can succeed (BMM p.52)',()=>{const g=game(),u=g.units[0];g.rng=()=>.99;u.heat=30;u.sinks=0;g.heatPhase();assert.equal(u.shutdown,true);assert.equal(u.prone,false);});

test('Failed initial heat shutdown PSR causes fall and automatic pilot injury (BMM pp.52,54)',()=>{
 const g=game(),u=g.units[0];u.heat=30;u.sinks=0;u.piloting=9;g.rng=()=>.5;
 g.heatPhase();assert.equal(u.shutdown,true);assert.equal(u.prone,true);
 assert.equal(u.pilotWounds,1);
});
test('Any subsequent PSR after reactor shutdown fails automatically (BMM p.53)',()=>{
 const g=game(),u=g.units[0];g.rng=()=>.5;u.shutdown=true;
 assert.equal(g.psr(u,0,'Другой манёвр',true),false);
 assert.equal(u.prone,true);assert.equal(u.pilotWounds,1);
});
test('Voluntary shutdown occurs in End Phase without causing a PSR (BMM p.52)',()=>{
 const g=game(),u=g.units[0];u.shutdownNext=true;g.endPhase();
 assert.equal(u.shutdown,true);assert.equal(u.voluntaryShutdown,true);
 assert.equal(u.prone,false);assert.equal(u.pilotWounds,0);
});
test('Voluntary shutdown persists across Heat Phase and restarts only when ordered at End Phase',()=>{
 const g=game(),u=g.units[0];u.shutdownNext=true;g.endPhase();
 g.heatPhase();assert.equal(u.shutdown,true);
 acting(g,0,'move');assert(g.orderShutdown(0).ok);g.endPhase();
 assert.equal(u.shutdown,false);assert.equal(u.voluntaryShutdown,false);
});
test('Voluntary reactor restart is forbidden at heat 30+ (BMM p.52)',()=>{
 const g=game(),u=g.units[0];u.shutdownNext=true;g.endPhase();
 u.heat=30;u.sinks=0;acting(g,0,'move');assert(g.orderShutdown(0).ok);
 g.endPhase();assert.equal(u.shutdown,true);assert.equal(u.voluntaryShutdown,true);
});
test('Losing one leg permits walking but not ordinary running or evasion (BMM p.45)',()=>{
 const g=game(),u=g.units[0];u.structure.LL=0;
 assert.equal(g.mp(u,'walk'),1);assert.equal(g.mp(u,'run'),0);
 acting(g,0,'move');assert.equal(g.reachable(u,'run').length,0);
 assert.equal(g.reachable(u,'evade').length,0);
 assert(g.minimumMove(0).ok);assert.equal(u.spent,1);
});
test('Destroyed hip or entire leg replaces same-leg PSR actuator modifiers (BMM p.54)',()=>{
 const g=game(),u=g.units[0];
 Object.assign(u.actuators.LL,{hip:true,upper:true,lower:true,foot:true});
 assert.equal(g.psrMod(u),2);
 u.structure.LL=0;u.actuators.RL.upper=true;
 assert.equal(g.psrMod(u),6);
});
test('Cold shutdown reactor restarts',()=>{const g=game(),u=g.units[0];u.shutdown=true;u.heat=5;g.heatPhase();assert.equal(u.shutdown,false);assert.equal(u.heat,0);});

test('A one-legged prone BattleMech may attempt to stand even though it cannot run (BMM p.45)',()=>{
 const g=game(),u=g.units[0];u.structure.LL=0;u.prone=true;g.rng=()=>.99;
 acting(g,0,'move');assert.equal(g.mp(u,'run'),0);
 const result=g.stand(0);assert(result.ok,result.error);
 assert.equal(u.prone,false);assert.equal(u.moveMode,'run');assert.equal(u.spent,2);
});
test('A one-legged BattleMech gets one stand attempt per turn (BMM p.45)',()=>{
 const g=game(),u=g.units[0];u.structure.LL=0;u.prone=true;u.piloting=10;g.rng=()=>0;
 acting(g,0,'move');assert(g.stand(0).ok);assert.equal(u.prone,true);
 assert.equal(u.standAttempts,1);assert.equal(g.stand(0).ok,false);
});
test('A missing leg plus both missing arms forbids standing (BMM p.19)',()=>{
 const g=game(),u=g.units[0];u.structure.LL=0;u.structure.LA=0;u.structure.RA=0;u.prone=true;
 acting(g,0,'move');assert.equal(g.stand(0).ok,false);
});
test('Destroyed gyro prevents standing',()=>{const g=game(),u=g.units[0];acting(g,0,'move');u.prone=true;u.gyroHits=2;assert.equal(g.stand(0).ok,false);});

test('Charge distance uses moved hexes, not shortest hex distance (BMM p.35)',()=>{
 const g=game(),u=g.units[0],t=g.units[2],start={q:-2,r:0};
 Object.assign(u,{...start,facing:0});Object.assign(t,{q:1,r:1,moved:true});
 const blocked=[[-2,-1],[-2,1],[-2,2],[-1,-2],[-1,3],[0,-2],[0,0],[0,1],[0,2],[1,3],[2,-1],[2,0],[3,0],[3,1]];
 for(const [q,r] of blocked)Object.assign(g.tile(q,r),{height:4,surface:4});
 acting(g,0,'move');assert(g.declareCharge(0,2).ok);
 assert.equal(u.distanceMoved,4);assert.equal(distance(start,u),3);
 assert.equal(u.charge.hexes,4);
});
test('Charge movement damage ignores hexes before last forward/backward reversal (BMM p.35)',()=>{
 const path=[{q:1,r:0,facing:0},{q:0,r:0,facing:0},{q:-1,r:0,facing:0},{q:0,r:0,facing:0}];
 assert.equal(chargeTravelHexes({q:0,r:0},path),1);
 assert.equal(chargeTravelHexes({q:0,r:0},[{q:0,r:0,facing:1},{q:1,r:0,facing:0}]),1);
});
test('Walking charges are permitted, evasion and unknown charge types are rejected (BMM p.35)',()=>{
 const g=game(),u=g.units[0],t=g.units[2];u.q=-2;u.r=0;u.facing=0;t.q=1;t.r=0;t.moved=true;
 acting(g,0,'move');assert.equal(g.declareCharge(0,2,'charge','evade').ok,false);
 assert.equal(g.declareCharge(0,2,'teleport','run').ok,false);
 const r=g.declareCharge(0,2,'charge','walk');assert(r.ok,r.error);
 assert.equal(u.moveMode,'walk');assert(u.charge.hexes>=1);
});
test('Charge declaration requires target movement complete',()=>{const g=game(),u=g.units[0],t=g.units[2];acting(g,0,'move');u.q=-2;u.r=0;u.facing=0;t.q=1;t.r=0;assert.equal(g.declareCharge(0,2).ok,false);t.moved=true;assert(g.declareCharge(0,2).ok);assert.equal(u.charge.type,'charge');assert.equal(g.preview(0,2,0).legal,false);});

test('Ammunition being dumped remains in the bin but cannot be fired (BMM p.58)',()=>{
 const g=game(),u=g.units[0];const bin=u.bins[0],pool=bin.weapon;
 assert.equal(u.weapons[pool].ammo,24);
 u.dumping=[0];g.syncAmmo(u);
 assert.equal(bin.shots,12);assert.equal(bin.destroyed,false);
 assert.equal(u.weapons[pool].ammo,12);
});
test('Explicitly choosing a dumping bin for fire is rejected (BMM p.58)',()=>{
 const g=game(),u=g.units[0],t=g.units[2];u.q=0;u.r=0;u.facing=0;t.q=4;t.r=0;
 u.dumping=[0];g.syncAmmo(u);
 acting(g,0,'fire');
 assert.equal(g.declareFire(0,[{index:1,target:2,bin:0}]).ok,false);
 assert.equal(g.declareFire(0,[{index:1,target:2,bin:1}]).ok,true);
});
test('Rear torso strike ignites all actively dumped explosive ammunition bins (BMM p.58)',()=>{
 const g=game(),u=g.units[0],attacker=g.units[2];
 u.dumping=[0,1];attacker.q=2;attacker.r=0;g.rng=()=>.99;
 g.declarations=[{id:2,shots:[{index:0,target:0,weapon:{name:'Test Laser',damage:1,heat:0,ammo:null},
  preview:{targetNumber:2,side:'rear',cover:false},aim:null,bin:null,heatMode:false}]}];
 g.hit=()=>({location:'CT',hits:[],damage:1});
 g.resolveFire();
 assert.equal(u.bins[0].shots,0);assert.equal(u.bins[1].shots,0);
 assert.equal(u.bins[0].destroyed,true);assert.equal(u.bins[1].destroyed,true);
});

test('Dump completes at end of following turn',()=>{const g=game(),u=g.units[0];acting(g,0,'move');assert(g.orderDump(0,0).ok);g.endPhase();assert.equal(u.bins[0].shots,12);g.endPhase();assert.equal(u.bins[0].shots,0);});
test('Flamer heat mode adds heat without armor damage',()=>{const g=game(),u=g.units[0],t=g.units[2];u.q=0;u.r=0;u.facing=0;t.q=1;t.r=0;u.weapons[0]={name:'Flamer',damage:2,heat:3,ranges:[1,2,3],min:0,ammo:null,location:'RA',rack:0};acting(g,0,'fire');const before=JSON.stringify(t.armor);assert(g.declareFire(0,[{index:0,target:2,heatMode:true}]).ok);g.resolveFire();assert.equal(t.pendingHeat,2);assert.equal(JSON.stringify(t.armor),before);});
test('Selected ammunition bin is decremented',()=>{const g=game(),u=g.units[0],t=g.units[2];u.q=-4;u.r=0;u.facing=0;t.q=4;t.r=0;acting(g,0,'fire');assert(g.declareFire(0,[{index:1,target:2,bin:1}]).ok);g.resolveFire();assert.equal(u.bins[0].shots,12);assert.equal(u.bins[1].shots,11);});
for(let seed=1;seed<=8;seed++)test('Full AI battle seed '+seed,()=>{let state=seed;const g=new Game({rng:()=>((state=(Math.imul(state,1664525)+1013904223)>>>0)/2**32)});let steps=0;while(g.winner===null&&steps++<600){if(['move','fire','physical'].includes(g.phase)&&g.queue.length){const u=g.units.find(u=>g.canAct(u));assert(u,'queue must have an actionable unit');const r=g.phase==='move'?g.aiMove(u.id):g.phase==='fire'?g.aiAttack(u.id):g.aiPhysical(u.id);assert(r.ok,r.error);}else assert(g.nextPhase().ok);for(const u of g.units){assert(Number.isFinite(u.heat));assert(u.heat>=0);assert(Object.values(u.structure).every(n=>n>=0));assert(u.bins.every(b=>b.shots>=0));}}assert(g.winner!==null||g.round>20,'battle must finish or continue advancing rounds');});
console.log(`${count} combat checks passed`);
