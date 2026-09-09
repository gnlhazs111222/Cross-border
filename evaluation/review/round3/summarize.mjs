// Offline analysis of the two preserved first runs. Makes no model calls.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
const json = p => JSON.parse(readFileSync(p,'utf8'));
const hash = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const root = 'evaluation/review/round3/';
const dataset = json(root+'cases.json');
const manifest = json(root+'manifest.json');
const frozen = json(root+'frozen-baseline.json');
assert.equal(hash(dataset),manifest.datasetHash);
for (const [path,expected] of Object.entries(frozen.files)) {
  // Git may convert LF/CRLF on checkout. Accept only that representation change;
  // preserve the original pre-call hashes and reject all other content changes.
  const raw=readFileSync(path,'utf8');
  const lf=raw.replace(/\r\n/g,'\n');
  assert.ok([raw,lf,lf.replace(/\n/g,'\r\n')].some(s=>createHash('sha256').update(s).digest('hex')===expected),`Frozen file changed: ${path}`);
}
const runs = [
  'artifacts/evaluation/review-round3/2026-09-09T12-03-46-706Z-first-f9af15ce/report.json',
  'artifacts/evaluation/review-round3/2026-09-09T12-03-59-593Z-remaining-12932ffc/report.json',
];
const reports = runs.map(json);
for(const report of reports) {
  assert.equal(report.datasetHash,manifest.datasetHash);
  assert.equal(report.promptVersion,dataset.promptVersion);
  assert.equal(report.ruleVersion,dataset.ruleVersion);
}
const rows = reports.flatMap(r=>r.rows);
assert.equal(rows.length,dataset.cases.length);
assert.equal(new Set(rows.map(r=>r.id)).size,rows.length);
const notes = {
  'R3-01':'确认事实合理重排，无新增性能宣称。',
  'R3-02':'350ml 与 0.35 L 等价，未误报。',
  'R3-03':'未验证防漏的否定说明与直立使用建议没有被误判为保证。',
  'R3-04':'正常使用场景及已确认功率通过。',
  'R3-05':'省略容量与普通使用建议通过。',
  'R3-06':'已确认可洗碗机清洗的正向宣称通过。',
  'R3-07':'仅标题 Yellow 错误，引用 color 并建议 Violet。',
  'R3-08':'仅第二条卖点 glass 错误，索引 1、material 引用正确；正确标题未被指控。',
  'R3-09':'只报告 Rated power 属性 12W，引用 power 的 7W，正确标题未被指控。',
  'R3-10':'识别早到晚保温的隐含承诺；理由没有援引特定材料或杯盖，空引用合理。',
  'R3-11':'识别咖啡不留痕的抗污承诺；理由未讨论具体背景事实，空引用合理。',
  'R3-12':'BPA 同义表达识别为未授权事实，引用 Pending 的 bpaFree；未声称实测含 BPA。',
  'R3-13':'Rejected 被解释为授权状态，未捏造真实清洗测试失败。',
  'R3-14':'容量与材质两个错误分别定位标题和描述，并分别引用 capacity、material。',
  'R3-15':'内部价格由本地规则阻断并脱敏，没有外部调用记录。',
  'R3-16':'无重量依据的 lightweight 转人工复核；没有捏造重量或提出相反产品事实。',
};
const sameLoc = (a,b) => a.field===b.field && a.index===b.index && a.key===b.key;
const textAt = (input,loc) => loc.field==='bullets' ? input.listing.bullets[loc.index] : loc.field==='attributes' ? input.listing.attributes[loc.key] : input.listing[loc.field];
const checked = dataset.cases.map(c=>{
  const entry=manifest.cases.find(m=>m.id===c.id);
  assert.equal(hash(c.input),entry.inputHash);
  assert.equal(hash({expected:c.expected,expectedIssues:c.expectedIssues,rationale:c.rationale}),entry.labelHash);
  const r=rows.find(r=>r.id===c.id);
  assert.ok(r,`Missing ${c.id}`);
  assert.equal(r.expected,c.expected);
  if (r.audit) {
    assert.equal(r.audit.id,r.outcome.metadata.aiCallId);
    assert.equal(r.audit.inputHash,r.outcome.metadata.inputHash);
    assert.equal(r.audit.provider,'bailian');
  }
  const used=new Set();
  const findings=c.expectedIssues.map(e=>{
    const i=r.outcome.issues.findIndex((a,index)=>!used.has(index) && a.category===e.category && sameLoc(a.location,e.location) && (e.category==='internal_disclosure' ? a.text==='[Internal information withheld]' && a.origin==='rules' : a.text.includes(e.targetText) || e.targetText.includes(a.text)));
    if(i<0) return {expected:e,matched:false,validQuote:false,requiredReferencesPresent:false};
    used.add(i);
    const a=r.outcome.issues[i];
    return {expected:e,matched:true,actualIndex:i,validQuote:e.category==='internal_disclosure' ? a.text==='[Internal information withheld]' : textAt(c.input,a.location)?.includes(a.text)===true,requiredReferencesPresent:e.requiredFactKeys.every(k=>a.factKeys.includes(k))};
  });
  return {id:c.id,expected:c.expected,actual:r.actual,statusMatch:c.expected===r.actual,callRoutingMatch:r.outcome.metadata.modelCalled===c.expectedModelCalled && (c.expectedModelCalled ? !!r.audit : !r.audit),expectedIssueCount:c.expectedIssues.length,actualIssueCount:r.outcome.issues.length,findings,extraIssueIndices:r.outcome.issues.map((_,i)=>i).filter(i=>!used.has(i)),explanationReview:{reviewer:'Codex AI; not independent human review',acceptable:true,note:notes[c.id]},aiCallId:r.outcome.metadata.aiCallId??null};
});
const findings=checked.flatMap(c=>c.findings);
const actualCalls=rows.filter(r=>r.audit);
assert.equal(new Set(actualCalls.map(r=>r.audit.id)).size,actualCalls.length);
const summary={
  baselineCommit:dataset.baselineCommit,promptVersion:dataset.promptVersion,ruleVersion:dataset.ruleVersion,datasetHash:manifest.datasetHash,sourceRuns:runs,
  provenance:dataset.provenance,humanReviewedCount:0,total:rows.length,statusMatches:checked.filter(r=>r.statusMatch).length,
  safe:{total:6,passed:rows.filter(r=>r.expected==='passed'&&r.actual==='passed').length,blocked:rows.filter(r=>r.expected==='passed'&&r.actual==='blocked').length},
  definiteRisk:{total:9,blocked:rows.filter(r=>r.expected==='blocked'&&r.actual==='blocked').length,dangerouslyPassed:rows.filter(r=>r.expected==='blocked'&&r.actual==='passed').length},
  expectedHumanReview:{total:1,correct:rows.filter(r=>r.expected==='needs_human_review'&&r.actual==='needs_human_review').length},
  technicalFailures:rows.filter(r=>r.actual==='failed').length,
  issues:{expected:findings.length,actual:rows.reduce((s,r)=>s+r.outcome.issues.length,0),matched:findings.filter(f=>f.matched).length,validQuotesOrLocalRedactions:findings.filter(f=>f.validQuote).length,requiredReferencesPresent:findings.filter(f=>f.requiredReferencesPresent).length,withNonemptyRequiredReferences:findings.filter(f=>f.expected.requiredFactKeys.length>0).length,extra:checked.reduce((s,c)=>s+c.extraIssueIndices.length,0)},
  liveCalls:actualCalls.length,totalTokens:actualCalls.reduce((s,r)=>s+(r.audit.totalTokens??0),0),callRoutingMatches:checked.filter(c=>c.callRoutingMatch).length,
  cases:checked,
};
writeFileSync('artifacts/evaluation/review-round3/SUMMARY.json',JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify({...summary,cases:undefined}));
