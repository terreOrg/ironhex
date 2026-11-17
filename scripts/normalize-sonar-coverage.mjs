import { readFile, writeFile } from 'node:fs/promises';
import { resolve, relative, basename, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

// build-web.mjs --check already verifies the byte-identical generated copies.
// Preserve coverage records and let SonarJS aggregate records for a source file.
const root = fileURLToPath(new URL('../', import.meta.url));
const report = resolve(root, process.argv[2] || 'coverage/lcov.info');
const text = await readFile(report, 'utf8');
const engine = new Set(['engine.js','legacy-engine.js','construction.js','equipment.js','rulebook.js','component-damage.js','fire-arcs.js']);
const web = new Set(['app.js','hub.js','operation-ui.js','economy-ui.js','pilot-ui.js','auth-ui.js','dice.js','mechlab.js','record-sheet.js']);
let mapped = 0;
const lines = [];
for (const line of text.split(/\r?\n/)) {
  if (!line.startsWith('SF:')) { lines.push(line); continue; }
  const value = line.slice(3);
  const path = isAbsolute(value) ? relative(root,value) : value.replace(/^\.\//,'');
  if (!path.startsWith('dist/')) { lines.push(line); continue; }
  const file = basename(path);
  const source = engine.has(file) ? 'packages/engine/' + file : web.has(file) ? 'apps/web/src/' + file : null;
  if (!source || path !== 'dist/' + file) throw new Error('Unmapped generated coverage source: ' + path);
  const [original, generated] = await Promise.all([readFile(resolve(root,source)),readFile(resolve(root,path))]);
  if (!original.equals(generated)) throw new Error('Coverage source differs from generated copy: ' + path);
  lines.push('SF:' + source);
  mapped++;
}
await writeFile(report,lines.join('\n'));
console.log('Reattributed generated LCOV records: ' + mapped);
