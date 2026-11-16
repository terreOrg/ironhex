// IronHex-owned, gameplay-implemented Classic 3025 component definitions.
// Single source for construction, combat stats and market prices. These are
// IronHex balance prices, NOT authoritative MegaMek sale valuations.
const rows={
  'Large Laser':[8,8,0,5,10,15,5,2,0,0,6000],
  'Medium Laser':[3,5,0,3,6,9,1,1,0,0,2500],
  'Small Laser':[1,3,0,1,2,3,.5,1,0,0,1100],
  Flamer:[3,2,0,1,2,3,1,1,0,0,900],
  PPC:[10,10,3,6,12,18,7,3,0,0,9500],
  // Inner Sphere extended-range energy weapons: tabletop heat, damage,
  // range, tonnage and slots; IronHex shop prices are balance values.
  'ER Small Laser':[2,3,0,2,4,5,.5,1,0,0,1750],
  'ER Medium Laser':[5,5,0,4,8,12,1,1,0,0,4800],
  'ER Large Laser':[12,8,0,7,14,19,5,2,0,0,10800],
  'ER PPC':[15,10,0,7,14,23,7,3,0,0,18500],
  // Clan advanced energy weapons. Tech-base identifiers are explicit, not
  // inferred from a shared IS weapon name.
  'Clan ER Small Laser':[2,5,0,2,4,6,.5,1,0,0,3800],
  'Clan ER Medium Laser':[5,7,0,5,10,15,1,1,0,0,9200],
  'Clan ER Large Laser':[12,10,0,8,15,25,4,1,0,0,17000],
  'Clan ER PPC':[15,15,0,7,14,23,6,2,0,0,27000],
  // Normal pulse lasers apply a -2 attack target-number modifier in the
  // shared combat rules; the shortened range is part of each specification.
  'Small Pulse Laser':[2,3,0,1,2,3,1,1,0,0,2600],
  'Medium Pulse Laser':[4,6,0,2,4,6,2,1,0,0,6500],
  'Large Pulse Laser':[10,9,0,3,7,10,7,2,0,0,13000],
  'Clan Small Pulse Laser':[2,3,0,2,4,6,1,1,0,0,4500],
  'Clan Medium Pulse Laser':[4,7,0,4,8,12,2,1,0,0,10300],
  'Clan Large Pulse Laser':[10,10,0,6,14,20,6,2,0,0,20000],
  'AC/2':[1,2,4,8,16,24,6,1,45,0,3500],
  'AC/5':[1,5,3,6,12,18,8,4,20,0,5500],
  'AC/10':[3,10,0,5,10,15,12,7,10,0,9500],
  'AC/20':[7,20,0,3,6,9,14,10,5,0,14500],
  'Machine Gun':[0,2,0,1,2,3,.5,1,200,0,900],
  'LRM 5':[2,1,6,7,14,21,2,1,24,5,2200],
  'LRM 10':[4,1,6,7,14,21,5,2,12,10,4500],
  'LRM 15':[5,1,6,7,14,21,7,3,8,15,6700],
  'LRM 20':[6,1,6,7,14,21,10,5,6,20,8700],
  'SRM 2':[2,2,0,3,6,9,1,1,50,2,1500],
  'SRM 4':[3,2,0,3,6,9,2,1,25,4,2500],
  'SRM 6':[4,2,0,3,6,9,3,2,15,6,3600]
};
export const WEAPON_SPECS=Object.freeze(Object.fromEntries(
  Object.entries(rows).map(([name,values])=>{
    const [heat,damage,minimum,short,medium,long,tons,slots,
      roundsPerTon,rack,price]=values;
    return [name,Object.freeze({
      id:'weapon:'+name,name,kind:'weapon',supported:true,
      techBase:name.startsWith('Clan ')?'Clan':'Inner Sphere',
      heat,damage,minimum,ranges:[short,medium,long],tons,slots,
      // First year this proto-campaign market treats the tech as available;
      // not necessarily the original in-universe invention year.
      introYear:name.startsWith('Clan ')?3049:
        /^ER (Small|Medium) Laser$/.test(name)?3058:
        name.startsWith('ER ')||name.includes('Pulse Laser')?3037:3025,
      accuracyModifier:name.includes('Pulse Laser')?-2:0,
      roundsPerTon,rack,price,
      mechanic:roundsPerTon?'ammo_weapon':
        name.includes('Pulse Laser')?'pulse_energy':'energy_weapon'
    })];
  })
));
export const WEAPON_NAMES=Object.freeze(Object.keys(WEAPON_SPECS));
export const AMMO_PACKS=Object.freeze(Object.fromEntries(
  WEAPON_NAMES.filter(name=>WEAPON_SPECS[name].roundsPerTon>0).map(name=>{
    const gun=WEAPON_SPECS[name];
    const pack={
      sku:'ammo:'+name,name:'Боезапас '+name,kind:'ammo',
      weapon:name,rounds:gun.roundsPerTon,tons:1,
      price:Math.max(200,Math.ceil(gun.price/8/50)*50),
      supported:true,mechanic:'magazine_reload'
    };
    return [name,Object.freeze(pack)];
  })
));
// These physical systems already affect movement, dissipation and melee
// combat. Their item counts are now transactionally controlled on refits.
export const FIXED_COMPONENTS=Object.freeze({
  jump:{kind:'mobility',name:'Jump Jet',supported:true,sold:true,
    price:3500,slots:1,mechanic:'jump_mp'},
  sink:{kind:'thermal',name:'Single Heat Sink',supported:true,sold:true,
    price:2300,tons:1,slots:1,mechanic:'heat_dissipation'},
  hatchet:{kind:'physical',name:'Hatchet',supported:true,sold:true,
    price:10000,mechanic:'melee'},
  case:{kind:'defense',name:'CASE',supported:true,sold:true,
    price:50000,tons:0.5,slots:1,mechanic:'explosion_containment'}
});
export const SYSTEM_ITEMS=Object.freeze(Object.entries(FIXED_COMPONENTS)
  .filter(([,item])=>item.supported&&item.sold)
  .map(([type,item])=>Object.freeze({
    sku:'system:'+type,type,name:item.name,price:item.price,
    kind:'system',mechanic:item.mechanic,slots:item.slots??null,
    tons:item.tons??null
  })));
export function systemCounts(config){
  const result=new Map();
  for(const item of config?.equipment||[]){
    if(!FIXED_COMPONENTS[item.type]?.supported)continue;
    const key='system:'+item.type;
    result.set(key,(result.get(key)||0)+1);
  }
  return result;
}
export const weaponSpec=name=>WEAPON_SPECS[name]||null;
export const ammoPack=name=>AMMO_PACKS[name]||null;
export function ammoBinsFor(config){
  // Convert the user-editable weapon indices into server-trusted magazine
  // locations and full capacities. The construction engine validates the
  // config separately before admission.
  const guns=(config?.equipment||[]).filter(e=>WEAPON_SPECS[e.type]);
  return (config?.equipment||[]).filter(e=>e.type==='ammo').map(e=>{
    const gun=guns[e.weapon],spec=gun&&WEAPON_SPECS[gun.type];
    return {key:e.location+':'+e.slot,location:e.location,
      slot:Number(e.slot)-1,weapon:gun?.type||null,
      capacity:spec?.roundsPerTon?spec.roundsPerTon*Number(e.mass??1):0};
  });
}
export function normalizedAmmoState(config,saved={}){
  // Accept only ammo bins actually present on the validated chassis.
  const normalized={};
  for(const bin of ammoBinsFor(config)){
    const current=saved&&Object.hasOwn(saved,bin.key)?saved[bin.key]:bin.capacity;
    normalized[bin.key]=Number.isInteger(current)?
      Math.max(0,Math.min(bin.capacity,current)):bin.capacity;
  }
  return normalized;
}
