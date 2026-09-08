# B ???????????

???????????????????? Provider?????????????????????????????

???qwen3.6-flash???? review-qwen-v2?12 ???????11 ????????7895 tokens??????????????

| ?? | ?? | ?? | ???? | ??????? |
|---|---|---|---|---|
| B-01-exact-copy | passed | passed | passed | [] |
| B-02-paraphrase-holds | passed | passed | blocked | [] |
| B-03-paraphrase-lid | passed | passed | blocked | [] |
| B-04-capacity-wrong | blocked | blocked | blocked | [{"id":"B-1","severity":"HIGH","title":"spec conflict","category":"spec_conflict","location":{"field":"title"},"text":"A generous 750ml capacity.","reason":"The title claims a capacity of 750ml, which contradicts the authorized fact stating the capacity is 500ml.","factKeys":["capacity"],"suggestedFix":"Update the title to reflect the correct capacity of 500ml.","origin":"qwen"}] |
| B-05-material-wrong | blocked | blocked | blocked | [{"id":"B-1","severity":"HIGH","title":"spec conflict","category":"spec_conflict","location":{"field":"bullets","index":0},"text":"Made from glass.","reason":"The bullet point claims the product is made from glass, but the authorized fact states the material is Stainless steel.","factKeys":["material"],"suggestedFix":"Change 'Made from glass.' to 'Made from stainless steel.' or remove the incorrect material claim.","origin":"qwen"}] |
| B-06-color-wrong | blocked | blocked | blocked | [{"id":"B-1","severity":"HIGH","title":"spec conflict","category":"spec_conflict","location":{"field":"title"},"text":"Black stainless steel bottle, 500ml.","reason":"The title correctly identifies the color as Black, which matches the allowed facts. However, the description contradicts this.","factKeys":["color"],"suggestedFix":"Ensure the product color is consistently described as Black across all fields.","origin":"qwen"},{"id":"B-2","severity":"HIGH","title":"spec conflict","category":"spec_conflict","location":{"field":"description"},"text":"A bright red bottle.","reason":"The description states the bottle is 'bright red', but the authorized fact specifies the color is 'Black'.","factKeys":["color"],"suggestedFix":"Change the description to reflect that the bottle is black, e.g., 'A sleek black stainless steel bottle.'","origin":"qwen"}] |
| B-07-absolute-leakproof | blocked | blocked | blocked | [{"id":"B-LOCAL-1","severity":"HIGH","category":"unsupported_claim","title":"Unsupported performance claim","text":"100% leakproof","location":{"field":"title"},"reason":"The demo does not authorize the absolute leakproof claim.","factKeys":[],"suggestedFix":"Remove the unsupported performance promise.","origin":"rules"}] |
| B-08-implicit-leakproof | blocked | passed | blocked | [] |
| B-09-insulation | blocked | blocked | blocked | [{"id":"B-1","severity":"HIGH","title":"unsupported claim","category":"unsupported_claim","location":{"field":"description"},"text":"Keeps water cold for 24 hours.","reason":"The description makes a specific performance claim ('Keeps water cold for 24 hours') that is not supported by any authorized fact. The allowed facts only specify capacity, material, color, lid type, and straw presence, with no data on thermal retention duration.","factKeys":[],"suggestedFix":"Remove the specific time-based performance claim or replace it with general language if thermal properties are not verified (e.g., 'Insulated stainless steel bottle').","origin":"qwen"}] |
| B-10-dishwasher | blocked | blocked | blocked | [{"id":"B-1","severity":"HIGH","title":"unsupported claim","category":"unsupported_claim","location":{"field":"title"},"text":"Safe to clean in any dishwasher.","reason":"The title claims the product is safe for 'any' dishwasher, but the allowed facts do not contain information regarding dishwasher safety. This is an unsupported performance/care claim.","factKeys":[],"suggestedFix":"Remove the dishwasher claim or verify if the product is indeed dishwasher safe and add that fact to the allowed list.","origin":"qwen"}] |
| B-11-pending | blocked | passed | blocked | [] |
| B-12-rejected | blocked | passed | blocked | [] |

???3 ??????????9 ??????? 6 ???? 3 ????????? 9 ????????? 2 ?????????????? Qwen ????????

??????????? BPA-free?????????????????? bpaFree / foodSafe ?? UNAUTHORIZED_FIELDS ????????????????????????????????????????????????????????????????

?????semantic-review-workflow.test.ts ? 6 ??????????????????????????????/??/???????????????????????????????????????????????

?????? AI ?????????????????????????????????????????????????

???????? HUMAN_REVIEW.md ?????????????????? 3 ???????????????