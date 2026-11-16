import {WEAPON_SPECS,WEAPON_NAMES} from './equipment.js';
export const LOCS=['HD','CT','LT','RT','LA','RA','LL','RL'];
// BMM corrected sixth printing, printed p.5: the generic "Mech" term includes
// both biped and quad BattleMechs. Classification is not proof of quad support.
export const BATTLEMECH_CONFIGURATIONS=Object.freeze(['Biped','Quad']);
export const isBattleMechConfiguration=config=>
  BATTLEMECH_CONFIGURATIONS.includes(config);
const masses=[.5,.5,1,1,1,1,1.5,1.5,1.5,2,2,2,2.5,2.5,3,3,3,3.5,3.5,4,4,4,4.5,4.5,5,5,5.5,5.5,6,6,6,7,7,7.5,7.5,8,8.5,8.5,9,9.5,10,10,10.5,11,11.5,12,12.5,13,13.5,14,14.5,15.5,16,16.5,17.5,18,19,19.5,20.5,21.5,22.5,23.5,24.5,25.5,27,28.5,29.5,31.5,33,34.5,36.5,38.5,41,43.5,46,49,52.5];
const structures=[[6,5,3,4],[8,6,4,6],[10,7,5,7],[11,8,6,8],[12,10,6,10],[14,11,7,11],[16,12,8,12],[18,13,9,13],[20,14,10,14],[21,15,10,15],[22,15,11,15],[23,16,12,16],[25,17,13,17],[27,18,14,18],[29,19,15,19],[30,20,16,20],[31,21,17,21]];
// Stats, equipment weight and critical-slot usage share the market's
// implemented component registry instead of maintaining a parallel table.
const data=Object.fromEntries(Object.entries(WEAPON_SPECS).map(([name,w])=>[
  name,[w.heat,w.damage,w.minimum,...w.ranges,w.tons,w.slots,
    w.roundsPerTon,w.rack,w.accuracyModifier||0]
]));
// BMM 2022, printed pp.5 and 33: a quad's "arms" on the biped
// hit-location sheet are *front legs*, not biped weapon arms.
// Keep the legacy storage keys LA/RA/LL/RL until a full quad record-sheet
// migration; do not grant quad combat eligibility merely for having a layout.
export const QUAD_LEG_LOCATIONS=Object.freeze({
 LA:'Left Front Leg',RA:'Right Front Leg',
 LL:'Left Rear Leg',RL:'Right Rear Leg'
});
export function quadStructuralLayout(tonnage){
 if(!Number.isInteger(tonnage)||tonnage<20||tonnage>100||tonnage%5)
  throw new RangeError('quad_tonnage_must_be_20_to_100_in_steps_of_5');
 const [center,side,,leg]=structures[(tonnage-20)/5];
 const structure={HD:3,CT:center,LT:side,RT:side,LA:leg,RA:leg,LL:leg,RL:leg};
 const slots={
  HD:['life','sensors','cockpit',null,'sensors','life'],
  CT:['engine','engine','engine','gyro','gyro','gyro','gyro','engine','engine','engine',null,null],
  LT:Array(12).fill(null),RT:Array(12).fill(null)
 };
 for(const loc of Object.keys(QUAD_LEG_LOCATIONS))
  slots[loc]=['hip','upper','lower','foot',null,null];
 return {config:'Quad',structure,slots,legLocations:{...QUAD_LEG_LOCATIONS}};
}
export const EQUIPMENT=WEAPON_NAMES;
export function construct(c,{auditQuad=false}={}){
 const errors=[],techBase=c.techBase??'Inner Sphere',ton=+c.tonnage,walk=+c.walk,jump=+c.jump,sinks=+c.sinks,rating=ton*walk;
 const chassisConfig=c.config??'Biped';
 if(!isBattleMechConfiguration(chassisConfig))
   errors.push('Конфигурация не является двуногим или четырёхногим BattleMech.');
 else if(chassisConfig==='Quad'&&!auditQuad)
   errors.push('Четырёхногие BattleMech пока не поддерживаются: нельзя применять правила двуногого меха.');
 if(techBase!=='Inner Sphere'&&techBase!=='IS')errors.push('Клановая технология ещё не поддерживается конструктором; сначала реализуйте её массы, критические слоты и ограничения.');
 if(!Number.isInteger(ton)||ton<20||ton>100||ton%5)errors.push('Масса: 20–100 тонн с шагом 5.');
 if(!Number.isInteger(walk)||walk<1||rating<20||rating>400||rating%5)errors.push('Рейтинг двигателя: 20–400.');
 if(!Number.isInteger(jump)||jump<0||jump>walk)errors.push('Прыжок: от 0 до значения ходьбы.');
 if(!Number.isInteger(sinks)||sinks<10)errors.push('Нужно не менее 10 теплоотводов.');
 // Preserve a correct but non-combat-ready quad plan for the audit and
 // construction tests. Quad imports and hangar admission still fail closed.
 if(errors.length)return {errors,...(chassisConfig==='Quad'&&Number.isInteger(ton)&&ton>=20&&ton<=100&&ton%5===0?
  {quadLayout:quadStructuralLayout(ton)}:{})};
 const quadLayout=chassisConfig==='Quad'?quadStructuralLayout(ton):null;
 const st=structures[(ton-20)/5],structure=quadLayout?quadLayout.structure:
  Object.fromEntries(LOCS.map((l,i)=>[l,[3,st[0],st[1],st[1],st[2],st[2],st[3],st[3]][i]]));
 const armor={},rear={};for(const l of LOCS){armor[l]=Number(c.armor?.[l]??0);if(!Number.isInteger(armor[l])||armor[l]<0)errors.push(l+': броня должна быть целой и неотрицательной.');if(['CT','LT','RT'].includes(l)){rear[l]=Number(c.rear?.[l]??0);if(!Number.isInteger(rear[l])||rear[l]<0)errors.push(l+': кормовая броня должна быть целой и неотрицательной.');}if(armor[l]+(rear[l]||0)>(l==='HD'?9:2*structure[l]))errors.push(l+': превышен предел брони.');}
 const slots=quadLayout?quadLayout.slots:{HD:['life','sensors','cockpit',null,'sensors','life'],CT:['engine','engine','engine','gyro','gyro','gyro','gyro','engine','engine','engine',null,null],LT:Array(12).fill(null),RT:Array(12).fill(null),LA:['shoulder','upper','lower','hand',...Array(8).fill(null)],RA:['shoulder','upper','lower','hand',...Array(8).fill(null)],LL:['hip','upper','lower','foot',null,null],RL:['hip','upper','lower','foot',null,null]};
 if(quadLayout&&c.removeActuators?.length)
  errors.push('Quad leg actuators must not be removed through biped arm settings.');
 else for(const l of ['LA','RA'])if(c.removeActuators?.includes(l)){slots[l][2]=null;slots[l][3]=null;}
 const weights={structure:ton/10,engine:masses[(rating-20)/5],gyro:Math.ceil(rating/100),cockpit:3,sinks:sinks-10,case:0,armor:Math.ceil([...Object.values(armor),...Object.values(rear)].reduce((a,b)=>a+b,0)/8)/2,jump:jump*(ton<=55?.5:ton<=85?1:2),weapons:0,ammo:0};
 const weapons=[],bins=[],hatchets=[];let extSinks=0,jets=0;
 function place(l,start,n,value){const a=slots[l],i=Number(start)-1;if(!a||!Number.isInteger(i)||i<0||i+n>a.length||a.slice(i,i+n).some(Boolean)){errors.push(`${l} ${start}: ${n} слот(а) заняты или вне секции.`);return false;}for(let k=0;k<n;k++)a[i+k]=value;return true;}
 for(const e of c.equipment||[]){const l=e.location;
 if(e.type==='hatchet'){const n=Math.ceil(ton/15);weights.weapons+=n;if(quadLayout||!['LA','RA'].includes(l)||slots[l]?.[2]!=='lower')errors.push('Топор требует руки двуногого меха с нижним актуатором.');else if(place(l,e.slot,n,'hatchet'))hatchets.push({location:l,slots:n});}
 else if(e.type==='jump'){jets++;
  if(!['CT','LT','RT','LL','RL',...(quadLayout?['LA','RA']:[])].includes(l))
   errors.push('Прыжковые двигатели: только торс/ноги.');
  place(l,e.slot,1,'jump');}
 else if(e.type==='sink'){extSinks++;place(l,e.slot,1,'sink');}
 else if(e.type==='case'){if(!['CT','LT','RT'].includes(l)){errors.push('CASE: только торс Внутренней Сферы.');continue;}if(slots[l].some(s=>s==='case'||s==='case2')){errors.push('CASE: не более одной системы на секцию '+l+'.');continue;}if(place(l,e.slot,1,'case'))weights.case+=0.5;}
 else if(e.type==='case2'){if(slots[l].some(s=>s==='case'||s==='case2')){errors.push('CASE II: не более одной CASE в секции '+l+'.');continue;}if(place(l,e.slot,1,'case2'))weights.case+=1;}
 else if(e.type==='ammo'){const w=weapons[e.weapon],d=w&&data[w.name],mass=Number(e.mass??1);if(!d?.[8]){errors.push('Боезапас должен ссылаться на уже добавленное оружие.');continue;}if(mass!==1&&!(w.name==='Machine Gun'&&mass===.5))errors.push('Бункер: 1 т, для пулемёта также 0,5 т.');weights.ammo+=mass;const shots=d[8]*mass;if(place(l,e.slot,1,`ammo:${e.weapon}:${shots}`))bins.push({location:l,slot:+e.slot-1,weapon:+e.weapon,shots,destroyed:false});}
 else{const d=data[e.type];if(!d){errors.push('Неизвестное оборудование: '+e.type);continue;}const index=weapons.length;weights.weapons+=d[6];weapons.push({name:e.type,heat:d[0],damage:d[1],min:d[2],ranges:d.slice(3,6),ammo:d[8]?0:null,location:l,rack:d[9],toHit:d[10]||0,rear:!!e.rear,destroyed:false});if(e.splitLocation){const n=Number(e.splitCount),pairs={LA:['LT'],RA:['RT'],LT:['LA','CT'],RT:['RA','CT'],CT:['LT','RT']};if(quadLayout&&([l,e.splitLocation].some(loc=>Object.hasOwn(QUAD_LEG_LOCATIONS,loc))))
 errors.push(`${e.type}: Quad leg cannot split critical slots with torso like a biped arm.`);
 else if(d[7]<8||!Number.isInteger(n)||n<1||n>=d[7]||!pairs[l]?.includes(e.splitLocation))errors.push(`${e.type}: разделение требует 8+ критических слотов и двух соседних секций торса/рук (не ног).`);else{weapons[index].locations=[l,e.splitLocation];place(l,e.slot,n,`w:${index}`);place(e.splitLocation,e.splitSlot,d[7]-n,`w:${index}`);}}else place(l,e.slot,d[7],`w:${index}`);}
 }
 if(jets!==jump)errors.push(`Разместите ${jump} прыжковых двигателей; размещено ${jets}.`);
 const needed=Math.max(0,sinks-Math.floor(rating/25));if(extSinks!==needed)errors.push(`Разместите ${needed} внешних теплоотводов; размещено ${extSinks}.`);
 // Equal weapon types may draw from the same ammunition pool; MegaMek
 // variants commonly share one bin between several autocannons or launchers.
 const pools=new Map();
 for(let i=0;i<weapons.length;i++){
   const w=weapons[i];
   if(w.ammo===null)continue;
   if(!pools.has(w.name))pools.set(w.name,i);
   w.shared=pools.get(w.name);
 }
 for(const bin of bins){
   const master=weapons[bin.weapon]?.shared;
   if(master!==undefined)bin.weapon=master;
 }
 weapons.forEach(w=>{
   if(w.ammo!==null){
     w.ammo=bins.filter(b=>b.weapon===w.shared).reduce((s,b)=>s+b.shots,0);
     if(!w.ammo)errors.push(w.name+': нужен боезапас.');
   }
 });
 const total=Object.values(weights).reduce((a,b)=>a+b,0);if(total>ton)errors.push(`Превышение массы на ${(total-ton).toFixed(1)} т.`);
 return {errors,total,weights,remaining:ton-total,rating,unit:{techBase:'Inner Sphere',config:chassisConfig,
  ...(quadLayout?{actuators:Object.fromEntries(
    Object.keys(QUAD_LEG_LOCATIONS).map(loc=>[loc,
      {hip:false,upper:false,lower:false,foot:false}]))}:{}),
  name:String(c.name||'Custom').replace(/[<>&"']/g,'').slice(0,30),variant:'CUSTOM',tonnage:ton,walk,jump,sinks,armor,rear,maxArmor:{...armor},maxRear:{...rear},structure,maxStructure:{...structure},weapons,bins,hatchets,slots,crit:Object.fromEntries(Object.entries(slots).map(([l,a])=>[l,a.map(()=>false)]))}};
}
export const example={name:'Griffin custom',tonnage:55,walk:5,jump:5,sinks:12,armor:{HD:9,CT:20,LT:20,RT:20,LA:14,RA:14,LL:18,RL:18},rear:{CT:7,LT:6,RT:6},equipment:[{type:'PPC',location:'RA',slot:5},{type:'LRM 10',location:'RT',slot:3},{type:'ammo',location:'RT',slot:5,weapon:1,mass:1},{type:'ammo',location:'RT',slot:6,weapon:1,mass:1},{type:'jump',location:'LT',slot:1},{type:'jump',location:'LT',slot:2},{type:'jump',location:'RT',slot:1},{type:'jump',location:'RT',slot:2},{type:'jump',location:'CT',slot:12},{type:'sink',location:'CT',slot:11}]};
