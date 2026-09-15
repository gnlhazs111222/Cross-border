# 海淘集市 Full Demo 交付说明

更新：2026-09-08，QwenListingProvider 已实现并完成 Amazon / Shopify 真实验证。全部业务状态以 SQLite 为权威来源；文案默认模板、Qwen 显式开启，失败回退。最新说明见 [QWEN_LISTING.md](QWEN_LISTING.md)。

本轮从比赛版 `4a2920f` 升级后端基础。保留 `competition-demo-v1` 标签、`pyc` 分支、原 fixtures、原业务断言和离线比赛入口；新增工作在 `full-demo` 分支完成。没有 Docker、Redis、云数据库、OAuth、真实平台发布或 Agent 框架。

## 1. 最终架构

```text
React Web
  ├─ Login / HttpOnly Cookie
  ├─ apiClient → Fastify API → Domain Services → Prisma → SQLite
  │                                    └─ Provider interfaces
  │                                        ├─ Mock / Template / Rules
  │                                        └─ Bailian Text Provider → OpenAI JS SDK
  └─ mockApi → non-authoritative UI cache; all business data from API snapshots

Offline competition mode
  React → mockApi → localStorage
  不依赖 API 或登录，不发百炼请求
```

本轮真实完成了 Backend、Auth、数据库、Product Catalog、基础 LaunchTask / Selection、FactCard / Fact / Evidence 持久化、Provider 接口和百炼连接验证。Qwen Listing Prompt 已实施；Recommendation / Evidence / Review 的 Qwen 业务能力仍未实施。

## 2. 目录

```text
server/
  app.ts                 Fastify 路由、认证、Zod 校验、统一错误处理
  config.ts              服务端环境配置与测试模式保护
  db.ts                  Prisma Client / 本地 SQLite
  auth/password.ts       scrypt 密码校验、随机 session token
  services/catalog.ts    目录读取、导入事务、当前用户 Demo reset
  services/tasks.ts      任务与选中商品的持久化
  services/facts.ts      V1/V2、人工核对、事实快照、版本和下游失效
  services/listings.ts   文案版本、规则审核、发布授权、历史与 CSV
  providers/text.ts      TextModelProvider、Mock、Bailian、预算与调用记录
  providers/domain.ts    四类业务 Provider，推荐 / 证据 / 审核的 Qwen 仍预留
  providers/qwenListing.ts Qwen 文案、缓存、回退
  providers/listingValidation.ts 结构校验与事实授权
  prompts/listing-v1.ts 版本化的两平台 Prompt
  scripts/               migrate、seed、显式 AI smoke
  tests/                 后端、权限、Provider 与预算保护测试
prisma/
  schema.prisma
  migrations/            初始表结构、保留目录 / 文件顺序
shared/
  contracts.ts           Web / API DTO
  domain.ts              从原 Demo 提取的共同评分、证据、模板及审核规则
  facts.ts               基础事实、来源、人工确认与定价的共同规则
src/
  FullDemo.tsx           登录入口；未登录不加载服务端业务工作区
  services/apiClient.ts  统一 Cookie API client
  services/mockApi.ts    保留原流程，接入服务端目录与任务
scripts/                 Prisma 生成、隔离 E2E 启动、密钥检查
.env.example             可提交的空 Key 配置模板
.env                     本地服务端凭据，已忽略且权限为 0600
.local/                  数据库、测试数据库、smoke 记录，均不提交
```

React 原文件没有被迁移到 monorepo；原规则提取到共享纯函数，避免浏览器和服务端复制两套规则实现。

## 3. 数据模型与权威数据源

Prisma / SQLite 已迁移创建 12 个模型：

| 模型 | 用途 / 当前使用情况 |
| --- | --- |
| User | email、passwordHash、displayName、目录 revision，真实使用 |
| Session | tokenHash、userId、过期时间，真实 Cookie 会话 |
| Product | userId、sku、name、category、position、revision、完整商品 JSON，真实持久化；商品 JSON 含物流申报 `transport`、质检报告 `qualityReport` 与人工处置记录 `checkDecisions` |
| LaunchTask | platform、market、category、requirements、minimumProfit、revision，真实持久化 |
| TaskSelection | 任务与商品关系，selected / fact_review 用途及 revision，真实持久化 |
| FactCard / Fact | V1/V2、字段、来源、状态、权限和修订历史，已真实持久化 |
| Evidence | 真实保存来源元数据与预置提取值；补充分析仍为 Mock |
| ListingDraft / ReviewResult / PublishResult | 已真实持久化；文案按平台独立版本化，审核 / 发布绑定文案版本，历史保留 |
| AiCall | 模型、用途、成功 / 失败、耗时、token usage 和时间，真实写入 |

所有模型都有 id、createdAt、updatedAt；需要业务版本的模型包含 version / revision。任务 Schema 没有硬编码 Amazon US，具体值来自本轮仍使用的固定 Demo Task。

**权威数据源：**

- User、Product、LaunchTask、TaskSelection、FactCard、Fact、Evidence、ListingDraft、ReviewResult、PublishResult：SQLite。
- Listing 绑定服务端 factsRevision，审核与发布绑定具体 Listing revision。
- 语言、轻量界面状态和非权威业务快照：localStorage。

为了保留原 Demo state 契约，浏览器存储中可以看到目录、任务、事实、文案、审核和发布的非权威快照。每次会话初始化都先读取 API，并用数据库结果覆盖这些缓存字段；缓存不会回写数据库。清空全部 localStorage 后，商品、任务、事实、文案、审核和发布仍能从 API 恢复；伪造本地缓存不能修改数据库或获得发布授权。目录或 factsRevision 变化会丢弃旧的浏览器下游结果。

浏览器非权威快照按用户保存，活动缓存包含 ownerId；退出登录清理活动缓存，下次登录不会把其他账户的缓存作为当前工作区。这里的 ownerId 是公开用户标识，不是登录 token。浏览器状态不是服务端安全边界，当前版本也不是生产级多用户审计系统。

## 4. Auth

- 真实 email + password 登录，密码使用带随机盐的 scrypt 派生值，不存明文。
- Session 使用随机 256-bit opaque token；数据库只保存其 SHA-256 hash。
- Cookie 为 HttpOnly、SameSite=Lax、8 小时有效；生产环境设置 Secure。
- 不向前端 JSON 返回 token，不把 token 放入 localStorage。
- 业务 API 从 Session 获取 userId，不信任请求体里的用户身份；产品、任务和选中关系均检查当前用户归属。
- 增加写请求 Origin 检查。开发环境通过 Vite 同源代理访问 API。
- 退出删除当前 Session，清除 Cookie；旧 Cookie 再请求 me 返回未认证。

本地演示账户：

```text
email: demo@prismlaunch.local
password: Demo123456
displayName: 海淘集市 Demo
```

这只是公开的本地 Demo seed。可选注册 API 仅在开发 / 测试且配置允许时开放，没有注册页、验证码、OAuth、复杂 RBAC 或 refresh token 系统。

## 5. Product / Task 持久化

```text
真实 XLSX / CSV
→ 原有浏览器解析器
→ 预览、固定字段校验、精确 SKU 去重
→ POST /api/products/import
→ 服务端再校验 + 目录 revision 检查 + 事务
→ 当前用户 SQLite Product
→ Materials
```

保留替换资料集、仅追加新 SKU、重复跳过、缺包装信息保留但阻断定价、无效行报告。新增 position 字段以保留内置顺序和文件顺序。成功导入清除该用户旧任务及下游数据，不清除 User 或其他用户数据。

LaunchTask 已迁移，固定任务可以创建、查询和恢复；选择商品也写入 TaskSelection。自由任务编辑 UI 不在本轮范围。人工事实编辑、确认和拒绝写入 SQLite，资料完整度与定价由服务端有效事实计算。人工确认记录操作人的决定，不代表完成了独立真实性核验。

后端 recommendations 路由及浏览器推荐流程均使用服务端事实派生的商品视图；缺重量商品人工确认后可重新进入候选池。原始供应商 Product 字段不被人工核对静默改写。

## 6. API

健康检查返回 `{ status, service }`，其余成功响应使用 `{ data: ... }`；错误使用 `{ error: { code, message, fields? } }`。

```text
GET  /api/health
POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/me
POST /api/auth/register
GET  /api/products
GET  /api/products/:id
POST /api/products/import
POST /api/tasks
GET  /api/tasks
GET  /api/tasks/:id
POST /api/tasks/:id/selection
GET  /api/tasks/:id/recommendations
GET  /api/tasks/:taskId/products/:productId/fact-snapshot
GET  /api/tasks/:taskId/products/:productId/fact-cards
GET  /api/tasks/:taskId/products/:productId/facts
GET  /api/tasks/:taskId/products/:productId/evidence
GET  /api/tasks/:taskId/fact-snapshots
POST /api/tasks/:taskId/products/:productId/fact-cards/v1
POST /api/tasks/:taskId/products/:productId/analyze
POST /api/tasks/:taskId/products/:productId/image-check
POST /api/tasks/:taskId/products/:productId/check-decisions
POST /api/tasks/:taskId/products/:productId/listing-template
PATCH /api/facts/:factId
POST /api/facts/:factId/confirm
POST /api/facts/:factId/reject
GET  /api/tasks/:taskId/products/:productId/listings
POST /api/tasks/:taskId/products/:productId/listings
GET  /api/listings/:id
PATCH /api/listings/:id
POST /api/listings/:id/regenerate
POST /api/listings/:id/apply-suggested-fix
POST /api/listings/:id/review
POST /api/listings/:id/publish
POST /api/listings/:id/inject-demo-risk
GET  /api/publish/:id/amazon-csv
GET  /api/capabilities
POST /api/demo/reset
POST /api/ai/smoke-test
```

- Zod 校验请求，API 不向普通响应暴露 stack trace 或上游敏感错误。
- Fastify 配置请求 / 连接超时，前端 API 请求有 Abort timeout，模型 SDK 单独配置 30 秒超时。
- 开发日志不记录请求 body；Authorization / Cookie / Set-Cookie 配置脱敏。
- reset 只重置当前认证用户，保留账户和会话；生产环境禁用 Demo reset、注册及 smoke。
- Capabilities 实际查询数据库，并从服务端配置计算 liveAvailable，前端弹窗读取 API，不再只显示写死的状态。
- 事实核对与报警：`analyze` 顺带跑一次图片文字核对，`image-check` 单独重跑（不动 v2 已有人工确认的数据）；`check-decisions` 处理报警——采纳图中印字 / 手改（`invalid_fact` 409）/ 放弃该图 / 放弃报告，请求带 `expectedRevision`，陈旧版本 409 `facts_changed`，没有争议的字段 409 `not_a_dispute`。

## 7. Providers

已实现：

- TextModelProvider：generateText / generateStructured。
- MockTextModelProvider：确定性、无网络。
- BailianTextModelProvider：官方 OpenAI JS SDK、用户提供的兼容基地址、结构化结果校验。
- RecommendationProvider / MockRecommendationProvider。
- EvidenceProvider / MockEvidenceProvider。
- ListingProvider / TemplateListingProvider。
- ReviewProvider / RuleReviewProvider。

QwenListingProvider、QwenRecommendationProvider、QwenReviewProvider 与多模态的 QwenImageCheckProvider 均已实现，各自经 TextModelProvider 调用百炼，以结构化输出、字段授权校验和回退路径接入服务端版本链。`QwenEvidenceProvider`（补充 PDF／图片事实）仍是未实现的预留适配器，对应能力由离线本地 provider 承担。

Capabilities 的 listing / recommendation / review / evidence 都已返回 `liveImplemented: true` 和 liveModel；activeProvider 只有在选择 qwen 且配置满足时才为 qwen。默认工作流为 template / rule / rules / local：图片文字核对默认离线运行（不读图上文字，只做文件级核对，属性一律标未核对），可显式切换视觉模型。

## 8. 百炼配置和预算

服务端 `.env` 的配置名见 `.env.example`，实际 Key 不在本文中。

```dotenv
BAILIAN_BASE_URL=https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1
BAILIAN_TEXT_MODEL=qwen3.6-flash
BAILIAN_REASONING_MODEL=qwen3.7-plus
BAILIAN_PREMIUM_MODEL=qwen3.8-max
BAILIAN_REQUEST_TIMEOUT_MS=30000
AI_LIVE_ENABLED=false
AI_MAX_LIVE_CALLS_PER_SESSION=20
AI_ALLOW_PREMIUM=false
LISTING_PROVIDER=template
BAILIAN_LISTING_MAX_TOKENS=1800
```

- Key 只由后端读取，不进入 React、public、前端环境变量、源码或 Git。
- 默认 live 关闭；只有开关为 true 且 Key 存在才允许真实调用。
- 若 Node 禁用了 TLS 证书验证，真实调用也会被拒绝。
- 默认模型为 qwen3.6-flash；没有自动模型切换；premium 必须显式模式和开关都允许。
- 每个后端进程最多 20 次真实调用，失败也计入额度；SDK `maxRetries: 0`，不隐藏重试。
- 每次实际尝试记录 provider、model、purpose、latency、success、时间及可得的 token usage，不记录完整提示词或凭据。
- 普通服务端测试强制 `NODE_ENV=test`、关闭 live、清空 Key；E2E 使用隔离数据库和相同保护。真实 Provider 的测试使用 mock transport。

普通命令是 Mock dry run：

```bash
npm run ai:smoke
```

显式真实连接测试：

```bash
AI_LIVE_ENABLED=true NODE_TLS_REJECT_UNAUTHORIZED=1 npm run ai:smoke -- --live
```

CLI 通过本地 Fastify 登录和 smoke 路由进行验证，每次运行最多两次补全。连接轮成功结果已写入忽略的 `.local/ai-smoke-success.json`；再次执行默认跳过，只有人为加 `--force` 才会重新尝试。连接 smoke 没有重复执行；后续文案调用使用独立的 listing-smoke 命令。

## 9. 历史连接验证与最新文案调用

仅调用 qwen3.6-flash，共 **2 次**，没有使用 qwen3.7、qwen3.8 或其他供应商模型：

| 用途 | 结果 | 耗时 | Prompt / Completion / Total |
| --- | --- | ---: | ---: |
| 文本连接，输入“你好” | 成功返回简短中文回复 | 515ms | 21 / 8 / 29 |
| 短 JSON | 成功并验证 `{"ok":true,"service":"prismlaunch"}` | 228ms | 61 / 11 / 72 |

该连接轮共 **101 tokens**。最新 Qwen Listing 轮又成功调用 Amazon / Shopify 各一次，新增 **2311 tokens**；SQLite 当前累计 **4 次 / 2412 tokens**。记录详情见 `docs/验证记录/QWEN_LISTING_VERIFICATION.md`。该连接验证轮无真实调用失败或自动重试。这是两次 smoke 的观测，不是性能基准。

## 10. 启动和验证

需要 Node.js 22.12+；本机使用 22.23.2。首次克隆：

```bash
cd /mnt/data/pyc/Create_new_products
export PATH=/mnt/data/pyc/.nvm/versions/node/v22.23.2/bin:$PATH
cp -n .env.example .env
chmod 600 .env
npm ci
npm run dev
```

`npm run dev` 会先迁移、seed，然后同时启动 Web 5173 与 API 3001。已存在的账户 / 数据不会因重复 seed 被重置。数据库默认在 `.local/prismlaunch.db`，配置中的相对路径按项目根目录解析。

其他命令：

```bash
npm run dev:web
npm run dev:api
npm run db:migrate
npm run db:seed
npm run typecheck
npm run build
npm run test:server
npm run test:e2e
npm run security:check
```

离线入口：登录页的“打开离线比赛演示”，或 `http://localhost:5173/?mode=local`。独立离线构建：

```bash
npm run dev:local
# 或
npm run build:local
npm run preview:local
```

独立离线模式默认 5174，完全不请求 API。`competition-demo-v1` 标签仍精确指向旧比赛版 `4a2920f`。

后端基础轮验收见 `docs/验证记录/VERIFICATION.md`；事实迁移验收见 `docs/FACT_SERVER_MIGRATION.md`；最新文案 / 审核 / 发布验收见 `docs/LISTING_SERVER_MIGRATION.md`。E2E 为隔离测试账户，不共用 Demo 用户；原比赛断言保留。

## 11. 下一轮最适合 AI 化的三个模块

以下区分已完成能力和后续建议：

1. **ListingProvider 已完成第一版**：下一步用更多独立样例评估事实授权校验和文案质量，不据两次成功就宣称完成通用验证。
2. **ReviewProvider**：补充语义风险检查，但保留确定性阻断与人工决定，先测误报 / 漏报。
3. **RecommendationProvider**：结合可编辑任务与确认事实做排序解释，比较固定评分与模型排序的实际效果。

Fact、Listing、Review、Publish 现均已服务端持久化；开始业务 AI 前仍需定义 Provider 输入输出 schema、授权事实引用检查、失败回退与独立效果评估。PDF Vision、真实平台发布、真实运费税费和云部署继续留在本轮之外。
