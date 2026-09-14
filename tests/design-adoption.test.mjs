import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const hash=b=>createHash('sha256').update(b).digest('hex');
const manifest=read('zeus.project.json');
const adoption=read('.quality/design-adoption.json');
const spec=manifest.designSpec;
// Product-local source hygiene only. This is not an evidence validator or release gate.
function files(root,rule){
 const result=[];
 function walk(rel){
  const p=path.join(root,rel);
  if(!fs.existsSync(p))return;
  assert.ok(!fs.lstatSync(p).isSymbolicLink(),'No source link: '+rel);
  if(fs.statSync(p).isDirectory()){
   for(const f of fs.readdirSync(p).sort())if(!['node_modules','.git','.next','dist','build'].includes(f))walk(rel+'/'+f);
  }else if(rule.extensions.includes(path.extname(rel))&&!/\.test\./.test(rel))result.push(rel);
 }
 for(const p of rule.roots)walk(p);
 return [...new Set(result)].sort();
}
function sourceProblems(expected,actual){
 const a=new Map(expected.map(x=>[x.path,x.sha256])),b=new Map(actual.map(x=>[x.path,x.sha256]));
 return [...new Set([...a.keys(),...b.keys()])].filter(p=>!a.has(p)||!b.has(p)||a.get(p)!==b.get(p)).sort();
}
function requirementsCover(requirements,surfaceIds){
 return surfaceIds.every(id=>requirements.some(r=>r.level==='mandatory'&&r.surfaceIds.includes(id)));
}
test('design adoption binds the canonical specification bytes',()=>{
 assert.equal(spec.schemaVersion,'zeus.design-spec/v1');
 assert.equal(spec.specPath,'docs/DESIGN-SPEC.md');
 assert.equal(spec.contentSha256,hash(fs.readFileSync(spec.specPath)));
 assert.equal(adoption.specPath,spec.specPath);
 assert.equal(adoption.projectId,manifest.projectId);
 assert.equal(manifest.quality.designConformance.state,'required');
 assert.equal(spec.evidencePlan,'.quality/evidence-plan.json');
});
test('design adoption records missing approval without claiming certification',()=>{
 assert.equal(spec.state,'draft');
 assert.equal(spec.approval.state,'unapproved');
 assert.equal(adoption.approval.state,'unapproved');
 assert.equal(adoption.approval.approvedBy,null);
 assert.equal(adoption.approval.reference,null);
 assert.equal(adoption.enforcement.sourceCandidate,'staged');
 assert.equal(adoption.enforcement.designConformance,'INCOMPLETE');
 assert.equal(adoption.enforcement.deployedByThisAdoption,false);
 assert.equal(adoption.enforcement.historicalReceipts,'unchanged');
 assert.equal(adoption.enforcement.currentProduction,'not-verified');
});
test('design adoption rejects changed added and removed user-facing source bytes',()=>{
 const actual=files('.',adoption.sourceScan).map(p=>({path:p,sha256:hash(fs.readFileSync(p))}));
 assert.deepEqual(sourceProblems(adoption.sourceFiles,actual),[],'Update the design contract and review debt for every changed surface; a hash refresh is not approval');
 const baseline=[{path:'screen.tsx',sha256:'a'}];
 assert.deepEqual(sourceProblems(baseline,[{path:'screen.tsx',sha256:'b'}]),['screen.tsx']);
 assert.deepEqual(sourceProblems(baseline,[...baseline,{path:'new-screen.tsx',sha256:'c'}]),['new-screen.tsx']);
 assert.deepEqual(sourceProblems(baseline,[]),['screen.tsx']);
});
test('design adoption binds all referenced authorities and dependencies',()=>{
 const sources=new Map([...adoption.sourceFiles,...adoption.authorities].map(x=>[x.path,x.sha256]));
 for(const ref of adoption.authorities){
  assert.ok(ref.role&&ref.approvalStatus);
  assert.equal(hash(fs.readFileSync(ref.path)),ref.sha256,ref.path);
 }
 for(const list of Object.values(spec.dependencies))for(const p of list){
  assert.ok(!path.isAbsolute(p)&&!p.split('/').includes('..'));
  assert.ok(sources.has(p),'Unbound dependency '+p);
  assert.equal(hash(fs.readFileSync(p)),sources.get(p),p);
 }
});
test('design adoption maps every declared surface to states and mandatory requirements',()=>{
 assert.equal(new Set(spec.surfaceIds).size,spec.surfaceIds.length);
 assert.deepEqual(adoption.surfaces.map(s=>s.id).sort(),[...spec.surfaceIds].sort());
 assert.ok(requirementsCover(spec.requirements,spec.surfaceIds));
 assert.equal(requirementsCover(spec.requirements,[...spec.surfaceIds,'view:new-uncontracted-surface']),false);
 const text=fs.readFileSync(spec.specPath,'utf8');
 for(const r of spec.requirements){
  assert.match(r.id,/^DESIGN-[A-Z0-9]+-[0-9]{3,4}$/);
  assert.ok(text.includes(r.id));
  assert.ok(r.surfaceIds.every(id=>spec.surfaceIds.includes(id)));
  assert.ok(r.evidence.length&&r.violation.length>25);
 }
 for(const s of adoption.surfaces){
  assert.ok(s.states.length&&s.source);
  assert.ok(fs.existsSync(s.source.split(':')[0]),'Missing surface implementation '+s.source);
  assert.equal(s.evidenceStatus,'missing-current-candidate-proof');
 }
 assert.equal(new Set(spec.requirements.map(r=>r.id)).size,spec.requirements.length);
 assert.ok(spec.requirements.some(r=>r.level==='advisory'));
});
test('design adoption lists each required evidence modality without treating history as current proof',()=>{
 for(const r of spec.requirements)for(const kind of r.evidence){
  const gap=adoption.evidenceGaps.find(x=>x.requirementId===r.id&&x.kind===kind);
  assert.ok(gap&&gap.state==='missing'&&gap.reason.length>20,r.id+' '+kind);
  assert.deepEqual(gap.surfaceIds,r.surfaceIds);
  assert.equal(gap.missingCellCount,r.surfaceIds.length);
  assert.equal(gap.level,r.level);
 }
 assert.ok(adoption.limitations.some(x=>x.includes('physical')));
 assert.ok(adoption.limitations.some(x=>x.includes('historical')));
 assert.equal(adoption.sourceCheckMeaning,'Source hygiene only; not visual, behavioral, review, device, audio, temporal or release certification.');
});
test('design adoption source job is wired without substituting design success',()=>{
 const plan=read(spec.evidencePlan),job=plan.jobs['design-adoption-source'];
 assert.equal(plan.schemaVersion,'zeus.quality-evidence-plan/v1');
 assert.equal(plan.projectId,manifest.projectId);
 assert.equal(job.kind,'node-test');
 assert.deepEqual(job.command,['/usr/bin/node','--test','tests/design-adoption.test.mjs']);
 assert.ok(job.assertions['check:source_state'].includes('design adoption binds the canonical specification bytes'));
 assert.ok(Object.keys(job.assertions).every(k=>k==='check:source_state'||k==='check:tests'));
});

test("till protected design obligations cannot be silently downgraded",()=>{
 const ids=["DESIGN-TILL-001", "DESIGN-CLOSE-001", "DESIGN-DATE-001", "DESIGN-RECOVERY-001", "DESIGN-A11Y-001"];
 const preserved=rs=>ids.every(id=>rs.some(r=>r.id===id&&r.level==='mandatory'));
 assert.ok(preserved(spec.requirements));
 const changed=structuredClone(spec.requirements);changed.find(r=>r.id===ids[0]).level='advisory';
 assert.equal(preserved(changed),false);
 assert.equal(adoption.enforcement.designRequiredCells,spec.requirements.filter(r=>r.level==='mandatory').reduce((n,r)=>n+r.surfaceIds.length*r.evidence.length,0));
 assert.equal(adoption.enforcement.designSatisfiedCells,0);
});
