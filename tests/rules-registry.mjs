import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const registry=JSON.parse(readFileSync(resolve(root,'rules/battlemech-manual.json'),'utf8'));
const details=JSON.parse(readFileSync(resolve(root,'rules/battlemech-manual-requirements.json'),'utf8'));
const statuses=new Set(['not_audited','tested_subset','known_missing','verified']);
const ids=new Set();

test('BMM catalogue retains all initially indexed chapter/subchapter headings',()=>{
 assert.equal(registry.schemaVersion,1);
 assert.equal(registry.book.id,'bmm-corrected-6th-2022');
 assert.equal(registry.scope.battlemechsOnly,true);
 assert(registry.topics.length>=352,'Do not silently drop original TOC topics');
 assert(registry.topics.some(r=>r.title==='CASE II'&&r.page===119));
 assert(registry.topics.some(r=>r.title==='Hull Integrity And Breaches'&&r.page===65));
 assert(registry.topics.some(r=>r.title==='FIRING WEAPONS'&&r.page===25));
});

test('All BMM identifiers and printed-page locations are unique and structured',()=>{
 const pageAndTitle=new Set();
 for(const entry of registry.topics){
  assert.match(entry.id,/^bmm-p\d{3}-[a-z0-9-]+$/);
  assert(!ids.has(entry.id),'Duplicate id: '+entry.id);ids.add(entry.id);
  assert(entry.title&&typeof entry.title==='string');
  assert(Number.isInteger(entry.page)&&entry.page>=5&&entry.page<=132,entry.id);
  assert(typeof entry.chapter==='string'&&entry.chapter.length>2,entry.id);
  assert(['heading','topic','reference'].includes(entry.kind),entry.id);
  assert.equal(typeof entry.optional,'boolean',entry.id);
  const key=entry.page+'|'+entry.title.toLowerCase();
  assert(!pageAndTitle.has(key),'Duplicate printed heading: '+key);
  pageAndTitle.add(key);
 }
});

test('No rule is silently declared verified or given an unknown audit status',()=>{
 for(const entry of registry.topics){
  assert(statuses.has(entry.status),entry.id+': '+entry.status);
  if(entry.status==='verified'){
   assert(Array.isArray(entry.audit?.requirements)&&entry.audit.requirements.length>0,
    entry.id+': verified requires granular rule requirements');
   assert(entry.audit?.sourceChecked===true&&entry.audit?.edgeCasesChecked===true,
    entry.id+': verified requires source and edge case review');
   assert(entry.evidence?.length>0,entry.id+': verified requires tests');
  }
 }
});

test('Every tested-subset rule links to an existing exact automated test',()=>{
 let tested=0;
 const cache=new Map();
 for(const entry of registry.topics){
  if(entry.status==='tested_subset'){
   assert(entry.evidence?.length>0,entry.id+': missing test evidence');tested++;
  }
  for(const evidence of entry.evidence||[]){
   assert.match(evidence.file,/^tests\/[a-z0-9-]+\.mjs$/,entry.id);
   const path=resolve(root,evidence.file);
   assert(existsSync(path),entry.id+': missing test file '+evidence.file);
   if(!cache.has(path))cache.set(path,readFileSync(path,'utf8'));
   const name=String(evidence.test||'');
   assert(name&&!name.includes("'")&&!name.includes('\n'),entry.id+': invalid test label');
   assert(cache.get(path).includes("test('"+name+"'"),
    entry.id+': test renamed or removed: '+name);
  }
 }
 assert(tested>30,'Expected baseline linked regression evidence');
});

test('Coverage report counts all statuses; unreviewed is never shown as passed',()=>{
 const tally=Object.fromEntries([...statuses].map(s=>[s,0]));
 for(const entry of registry.topics)tally[entry.status]++;
 assert.equal(Object.values(tally).reduce((a,b)=>a+b,0),registry.topics.length);
 console.log('BattleMech Manual coverage: '+JSON.stringify(tally));
 console.log('Note: tested_subset does NOT mean a section is fully compliant.');
});

test('Granular requirements reference printed section ids and real tests',()=>{
 assert.equal(details.schemaVersion,1);
 assert.equal(details.bookId,registry.book.id);
 assert(details.requirements.length>=24);
 const parentById=new Map(registry.topics.map(t=>[t.id,t]));
 const keys=new Set();
 for(const item of details.requirements){
  assert.match(item.id,/^bmm-req-\d{3}$/);
  assert(!keys.has(item.id),'Duplicate requirement '+item.id);keys.add(item.id);
  const parent=parentById.get(item.topicId);
  assert(parent,'Orphan requirement '+item.id+' -> '+item.topicId);
  assert.equal(item.page,parent.page,item.id);
  assert(item.statement&&typeof item.statement==='string',item.id);
  assert(['tested_case','known_missing','verified'].includes(item.status),item.id);
  if(item.status==='tested_case'||item.status==='verified')
   assert(item.evidence?.length>0,item.id+' must link a test');
  for(const source of item.evidence||[]){
   assert.match(source.file,/^tests\/[a-z0-9-]+\.mjs$/,item.id);
   const file=resolve(root,source.file);
   assert(existsSync(file),item.id+' missing file '+source.file);
   const content=readFileSync(file,'utf8');
   assert(content.includes("test('"+source.test+"'"),item.id+' missing test '+source.test);
  }
  if(item.status==='verified')
   assert(item.audit?.sourceChecked&&item.audit?.edgeCasesChecked,item.id);
 }
});

test('Coverage baselines cannot be confused with full book certification',()=>{
 const totals=registry.topics.reduce((o,t)=>(o[t.status]=(o[t.status]||0)+1,o),{});
 assert((totals.verified||0)>=1,'At least the exhaustively audited Dice entry must remain verified');
 assert((totals.verified||0)<registry.topics.length,'Full-book completion is not yet confirmed');
 assert((totals.not_audited||0)>200,'Unreviewed sections must remain visible');
 console.log('BMM topic audit: '+JSON.stringify(totals));
 const granular=details.requirements.reduce((o,t)=>(o[t.status]=(o[t.status]||0)+1,o),{});
 console.log('BMM granular requirement audit: '+JSON.stringify(granular));
});

test('A verified heading must have a complete, exact set of independently verified child requirements',()=>{
 const byTopic=new Map();
 for(const r of details.requirements){
  if(!byTopic.has(r.topicId))byTopic.set(r.topicId,[]);
  byTopic.get(r.topicId).push(r);
 }
 let verifiedCount=0;
 for(const topic of registry.topics){
  if(topic.status!=='verified')continue;
  verifiedCount++;
  const children=byTopic.get(topic.id)||[];
  assert(children.length>0,topic.id+': cannot verify a heading with no requirements');
  const expected=children.map(r=>r.id).sort();
  const declared=[...new Set(topic.audit?.requirements||[])].sort();
  assert.deepEqual(declared,expected,topic.id+': audit must enumerate ALL child requirements');
  for(const r of children){
   assert.equal(r.status,'verified',r.id+': cannot certify a heading with unresolved children');
   assert(r.audit?.sourceChecked===true&&r.audit?.edgeCasesChecked===true,
    r.id+': atomic requirement must have explicit source/edge reviews');
   assert(r.evidence?.length>0,r.id+': verified child needs a named automated test');
  }
 }
 assert(verifiedCount>0,'At least one narrow rule must have been fully audited');
});

test('Strict sequential audit cursor stops at the earliest unverified heading',()=>{
  const state=JSON.parse(readFileSync(resolve(root,'rules/sequential-audit.json'),'utf8'));
  assert.equal(state.schemaVersion,1);
  assert.equal(state.bookId,registry.book.id);
  const index=registry.topics.findIndex(topic=>topic.status!=='verified');
  assert(index>=0);
  assert.equal(state.currentIndex,index);
  assert.equal(state.currentTopicId,registry.topics[index].id);
  assert.deepEqual(state.completedPrefix,registry.topics.slice(0,index).map(topic=>topic.id));
  assert(registry.topics.slice(0,index).every(topic=>topic.status==='verified'));
  assert.equal(state.currentTopicId,'bmm-p005-four-legged-mech',
    'Stop at quad support: a glossary-only test must not certify the next mechanics');
});


test('AGoAC Chapter 8 critical effects must run in both local and CI unit suites',()=>{
 const file='tests/agoac-ch8-critical-components.mjs';
 assert(existsSync(resolve(root,file)),'critical component regression file must exist');
 const pkg=JSON.parse(readFileSync(resolve(root,'package.json'),'utf8'));
 const workflow=readFileSync(resolve(root,'.github/workflows/ci.yml'),'utf8');
 assert(pkg.scripts['test:unit'].includes(file),'npm test:unit must execute Chapter 8 critical regression suite');
 assert(workflow.includes(file),'GitHub CI must execute Chapter 8 critical regression suite');
});
