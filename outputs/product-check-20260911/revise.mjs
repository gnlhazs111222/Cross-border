import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {Workbook} from '@oai/artifact-tool';
const source='G:/微信文件/xwechat_files/wxid_njx48gd99oe022_d591/msg/file/2026-09/商品参数信息表-已拆分成单型号.csv';
const text=await fs.readFile(source,'utf8');
const wb=await Workbook.fromCSV(text.replace(/^\uFEFF/,''),{sheetName:'商品参数'});
const sheet=wb.worksheets.getItem('商品参数');
const rows=JSON.parse((await fs.readFile(new URL('./source.json',import.meta.url),'utf8')).replace(/^\uFEFF/,''));
const cols=Object.keys(rows[0]);
const original=structuredClone(rows);const notes=[];
const set=(r,k,v,why)=>{if(r[k]!==v){notes.push({row:rows.indexOf(r)+2,sku:r.sku,field:k,before:r[k],after:v,reason:why});r[k]=v;}};
function images(r,indices,why){const urls=original[rows.indexOf(r)].imageUrls.split(';').filter(Boolean);set(r,'imageUrls',indices.map(i=>urls[i-1]).filter(Boolean).join(';'),why);set(r,'images',indices.map(i=>`IMG-${r.sourceRow.padStart(2,'0')}-${i}.jpg`).join(';'),'同步实际保留的图片引用；文件在随附图片包中');}
function unknown(r,keys,why){for(const k of keys)set(r,k,'',why);}
const used=new Set();
for(const r of rows){
 const g=Number(r.sourceRow),n=rows.indexOf(r)+2;
 if(!r.sku||used.has(r.sku)){set(r,'sku',`CHECK-R${String(g).padStart(2,'0')}-${String(n).padStart(2,'0')}`,'本文件内部唯一标识，非供应商确认型号；原 SKU 缺失或重复');}used.add(r.sku);
 if(g===2){set(r,'brand','Henenoy','来源2图片3明确标注品牌；按配图统一，未验证商标注册');set(r,'material','316、304不锈钢（内胆316）','来源2图片1、3标注');set(r,'variant',r.color==='Pink'?'粉色520ml':'蓝色520ml','去除截断或额外全316表述');images(r,r.color==='Pink'?[1,2,3]:[2],'蓝色款不再绑定粉色外观图；保留通用材质图，需补蓝色实拍');}
 if(g===3){images(r,r.variant==='骑士玄黑色/扭扭杯260ml'?[1]:[],'现有外观只明确黑色骑士，银黑混合图及其他图案不可当作该单款实拍；原图保留在核对记录');}
 if(g===4){set(r,'productType','陶瓷马克杯','图片4-1为带手柄杯，有手柄不是商品类型');if(r.variant!=='对杯')set(r,'capacityMl','320','图片4-2明确容量320ml');images(r,r.variant.startsWith('苹果')?[1,2]:[2],'苹果外观图仅分配苹果款；香蕉和对杯只保留文字参数图');unknown(r,['packageLengthCm','packageWidthCm','packageHeightCm'],'原8×8×25估算并非图片产品尺寸，未提供包装实测，避免错误包络');}
 if(g===5){set(r,'brand','DASHA','图片5-1品牌标识；按配图统一');set(r,'capacityMl','1200','图片5-1两处标注1200ml；需供应商最终确认是否属于同一SKU');set(r,'material','316不锈钢+陶瓷覆层内胆','图片5-3标注SUS316及陶瓷覆层，未标316L');set(r,'variant',r.variant.replace('1100ml','1200ml').replace('316L','316'),'同步容量和材质，避免字段内部矛盾');images(r,r.sku.endsWith('-01')?[1]:r.sku.endsWith('-03')?[3]:[],'白色仅用白色图，粉色仅用粉色图，芋泥款无对应外观图');}
 if(g===6){set(r,'productType','保温咖啡杯','图片6-1品名，接受批量定制不是类型');set(r,'capacityMl','880','图片6-2明确880ml');set(r,'material','内胆316不锈钢+陶瓷覆层；外壳304不锈钢；杯盖/提手PP','图片6-2分部件说明');set(r,'straw','true','图片6-2列出吸管：硅胶');images(r,[1,2],'匹配原图');}
 if(g>=7&&g<=11){set(r,'category','Bags & Luggage','图片均为包袋而非水杯');set(r,'productType','手提单肩包','依据图片可见手提/肩带结构');unknown(r,['brand'],'原品牌为软把/形状/携带方式等错位字段，无品牌依据');set(r,'straw','','包袋不适用吸管字段，不能作商品参数');unknown(r,['model'],'原型号为青年/全新/ROW占位，无法确认真实型号');if(g===7){set(r,'material','帆布','原variant写明帆布；未从外观判断纤维成分');set(r,'variant','卡通图案','图片7-1及7-3可见图案');}if(g===8)set(r,'material','涤纶；底垫EVA；肩带纯棉织带','图片8-2明确分部件材质');if(g===9){set(r,'variant','植物花卉印花','图片9-1不是卡通动漫');set(r,'material','16安帆布','图片9-2明确标注');set(r,'color','Off-white','图片9-2明确米白');}if(g===10)set(r,'material','布','图片10-1仅标布，不猜棉或皮革');images(r,g===7?[1,2,3]:g===11?[1]:[1,2],'作为系列参考图片；未选定的颜色/尺寸仍待确认');}
 if(g===12){unknown(r,['brand','model','productType','material','variant','straw'],'无图片；按钮开关等字段疑似错位，缺乏确定商品身份的依据');images(r,[],'原始来源没有图片');}
 if(g===13){unknown(r,['brand','model','variant','material','straw'],'原AS/PC变体与Tritan配图冲突，不能证明是哪一型号；撤下冲突确定值，待供应商确认');set(r,'productType','塑料水杯','原支持定制不是类型');images(r,[],'Tritan配图不能作为AS或PC单款依据，解除关联，原链接保留');}
 if(g===14){unknown(r,['model','variant'],'自主实拍图不是型号；pp为杯盖/茶隔材质而非已确定变体');set(r,'productType','塑料水杯','依据图片14-1');set(r,'material','杯身PC；杯盖/茶隔PP；尼龙手提绳','图片14-1明确分部件材质');images(r,[1],'多容量系列参数图；未选定具体容量，不随意补值');}
 if(g===15){unknown(r,['model'],'12小时是时间描述而非可确认型号');set(r,'productType','保温杯','图片15-1杯型，纯色不是商品类型');images(r,[1],'系列多色图，不能当作已选定颜色');}
 if(g===16)images(r,[1],'品牌及杯型未见明确冲突；材质等不能从该外观图验证');
 if(g===17){unknown(r,['model'],'自主实拍图不是可确认型号');set(r,'productType','塑料水杯','图片17-1；小清新不是商品类型');images(r,[1],'多款买家秀，仅系列参考；不据刻度猜满杯容量');}
 const brand=r.brand&&!['Unspecified','其他家'].includes(r.brand)?r.brand:'';
 const color=r.color&&r.color!=='Unspecified'?r.color:'';
 set(r,'productName',[brand,r.productType||'商品信息待核实',r.capacityMl?`${r.capacityMl}ml`:'',color].filter(Boolean).join(' '),'同步已修正字段，不保留错位品牌或Unspecified占位词');
}
// Preserve the original 22-column CSV contract and row ordering.
const matrix=[cols,...rows.map(r=>cols.map(k=>r[k]))];
sheet.getRange('A1:V40').values=matrix;
const saved=sheet.getRange('A1:V40').values;
assert.equal(rows.length,39);assert.equal(cols.length,22);assert.equal(new Set(rows.map(r=>r.sku)).size,39);
for(let i=0;i<rows.length;i++)for(const k of ['supplierCost','declaredValue','packagingWeightKg','estimatedFields','sourceRow'])assert.equal(rows[i][k],original[i][k],`Unrelated field changed ${i}/${k}`);
const csv=saved.map(row=>row.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(',')).join('\r\n');
await fs.writeFile(new URL('./商品参数信息表-图文核对修订版.csv',import.meta.url),'\uFEFF'+csv+'\r\n');
await fs.writeFile(new URL('./changes.json',import.meta.url),JSON.stringify(notes,null,2));
const report=['# 图文核对与修订说明','',`核对39条商品、16组来源、28张图片。保留39条记录和原22列，修订${notes.length}个字段。原文件及原图未修改。`,'','## 使用边界','按配图文字统一的参数是“图片所述”，不是实物检测结论。特别是1200ml与原1100ml、品牌差异，仍应向供应商确认是否配错图。无法确定真实型号/材质时置空，不用猜测。空值表示待核实或不适用，不表示否定事实。','原始supplierCost、declaredValue、包装重量和estimatedFields保留，估算字段不是事实确认值。图片产品净重/尺寸没有冒充包装毛重/外箱尺寸。包装尺寸除陶瓷杯明显不可靠的估算撤下外均保留原值，仍需实测。','修订CSV中部分条目没有准确单款图或确定型号，不能视为已经具备完整上架资料；未展示的产地、认证、保温、安全等未验证。','原表不是完全单型号：包袋图片含多个尺寸/颜色，第14来源含400/600/1000/1500/2000ml，现有资料不足以选择。保留系列参考并待选款，不任意拆造新SKU。','新CHECK开头SKU仅为本文件去重标识，不代表真实型号。','','## 来源核对','2：品牌Henenoy，520ml，316/304、内胆316；粉色图与蓝色款错配。','3：外观图片明确黑色骑士、银黑骑士混合；其余图案无对应图，撤下单款关联。未把图片中的健康/抑菌广告当作已验证事实。','4：图文标注陶瓷、320ml；香蕉款和对杯缺独立外观图；未把每只容量当作套装总容量。','5：图片1200ml/SUS316，原1100ml/316L冲突；按图修订，并保留来源确认要求。','6：图示880ml，316内胆/304外壳/PP杯盖提手/硅胶吸管。','7–11：均为包袋；第9来源为植物印花而非卡通；修复错位类别和品牌。','12：无图片，原按键开关/按钮开关疑似错列，关键参数待核实。','13：AS/PC与Tritan图片冲突，商品变体身份不清，撤下材质断言和图片关联。','14：PC杯身与PP杯盖/茶隔并不冲突，按部件表达，容量保持未选定。','15–17：外观/品牌未见确定冲突；清理错误类型/型号，不从外观推断材质或容量。','','## 逐字段变更','|CSV行|原SKU|字段|原值|新值|依据|','|---|---|---|---|---|---|'];
const esc=s=>String(s).replaceAll('|','/').replaceAll('\n',' ');
for(const n of notes)report.push(`|${n.row}|${esc(original[n.row-2].sku)}|${n.field}|${esc(n.before)}|${esc(n.after)||'（空）'}|${esc(n.reason)}|`);
report.push('','## 原始图片链接（保留供追溯）');
for(const g of [...new Set(original.map(r=>r.sourceRow))])report.push('',`来源${g}：`,...original.find(r=>r.sourceRow===g).imageUrls.split(';').filter(Boolean).map((u,i)=>`- ${g}-${i+1}: ${u}`));
await fs.writeFile(new URL('./图文核对说明.md',import.meta.url),report.join('\n'));
console.log(JSON.stringify({rows:rows.length,columns:cols.length,changedFields:notes.length,changedRows:new Set(notes.map(n=>n.row)).size,withoutImages:rows.filter(r=>!r.imageUrls).length}));
