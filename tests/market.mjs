import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {construct} from '../packages/engine/construction.js';
import {MECH_OFFERS,rejectedMtf,sourceManifest,totalMtfRecords,searchMechCatalog} from '../apps/api/src/market.mjs';
import {importMtf} from '../apps/api/src/mtf.mjs';
const base=fileURLToPath(new URL('../data/megamek/meks/',import.meta.url));

test('MegaMek importer admits only verified, distinct Standard Inner Sphere designs',()=>{
  assert(MECH_OFFERS.length>=6,
    'Supported variants: '+MECH_OFFERS.length+'; rejected: '+JSON.stringify(rejectedMtf));
  assert.equal(MECH_OFFERS.length,new Set(MECH_OFFERS.map(x=>x.id)).size);
  const kinds=new Set(MECH_OFFERS.map(x=>x.tonnage<=35?'light':
    x.tonnage<=55?'medium':x.tonnage<=75?'heavy':'assault'));
  assert(kinds.has('light')&&kinds.has('medium')&&kinds.has('heavy'),
    'Market should include multiple size classes: '+[...kinds]);
  assert.equal(sourceManifest.licenseId,'CC-BY-NC-SA-4.0');
  assert.equal(sourceManifest.entries.length,14);
  for(const offer of MECH_OFFERS){
    assert(offer.sourceUrl.startsWith('https://github.com/MegaMek/mm-data/blob/'));
    const {unit,errors}=construct(offer.config);
    assert.deepEqual(errors,[],offer.id);
    assert.equal(unit.name,offer.name);
    assert.equal(unit.tonnage,offer.tonnage);
    assert.equal(unit.walk,offer.config.walk);
    assert.equal(unit.jump,offer.config.jump);
    assert.deepEqual(unit.maxArmor,offer.config.armor);
    assert.deepEqual(unit.maxRear,offer.config.rear);
    assert(unit.weapons.length>0);
    assert(Number.isSafeInteger(offer.price)&&offer.price>0);
  }
});
test('Griffin GRF-1M imports its LRM-20 and real armor/jump values',()=>{
  const griffin=MECH_OFFERS.find(x=>x.id==='mm-grf-1m');
  assert(griffin,'Griffin absent: '+JSON.stringify(rejectedMtf));
  const {config}=griffin;
  assert.equal(config.tonnage,55);
  assert.equal(config.walk,5);
  assert.equal(config.jump,5);
  assert.equal(config.sinks,12);
  assert.equal(config.armor.HD,9);
  assert.equal(config.rear.CT,7);
  assert(config.equipment.some(x=>x.type==='LRM 20'&&x.location==='RT'));
  const units=construct(config).unit;
  assert(units.weapons.some(w=>w.name==='LRM 20'&&w.ammo===18));
});
test('Unsupported submarine torpedoes are rejected rather than replaced',()=>{
  const entry=sourceManifest.entries.find(x=>x.file.includes('Javelin'));
  assert(entry);
  const raw=readFileSync(join(base,entry.file),'utf8');
  assert.throws(()=>importMtf(raw,{sourcePath:entry.sourcePath}),/unsupported_mtf/);
  assert(rejectedMtf.some(x=>x.file===entry.file));
});
test('Shared BattleTech ammunition is a single pool for identical weapons',()=>{
  const atlas=MECH_OFFERS.find(x=>x.id==='mm-as7-a');
  if(!atlas)return; // Unsupported variants remain explicitly excluded.
  const unit=construct(atlas.config).unit;
  const missiles=unit.weapons.filter(w=>w.name==='SRM 6');
  assert.equal(missiles.length,5);
  assert(missiles.every(w=>w.shared===missiles[0].shared));
  assert(missiles.every(w=>w.ammo===missiles[0].ammo));
});

test('MegaMek reference index includes all 4,305 MTF entries with safe pagination',()=>{
  assert.equal(totalMtfRecords,4305);
  const first=searchMechCatalog({query:'Atlas',page:1,limit:12});
  assert.equal(first.total,4305);
  assert(first.matches>12);
  assert.equal(first.items.length,12);
  assert(first.items.every(item=>item.sourceUrl?.startsWith('https://github.com/MegaMek/mm-data/blob/')));
  assert(first.items.every(item=>typeof item.available==='boolean'));
  const supported=searchMechCatalog({availableOnly:true,limit:60});
  assert.equal(supported.matches,MECH_OFFERS.length);
  assert(supported.items.every(item=>item.available&&item.offerId&&item.price>0));
  const empty=searchMechCatalog({query:'no-such-mech-type-99111'});
  assert.equal(empty.matches,0);
  assert.deepEqual(empty.items,[]);
});
