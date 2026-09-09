// One-time fixture authoring. Never overwrite a frozen dataset after seeing results.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
const hash = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const fact = (key, value, status = 'Confirmed') => ({key, label:key, value, status, allowed:status === 'Confirmed', source:'Synthetic round3 fixture; not real evidence', anchor:key, sourceKind:'manual'});
const mug = [fact('color','Burgundy'),fact('capacity','350ml'),fact('material','Stainless steel'),fact('lidType','Sliding lid')];
const lamp = [fact('color','Orange'),fact('power','7W'),fact('supply','USB')];
const bowl = [fact('color','Ivory'),fact('material','Ceramic'),fact('capacity','900ml')];
const scarf = [fact('color','Violet'),fact('material','Linen'),fact('countryOfOrigin','Portugal')];
const issue = (category, field, text, requiredFactKeys = [], extra = {}) => ({category,location:{field,...extra},targetText:text,requiredFactKeys});
const cases = [];
function add(category, facts, title, description, expected, expectedIssues, rationale, extras = {}) {
  const id = `R3-${String(cases.length+1).padStart(2,'0')}`;
  cases.push({id, split:'acceptance-first-run', category, input:{listing:{platform:cases.length%2 ? 'shopify':'amazon',title,description,bullets:[],attributes:{},...extras},facts:structuredClone(facts),context:{market:'United States',category,taskRevision:1},listingRevision:1,factsRevision:1},expected,expectedIssues,rationale,expectedModelCalled: id !== 'R3-15'});
}
add('Travel mugs',mug,'Burgundy travel mug','The mug has a sliding lid and a stainless steel body, with a capacity of 350ml.','passed',[],'Confirmed facts are rearranged without claiming heat retention or spill prevention.');
add('Travel mugs',mug,'350ml mug','Capacity: 0.35 L.','passed',[],'Exact metric equivalence: 350ml equals 0.35L; formatting and units alone are not conflict.');
add('Travel mugs',mug,'Burgundy mug','Leak resistance has not been verified. Keep the mug upright on your desk.','passed',[],'Explicit absence of verification plus a usage instruction makes no positive containment promise.');
add('Desk lamps',lamp,'Orange USB desk lamp','Place this 7W lamp on your desk when arranging your workspace.','passed',[],'Ordinary use suggestion with confirmed specifications and no eye-health claim.');
add('Serving bowls',bowl,'Ivory ceramic bowl','Set the bowl on the table before serving.','passed',[],'Omission of known capacity and ordinary intended use are allowed.');
add('Travel mugs',[...mug,fact('dishwasherSafe','Yes')],'Burgundy mug','This mug is dishwasher safe.','passed',[],'The positive cleaning property is explicitly confirmed; do not block merely because it is a safety-related phrase.');
add('Scarves',scarf,'Yellow linen scarf','Made of linen.','blocked',[issue('spec_conflict','title','Yellow',['color'])],'Only title color conflicts with confirmed Violet; correct Linen claim must not be flagged.');
add('Serving bowls',bowl,'Ivory ceramic bowl','Capacity: 900ml.','blocked',[issue('spec_conflict','bullets','Made of glass.',['material'],{index:1})],'Only the second bullet contradicts Ceramic. Correct title and first bullet must not be accused.',{bullets:['Ivory finish.','Made of glass.']});
add('Desk lamps',lamp,'Orange 7W USB lamp','USB powered.','blocked',[issue('spec_conflict','attributes','12W',['power'],{key:'Rated power'})],'Attribute contradicts authoritative 7W; correct title must not be changed.',{attributes:{'Rated power':'12W'}});
add('Travel mugs',mug,'Burgundy mug','Pour hot tea before breakfast; it will still be piping hot when you sit down for dinner.','blocked',[issue('unsupported_claim','description','still be piping hot when you sit down for dinner')],'Implied all-day heat retention requires evidence absent from the supplied facts. No opposing temperature performance may be invented.');
add('Scarves',scarf,'Violet linen scarf','Coffee splashes leave no marks on this scarf.','blocked',[issue('unsupported_claim','description','Coffee splashes leave no marks')],'This is an objective stain-resistance promise; linen composition alone does not establish it.');
add('Travel mugs',[...mug,fact('bpaFree','Yes','Pending')],'Burgundy mug','Made without BPA.','blocked',[issue('unauthorized_fact','description','Made without BPA.',['bpaFree'])],'Pending BPA-free field cannot authorize the positive paraphrase; do not infer actual BPA presence.');
add('Serving bowls',[...bowl,fact('dishwasherSafe','Yes','Rejected')],'Ivory ceramic bowl','Safe to clean in your dishwasher.','blocked',[issue('unauthorized_fact','description','Safe to clean in your dishwasher.',['dishwasherSafe'])],'Rejected authorization is not evidence of an actual failed dishwasher test.');
add('Serving bowls',bowl,'1200ml ivory bowl','Made of stainless steel.','blocked',[issue('spec_conflict','title','1200ml',['capacity']),issue('spec_conflict','description','stainless steel',['material'])],'Two independent conflicts must both be found: capacity versus 900ml and material versus Ceramic.');
add('Scarves',scarf,'Violet linen scarf','Wholesale price: USD 6.30.','blocked',[issue('internal_disclosure','description','Wholesale price: USD 6.30.')],'Recognized internal commercial information must be blocked locally without a model call; redacted quote is expected.');
add('Desk lamps',lamp,'Orange USB lamp','Its lightweight design fits your daily routine.','needs_human_review',[issue('unsupported_claim','description','lightweight design')],'Weight is absent. Under the frozen review policy this vague physical adjective requires human review, not a definite contradictory-fact claim.');
const dataset = {datasetVersion:'round3-v1',createdAt:new Date().toISOString(),baselineCommit:'dd27398',promptVersion:'review-qwen-v13',ruleVersion:'review-hard-v10',provenance:'AI-authored and AI-reviewed acceptance fixtures; not independent human blind testing',humanReviewedCount:0,labelPolicy:'Freeze before model calls. No label edits or retries after observing outcomes. First-run evidence only.',cases};
const old = JSON.parse(readFileSync(new URL('../round2/cases.json',import.meta.url),'utf8'));
if (cases.some(c => old.cases.some(o => hash(o.input) === hash(c.input)))) throw Error('Exact round2 duplicate');
const manifest = {datasetVersion:dataset.datasetVersion,datasetHash:hash(dataset),caseCount:cases.length,counts:Object.fromEntries(['passed','blocked','needs_human_review'].map(s=>[s,cases.filter(c=>c.expected===s).length])),cases:cases.map(c=>({id:c.id,inputHash:hash(c.input),labelHash:hash({expected:c.expected,expectedIssues:c.expectedIssues,rationale:c.rationale})}))};
writeFileSync(new URL('./cases.json',import.meta.url),JSON.stringify(dataset,null,2)+'\n',{flag:'wx'});
writeFileSync(new URL('./manifest.json',import.meta.url),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({datasetHash:manifest.datasetHash,counts:manifest.counts,liveCalls:0}));
