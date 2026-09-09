# 第三轮首次验收

基线：dd27398；review-qwen-v13 / review-hard-v10。16 条新输入，6 条应通过、9 条应拦截、1 条应人工复核；其中内部价格案例应由本地规则拦截，预计最多 15 次真实调用。

由同一 AI 起草并在调用前复核，人工复核数为 0，不是独立人工盲测。主题覆盖旅行杯、台灯、餐碗和围巾；新类别仅为现有公共事实字段下的探索。案例并非随机市场样本，不能推导通用准确率。与旧集合检查完全相同的输入哈希；同类风险的覆盖是有意保留。

## 运行前固定的判定规则

- 状态逐例比较，failed 单列技术失败，不能算作成功拦截。
- 对 expected=blocked、actual=passed 统计危险放行；expected=passed、actual=blocked 统计误拦截。人工复核和失败另计，不默默排除其影响。
- 问题级核对类别、字段、卖点零基索引或属性键，并核对原句是否指向 targetText 所表达的问题。可接受原句截取长短差异，不接受引用正确字段替代错误字段。
- 多问题案例必须全部找出；其他正确字段出现额外问题为误报。
- requiredFactKeys 是事先固定的最低必要引用；还需检查理由提及的其他事实是否引用，以及事实是否真正支持该解释。unsupported_claim 的空最低引用不表示可以漏掉理由里讨论的背景事实。
- 审核建议不得把“无证据/未授权”写成“产品已经实测失败”；正常内容不得要求改成错误属性值。
- 内部信息案例允许脱敏原句，且 modelCalled 必须为 false。
- 发布门禁不在此次离线评测范围；此前网页证据另有记录。

验收目标：本批全部状态符合预期、没有技术失败或危险放行、没有多余问题、所有预期问题的定位和必要引用正确。未达标如实保留结果和待办，不修改标签、不重试刷分。

## 命令

PowerShell 先设置 Node 路径（如当前机器尚未加入 PATH）：

```powershell
$env:PATH = "$env:TEMP\prismlaunch-runtime\node-v22.14.0-win-x64;$env:PATH"
node --import tsx evaluation/review/round3/run.ts --check
node --import tsx evaluation/review/round3/run.ts --live --batch first
node --import tsx evaluation/review/round3/run.ts --live --batch remaining
```

每例首次结果立即落盘；不自动重试。运行后不要重复上述 live 命令当作新的独立验收。prepare.mjs 仅用于追溯起草过程，以 wx 写入防止覆盖已固定的数据。
