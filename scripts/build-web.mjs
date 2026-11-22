import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const mappings = [
  ['data/megamek/scenarios/manifest.json','dist/agoac-records.json'],
  ['apps/api/src/mtf.mjs','dist/agoac-mtf.js'],

  ['packages/ui/mech-toggle/mech-toggle.js','dist/mech-toggle.js'],
  ...['app.js','terrain-level-labels.js','hub.js','scenario-room-ui.js','operation-ui.js','economy-ui.js','pilot-ui.js','auth-ui.js','auth.css','cockpit.css','dice.js','index.html','mechlab.html',
      'mechlab.js','record-sheet.js','style.css','folio-art.js','agoac-scenario-loader.js']
    .map(name => ['apps/web/src/' + name, 'dist/' + name]),
  ...['engine.js','agoac-boards.js','agoac-scenario3-figure.js','legacy-engine.js','construction.js','equipment.js','rulebook.js','component-damage.js','fire-arcs.js']
    .map(name => ['packages/engine/' + name, 'dist/' + name])
];
const check = process.argv.includes('--check');
// Reproducible, source-only browser assets. The complete technical records
// and parser are generated from the exact revision tracked in the repo.
async function expectedBytes(source) {
  const body=await readFile(resolve(root,source));
  if(source==='apps/api/src/mtf.mjs')return Buffer.from(body.toString('utf8')
    .replaceAll('../../../packages/engine/construction.js','./construction.js')
    .replaceAll('../../../packages/engine/equipment.js','./equipment.js'));
  if(source==='data/megamek/scenarios/manifest.json'){
    const manifest=JSON.parse(body.toString('utf8'));
    if(!Array.isArray(manifest.records)||manifest.records.length<12)
      throw Error('Incomplete pinned AGoAC technical records');
    const records=await Promise.all(manifest.records.map(async entry=>{
      if(!/^[-A-Za-z0-9]+\.mtf$/.test(entry.file))
        throw Error('Unsafe printed record filename');
      return {...entry,raw:await readFile(resolve(root,'data/megamek/scenarios',entry.file),'utf8')};
    }));
    return Buffer.from(JSON.stringify({sourceRepository:manifest.sourceRepository,
      sourceRevision:manifest.sourceRevision,licenseId:manifest.licenseId,records})+'\n');
  }
  return body;
}
let mismatch = false;
for (const [source,destination] of mappings) {
  const src = resolve(root,source), dst = resolve(root,destination);
  const original=await expectedBytes(source);
  if (check) {
    const generated=await readFile(dst).catch(() => Buffer.alloc(0));
    if (!original.equals(generated)) {
      console.error('Out of sync: ' + destination + ' (source ' + source + ')');
      mismatch = true;
    }
  } else {
    await mkdir(dirname(dst),{recursive:true});
    await writeFile(dst,original);
    console.log('Built ' + destination);
  }
}
if (mismatch) {
  console.error('Run: node scripts/build-web.mjs');
  process.exitCode = 1;
}
