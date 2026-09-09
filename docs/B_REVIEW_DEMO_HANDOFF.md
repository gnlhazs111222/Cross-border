# B 模块交付说明

更新：2026-09-09。审核代码基线 dd27398；review-qwen-v13 / review-hard-v10。本文件替代旧 v8 交付指引，历史报告保留各自版本。

## 交付入口

- [比赛演示操作稿](B_REVIEW_DEMO_SCRIPT.md)
- [第三轮首次验收报告](B_REVIEW_ROUND3_ACCEPTANCE.md)
- [最近网页验证](B_REVIEW_LOCATION_FIX.md)

B 负责用已确认且允许公开的事实审核全文，返回类别、原句、位置、引用、建议，并将审核与当前版本的发布资格关联。生成方式与审核来源是两回事，应查看审核追踪中的模型、版本和调用 ID。

## 启动和手动重启

需要 Node >=22.12、依赖及已迁移的本地 SQLite。Git 不包含密钥或本机数据库，队友不会自动获得本机验收任务。首次配置本地 .env 后执行 npm.cmd ci、npm.cmd run db:migrate、npm.cmd run db:seed。普通重启不需要重复 seed 或重置演示。

先在原服务终端按 Ctrl+C，再开两个 PowerShell 终端。临时 Node 路径仅适用于当前机器；已安装 Node 可省略 PATH 行。

后端终端：

```powershell
Set-Location E:\hks\Create_new_products
$env:PATH = "$env:TEMP\prismlaunch-runtime\node-v22.14.0-win-x64;$env:PATH"
$env:WEB_ORIGINS = "http://localhost:5175,http://127.0.0.1:5175"
npm.cmd run dev:api
```

前端终端：

```powershell
Set-Location E:\hks\Create_new_products
$env:PATH = "$env:TEMP\prismlaunch-runtime\node-v22.14.0-win-x64;$env:PATH"
npm.cmd run dev:web -- --port 5175 --strictPort
```

正常登录 http://localhost:5175/；离线比赛演示不能证明真实调用。健康检查：

```powershell
Invoke-RestMethod http://127.0.0.1:3001/api/health
```

端口占用时检查已有服务，不重复启动。前端默认代理 3001，若改 API_PORT，须同步 API_PROXY_TARGET。

## 审核配置

名称来自 server/config.ts。密钥只填本地 .env，不提交；端点必须与密钥所属服务匹配。

| 配置 | 用途 |
|---|---|
| REVIEW_PROVIDER=qwen | 启用规则 + Qwen；默认 rules |
| AI_LIVE_ENABLED=true | 允许真实调用；默认 false |
| BAILIAN_API_KEY | 有效本地密钥 |
| BAILIAN_BASE_URL | 匹配密钥的兼容 API 端点 |
| BAILIAN_TEXT_MODEL=qwen3.6-flash | 本轮实测模型 |
| REVIEW_MAX_TOKENS=1800 | 默认审核输出额度 |
| BAILIAN_REQUEST_TIMEOUT_MS=30000 | 默认超时 |
| AI_MAX_LIVE_CALLS_PER_SESSION=20 | 默认进程调用预算；生成/推荐也可能消耗 |
| DATABASE_URL | 默认 file:./.local/prismlaunch.db，相对启动目录解析 |

这些是项目配置与实测记录，不是服务商套餐推荐。NODE_ENV=test 强制关闭真实 AI；修改 .env 后重启后端。LISTING_PROVIDER、RECOMMENDATION_PROVIDER 是独立配置，无需为开启审核一起修改。

## A / B / C 接口边界

以下为根据当前代码整理的协作建议，未代替队友确认。

| 模块 | 提供的内容 | 保持的约束 |
|---|---|---|
| A：任务与文案 | 平台、市场、品类、标题、卖点、描述、属性及版本 | 编辑生成新版本，不能直接设置审核通过 |
| C：证据与事实 | Fact[]、来源、确认/授权状态、事实版本 | 事实变化递增版本，使旧批准失效 |
| B：审核与安全 | 风险、引用、建议、状态、调用元数据、发布资格 | 只批准当前有效版本，失败和歧义不放行 |

开始的文件解析、事实提取、来源追踪与事实确认属于 C 的证据流程。B 使用这些事实审核文案，并负责审核入口的公共字段筛选和有限本地敏感规则；不鉴定文件真伪。新增品类或字段需同步授权字段范围。

内部契约以 shared/review.ts 的 ReviewInput / SemanticReviewResult 为准。事实只有 Confirmed、allowed=true 且属于审核公共字段范围，值才进入 ALLOWED_FACTS；未授权公共字段仅传名称和状态，不传值。

前端使用已有登录鉴权接口，不直接调用模型：

| 接口 | 内容 |
|---|---|
| GET /api/tasks/:taskId/products/:productId/listings | data 为 WorkflowSnapshot；heads 提供当前 recordId/revision，另有 factsRevision、publishAllowed |
| PATCH /api/listings/:id | expectedVersion、expectedFactsRevision、title、bullets（至少 1 条）、description；返回新快照 |
| POST /api/listings/:id/review | 两项预期版本；服务端组装事实与任务，返回新快照 |
| POST /api/listings/:id/publish | 两项预期版本；无有效批准返回 409 publish_blocked；仍为模拟发布 |
| GET /api/listings/:id | data 为 listing、reviews 数组、publications、isLatest、publishAllowed；不是 WorkflowSnapshot |

响应有 data 包装。遇到 409 listing_changed / facts_changed 重新读取快照，不沿用旧 id 和版本；发布资格以服务端为准。

关键文件：server/providers/qwenReview.ts（审核校验）、server/prompts/review-v1.ts（提示词，文件名不等于版本）、shared/review.ts（版本类型）、shared/contracts.ts（快照）、server/services/listings.ts（持久化与门禁）。共享类型、数据库和 listings 服务改动需同步 A/C，避免覆盖版本失效逻辑。

## 状态与排错

passed 为本轮范围未发现问题；blocked 为明确风险；needs_human_review 为待补证或澄清；failed 为审核未完成；running 为执行中。后四者不能发布。当前没有承诺人工强制批准入口，待复核项需补充确认事实或澄清文案后重审。

文案、事实、任务、模型、提示词、规则和模式变化可能使旧批准失效。刷新不自动调用模型；失败不回退通过；建议不自动执行。

排错记录调用 ID、当前版本、错误码和校验字段。invalid_ai_json / invalid_ai_schema 是解析或结构失败；invalid_review_location / quote / reference / reason 是进一步校验失败。认证、网络、预算问题先处理配置，显式重试并保留首次失败。不要记录密钥或完整请求头。

## 验证、复算和限制

基线 114 项服务端测试通过。第三轮 16/16 状态匹配，11/11 问题匹配，15 次真实调用、26455 tokens；另 1 条本地规则拦截。标签由 AI 起草复核，人工复核数为 0，不能称为专家盲测或总体准确率 100%。每例一次，不代表重复调用稳定性。

```powershell
node --import tsx evaluation/review/round3/run.ts --check
node evaluation/review/round3/summarize.mjs
```

以上离线复算不调用模型。汇总保留冻结哈希，仅兼容 Git 换行转换；审核实现改变后校验拒绝是预期行为，应在对应历史提交复算。真实重跑另见 round3 README，不冒充新的首次独立验收。

定位和引用合法不等于完整语义证明；有限敏感规则不等于完整防泄露；事实核对不等于真实性或平台合规认证；少量跨品类案例不等于支持任意商品。后续按现场演练、真实匿名输入、重复调用及未覆盖品类的新证据推进，失败保留首次记录后另开修复轮次。
