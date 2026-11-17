import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const book=JSON.parse(readFileSync(resolve(root,'rules/battlemech-manual.json'),'utf8'));
const cases=JSON.parse(readFileSync(resolve(root,'rules/battlemech-manual-requirements.json'),'utf8'));
const countBy=(records)=>Object.fromEntries([...new Set(records.map(r=>r.status))].sort((a,b)=>a<b?-1:a>b?1:0)
  .map(status=>[status,records.filter(r=>r.status===status).length]));
const sections=countBy(book.topics),requirements=countBy(cases.requirements);
const verifiedSections=sections.verified||0,verifiedRequirements=requirements.verified||0;
const complete=book.topics.length>0&&cases.requirements.length>=book.topics.length
  &&verifiedSections===book.topics.length&&verifiedRequirements===cases.requirements.length;
const report={
 book:book.book.title,edition:book.book.edition,
 sections:{total:book.topics.length,...sections},
 requirements:{total:cases.requirements.length,...requirements},
 fullyVerified:complete,
 warning:'Tested subsets and isolated test cases are NOT proof of full book conformance.',
 missing:book.topics.filter(t=>t.status==='known_missing').map(t=>({
  id:t.id,page:t.page,title:t.title
 }))
};
const flags=new Set(process.argv.slice(2));
if(flags.has('--json'))console.log(JSON.stringify(report,null,2));
else{
 console.log(report.book+' ('+report.edition+')');
 console.log('TOC sections: '+JSON.stringify(report.sections));
 console.log('Granular requirements: '+JSON.stringify(report.requirements));
 console.log('Full conformance verified: '+(report.fullyVerified?'YES':'NO'));
 console.log(report.warning);
 if(flags.has('--missing'))for(const item of report.missing)
  console.log('p.'+item.page+' '+item.id+' — '+item.title);
}
if(flags.has('--require-complete')&&!complete){
 console.error('Rulebook conformance gate blocked: non-verified requirements remain.');
 process.exitCode=1;
}
