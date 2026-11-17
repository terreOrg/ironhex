import {EQUIPMENT,construct,isBattleMechConfiguration} from '../../../packages/engine/construction.js';
import {WEAPON_SPECS} from '../../../packages/engine/equipment.js';

const LOCATION_NAMES={
  'Left Arm':'LA','Right Arm':'RA','Left Torso':'LT','Right Torso':'RT',
  'Center Torso':'CT','Head':'HD','Left Leg':'LL','Right Leg':'RL'
};
// The importer and combat constructor must agree on equipment footprints.
const CRITICAL_SLOTS=Object.fromEntries(
  Object.entries(WEAPON_SPECS).map(([name,spec])=>[name,spec.slots]));
const FIXED=new Set([
  '-Empty-','Fusion Engine','Gyro','Sensors','Life Support','Cockpit',
  'Shoulder','Upper Arm Actuator','Lower Arm Actuator','Hand Actuator',
  'Hip','Upper Leg Actuator','Lower Leg Actuator','Foot Actuator'
]);
function normalizeWeapon(label){
  const rearSuffix=label.toUpperCase().endsWith('(R)')&&/\s/.test(label.at(-4)||'');
  const unmarked=rearSuffix?label.slice(0,-3).trimEnd():label;
  const stripped=unmarked.replace(/^IS /i,'').trim();
  const autocannon=stripped.match(/^(?:Autocannon\/|AC\/)(2|5|10|20)$/i);
  if(autocannon)return 'AC/'+autocannon[1];
  const missile=stripped.match(/^(LRM|SRM)[ -]?(\d+)$/i);
  if(missile)return missile[1].toUpperCase()+' '+missile[2];
  return EQUIPMENT.includes(stripped)?stripped:null;
}
function ammoWeapon(label){
  if(!/^IS (?:Ammo |Machine Gun Ammo)/i.test(label))return null;
  if(/^IS (?:Ammo (?:MG|Machine Gun)|Machine Gun Ammo)/i.test(label))
    return 'Machine Gun';
  const ac=label.match(/Ammo AC\/(2|5|10|20)\b/i);
  if(ac)return 'AC/'+ac[1];
  const missile=label.match(/Ammo (LRM|SRM)[- ]?(\d+)\b/i);
  if(missile)return missile[1].toUpperCase()+' '+missile[2];
  return null;
}
function bad(reason){throw new Error('unsupported_mtf:'+reason);}
export function importMtf(raw,{sourcePath='unknown'}={}){
  if(typeof raw!=='string'||raw.length>500000)bad('format');
  const lines=raw.replace(/\r/g,'').split('\n');
  const properties={};
  for(const line of lines){
    const colon=line.indexOf(':');
    if(colon<=0||colon===line.length-1)continue;
    const key=line.slice(0,colon).trim().toLowerCase();
    if(!Object.hasOwn(properties,key))properties[key]=line.slice(colon+1).trim();
  }
  const required=key=>{
    if(!properties[key])bad('missing_'+key.replace(/\s/g,'_'));
    return properties[key];
  };
  const name=required('chassis')+' '+required('model');
  if(name.length>30)bad('name_too_long');
  const chassisConfig=required('config');
  if(!isBattleMechConfiguration(chassisConfig))bad('not_battlemech');
  if(chassisConfig==='Quad')bad('quad_not_implemented');
  if(required('techbase')!=='Inner Sphere')bad('technology');
  if(required('structure')!=='IS Standard')bad('structure');
  if(required('armor')!=='Standard(Inner Sphere)')bad('armor_type');
  if(!/^\d+ Single$/.test(required('heat sinks')))bad('heat_sink_type');
  if(!/^\d+ Fusion Engine$/.test(required('engine')))bad('engine_type');
  const tonnage=Number(required('mass'));
  const walk=Number(required('walk mp'));
  const jump=Number(required('jump mp'));
  const sinks=Number(required('heat sinks').split(' ')[0]);
  if(![tonnage,walk,jump,sinks].every(Number.isInteger))bad('numeric_stats');
  if(Number(required('engine').split(' ')[0])!==tonnage*walk)bad('engine_rating');
  const armor={};
  for(const loc of ['LA','RA','LT','RT','CT','HD','LL','RL'])
    armor[loc]=Number(required(loc.toLowerCase()+' armor'));
  const rear={CT:Number(required('rtc armor')),LT:Number(required('rtl armor')),
    RT:Number(required('rtr armor'))};
  if([...Object.values(armor),...Object.values(rear)].some(n=>!Number.isInteger(n)||n<0))
    bad('armor_points');
  const rawSlots={};
  for(const [section,loc] of Object.entries(LOCATION_NAMES)){
    const index=lines.findIndex(line=>line.trim()===section+':');
    if(index<0)bad('missing_section_'+loc);
    let end=index+1;
    while(end<lines.length&&lines[end].trim()!=='')end++;
    const rows=lines.slice(index+1,end).map(x=>x.trim());
    const cap=['HD','LL','RL'].includes(loc)?6:12;
    if(rows.length<cap||rows.slice(cap).some(x=>x&&x!=='-Empty-'))
      bad('slot_count_'+loc);
    rawSlots[loc]=rows.slice(0,cap);
  }
  const equipment=[],pendingAmmo=[];
  const removeActuators=[];
  for(const [loc,rows] of Object.entries(rawSlots)){
    if(['LA','RA'].includes(loc)&&rows[2]!=='Lower Arm Actuator'&&rows[3]!=='Hand Actuator')
      removeActuators.push(loc);
    for(let i=0;i<rows.length;){
      const slot=i+1,label=rows[i],type=normalizeWeapon(label);
      if(label==='Jump Jet'){equipment.push({type:'jump',location:loc,slot});i++;continue;}
      if(label==='Heat Sink'){equipment.push({type:'sink',location:loc,slot});i++;continue;}
      const ammo=ammoWeapon(label);
      if(ammo){
        pendingAmmo.push({weaponType:ammo,location:loc,slot,
          mass:/\bHalf\b/i.test(label)?.5:1});
        i++;continue;
      }
      if(type){
        const size=CRITICAL_SLOTS[type];
        if(!size||rows.slice(i,i+size).length!==size||
           rows.slice(i,i+size).some(row=>normalizeWeapon(row)!==type))
          bad('weapon_slots_'+loc+'_'+slot);
        equipment.push({type,location:loc,slot,
          ...(/\(R\)$/i.test(label)?{rear:true}:{})});
        i+=size;continue;
      }
      if(!FIXED.has(label))bad('unknown_slot_'+loc+'_'+slot+'_'+label);
      i++;
    }
  }
  // Ammunition bins may be elsewhere on the chassis, even when several
  // identical launchers share one bin. The engine pools shared ammunition.
  const mountTypes=equipment.filter(e=>EQUIPMENT.includes(e.type));
  for(const bin of pendingAmmo){
    const matching=mountTypes.findIndex(w=>w.type===bin.weaponType&&w.location===bin.location);
    const other=mountTypes.findIndex(w=>w.type===bin.weaponType);
    const weapon=matching>=0?matching:other;
    if(weapon<0)bad('orphan_ammo_'+bin.weaponType);
    equipment.push({type:'ammo',weapon,mass:bin.mass,
      location:bin.location,slot:bin.slot});
  }
  const totalWeapons=Number(required('weapons'));
  if(!Number.isInteger(totalWeapons)||mountTypes.length!==totalWeapons)
    bad('weapons_manifest');
  const config={name,config:chassisConfig,tonnage,walk,jump,sinks,armor,rear,equipment};
  if(removeActuators.length)config.removeActuators=removeActuators;
  const built=construct(config);
  if(built.errors.length||!built.unit||built.remaining<-.001)
    bad('construction_'+built.errors.join('|'));
  return {id:'mm-'+required('model').toLowerCase().replace(/[^a-z0-9-]/g,'-'),
    name,chassis:properties.chassis,model:properties.model,tonnage,
    era:Number(properties.era)||null,role:properties.role||null,
    sourcePath,
    price:Math.round((tonnage*900+mountTypes.length*1200+jump*450)/1000)*1000,
    description:tonnage+' т · '+walk+'/'+Math.ceil(walk*1.5)+'/'+jump+' MP · '+
      mountTypes.map(w=>w.type).join(', '),
    config};
}
