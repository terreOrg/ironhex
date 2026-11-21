import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

// Single test manifest shared by CLI, CI and the strict SonarQube Quality Gate.
// Reject malformed names, duplicates and missing files rather than passing a green
// job with silently omitted scenario or security suites.
export function listUnitTestFiles(){
 const config=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
 const command=config.scripts?.['test:unit'];
 if(typeof command!=='string'||!command.startsWith('node --test '))
  throw Error('Missing canonical unit test manifest');
 const files=command.slice('node --test '.length).trim().split(/\s+/);
 if(files.length<15||new Set(files).size!==files.length||
  files.some(path=>!/^tests\/[a-z0-9-]+\.mjs$/.test(path)||
   !existsSync(new URL('../'+path,import.meta.url))))
  throw Error('Invalid, duplicate or missing unit test file');
 const required=['tests/scenario-match.mjs','tests/scenario-command.mjs',
  'tests/scenario-rooms.mjs','tests/terrain-level-labels.mjs',
  'tests/auth.mjs','tests/deploy-gate.mjs','tests/ci-test-manifest.mjs'];
 if(required.some(path=>!files.includes(path)))
  throw Error('Required signed-room, terrain or security test omitted');
 return files;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 process.stdout.write(listUnitTestFiles().join('\n')+'\n');
