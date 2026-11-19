import { readFile, copyFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const mappings = [
  ['packages/ui/mech-toggle/mech-toggle.js','dist/mech-toggle.js'],
  ...['app.js','hub.js','operation-ui.js','economy-ui.js','pilot-ui.js','auth-ui.js','auth.css','cockpit.css','dice.js','index.html','mechlab.html',
      'mechlab.js','record-sheet.js','style.css']
    .map(name => ['apps/web/src/' + name, 'dist/' + name]),
  ...['engine.js','legacy-engine.js','construction.js','equipment.js','rulebook.js','component-damage.js','fire-arcs.js']
    .map(name => ['packages/engine/' + name, 'dist/' + name])
];
const check = process.argv.includes('--check');
let mismatch = false;
for (const [source,destination] of mappings) {
  const src = resolve(root,source), dst = resolve(root,destination);
  if (check) {
    const [original,generated] = await Promise.all([
      readFile(src),readFile(dst).catch(() => Buffer.alloc(0))
    ]);
    if (!original.equals(generated)) {
      console.error('Out of sync: ' + destination + ' (source ' + source + ')');
      mismatch = true;
    }
  } else {
    await mkdir(dirname(dst),{recursive:true});
    await copyFile(src,dst);
    console.log('Built ' + destination);
  }
}
if (mismatch) {
  console.error('Run: node scripts/build-web.mjs');
  process.exitCode = 1;
}
