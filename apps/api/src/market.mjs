import {example,EQUIPMENT,construct} from '../../../packages/engine/construction.js';

// Fixed-price NPC surplus stock. Configurations are validated by the shared engine.
const base=structuredClone(example);
const support=structuredClone(example);
support.name='Griffin G1A - Guard';
support.equipment=support.equipment.filter((e,i)=>i!==3);
support.equipment.push({type:'Medium Laser',location:'LA',slot:5});
const skirmisher=structuredClone(example);
skirmisher.name='Griffin G1C - Striker';
skirmisher.equipment=skirmisher.equipment.filter(e=>!['LRM 10','ammo'].includes(e.type));
skirmisher.equipment.push(
  {type:'Medium Laser',location:'LA',slot:5},
  {type:'Medium Laser',location:'LA',slot:6},
  {type:'Medium Laser',location:'RA',slot:8}
);
export const MECH_OFFERS=[
  {id:'griffin-standard',name:base.name,price:48000,description:'55 т · PPC, LRM 10, прыжковые двигатели.',config:base},
  {id:'griffin-guard',name:support.name,price:62000,description:'55 т · PPC, LRM 10 и дополнительный Medium Laser.',config:support},
  {id:'griffin-striker',name:skirmisher.name,price:76000,description:'55 т · PPC и три Medium Laser для ближнего боя.',config:skirmisher}
];
for(const offer of MECH_OFFERS){
  const result=construct(offer.config);
  if(result.errors.length)throw new Error('Invalid dealer chassis '+offer.id+': '+result.errors.join('; '));
}
export const showMechOffer=offer=>({
  id:offer.id,name:offer.name,price:offer.price,description:offer.description,
  tonnage:offer.config.tonnage,
  weapons:offer.config.equipment.filter(e=>EQUIPMENT.includes(e.type)).map(e=>e.type)
});

// Prices are *game-specific* credits, not canonical lore or live market quotes.
const PRICES={
  'Large Laser':6000,'Medium Laser':2500,'Small Laser':1100,Flamer:900,
  PPC:9500,'AC/2':3500,'AC/5':5500,'AC/10':9500,'AC/20':14500,
  'Machine Gun':900,'LRM 5':2200,'LRM 10':4500,'LRM 15':6700,
  'LRM 20':8700,'SRM 2':1500,'SRM 4':2500,'SRM 6':3600
};
if(EQUIPMENT.some(name=>!PRICES[name]))throw new Error('Missing equipment price');
export const EQUIPMENT_CATALOG=EQUIPMENT.map(name=>({
  sku:'weapon:'+name,name,price:PRICES[name],kind:'weapon'
}));
export const weaponName=sku=>typeof sku==='string'&&sku.startsWith('weapon:')&&
  EQUIPMENT.includes(sku.slice(7))?sku.slice(7):null;
export function weaponCounts(config){
  const result=new Map();
  for(const item of config.equipment||[]){
    if(!EQUIPMENT.includes(item.type))continue;
    result.set(item.type,(result.get(item.type)||0)+1);
  }
  return result;
}
