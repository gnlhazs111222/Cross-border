# PrismLaunch 文案、审核与发布服务端迁移

更新：2026-09-08。基于 `e003bce`，本轮在 `full-demo` 分支实施。`competition-demo-v1` 和 `pyc` 继续指向 `4a2920f`。没有接 Qwen 业务、真实平台或物流税费 API；本轮新增真实百炼调用为 **0**。

## 1. 本轮完成了什么

```text
React → apiClient → Fastify Domain Services → Prisma / SQLite

Product → Task / Selection → FactCard / Fact / Evidence
                                     ↓ factsRevision
                                ListingDraft vN
                                     ↓ listingVersion
                                ReviewResult
                                     ↓ 服务端授权
                                PublishResult → Amazon CSV
```

整条主业务状态现已由 SQLite 提供权威数据。浏览器保留语言、Tab、页面状态和兼容性业务快照，不再拥有 Full Demo 的事实、文案、审核或发布决定权。离线比赛模式仍保留原本地流程。

主要新增 `server/services/listings.ts`、`shared/csv.ts`、正式 Prisma migration、服务端和 E2E 测试；扩展原 API client 与 mockApi，不重建五个工作区。

## 2. 最终数据模型

复用已有三张表，没有另建版本体系：

| 模型 | 字段与语义 |
| --- | --- |
| ListingDraft | id、userId、taskId、productId、platform、revision、factRevision、status、generationMode、data、createdAt、updatedAt |
| ReviewResult | id、listingDraftId、revision、reviewMode、status、issues、highRiskCount、invalidatedAt、createdAt、updatedAt |
| PublishResult | id、listingDraftId、revision、platform、status、externalDemoId、data、invalidatedAt、createdAt、updatedAt |

- ListingDraft.revision 即文案 version；factRevision 记录生成时的服务端 factsRevision。
- ListingDraft.data 保存 title、bullets、description、attributes、sources、riskDemoInjected 等原 Listing 数据。
- generationMode 当前固定 `template`，保留未来 Provider 扩展位置，本轮不接受客户端选择 Qwen。
- ReviewResult.revision 与 PublishResult.revision 都绑定所属 ListingDraft 的文案版本。
- 文案状态包括 review_required、review_blocked、review_passed、published、stale、superseded。
- 旧审核保留原 passed / blocked 结果，通过 invalidatedAt 表示已失效，避免抹掉当时的检查记录。发布记录同理。
- externalDemoId 保留原固定演示值 `AMZ-DEMO-1042` / `SHOP-DEMO-1042`，真实唯一记录使用数据库 id 区分。

迁移 `20260908030000_listing_authority` 在原数据库增加字段。旧版本中存在的实验记录保留为 stale / invalidated，不会凭默认值自动获得授权。没有删库重建。

## 3. API

所有新端点使用现有 HttpOnly Cookie 认证、Zod 校验和统一错误响应。

```text
POST /api/tasks/:taskId/products/:productId/listings
GET  /api/tasks/:taskId/products/:productId/listings
GET  /api/listings/:listingId
PATCH /api/listings/:listingId
POST /api/listings/:listingId/regenerate
POST /api/listings/:listingId/apply-suggested-fix
POST /api/listings/:listingId/review
POST /api/listings/:listingId/publish
GET  /api/publish/:publishId/amazon-csv
```

列表接口返回当前平台文案、有效审核、有效发布、最新版本标识 heads、factsRevision 与服务端计算的 publishAllowed。stale 文案保留最新版本标识，但不出现在当前有效文案列表中。单条 GET 可读取指定历史文案及其审核 / 发布历史。当前工作区仍只展示最新有效版本，没有新增历史版本浏览页面。

创建、编辑及后续业务动作携带 expectedVersion 和 expectedFactsRevision。初次创建某平台时 expectedVersion=0；后续使用服务器返回的最新版本。过期版本返回 `409 listing_changed`，过期事实返回 `409 facts_changed`，不会覆盖较新结果。

请求体不能提交 userId、ownerId、reviewPassed、publishAllowed、任意事实数组或审核结果。生成输入全部由后端读取；CSV 返回真实 `text/csv` 响应，带下载文件名。

## 4. 生成、编辑和平台隔离

服务端 TemplateListingProvider 只使用 Confirmed + Allowed Facts。采购成本、申报价值和内部包装字段不会进入消费者模板。普通编辑只能修改标题、卖点、描述，不能偷偷改事实来源或授权属性。

Amazon 首份草稿继续加入 `100% leakproof` 演示风险，并保存 `riskDemoInjected: true`。这不是来自允许列表的合法事实。事实变化后重新开始草稿流程时，也保留这一演示行为；对当前有效文案进行常规重新生成不反复注入。

编辑、Regenerate、Apply Suggested Fix 都创建新的 ListingDraft revision。旧版本内容不被覆盖，状态改为 superseded，原审核及发布记录标为 invalidated。新文案为 review_required，没有自动通过的审核。

版本按 task + product + platform 独立递增。Amazon v3 与 Shopify v1 可以并存。修改 Amazon 文案不会清除 Shopify 的审核与发布；修改底层事实则同时影响两个平台。

## 5. Review 与发布授权

RuleReviewProvider 在后端读取数据库中的当前文案，和当前授权事实生成的安全模板比较：

- R001：`100% leakproof` 无依据性能宣称，HIGH，阻断发布。
- R002：其他不被当前模板支持的改写，HIGH，阻断发布。
- Apply Suggested Fix 恢复整份安全模板，包含 `Secure screw-top lid designed for everyday carrying.`，创建新版本后仍必须再次 Run Review。

每次 Run Review 保存新的 ReviewResult，包括当前文案 revision、rules 模式、问题和 highRiskCount；之前的审核及发布记录失效。

`canPublishListing` 在后端验证：

1. Listing 及其 task / product 属于当前登录用户。
2. Listing 是该平台的最新版本，状态为 review_passed 或 published。
3. Listing.factRevision 等于当前 factsRevision，所需事实及定价仍就绪。
4. 存在未失效的审核，且绑定当前文案版本。
5. 审核 passed，highRiskCount=0，issues 为空。
6. 用当前模板规则重新检查文案，仍无风险。

Publish 在同一事务中再次执行授权，再创建 PublishResult。重复发布同一个有效版本返回已有结果，避免重复创建。本轮外部发布仍为 Mock，没有创建真实 Amazon / Shopify 商品。

## 6. 事实变化与历史保留

FactService 的 Edit / Confirm / Reject 在其事务中：

```text
递增 factsRevision
→ 当前两个平台的 Listing 标记 stale
→ 有效 Review / Publish 设置 invalidatedAt
→ 返回 downstreamInvalidated
```

历史不会因普通事实修改被物理删除。浏览器清除已失效的当前展示，再根据服务器最新版本重新生成、重审、发布。只比较前端按钮状态不构成授权；直接请求旧 listingId 或 publishId 也会被后端拒绝。

Demo reset 和资料集替换仍按原语义清理该用户的业务数据，包括历史记录；它们是显式重置操作，不等同于日常事实或文案编辑。

## 7. CSV 与浏览器缓存

CSV 读取 SQLite 中当前有效的 Amazon 发布记录和对应文案。服务端检查用户归属、平台、版本、失效状态及发布授权，再按当前服务端定价生成原 12 列演示格式。旧版本或失效的 publishId 不可下载。

Full Demo 不再从 localStorage 拼接 CSV。前端只把认证 API 返回的 CSV 内容下载为文件。

初始化时，无论浏览器缓存包含什么 Listing / Review / Publish，都用 API 结果覆盖。旧浏览器中的文案和通过状态不会自动导入数据库；服务器没有这些结果时，需要重新生成和审核。

清空 localStorage 后，重新进入仍可恢复数据库中的事实、文案、审核和发布。新浏览器只要有有效登录 Cookie，也可恢复。若同时清除 Cookie，则先重新登录。

没有实时推送或复杂多用户同步。其他页面的修改会在刷新或业务操作时被重新检查；过期操作显示冲突并更新当前页面状态。

## 8. 离线比赛模式

`?mode=local`、`npm run dev:local` 与独立 competition 构建继续走原 mockApi / localStorage，不需要登录、API、SQLite 或百炼。

模板、审核及 CSV 的原规则被复用；离线完整 Materials → Task → Fact → Listing → Review → Publish → CSV 流程继续通过测试。工作区视觉、中英文、事实来源、风险红色与审核状态表达保持原样。

## 9. 验证

新增 8 项服务端测试覆盖：

- 服务端事实生成、授权字段筛选、风险标记、平台独立版本和 SQLite 重连。
- 待确认 / 已拒绝字段排除，确认后允许使用。
- R001 直接调用 Publish 仍阻断，Fix 后必须重审。
- 编辑保存新版本、历史失效、R002、Shopify 不受 Amazon 编辑影响。
- 服务端 CSV、旧版本下载拒绝、发布幂等。
- 事实变化使两平台失效但保留历史，重新生成后恢复链路。
- 伪造授权字段拒绝、过期请求 409、同时编辑只有一个成功。
- 跨用户读取、编辑、审核、发布、下载拒绝。

新增 4 项 E2E 覆盖：中英文缓存伪造与清空恢复、另一页面修改后的旧版本拒绝、只有 Cookie 的全新浏览器环境恢复发布结果。

原事实测试中“删除下游记录”的断言按本轮新要求更新为“保留记录并标记失效”；其余原业务断言继续保留。

已执行 Prisma Client 生成、数据库增量迁移，以及：

```bash
npm run typecheck
npm run build
npm run test:server
npm run test:e2e
npm run build:local
npm run security:check
npm run dev
```

测试结果：**30 项服务端测试、41 项 E2E 全部通过**（E2E 1.8 分钟）。原有 37 项浏览器测试包含离线、中文、英文、手机、XLSX / CSV、人工补齐和主线发布，均继续通过。TypeScript、前后端 build、独立离线 build、security check 均通过。另在日常 5173 页面实际完成中文主线、直接请求风险文案发布返回 409、服务端 CSV 下载，以及清空 localStorage 后恢复相同的发布记录。用 Python CSV 解析器独立检查 1 行、12 列、正确 SKU / USD 19.99 与风险移除；浏览器下载测试还检查 UTF-8 BOM 原样保留。

实际素材：[风险拦截](../artifacts/server-listings/01-server-blocked.png)、[服务端发布结果](../artifacts/server-listings/02-server-published.png)、[服务端 CSV 样例](../artifacts/server-listings/amazon-server-demo.csv)。

本轮真实百炼调用 **0 次**。AI_LIVE_ENABLED 保持 false，没有运行 live smoke；主数据库上一轮累计两条调用 / 101 tokens 保留。

## 10. 本地演示与下一轮边界

`npm run dev` 后打开 `http://localhost:5173`，使用页面给出的 Demo 账户登录。创建任务、选 Top 1、Analyze、生成 Amazon 文案、Run Review、R001 阻断、Apply Suggested Fix、重审、发布、下载 CSV。

可以在发布后执行 `localStorage.clear()` 并刷新，再进入审核与发布页，展示结果确实从服务器恢复。也可同时生成 Shopify，对比两个平台的独立状态。

下一轮 AI 化仍需要：明确 Provider 输入输出 schema、事实引用核验、失败回退、显式 Live 入口与预算、Qwen Prompt，以及推荐 / 文案 / 审核的独立效果评估。持久化与版本授权基础现已齐备，本轮没有继续实现 Qwen 业务。
