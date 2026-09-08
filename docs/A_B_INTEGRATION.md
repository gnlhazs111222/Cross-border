# A / B 线集成审查与验证

日期：2026-09-08。目标分支：`main`。本次使用独立检出目录 `/mnt/data/pyc/Create_new_products_integration`，原 A 线和 full-demo 工作目录及业务数据库保留。

## 分支关系

```text
main 原提交 f7899a9
  → pyc / competition-demo-v1: 4a2920f
  → full-demo: a8a7c63
  → A: feat/qwen-recommendation / 79cac0e
  → B: B线更新 / 7b0bdff
  → B 最新修订: e47d3b9
  → 本次集成修复
```

通过远端 fetch、提交父节点和 merge-base 确认：B 直接基于 A 开发，已包含 A 的完整提交；当前 main 是共同祖先。可按原历史快进集成，无需解决 A/B 文本冲突，也不需要强推。`pyc`、比赛标签、`full-demo` 和两条功能分支均保留。

## 代码审查结论

审查范围：B 相对 `79cac0e` 的 Provider、Prompt、服务端审核/发布/CSV、增量数据库迁移、前端状态、测试及评测实现。

- 审核输入来自服务端当前事实，公开字段按白名单及 Confirmed/allowed 过滤；未授权字段只传状态。
- 本地硬规则先阻断已识别的内部信息和绝对防漏宣称；模型返回需要满足结构、状态、原句位置和事实字段引用校验。
- 审核开始即撤销旧审核与模拟发布；网络请求在 SQLite 事务之外，返回时重新核对事实、文案、任务及审核尝试。
- 模型失败、歧义及运行中状态均不能发布；查询、发布和 CSV 不重复调用模型。
- 发布授权检查当前审核模式、模型、Prompt/规则版本和输入哈希；用户归属及历史版本限制保留。
- B 只增加 ReviewResult.metadata 的数据库列，A 的任务迁移仍保留。默认规则模式和原离线入口保留。

发现并修复一项界面缺陷：在规则模式通过后启用 Qwen，服务端已拒绝沿用批准，但页面只为历史语义审核显示过期提示，历史规则审核仍显示“审核通过，可发布”。现在所有保存的 passed 结果只要未获当前发布授权，就显示“批准已过期，需要重新审核”，并隐藏通过面板。服务端原有阻断本身有效，此问题没有允许实际发布。

新增浏览器回归先在原代码上失败，实际提示为 `Review passed · Ready to publish`；修复后通过。另补两项服务端回归：规则切换 Qwen 后旧批准不可复用，以及语义 Amazon 审核/发布/CSV 在失败重审后的失效行为。

本次修复文件：`src/pages/ReviewPublish.tsx`、`tests/semantic-review-ui.spec.ts`、`server/tests/semantic-review-workflow.test.ts`；同步 README 及本说明。未修改 Prompt、评测标签、定价、A 线排序或原业务断言。

## 实际运行结果

| 命令 | 结果 |
| --- | --- |
| `npm ci` | 安装成功，生成包含 A/B 迁移结构的 Prisma Client |
| `npm run typecheck` | 通过 |
| `npm run build` | Web/API 构建通过；最终 E2E 启动前再次构建 |
| `npm run test:server` | 最终 101/101 通过，0 失败，约 6.9 秒 |
| `npm run test:e2e` | 最终 56/56 通过，约 2.2 分钟 |
| `npm run build:local` | 独立离线构建通过 |
| `npm run eval:review -- --provider rule --split all` | 48 条规则基线完成，与队友冻结报告一致 |
| `npm run security:check` / `git diff --check` | 通过 |

服务端原 99 项保留并新增 2 项；浏览器原 55 项保留并新增 1 项。浏览器实际启动构建后的页面、隔离 API 和数据库，覆盖 XLSX/CSV 导入、人工补齐、A 线可编辑任务、Amazon/Shopify、风险阻断、修订重审、CSV、刷新恢复、用户隔离、双语和移动端。语义状态展示使用明确标注的 UI fixture；Provider/API 使用 mock transport，不能当作真实 Qwen 效果证据。检查了本轮生成的 375px 中文语义审核截图。

48 条规则评测：TP=28、TN=2、FP=12、FN=2；另 4 条歧义标签单列。明确标签上的 precision=0.70、recall=0.9333、误报率=0.8571、漏报率=0.0667。这些数据说明旧模板差异审核的局限，不能把“脚本运行通过”解释成审核效果优秀。

本轮没有加载真实 Key、没有真实 Qwen 请求。既有付费评测报告保留，未重跑。测试产生的临时截图改动恢复，重复规则报告留在本地忽略目录 `.local/integration-review-rule`，不把缓存、数据库、依赖或运行日志加入提交。

## 保留的限制

- 当前 Qwen 模式实际为本地硬规则加模型审核。原模板 R002 不用于否决所有合理改写；没有单独纯 Qwen、统一 hybrid 三组全量对照。
- 48 条标签是 AI 起草的合成案例，尚未由业务人员独立复核；已有真实小样本结果不代表通用准确率或全 48 条真实模型验收。
- 内部信息过滤是有限规则；事实授权仍是固定白名单；无法核实原始证据真伪或保证任意品类表现。
- 默认推荐 rule、文案 template、审核 rules，真实模型需在后端分别显式启用。Evidence 补充仍含 Mock，发布仍是模拟。

本次结论为：在上述 Demo 边界内，修复已发现的界面问题后，A/B 集成可进入 main；不将此结论解释为生产上线或真实审核效果认证。
