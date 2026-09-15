# 第二批 AI 辅助开发评测：15 条新案例

最新进展：第二轮状态仍全部匹配，但 R2-07 多报正确标题，需优先修复问题级误报。重复性检查报告（评测记录已归档）。

状态：已完成首轮 15 条评测，状态均符合预期；14 次真实 Qwen 调用，1 条本地规则拦截。问题级复核发现 R2-09 的关联事实引用不完整。详见 结果报告（评测记录已归档）。
开发基线：`79090f8`。提示词 `review-qwen-v8`，规则 `review-hard-v6`。

本批由同一开发助手编写并复核，属于 AI 辅助开发评测。不是独立人工盲测，不代表真实商品认证；所有商品与证据均为合成资料。没有修改原有评测集。

## 案例索引

| ID | 场景 | 预期 | 判断依据 |
| --- | --- | --- | --- |
| R2-01 | 绿色 620ml 不锈钢杯，重排事实描述 | passed | 合理改写，不新增性能。 |
| R2-02 | 建议带去自习、休息时补水 | passed | 普通使用建议，没有防漏承诺。 |
| R2-03 | 只描述绿色和不锈钢，省略容量与杯盖 | passed | 允许省略事实，不要求照抄模板。 |
| R2-04 | 白色 USB 台灯，额定 9W | passed | 功率和供电是已授权消费者事实。 |
| R2-05 | 米色帆布包，日常携带物品 | passed | 没有承重或防水保证。 |
| R2-06 | 事实 620ml，描述可装 820ml | blocked | spec_conflict，引用 capacity。 |
| R2-07 | 标题正确写帆布包，材质属性写 Leather | blocked | spec_conflict，只标错属性，引用 material。 |
| R2-08 | 台灯事实 9W，描述写 18W | blocked | spec_conflict，引用 power；USB 供电没有错。 |
| R2-09 | 水杯倾倒时旁边纸张仍保持干燥 | blocked | unsupported_claim；旋盖不能证明防漏。 |
| R2-10 | 台灯保证整晚阅读没有眼疲劳 | blocked | unsupported_claim；没有支持此效果的证据。 |
| R2-11 | 帆布包先说未做雨淋测试，再保证暴雨中物品干燥 | blocked | unsupported_claim；免责声明不能抵消后续保证。 |
| R2-12 | 可洗碗机清洗仍待确认，文案指示放入上层架清洗 | blocked | unauthorized_fact，引用 dishwasherSafe。 |
| R2-13 | 食品接触批准已被工作流拒绝，文案却声称已批准 | blocked | unauthorized_fact，引用 foodSafe；不等于证明商品不安全。 |
| R2-14 | 仅有帆布材质，却称 sturdy | needs_human_review | 按当前政策，含糊强度形容词需澄清。 |
| R2-15 | 消费者描述出现 Supplier cost: USD 4.70 | blocked | internal_disclosure，预期本地规则先拦截，不调用 Qwen。 |

总计：5 条通过、9 条阻断、1 条待复核；水杯、帆布包与台灯三类，Amazon / Shopify 两个平台。平台标签是输入上下文，不意味着本批评测平台法律或政策合规。

## 文件与使用方式

- [cases.json](cases.json)：完整事实状态、公开许可、待审核文案、预期状态、问题原句、位置、引用字段、理由和建议。
- [manifest.json](manifest.json)：整批数据及每条输入、标签的 SHA-256，用于发现后续修改；这不是防篡改签名。

案例结构包含 `input`、`expected`、`expectedIssues`，后续调用时仅将 `input` 交给审核器，不能把预期答案放入模型提示词。预期理由与修改建议用于复核，不应要求模型逐字一致。

本批使用专用入口，原来的 `eval:review` 不会自动加载它。命令如下（在项目根目录执行，需可用 Node 环境）：

```powershell
node --import tsx evaluation/review/round2/run.ts --check
node --import tsx evaluation/review/round2/run.ts --live --batch first
node --import tsx evaluation/review/round2/run.ts --live --batch remaining
```

`--check` 仅验证数据哈希，不调用模型。两个 `--live` 命令会产生新的付费调用和独立结果目录，不会覆盖首次记录。first 为 R2-01、R2-06、R2-12、R2-14；remaining 为其余 11 条。每次执行最多 12 条，不自动重试。

## 评分原则

1. 先比较最终状态。failed 必须单独记录，不能因为未放行就算正确识别风险；待复核也不能等同通过或阻断。
2. 再核对风险类别、定位、问题句与事实引用。R2-07 必须抓到错误属性；错误指责正确标题属于额外误报。
3. 核对理由和建议是否忠于事实，不能仅凭状态相同算整条完全正确。
4. 允许同一错误短语的合理引用范围，例如 `820ml` 或包含它的完整句；不要求照抄预期英文理由。
5. R2-15 本地规则会脱敏展示 `[Internal information withheld]`，不能要求页面原样显示内部金额；应检查位置、类别、发布锁定和 `modelCalled=false`。
6. 记录实际来源、调用 ID、耗时、tokens、首次错误与安全字段诊断；手动重试另列，不覆盖首次结果。
7. 样本少且由 AI 编写，只能报告本批表现。修改标签应记录理由并升数据版本；如果据此调提示词，本批以后作为回归集使用。

## 已做的准备检查

核对了 15 条 ID 对应的预期数量、问题原句存在于指定字段、引用事实键存在、通过状态不含预期问题。与原 cases / fresh-cases / boundary-cases 源文件进行描述全文检查，没有发现完全相同的描述；风险主题有意复用以测试新表达，不能据此宣称语义上完全独立。

预期答案文件保持不变，实际结果单独保存。本轮新增了调用审计，但没有修改网站商品、任务、文案或事实。
