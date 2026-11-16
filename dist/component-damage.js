import {construct,LOCS} from './construction.js';
import {WEAPON_SPECS,AMMO_PACKS,FIXED_COMPONENTS} from './equipment.js';

// Persist critical slots by actual BattleMech section, using 0-based indexes.
// These values are produced by the authoritative combat engine, never the UI.
const CORE_SERVICE_COST=Object.freeze({
  engine:6000,gyro:4500,sensors:1400,life:900,cockpit:9000,
  shoulder:1400,upper:1100,lower:1000,hand:800,
  hip:1800,foot:1000
});
export function normalizedCriticalDamage(config,raw={}){
  const built=construct(config);
  if(built.errors.length||!built.unit)throw Error('invalid_component_config');
  const result={};
  for(const loc of LOCS){
    const rows=built.unit.slots[loc]||[];
    const values=Array.isArray(raw?.[loc])?raw[loc]:[];
    const unique=[...new Set(values.filter(index=>
      Number.isInteger(index)&&index>=0&&index<rows.length&&rows[index]))]
      .sort((a,b)=>a-b);
    if(unique.length)result[loc]=unique;
  }
  return result;
}
export function captureCriticalDamage(unit){
  const out={};
  for(const loc of LOCS){
    const damaged=[];
    const slots=unit.slots?.[loc]||[];
    slots.forEach((entry,index)=>{
      if(entry&&unit.crit?.[loc]?.[index])damaged.push(index);
    });
    if(damaged.length)out[loc]=damaged;
  }
  return out;
}
function refs(slots,label){
  const result=[];
  for(const [location,items] of Object.entries(slots))
    items.forEach((entry,index)=>{
      if(entry===label)result.push({location,slot:index+1});
    });
  return result;
}
export function damagedComponents(config,critical={}){
  const unit=construct(config).unit;
  if(!unit)return [];
  const damaged=normalizedCriticalDamage(config,critical);
  const groups=new Map();
  for(const loc of LOCS){
    for(const index of damaged[loc]||[]){
      const label=unit.slots[loc][index];
      let id=loc+':'+(index+1),name=label,sku=null,serviceCost=0,
        groupSlots=[{location:loc,slot:index+1}],kind='service';
      if(label.startsWith('w:')){
        const weapon=unit.weapons[Number(label.slice(2))];
        if(!weapon)continue;
        id='weapon:'+label.slice(2);
        name=weapon.name;sku=WEAPON_SPECS[name]?name:null;
        kind='weapon';
        groupSlots=refs(unit.slots,label);
      }else if(label.startsWith('ammo:')){
        const weapon=unit.weapons[Number(label.split(':')[1])];
        name='Боезапас '+(weapon?.name||'');
        sku=weapon&&AMMO_PACKS[weapon.name]?'ammo:'+weapon.name:null;
        kind='ammo';
      }else if(label==='jump'||label==='sink'){
        name=FIXED_COMPONENTS[label].name;
        kind='system';sku='system:'+label;
      }else if(label==='hatchet'){
        const hatchet=(config.equipment||[]).find(item=>
          item.type==='hatchet'&&item.location===loc&&
          index+1>=item.slot&&index+1<item.slot+Math.ceil(config.tonnage/15));
        if(hatchet){
          id='hatchet:'+loc+':'+hatchet.slot;
          groupSlots=Array.from({length:Math.ceil(config.tonnage/15)},(_,i)=>
            ({location:loc,slot:hatchet.slot+i}));
        }
        name='Hatchet';kind='system';sku='system:hatchet';
      }else{
        name=({engine:'Двигатель',gyro:'Гироскоп',sensors:'Сенсоры',
          life:'Жизнеобеспечение',cockpit:'Кабина',shoulder:'Плечевой актуатор',
          upper:'Верхний актуатор',lower:'Нижний актуатор',
          hand:'Кисть',hip:'Тазобедренный актуатор',foot:'Стопа'})[label]||label;
        // Integrated core hardware must be serviced, not conjured as stock.
        serviceCost=CORE_SERVICE_COST[label]||1500;
      }
      if(!groups.has(id))
        groups.set(id,{id,name,kind,sku,serviceCost,slots:groupSlots,
          damagedSlots:0});
      groups.get(id).damagedSlots++;
    }
  }
  return [...groups.values()].map(item=>({
    ...item,location:item.slots[0].location,slot:item.slots[0].slot,
    serviceCost:item.serviceCost*item.damagedSlots
  }));
}
export function applyCriticalDamage(unit,raw={}){
  // Call only after reconstructing the actual mech from its validated config.
  const allowed={};
  for(const loc of LOCS){
    const slots=unit.slots?.[loc]||[];
    allowed[loc]=new Set((Array.isArray(raw?.[loc])?raw[loc]:[])
      .filter(index=>Number.isInteger(index)&&index>=0&&index<slots.length&&slots[index]));
  }
  unit.engineHits=0;unit.gyroHits=0;unit.sensorHits=0;
  unit.sinksLost=0;unit.jumpLost=0;unit.lifeSupport=false;
  unit.weapons.forEach(w=>w.destroyed=false);
  for(const loc of LOCS){
    const slots=unit.slots?.[loc]||[];
    for(let i=0;i<slots.length;i++){
      if(!allowed[loc].has(i))continue;
      unit.crit[loc][i]=true;
      const type=slots[i];
      if(type==='engine')unit.engineHits++;
      else if(type==='gyro')unit.gyroHits++;
      else if(type==='sensors')unit.sensorHits++;
      else if(type==='life')unit.lifeSupport=true;
      else if(type==='sink')unit.sinksLost++;
      else if(type==='jump')unit.jumpLost++;
      else if(type==='cockpit')unit.dead=true;
      else if(type.startsWith('w:'))unit.weapons[Number(type.slice(2))].destroyed=true;
      else if(type.startsWith('ammo:')){
        const bin=unit.bins.find(b=>b.location===loc&&b.slot===i);
        if(bin){bin.destroyed=true;bin.shots=0;}
      }else if(unit.actuators?.[loc]&&Object.hasOwn(unit.actuators[loc],type))
        unit.actuators[loc][type]=true;
    }
  }
  if(unit.engineHits>=3)unit.dead=true;
  // Game is responsible for syncing shared ammo after applying these flags.
  return unit;
}
