// IronHex rulebook provenance. This list is an explicit boundary between
// the A Game of Armored Combat box-book and later BattleTech technology.
// The base-book statistics are independently tested against its printed
// Weapons and Equipment Table, p.55.
export const BASE_RULEBOOK=Object.freeze({
  id:'agoac-2018',
  title:'BattleTech: A Game of Armored Combat',
  publisher:'Catalyst Game Labs',
  scope:'Basic BattleMech combat and introductory construction',
  edition:'2018',tablePage:55,
  url:'https://static1.squarespace.com/static/5e5f11b6a6b48b3ae5c4ee36/t/5e69a64e3d430e6e35ad7fda/1583982189894/cat3500d%2Bbattletech%2Ba%2Bgame%2Bof%2Barmored%2Bcombat%2Brulebook.pdf'
});
export const BASE_WEAPONS=Object.freeze([
  'Large Laser','Medium Laser','Small Laser','Flamer','PPC',
  'AC/2','AC/5','AC/10','AC/20','Machine Gun',
  'LRM 5','LRM 10','LRM 15','LRM 20',
  'SRM 2','SRM 4','SRM 6'
]);
const approved=new Set(BASE_WEAPONS);
export const isBaseWeapon=name=>approved.has(name);
export function outOfBookEquipment(config){
  return [...new Set((config?.equipment||[])
    .map(item=>item?.type)
    .filter(type=>type&&type!=='ammo'&&
      !['jump','sink','hatchet'].includes(type)&&!approved.has(type)))];
}
// BattleMech Manual and TechManual cover supplementary technology. Keep
// advanced definitions for continued engineering work, but do not silently
// treat them as part of AGoAC. This is a provenance marker, not an assertion
// that every advanced rule is already correctly modeled.
export const ADVANCED_RULEBOOKS=Object.freeze([
  {title:'BattleMech Manual',scope:'Expanded BattleMech combat',
   url:'https://store.catalystgamelabs.com/products/battletech-battlemech-manual-book-pdf'},
  {title:'TechManual',scope:'Advanced BattleMech construction',
   url:'https://store.catalystgamelabs.com/products/battletech-techmanual-book-pdf'}
]);
export const equipmentRulebook=name=>approved.has(name)?
  {status:'verified_base',book:BASE_RULEBOOK.title,page:BASE_RULEBOOK.tablePage}:
  {status:'requires_supplement',book:'BattleMech Manual / TechManual',page:null};
