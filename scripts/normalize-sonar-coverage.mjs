import { readFile, writeFile } from 'node:fs/promises';
import { resolve, relative, basename, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

// build-web.mjs --check verifies byte-identical generated copies in CI.
// Preserve individual coverage records; SonarJS aggregates source-file records.
const defaultRoot=fileURLToPath(new URL('../',import.meta.url));
const engine=new Set(['engine.js','agoac-boards.js','legacy-engine.js','construction.js','equipment.js','rulebook.js','component-damage.js','fire-arcs.js']);
const web=new Set(['app.js','hub.js','operation-ui.js','economy-ui.js','pilot-ui.js','auth-ui.js','dice.js','mechlab.js','record-sheet.js']);

export async function normalizeLcov(text,root=defaultRoot){
  let mapped=0;
  const lines=[];
  const validated=new Set();
  for(const line of text.split(/\r?\n/)){
    if(!line.startsWith('SF:')){lines.push(line);continue;}
    const value=line.slice(3);
    const path=isAbsolute(value)?relative(root,value):value.replace(/^\.\//,'');
    if(!path.startsWith('dist/')){lines.push(line);continue;}
    const file=basename(path);
    const source=file==='mech-toggle.js'?'packages/ui/mech-toggle/mech-toggle.js':engine.has(file)?'packages/engine/'+file:web.has(file)?'apps/web/src/'+file:null;
    if(!source||path!=='dist/'+file)throw new Error('Unmapped generated coverage source: '+path);
    if(!validated.has(path)){
      const [original,generated]=await Promise.all([readFile(resolve(root,source)),readFile(resolve(root,path))]);
      if(!original.equals(generated))throw new Error('Coverage source differs from generated copy: '+path);
      validated.add(path);
    }
    lines.push('SF:'+source);
    mapped++;
  }
  return {text:lines.join('\n'),mapped};
}

export async function normalizeCoverageFile(report,root=defaultRoot){
  const normalized=await normalizeLcov(await readFile(report,'utf8'),root);
  await writeFile(report,normalized.text);
  return normalized.mapped;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const report=resolve(defaultRoot,process.argv[2]||'coverage/lcov.info');
  const mapped=await normalizeCoverageFile(report);
  console.log('Reattributed generated LCOV records: '+mapped);
}
