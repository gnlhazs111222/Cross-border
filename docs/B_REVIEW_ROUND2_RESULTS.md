# 第二批 15 条开发评测结果

后续完整复测发现 R2-07 额外误报正确标题；本文件仅描述第一轮，当前结论须结合 [重复性检查](B_REVIEW_ROUND2_REPEATABILITY.md)，不能以首次全状态匹配宣称审核内容全部正确。

日期：2026-09-09。数据 round2-v1；模型 qwen3.6-flash；提示词 review-qwen-v8；规则 review-hard-v6。未因本批评测修改提示词、标签或审核实现。

## 总体结果

- 15/15 最终状态符合预先固定的 AI 预期：5 passed、9 blocked、1 needs_human_review。
- 实际 Qwen 调用 14 次，共 19192 tokens，调用失败 0 次；R2-15 内部成本泄露由本地规则拦截，modelCalled=false。
- 没有自动或手动重试；所有结果是本批首次执行结果。
- 本批没有观察到漏报或正常文案误报，但不能将小样本状态匹配解释为通用准确率或成熟可靠性。

## 逐项复核

| 案例 | 状态 | 问题级复核 |
| --- | --- | --- |
| R2-01～05 | 全部 passed | 合理改写、使用建议、省略事实、USB 功率、帆布材质均未被错误拦截。 |
| R2-06 | blocked | 描述的 820ml 对照事实 620ml，引用 capacity，修改建议正确。 |
| R2-07 | blocked | 只标 Material 属性中的 Leather，引用 material 并建议 Canvas；未误改正确标题。 |
| R2-08 | blocked | 标出 18W，引用 power 并建议 9W；未把 USB 供电当成风险。 |
| R2-09 | blocked | 正确识别“倾倒仍保持纸张干燥”的隐含防漏保证；理由提到 screw-top lid，但 factKeys 为空。应补 lidType 作为上下文引用，不能把它当作防漏支持证据。 |
| R2-10 | blocked | 正确标出 without eye fatigue；移除该效果承诺的建议合理。 |
| R2-11 | blocked | 正确标出暴雨中保持干燥的保证，没有让前置免责声明抵消风险。 |
| R2-12 | blocked | 洗碗机清洗指令被认定为未授权事实，引用 dishwasherSafe；没有反推产品一定不能机洗。 |
| R2-13 | blocked | 食品接触批准被认定为未授权事实，引用 foodSafe；没有声称现实中已检测不安全。 |
| R2-14 | needs_human_review | 定位 sturdy，指出缺少结构强度/负载证据；建议去掉形容词或补证据。建议将其称为 subjective 不够精确，但未改变需补充客观依据的处置。 |
| R2-15 | blocked | 本地规则命中内部成本，原句脱敏，不调用模型。 |

以上复核由同一 AI 助手进行，未经过独立人工复核。预期建议与模型建议不要求逐字匹配。状态相同不表示每项解释、引用均无缺陷。

## 证据与执行

- [数据及预期](../evaluation/review/round2/cases.json)，[固定哈希](../evaluation/review/round2/manifest.json)。执行前通过完整性检查，预期答案不进入模型输入。
- [首批 4 条结果](../artifacts/evaluation/review-round2/2026-09-09T08-05-17-228Z-first-25aa5d49/report.json)：正常、容量矛盾、未确认事实、模糊表达。
- [剩余 11 条结果](../artifacts/evaluation/review-round2/2026-09-09T08-05-38-805Z-remaining-08b754f6/report.json)。
- 专用运行入口支持 --check、--live --batch first、--live --batch remaining，保留数据快照、逐条结果与数据库调用审计。类型检查通过。

本轮是模型评测，不是网站页面或真实发布验收。没有再次运行服务端全量测试，也没有重算旧模板比较基线；本批不具备事先固定的模板草稿，不能伪造规则对照成绩。

## 建议下一步

当前没有需要立即修改判断逻辑的新增漏报。可把本批保留为回归集，先整理交付或提交本轮评测工具与记录。R2-09 的引用完整性记为待改进项；若后续修复，应增加相应验证并复测，避免为补一个引用引入新的审核失败。首次浏览器偶发格式失败仍保留为已知问题，本批未复现不等于已根治。
