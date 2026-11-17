import {Game as Legacy,LOCATIONS,DIRS,distance} from './legacy-engine.js';
export {LOCATIONS,DIRS,distance};
// AGoAC pp.3–4: logical game scale; visual model dimensions remain illustrative.
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
export const PHASES={initiative:'Инициатива',move:'Движение',fire:'Стрельба: декларации',physical:'Физические атаки',heat:'Нагрев',end:'Конец хода'};
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
 reset(){super.reset();this.phase='initiative';this.queue=[];this.activeTeam=null;this.actingId=null;this.deferConsciousness=false;this.declarations=[];this.physicalDeclarations=[];this.phaseRolls=[];this.resolution=[];this.afterRolls=[];this.weather={night:false,gale:false};this.tacticalOptions={standingStill:false,evading:false,floatingCriticals:false};
 for(const t of this.tiles){t.depth=0;t.surface=t.height;if(t.q===0&&t.r>0&&t.r<4){t.type='water';t.depth=t.r===2?2:1;t.height=-t.depth;t.surface=0;}else if(t.q===1&&t.r===-2)t.type='rubble';else if(t.q===-1&&t.r===-2)t.type='rough';}
 this.rebuildMap();
 this.units.forEach((u,i)=>{const defaults=defaultMechWarriorSkills(u.techBase);u.gunnery=defaults.gunnery;u.piloting=defaults.piloting;Object.keys(LOCATIONS).forEach((l,j)=>u.armor[l]=armor[i][j]);u.maxArmor={...u.armor};u.rear={CT:rears[i][0],LT:rears[i][1],RT:rears[i][2]};u.maxRear={...u.rear};Object.assign(u,{pilotWounds:0,unconscious:false,wasUnconscious:false,prone:false,proneAtStart:false,engineHits:0,gyroHits:0,sensorHits:0,lifeSupport:false,psrs:[],consciousChecks:0,phaseDamage:0,externalHeat:0,breached:[],skidded:false,skidDirection:null,lastMovementDirection:null,skidCollisionPending:null,spent:0,twist:0,flip:false,physicalDone:false,charge:null,club:false,sinksLost:0,jumpLost:0,dumping:[],dumpNext:[],shutdownNext:false,voluntaryShutdown:false,moveStart:{q:u.q,r:u.r},firedLocations:[],startProne:false,standAttempts:0});u.actuators={LA:{shoulder:false,upper:false,lower:false,hand:false},RA:{shoulder:false,upper:false,lower:false,hand:false},LL:{hip:false,upper:false,lower:false,foot:false},RL:{hip:false,upper:false,lower:false,foot:false}};
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
 isSubmergedLocation(u,loc){const depth=this.tile(u.q,u.r)?.depth??0;return depth>=(u.prone||mechLegLocation(u,loc)?1:2);}
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
 onMap(u){return !!u&&(!u.dead||u.removalPending===true);}
 occupied(q,r,except){return this.units.some(u=>this.onMap(u)&&u.id!==except&&u.q===q&&u.r===r);}
 destroyMech(u){if(u.dead)return;u.removalPending=true;u.dead=true;}
 removeDestroyedMechs(){for(const u of this.units)if(u.dead&&u.removalPending===true)u.removalPending=false;}
 mobile(u){return !u.dead&&!u.shutdown&&!u.unconscious&&!u.abandoned;}
 // AGoAC p.11: immobility is not equivalent to having zero MP or being prone.
 // Keep the operational-pilot predicate separate so a limbless chassis's
 // surviving torso weapons are not disabled by a movement-only restriction.
 isImmobile(u){return !this.mobile(u)||['LA','RA','LL','RL'].every(l=>u.structure?.[l]===0);}
 done(u){return this.phase==='move'?u.moved:this.phase==='fire'?u.fired:u.physicalDone;}
 canAct(u){return !!u&&this.winner===null&&!u.dead&&u.team===this.activeTeam&&!this.done(u)&&(this.actingId===null||this.actingId===u.id);}
 buildQueue(){let counts=[0,1].map(t=>this.units.filter(u=>u.team===t&&!u.dead).length),order=[1-this.initiativeWinner,this.initiativeWinner];this.queue=[];while(counts.some(Boolean)){let batches=counts.map((n,i)=>n?Math.min(n,Math.max(1,Math.floor(n/Math.max(1,counts[1-i])))):0);for(const t of order)for(let k=0;k<batches[t];k++)this.queue.push(t);counts=counts.map((n,i)=>n-batches[i]);}this.activeTeam=this.queue[0]??null;this.actingId=null;}
 finish(u){if(this.phase==='move')u.moved=true;else if(this.phase==='fire')u.fired=true;else u.physicalDone=true;this.queue.shift();this.activeTeam=this.queue[0]??null;this.actingId=null;}
 initiative(){this.phaseRolls=[];let a,b,tries=0;do{a=this.roll('Инициатива: зелёные');b=this.roll('Инициатива: красные');}while(a===b&&++tries<10000);if(a===b)throw Error('Генератор выдаёт только ничьи инициативы');this.initiativeWinner=a>b?0:1;this.phase='move';this.buildQueue();this.note(`Инициатива ${a}:${b}. ${this.initiativeWinner?'Красные':'Зелёные'} действуют вторыми.`);}
 psrMod(u,fallAvoidance=false){
  let n=u.gyroHits*3+(this.weather.gale?1:0);
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
  if(quad&&lost>=3)return 0;
  const depth=this.tile(u.q,u.r)?.depth??0;
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
  w=hips===2?0:hips?Math.ceil(w/2):w;
  for(const l of legs)if(!u.actuators[l].hip&&!this.isBreached(u,l))
   w-=Number(u.actuators[l].upper)+Number(u.actuators[l].lower)+Number(u.actuators[l].foot);
 }
 w=Math.max(0,w-Math.min(5,Math.floor(u.heat/5)));
 return mode==='run'||mode==='evade'?(lost?0:Math.ceil(w*1.5)):w;
 }
 terrainCost(t){
 const ground=t.type==='heavy'?3:['woods','rough','rubble'].includes(t.type)?2:
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

 reachable(u,mode='walk'){u=this.unit(u);if(this.phase!=='move'||!this.canAct(u)||this.isImmobile(u)||u.prone||u.moveEndedByLegLoss)return [];if(u.moveMode!=='stand'&&u.moveMode!==mode)return [];if(['run','evade'].includes(mode)&&(u.config==='Quad'?['LA','RA','LL','RL'].filter(l=>u.structure[l]===0).length>=2:u.structure.LL===0||u.structure.RL===0))return [];if(mode==='evade'&&(!this.tacticalOptions?.evading||(u.config==='Quad'?['LA','RA','LL','RL']:['LL','RL']).some(l=>u.actuators[l].hip||this.isBreached(u,l))))return [];if((u.dumping.length||u.dumpNext.length)&&['run','jump','evade'].includes(mode))return [];const max=this.mp(u,mode)-u.spent;if(max<0)return [];if(mode==='jump'){if(u.spent||u.proneAtStart||this.tile(u.q,u.r).depth>=2)return [];return this.tiles.filter(t=>!(t.building?.cf>0)&&!this.occupied(t.q,t.r,u.id)&&Math.max(1,distance(u,t))<=max&&this.jumpClear(u,t,max)).map(t=>({q:t.q,r:t.r,cost:Math.max(1,distance(u,t)),facing:u.facing,path:[{q:t.q,r:t.r,facing:u.facing}]}));}
 const lateralShifts=quadLateralDirections(u,mode);
 const actions=['left','right','forward','back',...lateralShifts.map(s=>s.action)];
 const start={q:u.q,r:u.r,facing:u.facing,cost:0,path:[]},states=new Map([[`${u.q},${u.r},${u.facing}`,start]]),ends=new Map([[key(u.q,u.r),start]]),open=[start];while(open.length){open.sort((a,b)=>a.cost-b.cost);const p=open.shift();for(const action of actions){let q=p.q,r=p.r,f=p.facing,c=1;const shift=lateralShifts.find(s=>s.action===action);if(action==='left'||action==='right')f=wrap(f+(action==='left'?1:-1));else{const backward=action==='back'||shift?.backward;if(backward&&mode!=='walk')continue;const d=DIRS[wrap(f+(shift?shift.offset:backward?3:0))];q+=d[0];r+=d[1];const t=this.tile(q,r),old=this.tile(p.q,p.r);if(!t)continue;const occ=this.units.find(x=>this.onMap(x)&&x.id!==u.id&&x.q===q&&x.r===r);if(occ&&(occ.team!==u.team||occ.prone))continue;const dh=t.height-old.height;if(Math.abs(dh)>2||backward&&dh!==0||['run','evade'].includes(mode)&&t.depth)continue;c=this.terrainCost(t)+Math.abs(dh)+(shift?1:0);}const cost=p.cost+c,k=`${q},${r},${f}`;if(cost>max||states.has(k)&&states.get(k).cost<=cost)continue;const v={q,r,facing:f,cost,path:[...p.path,{q,r,facing:f,cost:c,...(shift?{lateral:shift.backward?'backward':'forward'}:{})}]};states.set(k,v);open.push(v);if(!this.occupied(q,r,u.id)){
  const old=ends.get(key(q,r));
  if(!old||old.cost>cost||
    (u.config==='Quad'&&old.cost===cost&&v.facing===u.facing&&old.facing!==u.facing))
    ends.set(key(q,r),v);
 }}}return [...ends.values()];}
 jumpClear(u,t,max){const n=distance(u,t),height=this.tile(u.q,u.r).height+max;for(let i=1;i<=n;i++){const p=roundHex(u.q+(t.q-u.q)*i/n,u.r+(t.r-u.r)*i/n),x=this.tile(p.q,p.r);if(x&&x.surface>height)return false;}return true;}
 isPaved(t){return !!t&&(t.paved===true||t.road===true||['pavement','road'].includes(t.type));}
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
   const target=this.units.find(v=>!v.dead&&v.id!==u.id&&v.q===q&&v.r===r);
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
 rotate(id,delta){const u=this.unit(id);if(this.phase!=='move'||!this.canAct(u)||this.isImmobile(u))return fail('Разворот недоступен');const cost=Math.abs(delta);if(!Number.isInteger(delta)||cost<1||cost>3)return fail('Поворот: 1–3 гексстороны за действие');if(u.moveMode!=='jump'){const mode=u.moveMode==='stand'?'walk':u.moveMode;if(u.spent+cost>this.mp(u,mode))return fail('Нет MP');if(u.gyroHits>=2&&(u.spent>0||cost>1))return fail('Разрешён один разворот с разрушенным гироскопом');u.spent+=cost;u.moveMode=mode;}if(u.moveMode==='run'&&this.isPaved(this.tile(u.q,u.r))&&u.skidDirection===null)u.skidDirection=u.lastMovementDirection??u.facing;u.facing=wrap(u.facing+delta);this.actingId=id;return {ok:true};}
 move(id,q,r,mode='walk',options={}){const u=this.unit(id),routes=this.reachable(u,mode);
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
  const cost=this.terrainCost(toTile)+Math.abs(delta)+1;
  if(cost+u.spent>this.mp(u,mode))return fail('Недостаточно MP для бокового смещения');
  dst={q,r,facing:u.facing,cost,
    path:[{q,r,facing:u.facing,cost,lateral:shift.backward?'backward':'forward'}]};
 }
 if(!dst)return fail('Недоступный путь или очередь другого отряда');this.phaseRolls=[];this.actingId=id;const from={q:u.q,r:u.r},path=[];u.moveMode=mode;if(mode==='jump'){u.q=q;u.r=r;u.spent=dst.cost;u.pendingHeat+=Math.max(3,dst.cost);path.push({q,r});// BMM p.45: losing the first Quad leg adds +5 to the landing
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
}u.distanceMoved=mode==='jump'?distance(u.moveStart,u):u.distanceMoved+path.length;this.note(`${u.name}: ${mode}, потрачено ${u.spent} MP.`);return {ok:true,path,from,to:{q:u.q,r:u.r},mode,rolls:[...this.phaseRolls]};}
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
  if(committed&&options?.mode&&options.mode!==committed)
    return fail('Нельзя сменить объявленный режим движения');
  const standingBudget=restricted?2:this.mp(u,selected);
  if(!minimum&&u.spent+2>standingBudget)return fail('Нужно 2 MP');
  this.phaseRolls=[];u.standAttempts++;u.spent+=minimum?1:2;u.pendingHeat++;
  u.moveMode=selected;
  u.prone=false;this.actingId=id;
  // BMM p.19: a Quad with all four legs intact stands automatically.
  const stood=quad&&lost===0||this.psr(u,0,'Подъём',true);
  // The player chooses any new facing at no MP charge, but only on success.
  if(stood&&newFacing!==null)u.facing=newFacing;
  return {ok:true};}
 drop(id){const u=this.unit(id);if(!this.canAct(u)||this.isImmobile(u)||u.prone)return fail('Нельзя лечь');u.prone=true;this.checkExistingHullBreaches(u);this.actingId=id;return {ok:true};}
 hold(id){const u=this.unit(id);if(!this.canAct(u)&&!(u.dead&&this.phase==='move'&&this.actingId===id&&this.activeTeam===u.team))return fail('Выберите меха действующего отряда');if(this.phase==='move'){if(u.moveMode==='walk')u.pendingHeat++;if(u.moveMode==='evade'){u.pendingHeat+=4;}if(u.moveMode==='run'){u.pendingHeat+=2;if(u.gyroHits||(u.config==='Quad'?['LA','RA','LL','RL']:['LL','RL']).some(l=>u.actuators[l].hip))this.psr(u,0,'Бег с повреждениями',true);}}this.finish(u);return {ok:true};}
 relative(a,b,f=a.facing){const x=Math.sqrt(3)*(b.q-a.q+(b.r-a.r)/2),y=-1.5*(b.r-a.r),v=Math.atan2(y,x)-f*Math.PI/3;return Math.atan2(Math.sin(v),Math.cos(v))*180/Math.PI;}
 hitSide(u,a){const v=this.relative(u,a);return Math.abs(v)<=60.00001?'front':Math.abs(v)>=120-.00001?'rear':v>0?'left':'right';}
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
 los(a,b,underwaterWeapon=null){a=this.unit(a);b=this.unit(b);const n=distance(a,b),ta=this.tile(a.q,a.r),tb=this.tile(b.q,b.r),subA=underwaterWeapon===null?ta.depth>=(a.prone?1:2):underwaterWeapon,subB=tb.depth>=(b.prone?1:2)||(subA&&tb.depth===1&&!b.prone);if(subA!==subB)return {woods:0,blocked:true,cover:false};let woods=0,blocked=false,cover=tb.depth===1&&!b.prone,seen=new Set();const ah=ta.height+(a.prone?1:2),bh=tb.height+(b.prone?1:2);for(let i=1;i<=n;i++){const p=roundHex(a.q+(b.q-a.q)*i/n,a.r+(b.r-a.r)*i/n),t=this.tile(p.q,p.r);if(!t||seen.has(key(p.q,p.r)))continue;seen.add(key(p.q,p.r));const h=ah+(bh-ah)*i/n;if(i<n&&t.height>=h)blocked=true;if(i===n-1&&t.height===tb.height+1&&ah<=bh&&!b.prone)cover=true;if((t.type==='woods'||t.type==='heavy')&&(i===n||t.height+2>=h))woods+=t.type==='heavy'?2:1;}return {woods,blocked:blocked||woods>=3,cover};}
 tmm(u){const d=u.distanceMoved;return (d>=25?6:d>=18?5:d>=10?4:d>=7?3:d>=5?2:d>=3?1:0)+(u.moveMode==='jump'?1:0);}
 targetMovementModifier(t){return this.isImmobile(t)?-4:this.tmm(t)+(t.skidded?2:0)+(this.tacticalOptions?.standingStill&&t.spent===0?-1:0)+(this.tacticalOptions?.evading&&t.moveMode==='evade'&&!t.prone?1:0);}
 preview(id,target,index,opts={}){const u=this.unit(id),t=this.unit(target),w=u?.weapons[index];if(!u||!t||!w)return {legal:false,chance:0,targetNumber:99,reason:'Выберите цель'};const quadProneBonus=quadProneFireBonus(u),range=distance(u,t),act=u.actuators[w.location],sub=this.tile(u.q,u.r).depth>=(u.prone||mechLegLocation(u,w.location)?1:2),waterline=this.tile(t.q,t.r).depth===1&&!t.prone,targetSub=this.tile(t.q,t.r).depth>=(t.prone?1:2),underwaterCover=sub&&waterline,los=this.los(u,t,sub),ranges=sub?(UNDERWATER_RANGES[w.name]||[0,0,0]):w.ranges;let reason='';if(!this.mobile(u)||t.dead||u.team===t.team)reason='Мех не может стрелять';else if(u.charge)reason='Заявлен таран/DFA';else if(u.moveMode==='evade')reason='Уклонение запрещает атаки';else if(w.destroyed||!u.structure[w.location]||this.isBreached(u,w.location)||w.locations?.some(l=>this.isBreached(u,l)))reason='Оружие уничтожено или затоплено';else if(u.sensorHits>=2)reason='Датчики уничтожены';else if(w.ammo===0)reason='Нет боезапаса';else if(!this.arc(u,t,w))reason='Вне сектора огня';else if(sub&&!UNDERWATER_RANGES[w.name])reason='Оружие не допускает подводную стрельбу';else if(!range||range>ranges[2])reason='Вне дальности';else if(los.blocked)reason='Линия огня перекрыта';else if((sub!==targetSub&&!underwaterCover)||sub&&!UNDERWATER_RANGES[w.name])reason='Стрельба через поверхность воды запрещена';else if(u.prone&&u.config!=='Quad'&&(!u.structure.LA||!u.structure.RA))reason='Для стрельбы лёжа требуются обе сохранившиеся руки';else if(u.prone&&(
  u.config==='Quad'
   ?(!quadProneBonus&&(mechLegLocation(u,w.location)||
      w.locations?.some(loc=>mechLegLocation(u,loc))))
   :(['LL','RL'].includes(w.location)||
      w.location===(u.brace||'LA')||
      w.locations?.includes(u.brace||'LA')||
      !u.structure[u.brace||'LA'])))
  reason='Оружие недоступно лёжа';else if(opts.aim&&!Object.hasOwn(LOCATIONS,opts.aim))reason='Неизвестная прицельная локация';else if(opts.aim&&!this.isImmobile(t))reason='Прицельная стрельба только по обездвиженной цели';else if(opts.aim&&w.rack)reason='Кластерные ракеты нельзя использовать для прицельной стрельбы';else if(opts.aim&&los.cover&&partialCoverObscures(t,opts.aim,underwaterCover))reason='Локация скрыта частичным укрытием';
 const mods={gunnery:u.gunnery,attacker:{stand:0,walk:1,run:2,jump:3,evade:2}[u.moveMode]+(u.skidded?1:0),target:opts.aim==='HD'&&this.isImmobile(t)?0:this.targetMovementModifier(t),terrain:los.woods,cover:opts.aim?0:los.cover?1:0,heat:[8,13,17,24].filter(h=>u.heat>=h).length,range:range<=ranges[0]?0:range<=ranges[1]?2:4,minimum:range<=w.min?w.min-range+1:0,weapon:w.toHit||0,sensor:u.sensorHits?2:0,arm:act?(act.shoulder?4:Number(act.upper)+Number(act.lower)):0,prone:u.prone&&!quadProneBonus?2:0,targetProne:t.prone?(range===1?-2:1):0,secondary:opts.secondary?(Math.abs(this.relative(u,t,wrap(u.facing+u.twist)))<=60?1:2):0,aim:opts.aim==='HD'?3:0,night:this.weather.night?Math.max(0,2-Math.floor(t.heat/20)):0,wind:this.weather.gale?(w.rack?2:w.ammo!==null?1:0):0};const targetNumber=Object.values(mods).reduce((a,b)=>a+b,0);let chance=0;for(let a=1;a<=6;a++)for(let b=1;b<=6;b++)if(a+b>=targetNumber)chance++;return {legal:!reason,reason,range,blocked:los.blocked,cover:los.cover,underwaterCover,side:this.hitSide(t,u),mods,targetNumber,chance:reason?0:Math.round(chance/36*100)};}
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
 twist(id,value){const u=this.unit(id);const limit=u?.config==='Quad'?(u.quirks?.extendedTorsoTwist===true?1:0):(u?.quirks?.extendedTorsoTwist===true?2:1);if(this.phase!=='fire'||!this.canAct(u)||!this.mobile(u)||u.prone||!Number.isInteger(value)||Math.abs(value)>limit||(u.config==='Quad'&&limit===0))return fail('Разворот торса недоступен');u.twist=value;return {ok:true};}
 attack(id,target,indices,opts={}){return this.declareFire(id,indices.map(index=>({index,target,...opts})));}
 declareFire(id,assignments){const u=this.unit(id);if(this.phase!=='fire'||!this.canAct(u))return fail('Сейчас очередь другого отряда');const seen=new Set(),shots=[],reserved=new Map(),reservedBins=new Map();for(const a of assignments){if(seen.has(a.index))return fail('Оружие уже заявлено');seen.add(a.index);const w=u.weapons[a.index];if(!w)return fail('Оружие не найдено');if(w.ammo!==null){const pool=w.shared??a.index,n=(reserved.get(pool)||0)+1;if(n>w.ammo)return fail('Недостаточно общего боезапаса');reserved.set(pool,n);}if(a.bin!==undefined&&a.bin!==null){const b=u.bins[a.bin],n=(reservedBins.get(a.bin)||0)+1;if(!b||b.destroyed||u.dumping.includes(a.bin)||this.isBreached(u,b.location)||b.weapon!==(w.shared??a.index)||b.shots<n)return fail('Выбранный бункер недоступен');reservedBins.set(a.bin,n);}const t=this.unit(a.target);if(!t)return fail('Нет цели');const p=this.preview(id,a.target,a.index,{secondary:shots.length&&assignments[0].target!==a.target,aim:a.aim});if(!p.legal)return fail(`${u.weapons[a.index].name}: ${p.reason}`);if(a.aim&&!Object.hasOwn(LOCATIONS,a.aim))return fail('Неизвестная прицельная локация');if(a.aim&&!this.isImmobile(t))return fail('Прицельная стрельба только по обездвиженной цели');shots.push({index:a.index,target:a.target,weapon:clone(u.weapons[a.index]),preview:p,aim:a.aim||null,bin:a.bin??null,heatMode:!!a.heatMode&&w.name==='Flamer'});}this.declarations.push({id,shots});this.note(`${u.name}: заявлено ${shots.length} выстрелов. Разрешение — после всех деклараций.`);this.finish(u);return {ok:true,declared:true,shots:[]};}
 wound(u,n){for(let i=0;i<n&&!u.dead;i++){u.pilotWounds=Math.min(6,u.pilotWounds+1);if(u.pilotWounds>=6){this.destroyMech(u);this.note(`${u.name}: пилот погиб.`);break;}u.consciousChecks++;if(!this.deferConsciousness)this.consciousness(u);}}
 consciousness(u){while(u.consciousChecks>0&&!u.dead){
 // AGoAC pp.6,44: defer the throws, not the wound-specific thresholds.
 const wound=u.pilotWounds-u.consciousChecks+1;u.consciousChecks--;
 const tn=conscious[wound];if(!u.unconscious&&this.roll(u.name+' · Сознание',tn)<tn){u.unconscious=true;this.note(`${u.name}: пилот без сознания.`);}}if(u.dead)u.consciousChecks=0;}
 psr(u,modifier,reason,immediate=false,fallLevels=0,shutdownCheck=false){if(u.dead||u.prone)return true;if(!immediate){u.psrs.push({modifier,reason});return true;}this.consciousness(u);const tn=u.piloting+this.psrMod(u,reason!=='Подъём')+modifier;if(u.unconscious||u.abandoned||['LA','RA','LL','RL'].every(l=>u.structure?.[l]===0)||u.gyroHits>=2||(u.shutdown&&!shutdownCheck)||this.roll(u.name+' · '+reason,tn)<tn){this.fall(u,fallLevels,tn);return false;}return true;}
 endPSR(){// AGoAC p.6: every phase-end Consciousness Roll precedes the phase's PSRs.
 for(const u of this.units)this.consciousness(u);
 for(const u of this.units){if(u.phaseDamage>=20)u.psrs.push({modifier:1,reason:'20+ урона'});if(!u.dead&&!u.prone){const tn=u.piloting+this.psrMod(u,true)+u.psrs.reduce((s,p)=>s+p.modifier,0);for(const p of u.psrs){if(this.isImmobile(u)||u.gyroHits>=2||p.reason==='Потеря ноги'||this.roll(u.name+' · '+p.reason,tn)<tn){this.fall(u,0,tn);break;}}}u.psrs=[];u.phaseDamage=0;}}
 fall(u,levels=0,tn=null,forcedSide=null,extraDamage=0){if(u.dead||u.falling)return;u.falling=true;u.prone=true;const d=this.d6(u.name+' · Направление падения'),side=forcedSide||(d===1?'front':d===4?'rear':d<=3?'right':'left');u.facing=wrap(u.facing-(d-1));u.lastFallSide=side;const seat=(tn??u.piloting+this.psrMod(u))+Math.max(0,levels-1);if(this.isImmobile(u)||seat>12||this.roll(u.name+' · Травма при падении',seat)<seat)this.wound(u,1);this.consciousness(u);let damage=Math.ceil(u.tonnage/10)*(levels+1)+extraDamage;if(this.tile(u.q,u.r).depth)damage=Math.floor(damage/2);this.note(`${u.name} упал: ${damage} урона.`);this.packets(u,damage,side);u.falling=false;}
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
   }else if(aim&&r>=6&&r<=8)loc=aim;
   if(!aim||!obscured(loc))break;
  }
 }
 this.phaseRolls.at(-1).result=locationNameForMech(u,loc)+(obscured(loc)?' · укрытие':` · ${amount} урона`);
 if(obscured(loc))return {location:loc,hits:[],damage:0};
 return {location:loc,hits:this.damage(u,loc,amount,{rear:side==='rear',tac:table==='normal'&&(r===2&&!this.tacticalOptions?.floatingCriticals||floatingTac)}),damage:amount};
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
  u.structure[loc]=0;u.armor[loc]=0;for(const b of u.bins)if(b.location===loc){b.destroyed=true;b.shots=0;}this.syncAmmo(u);if(u.rear[loc]!==undefined)u.rear[loc]=0;u.slots[loc].forEach((s,i)=>{if(u.crit[loc][i])return;u.crit[loc][i]=true;if(s==='sink')u.sinksLost++;if(s==='jump')u.jumpLost++;});u.weapons.filter(w=>w.location===loc||w.locations?.includes(loc)).forEach(w=>w.destroyed=true);if(loc==='HD'||loc==='CT'){this.destroyMech(u);if(loc==='HD')u.pilotWounds=6;this.note(`${u.name}: ${locationNameForMech(u,loc)} уничтожен.`);}if(loc==='LT'||loc==='RT')this.destroyLocation(u,loc==='LT'?'LA':'RA');
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
 criticalHit(u,loc,destroyed=false,caseIIVenting=false){if(u.dead)return;const phaseKey=`${this.round}:${this.phase}`;if(u.criticalPhaseKey!==phaseKey){u.criticalPhaseKey=phaseKey;u.critMarkedThisPhase=[];}const newlyHit=u.critMarkedThisPhase;const r=this.roll(u.name+' · Критические повреждения'),n=r<=7?0:r<=9?1:r<=11?2:3;this.phaseRolls.at(-1).result=`Критических попаданий: ${n}`;if(!n)return;if(r===12&&['HD','LA','RA','LL','RL'].includes(loc)){if(caseIIVenting&&this.roll(u.name+' · CASE II критический шанс',8)>=8)return;if(['LA','RA'].includes(loc))this.tile(u.q,u.r).club=true;this.destroyLocation(u,loc);return;}const eligible=l=>u.slots[l].map((s,i)=>s&&s!=='case'&&s!=='case2'&&!u.crit[l][i]?i:-1).filter(i=>i>=0);let valid=eligible(loc);if(!valid.length){if(destroyed||newlyHit.includes(loc))return;while(!valid.length&&transfer[loc]&&!newlyHit.includes(loc)){loc=transfer[loc];valid=eligible(loc);}if(!valid.length)return;}for(let k=0;k<n&&!u.dead;k++){if(caseIIVenting&&this.roll(u.name+' · CASE II критический шанс',8)>=8)continue;valid=eligible(loc);if(!valid.length)break;let ix=-1,tries=0;while(!valid.includes(ix)&&tries++<60){const first=valid.some(i=>i<6),second=valid.some(i=>i>=6),block=first&&second?(this.d6('Критический слот: блок')>=4?1:0):second?1:0;ix=block*6+this.d6('Критический слот: позиция')-1;}if(!valid.includes(ix))ix=valid[0];u.crit[loc][ix]=true;newlyHit.push(loc);const s=u.slots[loc][ix];this.note(`${u.name}: ${loc}, слот ${ix+1} — ${s}.`);if(s.startsWith('ammo:'))this.explode(u,u.bins.find(b=>b.location===loc&&b.slot===ix));else if(destroyed)continue;else if(s==='engine'){u.engineHits++;if(this.effectiveEngineHits(u)>=3)this.destroyMech(u);}else if(s==='gyro'){u.gyroHits++;u.psrs.push({modifier:0,reason:'Гироскоп'});}else if(s==='sensors')u.sensorHits++;else if(s==='life')u.lifeSupport=true;else if(s==='cockpit'){u.pilotWounds=6;this.destroyMech(u);}else if(s==='sink')u.sinksLost++;else if(s==='jump')u.jumpLost++;else if(s.startsWith('w:'))u.weapons[+s.split(':')[1]].destroyed=true;else if(u.actuators[loc]){u.actuators[loc][s]=true;if(mechLegLocation(u,loc))u.psrs.push({modifier:0,reason:'Актуатор '+loc});}}}
 // AGoAC pp.6,21,30: all declared to-hit rolls and ammunition expenditure
 // precede the first hit-location roll. Keep the declaration snapshot intact.
 spendDeclaredAmmo(u,s,reserved){
  const w=s.weapon;if(w.ammo===null)return;
  const bin=s.bin!==null?u.bins[s.bin]:u.bins.find((b,ix)=>
   b.weapon===(w.shared??s.index)&&!b.destroyed&&!u.dumping.includes(ix)&&
   !this.isBreached(u,b.location)&&b.shots>(reserved.get(ix)||0));
  if(s.bin!==null)reserved.set(s.bin,Math.max(0,(reserved.get(s.bin)||0)-1));
  if(bin&&bin.shots>0)bin.shots--;
  this.syncAmmo(u);
 }
 rollDeclaredFire(d){
  const u=this.unit(d.id),reserved=new Map(),groups=new Map();
  for(const s of d.shots)if(s.bin!==null&&s.weapon.ammo!==null)
   reserved.set(s.bin,(reserved.get(s.bin)||0)+1);
  for(const s of d.shots){
   const w=s.weapon,p=s.preview;
   const roll=this.roll(u.name+' · '+w.name,p.targetNumber);
   const attackRoll=this.phaseRolls.at(-1);
   u.pendingHeat+=w.heat;
   u.firedLocations.push(...(w.locations?.length?w.locations:[w.location]));
   this.spendDeclaredAmmo(u,s,reserved);
   if(!groups.has(s.target))groups.set(s.target,[]);
   groups.get(s.target).push({u,s,roll,attackRoll,hit:roll>=p.targetNumber});
  }
  // Preserve controller-declared target order and group that Mech's attacks
  // against each target before moving to the next (p.21).
  return [...groups.values()].flat();
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
  const t=this.unit(s.target),w=s.weapon,p=s.preview,start=this.phaseRolls.length;
  if(hit&&s.heatMode)this.applyExternalHeat(t,2);
  let damage=0,location=null;const hits=[];
  for(const amount of this.fireAmounts(s,hit)){
   if(t.dead)break;
   const out=this.hit(t,amount,p.side,'normal',s.aim,p.cover,p.underwaterCover);
   damage+=out.damage;location=out.location;hits.push(...out.hits);
   if(p.side==='rear'&&['LT','CT','RT'].includes(location)&&t.dumping.length)
    for(const index of [...t.dumping])this.explode(t,t.bins[index]);
  }
  this.resolution.push({id:u.id,target:t.id,ok:true,shots:[{
   weapon:w.name,index:s.index,hit,roll,targetNumber:p.targetNumber,damage,location,hits,
   rolls:[attackRoll,...this.phaseRolls.slice(start)]}]});
  this.note(u.name+' → '+t.name+' '+w.name+': '+roll+'/'+p.targetNumber+'+ — '+damage+' урона.');
 }
 resolveFire(){
  this.phaseRolls=[];this.resolution=[];this.deferConsciousness=true;
  try{
   const attacks=this.declarations.flatMap(d=>this.rollDeclaredFire(d));
   for(const attack of attacks)this.resolveRolledFire(attack);
  }finally{this.deferConsciousness=false;}
  const start=this.phaseRolls.length;this.endPSR();
  this.afterRolls=this.phaseRolls.slice(start);this.declarations=[];
  this.removeDestroyedMechs();return this.resolution;
 }
 physicalPreview(id,target,type='kick',limb='RL'){const u=this.unit(id),t=this.unit(target);if(!u||!t)return {legal:false,reason:'Выберите цель',targetNumber:99};
 // Quad front limbs are legs, not arms. Punches, pushes, clubs and
 // hand-held physical weapon attacks require actual biped arms.
 if(u.config==='Quad'&&['punch','push','club','hatchet'].includes(type))
  return {legal:false,reason:'У четырёхногого меха нет рук для этой атаки',targetNumber:99};
 if(type==='punch'&&limb==='both'){const a=this.physicalPreview(id,target,type,'LA'),b=this.physicalPreview(id,target,type,'RA');return {...a,legal:a.legal&&b.legal,reason:a.reason||b.reason,damage:a.damage+b.damage,targetNumber:Math.max(a.targetNumber,b.targetNumber)};}const attackerTile=this.tile(u.q,u.r),targetTile=this.tile(t.q,t.r),attackerSub=attackerTile.depth>=(u.prone?1:2),targetSub=targetTile.depth>=(t.prone?1:2),attackerWaterline=attackerTile.depth===1&&!u.prone,targetWaterline=targetTile.depth===1&&!t.prone,range=distance(u,t),dh=targetTile.height-attackerTile.height,side=this.hitSide(t,u),a=this.relative(u,t),act=u.actuators[limb]||{};let reason='',mod=0,damage=0,table='normal';if(!this.mobile(u)||u.prone||u.team===t.team||t.dead||u.charge||t.airborne||u.moveMode==='evade')reason='Атака недоступна';else if(range!==1&&!(range===0&&t.prone))reason='Нужна соседняя цель';else if(Math.abs(dh)>1)reason='Разница высот слишком велика';else if(attackerSub&&!targetSub&&!targetWaterline||targetSub&&!attackerSub&&!attackerWaterline)reason='Атака через поверхность воды запрещена';else if(attackerWaterline&&targetSub&&type!=='kick')reason='По погружённой цели с глубины 1 допустим только удар ногой';let arm=limb==='LA'||limb==='RA';if(type==='punch'){mod=Number(act.upper)*2+Number(act.lower)*2+Number(act.hand);damage=Math.max(1,Math.floor(Math.ceil(u.tonnage/10)/2**(Number(act.upper)+Number(act.lower))));table='punch';if(!arm||!u.structure[limb]||act.shoulder||u.firedLocations.includes(limb)||t.prone&&dh<=0||Math.abs(a)>120||limb==='LA'&&a< -60||limb==='RA'&&a>60)reason='Рука/цель недоступна для удара';if(dh===1)table='kick';}else if(type==='kick'){
 mod=-2+2*Number(act.upper)+2*Number(act.lower)+Number(act.foot);
 damage=Math.max(1,Math.floor(u.tonnage/5/2**(Number(act.upper)+Number(act.lower))));
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
 }else if(arm||!u.structure.LL||!u.structure.RL||u.actuators.LL.hip||
  u.actuators.RL.hip||u.firedLocations.includes(limb)||Math.abs(a)>60||dh===1)
  reason='Нога/цель недоступна для удара';
 if(dh===-1&&!t.prone)table='punch';
}else if(type==='hatchet'){damage=Math.ceil(u.tonnage/5);mod=-1+2*Number(act.upper)+2*Number(act.lower)+Number(act.hand);if(!arm||!u.hatchets?.some(h=>h.location===limb)||u.slots[limb].some((s,i)=>s==='hatchet'&&u.crit[limb][i])||!u.structure[limb]||act.shoulder||act.lower||u.firedLocations.includes(limb)||Math.abs(a)>60)reason='Топор или рука недоступны';damage=Math.max(1,Math.floor(damage/2**Number(act.upper)));}else if(type==='push'){mod=-1+2*Number(u.actuators.LA.shoulder)+2*Number(u.actuators.RA.shoulder);if(!u.structure.LA||!u.structure.RA||u.firedLocations.some(l=>['LA','RA'].includes(l))||Math.abs(a)>30||dh||t.prone)reason='Толчок требует двух рук и цель прямо перед мехом';}else if(type==='club'){mod=-1;damage=Math.ceil(u.tonnage/5);if(!u.club||!u.structure.LA||!u.structure.RA||['LA','RA'].some(l=>Object.values(u.actuators[l]).some(Boolean))||u.firedLocations.some(l=>['LA','RA'].includes(l))||Math.abs(a)>60)reason='Нужна дубина и две свободные исправные руки';}else return {legal:false,reason:'Неизвестная атака',targetNumber:99};const affectedLimbs=['club','push'].includes(type)?['LA','RA']:['punch','kick','hatchet'].includes(type)?[limb]:[];if(affectedLimbs.some(l=>this.isBreached(u,l)))reason='Затопленная конечность не может атаковать';const underwaterPhysical=attackerSub&&targetSub||(attackerWaterline&&type==='kick'&&(targetSub||targetWaterline));if(underwaterPhysical)damage=Math.floor(damage/2);// BMM pp.26,28,35: standing Quad in Depth 1 always has physical partial cover.
 // At equal LOS height only non-Kick-table leg hits are absorbed.
 // Charges resolve separately and are explicitly exempt from leg protection.
 const quadWaterCover=t.config==='Quad'&&targetWaterline;
 const physicalCover=quadWaterCover&&attackerTile.height+(u.prone?1:2)===targetTile.height+(t.prone?1:2)&&table!=='kick';
 const targetNumber=u.piloting+mod+({stand:0,walk:1,run:2,jump:3,evade:2}[u.moveMode])+(u.skidded?1:0)+this.targetMovementModifier(t)+this.los(u,t).woods+(t.prone?-2:0)+(quadWaterCover?1:0);
 return {legal:!reason,reason,targetNumber,damage,underwaterPhysical,table,side,physicalCover};}
 declarePhysical(id,target,type,limb){const u=this.unit(id);if(this.phase!=='physical'||!this.canAct(u))return fail('Сейчас очередь другого отряда');const limbs=type==='punch'&&limb==='both'?['LA','RA']:[limb],pending=[];for(const l of limbs){const p=this.physicalPreview(id,target,type,l);if(!p.legal)return fail(p.reason);pending.push({id,target,type,limb:l,...p});}this.physicalDeclarations.push(...pending);this.finish(u);return {ok:true,declared:true};}
 takeClub(id){const u=this.unit(id),t=this.tile(u.q,u.r);if(u.config==='Quad'||this.phase!=='physical'||!this.canAct(u)||!this.mobile(u)||(!['woods','heavy'].includes(t.type)&&!t.club)||['LA','RA'].some(l=>!u.structure[l]||Object.values(u.actuators[l]).some(Boolean)))return fail('Нужны две исправные руки и дерево/оторванная рука в гексе');u.club=true;this.finish(u);return {ok:true};}
 displace(u,dir,depth=0){if(u.dead||depth>this.units.length+1)return false;const d=DIRS[dir],t=this.tile(u.q+d[0],u.r+d[1]);if(!t){u.dead=true;u.escaped=true;this.note(`${u.name} вытеснен за край карты.`);return true;}const old=this.tile(u.q,u.r);if(t.height-old.height>2)return false;const occ=this.units.find(v=>!v.dead&&v.id!==u.id&&v.q===t.q&&v.r===t.r);if(occ){if(!this.displace(occ,dir,depth+1)){occ.dead=true;}else this.psr(occ,0,'Домино',true);}u.q=t.q;u.r=t.r;if(old.height-t.height>=2)this.fall(u,old.height-t.height);return true;}
 resolvePhysical(){this.phaseRolls=[];this.resolution=[];this.deferConsciousness=true;try{for(const u of this.units)if(u.charge)this.resolveSpecial(u);for(const d of this.physicalDeclarations){const u=this.unit(d.id),t=this.unit(d.target),start=this.phaseRolls.length,roll=this.roll(u.name+' · '+d.type,d.targetNumber),hit=roll>=d.targetNumber;let damage=0;if(hit&&!t.dead){if(d.type==='push'){const old={q:t.q,r:t.r};if(this.displace(t,u.facing)){u.q=old.q;u.r=old.r;}this.psr(t,0,'Толчок');}else{const o=this.hit(t,d.damage,d.side,d.table,null,!!d.physicalCover);damage=o.damage;if(d.type==='kick')this.psr(t,0,'Удар ногой');if(d.type==='club')u.club=false;}}else if(d.type==='kick')this.psr(u,0,'Промах ногой');this.resolution.push({id:d.id,target:d.target,ok:true,shots:[{weapon:d.type,hit,roll,targetNumber:d.targetNumber,damage,rolls:this.phaseRolls.slice(start)}]});this.note(`${u.name}: ${d.type}, ${roll}/${d.targetNumber}+, ${damage} урона.`);}}finally{this.deferConsciousness=false;}const start=this.phaseRolls.length;this.endPSR();this.afterRolls=this.phaseRolls.slice(start);this.physicalDeclarations=[];this.removeDestroyedMechs();return this.resolution;}
 // AGoAC p.38: only a conscious pilot may override thermal shutdown.
 // Below 14 heat an involuntarily shut-down reactor restarts automatically,
 // even if the pilot is still unconscious. Voluntary shutdown is separate.
 heatRequiresShutdown(u,tn,was){
  if(tn===0)return false;
  if(tn===99||u.unconscious||u.abandoned)return true;
  return this.roll(u.name+' · '+(was?'Перезапуск':'Реактор'),tn)<tn;
 }
 heatPhase(){this.phaseRolls=[];for(const u of this.units){if(u.dead)continue;const t=this.tile(u.q,u.r),sinks=Math.max(0,u.sinks-u.sinksLost-this.floodedSlots(u,'sink')),sub=t.depth>=(u.prone?1:2),legSinks=Object.keys(u.slots).filter(l=>mechLegLocation(u,l)).reduce((n,l)=>n+u.slots[l].filter((s,i)=>s==='sink'&&!u.crit[l][i]&&!this.isBreached(u,l)).length,0),cool=sinks+Math.min(6,sub?sinks:t.depth?legSinks:0),was=u.shutdown;u.heat=Math.max(0,u.heat+u.pendingHeat+(was?0:this.effectiveEngineHits(u)*5)-cool);u.pendingHeat=0;u.externalHeat=0;const tn=shut(u.heat);if(u.voluntaryShutdown){u.shutdown=true;}else{u.shutdown=this.heatRequiresShutdown(u,tn,was);if(!was&&u.shutdown)this.psr(u,3,'Отключение реактора',true,0,true);}if(u.heat>=19){const bins=u.bins.filter(b=>b.shots&&!b.destroyed);if(bins.length){const at=u.heat>=28?8:u.heat>=23?6:4;if(this.roll(u.name+' · Перегрев боезапаса',at)<at){bins.sort((a,b)=>{const wa=u.weapons[a.weapon],wb=u.weapons[b.weapon];return wb.damage*(wb.rack||1)-wa.damage*(wa.rack||1)||b.shots-a.shots;});this.explode(u,bins[0]);}}}if(u.lifeSupport&&u.heat>=15)this.wound(u,u.heat>=26?2:1);this.consciousness(u);}this.endPSR();this.removeDestroyedMechs();}
 endPhase(){this.phaseRolls=[];for(const u of this.units){if(u.dead)continue;if(u.lifeSupport&&this.tile(u.q,u.r).depth>=(u.prone?1:2))this.wound(u,1);this.consciousness(u);if(u.dead)continue;if(u.unconscious&&u.wasUnconscious&&this.roll(u.name+' · Пробуждение',conscious[u.pilotWounds])>=conscious[u.pilotWounds])u.unconscious=false;for(const i of u.dumping){const b=u.bins[i];if(b)b.shots=0;}u.dumping=u.dumpNext;u.dumpNext=[];this.syncAmmo(u);if(u.shutdownNext){u.shutdownNext=false;if(!u.shutdown){u.shutdown=true;u.voluntaryShutdown=true;this.note(`${u.name}: добровольное отключение реактора.`);}else if(u.voluntaryShutdown){const tn=shut(u.heat);if(tn!==99&&(tn===0||this.roll(u.name+' · Добровольный перезапуск',tn)>=tn)){u.shutdown=false;u.voluntaryShutdown=false;this.note(`${u.name}: реактор перезапущен.`);}else this.note(`${u.name}: перезапуск не удался.`);}}u.wasUnconscious=u.unconscious;u.proneAtStart=u.prone;u.moveStart={q:u.q,r:u.r};u.moved=false;u.fired=false;u.physicalDone=false;u.spent=0;u.moveMode='stand';u.distanceMoved=0;u.skidded=false;u.skidDirection=null;u.lastMovementDirection=null;u.skidCollisionPending=null;u.twist=0;u.flip=false;u.firedLocations=[];u.standAttempts=0;u.moveEndedByLegLoss=false;u.charge=null;}this.removeDestroyedMechs();this.round++;}
 nextPhase(){if(this.winner!==null)return fail('Бой окончен');if(['move','fire','physical'].includes(this.phase)&&this.queue.length)return fail('Сначала завершите приказы всех мехов');this.phaseRolls=[];this.resolution=[];this.afterRolls=[];if(this.phase==='initiative'){this.initiative();return {ok:true};}if(this.phase==='move'){this.removeDestroyedMechs();this.phase='fire';this.buildQueue();}else if(this.phase==='fire'){this.resolveFire();this.checkWin();if(this.winner===null){this.phase='physical';this.buildQueue();}}else if(this.phase==='physical'){this.resolvePhysical();this.checkWin();this.phase='heat';this.activeTeam=null;}else if(this.phase==='heat'){this.heatPhase();this.checkWin();this.phase='end';}else{this.endPhase();this.checkWin();this.phase='initiative';}this.note(`Раунд ${this.round}: ${PHASES[this.phase]}.`);return {ok:true};}
 aiMove(id){const u=this.unit(id);if(!this.canAct(u))return fail('Не очередь ИИ');if(this.isImmobile(u))return this.hold(id);if(u.prone){const s=this.stand(id);if(!s.ok||u.prone)return this.hold(id);}const options=['walk','run',...(this.mp(u,'jump')?['jump']:[])].flatMap(m=>this.reachable(u,m).map(p=>({...p,mode:m})));let best=null,score=-Infinity;const enemies=this.units.filter(t=>t.team!==u.team&&!t.dead);for(const p of options){const old={q:u.q,r:u.r,facing:u.facing};u.q=p.q;u.r=p.r;u.facing=p.facing;let value=-Infinity;for(const t of enemies){let v=u.weapons.reduce((n,w,i)=>n+this.preview(id,t.id,i).chance*(w.rack?w.rack*.6*w.damage:w.damage)/100,0)-Math.abs(distance(u,t)-5)*.5;if(p.mode==='jump')v-=1;value=Math.max(value,v);}Object.assign(u,old);if(value>score){score=value;best=p;}}const r=best?this.move(id,best.q,best.r,best.mode):{ok:true};this.hold(id);return r;}
 aiAttack(id){const u=this.unit(id);if(!this.canAct(u)||!this.mobile(u)||u.moveMode==='evade')return this.hold(id);let best=null;for(const twist of (u.config==='Quad'?(u.quirks?.extendedTorsoTwist===true?[-1,0,1]:[0]):(u.quirks?.extendedTorsoTwist===true?[-2,-1,0,1,2]:[-1,0,1]))){if(u.prone&&twist)continue;u.twist=twist;for(const t of this.units.filter(x=>x.team!==u.team&&!x.dead)){let indices=[],heat=u.heat+u.pendingHeat-u.sinks+u.sinksLost;for(let i=0;i<u.weapons.length;i++){const p=this.preview(id,t.id,i),w=u.weapons[i];if(p.legal&&p.chance>=17&&heat+w.heat<18){indices.push(i);heat+=w.heat;}}const score=indices.reduce((s,i)=>s+this.preview(id,t.id,i).chance*(u.weapons[i].rack||u.weapons[i].damage),0);if(!best||score>best.score)best={target:t.id,indices,twist,score};}}u.twist=best?.twist??0;return best?.indices.length?this.attack(id,best.target,best.indices):this.hold(id);}
 aiPhysical(id){const u=this.unit(id);if(u?.moveMode==='evade')return this.hold(id);if(u.charge)return this.hold(id);let best=null;for(const t of this.units.filter(t=>t.team!==u.team&&!t.dead))for(const [type,limb]of (u.config==='Quad'?[['kick','LA'],['kick','RA'],['kick','LL'],['kick','RL']]:[['kick','RL'],['kick','LL'],['punch','RA'],['punch','LA'],['club','RA'],['push','RA']])){const p=this.physicalPreview(id,t.id,type,limb);if(p.legal&&(!best||p.damage-p.targetNumber>best.score))best={target:t.id,type,limb,score:p.damage-p.targetNumber};}return best?this.declarePhysical(id,best.target,best.type,best.limb):this.hold(id);}
 minimumMove(id){const u=this.unit(id);if(!this.canAct(u)||u.spent||u.prone||this.isImmobile(u)||this.mp(u)<1)return fail('Минимальный шаг недоступен');const d=DIRS[u.facing],t=this.tile(u.q+d[0],u.r+d[1]);if(!t||this.occupied(t.q,t.r,id)||Math.abs(t.height-this.tile(u.q,u.r).height)>2)return fail('Впереди препятствие');u.q=t.q;u.r=t.r;u.spent=Math.max(1,this.mp(u,'run'));u.moveMode='run';u.distanceMoved=1;if(t.depth||t.type==='rubble')this.psr(u,t.depth>=3?1:t.depth===1?-1:0,'Минимальное движение',true);return this.hold(id);}
 flipArms(id,on){const u=this.unit(id);if(this.phase!=='fire'||!this.canAct(u)||!this.mobile(u)||u.prone)return fail('Переворот рук недоступен');if(on&&(u.config==='Quad'||['LA','RA'].some(l=>u.slots[l][2]==='lower'||u.slots[l][3]==='hand')))return fail('Нужны руки без нижних и кистевых актуаторов');u.flip=on;u.twist=0;return {ok:true};}
 setBrace(id,limb){const u=this.unit(id);if(this.phase!=='fire'||!this.canAct(u)||!this.mobile(u)||!['LA','RA'].includes(limb))return fail('Нельзя выбрать опорную руку');u.brace=limb;return {ok:true};}
 orderDump(id,index){const u=this.unit(id);if(!this.canAct(u)||!this.mobile(u)||this.phase!=='move'||u.moveMode==='run'||u.moveMode==='jump')return fail('Сброс боезапаса: только ходьба или неподвижность');if(!u.bins[index]?.shots)return fail('Бункер пуст');if(!u.dumpNext.includes(index))u.dumpNext.push(index);this.note(`${u.name}: сброс бункера ${index+1} начнётся в конце хода; завершится через ход.`);return {ok:true};}
 orderShutdown(id){const u=this.unit(id);if(!this.canAct(u)||u.unconscious||u.abandoned||this.phase!=='move')return fail('Приказ недоступен');if(u.shutdown&&!u.voluntaryShutdown)return fail('После аварийного отключения перезапуск происходит в фазу нагрева');u.shutdownNext=!u.shutdownNext;return {ok:true};}
 declareCharge(id,target,type='charge',moveMode='run'){const u=this.unit(id),t=this.unit(target);if(this.phase!=='move'||!this.canAct(u)||!this.mobile(u)||u.prone||!t||t.team===u.team||t.dead||t.prone||!(t.moved||!this.mobile(t)))return fail('Цель должна завершить движение и стоять');if(this.units.some(v=>v.charge?.target===target))return fail('Эта цель уже выбрана для тарана/DFA');if(!['charge','dfa'].includes(type)||type==='charge'&&!['walk','run'].includes(moveMode))return fail('Недопустимый тип тарана или режим движения');const mode=type==='dfa'?'jump':moveMode;if(u.spent||u.moveMode!=='stand')return fail('Заявите таран/DFA до обычного движения');let options=this.reachable(u,mode).filter(p=>distance(p,t)===1);if(type==='dfa'){if(!this.mp(u,'jump')||distance(u,t)>this.mp(u,'jump')||this.tile(t.q,t.r).height+2>this.tile(u.q,u.r).height+this.mp(u,'jump'))return fail('Не хватает высоты или дальности прыжка');}else options=options.filter(p=>p.cost+this.terrainCost(this.tile(t.q,t.r))+Math.abs(this.tile(p.q,p.r).height-this.tile(t.q,t.r).height)<=this.mp(u,mode));
 options.sort((a,b)=>a.cost-b.cost);const p=options[0];if(!p)return fail('Нет допустимого подхода к цели');const start={q:u.q,r:u.r},r=this.move(id,p.q,p.r,mode);if(!r.ok)return r;const d=DIRS.findIndex(d=>p.q+d[0]===t.q&&p.r+d[1]===t.r);u.facing=d;u.charge={target,type,dir:d,hexes:type==='dfa'?distance(start,u):chargeTravelHexes(start,p.path),targetPos:{q:t.q,r:t.r}};if(type==='dfa'){u.pendingHeat-=Math.max(3,u.spent);u.spent=distance(start,t);u.pendingHeat+=Math.max(3,u.spent);u.airborne=true;}this.note(`${u.name}: заявлен ${type==='dfa'?'DFA':'таран'} против ${t.name}.`);this.hold(id);return r;}
 resolveSpecial(u){const s=u.charge,t=this.unit(s.target);if(!t||u.dead)return;if(t.dead||t.q!==s.targetPos.q||t.r!==s.targetPos.r||t.prone&&s.type==='charge'){u.airborne=false;this.note(`${u.name}: специальная атака отменена — цель изменилась.`);return;}const start=this.phaseRolls.length,dfa=s.type==='dfa',tn=Math.max(2,u.piloting+(u.piloting-t.piloting)+(dfa?3:u.moveMode==='run'?2:1)+(this.isImmobile(t)?-4:this.tmm(t))+(dfa?0:this.los(u,t).woods)),roll=this.roll(u.name+' · '+(dfa?'DFA':'Таран'),tn),hit=!u.prone&&roll>=tn;const old={q:t.q,r:t.r},side=this.hitSide(t,u);let damage=0;u.airborne=false;
 if(hit){damage=dfa?Math.ceil(u.tonnage/10*3):Math.ceil(u.tonnage/10*s.hexes);this.packets(t,damage,dfa&&t.prone?'rear':side,dfa&&!t.prone?'punch':'normal');this.packets(u,dfa?u.tonnage/5:Math.ceil(t.tonnage/10),'front',dfa?'kick':'normal');if(!t.dead&&!this.displace(t,s.dir))t.dead=true;if(!u.dead){u.q=old.q;u.r=old.r;this.psr(u,dfa?4:2,dfa?'Посадка DFA':'Таран');}this.psr(t,2,dfa?'Попадание DFA':'Попадание тарана');}else if(dfa){const dirs=[s.dir,wrap(s.dir+1),wrap(s.dir-1),wrap(s.dir+2),wrap(s.dir-2),wrap(s.dir+3)];const d=dirs.find(d=>{const v=DIRS[d],x=this.tile(t.q+v[0],t.r+v[1]);return x&&!this.occupied(x.q,x.r,t.id)&&x.height-this.tile(t.q,t.r).height<=2;});if(d===undefined)u.dead=true;else{this.displace(t,d);u.q=old.q;u.r=old.r;this.fall(u,2,null,'rear');}}else{const d=[wrap(s.dir+1),wrap(s.dir-1)].find(d=>{const v=DIRS[d];return this.tile(u.q+v[0],u.r+v[1])&&!this.occupied(u.q+v[0],u.r+v[1],u.id);});if(d!==undefined){u.q+=DIRS[d][0];u.r+=DIRS[d][1];}}
 this.resolution.push({id:u.id,target:t.id,ok:true,shots:[{weapon:dfa?'DFA':'Таран',hit,roll,targetNumber:tn,damage,rolls:this.phaseRolls.slice(start)}]});}

}
