import {Game as Legacy,LOCATIONS,DIRS,distance} from './legacy-engine.js';
import {construct} from './construction.js';
export {LOCATIONS,DIRS,distance};
// AGoAC pp.3–4: logical game scale; visual model dimensions remain illustrative.
// Digital battlefield presets, not reproductions of the printed mapsheets.
export const AGOAC_MAP_PRESETS=Object.freeze([
 Object.freeze({id:'frontier',name:'Приграничье'}),
 Object.freeze({id:'clear',name:'Открытая равнина'}),
 Object.freeze({id:'woodland',name:'Лесной рубеж'}),
 Object.freeze({id:'river',name:'Речная долина'})
]);
export const AGOAC_SCALE=Object.freeze({hexMeters:30,levelMeters:6,turnSeconds:10,standingMechLevels:2});
export const rangeMeters=(a,b)=>distance(a,b)*AGOAC_SCALE.hexMeters;
export const elapsedBattleSeconds=round=>Math.max(0,round-1)*AGOAC_SCALE.turnSeconds;
 // AGoAC pp.3–4: an unmarked hex is clear and independently level zero.
 // The stored elevation is ground/bed height; a water surface is above it.
 // Preserve explicit values and metadata from existing battles.
export function normalizeMapHex(tile){
 tile.depth??=0;
 if(tile.type==null||tile.type==='')tile.type=tile.depth>0?'water':'plain';
 tile.height??=tile.depth>0?(tile.surface??0)-tile.depth:0;
 tile.surface??=tile.height+tile.depth;
 return tile;
}
const quadLegNames=Object.freeze({
 LA:'Левая передняя нога',RA:'Правая передняя нога',
 LL:'Левая задняя нога',RL:'Правая задняя нога'
});
// BMM p.26: for a Quad, front and rear limbs all count as legs
// when partial cover (including Depth 1 water) protects locations.
export function mechLegLocation(u,location){
 return (u?.config==='Quad'?['LA','RA','LL','RL']:['LL','RL']).includes(location);
}
// BMM p.30: with four functional legs and no hip criticals, a prone
// Quad fires as if standing. Crit slot zero is the hip actuator in each
// leg; check both damage flags and slot records for imported/restored units.
// BMM p.45: four destroyed Quad legs render the chassis immobile.
 // A Quad with three lost legs or four hip criticals has 0 MP, but is
 // explicitly *not* immobile, so it cannot be aimed at as immobile.
export function quadImmobileDueToLegLoss(u){
 return u?.config==='Quad'&&['LA','RA','LL','RL'].every(loc=>
  (u.structure?.[loc]??0)<=0);
}
export function quadProneFireBonus(u){
 return u?.config==='Quad'&&['LA','RA','LL','RL'].every(loc=>
   (u.structure?.[loc]??0)>0 &&
   !u.actuators?.[loc]?.hip &&
   !u.crit?.[loc]?.[0] &&
   !u.breached?.includes(loc));
}
// AGoAC pp.26,28,32–33: absent arm actuators count for physical
// attacks, not weapon fire; the equipment slots describe the design.
function physicalArmActuators(u,loc){
 const a=u.actuators[loc]||{},slots=u.slots[loc]||[];
 return {shoulder:!!a.shoulder,upper:!!a.upper||!slots.includes('upper'),
  lower:!!a.lower||!slots.includes('lower'),hand:!!a.hand||!slots.includes('hand')};
}
function clubArmsAvailable(u){
 return ['LA','RA'].every(l=>u.structure[l]>0&&!physicalArmActuators(u,l).shoulder&&!physicalArmActuators(u,l).hand);
}
export function partialCoverObscures(u,location,underwaterCover=false){
 const leg=mechLegLocation(u,location);
 return underwaterCover?!leg:leg;
}
export function locationNameForMech(mech,loc){
 return (mech?.config==='Quad'&&quadLegNames[loc])||LOCATIONS[loc]||loc;
}
// BMM corrected sixth printing, p.15: only a quad with all four legs
// may shift without turning. Rearward lateral movement is walking-only.
export function quadLateralDirections(u,mode='walk'){
 if(u?.config!=='Quad'||!['walk','run','evade'].includes(mode)||
   ['LA','RA','LL','RL'].some(loc=>(u.structure?.[loc]??0)<=0))return [];
 const shifts=[
  {action:'shift-left-forward',offset:1,backward:false},
  {action:'shift-right-forward',offset:-1,backward:false}
 ];
 if(mode==='walk')shifts.push(
  {action:'shift-left-backward',offset:2,backward:true},
  {action:'shift-right-backward',offset:-2,backward:true});
 return shifts;
}
const wrap=n=>(n%6+6)%6, key=(q,r)=>q+','+r, fail=error=>({ok:false,error});
const transfer={LA:'LT',RA:'RT',LL:'LT',RL:'RT',LT:'CT',RT:'CT'};
const front=['CT','RA','RA','RL','RT','CT','LT','LL','LA','LA','HD'],left=['LT','LL','LA','LA','LL','LT','CT','RT','RA','RL','HD'],right=['RT','RL','RA','RA','RL','RT','CT','LT','LA','LL','HD'];
// BattleMech Manual (2022), Cluster Hits Table, printed p.33 (PDF p.35).
// Table indexes are roll - 2; columns are launcher / rack size.
export const CLUSTER_HITS={2:[1,1,1,1,1,1,2,2,2,2,2],4:[1,2,2,2,2,3,3,3,3,4,4],5:[1,2,2,3,3,3,3,4,4,5,5],6:[2,2,3,3,4,4,4,5,5,6,6],10:[3,3,4,6,6,6,6,8,8,10,10],15:[5,5,6,9,9,9,9,12,12,15,15],20:[6,6,9,12,12,12,12,16,16,20,20]};
export const UNDERWATER_RANGES=Object.freeze({
 'Small Laser':[1,2,2],'Medium Laser':[2,4,6],'Large Laser':[3,6,9],
 PPC:[4,7,10],
 'ER Small Laser':[1,2,3],'ER Medium Laser':[3,5,8],
 'ER Large Laser':[3,9,12],'ER PPC':[4,10,16],
 'Clan ER Small Laser':[1,2,4],'Clan ER Medium Laser':[3,7,10],
 'Clan ER Large Laser':[5,10,16],'Clan ER PPC':[4,10,16],
 'Small Pulse Laser':[1,2,2],'Medium Pulse Laser':[2,3,4],
 'Large Pulse Laser':[2,5,7],
 'Clan Small Pulse Laser':[1,2,4],'Clan Medium Pulse Laser':[3,5,8],
 'Clan Large Pulse Laser':[4,10,14]
});
// BattleMech Manual (2022), Skid Modifiers Table, printed p.68.
export const skidModifier=hexes=>{
 const n=Math.max(0,Math.trunc(hexes));
 return n>=25?6:n>=18?5:n>=11?4:n>=8?2:n>=5?1:n>=3?0:-1;
};
const clusters=CLUSTER_HITS;
const punch={front:['LA','LT','CT','RT','RA','HD'],rear:['LA','LT','CT','RT','RA','HD'],left:['LT','LT','CT','LA','LA','HD'],right:['RT','RT','CT','RA','RA','HD']};
// BMM corrected 6th (2022), printed pp.38-39, Four-Legged columns.
// Where the source lists Front/Rear pairs, the first value is used on a
// front hit and the second on a rear hit. Values are d6 results 1..6.
export const QUAD_PUNCH_LOCATIONS=Object.freeze({
 left:Object.freeze(['LT','LT','CT','LA','LL','HD']),
 front:Object.freeze(['LA','LT','CT','RT','RA','HD']),
 rear:Object.freeze(['LL','LT','CT','RT','RL','HD']),
 right:Object.freeze(['RT','RT','CT','RA','RL','HD'])
});
export const QUAD_KICK_LOCATIONS=Object.freeze({
 left:Object.freeze(['LA','LA','LA','LL','LL','LL']),
 front:Object.freeze(['RA','RA','RA','LA','LA','LA']),
 rear:Object.freeze(['RL','RL','RL','LL','LL','LL']),
 right:Object.freeze(['RA','RA','RA','RL','RL','RL'])
});
const conscious=[0,3,5,7,10,11,99], shut=h=>h>=30?99:h>=26?10:h>=22?8:h>=18?6:h>=14?4:0;
const armor=[[9,20,20,20,14,14,18,18],[8,20,20,20,16,16,16,16],[9,23,18,18,16,16,16,16],[9,30,24,24,20,20,29,29]],rears=[[7,6,6],[8,6,6],[8,6,6],[11,6,6]];
// BMM p.67, Moving into Buildings (ground-level-only support).
// Building metadata is optional on a map hex: {type, cf}. Do not treat
// this as support for basements, roof levels, collapse or involuntary entry.
export const BUILDING_ENTRY=Object.freeze({
 light:Object.freeze({mp:1,psr:0}),
 medium:Object.freeze({mp:2,psr:1}),
 heavy:Object.freeze({mp:3,psr:2}),
 hardened:Object.freeze({mp:4,psr:5})
});
export function buildingMovementPSRModifier(hexes){
 if(!Number.isFinite(hexes)||hexes<1)throw new RangeError('building_hex_count');
 return hexes>=25?6:hexes>=18?5:hexes>=10?4:
  hexes>=7?3:hexes>=5?2:hexes>=3?1:0;
}
export function buildingImpactSide(facing,from,to){
 if(!Number.isInteger(facing)||facing<0||facing>5)throw new RangeError('building_facing');
 const direction=DIRS.findIndex(d=>d[0]===to.q-from.q&&d[1]===to.r-from.r);
 if(direction<0)throw new RangeError('building_impact_requires_adjacent_hex');
 const offset=wrap(direction-facing);
 return offset===0?'front':offset===3?'rear':offset<=2?'left':'right';
}
export const PHASES={setup:'Развёртывание',initiative:'Инициатива',move:'Движение',fire:'Стрельба: декларации',physical:'Физические атаки',heat:'Нагрев',end:'Конец хода'};
function clone(o){return structuredClone(o);}
function roundHex(q,r){let s=-q-r,a=Math.round(q),b=Math.round(r),c=Math.round(s);if(Math.abs(a-q)>Math.abs(b-r)&&Math.abs(a-q)>Math.abs(c-s))a=-b-c;else if(Math.abs(b-r)>Math.abs(c-s))b=-a-c;return {q:a,r:b};}
// Charge damage counts actual hexes traversed, resetting after the most recent
// switch between forward and backward movement (BattleMech Manual, p.35).
export function chargeTravelHexes(start,path){
 let previous={q:start.q,r:start.r},wasBackward=null,count=0;
 for(const step of path){
  const dq=step.q-previous.q,dr=step.r-previous.r;
  if(dq===0&&dr===0)continue; // facing changes do not count as movement
  const dir=DIRS[wrap(step.facing)];
  const forward=dq===dir[0]&&dr===dir[1],backward=dq===-dir[0]&&dr===-dir[1];
  if(!forward&&!backward)throw Error('invalid_charge_path');
  if(wasBackward!==null&&wasBackward!==backward)count=0;
  count++;wasBackward=backward;
  previous={q:step.q,r:step.r};
 }
 return count;
}
// BattleMech Manual (2022), printed p.9, Default Skill Ratings.
// Explicitly assigned campaign pilots override these defaults.
export function defaultMechWarriorSkills(techBase='Inner Sphere'){
 return techBase==='Clan'?{gunnery:3,piloting:4}:{gunnery:4,piloting:5};
}
export class Game extends Legacy{
 reset(){super.reset();this.victoryTerms=null;this.victoryAdjudicated=false;this.deployment=null;this.setupForces=null;this.setupMap=null;this.pendingChoice=null;this._resolutionReplay=null;this.phase='initiative';this.queue=[];this.selectionBatch=null;this.activeTeam=null;this.actingId=null;this.deferConsciousness=false;this.declarations=[];this.physicalDeclarations=[];this.phaseRolls=[];this.resolution=[];this.afterRolls=[];this.weather={night:false,gale:false};this.tacticalOptions={standingStill:false,evading:false,floatingCriticals:false,underwaterFire:false};
 for(const t of this.tiles){t.depth=0;t.surface=t.height;if(t.q===0&&t.r>0&&t.r<4){t.type='water';t.depth=t.r===2?2:1;t.height=-t.depth;t.surface=0;}else if(t.q===1&&t.r===-2)t.type='rubble';else if(t.q===-1&&t.r===-2)t.type='rough';}
 this.rebuildMap();
 this.units.forEach((u,i)=>{const defaults=defaultMechWarriorSkills(u.techBase);u.gunnery=defaults.gunnery;u.piloting=defaults.piloting;Object.keys(LOCATIONS).forEach((l,j)=>u.armor[l]=armor[i][j]);u.maxArmor={...u.armor};u.rear={CT:rears[i][0],LT:rears[i][1],RT:rears[i][2]};u.maxRear={...u.rear};Object.assign(u,{pilotWounds:0,unconscious:false,wasUnconscious:false,prone:false,proneAtStart:false,engineHits:0,gyroHits:0,sensorHits:0,lifeSupport:false,psrs:[],consciousChecks:0,phaseDamage:0,externalHeat:0,breached:[],skidded:false,skidDirection:null,lastMovementDirection:null,tmmTravel:null,tmmReversalOffset:0,skidCollisionPending:null,spent:0,twist:0,flip:false,physicalDone:false,charge:null,club:false,sinksLost:0,jumpLost:0,dumping:[],dumpNext:[],shutdownNext:false,voluntaryShutdown:false,moveStart:{q:u.q,r:u.r},firedLocations:[],startProne:false,standAttempts:0});u.actuators={LA:{shoulder:false,upper:false,lower:false,hand:false},RA:{shoulder:false,upper:false,lower:false,hand:false},LL:{hip:false,upper:false,lower:false,foot:false},RL:{hip:false,upper:false,lower:false,foot:false}};
 if(i===2)u.weapons[3].location='CT';if(i===0)u.weapons[1].ammo=24;if(i===3){u.weapons.push({name:'Machine Gun A',damage:2,heat:0,ranges:[1,2,3],min:0,ammo:200,location:'LA',rack:0,shared:6});u.weapons.push({...u.weapons[6],name:'Machine Gun B'});}
 u.weapons.forEach(w=>{w.destroyed=false;w.rear=false;});u.slots={HD:['life','sensors','cockpit',null,'sensors','life'],CT:['engine','engine','engine','gyro','gyro','gyro','gyro','engine','engine','engine',null,null],LT:Array(12).fill(null),RT:Array(12).fill(null),LA:['shoulder','upper','lower','hand',...Array(8).fill(null)],RA:['shoulder','upper','lower','hand',...Array(8).fill(null)],LL:['hip','upper','lower','foot',null,null],RL:['hip','upper','lower','foot',null,null]};
 const set=(l,start,items)=>u.slots[l].splice(start-1,items.length,...items);if(i===0){set('RA',5,['w:0','w:0','w:0']);set('LT',1,['jump','jump']);set('RT',1,['jump','jump','w:1','w:1','ammo:1:12','ammo:1:12']);set('CT',11,['sink','jump']);}
 if(i===1){set('HD',4,['w:1']);set('RA',5,['w:0','w:0','w:0','w:0','ammo:0:20']);set('LT',1,['w:2','w:2','ammo:2:15']);set('RT',1,['sink']);set('CT',11,['jump']);set('LL',5,['jump','jump']);set('RL',5,['jump','jump']);}
 if(i===2){set('HD',4,['w:3']);set('RA',5,['w:1']);set('LT',1,['jump','w:0','w:0','w:0','w:0','ammo:0:20']);set('RT',1,['sink','jump','w:2','ammo:2:24']);set('CT',11,['jump','ammo:3:50']);}
 if(i===3){set('HD',4,['sink']);set('LA',5,['w:6','w:7','ammo:6:200']);set('RA',5,['w:0','w:0']);set('LT',1,['w:2','w:3','w:4']);set('RT',1,['w:1','w:1','w:1','w:5','ammo:5:50']);set('CT',11,['ammo:1:8','ammo:1:8']);set('LL',5,['sink','sink']);set('RL',5,['sink','sink']);}
 u.crit=Object.fromEntries(Object.entries(u.slots).map(([l,a])=>[l,a.map(()=>false)]));u.bins=[];for(const [l,slots]of Object.entries(u.slots))slots.forEach((s,ix)=>{if(s?.startsWith('ammo:')){const [,w,n]=s.split(':');u.bins.push({location:l,slot:ix,weapon:+w,shots:+n,destroyed:false});}});});this.log=[];this.note('Полный цикл боя: начните с броска инициативы.');return this;}
 rebuildMap(){for(const tile of this.tiles)normalizeMapHex(tile);this.map=new Map(this.tiles.map(t=>[key(t.q,t.r),t]));return this.map;}
 roll(kind='Бросок',target=null,one=false){this.lastDice=Array.from({length:one?1:2},()=>1+Math.floor(this.rng()*6));const total=this.lastDice.reduce((a,b)=>a+b,0);this.phaseRolls.push({kind,dice:[...this.lastDice],total,target,result:target===null?String(total):total>=target?'Успех':'Неудача'});return total;}
 d6(kind){return this.roll(kind,null,true);}
 // Flooding is not a critical hit. The affected component slots remain
 // available for real criticals, while the components are nonfunctional.
 // BattleMech Manual (2022), Hull Integrity and Breaches, p.65.
 isSubmergedLocation(u,loc){const depth=u.deployed===false?0:this.tile(u.q,u.r)?.depth??0;return depth>=(u.prone||mechLegLocation(u,loc)?1:2);}
 isBreached(u,loc){return !!u.breached?.includes(loc);}
 floodedSlots(u,type){return Object.entries(u.slots).reduce((total,[loc,slots])=>total+(this.isBreached(u,loc)?slots.filter((s,i)=>s===type&&!u.crit[loc][i]).length:0),0);}
 effectiveEngineHits(u){return u.engineHits+this.floodedSlots(u,'engine');}
 breachLocation(u,loc){
  if(!u.slots[loc]||this.isBreached(u,loc)||u.dead)return false;
  if(!u.breached)u.breached=[];
  u.breached.push(loc);
  this.syncAmmo(u);
  this.note(`${u.name}: затоплена секция ${loc}.`);
  if(loc==='HD'&&u.slots.HD.includes('cockpit')){
   u.pilotWounds=6;this.destroyMech(u);this.note(`${u.name}: затоплена кабина; пилот погиб.`);
  }
  if(['LT','RT'].includes(loc))this.breachLocation(u,loc==='LT'?'LA':'RA');
  if(this.effectiveEngineHits(u)>=3){this.destroyMech(u);this.note(`${u.name}: двигатель отказал из-за затопления.`);}
  return true;
 }
 checkExistingHullBreaches(u){
  const t=this.tile(u.q,u.r);
  if(!t?.depth)return;
  for(const loc of Object.keys(LOCATIONS)){
   if(u.dead)break;
   if(!this.isSubmergedLocation(u,loc)||this.isBreached(u,loc))continue;
   const armorGone=u.armor[loc]===0||(u.rear[loc]!==undefined&&u.rear[loc]===0);
   if(armorGone)this.breachLocation(u,loc);
  }
 }
 checkHullIntegrity(u,loc){
  if(u.dead||!this.isSubmergedLocation(u,loc)||this.isBreached(u,loc))return;
  const armorGone=u.armor[loc]===0||(u.rear[loc]!==undefined&&u.rear[loc]===0);
  if(armorGone||this.roll(u.name+' · Герметичность '+loc,10)>=10)this.breachLocation(u,loc);
 }
 // AGoAC pp.35,44: destruction immediately disables actions, but the
 // destroyed model remains on the board until this phase is finished.
 // Old saves and unused roster slots have no pending-removal marker.
 onMap(u){return !!u&&u.deployed!==false&&(!u.dead||u.removalPending===true);}
 occupied(q,r,except){return this.units.some(u=>this.onMap(u)&&!u.airborne&&u.id!==except&&u.q===q&&u.r===r);}
 destroyMech(u){if(u.dead)return;u.removalPending=true;u.dead=true;}
 removeDestroyedMechs(){for(const u of this.units)if(u.dead&&u.removalPending===true)u.removalPending=false;}
 mobile(u){return !u.dead&&!u.shutdown&&!u.unconscious&&!u.abandoned;}
 // AGoAC p.11: immobility is not equivalent to having zero MP or being prone.
 // Keep the operational-pilot predicate separate so a limbless chassis's
 // surviving torso weapons are not disabled by a movement-only restriction.
 isImmobile(u){return !this.mobile(u)||['LA','RA','LL','RL'].every(l=>u.structure?.[l]===0);}
 done(u){return this.phase==='move'?u.moved:this.phase==='fire'?u.fired:u.physicalDone;}
 canAct(u){return !!u&&this.winner===null&&!u.dead&&u.team===this.activeTeam&&!this.done(u)&&(this.actingId===null||this.actingId===u.id);}
 // AGoAC p.7: ratios are established before each declaration pair,
 // not continuously while the two sides are completing that pair.
 selectionPlan(remaining){
  // Old snapshots and direct scenario fixtures may have no initiative
  // result. Only the normal initiative phase establishes a real winner.
  // Use green-first order for that compatibility case, never an invalid
  // array index that prevents the planning loop from making progress.
  const winner=this.initiativeWinner===0?0:1;
  const counts=[...remaining],order=[1-winner,winner],slots=[];
  let firstPair=0;
  while(counts.some(Boolean)){
   const batches=counts.map((n,i)=>n?Math.min(n,Math.max(1,Math.floor(n/Math.max(1,counts[1-i])))):0);
   if(!slots.length)firstPair=batches[0]+batches[1];
   for(const t of order)for(let k=0;k<batches[t];k++)slots.push(t);
   counts[0]-=batches[0];counts[1]-=batches[1];
  }
  return {slots,firstPair};
 }
 saveSelectionPlan(pairLength){
  this.selectionBatch={phase:this.phase,remaining:pairLength,signature:this.queue.join(',')};
  this.activeTeam=this.queue[0]??null;
 }
 buildQueue(){
  const remaining=[0,1].map(t=>this.units.filter(u=>u.team===t&&!u.dead).length);
  const {slots,firstPair}=this.selectionPlan(remaining);
  this.queue=slots;this.actingId=null;this.saveSelectionPlan(firstPair);
 }
 // Preserve the unfinished pair and recompute later pairs from surviving
 // unselected Mechs. Incapacitated but living Mechs still count.
 // Older saves without pair metadata retain their existing order until
 // the next phase rather than guessing where their partial pair began.
 skipExhaustedSelections(pairLength=null){
  const remaining=[0,1].map(team=>this.units.filter(v=>v.team===team&&!v.dead&&!this.done(v)).length);
  const keep=team=>{
   if(remaining[team]<=0)return false;
   remaining[team]--;return true;
  };
  if(pairLength===null){
   this.queue=this.queue.filter(keep);
   this.selectionBatch=null;this.activeTeam=this.queue[0]??null;return;
  }
  const current=this.queue.slice(0,pairLength).filter(keep);
  const {slots,firstPair}=this.selectionPlan(remaining);
  this.queue=[...current,...slots];
  this.saveSelectionPlan(current.length||firstPair);
 }
 finish(u){
  const batch=this.selectionBatch;
  const tracked=batch?.phase===this.phase&&batch.signature===this.queue.join(',')&&batch.remaining>0;
  if(this.phase==='move')u.moved=true;else if(this.phase==='fire')u.fired=true;else u.physicalDone=true;
  this.queue.shift();this.actingId=null;
  this.skipExhaustedSelections(tracked?batch.remaining-1:null);
 }
 // AGoAC p.7: a stalemate requires both sides to lack any future
 // movement AND any means of damaging their opponents. Use a cooled,
 // recovered copy so temporary shutdown, unconsciousness or heat cannot
 // falsely end the battle. A positive MP budget is conservatively treated
 // as possible movement; map-trapped units require further adjudication.
 canEverMove(u){
  if(u.abandoned||['LA','RA','LL','RL'].every(l=>u.structure[l]===0))return false;
  const ready={...u,heat:0,shutdown:false,unconscious:false,prone:false};
  if(this.mp(ready,'walk')>0||this.mp(ready,'run')>0)return true;
  // A prone Mech cannot jump, and without any ground MP it cannot stand.
  return !u.prone&&this.mp(ready,'jump')>0;
 }
 // Conservative immutable obstruction: only a straight row of full
 // dry hexes. A hill intervenes at both maximum standing heights,
 // or at either endpoint's maximum standing height when adjacent.
 // Do not infer a draw from woods, split LOS, buildings or water.
 permanentHillBlocks(a,b){
  const start=this.tile(a.q,a.r),end=this.tile(b.q,b.r),n=distance(a,b);
  if(!start||!end||start.depth||end.depth||n<2)return false;
  const dir=DIRS.find(([dq,dr])=>a.q+n*dq===b.q&&a.r+n*dr===b.r);
  if(!dir)return false;
  const ah=start.height+2,bh=end.height+2,[dq,dr]=dir;
  for(let i=1;i<n;i++){
   const tile=this.tile(a.q+i*dq,a.r+i*dr);
   if(!tile||tile.depth||tile.building)continue;
   if(tile.height>=Math.max(ah,bh)||i===1&&tile.height>=ah||i===n-1&&tile.height>=bh)return true;
  }
  return false;
 }
 canEverDamage(u,enemies){
  if(u.abandoned)return false;
  const stuckProne=u.prone&&!this.canEverMove(u);
  // A permanently prone biped cannot fire with a destroyed arm,
  // and cannot fire leg weapons. Do not confuse a temporary fall
  // with a permanent loss of the ability to recover.
  const canBrace=!stuckProne||u.config==='Quad'||(u.structure.LA>0&&u.structure.RA>0);
  // Range remains a conservative upper bound on future fire.
  if(canBrace&&u.sensorHits<2&&u.weapons.some((w,i)=>{
   if(stuckProne&&u.config!=='Quad'&&['LL','RL'].some(l=>w.location===l||w.locations?.includes(l)))return false;
   if(w.destroyed||!u.structure[w.location]||this.isBreached(u,w.location)||
    w.locations?.some(l=>this.isBreached(u,l)))return false;
   if(w.ammo!==null&&!u.bins.some(b=>b.weapon===(w.shared??i)&&b.shots>0&&!b.destroyed&&!this.isBreached(u,b.location)))return false;
   const depth=this.tile(u.q,u.r).depth;
   // A depth-two-or-deeper shooter is always submerged. A dry hex
   // and a fully submerged target cannot exchange weapons fire.
   // Keep depth-one and changing posture conservative until LOS audit.
   const submerged=depth>=2||stuckProne&&depth>=1||depth===1&&mechLegLocation(u,w.location);
   if(submerged&&!this.tacticalOptions?.underwaterFire)return false;
   const ranges=submerged?UNDERWATER_RANGES[w.name]:w.ranges;
   if(!ranges)return false;
   return enemies.some(t=>{
    const targetDepth=this.tile(t.q,t.r).depth,range=distance(u,t);
    const targetPermanentlySubmerged=targetDepth>=2||targetDepth===1&&t.prone&&!this.canEverMove(t);
    if(!this.tacticalOptions?.underwaterFire&&targetPermanentlySubmerged)return false;
    if(submerged&&targetDepth===0||depth===0&&targetPermanentlySubmerged)return false;
    if(!range||range>ranges[2])return false;
    // AGoAC pp.13,21: only LRMs can bypass an immutable ridge,
    // and only with a different friendly Mech able to see the target.
    // A possible future spotter is sufficient; do not assume temporary
    // shutdown, posture, or a past charge makes spotting impossible.
    if(!this.canEverMove(u)&&!this.canEverMove(t)){
     if(stuckProne&&u.config!=='Quad'&&!u.directionalTorsoMounts?.length&&
        !this.arc({...u,twist:0,flip:false},t,w))return false;
     if(this.permanentHillBlocks(u,t)){
      if(!/LRM/i.test(w.name))return false;
      return this.units.some(s=>s.id!==u.id&&s.team===u.team&&!s.dead&&
       !s.abandoned&&s.deployed!==false&&
       (this.canEverMove(s)||!this.permanentHillBlocks(s,t)));
     }
    }
    return true;
   });
  }))return true;
  // AGoAC pp.28–29: both hips must permit a kick; punch and physical
  // weapon attacks need an intact arm and shoulder; a push needs two
  // arms, but damaged shoulders only penalize its roll. Preserve
  // possible pushes even though the damage would be indirect.
  // AGoAC p.25: ordinary physical attacks cannot cross a level
  // difference greater than one. Retain the possibility of movement
  // or DFA when either participant can still move.
  if(stuckProne)return false;
  const arms=['LA','RA'].filter(l=>u.structure[l]>0&&!this.isBreached(u,l));
  const kick=['LL','RL'].every(l=>u.structure[l]>0&&!u.actuators[l].hip&&!this.isBreached(u,l));
  return enemies.some(t=>{
   if(distance(u,t)>1)return false;
   if(u.config==='Quad')return ['LA','RA','LL','RL'].some(l=>u.structure[l]>0);
   const movable=this.canEverMove(u)||this.canEverMove(t);
   const a=this.tile(u.q,u.r),b=this.tile(t.q,t.r);
   if(!movable&&a&&b){
    if(Math.abs(a.height-b.height)>1)return false;
    // No physical attack can cross between dry and fully submerged hexes.
    if(a.depth===0&&b.depth>=2||a.depth>=2&&b.depth===0)return false;
   }
   // A fixed biped uses its feet's facing for physical attacks.
   // Keep future movement, coincident hexes and non-base quirks conservative.
   const angle=movable||distance(u,t)===0?0:this.relative({...u,twist:0},t);
   if(Math.abs(angle)<=60.00001&&(arms.length===2||kick))return true;
   return arms.some(l=>!physicalArmActuators(u,l).shoulder&&
    Math.abs(angle)<=120.00001&&(l==='LA'?angle>=-60.00001:angle<=60.00001));
  });
 }
 // CAT3500D p.7 permits victory conditions agreed before play.
 // This digital preset is optional: draw when a negotiated turn limit ends.
 configureVictoryTerms({roundLimit,condition,approvals=[]}={}){
  if(this.round!==1||this.phase!=='initiative'||this.deployment!==null||
   this.winner!==null||this.victoryTerms!=null||this.queue.length||
   this.units.some(u=>u.moved||u.fired||u.physicalDone))
   return fail('Условия победы можно согласовать только до боя');
  const agreed=Array.isArray(approvals)&&approvals.length===2&&approvals.every(v=>v===true);
  const limit=condition===undefined&&Number.isInteger(roundLimit)&&roundLimit>=1&&roundLimit<=1000;
  const custom=roundLimit===undefined&&typeof condition==='string'&&condition.trim().length>0&&condition.trim().length<=500;
  if(!agreed||!(limit||custom))return fail('Нужны допустимые условия победы и согласие обеих сторон');
  this.victoryTerms=custom?{condition:condition.trim(),approvals:[true,true]}:{roundLimit,approvals:[true,true]};
  return {ok:true};
 }
 // Custom scenario text is interpreted by the two players, never executed.
 // A result is finalized once, at a completed-round boundary or after a
 // standard terminal result. An agreed custom result can differ from it.
 // Optional human adjudication for exceptional standard stalemate.
 // This does not change the automatic capability test, and is not
 // a printed extra requirement or a way for the AI to force a draw.
 canAdjudicateStalemate(){
  return this.winner===null&&!this.victoryTerms&&!this.pendingChoice&&
   this.phase==='initiative'&&this.round>1&&!this.queue.length&&
   this.units.filter(u=>!u.dead).every(u=>u.deployed!==false)&&
   [0,1].every(team=>this.units.some(u=>u.team===team&&!u.dead));
 }
 adjudicateStalemate({confirmations=[]}={}){
  if(!this.canAdjudicateStalemate()||!Array.isArray(confirmations)||confirmations.length!==2||
   confirmations.some(c=>c?.cannotMove!==true||c?.cannotDamage!==true))
   return fail('Обе стороны должны подтвердить отсутствие возможности двигаться и наносить урон');
  this.winner='draw';this.activeTeam=null;this.actingId=null;
  this.note('Ничья: обе стороны подтвердили отсутствие возможности двигаться и наносить урон.');
  return {ok:true};
 }
 canAdjudicateVictory(){
  return typeof this.victoryTerms?.condition==='string'&&!this.victoryAdjudicated&&
   !this.pendingChoice&&!this.queue.length&&(this.winner!==null||this.phase==='initiative'&&this.round>1);
 }
 adjudicateVictory({winner,approvals=[]}={}){
  if(!this.canAdjudicateVictory()||![0,1,'draw'].includes(winner)||
   !Array.isArray(approvals)||approvals.length!==2||approvals.some(v=>v!==true))
   return fail('Нужно согласие обеих сторон на итог по заранее согласованному условию');
  this.winner=winner;this.victoryAdjudicated=true;this.activeTeam=null;this.actingId=null;
  this.note('Итог по согласованным условиям: '+(winner==='draw'?'ничья':winner===0?'победа зелёных':'победа красных')+'.');
  return {ok:true};
 }
 checkWin({stalemate=false}={}){
  if(this.winner!==null)return;
  const alive=this.units.filter(u=>!u.dead),sides=[0,1].map(t=>alive.filter(u=>u.team===t));
  if(!sides[0].length||!sides[1].length){super.checkWin();return;}
  if(stalemate&&Number.isInteger(this.victoryTerms?.roundLimit)&&this.round>this.victoryTerms.roundLimit){
   this.winner='draw';this.note('Ничья: достигнут согласованный лимит раундов.');return;
  }
  if(!stalemate||alive.some(u=>u.deployed===false)||alive.some(u=>this.canEverMove(u)))return;
  if(alive.some(u=>this.canEverDamage(u,sides[1-u.team])))return;
  this.winner='draw';this.note('Ничья: ни одна сторона больше не может двигаться или наносить урон.');
 }
 // AGoAC p.6: separate setup initiative from turn initiative.
 // AGoAC p.6: choose the playing area before choosing the forces.
 // Every preset uses the existing complete radius-six axial board.
 configureSetupMap({id='frontier',rotation=0,layout='hex',sheets=null}={}){
  if(this.round!==1||this.phase!=='initiative'||this.deployment!==null||
   this.setupForces!==null||this.setupMap!==null||this.queue.length||
   this.units.some(u=>u.moved||u.fired||u.physicalDone))return fail('Карту можно выбрать только перед составом и боем');
  if(layout!=='hex')return this.configureRectangularSheets(layout,sheets);
  if(!AGOAC_MAP_PRESETS.some(p=>p.id===id)||!Number.isInteger(rotation)||rotation<0||rotation>5)
   return fail('Неизвестная карта или ориентация');
  const tiles=this.tiles.map(t=>{
   let {q,r}=t;let type=t.type,height=t.height,depth=t.depth,surface=t.surface;
   if(id!=='frontier'){
    type='plain';height=depth=surface=0;
    if(id==='woodland'&&Math.abs(q)<4){
     const n=Math.abs(q*13+r*7+q*r*3)%11;
     type=n<3?'heavy':n<7?'woods':n===7?'rough':'plain';
     if(n===9){height=surface=1;type='hill';}
    }
    if(id==='river'){
     const channel=r===0&&q>=-4&&q<=4;
     if(channel){type='water';depth=Math.abs(q)%2?1:2;height=-depth;}
     else if(r===1&&Math.abs(q)<4)type='woods';
     else if(r===-2&&Math.abs(q)<3){type='hill';height=surface=1;}
    }
   }
   const bridge=id==='river'&&q===3&&r===0;
   if(bridge){type='bridge';height=surface;depth=0;}
   const roadEdges=id==='woodland'&&r===0?[0,3].map(d=>{
    let [dq,dr]=DIRS[d];
    for(let n=0;n<rotation;n++)[dq,dr]=[-dr,dq+dr];
    return DIRS.findIndex(([x,y])=>x===dq&&y===dr);
   }):[];
   for(let n=0;n<rotation;n++)[q,r]=[-r,q+r];
   return {q,r,type,height,depth,surface,roadEdges};
  });
  this.tiles=tiles;this.rebuildMap();this.setupMap={id,rotation};
  return {ok:true};
 }
 // Native digital sheets use a staggered rectangular 16 by 17 hex grid.
 // A 180-degree turn preserves the sheet's rectangular footprint.
 // Only outer edges are deployment edges; seams are ordinary full hexes.
 configureRectangularSheets(layout,sheets){
  if(this.round!==1||this.phase!=='initiative'||this.deployment!==null||
   this.setupForces!==null||this.setupMap!==null||this.queue.length||
   this.units.some(u=>u.moved||u.fired||u.physicalDone))return fail('Карту можно выбрать только перед составом и боем');
  const dimensions={sheet:[1,1],horizontal:[2,1],vertical:[1,2]};
  if(!Object.hasOwn(dimensions,layout))return fail('Неизвестное расположение карт');
  const [nx,ny]=dimensions[layout],width=16*nx,height=17*ny;
  if(!Array.isArray(sheets)||sheets.length!==nx*ny||sheets.some(s=>!s||!AGOAC_MAP_PRESETS.some(p=>p.id===s.id)||![0,3].includes(s.rotation)))
   return fail('Нужна карта и допустимый поворот для каждой секции');
  const tiles=[];
  for(let row=0;row<height;row++)for(let col=0;col<width;col++){
   const sheet=Math.floor(row/17)*nx+Math.floor(col/16),preset=sheets[sheet];
   let x=col%16,y=row%17;
   if(preset.rotation===3){x=15-x;y=16-y;}
   const a=x-8,b=y-8,n=Math.abs(a*31+b*17+a*b*7);
   let type='plain',h=0,depth=0;
   if(preset.id==='frontier'){
    type=n%13===0?'heavy':n%7===0?'woods':n%11===0?'hill':'plain';
    if(type==='hill')h=1;
    if(a===0&&b>0&&b<4){type='water';depth=b===2?2:1;h=-depth;}
    else if(a===1&&b===-2)type='rubble';
    else if(a===-1&&b===-2)type='rough';
   }else if(preset.id==='woodland'){
    const v=Math.abs(a*13+b*7+a*b*3)%11;
    type=v<3?'heavy':v<7?'woods':v===7?'rough':v===9?'hill':'plain';
    if(type==='hill')h=1;
   }else if(preset.id==='river'){
    if(b===0){type='water';depth=Math.abs(a)%2?1:2;h=-depth;}
    else if(b===1&&Math.abs(a)<4)type='woods';
    else if(b===-2&&Math.abs(a)<3){type='hill';h=1;}
   }
   const r=row-Math.floor(height/2),q=col-Math.floor(width/2)-Math.floor(r/2);
   if(preset.id==='river'&&a===0&&b===0){type='bridge';h+=depth;depth=0;}
   const roadEdges=preset.id==='woodland'&&b===0?[0,3]:[];
   tiles.push({q,r,type,height:h,depth,surface:h+depth,sheet,roadEdges});
  }
  this.tiles=tiles;this.rebuildMap();
  this.setupMap={id:'sheets',rotation:0,layout,sheets:sheets.map(s=>({id:s.id,rotation:s.rotation})),width,height};
  for(const u of this.units){
   const r=u.team?-(u.id%2?3:1):(u.id%2?3:1);
   const col=u.team?width-4:3;
   Object.assign(u,{q:col-Math.floor(width/2)-Math.floor(r/2),r,facing:u.team?3:0});
   u.moveStart={q:u.q,r:u.r};
  }
  return {ok:true};
 }
 deploymentEdgeIds(){return this.setupMap?.id==='sheets'?[0,2,3,5]:[0,1,2,3,4,5];}
 // AGoAC p.6: choose forces before deployment, with unanimous
 // consent for custom designs. Stable slot IDs keep the existing local
 // renderer's four model instances; empty secondary slots are not fielded.
 configureSetupForces({slots,extra=[],custom=null,approvals=[]}={}){
  if(this.round!==1||this.phase!=='initiative'||this.deployment!==null||
   this.setupForces!==null||this.queue.length||this.units.some(u=>u.moved||u.fired||u.physicalDone))
   return fail('Состав можно выбрать только перед боем');
  const validChassis=v=>v==='custom'||Number.isInteger(v)&&v>=0&&v<4;
  if(!Array.isArray(slots)||slots.length!==4||slots.some((v,i)=>!(validChassis(v)||v===null&&i%2===1))||
   !Array.isArray(extra)||extra.length>12||extra.some(v=>!v||![0,1].includes(v.team)||!validChassis(v.stock)))
   return fail('Недопустимый состав отрядов');
  const counts=[0,1].map(t=>slots.slice(t*2,t*2+2).filter(v=>v!==null).length+extra.filter(v=>v.team===t).length);
  if(counts.some(n=>n>8)||slots.filter(v=>v==='custom').length+extra.filter(v=>v.stock==='custom').length>1)
   return fail('До восьми мехов на сторону и один сохранённый нестандартный проект');
  const usesCustom=slots.includes('custom')||extra.some(v=>v.stock==='custom');
  let design=null;
  if(usesCustom){
   if(!Array.isArray(approvals)||approvals.length!==2||approvals.some(v=>v!==true))
    return fail('Нужно согласие обеих сторон на нестандартный мех');
   if(!custom||!custom.config||typeof custom.config!=='object')return fail('Нет проекта меха');
   try{design=construct(custom.config);}catch{return fail('Некорректный проект меха');}
   if(!design.unit||design.errors.length)return fail('Некорректный проект меха');
   const p=custom.pilot;
   if(p!=null&&(!Number.isInteger(p.gunnery)||!Number.isInteger(p.piloting)||
     p.gunnery<0||p.gunnery>8||p.piloting<0||p.piloting>8))return fail('Некорректные навыки пилота');
  }
  const stock=structuredClone(this.units),configured=[];
  const make=(position,i,v)=>{
   if(v===null)return {...position,notFielded:true,dead:true,deployed:false};
   const unit=v==='custom'?{...structuredClone(position),...structuredClone(design.unit)}:structuredClone(stock[v]);
   if(v==='custom'&&custom.pilot)Object.assign(unit,{gunnery:custom.pilot.gunnery,piloting:custom.pilot.piloting});
   return {...unit,id:i,team:position.team,q:position.q,r:position.r,facing:position.facing,
    moveStart:{q:position.q,r:position.r},notFielded:false};
  };
  for(const [i,position] of stock.entries())configured.push(make(position,i,slots[i]));
  // Reserve the legacy positions even for empty slots. Extra units get
  // independent legal, unoccupied dry hexes near their side. These are
  // only staging coordinates; standard deployment starts offboard.
  const used=new Set(configured.map(u=>key(u.q,u.r)));
  for(const v of extra){
   const candidates=this.tiles.filter(t=>!t.depth&&!t.building?.cf&&!used.has(key(t.q,t.r)));
   const side=t=>t.q+t.r/2;
   candidates.sort((a,b)=>(v.team?side(b)-side(a):side(a)-side(b))||Math.abs(a.r)-Math.abs(b.r)||a.r-b.r||a.q-b.q);
   const tile=candidates[0];
   if(!tile)return fail('Недостаточно свободных гексов для состава');
   used.add(key(tile.q,tile.r));
   const position={...stock[v.team*2],team:v.team,q:tile.q,r:tile.r,facing:v.team?3:0};
   configured.push(make(position,configured.length,v.stock));
  }
  this.units=configured;
  this.setupForces={slots:[...slots],extra:extra.map(v=>({team:v.team,stock:v.stock})),customApproved:usesCustom?[true,true]:null};
  return {ok:true};
 }
 startStandardDeployment(){
  if(this.deployment!==null||this.round!==1||this.phase!=='initiative'||this.queue.length||
   this.units.some(u=>u.moved||u.fired||u.physicalDone))return fail('Развёртывание возможно только перед боем');
  this.deployment={winner:null,edges:null};this.phase='setup';this.phaseRolls=[];
  for(const u of this.units)if(!u.dead)u.deployed=false;
  return {ok:true};
 }
 deploymentEdgeTiles(edge){
  if(!this.deploymentEdgeIds().includes(edge))return [];
  if(this.setupMap?.id==='sheets'){
   const coordinate=edge===0||edge===3?t=>t.q+Math.floor(t.r/2):t=>t.r;
   const values=this.tiles.map(coordinate),bound=edge===0||edge===5?Math.min(...values):Math.max(...values);
   return this.tiles.filter(t=>coordinate(t)===bound);
  }
  const coordinate=t=>edge%3===0?t.q:edge%3===1?t.r:-t.q-t.r;
  const values=this.tiles.map(coordinate);
  const bound=[0,2,4].includes(edge)?Math.min(...values):Math.max(...values);
  return this.tiles.filter(t=>coordinate(t)===bound);
 }
 resolveDeploymentSetup(){
  let a,b,tries=0;
  do{a=this.roll('Развёртывание: зелёные');b=this.roll('Развёртывание: красные');}
  while(a===b&&++tries<10000);
  if(a===b)throw Error('Генератор выдаёт только ничьи инициативы');
  const winner=a>b?0:1,representative=this.units.find(u=>u.team===winner&&!u.dead);
  if(!representative)return fail('Нет мехов для развёртывания');
  const options=this.deploymentEdgeIds().map(edge=>({id:String(edge),edge,
   hexes:this.deploymentEdgeTiles(edge).map(t=>({q:t.q,r:t.r}))}));
  const edge=Number(this.chooseResolutionOption('deployment-edge',representative,options,
   String(winner===0?0:3),{green:a,red:b}));
  this.deployment.winner=winner;this.deployment.edges=winner===0?[edge,wrap(edge+3)]:[wrap(edge+3),edge];
  this.phase='initiative';this.note('Развёртывание '+a+':'+b+' — стороны входа '+this.deployment.edges.map(e=>e+1).join(' / ')+'.');
  return {ok:true};
 }
 deploymentEntryRoutes(u,mode){
  if(this.phase!=='move'||!this.canAct(u)||u.deployed!==false||this.isImmobile(u)||
   u.prone||!['walk','run','jump','minimum'].includes(mode)||!this.deployment?.edges||u.spent)return [];
  const legs=u.config==='Quad'?['LA','RA','LL','RL']:['LL','RL'],lost=legs.filter(l=>!u.structure[l]).length;
  if(mode==='run'&&lost>=(u.config==='Quad'?2:1))return [];
  if(mode==='jump'&&u.proneAtStart)return [];
  if(mode!=='walk'&&(u.dumping.length||u.dumpNext.length))return [];
  // Minimum movement requires one ground MP, even if ordinary running
  // is prohibited by a lost leg (p.11); the step still counts as running.
  if(mode==='minimum'&&this.mp(u,'walk')<1)return [];
  const max=mode==='minimum'?Math.max(1,this.mp(u,'run')):this.mp(u,mode);
  if(max<1)return [];
  const edge=this.deployment.edges[u.team],d=DIRS[edge],routes=new Map();
  const add=(tile,cost,from,transit=null)=>{
   if(this.occupied(tile.q,tile.r,u.id))return;
   const k=key(tile.q,tile.r),existing=routes.get(k);
   if(!existing||cost<existing.cost)routes.set(k,{q:tile.q,r:tile.r,cost,facing:transit?.facing??edge,entryFrom:from,
    path:transit?.path??[{q:tile.q,r:tile.r,facing:edge,cost}],...(transit?{transit}: {})});
  };
  for(const first of this.deploymentEdgeTiles(edge)){
   // No external terrain specified: use adjacent virtual origin at the
   // first full hex's surface. The selected edge determines inward facing.
   const from={q:first.q-d[0],r:first.r-d[1]};
   if(mode!=='jump'){
    // The virtual origin is at the first hex's water surface.
    // Ground entry may not descend more than two levels.
    if(first.depth>2)continue;
    const cost=this.terrainCost(first)+first.depth;
    if(mode==='minimum'){
     // p.11: a single forward running step when ordinary entry is
     // unaffordable or running into water is normally prohibited.
     if(first.depth||cost>max)add(first,max,from);
    }else if(!(mode==='run'&&first.depth)&&cost<=max){
     add(first,cost,from);
     // p.9: a friendly occupant does not prohibit transit, but may
     // never be the endpoint. Check difficult terrain immediately;
     // involuntary stops that create stacking use displacement.
     const occupants=this.units.filter(v=>v.id!==u.id&&this.onMap(v)&&!v.airborne&&v.q===first.q&&v.r===first.r);
     if(occupants.length&&occupants.every(v=>!v.dead&&v.team===u.team)){
      const origin={q:first.q,r:first.r,facing:edge,cost};
      const entering={...u,...origin,deployed:true,spent:cost,moveMode:mode,distanceMoved:1,lastMovementDirection:edge};
      for(const route of this.reachable(entering,mode)){
       if(!route.path.length||this.occupied(route.q,route.r,u.id))continue;
       add(route,cost+route.cost,from,{origin,facing:route.facing,path:[origin,...route.path]});
      }
     }
    }
    continue;
   }
   const ceiling=first.surface+max;
   if(first.height>ceiling)continue;
   const queue=[{tile:first,cost:1}],seen=new Set([key(first.q,first.r)]);
   for(let i=0;i<queue.length;i++){
    const {tile,cost}=queue[i];
    if(!(tile.building?.cf>0))add(tile,cost,from);
    if(cost>=max)continue;
    for(const [dq,dr] of DIRS){
     const next=this.tile(tile.q+dq,tile.r+dr);
     if(!next||next.height>ceiling||distance(from,next)!==cost+1)continue;
     const k=key(next.q,next.r);if(seen.has(k))continue;seen.add(k);
     queue.push({tile:next,cost:cost+1});
    }
   }
  }
  return [...routes.values()];
 }
 enterDeployment(u,q,r,mode,options={}){
  if(options.facing!==undefined&&(mode!=='jump'||!Number.isInteger(options.facing)||options.facing<0||options.facing>5))
   return fail('Направление посадки допустимо только для прыжка');
  const route=this.deploymentEntryRoutes(u,mode).find(t=>t.q===q&&t.r===r);
  if(!route)return fail('Недопустимый вход с назначенной стороны');
  this.phaseRolls=[];this.actingId=u.id;
  const from=route.entryFrom,minimum=mode==='minimum';
  if(route.transit){
   // Transit starts at the virtual edge. Resolve the first hex's
   // checks immediately, before any subsequent movement.
   const first=route.transit.origin,entryPath=[{q:first.q,r:first.r}];
   Object.assign(u,{q:first.q,r:first.r,deployed:true,facing:first.facing,moveStart:{...from},
    moveMode:mode,spent:first.cost,distanceMoved:1,lastMovementDirection:first.facing,tmmTravel:'forward',tmmReversalOffset:0});
   // Resolve entry exactly once before the shared on-map move processes
   // later terrain, turning and skid checks. A friendly occupant alone
   // does not prevent entry transit (AGoAC pp.6,9).
   this.resolveVoluntaryBuildingEntry(u,from,{q:first.q,r:first.r},1);
   this.checkExistingHullBreaches(u);
   const tile=this.tile(u.q,u.r);
   if(!u.dead&&!u.moveEndedByLegLoss&&(tile.depth||tile.type==='rubble'))
    this.psr(u,tile.depth>=3?1:tile.depth===1?-1:0,tile.depth?'Вода':'Обломки',true);
   const entryRolls=[...this.phaseRolls];
   if(!u.dead&&!u.prone&&!u.moveEndedByLegLoss&&!this.isImmobile(u)){
    const result=this.move(u.id,q,r,mode);
    if(result.ok){
     this.phaseRolls=[...entryRolls,...result.rolls];
     return {...result,entry:true,from,path:[...entryPath,...result.path],rolls:[...this.phaseRolls]};
    }
   }
   this.resolveGroundStacking(u);
   return {ok:true,entry:true,from,to:{q:u.q,r:u.r},path:entryPath,mode,rolls:[...this.phaseRolls]};
  }
  if(minimum)mode='run';
  Object.assign(u,{q,r,deployed:true,facing:options.facing??route.facing,moveStart:{...from},
   moveMode:mode,spent:route.cost,distanceMoved:mode==='jump'?route.cost:1,lastMovementDirection:route.facing,tmmTravel:mode==='jump'?null:'forward',tmmReversalOffset:0});
  const tile=this.tile(q,r);
  if(mode==='jump'){
   u.pendingHeat+=Math.max(3,route.cost);
   const modifier=u.config==='Quad'&&['LA','RA','LL','RL'].filter(l=>!u.structure[l]).length===1?5:0;
   this.checkExistingHullBreaches(u);
   if(!u.dead&&tile.depth)this.psr(u,modifier,'Посадка в воду',true,tile.depth);
   else if(!u.dead&&(modifier||this.psrMod(u)))this.psr(u,modifier,'Посадка',true);
  }else{
   this.resolveVoluntaryBuildingEntry(u,from,{q,r},1);
   this.checkExistingHullBreaches(u);
   if(!u.dead&&(tile.depth||tile.type==='rubble'))this.psr(u,tile.depth>=3?1:tile.depth===1?-1:0,tile.depth?'Вода':'Обломки',true);
  }
  this.note(u.name+': вход на поле, '+route.cost+' MP.');
  if(minimum)this.hold(u.id);
  return {ok:true,entry:true,...(minimum?{ended:true}:{}),path:[{q,r}],from,to:{q,r},mode,rolls:[...this.phaseRolls]};
 }
 deploymentOptions(u){
  return ['walk','run','jump','minimum'].flatMap(mode=>this.deploymentEntryRoutes(u,mode).map(t=>({...t,mode})));
 }
 aiSelection(){
  const candidates=this.units.filter(u=>this.canAct(u));
  return (this.phase==='move'?candidates.find(u=>u.deployed!==false||this.deploymentOptions(u).length):null)||candidates[0];
 }
 initiative(){this.phaseRolls=[];let a,b,tries=0;do{a=this.roll('Инициатива: зелёные');b=this.roll('Инициатива: красные');}while(a===b&&++tries<10000);if(a===b)throw Error('Генератор выдаёт только ничьи инициативы');this.initiativeWinner=a>b?0:1;
  // AGoAC pp.7,44: only a pilot already unconscious at Initiative
  // may attempt recovery in this turn's End Phase.
  for(const u of this.units)u.wasUnconscious=!!u.unconscious;
  this.phase='move';this.buildQueue();this.note(`Инициатива ${a}:${b}. ${this.initiativeWinner?'Красные':'Зелёные'} действуют вторыми.`);}
 psrMod(u,fallAvoidance=false){
  let n=Math.min(2,u.gyroHits)*3+(this.weather.gale?1:0);
  if(u.config==='Quad'){
   const legs=['LA','RA','LL','RL'];
   const lost=legs.filter(l=>u.structure[l]===0).length;
   // BMM p.44: one lost quad leg costs 1 MP instead of the biped
   // +5 PSR modifier; two lost legs count as one lost biped leg.
   if(lost===2)n+=5;else if(lost>=3)n+=10;
   for(const l of legs){
    if(u.structure[l]===0)continue;
    const a=u.actuators[l];
    n+=a.hip||this.isBreached(u,l)?2:Number(a.upper)+Number(a.lower)+Number(a.foot);
   }
   // BMM p.53: -2 applies only to PSRs made to avoid falls.
   if(fallAvoidance&&lost===0)n-=2;
   return n;
  }
  for(const l of ['LL','RL']){
   const a=u.actuators[l];
   n+=u.structure[l]===0?5:a.hip||this.isBreached(u,l)?2:
     Number(a.upper)+Number(a.lower)+Number(a.foot);
  }
  return n;
 }
 mp(u,mode='walk'){u=this.unit(u);if(this.isImmobile(u))return 0;
 const quad=u.config==='Quad',legs=quad?['LA','RA','LL','RL']:['LL','RL'];
 const lost=legs.filter(l=>u.structure[l]===0).length;
 if(mode==='jump'){
  if(quad?lost>=3:lost>0)return 0;
  const depth=u.deployed===false?0:this.tile(u.q,u.r)?.depth??0;
  if(depth>=2||(depth>=1&&u.prone))return 0;
  const submergedJets=depth===1?legs.reduce((n,l)=>n+(this.isBreached(u,l)?0:u.slots[l].filter((slot,i)=>slot==='jump'&&!u.crit[l][i]).length),0):0;
  return Math.max(0,u.jump-u.jumpLost-this.floodedSlots(u,'jump')-submergedJets);
 }
 if(mode==='evade'&&(!this.tacticalOptions?.evading||
    legs.some(l=>u.actuators[l].hip||this.isBreached(u,l))))return 0;
 if(quad){
  // BMM p.44: first lost quad leg costs 1 walking MP and can
  // still run. Two lost legs = one lost biped leg (walk 1, no run);
  // three or more = zero ground MP. Quad front legs count as legs.
  if(lost>=3)return 0;
  let w=lost===2?1:u.walk-(lost===1?1:0);
  const intact=legs.filter(l=>u.structure[l]>0);
  const hips=intact.filter(l=>u.actuators[l].hip||this.isBreached(u,l)).length;
  w=hips===4?0:hips?Math.ceil(w/2):w;
  for(const l of intact){
   const a=u.actuators[l];
   if(!a.hip&&!this.isBreached(u,l))
    w-=Number(a.upper)+Number(a.lower)+Number(a.foot);
  }
  w=Math.max(0,w-Math.min(5,Math.floor(u.heat/5)));
  return mode==='run'||mode==='evade'?(lost>=2?0:Math.ceil(w*1.5)):w;
 }
 if(lost===2)return 0;
 let w=lost===1?1:u.walk;
 if(!lost){
  const hips=legs.filter(l=>u.actuators[l].hip||this.isBreached(u,l)).length;
  // AGoAC p.33: halve walking MP, rounding down. Damage to the
  // affected leg from earlier turns is ignored, but other actuator
  // hits in the hip-hit turn or later still reduce walking MP.
  w=hips===2?0:hips?Math.floor(w/2):w;
  for(const l of legs){
   if(this.isBreached(u,l))continue;
   const hits=u.actuatorHitRounds?.[l],hipTurn=hits?.hip;
   for(const part of ['upper','lower','foot']){
    if(!u.actuators[l][part])continue;
    if(!u.actuators[l].hip||
       Number.isInteger(hipTurn)&&Number.isInteger(hits?.[part])&&hits[part]>=hipTurn)w--;
   }
  }
 }
 w=Math.max(0,w-Math.min(5,Math.floor(u.heat/5)));
 return mode==='run'||mode==='evade'?(lost?0:Math.ceil(w*1.5)):w;
 }
 // A road discount applies only across a connected pair of hex edges.
 roadConnection(from,to){
  if(!from||!to)return false;
  const d=DIRS.findIndex(([q,r])=>from.q+q===to.q&&from.r+r===to.r);
  if(d<0)return false;
  return Array.isArray(from.roadEdges)&&Array.isArray(to.roadEdges)&&
   from.roadEdges.includes(d)&&to.roadEdges.includes(wrap(d+3));
 }
 terrainCost(t,from=null){
 const ground=this.roadConnection(from,t)&&!t.depth?1:t.type==='heavy'?3:['woods','rough','rubble'].includes(t.type)?2:
  t.depth?(t.depth===1?2:4):1;
 const building=t.building?.cf>0?BUILDING_ENTRY[t.building.type]:null;
 return ground+(building?.mp||0)+(this.weather.night?1:0);
 }
 resolveVoluntaryBuildingEntry(u,from,arrival,movedHexes){
  const tile=this.tile(arrival.q,arrival.r),building=tile?.building;
  if(!(building?.cf>0))return null;
  const rule=BUILDING_ENTRY[building.type];
  if(!rule)throw new Error('unsupported_building_type');
  const side=buildingImpactSide(u.facing,from,arrival);
  const tn=u.piloting+this.psrMod(u,false)+rule.psr+
   buildingMovementPSRModifier(movedHexes);
  // This is a collision check, not a fall-avoidance roll. A failed
  // building entry PSR deals damage but NEVER makes the unit fall.
  const success=this.roll(u.name+' · Вход в здание',tn)>=tn;
  const cfBefore=building.cf,mechDamage=success?0:Math.ceil(cfBefore/10);
  building.cf=Math.max(0,cfBefore-Math.ceil(u.tonnage/10));
  if(mechDamage)this.packets(u,mechDamage,side);
  this.note(`${u.name}: здание, ${success?'успех':'столкновение'}, ${side}, CF ${cfBefore}→${building.cf}.`);
  return {success,side,targetNumber:tn,damage:mechDamage,
    buildingDamage:cfBefore-building.cf};
 }

 reachable(u,mode='walk'){u=this.unit(u);if(u?.deployed===false)return this.deploymentEntryRoutes(u,mode);if(!['walk','run','jump','evade'].includes(mode))return [];if(this.phase!=='move'||!this.canAct(u)||this.isImmobile(u)||u.prone||u.moveEndedByLegLoss)return [];if(u.moveMode!=='stand'&&u.moveMode!==mode)return [];if(['run','evade'].includes(mode)&&(u.config==='Quad'?['LA','RA','LL','RL'].filter(l=>u.structure[l]===0).length>=2:u.structure.LL===0||u.structure.RL===0))return [];if(mode==='evade'&&(!this.tacticalOptions?.evading||(u.config==='Quad'?['LA','RA','LL','RL']:['LL','RL']).some(l=>u.actuators[l].hip||this.isBreached(u,l))))return [];if((u.dumping.length||u.dumpNext.length)&&['run','jump','evade'].includes(mode))return [];const max=this.mp(u,mode)-u.spent;if(max<0)return [];if(mode==='jump'){if(u.spent||u.proneAtStart||this.tile(u.q,u.r).depth>=2)return [];if(max<1)return [];const legal=this.jumpShortestReach(u,max);return this.tiles.filter(t=>!(t.building?.cf>0)&&!this.occupied(t.q,t.r,u.id)&&legal.has(key(t.q,t.r))).map(t=>({q:t.q,r:t.r,cost:Math.max(1,distance(u,t)),facing:u.facing,path:[{q:t.q,r:t.r,facing:u.facing}]}));}
 const lateralShifts=quadLateralDirections(u,mode);
 const actions=['left','right','forward','back',...lateralShifts.map(s=>s.action)];
 const start={q:u.q,r:u.r,facing:u.facing,cost:0,path:[]},states=new Map([[`${u.q},${u.r},${u.facing}`,start]]),ends=new Map([[key(u.q,u.r),start]]),open=[start];while(open.length){open.sort((a,b)=>a.cost-b.cost);const p=open.shift();for(const action of actions){let q=p.q,r=p.r,f=p.facing,c=1;const shift=lateralShifts.find(s=>s.action===action);if(action==='left'||action==='right')f=wrap(f+(action==='left'?1:-1));else{const backward=action==='back'||shift?.backward;if(backward&&mode!=='walk')continue;const d=DIRS[wrap(f+(shift?shift.offset:backward?3:0))];q+=d[0];r+=d[1];const t=this.tile(q,r),old=this.tile(p.q,p.r);if(!t)continue;const occ=this.units.find(x=>this.onMap(x)&&x.id!==u.id&&x.q===q&&x.r===r);if(occ&&(occ.team!==u.team||occ.dead))continue;const dh=t.height-old.height;if(Math.abs(dh)>2||backward&&dh!==0||['run','evade'].includes(mode)&&t.depth)continue;c=this.terrainCost(t,old)+Math.abs(dh)+(shift?1:0);}const cost=p.cost+c,k=`${q},${r},${f}`;if(cost>max||states.has(k)&&states.get(k).cost<=cost)continue;const v={q,r,facing:f,cost,path:[...p.path,{q,r,facing:f,cost:c,...(shift?{lateral:shift.backward?'backward':'forward'}:{})}]};states.set(k,v);open.push(v);if(!this.occupied(q,r,u.id)){
  const old=ends.get(key(q,r));
  if(!old||old.cost>cost||
    (u.config==='Quad'&&old.cost===cost&&v.facing===u.facing&&old.facing!==u.facing))
    ends.set(key(q,r),v);
 }}}return [...ends.values()];}
 // AGoAC pp.11–12: any shortest path is legal if every intervening
 // terrain level is within the jump ceiling. No detours around a hill.
 // Woods and occupants do not obstruct an intermediate jump hex.
 jumpShortestReach(u,max){
  const reached=new Set(),start=this.tile(u.q,u.r);
  if(!start||max<1)return reached;
  const ceiling=start.height+max,queue=[{tile:start,cost:0}];
  reached.add(key(start.q,start.r));
  for(let i=0;i<queue.length;i++){
   const {tile,cost}=queue[i];if(cost>=max)continue;
   for(const [dq,dr] of DIRS){
    const next=this.tile(tile.q+dq,tile.r+dr);
    if(!next||next.height>ceiling||distance(start,next)!==cost+1)continue;
    const k=key(next.q,next.r);if(reached.has(k))continue;
    reached.add(k);queue.push({tile:next,cost:cost+1});
   }
  }
  return reached;
 }
 jumpClear(u,t,max){return this.jumpShortestReach(u,max).has(key(t.q,t.r));}
 isPaved(t){return !!t&&(t.paved===true||t.road===true||['pavement','road','bridge'].includes(t.type));}
 skidTerrainCost(t){return t.type==='heavy'?3:['woods','rough','rubble'].includes(t.type)?2:1;}
 resolveSkid(u,direction,moved,tn){
  u.skidded=true;u.skidDirection=null;u.skidCollisionPending=null;
  const falling=Math.ceil(u.tonnage/10),perHex=Math.ceil(falling/2);
  let remaining=Math.ceil(moved/2),hexes=0,damageHexes=0,levelDamage=0,unresolved=0,fallResolved=false,collided=false;
  const path=[],d=DIRS[wrap(direction)];
  let cursor={q:u.q,r:u.r},crossed=null;
  const applySkidDamage=()=>{
   if(u.dead)return;
   if(!fallResolved){this.fall(u,0,tn,null,unresolved*perHex);fallResolved=true;}
   else if(unresolved)this.packets(u,unresolved*perHex,u.lastFallSide||'front');
   unresolved=0;
  };
  while(remaining>0&&!u.dead){
   const q=cursor.q+d[0],r=cursor.r+d[1],tile=this.tile(q,r);
   if(!tile){u.dead=true;this.note(u.name+': скольжение за край поля.');break;}
   const oldTile=this.tile(cursor.q,cursor.r);
   if(tile.height>oldTile.height){
    // BMM p.71: level rise is an obstacle, not a legal skid hex.
    // Resolve previous slide packets before the front-facing crash.
    applySkidDamage();
    if(!u.dead){
     const impact=Math.ceil(u.tonnage/20);
     this.packets(u,impact,'front');levelDamage+=impact;
     this.note(u.name+': скольжение остановилось при столкновении с подъёмом.');
    }
    break;
   }
   if(oldTile.height-tile.height>=2&&!this.occupied(q,r,u.id)&&!tile.depth){
    // BMM p.70: a drop of two or more levels ends the skid in the
    // lower hex. Entering open air does not incur skid-per-hex damage.
    applySkidDamage();
    if(u.dead)break;
    const drop=oldTile.height-tile.height;
    u.q=q;u.r=r;cursor={q,r};hexes++;remaining=0;
    if(crossed){path.push(crossed);crossed=null;}
    path.push({q,r});
    levelDamage+=Math.ceil(u.tonnage/10)*(drop+1);
    this.fall(u,drop);
    this.note(u.name+': скольжение закончилось падением с высоты '+drop+'.');
    break;
   }
   if(tile.depth>=1&&!this.occupied(q,r,u.id)){
    // BMM p.70: entering Depth 1+ water immediately stops the skid.
    // No additional skid damage is taken for this water hex. Apply
    // preceding falling/slide packets while still on the prior terrain.
    applySkidDamage();
    if(u.dead)break;
    u.q=q;u.r=r;cursor={q,r};hexes++;remaining=0;
    if(crossed){path.push(crossed);crossed=null;}
    path.push({q,r});
    this.checkExistingHullBreaches(u);
    this.note(u.name+': скольжение остановилось при входе в воду.');
    break;
   }
   hexes++;damageHexes++;unresolved++;remaining-=this.skidTerrainCost(tile);
   const target=this.units.find(v=>v.deployed!==false&&!v.dead&&v.id!==u.id&&v.q===q&&v.r===r);
   if(target){
    collided=true;u.skidCollisionPending={q,r,targetId:target.id};
    this.note(u.name+': столкновение во время скольжения.');
    applySkidDamage();
    if(u.dead){u.skidCollisionPending=null;break;}
    const result=this.resolveSkidCollision(u,target,direction,moved,{q,r});
    u.skidCollisionPending=null;
    if(result.hit){
     if(crossed){path.push(crossed);crossed=null;}
     path.push({q:u.q,r:u.r});cursor={q,r};
     if(!result.continueSkid)break;
    }else{
     // BMM p.71: a missed involuntary charge does not end the skid.
     // A skid may pass through an occupied hex only if it exits that hex.
     crossed={q,r};cursor={q,r};
    }
    continue;
   }
   u.q=q;u.r=r;cursor={q,r};
   if(crossed){path.push(crossed);crossed=null;}
   path.push({q,r});
  }
  u.spent=this.mp(u,'run');
  if(!u.dead)applySkidDamage();
  if(crossed)this.note(u.name+': скольжение завершилось перед занятым гексом.');
  return {path,hexes,damage:falling+damageHexes*perHex+levelDamage,collision:collided};
 }
 // Skidding damage is inflicted before any accidental collision/charge.
 // BMM 2022 p.69: +2 run, +1 skid, +3 involuntary charge.
 resolveSkidCollision(u,t,dir,moved,hex){
  if(!t||t.dead||u.dead)return {hit:false};
  const targetNumber=u.piloting+2+1+3+(t.moved?this.tmm(t):0);
  const attackRoll=this.roll(u.name+' · Непреднамеренный таран',targetNumber);
  if(attackRoll<targetNumber){this.note(u.name+': таран при скольжении не попал.');return {hit:false};}
  // The BattleMech Manual allows an unmoved defender to attempt to dodge.
  if(!t.moved&&this.mobile(t)){
   const avoidance=t.piloting+this.psrMod(t);
   if(this.roll(t.name+' · Уклонение от скольжения',avoidance)>=avoidance){
    this.note(t.name+': избежал непреднамеренного тарана.');return {hit:false,avoided:true};
   }
  }
  const targetDamage=Math.ceil(u.tonnage/10*moved),selfDamage=Math.ceil(t.tonnage/10),side=this.hitSide(t,u);
  this.packets(t,targetDamage,side,'kick');
  this.packets(u,selfDamage,'front','normal');
  if(!t.dead&&!this.displace(t,dir)){t.dead=true;this.note(t.name+': вытеснение невозможно.');}
  u.q=hex.q;u.r=hex.r;t.moved=true;
  if(!t.dead)this.psr(t,2,'Таран при скольжении',true);
  this.note(u.name+': непреднамеренный таран, '+targetDamage+' урона цели и '+selfDamage+' себе.');
  u.skidCollisionPending=null;
  return {hit:true,continueSkid:t.dead,damage:targetDamage,selfDamage};
 }
 // AGoAC pp.9,12: facing changes spend the already declared ground
 // movement mode's MP, including when the Mech starts prone.
 rotate(id,delta,options={}){
  const u=this.unit(id);
  if(u?.deployed===false)return fail('Сначала войдите на поле');
  if(this.phase!=='move'||!this.canAct(u)||this.isImmobile(u)||u.moveMode==='jump'||u.moveEndedByLegLoss)
   return fail('Разворот недоступен');
  const cost=Math.abs(delta);
  if(!Number.isInteger(delta)||cost<1||cost>3)return fail('Поворот: 1–3 гексстороны за действие');
  const mode=options.mode??(u.moveMode==='stand'?'walk':u.moveMode);
  if(!['walk','run','evade'].includes(mode)||u.moveMode!=='stand'&&u.moveMode!==mode||
     u.prone&&mode==='evade'||mode!=='walk'&&(u.dumping.length||u.dumpNext.length))
   return fail('Неверный режим движения для разворота');
  if(u.spent+cost>this.mp(u,mode))return fail('Нет MP');
  if(u.gyroHits>=2&&(u.spent>0||cost>1))return fail('Разрешён один разворот с разрушенным гироскопом');
  u.spent+=cost;u.moveMode=mode;
  if(mode==='run'&&this.isPaved(this.tile(u.q,u.r))&&u.skidDirection===null)
   u.skidDirection=u.lastMovementDirection??u.facing;
  u.facing=wrap(u.facing+delta);this.actingId=id;return {ok:true};
 }
 // AGoAC pp.9,11,42: transit through a friendly hex is legal;
 // if an immediate fall or other involuntary stop leaves two live
 // ground Mechs there, resolve the resulting stacking via domino.
 resolveGroundStacking(u){
  if(u.dead||!Number.isInteger(u.lastMovementDirection)||u.lastMovementDirection<0)return;
  const other=this.units.find(v=>v.id!==u.id&&this.onMap(v)&&!v.dead&&!v.airborne&&v.q===u.q&&v.r===u.r);
  if(other)this.resolveDomino(other,u.lastMovementDirection,0);
 }
 move(id,q,r,mode='walk',options={}){const u=this.unit(id);
 if(options.facing!==undefined&&(mode!=='jump'||!Number.isInteger(options.facing)||options.facing<0||options.facing>5))
  return fail('Направление посадки допустимо только для прыжка');
 if(u?.deployed===false)return options.lateral===undefined?this.enterDeployment(u,q,r,mode,options):fail('Сначала войдите на поле');if(mode==='minimum')return fail('Используйте отдельный приказ минимального движения');const routes=this.reachable(u,mode);
 let dst=routes.find(t=>t.q===q&&t.r===r);
 if(options?.lateral!==undefined){
  // Explicit BMM p.15 lateral choice must remain legal even when an
  // alternate rotated path to the same hex has a lower total MP cost.
  const shift=quadLateralDirections(u,mode).find(s=>s.action===options.lateral);
  const dir=shift&&DIRS[wrap(u.facing+shift.offset)];
  const fromTile=this.tile(u.q,u.r),toTile=this.tile(q,r);
  const delta=fromTile&&toTile?toTile.height-fromTile.height:99;
  const occupied=this.occupied(q,r,u.id);
  const valid=routes.length&&shift&&dir&&u.q+dir[0]===q&&u.r+dir[1]===r&&
    toTile&&!occupied&&Math.abs(delta)<=2&&(!shift.backward||delta===0)&&
    (!['run','evade'].includes(mode)||!toTile.depth);
  if(!valid)return fail('Нелегальное боковое смещение');
  const cost=this.terrainCost(toTile,fromTile)+Math.abs(delta)+1;
  if(cost+u.spent>this.mp(u,mode))return fail('Недостаточно MP для бокового смещения');
  dst={q,r,facing:u.facing,cost,
    path:[{q,r,facing:u.facing,cost,lateral:shift.backward?'backward':'forward'}]};
 }
 if(!dst)return fail('Недоступный путь или очередь другого отряда');this.phaseRolls=[];this.actingId=id;const from={q:u.q,r:u.r},path=[];u.moveMode=mode;if(mode==='jump'){u.q=q;u.r=r;u.facing=options.facing??u.facing;u.spent=dst.cost;u.pendingHeat+=Math.max(3,dst.cost);path.push({q,r});// BMM p.45: losing the first Quad leg adds +5 to the landing
 // PSR even though this damage does not itself add +5 to normal
 // Quad PSR modifiers. Two lost legs already contribute +5 via
 // psrMod (the one-legged biped equivalent), so do not double count.
 const firstQuadLegLost=u.config==='Quad'&&
  ['LA','RA','LL','RL'].filter(loc=>u.structure[loc]===0).length===1;
 const landingModifier=firstQuadLegLost?5:0;
 if(this.tile(q,r).depth){
  this.checkExistingHullBreaches(u);
  if(!u.dead)this.psr(u,landingModifier,'Посадка в воду',true,this.tile(q,r).depth);
 }else if(landingModifier||this.psrMod(u))
  this.psr(u,landingModifier,'Посадка',true);}else for(const p of dst.path){
 const moved=u.q!==p.q||u.r!==p.r;
 if(!moved&&p.facing!==u.facing&&mode==='run'&&this.isPaved(this.tile(u.q,u.r))&&u.skidDirection===null)
  u.skidDirection=u.lastMovementDirection??u.facing;
 if(moved&&mode==='run'&&Number.isInteger(u.skidDirection)){
  const n=u.distanceMoved+path.length,tn=u.piloting+this.psrMod(u,true)+skidModifier(n);
  const direction=u.skidDirection;u.skidDirection=null;
  if(this.roll(u.name+' · Скольжение',tn)<tn){
   const skid=this.resolveSkid(u,direction,n,tn);
   path.push(...skid.path);break;
  }
 }
 const oldQ=u.q,oldR=u.r;
 u.q=p.q;u.r=p.r;u.facing=p.facing;u.spent+=p.cost;
 if(moved){
  u.lastMovementDirection=DIRS.findIndex(d=>d[0]===u.q-oldQ&&d[1]===u.r-oldR);
  // AGoAC p.16: only travel since the last forward/backward reversal
  // contributes to TMM. Turning alone does not reset the distance.
  const travel=p.lateral??(u.lastMovementDirection===wrap(u.facing+3)?'backward':'forward');
  if(u.tmmTravel&&u.tmmTravel!==travel)u.tmmReversalOffset=u.distanceMoved+path.length;
  u.tmmTravel=travel;
  path.push({q:u.q,r:u.r});
  this.resolveVoluntaryBuildingEntry(u,{q:oldQ,r:oldR},
   {q:u.q,r:u.r},u.distanceMoved+path.length);
  if(u.dead||u.moveEndedByLegLoss)break;
  this.checkExistingHullBreaches(u);if(u.dead||u.moveEndedByLegLoss)break;
  const t=this.tile(u.q,u.r);
  if(t.depth||t.type==='rubble'){
   this.psr(u,t.depth>=3?1:t.depth===1?-1:0,t.depth?'Вода':'Обломки',true);
   if(u.prone)break;
  }
 }
}
 if(mode!=='jump')this.resolveGroundStacking(u);
 u.distanceMoved=mode==='jump'?distance(u.moveStart,u):u.distanceMoved+path.length;this.note(`${u.name}: ${mode}, потрачено ${u.spent} MP.`);return {ok:true,path,from,to:{q:u.q,r:u.r},mode,rolls:[...this.phaseRolls]};}
 stand(id,newFacing=null,options={}){const u=this.unit(id),quad=u?.config==='Quad';
  const lost=quad?['LA','RA','LL','RL'].filter(l=>!u.structure[l]).length:0;
  if(this.phase!=='move'||!this.canAct(u)||!u.prone||this.isImmobile(u)||u.gyroHits>=2||u.moveEndedByLegLoss||
    (quad?lost>=3:u.structure.LL+u.structure.RL===0))
    return fail('Мех не может встать');
  if(newFacing!==null&&(!Number.isInteger(newFacing)||newFacing<0||newFacing>5))
    return fail('Неверное направление при подъёме');
  if(u.moveMode==='jump')return fail('Нельзя встать в ход с прыжком');
  if(options?.mode!==undefined&&!['walk','run'].includes(options.mode))
    return fail('Неверный режим движения при подъёме');
  const restricted=quad?lost===2:!u.structure.LL||!u.structure.RL;
  if(restricted&&(quad?!!u.standAttempts:(!u.structure.LA&&!u.structure.RA||u.standAttempts)))
    return fail('Подъём невозможен');
  // BMM pp.16,19: a prone Mech with only 1 available MP may use
  // Minimum Movement to attempt standing once, counted as running.
  const minimum=options?.minimum===true;
  const available=Math.max(this.mp(u,'walk'),this.mp(u,'run'));
  if(minimum&&(u.spent!==0||u.standAttempts!==0||available!==1))
    return fail('Минимальный подъём требует ровно 1 доступный MP и одну попытку');
  const committed=['walk','run'].includes(u.moveMode)?u.moveMode:null;
  const selected=minimum||restricted?'run':options?.mode??committed??
    (u.spent+2<=this.mp(u,'walk')?'walk':'run');
  if((minimum||restricted)&&options?.mode==='walk')
    return fail('Минимальный и двухногий подъём считаются бегом');
  if(committed&&selected!==committed)
    return fail('Нельзя сменить объявленный режим движения');
  if(selected==='run'&&(u.dumping.length||u.dumpNext.length))
    return fail('Сброс боезапаса запрещает бег');
  const standingBudget=restricted?2:this.mp(u,selected);
  if(!minimum&&u.spent+2>standingBudget)return fail('Нужно 2 MP');
  this.phaseRolls=[];u.standAttempts++;u.spent+=minimum?1:2;u.pendingHeat++;
  // AGoAC p.12: a one-legged biped's restricted standing attempt
  // includes every applicable modifier in its one required PSR.
  if(!quad&&restricted)u.restrictedStandThisTurn=true;
  u.moveMode=selected;
  u.prone=false;this.actingId=id;
  // BMM p.19: a Quad with all four legs intact stands automatically.
  const stood=quad&&lost===0||this.psr(u,0,'Подъём',true);
  // The player chooses any new facing at no MP charge, but only on success.
  if(stood&&newFacing!==null)u.facing=newFacing;
  return {ok:true};}
 // AGoAC p.12: dropping voluntarily costs 1 MP; no jump, fall damage
 // or additional heat. The declared ground movement mode is retained.
 drop(id,options={}){
  const u=this.unit(id);if(u?.deployed===false)return fail('Сначала войдите на поле');
  if(this.phase!=='move'||!this.canAct(u)||this.isImmobile(u)||u.prone||u.moveEndedByLegLoss)return fail('Нельзя лечь');
  const mode=options.mode??(u.moveMode==='stand'?'walk':u.moveMode);
  if(!['walk','run'].includes(mode)||(u.moveMode!=='stand'&&u.moveMode!==mode)||
     (mode==='run'&&(u.dumping.length||u.dumpNext.length))||this.mp(u,mode)-u.spent<1)
   return fail('Чтобы лечь, нужен 1 MP ходьбы или бега');
  u.moveMode=mode;u.spent++;u.prone=true;this.actingId=id;
  this.checkExistingHullBreaches(u);return {ok:true};
 }
 hold(id){const u=this.unit(id);if(u?.deployed===false&&!u.dead)return fail('Сначала войдите на поле');if(!this.canAct(u)&&!(u.dead&&this.phase==='move'&&this.actingId===id&&this.activeTeam===u.team))return fail('Выберите меха действующего отряда');if(this.phase==='move'){if(u.moveMode==='walk')u.pendingHeat++;if(u.moveMode==='evade'){u.pendingHeat+=4;}if(u.moveMode==='run'){u.pendingHeat+=2;if(!(u.config!=='Quad'&&u.restrictedStandThisTurn)&&(u.gyroHits||(u.config==='Quad'?['LA','RA','LL','RL']:['LL','RL']).some(l=>u.actuators[l].hip)))this.psr(u,0,'Бег с повреждениями',true);}}this.finish(u);return {ok:true};}
 relative(a,b,f=a.facing){const x=Math.sqrt(3)*(b.q-a.q+(b.r-a.r)/2),y=-1.5*(b.r-a.r),v=Math.atan2(y,x)-f*Math.PI/3;return Math.atan2(Math.sin(v),Math.cos(v))*180/Math.PI;}
 // AGoAC p.22: front spans three hexsides, rear one, each flank one.
 // A line through the front/flank or flank/rear vertex is the defender's choice.
 hitSideOptions(u,a){
  const angle=this.relative(u,a),absolute=Math.abs(angle),flank=angle>0?'left':'right';
  if(Math.abs(absolute-90)<1e-7)return ['front',flank];
  if(Math.abs(absolute-150)<1e-7)return [flank,'rear'];
  return [absolute<90?'front':absolute>150?'rear':flank];
 }
 hitSide(u,a){return this.hitSideOptions(u,a)[0];}
 weaponHitSide(t,u,s){
  const options=s.preview.sideOptions??[s.preview.side];
  // Legacy saved declarations have their original single side frozen.
  return this.chooseResolutionOption('hit-direction',t,options.map(id=>({id})),options[0],
   {attackerId:u.id,weaponName:s.weapon.name,weaponIndex:s.index});
 }
 arc(u,t,w){
  // BMM p.83: a directional torso mount is a separately configured
  // device attached to a specific installed weapon. The 3-point Quad
  // version is a six-direction turret, while the 2-point version
  // selects only forward or rear. Both rotate along with torso twist.
  const wi=u.weapons?.indexOf(w);
  const mount=wi>=0?u.directionalTorsoMounts?.find(m=>
   m.weaponIndices?.includes(wi)&&['CT','LT','RT'].includes(m.location)):null;
  if(mount){
   const bearing=wrap(u.facing+mount.facing+(u.twist||0));
   return Math.abs(this.relative(u,t,bearing))<=60.00001;
  }
  const location=w.locations?.some(loc=>['CT','LT','RT','HD'].includes(loc))?'CT':w.location;
  // BMM p.24: quad front limbs are legs, not biped arms; only biped
  // arms receive the extra side-arc coverage. Leg arcs never twist.
  const bipedArm=u.config!=='Quad'&&['LA','RA'].includes(location);
  const leg=['LL','RL'].includes(location)||(u.config==='Quad'&&['LA','RA'].includes(location));
  const reversed=!!w.rear||(bipedArm&&!!u.flip);
  const a=this.relative(u,t,wrap(u.facing+(leg?0:u.twist)+(reversed?3:0)));
  if(reversed)return Math.abs(a)<=60.00001;
  if(bipedArm)return location==='LA'?a>=-60.00001&&a<=120.00001:
    a>=-120.00001&&a<=60.00001;
  return Math.abs(a)<=60.00001;
 }
 // Store the selected geometric side on the lower-ID unit so reverse fire
 // uses the same path. The round stamp makes stale selections inert.
 chooseLosPath(attacker,target,choice,team,{spotting=false}={}){
  const a=this.unit(attacker),b=this.unit(target);
  if(this.phase!=='fire'||!a||!b||a===b||a.team===b.team||b.team!==team||
     a.fired&&!spotting||![-1,1].includes(choice))return fail('Выбор линии огня недоступен');
  const paths=this.losAlternatives(a,b);
  if(paths.length!==2||!paths.some(p=>p.choice===choice))return fail('Нет альтернативной линии огня');
  const [first,second]=a.id<b.id?[a,b]:[b,a];
  const selections=first.losPathSelections??(first.losPathSelections={});
  const previous=selections[second.id];
  if(previous?.round===this.round)return fail('Линия огня уже выбрана');
  selections[second.id]={round:this.round,choice:a===first?choice:-choice};
  return {ok:true};
 }
 // Interactive declarations resolve each ambiguous pair before firing.
 // Choices are independent of weapon damage/dice and stored in plain state.
 // An empty hex is a distinct, canonical fire target, never a fake
 // BattleMech in the unit registry. In particular it cannot mask a
 // friendly/hostile occupant. Use the ground (water surface) as its
 // LOS endpoint; it has no body, facing, posture or partial cover.
 fireTarget(id){
  if(typeof id!=='string')return typeof id==='number'?this.unit(id):null;
  const match=/^hex:(0|-?[1-9]\d{0,2}),(0|-?[1-9]\d{0,2})$/.exec(id);
  if(!match)return null;
  const q=Number(match[1]),r=Number(match[2]),tile=this.tile(q,r);
  if(!tile||this.units.some(u=>this.onMap(u)&&u.q===q&&u.r===r))return null;
  return {id,q,r,name:'Гекс '+q+', '+r,hexTarget:true,team:null,prone:false,heat:0,distanceMoved:0,moveMode:'stand'};
 }
 prepareFireLos(id,targets,humanTeams=[0],{sourceId=id}={}){
  const actor=this.unit(id),a=this.unit(sourceId),spotting=sourceId!==id;
  if(this.phase!=='fire'||this.pendingChoice||!this.canAct(actor)||!a||a.team!==actor.team||a.dead||a.deployed===false)return fail('Выбор линии огня недоступен');
  let changed=false;
  for(const target of new Set(targets)){
   const b=this.fireTarget(target);
   if(!b||b.team===a.team||b.dead||b.deployed===false||this.selectedLosPath(a,b))continue;
   const paths=this.losAlternatives(a,b);
   if(paths.length!==2)continue;
   if(b.hexTarget){
    const path=paths[this.rng()<.5?0:1];
    (a.losPathSelections??={})[b.id]={round:this.round,choice:path.choice};
    changed=true;continue;
   }
   if(humanTeams.includes(b.team)){
    this.pendingChoice={kind:'los-path',scope:'los',team:b.team,unitId:b.id,
     key:this.round+':los:'+a.id+':'+b.id,context:{attackerId:a.id,...(spotting?{spotting:true}:{})},
     options:paths.map(p=>({...p,id:String(p.choice)}))};
    return {ok:true,pending:true,losPrepared:true};
   }
   // In single-player the defending AI prefers obstruction, then cover,
   // then more woods. A human defender always makes their own decision.
   const priority=p=>Number(p.blocked)*100+Number(p.cover)*10+p.woods;
   const chosen=priority(paths[1])>priority(paths[0])?paths[1]:paths[0];
   const result=this.chooseLosPath(a.id,b.id,chosen.choice,b.team,{spotting});
   if(!result.ok)return result;
   changed=true;
  }
  return {ok:true,losPrepared:changed};
 }
 resolveFireLosChoice(choice,humanTeams=[0]){
  const p=this.pendingChoice;
  if(p?.scope!=='los'||!humanTeams.includes(p.team)||choice?.key!==p.key||
     !p.options.some(o=>o.id===choice.option))return fail('Выберите допустимую линию огня');
  const result=this.chooseLosPath(p.context.attackerId,p.unitId,Number(choice.option),p.team,{spotting:!!p.context.spotting});
  if(!result.ok)return result;
  this.pendingChoice=null;
  return {ok:true,losPrepared:true};
 }
 declareFireWithLosChoices(id,assignments,primaryTarget=null,{humanTeams=[0]}={}){
  const u=this.unit(id);
  if(!u||!Array.isArray(assignments)||assignments.some(s=>!u.weapons[s.index]||!this.fireTarget(s.target))||
     new Set(assignments.map(s=>s.index)).size!==assignments.length||
     primaryTarget!==null&&!this.primaryTargetChoices(id,assignments).includes(primaryTarget))
   return fail('Недопустимая декларация огня');
  const prepared=this.prepareAttackLos(id,assignments,humanTeams);
  if(!prepared.ok||prepared.losPrepared)return prepared;
  return this.declareFire(id,assignments,primaryTarget);
 }
 // AGoAC p.21: one spotter can serve multiple attackers, but only
 // against one target per turn. The declarations are the journal.
 spottingTargets(){
  const targets=new Map();
  for(const d of this.declarations)for(const s of d.shots)
   if(s.spotter!=null)targets.set(s.spotter,s.target);
  return targets;
 }
 checkIndirectSpotter(u,t,w,spotterId,targets=this.spottingTargets()){
  const s=this.unit(spotterId);
  if(!w.name.startsWith('LRM ')||!w.rack||w.ammo===null)return 'Непрямой огонь только из LRM';
  if(!Number.isInteger(spotterId)||!s||s===u||s.team!==u.team||s.dead||s.deployed===false||s.charge)
   return 'Нужен другой союзный мех без тарана/DFA';
  if(targets.has(s.id)&&targets.get(s.id)!==t.id)return 'Корректировщик уже назначен другой цели';
  return '';
 }
 prepareAttackLos(id,assignments,humanTeams=[]){
  const u=this.unit(id),spots=this.spottingTargets();
  for(const s of assignments)if(s.spotter!=null){
   const t=this.fireTarget(s.target),w=u?.weapons[s.index];
   if(!t||!w||s.aim||s.heatMode)return fail('Недопустимая непрямая атака');
   const reason=this.checkIndirectSpotter(u,t,w,s.spotter,spots);
   if(reason)return fail(reason);
   spots.set(s.spotter,t.id);
  }
  const direct=this.prepareFireLos(id,assignments.map(s=>s.target),humanTeams);
  if(!direct.ok||direct.pending)return direct;
  let changed=direct.losPrepared;
  for(const s of assignments)if(s.spotter!=null){
   const prepared=this.prepareFireLos(id,[s.target],humanTeams,{sourceId:s.spotter});
   if(!prepared.ok||prepared.pending)return prepared;
   changed||=prepared.losPrepared;
  }
  return {ok:true,losPrepared:changed};
 }
 aiAttackWithLosChoices(id,{humanTeams=[0]}={}){
  const a=this.unit(id);
  if(!this.canAct(a)||!this.mobile(a)||a.moveMode==='evade')return this.hold(id);
  // Pick a real intended attack before asking its defender. Persist that
  // intent while an interactive choice is outstanding (including saves).
  const plan=a.aiFirePlan?.round===this.round?a.aiFirePlan:this.planAiFire(a);
  if(!plan?.indices.length){delete a.aiFirePlan;return this.hold(id);}
  a.aiFirePlan={...plan,round:this.round};
  a.twist=plan.twist;
  const prepared=this.prepareFireLos(id,[plan.target],humanTeams);
  if(!prepared.ok||prepared.pending)return prepared;
  delete a.aiFirePlan;
  // A defender may block the attack. Do not seek another defender or
  // change the nominated target after that choice.
  const indices=plan.indices.filter(i=>this.preview(id,plan.target,i).legal);
  if(!indices.length)return this.hold(id);
  const result=this.attack(id,plan.target,indices);
  return result.ok?result:this.hold(id);
 }
 selectedLosPath(a,b){
  if(a.hexTarget||b.hexTarget){
   const source=a.hexTarget?b:a,hex=a.hexTarget?a:b;
   const selected=source.losPathSelections?.[hex.id];
   return selected?.round===this.round?(a.hexTarget?-selected.choice:selected.choice):0;
  }
  const [first,second]=a.id<b.id?[a,b]:[b,a];
  const selected=first.losPathSelections?.[second.id];
  return selected?.round===this.round?(a===first?selected.choice:-selected.choice):0;
 }
 // AGoAC p.13: intersect the closed hex footprint, not just sampled
 // hex centers. A point-only corner contact counts; a shared edge has
 // two selectable sides. Axial Voronoi half-planes are integer-valued.
 losHexPath(a,b,choice){
  const dq=b.q-a.q,dr=b.r-a.r,epsilon=1e-12;
  const cells=[],axes=[[2,1],[1,2],[1,-1]];
  for(let q=Math.min(a.q,b.q)-1;q<=Math.max(a.q,b.q)+1;q++){
   for(let r=Math.min(a.r,b.r)-1;r<=Math.max(a.r,b.r)+1;r++){
    if(q===a.q&&r===a.r||q===b.q&&r===b.r)continue;
    let lo=0,hi=1,edge=false;
    for(const [x,y] of axes){
     const offset=x*(a.q-q)+y*(a.r-r),slope=x*dq+y*dr;
     if(!slope){
      if(Math.abs(offset)>1){lo=2;break;}
      if(Math.abs(offset)===1)edge=true;
     }else{
      const first=(-1-offset)/slope,last=(1-offset)/slope;
      lo=Math.max(lo,Math.min(first,last));hi=Math.min(hi,Math.max(first,last));
     }
    }
    if(lo>hi+epsilon)continue;
    if(edge&&hi-lo>epsilon&&choice*(dq*(r-a.r)-dr*(q-a.q))<0)continue;
    cells.push({q,r,position:(lo+hi)/2});
   }
  }
  return cells.sort((x,y)=>x.position-y.position).map(({q,r})=>({q,r}));
 }
 losAlternatives(a,b,underwaterWeapon=null){
  a=this.unit(a);b=this.unit(b);
  if(!a||!b)return [];
  const left=this.losHexPath(a,b,1),right=this.losHexPath(a,b,-1);
  const first={path:left,choice:1,...this.evaluateLos(a,b,underwaterWeapon,left)};
  return JSON.stringify(left)===JSON.stringify(right)?[first]:[first,{path:right,choice:-1,...this.evaluateLos(a,b,underwaterWeapon,right)}];
 }
 los(a,b,underwaterWeapon=null,edgeChoice=null){
  a=this.unit(a);b=this.unit(b);
  // Until the defender chooses, keep a reciprocal deterministic preview.
  const choice=(edgeChoice??this.selectedLosPath(a,b))||(b.hexTarget?1:a.hexTarget?-1:a.id<b.id?1:-1);
  return this.evaluateLos(a,b,underwaterWeapon,this.losHexPath(a,b,choice));
 }
 evaluateLos(a,b,underwaterWeapon,path){
  const ta=this.tile(a.q,a.r),tb=this.tile(b.q,b.r);
  const subA=a.hexTarget?false:underwaterWeapon===null?ta.depth>=(a.prone?1:2):underwaterWeapon;
  const subB=!b.hexTarget&&(tb.depth>=(b.prone?1:2)||(subA&&tb.depth===1&&!b.prone));
  // AGoAC p.14: submerged endpoints have no weapon LOS; the BMM
  // underwater-combat extension must be explicitly selected.
  if(subA!==subB||(!this.tacticalOptions?.underwaterFire&&(subA||subB)))return {woods:0,blocked:true,cover:false};
  const ah=a.hexTarget?(ta.depth?ta.surface:ta.height):ta.height+(a.prone?1:2),bh=b.hexTarget?(tb.depth?tb.surface:tb.height):tb.height+(b.prone?1:2);
  let interveningWoods=0,blocked=false,cover=!b.hexTarget&&tb.depth===1&&!b.prone;
  for(const p of path){
   const t=this.tile(p.q,p.r);if(!t)continue;
   const nearA=distance(a,p)===1,nearB=distance(b,p)===1;
   // AGoAC p.13 defines the inclusive height tests for BattleMechs.
   // A bare hex is a ground/surface endpoint: terrain flush with that
   // endpoint is not a wall, but higher adjacent terrain still blocks.
   // Keep the original inclusive comparisons for both Mech endpoints.
   const reachesA=level=>a.hexTarget?level>ah:level>=ah;
   const reachesB=level=>b.hexTarget?level>bh:level>=bh;
   const intervenes=level=>reachesA(level)&&reachesB(level)||nearA&&reachesA(level)||nearB&&reachesB(level);
   const terrainLevel=t.depth&&!subA?t.surface:t.height;
   if(intervenes(terrainLevel))blocked=true;
   if(!b.hexTarget&&nearB&&t.type!=='bridge'&&t.height===tb.height+1&&ah<=bh&&!b.prone)cover=true;
   if((t.type==='woods'||t.type==='heavy')&&intervenes(t.height+2))interveningWoods+=t.type==='heavy'?2:1;
  }
  const targetWoods=tb.type==='heavy'?2:tb.type==='woods'?1:0;
  return {woods:interveningWoods+targetWoods,blocked:blocked||interveningWoods>=3,cover};
 }
 tmm(u){const d=Math.max(0,u.distanceMoved-(u.moveMode==='jump'?0:u.tmmReversalOffset??0));return (d>=25?6:d>=18?5:d>=10?4:d>=7?3:d>=5?2:d>=3?1:0)+(u.moveMode==='jump'?1:0);}
 targetMovementModifier(t,{includeImmobile=true}={}){
  const movement=this.tmm(t);
  // AGoAC p.19: movement and immobility are cumulative.
  // Preserve the existing TO rule: a mobile target alone receives
  // the optional standing-still and evading modifiers.
  if(this.isImmobile(t))return movement+(includeImmobile?-4:0);
  return movement+(t.skidded?2:0)+(this.tacticalOptions?.standingStill&&t.spent===0?-1:0)+(this.tacticalOptions?.evading&&t.moveMode==='evade'&&!t.prone?1:0);
 }
 preview(id,target,index,opts={}){const u=this.unit(id),t=this.fireTarget(target),w=u?.weapons[index];if(!u||!t||!w)return {legal:false,chance:0,targetNumber:99,reason:'Выберите цель'};if(u.deployed===false||t.deployed===false)return {legal:false,chance:0,targetNumber:99,reason:'Мех ещё не вышел на поле'};const quadProneBonus=quadProneFireBonus(u),range=distance(u,t),act=u.actuators[w.location],sub=this.tile(u.q,u.r).depth>=(u.prone||mechLegLocation(u,w.location)?1:2),waterline=!t.hexTarget&&this.tile(t.q,t.r).depth===1&&!t.prone,targetSub=!t.hexTarget&&this.tile(t.q,t.r).depth>=(t.prone?1:2),underwaterCover=sub&&waterline,directLos=this.los(u,t,sub),indirect=opts.spotter!=null,spotter=indirect&&Number.isInteger(opts.spotter)?this.unit(opts.spotter):null,spotterError=indirect?this.checkIndirectSpotter(u,t,w,opts.spotter):'',los=indirect&&!spotterError?this.los(spotter,t):directLos,ranges=sub?(UNDERWATER_RANGES[w.name]||[0,0,0]):w.ranges;let reason='';if(!this.mobile(u)||t.dead||u.team===t.team)reason='Мех не может стрелять';else if(u.charge)reason='Заявлен таран/DFA';else if(u.moveMode==='evade')reason='Уклонение запрещает атаки';else if(w.destroyed||!u.structure[w.location]||this.isBreached(u,w.location)||w.locations?.some(l=>this.isBreached(u,l)))reason='Оружие уничтожено или затоплено';else if(u.sensorHits>=2)reason='Датчики уничтожены';else if(w.ammo===0)reason='Нет боезапаса';else if(!this.arc(u,t,w))reason='Вне сектора огня';else if(sub&&(!this.tacticalOptions?.underwaterFire||!UNDERWATER_RANGES[w.name]))reason='Оружие не допускает подводную стрельбу';else if(!range||range>ranges[2])reason='Вне дальности';else if(!sub&&mechLegLocation(u,w.location)&&this.los(t,u).cover)reason='Ноги скрыты собственным частичным укрытием';else if(indirect&&(spotterError||opts.aim||opts.heatMode||sub||targetSub||!directLos.blocked))reason=spotterError||'Непрямой огонь требует отсутствия прямой LOS и запрещает прицеливание/подводную стрельбу';else if(los.blocked)reason=indirect?'Корректировщик не видит цель':'Линия огня перекрыта';else if((sub!==targetSub&&!underwaterCover)||sub&&!UNDERWATER_RANGES[w.name])reason='Стрельба через поверхность воды запрещена';else if(u.prone&&u.config!=='Quad'&&(!u.structure.LA||!u.structure.RA))reason='Для стрельбы лёжа требуются обе сохранившиеся руки';else if(u.prone&&(
  u.config==='Quad'
   ?(!quadProneBonus&&(mechLegLocation(u,w.location)||
      w.locations?.some(loc=>mechLegLocation(u,loc))))
   :(['LL','RL'].includes(w.location)||
      w.location===(u.brace||'LA')||
      w.locations?.includes(u.brace||'LA')||
      !u.structure[u.brace||'LA'])))
  reason='Оружие недоступно лёжа';else if(opts.aim&&t.hexTarget)reason='У пустого гекса нет локаций попадания';else if(opts.aim&&!Object.hasOwn(LOCATIONS,opts.aim))reason='Неизвестная прицельная локация';else if(opts.aim&&!this.isImmobile(t))reason='Прицельная стрельба только по обездвиженной цели';else if(opts.aim&&w.rack)reason='Кластерные ракеты нельзя использовать для прицельной стрельбы';else if(opts.aim&&los.cover&&partialCoverObscures(t,opts.aim,underwaterCover))reason='Локация скрыта частичным укрытием';
 const mods={gunnery:u.gunnery,attacker:{stand:0,walk:1,run:2,jump:3,evade:2}[u.moveMode]+(u.skidded?1:0),target:t.hexTarget?-4:this.targetMovementModifier(t,{includeImmobile:opts.aim!=='HD'}),terrain:los.woods,cover:opts.aim?0:los.cover?1:0,heat:[8,13,17,24].filter(h=>u.heat>=h).length,range:range<=ranges[0]?0:range<=ranges[1]?2:4,minimum:range<=w.min?w.min-range+1:0,weapon:w.toHit||0,sensor:u.sensorHits?2:0,arm:act&&(u.config==='Quad'||['LA','RA'].includes(w.location))?(act.shoulder?4:Number(act.upper&& (u.config==='Quad'||u.slots[w.location].includes('upper')))+Number(act.lower&&(u.config==='Quad'||u.slots[w.location].includes('lower')))):0,prone:u.prone&&!quadProneBonus?2:0,targetProne:t.prone?(range===1?-2:1):0,secondary:opts.secondary?(this.inForwardFireArc(u,t)?1:2):0,aim:opts.aim==='HD'?3:0,night:this.weather.night?Math.max(0,2-Math.floor(t.heat/20)):0,wind:this.weather.gale?(w.rack?2:w.ammo!==null?1:0):0};if(indirect){mods.indirect=1;mods.spotter=spotter?({stand:0,walk:1,run:2,jump:3,evade:2}[spotter.moveMode]??0)+(spotter.skidded?1:0)+(spotter.prone&&!quadProneFireBonus(spotter)?2:0):0;mods.spotterFires=Number(this.declarations.some(d=>d.id===opts.spotter&&d.shots.length));}if(this.spottingTargets().has(u.id))mods.spotting=1;const targetNumber=Object.values(mods).reduce((a,b)=>a+b,0);let chance=0;for(let a=1;a<=6;a++)for(let b=1;b<=6;b++)if(a+b>=targetNumber)chance++;return {legal:!reason,reason,range,blocked:los.blocked,cover:indirect?waterline:los.cover,underwaterCover,side:t.hexTarget?null:this.hitSide(t,u),sideOptions:t.hexTarget?[]:this.hitSideOptions(t,u),mods,targetNumber,chance:reason?0:Math.round(chance/36*100)};}
 setDirectionalTorsoMount(id,index,facing){
  const u=this.unit(id),mount=u?.directionalTorsoMounts?.[index];
  if(this.phase!=='fire'||!this.canAct(u)||u.prone||!mount||mount.locked||
     !Number.isInteger(facing)||facing<0||facing>5||
     (mount.points===2&&![0,3].includes(facing))||
     (mount.points===3&&u.config!=='Quad')||
     ![2,3].includes(mount.points))
   return fail('Направленная установка торса недоступна');
  mount.facing=facing;
  return {ok:true,mount:index,facing};
 }
 checkDirectionalTorsoMountHit(u,loc){
  for(const mount of u.directionalTorsoMounts||[]){
   if(mount.location!==loc||mount.locked)continue;
   if(this.roll(u.name+' · Повреждение турели',9)>=9){
    mount.locked=true;
    this.note(`${u.name}: турель ${loc} заблокирована в секторе ${mount.facing}.`);
   }
  }
 }
 twist(id,value){const u=this.unit(id);const limit=u?.config==='Quad'?(u.quirks?.extendedTorsoTwist===true?1:0):(u?.quirks?.extendedTorsoTwist===true?2:1);if(this.phase!=='fire'||!this.canAct(u)||!this.mobile(u)||u.prone||!Number.isInteger(value)||Math.abs(value)>limit||u.flip&&value!==0||(u.config==='Quad'&&limit===0))return fail('Разворот торса недоступен');u.twist=value;return {ok:true};}
 attack(id,target,indices,opts={}){return this.declareFire(id,indices.map(index=>({index,target,...opts})));}
 // AGoAC p.17: a designated primary must be a declared target and,
 // when any target is in the forward torso arc, one such target is primary.
 primaryTargetChoices(id,assignments){
  const u=this.unit(id);if(!u)return [];
  const targets=[...new Set(assignments.map(a=>a.target))].filter(tid=>{
   const t=this.fireTarget(tid);return t&&t.team!==u.team&&!t.dead&&t.deployed!==false;
  });
  const front=targets.filter(tid=>this.inForwardFireArc(u,this.fireTarget(tid)));
  return front.length?front:targets;
 }
 inForwardFireArc(u,t){
  // AGoAC p.17: a torso twist can leave a second forward sector for
  // forward-mounted leg weapons. Primary designation is per Mech.
  if(Math.abs(this.relative(u,t,wrap(u.facing+u.twist)))<=60.00001)return true;
  return !!u.twist&&u.weapons.some(w=>!w.rear&&!w.destroyed&&mechLegLocation(u,w.location))&&
   Math.abs(this.relative(u,t,u.facing))<=60.00001;
 }
 declareFire(id,assignments,primaryTarget=null){const u=this.unit(id);if(this.phase!=='fire'||this.pendingChoice||!this.canAct(u)||!Array.isArray(assignments))return fail('Сейчас очередь другого отряда');const choices=this.primaryTargetChoices(id,assignments);if(primaryTarget!==null&&!choices.includes(primaryTarget))return fail('Основная цель должна быть допустимой заявленной целью');const hexTargets=assignments.map(s=>s.target).filter(t=>typeof t==='string');if(hexTargets.some(t=>!this.fireTarget(t)))return fail('Недопустимый пустой гекс');if(assignments.some(s=>!s||!Number.isInteger(s.index)||!u.weapons[s.index]||!this.fireTarget(s.target)||this.fireTarget(s.target).team===u.team)||new Set(assignments.map(s=>s.index)).size!==assignments.length)return fail('Недопустимая декларация огня');const prepared=this.prepareAttackLos(id,assignments,[]);if(!prepared.ok)return prepared;const primary=primaryTarget??choices[0];const seen=new Set(),shots=[],reserved=new Map(),reservedBins=new Map();for(const a of assignments){if(seen.has(a.index))return fail('Оружие уже заявлено');seen.add(a.index);const w=u.weapons[a.index];if(!w)return fail('Оружие не найдено');if(w.ammo!==null){const pool=w.shared??a.index,n=(reserved.get(pool)||0)+1;if(n>w.ammo)return fail('Недостаточно общего боезапаса');reserved.set(pool,n);}if(a.bin!==undefined&&a.bin!==null){const b=u.bins[a.bin],n=(reservedBins.get(a.bin)||0)+1;if(w.ammo===null||!b||b.destroyed||u.dumping.includes(a.bin)||this.isBreached(u,b.location)||b.weapon!==(w.shared??a.index)||b.shots<n)return fail('Выбранный бункер недоступен');reservedBins.set(a.bin,n);}const t=this.fireTarget(a.target);if(!t)return fail('Нет цели');const p=this.preview(id,a.target,a.index,{secondary:primary!==a.target,aim:a.aim,spotter:a.spotter,heatMode:a.heatMode});if(!p.legal)return fail(`${u.weapons[a.index].name}: ${p.reason}`);if(a.aim&&!Object.hasOwn(LOCATIONS,a.aim))return fail('Неизвестная прицельная локация');if(a.aim&&!this.isImmobile(t))return fail('Прицельная стрельба только по обездвиженной цели');shots.push({index:a.index,target:a.target,weapon:clone(u.weapons[a.index]),preview:p,losChoice:this.selectedLosPath(u,t),spotterLosChoice:a.spotter==null?null:this.selectedLosPath(this.unit(a.spotter),t),aim:a.aim||null,bin:a.bin??null,heatMode:!!a.heatMode&&w.name==='Flamer',...(a.spotter==null?{}:{spotter:a.spotter})});}if(!this.commitDeclaredAmmo(u,shots,reservedBins))return fail('Недостаточно доступного боезапаса');this.declarations.push({id,shots,ammoSpent:true});this.note(`${u.name}: заявлено ${shots.length} выстрелов. Разрешение — после всех деклараций.`);this.finish(u);return {ok:true,declared:true,shots:[]};}
 wound(u,n){for(let i=0;i<n&&!u.dead;i++){u.pilotWounds=Math.min(6,u.pilotWounds+1);if(u.pilotWounds>=6){this.destroyMech(u);this.note(`${u.name}: пилот погиб.`);break;}u.consciousChecks++;if(!this.deferConsciousness)this.consciousness(u);}}
 consciousness(u){while(u.consciousChecks>0&&!u.dead){
 // AGoAC pp.6,44: defer the throws, not the wound-specific thresholds.
 const wound=u.pilotWounds-u.consciousChecks+1;u.consciousChecks--;
 const tn=conscious[wound];if(!u.unconscious&&this.roll(u.name+' · Сознание',tn)<tn){u.unconscious=true;this.note(`${u.name}: пилот без сознания.`);}}if(u.dead)u.consciousChecks=0;}
 psr(u,modifier,reason,immediate=false,fallLevels=0,shutdownCheck=false){if(u.dead||u.prone)return true;if(!immediate){u.psrs.push({modifier,reason});return true;}this.consciousness(u);const tn=u.piloting+this.psrMod(u,reason!=='Подъём')+modifier;if(u.unconscious||u.abandoned||['LA','RA','LL','RL'].every(l=>u.structure?.[l]===0)||u.gyroHits>=2||(u.shutdown&&!shutdownCheck)||this.roll(u.name+' · '+reason,tn)<tn){this.fall(u,fallLevels,tn);return false;}return true;}
 endPSR(){// AGoAC p.6: every phase-end Consciousness Roll precedes the phase's PSRs.
 for(const u of this.units)this.consciousness(u);
 for(const u of this.units){if(u.phaseDamage>=20)u.psrs.push({modifier:1,reason:'20+ урона'});if(!u.dead&&!u.prone){const tn=u.piloting+this.psrMod(u,true)+u.psrs.reduce((s,p)=>s+p.modifier,0);for(const p of u.psrs){if(this.isImmobile(u)||u.gyroHits>=2||p.reason==='Потеря ноги'||this.roll(u.name+' · '+p.reason,tn)<tn){this.fall(u,0,tn);break;}}}u.psrs=[];u.phaseDamage=0;}}
 // AGoAC p.43: water surface and water bottom are separate impacts.
 fallDamageGroups(u,levels,extraDamage=0,origin=null){
  const tile=this.tile(u.q,u.r),base=Math.ceil(u.tonnage/10);
  if(!tile.depth)return [base*(levels+1)+extraDamage];
  const surface=tile.height+tile.depth;
  const entersFromAbove=origin&&origin.height>=surface&&
   (!origin.depth||origin.height>surface);
  if(entersFromAbove){
   return [Math.floor(base*(origin.height-surface+1)/2),
    Math.floor(base*(tile.depth+1)/2),...(extraDamage?[Math.floor(extraDamage/2)]:[])];
  }
  return [Math.floor((base*(levels+1)+extraDamage)/2)];
 }
 // AGoAC pp.27–28: a fall in the Weapon Attack Phase interrupts
 // an airborne DFA. Resolve the unsuccessful landing now, not a
 // normal fall in the temporary adjacent hex and another DFA later.
 interruptAirborneDFA(u,tn){
  const order=u.charge;
  if(this.phase!=='fire'||!u.airborne||order?.type!=='dfa'||order.resolved)return false;
  const target=this.unit(order.target);
  if(!target)return false;
  order.resolved=true;
  u.airborne=false;
  this.note(u.name+': DFA автоматически не удалась в фазе стрельбы.');
  this.resolveDFALanding(u,target,order.dir,false,{q:target.q,r:target.r},tn);
  return true;
 }
 fall(u,levels=0,tn=null,forcedSide=null,extraDamage=0,origin=null){if(u.dead||u.falling)return;if(this.interruptAirborneDFA(u,tn))return;u.falling=true;u.prone=true;const d=this.d6(u.name+' · Направление падения'),side=forcedSide||(d===1?'front':d===4?'rear':d<=3?'right':'left');u.facing=wrap(u.facing-(d-1));u.lastFallSide=side;const seat=(tn??u.piloting+this.psrMod(u))+Math.max(0,levels-1);if(this.isImmobile(u)||seat>12||this.roll(u.name+' · Травма при падении',seat)<seat)this.wound(u,1);this.consciousness(u);const impacts=this.fallDamageGroups(u,levels,extraDamage,origin);this.note(`${u.name} упал: ${impacts.reduce((sum,n)=>sum+n,0)} урона.`);for(const damage of impacts)if(damage&&!u.dead)this.packets(u,damage,side);u.falling=false;}
 packets(u,amount,side='front',table='normal'){let total=amount;while(total>0&&!u.dead){const n=Math.min(5,total);this.hit(u,n,side,table);total-=n;}}
 hit(u,amount,side='front',table='normal',aim=null,cover=false,underwaterCover=false){
 let loc,r,floatingTac=false;const obscured=l=>cover&&partialCoverObscures(u,l,underwaterCover);
 if(table==='punch'){
  r=this.d6('Локация · удар рукой');
  loc=(u.config==='Quad'?QUAD_PUNCH_LOCATIONS:punch)[side][r-1];
 }
 else if(table==='kick'){
  r=this.d6('Локация · удар ногой');
  loc=u.config==='Quad'?QUAD_KICK_LOCATIONS[side][r-1]:
    side==='left'?'LL':side==='right'?'RL':r<=3?'RL':'LL';
 }
 else{
  // AGoAC p.21: aimed-location check is independent of the normal
  // hit-location roll. A failed aim never doubles as a TAC or location.
  if(aim&&!obscured(aim)){
   const check=this.roll('Прицельная атака · проверка локации');
   if(check>=6&&check<=8){
    this.phaseRolls.at(-1).result=locationNameForMech(u,aim)+' · '+amount+' урона';
    return {location:aim,hits:amount>0?this.damage(u,aim,amount,{rear:side==='rear'}):[],damage:amount};
   }
   this.phaseRolls.at(-1).result='Обычный бросок локации';
  }
  for(let attempts=0;attempts<100;attempts++){
   r=this.roll(attempts?'Локация попадания · повтор из-за укрытия':'Локация попадания');
   const locations=side==='left'?left:side==='right'?right:front;
   loc=locations[r-2];
   if(r===2&&this.tacticalOptions?.floatingCriticals){
    // BMM p.45: the initial 2 is a through-armor critical opportunity.
    // A second 2 is an ordinary torso hit; it never creates another TAC.
    let rerolls=0,locationRoll;
    do{
     locationRoll=this.roll('Плавающий критический · локация');
     loc=locations[locationRoll-2];rerolls++;
    }while(obscured(loc)&&rerolls<100);
    floatingTac=locationRoll!==2;
   }
   if(!aim||!obscured(loc))break;
  }
 }
 this.phaseRolls.at(-1).result=locationNameForMech(u,loc)+(obscured(loc)?' · укрытие':` · ${amount} урона`);
 if(obscured(loc))return {location:loc,hits:[],damage:0};
 return {location:loc,hits:amount>0?this.damage(u,loc,amount,{rear:side==='rear',tac:table==='normal'&&(r===2&&!this.tacticalOptions?.floatingCriticals||floatingTac)}):[],damage:amount};
}
 damage(u,loc,amount,{rear=false,internal=false,tac=false,explosion=false}={}){let rem=amount,hits=[],guard=0;const initial=loc;while(rem>0&&!u.dead&&loc&&guard++<8){if(!u.structure[loc]&&transfer[loc]){if(explosion&&(this.hasCASE(u,loc)||this.hasCASEII(u,loc)))break;loc=transfer[loc];continue;}
 if(explosion&&this.hasCASEII(u,loc)){
  // BMM 2022 p.119: only one point damages structure; remainder vents.
  const d=Math.min(1,u.structure[loc]);u.structure[loc]-=d;rem-=d;
  let a=0;
  if(loc==='HD'||['LA','RA','LL','RL'].includes(loc)){
   a=Math.min(u.armor[loc],Math.ceil((u.maxArmor[loc]||0)/2));u.armor[loc]-=a;
  }else if(u.rear[loc]!==undefined){a=Math.min(u.rear[loc],rem);u.rear[loc]-=a;}
  u.phaseDamage+=d+a;hits.push({location:loc,armor:a,structure:d});if(a+d)this.checkDirectionalTorsoMountHit(u,loc);
  if(loc==='HD'&&d)this.wound(u,1);
  if(d)this.criticalHit(u,loc,false,true);
  if(!u.structure[loc])this.destroyLocation(u,loc);
  break;
 }
 const ar=rear&&u.rear[loc]!==undefined?u.rear:u.armor;const a=internal?0:Math.min(ar[loc],rem);ar[loc]-=a;rem-=a;const d=Math.min(u.structure[loc],rem);u.structure[loc]-=d;rem-=d;u.phaseDamage+=a+d;hits.push({location:loc,armor:a,structure:d});if(a+d)this.checkDirectionalTorsoMountHit(u,loc);if(loc==='HD'&&a+d)this.wound(u,1);if(d)this.criticalHit(u,loc,!u.structure[loc]);if(a+d)this.checkHullIntegrity(u,loc);if(!u.structure[loc]){this.destroyLocation(u,loc);if(explosion&&this.hasCASE(u,loc))break;loc=transfer[loc];}else break;}if(tac&&!u.dead)this.criticalHit(u,u.structure[initial]?initial:transfer[initial]||initial,false);return hits;}
 destroyLocation(u,loc){
  if(!u.slots[loc])return;
  // A location can be destroyed recursively by side-torso loss and
  // encountered again by damage transfer. Handle each loss exactly once.
  u.destroyedSections??=[];
  if(u.destroyedSections.includes(loc))return;
  u.destroyedSections.push(loc);
  u.structure[loc]=0;u.armor[loc]=0;for(const b of u.bins)if(b.location===loc){b.destroyed=true;b.shots=0;}this.syncAmmo(u);if(u.rear[loc]!==undefined)u.rear[loc]=0;u.slots[loc].forEach((s,i)=>{if(u.crit[loc][i])return;u.crit[loc][i]=true;if(s==='sink')u.sinksLost++;if(s==='jump')u.jumpLost++;if(s==='engine')u.engineHits++;});
  // AGoAC pp.32,34–35: destroying a section destroys its engine slots too.
  if(this.effectiveEngineHits(u)>=3)this.destroyMech(u);
  u.weapons.filter(w=>w.location===loc||w.locations?.includes(loc)).forEach(w=>w.destroyed=true);if(loc==='HD'||loc==='CT'){this.destroyMech(u);if(loc==='HD')u.pilotWounds=6;this.note(`${u.name}: ${locationNameForMech(u,loc)} уничтожен.`);}if(loc==='LT'||loc==='RT'){const arm=loc==='LT'?'LA':'RA';if(u.structure[arm]>0)this.leaveLimbClub(u);this.destroyLocation(u,arm);}
 if(u.config==='Quad'&&mechLegLocation(u,loc)){
  // BMM p.45: a standing Quad falls immediately upon *any* leg loss,
  // not later at the end-of-phase PSR. The moving unit may not proceed
  // down an already-calculated path or stand again this turn.
  u.moveEndedByLegLoss=true;
  if(!u.prone&&!u.falling&&!u.dead)this.fall(u);
 }else if(['LL','RL'].includes(loc))u.psrs.push({modifier:0,reason:'Потеря ноги'});
}
 // CASE has an inapplicable critical slot and vents explosion overflow.
 hasCASE(u,loc){return !!u.slots?.[loc]?.includes('case')||u.techBase==='Clan'&&Object.hasOwn(u.slots||{},loc);}
 hasCASEII(u,loc){return !!u.slots?.[loc]?.includes('case2');}
 syncAmmo(u){u.weapons.forEach((w,i)=>{if(w.ammo!==null)w.ammo=u.bins.reduce((n,b,ix)=>n+(b.weapon===(w.shared??i)&&!b.destroyed&&!u.dumping.includes(ix)&&!this.isBreached(u,b.location)?b.shots:0),0);});}
 // External heat sources are cumulative to 15 heat points each turn (BMM p.50).
 applyExternalHeat(u,amount){const n=Number.isFinite(amount)?Math.max(0,Math.trunc(amount)):0,added=Math.min(n,Math.max(0,15-(u.externalHeat??0)));u.externalHeat=(u.externalHeat??0)+added;u.pendingHeat+=added;return added;}
 explode(u,bin){if(!bin||bin.destroyed||!bin.shots)return;const w=u.weapons[bin.weapon],amount=bin.shots*w.damage*(w.rack||1);bin.shots=0;bin.destroyed=true;this.syncAmmo(u);this.wound(u,2);this.note(`${u.name}: взрыв боезапаса, ${amount} внутреннего урона.`);this.damage(u,bin.location,amount,{internal:true,explosion:true});if(u.structure.CT===0){u.pilotWounds=6;this.destroyMech(u);}}
 criticalHit(u,loc,destroyed=false,caseIIVenting=false){if(u.dead)return;const phaseKey=`${this.round}:${this.phase}`;if(u.criticalPhaseKey!==phaseKey){u.criticalPhaseKey=phaseKey;u.critMarkedThisPhase=[];}const newlyHit=u.critMarkedThisPhase;const r=this.roll(u.name+' · Критические повреждения'),n=r<=7?0:r<=9?1:r<=11?2:3;this.phaseRolls.at(-1).result=`Критических попаданий: ${n}`;if(!n)return;if(r===12&&['HD','LA','RA','LL','RL'].includes(loc)){if(caseIIVenting&&this.roll(u.name+' · CASE II критический шанс',8)>=8)return;if(['LA','RA','LL','RL'].includes(loc)&&!u.destroyedSections?.includes(loc))this.leaveLimbClub(u);this.destroyLocation(u,loc);return;}const eligible=l=>u.slots[l].map((s,i)=>s&&s!=='case'&&s!=='case2'&&!u.crit[l][i]?i:-1).filter(i=>i>=0);let valid=eligible(loc);if(!valid.length){if(destroyed||newlyHit.includes(loc))return;while(!valid.length&&transfer[loc]&&!newlyHit.includes(loc)){loc=transfer[loc];valid=eligible(loc);}if(!valid.length)return;}for(let k=0;k<n&&!u.dead;k++){if(caseIIVenting&&this.roll(u.name+' · CASE II критический шанс',8)>=8)continue;valid=eligible(loc);if(!valid.length)break;let ix=-1,tries=0;while(!valid.includes(ix)&&tries++<60){const first=valid.some(i=>i<6),second=valid.some(i=>i>=6),block=first&&second?(this.d6('Критический слот: блок')>=4?1:0):second?1:0;ix=block*6+this.d6('Критический слот: позиция')-1;}if(!valid.includes(ix))ix=valid[0];u.crit[loc][ix]=true;newlyHit.push(loc);const s=u.slots[loc][ix];this.note(`${u.name}: ${loc}, слот ${ix+1} — ${s}.`);if(s.startsWith('ammo:'))this.explode(u,u.bins.find(b=>b.location===loc&&b.slot===ix));else if(destroyed){
  // Already marked slots will be skipped by destroyLocation. Count these
  // losses now but let the destruction finish its ammunition-critical checks.
  if(s==='engine')u.engineHits++;else if(s==='sink')u.sinksLost++;else if(s==='jump')u.jumpLost++;
  continue;
 }else if(s==='engine'){u.engineHits++;if(this.effectiveEngineHits(u)>=3)this.destroyMech(u);}else if(s==='gyro'){if(u.gyroHits<2){u.gyroHits++;u.psrs.push({modifier:0,reason:'Гироскоп'});}}else if(s==='sensors')u.sensorHits++;else if(s==='life')u.lifeSupport=true;else if(s==='cockpit'){u.pilotWounds=6;this.destroyMech(u);}else if(s==='sink')u.sinksLost++;else if(s==='jump')u.jumpLost++;else if(s.startsWith('w:'))u.weapons[+s.split(':')[1]].destroyed=true;else if(u.actuators[loc]){u.actuators[loc][s]=true;
 if(mechLegLocation(u,loc)){
  // Keep acquisition turns through saves and phase changes. Older
  // snapshots without dates use the prior same-leg suppression.
  if(u.config!=='Quad'&&['hip','upper','lower','foot'].includes(s)){
   u.actuatorHitRounds??={};
   u.actuatorHitRounds[loc]??={};
   u.actuatorHitRounds[loc][s]=this.round;
  }
  u.psrs.push({modifier:0,reason:'Актуатор '+loc});
 }}}}
 // AGoAC p.22: allocate exact magazines and mark off ammunition as
 // part of the accepted attack declaration, never a partial rejection.
 commitDeclaredAmmo(u,shots,explicitReservations){
  const counts=new Map(explicitReservations);
  for(const s of shots){
   if(s.weapon.ammo===null||s.bin!==null)continue;
   const pool=s.weapon.shared??s.index;
   const ix=u.bins.findIndex((b,i)=>b.weapon===pool&&!b.destroyed&&
    !u.dumping.includes(i)&&!this.isBreached(u,b.location)&&
    b.shots>(counts.get(i)||0));
   if(ix<0)return false;
   s.bin=ix;counts.set(ix,(counts.get(ix)||0)+1);
  }
  for(const [ix,n] of counts)u.bins[ix].shots-=n;
  if(counts.size)this.syncAmmo(u);
  return true;
 }
 // Compatibility for saved declarations created before p.22 ammo timing
 // was implemented, and resolution fixtures without the marker.
 spendDeclaredAmmo(u,s,reserved){
  const w=s.weapon;if(w.ammo===null)return;
  const bin=s.bin!==null?u.bins[s.bin]:u.bins.find((b,ix)=>
   b.weapon===(w.shared??s.index)&&!b.destroyed&&!u.dumping.includes(ix)&&
   !this.isBreached(u,b.location)&&b.shots>(reserved.get(ix)||0));
  if(s.bin!==null)reserved.set(s.bin,Math.max(0,(reserved.get(s.bin)||0)-1));
  if(bin&&bin.shots>0)bin.shots--;
  this.syncAmmo(u);
 }
 // AGoAC pp.6,21,30: each attacker chooses two independent orders.
 // Targets remain grouped; a missile attack is resolved in its entirety.
 orderFireStage(u,items,stage,visit){
  const shot=a=>stage==='roll'?a:a.s;
  const groups=new Map();
  for(const a of items){
   const target=shot(a).target;
   if(!groups.has(target))groups.set(target,[]);
   groups.get(target).push(a);
  }
  const eligible=a=>stage==='roll'||a.hit;
  while(groups.size){
   const first=groups.keys().next().value;
   const targets=[...groups].filter(([,attacks])=>attacks.some(eligible));
   const options=targets.map(([targetId,attacks])=>({id:String(targetId),targetId,
    weaponNames:attacks.filter(eligible).map(a=>shot(a).weapon.name)}));
   // A group of misses requires no damage decision and consumes no dice.
   const chosen=groups.get(first).some(eligible)?
    this.chooseResolutionOption('fire-'+stage+'-target',u,options,String(first)):String(first);
   const target=[...groups.keys()].find(id=>String(id)===chosen)??first;
   const pending=groups.get(target);
   groups.delete(target);
   while(pending.length){
    if(!eligible(pending[0])){visit(pending.shift());continue;}
    const weapons=pending.filter(eligible).map(a=>{
     const s=shot(a);
     return {id:String(s.index),weaponIndex:s.index,weaponName:s.weapon.name,targetId:s.target,
      ...(stage==='damage'?{roll:a.roll,targetNumber:s.preview.targetNumber}:{})};
    });
    const pick=this.chooseResolutionOption('fire-'+stage+'-weapon',u,weapons,String(shot(pending[0]).index));
    const index=pending.findIndex(a=>String(shot(a).index)===pick);
    visit(pending.splice(index,1)[0]);
   }
  }
 }
 refundImpossibleShot(d,s){
  const u=this.unit(d.id),w=s.weapon;
  if(d.ammoSpent&&w.ammo!==null&&s.bin!==null&&u.bins[s.bin]){
   u.bins[s.bin].shots++;this.syncAmmo(u);
  }
  this.note(u.name+' · '+w.name+': невозможный выстрел отменён.');
 }
 rollDeclaredFire(d,{cancelled=null}={}){
  const u=this.unit(d.id),reserved=new Map(),attacks=[];
  const shots=cancelled?d.shots.filter(s=>!cancelled.has(s)):d.shots;
  if(!d.ammoSpent)for(const s of shots)if(s.bin!==null&&s.weapon.ammo!==null)
   reserved.set(s.bin,(reserved.get(s.bin)||0)+1);
  this.orderFireStage(u,shots,'roll',s=>{
   const w=s.weapon,p=s.preview;
   if(!cancelled&&p.targetNumber>12){
    const decision=this.chooseResolutionOption('fire-impossible',u,[{id:'fire'},{id:'cancel'}],'fire',
     {weaponName:w.name,targetId:s.target,targetNumber:p.targetNumber});
    if(decision==='cancel'){
     // No attack, heat, or retarget. Return the exact reserved round
     // already marked off at declaration, if this is a modern save.
     this.refundImpossibleShot(d,s);
     if(!d.ammoSpent&&s.bin!==null&&w.ammo!==null)
      reserved.set(s.bin,Math.max(0,(reserved.get(s.bin)||0)-1));
     return;
    }
   }
   const roll=this.roll(u.name+' · '+w.name,p.targetNumber);
   const attackRoll=this.phaseRolls.at(-1);
   u.pendingHeat+=w.heat;
   u.firedLocations.push(...(w.locations?.length?w.locations:[w.location]));
   if(!d.ammoSpent)this.spendDeclaredAmmo(u,s,reserved);
   attacks.push({u,s,roll,attackRoll,hit:roll>=p.targetNumber});
  });
  return attacks;
 }
 fireAmounts(s,hit){
  if(!hit||s.heatMode)return [];
  const w=s.weapon;if(!w.rack)return [w.damage];
  const n=clusters[w.rack][this.roll('Ракетный кластер')-2];
  this.phaseRolls.at(-1).result='Попало '+n+' ракет';
  return w.name.startsWith('SRM')?Array(n).fill(2):
   Array.from({length:Math.ceil(n/5)},(_,i)=>Math.min(5,n-5*i));
 }
 resolveRolledFire({u,s,roll,attackRoll,hit}){
  const w=s.weapon,p=s.preview,start=this.phaseRolls.length;
  if(typeof s.target==='string'&&s.target.startsWith('hex:')){
   this.resolution.push({id:u.id,target:s.target,ok:true,shots:[{weapon:w.name,index:s.index,hit,roll,targetNumber:p.targetNumber,damage:0,location:null,hits:[],rolls:[attackRoll]}]});
   this.note(u.name+' → '+s.target+' '+w.name+': '+roll+'/'+p.targetNumber+'+');return;
  }
  const t=this.unit(s.target);
  if(hit&&s.heatMode)this.applyExternalHeat(t,2);
  let damage=0,location=null;const hits=[];
  const side=hit&&!s.heatMode&&!t.dead?this.weaponHitSide(t,u,s):p.side;
  for(const amount of this.fireAmounts(s,hit)){
   if(t.dead)break;
   const out=this.hit(t,amount,side,'normal',s.aim,p.cover,p.underwaterCover);
   damage+=out.damage;location=out.location;hits.push(...out.hits);
   if(side==='rear'&&['LT','CT','RT'].includes(location)&&t.dumping.length)
    for(const index of [...t.dumping])this.explode(t,t.bins[index]);
  }
  this.resolution.push({id:u.id,target:t.id,ok:true,shots:[{
   weapon:w.name,index:s.index,hit,roll,targetNumber:p.targetNumber,damage,location,hits,
   rolls:[attackRoll,...this.phaseRolls.slice(start)]}]});
  this.note(u.name+' → '+t.name+' '+w.name+': '+roll+'/'+p.targetNumber+'+ — '+damage+' урона.');
 }
 // AGoAC p.6: resolution starts with the initiative loser again,
 // one Mech at a time. A no-fire selection counts during declarations
 // but does not consume an attack-resolution turn. Unequal force batches
 // on p.7 apply to declarations, not the subsequent resolution stage.
 orderFireMechs(declarations,stage,visit){
  const eligible=declarations.filter(d=>stage==='roll'?d.shots.length:d.attacks.length);
  const teamOf=d=>this.unit(d.id).team;
  const remaining=[eligible.filter(d=>teamOf(d)===0),eligible.filter(d=>teamOf(d)===1)];
  let slots=eligible.map(teamOf);
  if(this.initiativeWinner===0||this.initiativeWinner===1){
   const counts=remaining.map(list=>list.length),order=[1-this.initiativeWinner,this.initiativeWinner];
   slots=[];
   while(counts.some(Boolean))for(const team of order)if(counts[team]>0){slots.push(team);counts[team]--;}
  }
  for(const team of slots){
   const list=remaining[team],fallback=list[0];
   const options=list.map(d=>({id:String(d.id),attackerId:d.id,
    weaponNames:stage==='roll'?d.shots.map(s=>s.weapon.name):
     d.attacks.filter(a=>a.hit).map(a=>a.s.weapon.name)}));
   const pick=this.chooseResolutionOption('fire-'+stage+'-mech',this.unit(fallback.id),options,String(fallback.id));
   const index=list.findIndex(d=>String(d.id)===pick);
   visit(list.splice(index,1)[0]);
  }
 }
 finalizeSpottingModifiers(cancelled=new Set()){
  const spotting=this.spottingTargets();
  if(!spotting.size)return;
  const firing=new Set(this.declarations.filter(d=>d.shots.some(s=>!cancelled.has(s))).map(d=>d.id));
  for(const d of this.declarations)for(const s of d.shots){
   const p=s.preview,m=p.mods;
   if(!m)continue;
   const nextSpotting=Number(spotting.has(d.id)),nextFires=Number(s.spotter!=null&&firing.has(s.spotter));
   p.targetNumber+=nextSpotting-(m.spotting??0)+nextFires-(m.spotterFires??0);
   if(nextSpotting||Object.hasOwn(m,'spotting'))m.spotting=nextSpotting;
   if(s.spotter!=null)m.spotterFires=nextFires;
  }
 }
 // AGoAC pp.15,21: a cancelled shot is not an attack. Resolve
 // cancellation decisions before dice when spotting makes one Mech's
 // TN depend on another. Spotting commitments are retained even if
 // an attacker cancels; only actual remaining attacks incur +1.
 // Take decisions in declaration order; after each cancellation,
 // recalculate the remaining attacks. No target can be changed.
 prepareSpottingCancellations(){
  if(!this.spottingTargets().size)return null;
  const cancelled=new Set();
  this.finalizeSpottingModifiers(cancelled);
  // Decide spotters' own shots first: their fire affects other TNs.
  const spotting=this.spottingTargets();
  const ordered=[...this.declarations].sort((a,b)=>Number(spotting.has(b.id))-Number(spotting.has(a.id)));
  for(const d of ordered)for(const s of d.shots){
   if(s.preview.targetNumber<=12)continue;
   const u=this.unit(d.id);
   const decision=this.chooseResolutionOption('fire-impossible',u,[{id:'fire'},{id:'cancel'}],'fire',
    {weaponName:s.weapon.name,targetId:s.target,targetNumber:s.preview.targetNumber});
   if(decision==='cancel'){
    cancelled.add(s);this.refundImpossibleShot(d,s);
    this.finalizeSpottingModifiers(cancelled);
   }
  }
  return cancelled;
 }
 resolveFire(){
  this.phaseRolls=[];this.resolution=[];this.deferConsciousness=true;
  try{
   const cancelled=this.prepareSpottingCancellations(),staged=new Map();
   this.orderFireMechs(this.declarations,'roll',d=>{
    staged.set(d.id,{id:d.id,attacks:this.rollDeclaredFire(d,{cancelled})});
   });
   // Damage order is independent and restarts with the initiative loser.
   this.orderFireMechs(this.declarations.filter(d=>staged.has(d.id)).map(d=>staged.get(d.id)),'damage',d=>{
    this.orderFireStage(this.unit(d.id),d.attacks,'damage',attack=>this.resolveRolledFire(attack));
   });
  }finally{this.deferConsciousness=false;}
  const start=this.phaseRolls.length;this.endPSR();
  this.afterRolls=this.phaseRolls.slice(start);this.declarations=[];
  this.removeDestroyedMechs();return this.resolution;
 }
 // AGoAC pp.26,27,29: a target may be selected for only one
 // charge, death from above, or push per turn.
 displacementTargetReserved(target){
  return this.units.some(u=>u.charge?.target===target)||
   this.physicalDeclarations.some(d=>d.type==='push'&&d.target===target);
 }
 physicalPreview(id,target,type='kick',limb='RL',opts={}){const u=this.unit(id),t=this.unit(target);if(!u||!t)return {legal:false,reason:'Выберите цель',targetNumber:99};
 if(u.deployed===false||t.deployed===false)return {legal:false,reason:'Мех ещё не вышел на поле',targetNumber:99};
 if(t.charge?.type==='dfa'||t.airborne)return {legal:false,reason:'Мех, выполняющий DFA, нельзя атаковать физически',targetNumber:99};
 if(type==='push'&&(t.charge||this.displacementTargetReserved(target)))return {legal:false,reason:'Цель выполняет или уже выбрана для вытесняющей атаки',targetNumber:99};
 // Quad front limbs are legs, not arms. Punches, pushes, clubs and
 // hand-held physical weapon attacks require actual biped arms.
 if(u.config==='Quad'&&['punch','push','club','hatchet'].includes(type))
  return {legal:false,reason:'У четырёхногого меха нет рук для этой атаки',targetNumber:99};
 if(type==='punch'&&limb==='both'){const a=this.physicalPreview(id,target,type,'LA'),b=this.physicalPreview(id,opts.rightTarget??target,type,'RA');return {...a,legal:a.legal&&b.legal,reason:a.reason||b.reason,damage:a.damage+b.damage,targetNumber:Math.max(a.targetNumber,b.targetNumber)};}const attackerTile=this.tile(u.q,u.r),targetTile=this.tile(t.q,t.r),attackerSub=attackerTile.depth>=(u.prone?1:2),targetSub=targetTile.depth>=(t.prone?1:2),attackerWaterline=attackerTile.depth===1&&!u.prone,targetWaterline=targetTile.depth===1&&!t.prone,range=distance(u,t),dh=targetTile.height-attackerTile.height,side=this.hitSide(t,u),a=this.relative(u,t),act=u.actuators[limb]||{};let reason='',mod=0,damage=0,table='normal';if(!this.mobile(u)||u.prone||u.team===t.team||t.dead||u.charge||t.airborne||u.moveMode==='evade')reason='Атака недоступна';else if(range!==1&&!(range===0&&t.prone))reason='Нужна соседняя цель';else if(Math.abs(dh)>1)reason='Разница высот слишком велика';else if(attackerSub&&!targetSub&&!targetWaterline||targetSub&&!attackerSub&&!attackerWaterline)reason='Атака через поверхность воды запрещена';else if(attackerWaterline&&targetSub&&type!=='kick')reason='По погружённой цели с глубины 1 допустим только удар ногой';let arm=limb==='LA'||limb==='RA';if(type==='punch'){const pa=physicalArmActuators(u,limb);mod=Number(pa.upper)*2+Number(pa.lower)*2+Number(pa.hand);damage=Math.max(1,Math.floor(Math.ceil(u.tonnage/10)/2**(Number(pa.upper)+Number(pa.lower))));table='punch';if(!arm||!u.structure[limb]||pa.shoulder||u.slots[limb].some((s,i)=>s==='hatchet'&&!u.crit[limb][i])||u.firedLocations.includes(limb)||dh<0||t.prone&&dh<=0||Math.abs(a)>120||limb==='LA'&&a< -60||limb==='RA'&&a>60)reason='Рука/цель недоступна для удара';if(dh===1)table=t.prone?'normal':'kick';}else if(type==='kick'){
 // AGoAC pp.28,32–34: biped kick penalties apply across both legs.
 // Quad behavior is intentionally unchanged here.
 const kickActuators=u.config==='Quad'?[act]:['LL','RL'].map(l=>u.actuators[l]);
 const damagedLegParts=kickActuators.reduce((n,a)=>n+Number(a.upper)+Number(a.lower),0);
 const damagedFeet=kickActuators.reduce((n,a)=>n+Number(a.foot),0);
 mod=-2+2*damagedLegParts+damagedFeet;
 damage=Math.floor(u.tonnage/5/2**damagedLegParts);
 if(u.config==='Quad')damage=Math.max(1,damage);
 table=t.prone?'normal':'kick';
 if(u.config==='Quad'){
  const front=['LA','RA'].includes(limb),rear=['LL','RL'].includes(limb);
  const pair=front?['LA','RA']:rear?['LL','RL']:[];
  const available=pair.length===2&&pair.every(l=>
   u.structure[l]>0&&!u.actuators[l]?.hip&&!this.isBreached(u,l));
  const inArc=front?Math.abs(a)<=60.00001:rear?Math.abs(a)>=120-.00001:false;
  if(rear)mod+=1; // BMM p.38: additional +1 for quad backward kick.
  if(!available||!inArc||u.firedLocations.includes(limb)||dh===1||(dh===-1&&t.prone))
   reason='Нога/цель недоступна для удара';
 }else if(!['LL','RL'].includes(limb)||!u.structure.LL||!u.structure.RL||u.actuators.LL.hip||
  u.actuators.RL.hip||u.firedLocations.includes(limb)||Math.abs(a)>60||dh===1)
  reason='Нога/цель недоступна для удара';
 if(dh===-1&&!t.prone)table='punch';
}else if(type==='hatchet'){damage=Math.ceil(u.tonnage/5);mod=-1+2*Number(act.upper)+2*Number(act.lower)+Number(act.hand);if(!arm||!u.hatchets?.some(h=>h.location===limb)||u.slots[limb].some((s,i)=>s==='hatchet'&&u.crit[limb][i])||!u.structure[limb]||act.shoulder||act.lower||u.firedLocations.includes(limb)||Math.abs(a)>120.00001||limb==='LA'&&a< -60.00001||limb==='RA'&&a>60.00001)reason='Топор или рука недоступны';damage=Math.max(1,Math.floor(damage/2**Number(act.upper)));}else if(type==='push'){mod=-1+2*Number(u.actuators.LA.shoulder)+2*Number(u.actuators.RA.shoulder);if(!u.structure.LA||!u.structure.RA||u.firedLocations.some(l=>['LA','RA'].includes(l))||Math.abs(a)>30||dh||t.prone)reason='Толчок требует двух рук и цель прямо перед мехом';}else if(type==='club'){mod=-1+2*['LA','RA'].reduce((n,l)=>n+Number(u.actuators[l].upper)+Number(u.actuators[l].lower),0);damage=Math.ceil(u.tonnage/5);if(!u.club||!clubArmsAvailable(u)||u.firedLocations.some(l=>['LA','RA'].includes(l))||Math.abs(a)>60)reason='Нужна дубина и две свободные исправные руки';}else return {legal:false,reason:'Неизвестная атака',targetNumber:99};// AGoAC p.25: the different-level table takes precedence over the default attack table.
 if(t.prone&&dh===-1)reason='Лежащая цель ниже атакующего недоступна';
 if(['club','hatchet'].includes(type))table=t.prone?'normal':dh===1?'kick':dh===-1?'punch':'normal';
 if(type==='hatchet'&&opts.locationTable!==undefined){
  if(!['normal','punch','kick'].includes(opts.locationTable))reason='Недопустимая таблица попадания';
  else if(table==='normal'&&opts.locationTable!=='normal'){table=opts.locationTable;mod+=4;}
 }

 const affectedLimbs=['club','push'].includes(type)?['LA','RA']:['punch','kick','hatchet'].includes(type)?[limb]:[];if(affectedLimbs.some(l=>this.isBreached(u,l)))reason='Затопленная конечность не может атаковать';const underwaterPhysical=attackerSub&&(targetSub||targetWaterline&&table==='kick')||(attackerWaterline&&type==='kick'&&(targetSub||targetWaterline));if(underwaterPhysical)damage=Math.floor(damage/2);// BMM pp.26,28,35: standing Quad in Depth 1 always has physical partial cover.
 // At equal LOS height only non-Kick-table leg hits are absorbed.
 // Charges resolve separately and are explicitly exempt from leg protection.
 const quadWaterCover=t.config==='Quad'&&targetWaterline;
 // AGoAC p.25: surface ordinary non-kick attacks at a standing depth-one biped
 // incur water cover; each actual covered leg hit is ignored. Preserve the separate Quad rule.
 const bipedWaterCover=t.config!=='Quad'&&targetWaterline&&!attackerSub&&type!=='kick';
 const physicalCover=bipedWaterCover||quadWaterCover&&attackerTile.height+(u.prone?1:2)===targetTile.height+(t.prone?1:2)&&table!=='kick';
 const targetNumber=u.piloting+mod+({stand:0,walk:1,run:2,jump:3,evade:2}[u.moveMode])+(u.skidded?1:0)+this.targetMovementModifier(t)+this.los(u,t).woods+(t.prone?-2:0)+(quadWaterCover||bipedWaterCover?1:0);
 return {legal:!reason,reason,targetNumber,damage,underwaterPhysical,table,side,physicalCover};}
 declarePhysical(id,target,type,limb,opts={}){
 const u=this.unit(id);if(this.phase!=='physical'||!this.canAct(u))return fail('Сейчас очередь другого отряда');
 if(opts.rightTarget!==undefined&&!(type==='punch'&&limb==='both')||opts.locationTable!==undefined&&type!=='hatchet')return fail('Недопустимые параметры атаки');
 const limbs=type==='punch'&&limb==='both'?['LA','RA']:[limb],pending=[];
 for(const l of limbs){
  const defender=limb==='both'&&l==='RA'?opts.rightTarget??target:target;
  const p=this.physicalPreview(id,defender,type,l,opts);
  if(!p.legal)return fail(p.reason);
  pending.push({id,target:defender,type,limb:l,...p,...(opts.locationTable===undefined?{}:{locationTable:opts.locationTable})});
 }
 this.physicalDeclarations.push(...pending);this.finish(u);return {ok:true,declared:true};
 }
 takeClub(id){
 const u=this.unit(id);if(!u)return fail('Мех не найден');const t=this.tile(u.q,u.r);
 if(!t||u.config==='Quad'||this.phase!=='physical'||!this.canAct(u)||!this.mobile(u)||u.prone||u.club||u.charge||(!['woods','heavy'].includes(t.type)&&!t.club)||!clubArmsAvailable(u)||u.firedLocations.length)return fail('Нужны две исправные кисти и плеча, отсутствие стрельбы и дубина в гексе');
 u.club=true;u.clubKind=t.club?'limb':'tree';
 if(t.club){t.clubCount=Math.max(0,(t.clubCount??1)-1);t.club=t.clubCount>0;}
 this.finish(u);return {ok:true};
 }
 leaveLimbClub(u){
 const t=this.tile(u.q,u.r);if(!t)return;
 t.clubCount=(t.clubCount??Number(!!t.club))+1;t.club=true;
 }
 // AGoAC pp.40–42: the domino check occurs before moving the target.
 // The target falls in its destination, not in the hex it is vacating.
 dominoCheck(u){
  this.consciousness(u);
  const tn=u.piloting+this.psrMod(u,true)+u.psrs.reduce((sum,p)=>sum+p.modifier,0)+(u.phaseDamage>=20?1:0);
  if(u.dead||u.prone)return {tn,failed:false};
  const failed=this.isImmobile(u)||u.gyroHits>=2||
   this.roll(u.name+' · Домино',tn)<tn;
  return {tn,failed};
 }
 // AGoAC p.42: a successful side-entry domino PSR permits a
 // voluntary one-hex dodge using the movement points left this turn.
 dominoDodgeOptions(u,dir){
  if(u.dead||u.prone||this.isImmobile(u)||u.moveMode==='jump'||
   dir===u.facing||dir===wrap(u.facing+3))return [];
  const mode=u.moveMode==='stand'?'walk':u.moveMode;
  const old=this.tile(u.q,u.r),remaining=this.mp(u,mode)-u.spent;
  const options=[];
  for(const id of ['forward','back']){
   if(id==='back'&&mode!=='walk')continue;
   const [dq,dr]=DIRS[wrap(u.facing+(id==='back'?3:0))];
   const tile=this.tile(u.q+dq,u.r+dr);
   if(!tile||this.occupied(tile.q,tile.r,u.id))continue;
   const change=tile.height-old.height;
   if(Math.abs(change)>2||(id==='back'&&change!==0)||
    (['run','evade'].includes(mode)&&tile.depth))continue;
   const cost=this.terrainCost(tile)+Math.abs(change);
   if(cost<=remaining)options.push({id,q:tile.q,r:tile.r,cost});
  }
  return options;
 }
 chooseResolutionOption(kind,u,options,fallback,context={}){
  if(options.length<2||!this._resolutionChooser)return fallback;
  return this._resolutionChooser({kind,unitId:u.id,team:u.team,
   q:u.q,r:u.r,options,context},fallback);
 }
 performDominoDodge(u,option){
  u.q=option.q;u.r=option.r;u.spent+=option.cost;
  this.note(u.name+': уклонение от домино, '+option.cost+' MP.');
  this.checkExistingHullBreaches(u);
  const tile=this.tile(u.q,u.r);
  if(!u.dead&&(tile.depth||tile.type==='rubble'))
   this.psr(u,tile.depth>=3?1:tile.depth===1?-1:0,tile.depth?'Вода':'Обломки',true);
 }
 resolveDomino(u,dir,depth){
  const check=this.dominoCheck(u);
  if(u.dead)return;
  if(!check.failed){
   const options=this.dominoDodgeOptions(u,dir);
   if(options.length){
    const roll=this.phaseRolls.at(-1);
    const chosen=this.chooseResolutionOption('domino',u,[{id:'decline'},...options],'decline',
     {direction:dir,roll:roll?{total:roll.total,target:roll.target}:null});
    const dodge=options.find(o=>o.id===chosen);
    if(dodge){this.performDominoDodge(u,dodge);return;}
   }
  }
  const old=this.tile(u.q,u.r);
  if(!this.displace(u,dir,depth+1)){
   this.destroyMech(u);
   this.note(u.name+': нет допустимого гекса для домино.');
   return;
  }
  if(check.failed&&!u.dead&&!u.prone){
   const drop=Math.max(0,old.height-this.tile(u.q,u.r).height);
   this.fall(u,drop>=2?drop:0,check.tn);
  }
 }
 // AGoAC pp.40,44: a forced drop of at least two levels onto
 // an occupied hex is a possible collision, not ordinary domino movement.
 fallNeighborOptions(center){
  return DIRS.map(([dq,dr],dir)=>({dir,tile:this.tile(center.q+dq,center.r+dr)}))
   .filter(({tile})=>tile&&tile.height-center.height<=2&&!this.occupied(tile.q,tile.r));
 }
 chooseFallNeighbor(options){
  if(!options.length)return null;
  return options.length===1?options[0]:options[Math.floor(this.rng()*options.length)];
 }
 accidentalFallMiss(u,old,destination){
  const candidates=this.fallNeighborOptions(destination).filter(({tile})=>tile.height<=old.height);
  const nearest=Math.min(...candidates.map(({tile})=>distance(old,tile)));
  const landing=this.chooseFallNeighbor(candidates.filter(({tile})=>distance(old,tile)===nearest));
  if(!landing){this.destroyMech(u);return;}
  u.q=landing.tile.q;u.r=landing.tile.r;
  this.fall(u,old.height-landing.tile.height,null,null,0,old);
 }
 accidentalFallHit(u,target,old,destination,depth){
  const drop=old.height-destination.height;
  const impactLevels=Math.max(0,drop-(target.prone?1:2));
  const raw=Math.ceil(u.tonnage/10)*impactLevels;
  const damage=destination.depth>=(target.prone?1:2)?Math.floor(raw/2):raw;
  this.packets(target,damage,this.hitSide(target,u),'punch');
  u.q=destination.q;u.r=destination.r;
  this.fall(u,drop,null,'rear',0,old);
  if(target.dead)return;
  const landing=this.chooseFallNeighbor(this.fallNeighborOptions(destination));
  if(!landing||!this.displace(target,landing.dir,depth+1)){
   this.destroyMech(target);return;
  }
  this.psr(target,2,'Падение сверху',true);
 }
 accidentalFall(u,target,old,destination,depth){
  const terrain=destination.type==='heavy'?2:destination.type==='woods'?1:0;
  const tn=7+this.tmm(target)+terrain;
  if(this.roll(u.name+' · Падение сверху',tn)<tn)
   this.accidentalFallMiss(u,old,destination);
  else this.accidentalFallHit(u,target,old,destination,depth);
  return true;
 }
 displace(u,dir,depth=0){
  if(u.dead||depth>this.units.length+1)return false;
  const d=DIRS[dir],t=this.tile(u.q+d[0],u.r+d[1]);
  if(!t){u.dead=true;u.removalPending=false;u.escaped=true;this.note(u.name+' вытеснен за край карты.');return true;}
  const old=this.tile(u.q,u.r);
  if(t.height-old.height>2)return false;
  const occ=this.units.find(v=>v.deployed!==false&&!v.dead&&!v.airborne&&v.id!==u.id&&v.q===t.q&&v.r===t.r);
  if(occ&&old.height-t.height>=2)return this.accidentalFall(u,occ,old,t,depth);
  if(occ)this.resolveDomino(occ,dir,depth);
  u.q=t.q;u.r=t.r;
  if(old.height-t.height>=2)this.fall(u,old.height-t.height,null,null,0,old);
  return true;
 }
 // AGoAC pp.29,40,42: resolve opposed pushes together. A displacement
 // check is immediate, and a drop of two or more levels already caused a fall.
 pushTargetValid(u,t){
  if(!u||!t||u.dead||t.dead||u.prone||t.prone)return false;
  const [dq,dr]=DIRS[u.facing];
  return t.q===u.q+dq&&t.r===u.r+dr&&this.tile(u.q,u.r).height===this.tile(t.q,t.r).height;
 }
 applyPush(u,t){
  const old={q:t.q,r:t.r};
  if(this.displace(t,u.facing)){u.q=old.q;u.r=old.r;}
  if(!t.dead&&!t.prone)this.psr(t,0,'Толчок',true);
 }
 resolvePush(d,opposed){
  const first=this.unit(d.id),second=this.unit(d.target),orders=opposed?[d,opposed]:[d];
  const valid=this.pushTargetValid(first,second);
  const attacks=orders.map(order=>{
   const u=this.unit(order.id),t=this.unit(order.target);
   const legal=valid&&this.pushTargetValid(u,t)&&!this.cancelImpossiblePhysical(u,order);
   const roll=legal?this.roll(u.name+' · push',order.targetNumber):null;
   return {u,t,order,roll,hit:legal&&roll>=order.targetNumber,rolls:legal?[this.phaseRolls.at(-1)]:[]};
  });
  const successes=attacks.filter(a=>a.hit);
  if(successes.length===2){
   for(const a of successes){
    const start=this.phaseRolls.length;
    this.psr(a.t,0,'Встречный толчок',true);
    a.rolls.push(...this.phaseRolls.slice(start));
   }
  }else if(successes.length===1){
   const a=successes[0],start=this.phaseRolls.length;
   this.applyPush(a.u,a.t);
   a.rolls.push(...this.phaseRolls.slice(start));
  }
  for(const a of attacks){
   this.resolution.push({id:a.u.id,target:a.t.id,ok:true,shots:[{
    weapon:'push',hit:a.hit,roll:a.roll,targetNumber:a.order.targetNumber,damage:0,rolls:a.rolls}]});
   this.note(a.u.name+': push, '+(a.roll??'—')+'/'+a.order.targetNumber+'+, 0 урона.');
  }
 }
 // AGoAC pp.6–7,29–30,42: normal physical attacks are declared and
 // rolled before damage. Displacement is an immediate exception and can
 // interrupt an attack that has not yet been made.
 physicalOrder(){
  const orders=[
   ...this.units.filter(u=>u.charge&&!u.charge.resolved).map(u=>({id:u.id,target:u.charge.target,special:true})),
   ...this.physicalDeclarations
  ];
  if(this.initiativeWinner!==0&&this.initiativeWinner!==1)return orders;
  // AGoAC pp.6–7: the ordinary Physical Attack Phase repeats the
  // weapon resolution sequence, starting again with the initiative loser.
  // Preserve established displacement exception ordering; its detailed
  // adjudication is outside this ordinary phase scheduling path.
  if(orders.some(d=>d.special||d.type==='push'))
   return orders.sort((a,b)=>Number(this.unit(a.id).team===this.initiativeWinner)-
    Number(this.unit(b.id).team===this.initiativeWinner));
  const groups=[new Map(),new Map()];
  for(const d of orders){
   const group=groups[this.unit(d.id).team];
   if(!group.has(d.id))group.set(d.id,[]);
   group.get(d.id).push(d);
  }
  const sides=groups.map(group=>[...group.values()]),ordered=[];
  const first=1-this.initiativeWinner;
  for(let slot=0;slot<Math.max(sides[0].length,sides[1].length);slot++){
   ordered.push(...(sides[first][slot]??[]),...(sides[1-first][slot]??[]));
  }
  return ordered;
 }
 // AGoAC p.42: the lower-Initiative side acts first in displacement
 // conflicts; within that side, its controller can order its own attacks.
 // Offer a choice conservatively whenever a remaining special/push attack
 // could move a participant (including an indirect domino chain).
 nextPhysicalAttacker(orders,handled){
  const remaining=orders.filter(d=>!handled.has(d));
  if(!remaining.length)return [];
  const first=this.unit(remaining[0].id);
  const sameSide=remaining.filter(d=>this.unit(d.id).team===first.team);
  const ids=[...new Set(sameSide.map(d=>d.id))];
  let id=first.id;
  if(ids.length>1&&sameSide.some(d=>d.special||d.type==='push')){
   const options=ids.map(unitId=>({
    id:String(unitId),attackerId:unitId,
    attacks:sameSide.filter(d=>d.id===unitId).map(d=>({
     targetId:d.target,type:d.special?this.unit(d.id).charge.type:d.type,limb:d.limb
    }))
   }));
   id=Number(this.chooseResolutionOption('physical-order',first,options,String(id)));
  }
  // A Mech's two declared punches cannot be split between other attackers.
  return sameSide.filter(d=>d.id===id);
 }
 physicalGeometryChanged(before,now){
  return before.q!==now.q||before.r!==now.r||before.facing!==now.facing||
   before.prone!==now.prone||!!before.escaped!==!!now.escaped;
 }
 physicalAfterDisplacement(d,snapshots){
  const u=this.unit(d.id),t=this.unit(d.target),originalU=snapshots.get(d.id),originalT=snapshots.get(d.target);
  // Ordinary attack damage has not yet been resolved. A death occurring
  // here is an immediate displacement/fall effect (pp.30,42), not a
  // reason to erase an attack that was already rolled.
  if((u.dead&&!originalU.dead)||(t.dead&&!originalT.dead))return null;
  if(!this.physicalGeometryChanged(originalU,u)&&!this.physicalGeometryChanged(originalT,t))return d;
  if(u.escaped||t.escaped)return null;
  // Reassess geometry using the state from before attacks. Ordinary damage
  // from this phase cannot remove a declared attack or increase its TN.
  const atCurrentPosition=(original,current)=>({...original,q:current.q,r:current.r,
   facing:current.facing,prone:current.prone});
  const p=this.physicalPreview(atCurrentPosition(originalU,u),atCurrentPosition(originalT,t),d.type,d.limb,{locationTable:d.locationTable});
  return p.legal?{...d,...p}:null;
 }
 // AGoAC p.25: the controller may decline a known impossible attack;
 // a declined kick is never a missed kick and therefore creates no PSR.
 cancelImpossiblePhysical(u,d){
  if(d.targetNumber<=12)return false;
  return this.chooseResolutionOption('physical-impossible',u,[{id:'attack'},{id:'cancel'}],
   'attack',{targetId:d.target,attack:d.type,limb:d.limb,targetNumber:d.targetNumber})==='cancel';
 }
 rollPhysical(d,snapshots){
  const u=this.unit(d.id),t=this.unit(d.target),effective=this.physicalAfterDisplacement(d,snapshots);
  if(!effective)return {u,t,d,roll:null,hit:false,cancelled:true,attackRoll:null};
  if(this.cancelImpossiblePhysical(u,effective))return {u,t,d:effective,roll:null,hit:false,cancelled:true,attackRoll:null};
  const roll=this.roll(u.name+' · '+d.type,effective.targetNumber);
  return {u,t,d:effective,roll,hit:roll>=effective.targetNumber,cancelled:false,attackRoll:this.phaseRolls.at(-1)};
 }
 resolveRolledPhysical({u,t,d,roll,hit,cancelled,attackRoll}){
  const start=this.phaseRolls.length;let damage=0;
  if(hit){
   if(!t.dead){
    const out=this.hit(t,d.damage,d.side,d.table,null,!!d.physicalCover);
    damage=out.damage;
    if(d.type==='kick')this.psr(t,0,'Удар ногой');
   }
   if(d.type==='club'&&u.clubKind!=='limb'){u.club=false;u.clubKind=null;}
  }else if(!cancelled&&d.type==='kick')this.psr(u,0,'Промах ногой');
  this.resolution.push({id:d.id,target:d.target,ok:true,shots:[{
   weapon:d.type,hit,roll,targetNumber:d.targetNumber,damage,cancelled,
   rolls:[...(attackRoll?[attackRoll]:[]),...this.phaseRolls.slice(start)]}]});
  this.note(u.name+': '+d.type+', '+(roll??'—')+'/'+d.targetNumber+'+, '+damage+' урона.');
 }
 // AGoAC pp.6–7: ordinary physical attacks repeat the weapon phase's
 // resolution sequence. Keep a fixed sequence of team slots even if
 // the controller chooses a different Mech from their remaining group.
 orderOrdinaryPhysicalMechs(groups,stage,visit){
  const teamOf=g=>this.unit(g.id).team;
  const remaining=[groups.filter(g=>teamOf(g)===0),groups.filter(g=>teamOf(g)===1)];
  for(const slot of groups){
   const list=remaining[teamOf(slot)],fallback=list[0];
   const options=list.map(g=>({id:String(g.id),attackerId:g.id,
    attacks:(stage==='roll'?g.attacks:g.attacks.filter(a=>a.hit).map(a=>a.d))
     .map(d=>({targetId:d.target,type:d.type,limb:d.limb}))}));
   const pick=this.chooseResolutionOption('physical-order',this.unit(fallback.id),options,String(fallback.id),{stage});
   visit(list.splice(list.findIndex(g=>String(g.id)===pick),1)[0]);
  }
 }
 // AGoAC pp.6–7,30: each controller orders a Mech's individual
 // attacks independently for rolls and successful-hit damage.
 orderOrdinaryPhysicalAttacks(g,stage,visit){
  const pending=g.attacks.map((attack,index)=>({attack,id:String(index)}));
  const declaration=entry=>stage==='roll'?entry.attack:entry.attack.d;
  const eligible=entry=>stage==='roll'||entry.attack.hit;
  while(pending.length){
   const first=pending[0];
   if(!eligible(first)){visit(pending.shift().attack);continue;}
   const options=pending.filter(eligible).map(entry=>{
    const d=declaration(entry);
    return {id:entry.id,attackerId:g.id,attacks:[{targetId:d.target,type:d.type,limb:d.limb}]};
   });
   const pick=this.chooseResolutionOption('physical-order',this.unit(g.id),options,first.id,{stage,scope:'attack'});
   visit(pending.splice(pending.findIndex(entry=>entry.id===pick),1)[0].attack);
  }
 }
 resolveOrdinaryPhysical(orders,snapshots){
  const grouped=new Map();
  for(const d of orders){
   if(!grouped.has(d.id))grouped.set(d.id,{id:d.id,attacks:[]});
   grouped.get(d.id).attacks.push(d);
  }
  const groups=[...grouped.values()],staged=new Map();
  this.orderOrdinaryPhysicalMechs(groups,'roll',g=>{
   const attacks=[];
   this.orderOrdinaryPhysicalAttacks(g,'roll',d=>attacks.push(this.rollPhysical(d,snapshots)));
   staged.set(g.id,{id:g.id,attacks});
  });
  this.orderOrdinaryPhysicalMechs(groups.map(g=>staged.get(g.id)),'damage',g=>{
   this.orderOrdinaryPhysicalAttacks(g,'damage',attack=>this.resolveRolledPhysical(attack));
  });
 }
 resolvePhysical(){
  this.phaseRolls=[];this.resolution=[];this.deferConsciousness=true;
  try{
   const snapshots=new Map(this.units.map(u=>[u.id,structuredClone(u)]));
   const orders=this.physicalOrder();
   if(!orders.some(d=>d.special||d.type==='push')){
    this.resolveOrdinaryPhysical(orders,snapshots);
   }else{
   const handled=new Set(),attacks=[];
   while(handled.size<orders.length){
    const group=this.nextPhysicalAttacker(orders,handled);
    for(const d of group){
     if(handled.has(d))continue;
     handled.add(d);
     if(d.special){this.resolveSpecial(this.unit(d.id));continue;}
     if(d.type==='push'){
      const opposed=orders.find(p=>p!==d&&!handled.has(p)&&p.type==='push'&&p.id===d.target&&p.target===d.id);
      if(opposed)handled.add(opposed);
      this.resolvePush(d,opposed);continue;
     }
     attacks.push(this.rollPhysical(d,snapshots));
    }
   }
   for(const attack of attacks)this.resolveRolledPhysical(attack);
   }
  }finally{this.deferConsciousness=false;}
  const start=this.phaseRolls.length;this.endPSR();this.afterRolls=this.phaseRolls.slice(start);
  this.physicalDeclarations=[];this.removeDestroyedMechs();return this.resolution;
 }
 // AGoAC p.38: only a conscious pilot may override thermal shutdown.
 // Below 14 heat an involuntarily shut-down reactor restarts automatically,
 // even if the pilot is still unconscious. Voluntary shutdown is separate.
 heatRequiresShutdown(u,tn,was){
  if(tn===0)return false;
  if(tn===99||u.unconscious||u.abandoned)return true;
  return this.roll(u.name+' · '+(was?'Перезапуск':'Реактор'),tn)<tn;
 }
 // AGoAC p.38: choose by damage per shot, not the total stored
 // ammunition. The owning controller breaks a tie between full bins.
 heatExplosionBin(u,bins){
  const damage=b=>{const w=u.weapons[b.weapon];return w.damage*(w.rack||1);};
  const highest=Math.max(...bins.map(damage));
  const tied=bins.filter(b=>damage(b)===highest);
  const fallback=[...tied].sort((a,b)=>b.shots-a.shots)[0];
  const options=tied.map(b=>({id:String(u.bins.indexOf(b)),location:b.location,
   slot:b.slot+1,weaponName:u.weapons[b.weapon].name,shots:b.shots,damagePerShot:highest}));
  const pick=this.chooseResolutionOption('heat-ammo-bin',u,options,String(u.bins.indexOf(fallback)),
   {heat:u.heat,roll:{total:this.phaseRolls.at(-1)?.total,target:this.phaseRolls.at(-1)?.target}});
  return u.bins[Number(pick)];
 }
 heatPhase(){this.phaseRolls=[];for(const u of this.units){if(u.dead)continue;const t=this.tile(u.q,u.r),sinks=Math.max(0,u.sinks-u.sinksLost-this.floodedSlots(u,'sink')),sub=t.depth>=(u.prone?1:2),legSinks=Object.keys(u.slots).filter(l=>mechLegLocation(u,l)).reduce((n,l)=>n+u.slots[l].filter((s,i)=>s==='sink'&&!u.crit[l][i]&&!this.isBreached(u,l)).length,0),cool=sinks+Math.min(6,sub?sinks:t.depth?legSinks:0),was=u.shutdown;u.heat=Math.max(0,u.heat+u.pendingHeat+(was?0:this.effectiveEngineHits(u)*5)-cool);u.pendingHeat=0;u.externalHeat=0;const tn=shut(u.heat);if(u.voluntaryShutdown){u.shutdown=true;}else{u.shutdown=this.heatRequiresShutdown(u,tn,was);if(!was&&u.shutdown)this.psr(u,3,'Отключение реактора',true,0,true);}if(u.heat>=19){const bins=u.bins.filter(b=>b.shots&&!b.destroyed);if(bins.length){const at=u.heat>=28?8:u.heat>=23?6:4;if(this.roll(u.name+' · Перегрев боезапаса',at)<at){this.explode(u,this.heatExplosionBin(u,bins));}}}if(u.lifeSupport&&u.heat>=15)this.wound(u,u.heat>=26?2:1);this.consciousness(u);}this.endPSR();this.removeDestroyedMechs();}
 endPhase(){this.phaseRolls=[];for(const u of this.units){if(u.dead)continue;if(u.lifeSupport&&this.tile(u.q,u.r).depth>=(u.prone?1:2))this.wound(u,1);this.consciousness(u);if(u.dead)continue;if(u.unconscious&&u.wasUnconscious&&this.roll(u.name+' · Пробуждение',conscious[u.pilotWounds])>=conscious[u.pilotWounds]){
   u.unconscious=false;
   // The pilot was unavailable at the pre-resolution End Phase UI.
   // Offer the newly available voluntary reactor decision now.
   if(!u.abandoned&&!u.shutdownNext&&(!u.shutdown||u.voluntaryShutdown&&u.heat<30)){
    const roll=this.phaseRolls.at(-1),action=u.shutdown?'restart':'shutdown';
    const selected=this.chooseResolutionOption('recovered-reactor',u,[{id:'stay'},{id:action}],'stay',
     {heat:u.heat,shutdown:u.shutdown,roll:{total:roll.total,target:roll.target}});
    u.shutdownNext=selected===action;
   }
  }for(const i of u.dumping){const b=u.bins[i];if(b)b.shots=0;}u.dumping=u.dumpNext;u.dumpNext=[];this.syncAmmo(u);if(u.shutdownNext){u.shutdownNext=false;if(u.unconscious||u.abandoned){this.note(u.name+': приказ реактору отменён — пилот недоступен.');}else if(!u.shutdown){u.shutdown=true;u.voluntaryShutdown=true;this.note(`${u.name}: добровольное отключение реактора.`);}else if(u.voluntaryShutdown){const tn=shut(u.heat);if(tn!==99&&(tn===0||this.roll(u.name+' · Добровольный перезапуск',tn)>=tn)){u.shutdown=false;u.voluntaryShutdown=false;this.note(`${u.name}: реактор перезапущен.`);}else this.note(`${u.name}: перезапуск не удался.`);}}u.wasUnconscious=u.unconscious;u.proneAtStart=u.prone;u.moveStart={q:u.q,r:u.r};u.moved=false;u.fired=false;u.physicalDone=false;u.spent=0;u.moveMode='stand';u.distanceMoved=0;u.tmmTravel=null;u.tmmReversalOffset=0;u.skidded=false;u.skidDirection=null;u.lastMovementDirection=null;u.skidCollisionPending=null;u.twist=0;u.flip=false;u.firedLocations=[];u.standAttempts=0;u.restrictedStandThisTurn=false;u.moveEndedByLegLoss=false;u.charge=null;}this.removeDestroyedMechs();this.round++;}
 // Resolve an interactive phase on a detached rules-state copy. A choice
 // commits no partial damage/movement; recorded RNG samples are replayed
 // exactly once, even after restoring an authoritative saved battle.
 resolutionTrial(){
  const trial=Object.create(Object.getPrototypeOf(this));
  for(const [name,value] of Object.entries(this)){
   if(['rng','map','pendingChoice','_resolutionReplay','_resolutionChooser'].includes(name))continue;
   if(name==='tiles'){
    trial.tiles=value.map(({mesh,original,...tile})=>structuredClone(tile));
   }else if(typeof value!=='function')trial[name]=structuredClone(value);
  }
  trial.rebuildMap();return trial;
 }
 commitResolutionTrial(trial){
  const rendered=new Map(this.tiles.map(t=>[key(t.q,t.r),t]));
  const tiles=trial.tiles.map(t=>{
   const prior=rendered.get(key(t.q,t.r));
   return prior?Object.assign(prior,t):t;
  });
  for(const [name,value] of Object.entries(trial))
   if(!['rng','map','tiles','_resolutionChooser'].includes(name))this[name]=value;
  this.tiles=tiles;this.rebuildMap();
  this.pendingChoice=null;this._resolutionReplay=null;
 }
 moveWithChoices(id,q,r,mode='walk',{lateral,facing,humanTeams=[0]}={}){
  if(this.pendingChoice)return fail('Сначала завершите ожидающее решение');
  return this.resolveWithChoices({humanTeams,movement:{id,q,r,mode,...(lateral===undefined?{}:{lateral}),...(facing===undefined?{}:{facing})}});
 }
 aiMoveWithChoices(id,{humanTeams=[0]}={}){
  if(this.pendingChoice)return fail('Сначала завершите ожидающее решение');
  return this.resolveWithChoices({humanTeams,movement:{kind:'ai',id}});
 }
 chargeWithChoices(id,target,attack='charge',{mode='run',humanTeams=[0]}={}){
  if(this.pendingChoice)return fail('Сначала завершите ожидающее решение');
  return this.resolveWithChoices({humanTeams,movement:{kind:'charge',id,target,attack,mode}});
 }
 nextPhaseWithChoices({humanTeams=[0],choice}={}){
  if(this.pendingChoice?.scope==='los')return this.resolveFireLosChoice(choice,humanTeams);
  if(this.pendingChoice?.scope==='movement')return this.resolveWithChoices({humanTeams,choice});
  if(!this.pendingChoice&&!['setup','fire','physical','heat','end'].includes(this.phase)){
   return choice===undefined?this.nextPhase():fail('Нет ожидающего решения');
  }
  if(this.winner!==null||this.queue.length)return fail('Фаза ещё не готова к разрешению');
  return this.resolveWithChoices({humanTeams,choice});
 }
 resolveWithChoices({humanTeams,choice,movement}){
  const journal=this._resolutionReplay?structuredClone(this._resolutionReplay):
   {draws:[],decisions:[],humanTeams:[...humanTeams],...(movement?{movement}:{})};
  if(this.pendingChoice){
   if(!choice||choice.key!==this.pendingChoice.key||
    !this.pendingChoice.options.some(o=>o.id===choice.option))
    return fail('Выберите допустимый вариант');
   journal.decisions.push({key:choice.key,option:choice.option});
  }else if(choice!==undefined)return fail('Нет ожидающего решения');
  const trial=this.resolutionTrial(),interrupt={};
  let sample=0,decision=0,pending=null;
  trial.rng=()=>{
   if(sample===journal.draws.length)journal.draws.push(this.rng());
   return journal.draws[sample++];
  };
  trial._resolutionChooser=(request,fallback)=>{
   if(!journal.humanTeams.includes(request.team))return fallback;
   const key=this.round+':'+this.phase+':'+decision+':'+request.kind+':'+request.unitId;
   const saved=journal.decisions[decision++];
   if(saved){
    if(saved.key!==key||!request.options.some(o=>o.id===saved.option))
     throw Error('resolution_replay_mismatch');
    return saved.option;
   }
   pending={...request,key,...(journal.movement?{scope:'movement'}:{})};
   throw interrupt;
  };
  try{
   const m=journal.movement;
   const result=!m?trial.nextPhase():m.kind==='ai'?trial.aiMove(m.id):
    m.kind==='charge'?trial.declareCharge(m.id,m.target,m.attack,m.mode):
    trial.move(m.id,m.q,m.r,m.mode,{lateral:m.lateral,facing:m.facing});
   if(m&&result.ok&&m.kind)result.rolls=[...trial.phaseRolls];
   if(!result.ok)return result;
   if(decision!==journal.decisions.length||sample!==journal.draws.length)
    throw Error('resolution_replay_incomplete');
   this.commitResolutionTrial(trial);
   return result;
  }catch(error){
   if(error!==interrupt)throw error;
   this.pendingChoice=pending;this._resolutionReplay=journal;
   return {ok:true,pending:true};
  }
 }
 nextPhase(){if(this.pendingChoice)return fail('Сначала завершите ожидающее решение');if(this.winner!==null)return fail('Бой окончен');if(['move','fire','physical'].includes(this.phase)&&this.queue.length)return fail('Сначала завершите приказы всех мехов');if(this.phase==='move'&&this.units.some(u=>!u.dead&&u.deployed===false))return fail('Не все мехи вошли на поле');this.phaseRolls=[];this.resolution=[];this.afterRolls=[];if(this.phase==='setup')return this.resolveDeploymentSetup();if(this.phase==='initiative'){this.initiative();return {ok:true};}if(this.phase==='move'){// Resolve remaining movement-phase damage checks before fire; never carry damage between phases.
 this.endPSR();this.afterRolls=[...this.phaseRolls];this.removeDestroyedMechs();this.checkWin();if(this.winner===null){this.phase='fire';this.buildQueue();}}else if(this.phase==='fire'){this.resolveFire();this.checkWin();if(this.winner===null){this.phase='physical';this.buildQueue();}}else if(this.phase==='physical'){this.resolvePhysical();this.checkWin();this.activeTeam=null;if(this.winner===null)this.phase='heat';}else if(this.phase==='heat'){this.heatPhase();this.checkWin();if(this.winner===null)this.phase='end';}else{this.endPhase();this.checkWin({stalemate:true});if(this.winner===null)this.phase='initiative';}if(this.winner===null)this.note(`Раунд ${this.round}: ${PHASES[this.phase]}.`);else{this.activeTeam=null;this.actingId=null;}return {ok:true};}
 aiMove(id){const u=this.unit(id);if(!this.canAct(u))return fail('Не очередь ИИ');if(u.deployed===false){const choices=this.deploymentOptions(u);const best=choices.sort((a,b)=>Number(a.mode==='minimum')-Number(b.mode==='minimum')||distance(a,{q:0,r:0})-distance(b,{q:0,r:0})||a.cost-b.cost)[0];if(!best)return {...fail('Нет допустимого входа: требуется изменить условия сценария'),code:'deployment_blocked'};const result=this.enterDeployment(u,best.q,best.r,best.mode);if(result.ok&&!result.ended)this.hold(id);return result;}if(this.isImmobile(u))return this.hold(id);if(u.prone){const s=this.stand(id);if(!s.ok||u.prone)return this.hold(id);}const options=['walk','run',...(this.mp(u,'jump')?['jump']:[])].flatMap(m=>this.reachable(u,m).map(p=>({...p,mode:m})));let best=null,score=-Infinity;const enemies=this.units.filter(t=>t.team!==u.team&&!t.dead&&t.deployed!==false);for(const p of options){const old={q:u.q,r:u.r,facing:u.facing};u.q=p.q;u.r=p.r;u.facing=p.facing;let value=-Infinity;for(const t of enemies){let v=u.weapons.reduce((n,w,i)=>n+this.preview(id,t.id,i).chance*(w.rack?w.rack*.6*w.damage:w.damage)/100,0)-Math.abs(distance(u,t)-5)*.5;if(p.mode==='jump')v-=1;value=Math.max(value,v);}Object.assign(u,old);if(value>score){score=value;best=p;}}const r=best?this.move(id,best.q,best.r,best.mode):{ok:true};this.hold(id);return r;}
 planAiFire(u){
  const prior=u.twist;
  let best=null;
  const extended=u.quirks?.extendedTorsoTwist===true;
  const twists=u.config==='Quad'?(extended?[-1,0,1]:[0]):(extended?[-2,-1,0,1,2]:[-1,0,1]);
  for(const twist of twists){
   if((u.prone||u.flip)&&twist)continue;
   u.twist=twist;
   for(const t of this.units.filter(x=>x.team!==u.team&&!x.dead&&x.deployed!==false)){
    const indices=[],pools=new Map();
    let heat=u.heat+u.pendingHeat-u.sinks+u.sinksLost,score=0;
    for(const [i,w] of u.weapons.entries()){
     const p=this.preview(u.id,t.id,i),pool=w.shared??i;
     if(!p.legal||p.chance<17||heat+w.heat>=18||
        w.ammo!==null&&(pools.get(pool)||0)>=w.ammo)continue;
     indices.push(i);heat+=w.heat;score+=p.chance*(w.rack||w.damage);
     if(w.ammo!==null)pools.set(pool,(pools.get(pool)||0)+1);
    }
    if(!best||score>best.score)best={target:t.id,indices,twist,score};
   }
  }
  u.twist=prior;
  return best;
 }
 aiAttack(id){return this.aiAttackWithLosChoices(id,{humanTeams:[]});}
 aiPhysical(id){const u=this.unit(id);if(u?.moveMode==='evade')return this.hold(id);if(u.charge)return this.hold(id);let best=null;for(const t of this.units.filter(t=>t.team!==u.team&&!t.dead))for(const [type,limb]of (u.config==='Quad'?[['kick','LA'],['kick','RA'],['kick','LL'],['kick','RL']]:[['kick','RL'],['kick','LL'],['punch','RA'],['punch','LA'],['club','RA'],['push','RA']])){const p=this.physicalPreview(id,t.id,type,limb);if(p.legal&&(!best||p.damage-p.targetNumber>best.score))best={target:t.id,type,limb,score:p.damage-p.targetNumber};}return best?this.declarePhysical(id,best.target,best.type,best.limb):this.hold(id);}
 // AGoAC pp.9,11–12: the exceptional step is the entire movement
 // action. It cannot change a previously declared mode or bypass a
 // prohibition on running while dumping ammunition.
 minimumMove(id){
  const u=this.unit(id);
  if(u?.deployed===false)return fail('Сначала войдите на поле');
  if(this.phase!=='move'||!this.canAct(u)||u.spent||u.prone||this.isImmobile(u)||
     u.moveEndedByLegLoss||!['stand','run'].includes(u.moveMode)||
     u.dumping.length||u.dumpNext.length||this.mp(u,'walk')<1)
   return fail('Минимальный шаг недоступен');
  const d=DIRS[u.facing],t=this.tile(u.q+d[0],u.r+d[1]);
  if(!t||this.occupied(t.q,t.r,id)||Math.abs(t.height-this.tile(u.q,u.r).height)>2)
   return fail('Впереди препятствие');
  const from={q:u.q,r:u.r},to={q:t.q,r:t.r},cost=Math.max(1,this.mp(u,'run'));
  this.phaseRolls=[];this.actingId=id;
  Object.assign(u,to,{spent:cost,moveMode:'run',distanceMoved:1,lastMovementDirection:u.facing,tmmTravel:'forward',tmmReversalOffset:0});
  this.resolveVoluntaryBuildingEntry(u,from,to,1);
  this.checkExistingHullBreaches(u);
  if(!u.dead&&!u.moveEndedByLegLoss&&(t.depth||t.type==='rubble'))
   this.psr(u,t.depth>=3?1:t.depth===1?-1:0,'Минимальное движение',true);
  this.hold(id);
  return {ok:true,ended:true,from,to:{q:u.q,r:u.r},path:[to],mode:'run',rolls:[...this.phaseRolls]};
 }
 flipArms(id,on){const u=this.unit(id);if(this.phase!=='fire'||!this.canAct(u)||!this.mobile(u)||u.prone)return fail('Переворот рук недоступен');if(on&&(u.config==='Quad'||['LA','RA'].some(l=>u.slots[l][2]==='lower'||u.slots[l][3]==='hand')||u.weapons.some(w=>w.locations?.some(l=>['LA','RA'].includes(l))&&w.locations?.some(l=>['CT','LT','RT'].includes(l)))))return fail('Нужны руки без нижних и кистевых актуаторов');u.flip=on;u.twist=0;return {ok:true};}
 setBrace(id,limb){const u=this.unit(id);if(this.phase!=='fire'||!this.canAct(u)||!this.mobile(u)||!['LA','RA'].includes(limb))return fail('Нельзя выбрать опорную руку');u.brace=limb;return {ok:true};}
 orderDump(id,index){const u=this.unit(id);if(!this.canAct(u)||!this.mobile(u)||this.phase!=='move'||u.moveMode==='run'||u.moveMode==='jump')return fail('Сброс боезапаса: только ходьба или неподвижность');if(!u.bins[index]?.shots)return fail('Бункер пуст');if(!u.dumpNext.includes(index))u.dumpNext.push(index);this.note(`${u.name}: сброс бункера ${index+1} начнётся в конце хода; завершится через ход.`);return {ok:true};}
 // AGoAC pp.7,38: the decision is available during End Phase.
 // Keep earlier movement-phase scheduling as an optional UI shortcut.
 canOrderShutdown(u){
  return !!u&&!u.dead&&u.deployed!==false&&!u.unconscious&&!u.abandoned&&
   this.winner===null&&!this.pendingChoice&&(!u.shutdown||u.voluntaryShutdown)&&
   (this.phase==='end'||(this.phase==='move'&&this.canAct(u)));
 }
 orderShutdown(id){
  const u=this.unit(id);
  if(!this.canOrderShutdown(u))return fail('Приказ реактору недоступен');
  this.phaseRolls=[];u.shutdownNext=!u.shutdownNext;
  return {ok:true};
 }
 declareCharge(id,target,type='charge',moveMode='run'){const u=this.unit(id),t=this.unit(target);if(u?.deployed===false||t?.deployed===false)return fail('Мех ещё не вышел на поле');if(this.phase!=='move'||!this.canAct(u)||!this.mobile(u)||u.prone||!t||t.team===u.team||t.dead||t.charge||t.airborne||(type==='charge'&&t.prone)||!(t.moved||!this.mobile(t)))return fail('Цель должна завершить движение; для тарана цель должна стоять');if(this.displacementTargetReserved(target))return fail('Эта цель уже выбрана для тарана/DFA');if(!['charge','dfa'].includes(type)||type==='charge'&&!['walk','run'].includes(moveMode))return fail('Недопустимый тип тарана или режим движения');const mode=type==='dfa'?'jump':moveMode;if(u.spent||u.moveMode!=='stand')return fail('Заявите таран/DFA до обычного движения');let options=this.reachable(u,mode).filter(p=>distance(p,t)===1);if(type==='dfa'){if(!this.mp(u,'jump')||distance(u,t)>this.mp(u,'jump')||this.tile(t.q,t.r).height+(t.prone?0:2)>this.tile(u.q,u.r).height+this.mp(u,'jump'))return fail('Не хватает высоты или дальности прыжка');}else options=options.filter(p=>p.cost+this.terrainCost(this.tile(t.q,t.r))+Math.abs(this.tile(p.q,p.r).height-this.tile(t.q,t.r).height)<=this.mp(u,mode));
 options.sort((a,b)=>a.cost-b.cost);const p=options[0];if(!p)return fail('Нет допустимого подхода к цели');const start={q:u.q,r:u.r},targetStart={q:t.q,r:t.r},r=this.move(id,p.q,p.r,mode);if(!r.ok)return r;
 // An involuntary stop during the approach cannot create a declared
 // physical attack from the planned (but never reached) hex.
 if(u.dead||u.prone||this.isImmobile(u)||u.moveEndedByLegLoss||u.skidded||
    u.q!==p.q||u.r!==p.r||t.dead||t.q!==targetStart.q||t.r!==targetStart.r){
  this.note(u.name+': подход прерван; физическая атака не заявлена.');
  this.hold(id);return {...r,ended:true,chargeInterrupted:true,rolls:[...this.phaseRolls]};
 }
 const d=DIRS.findIndex(d=>p.q+d[0]===t.q&&p.r+d[1]===t.r);u.facing=d;u.charge={target,type,dir:d,hexes:type==='dfa'?distance(start,u):chargeTravelHexes(start,p.path),targetPos:{q:t.q,r:t.r},startPos:start};if(type==='dfa'){u.pendingHeat-=Math.max(3,u.spent);u.spent=distance(start,t);u.pendingHeat+=Math.max(3,u.spent);u.airborne=true;}this.note(`${u.name}: заявлен ${type==='dfa'?'DFA':'таран'} против ${t.name}.`);this.hold(id);return r;}
 // AGoAC p.27: a missed DFA allows any legal neighboring hex,
 // including an occupied one. A successful DFA searches by angular
 // distance from the original displacement direction.
 dfaDisplacementOptions(t,dir,hit){
  const old=this.tile(t.q,t.r);
  const groups=hit?[[dir],[wrap(dir+1),wrap(dir-1)],
   [wrap(dir+2),wrap(dir-2)],[wrap(dir+3)]]:
   [[dir,wrap(dir+1),wrap(dir-1),wrap(dir+2),wrap(dir-2),wrap(dir+3)]];
  for(const group of groups){
   const legal=group.filter(d=>{
    const [dq,dr]=DIRS[d],tile=this.tile(t.q+dq,t.r+dr);
    return !tile||tile.height-old.height<=2;
   });
   if(legal.length)return legal;
  }
  return [];
 }
 resolveDFALanding(u,t,dir,hit,old,fallTN=null){
  const options=t.dead?[]:this.dfaDisplacementOptions(t,dir,hit);
  if(!t.dead&&!options.length){
   if(!hit){this.destroyMech(u);return;}
   this.destroyMech(t);
  }
  const directions=options.map(dir=>{
   const [dq,dr]=DIRS[dir],q=t.q+dq,r=t.r+dr;
   return {id:String(dir),q,r,offboard:!this.tile(q,r)};
  });
  const chosen=directions.length?Number(this.chooseResolutionOption('dfa',t,directions,
   directions[0].id,{hit,attackerId:u.id})):null;
  u.q=old.q;u.r=old.r;
  if(!t.dead&&chosen!==null&&!this.displace(t,chosen))this.destroyMech(t);
  if(hit){
   if(!u.dead)this.psr(u,4,'Посадка DFA');
   if(!t.dead&&!t.prone)this.psr(t,2,'Попадание DFA');
  }else if(!u.dead)this.fall(u,2,fallTN,'rear');
 }
 resolveSpecial(u){const s=u.charge;if(!s||s.resolved||u.dead)return;const t=this.unit(s.target);if(!t)return;if(t.dead||t.q!==s.targetPos.q||t.r!==s.targetPos.r||t.prone&&s.type==='charge'){u.airborne=false;this.note(`${u.name}: специальная атака отменена — цель изменилась.`);return;}const start=this.phaseRolls.length,dfa=s.type==='dfa',tn=Math.max(2,u.piloting+(u.piloting-t.piloting)+(dfa?3:u.moveMode==='run'?2:1)+(this.isImmobile(t)?-4:this.tmm(t))+(dfa?0:this.los(u,t).woods)),roll=this.roll(u.name+' · '+(dfa?'DFA':'Таран'),tn),hit=!u.prone&&roll>=tn;const old={q:t.q,r:t.r},side=this.hitSide(t,dfa?(s.startPos??u.moveStart??u):u);let damage=0;u.airborne=false;
 if(hit){damage=dfa?Math.ceil(u.tonnage/10*3):Math.ceil(u.tonnage/10*s.hexes);this.packets(t,damage,dfa&&t.prone?'rear':side,dfa&&!t.prone?'punch':'normal');this.packets(u,dfa?u.tonnage/5:Math.ceil(t.tonnage/10),'front',dfa?'kick':'normal');if(dfa)this.resolveDFALanding(u,t,s.dir,true,old);else{
 // AGoAC pp.26,42: a successful charge may cause damage without
 // displacing either Mech when the destination is prohibited. Destruction
 // by the charge itself instead permits the attacker to enter the hex.
 const advance=t.dead||this.displace(t,s.dir);
 if(!u.dead){if(advance){u.q=old.q;u.r=old.r;}this.psr(u,2,'Таран');}this.psr(t,2,'Попадание тарана');}}else if(dfa){this.resolveDFALanding(u,t,s.dir,false,old);}else{const d=[wrap(s.dir+1),wrap(s.dir-1)].find(d=>{const v=DIRS[d];return this.tile(u.q+v[0],u.r+v[1])&&!this.occupied(u.q+v[0],u.r+v[1],u.id);});if(d!==undefined){u.q+=DIRS[d][0];u.r+=DIRS[d][1];}}
 this.resolution.push({id:u.id,target:t.id,ok:true,shots:[{weapon:dfa?'DFA':'Таран',hit,roll,targetNumber:tn,damage,rolls:this.phaseRolls.slice(start)}]});}

}
