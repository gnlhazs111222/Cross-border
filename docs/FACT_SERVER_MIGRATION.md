# PrismLaunch 事实与证据服务端迁移

更新：2026-09-08。基于 Full Demo 提交 `1f50409`，在 `full-demo` 分支完成。比赛标签 `competition-demo-v1` 和 `pyc` 保持 `4a2920f`。本轮只迁移事实权威数据，真实百炼调用 **0 次**。

## 1. 当前架构与范围

```text
Full Demo
  React → apiClient → Fastify Fact Service → Prisma / SQLite
                          ├─ V1：供应商基础字段
                          ├─ V2：MockEvidenceProvider 增强
                          ├─ Edit / Confirm / Reject
                          ├─ 有效事实 → 定价与商品候选视图
                          └─ Confirmed + Allowed → TemplateListingProvider

  浏览器保存 Listing / Review / Mock Publish，并绑定服务端 factsRevision

Offline Competition
  React → mockApi → localStorage
  无登录、数据库或 API 依赖
```

服务端权威数据现为 User、Product、LaunchTask、TaskSelection、FactCard、Fact、Evidence。Listing / Review / Publish 的持久化尚未迁移，但模板输入、版本和事实修改后的失效信号来自服务器。

## 2. 文件与模型

主要新增：

- `shared/facts.ts`：从原 mockApi 提取基础事实、来源、人工核对、商品有效视图和定价纯函数，供服务端与离线版共用。
- `server/services/facts.ts`：归属检查、V1/V2 创建、快照、人工操作、下游失效和模板入口。
- `prisma/migrations/20260908020000_fact_authority/migration.sql`：在已有数据库上增加 Product revision 绑定，约束每个 task/product/version 一张当前事实卡。
- `server/tests/facts.test.ts`、`tests/server-facts.spec.ts`：服务端与浏览器验收。

扩展 `apiClient.ts`、`mockApi.ts`、共享契约及原类型；更新 API 路由、目录预览、推荐使用的商品视图、能力说明。五个工作区布局保持不变。CSV 导出增加一次服务端事实版本检查。

复用已有三张表，没有第二套事实状态表：

| 模型 | 当前保存 |
| --- | --- |
| FactCard | userId、taskId、productId、version（1/2）、revision、productRevision、时间 |
| Fact | key、value、source、anchor、status、listingAllowed、revision、时间；metadata 保存 label、valueType、sourceKind、源文件位置、previousValue、previousSource、confirmedAt |
| Evidence | factCardId、kind、source、data、revision、时间；data 保存文件名称、位置、提取值及来源类型 |

FactCard 的 version 对应 V1 / V2，不另加重复 cardType。外部 Fact DTO 使用原 `allowed` 字段映射数据库 `listingAllowed`。来源继续使用 `supplier / mock / manual`，UI 分别展示供应商文件、模拟证据、人工确认。

## 3. V1、V2 与来源

选择商品或打开 Fact Review 后，前端请求服务端幂等创建 V1。V1 包含 11 个字段：color、capacity、material、straw、countryOfOrigin、packagingWeight、packageLength、packageWidth、packageHeight、supplierCost、declaredValue。

真实导入来源保存 fileName、sheetName、rowNumber、fieldName，同时保留可读 anchor。内置商品保留原 Demo 来源，标记为 Mock，不伪造真实文件。

Materials 中尚未进入任务的商品详情使用 API 从 Product 生成的只读基础事实预览；只有选择 / Fact Review 动作才写入任务事实卡，seed 不批量创建事实。

Analyze 调用后端 MockEvidenceProvider，保存 V2：复制基础事实，再增加包装内含、表面工艺、杯盖、防漏宣称。创建 V2 不修改 V1；重复 Analyze 不覆盖已有 V2 的人工决定。

主角 SKU 的原演示兼容规则保留：部分增强事实直接 Confirmed；其他商品增强字段默认为 Requires Confirmation。无依据防漏宣称不能编辑或确认进入允许列表。PDF / 图片仍是预置证据元数据，没有解析真实 PDF 或图片。

## 4. 人工操作与历史

| 操作 | 服务端结果 |
| --- | --- |
| Edit / Add | 校验值，保存 Requires Confirmation，allowed=false，revision 递增 |
| Confirm | 非空且有效才能确认；保存 Confirmed、人工来源、confirmedAt；只有消费者文案字段允许使用 |
| Reject | 保存 Rejected、allowed=false，revision 递增 |
| Missing | 空值或缺值不能直接 Confirm |

数字沿用原正数 / 非负数、单位和长度校验。包装重量 0、负数、非法数值都不能保存。

`previousValue` 保存上一次值；`previousSource` 保留原始供应商 / Mock 来源；当前来源为 Manual confirmation。历史保存在 Fact.metadata 中，数据库 updatedAt 与 confirmedAt 分别表达修改、确认时间。不是完整审计日志。

基础字段的人工变更同步到 V1 与 V2 的基础副本；增强字段只改变 V2。创建或修改增强字段不覆盖 V1。Product 的原始供应商字段保持不变。

## 5. 新增 API

均要求 Cookie 认证，并检查 task / product / card / fact 的用户归属。首次创建事实卡需要已有 selected 或 fact_review 关系。已有历史卡可以在所属任务下读取。

```text
GET  /api/tasks/:taskId/products/:productId/fact-snapshot
GET  /api/tasks/:taskId/products/:productId/fact-cards
GET  /api/tasks/:taskId/products/:productId/facts
GET  /api/tasks/:taskId/products/:productId/evidence
GET  /api/tasks/:taskId/fact-snapshots
POST /api/tasks/:taskId/products/:productId/fact-cards/v1
POST /api/tasks/:taskId/products/:productId/analyze
PATCH /api/facts/:factId
POST /api/facts/:factId/confirm
POST /api/facts/:factId/reject
POST /api/tasks/:taskId/products/:productId/listing-template
```

Snapshot 返回 v1、v2、effective facts、evidence、商品视图、pricing、pricingReadiness、listingReadiness、factsRevision 和 downstreamInvalidated。模板接口只接受平台、文案版本及 expectedRevision，不接受浏览器提交的事实数组或定价。

## 6. 版本、定价与下游失效

- Product revision：供应商记录版本，存入创建时的 FactCard.productRevision。
- Fact revision：单字段每次 Edit / Confirm / Reject 递增。
- FactCard version：基础 V1 / 增强 V2；revision 表示该卡的当前修订。
- factsRevision：同 task/product 的 V1、V2 revision 最大值。创建 V2 或每次人工操作后单调递增一次；只更新实际受影响卡的 revision。
- 写操作携带 expectedRevision；旧版本返回 `409 facts_changed`，不会覆盖较新事实。
- Listing.factRevision：记录本次模板使用的服务端 factsRevision。

定价由服务端已确认的包装重量、尺寸和成本计算。缺重量 → 补 0.42 → 保存待确认时仍 Blocked → Confirm 后 Ready。内置缺重量 SKU 得到 USD 19.20，样例导入的缺重量 SKU 得到 USD 18.90；若确认采购成本为 12，按原模拟假设得到 USD 23.00。不是所有商品都固定 19.99。

定价版本只随定价依赖字段的修订变化。修改颜色会影响文案和审核，但不改变定价版本。原主角选择流程仍在 Analyze 后展示定价；Fact Review 支线可立即展示定价是否阻断。

Edit / Confirm / Reject 在同一数据库事务中调用 `invalidateDownstream`，删除相关 ListingDraft，级联删除其 ReviewResult / PublishResult。即使当前这些业务主要存在浏览器，后端失效钩子已可实际执行，并用预置数据库记录做过测试。

变更 API 返回 `downstreamInvalidated: true`，前端据此清除两个平台的文案、审核和发布结果。重新加载时比较 factsRevision；生成、修订、审核、发布、CSV 导出前重新读取快照，避免另一客户端修改事实后继续使用旧结果。没有实现实时推送；另一个已打开页面会在刷新或业务动作时同步。

## 7. localStorage 兼容与离线

Full Demo 的 V1/V2 和目录快照只是兼容性缓存，初始化用 API 覆盖。`factEdits` 清空，不用于合成服务端事实。清空所有 localStorage 后，服务器选择关系、事实卡、人工确认和 Evidence 均可恢复。

旧会话只有浏览器事实时，依据数据库 Product / TaskSelection 创建 V1；旧的增强事实和人工决定不自动导入，需要重新 Analyze / Review。损坏缓存会回到 Materials 空选择界面，不删除数据库任务或事实，用户可重新选择进入。

仍由浏览器保存：页面位置、语言、平台选择、文案、审核与模拟发布。账户退出后不混用其他用户的缓存。

`?mode=local` 与独立 competition 构建保留原本地事实流程。它们不会请求本轮 API；离线数据不会被自动上传为 Full Demo 事实。

## 8. 验收与真实调用边界

实际执行：

```bash
node scripts/generate-prisma.mjs
npm run db:migrate
npm run typecheck
npm run build
npm run test:server
npm run test:e2e
npm run build:local
npm run security:check
npm run dev
```

本轮新增 8 项服务端测试，覆盖 V1 幂等、真实 XLSX / CSV 来源、V2 独立性、待确认与定价、人工历史、允许列表、下游级联失效、过期版本和跨用户隔离。

新增 5 项浏览器测试，覆盖中英文补齐后清空 localStorage 恢复、伪造事实无效、旧会话兼容、另一客户端变更后禁止旧审核发布，以及已发布缓存禁止导出过期 CSV。原有 32 项测试保留，包含原主线、缺重量支线和离线完整发布路径。

最终结果：TypeScript、前后端 build、独立离线 build 和 security check 均通过；**22 项服务端测试、37 项 E2E 全部通过（E2E 1.6 分钟）**。另在日常 5173 页面实际完成登录、上传 XLSX、中文补 0.42 / Confirm、USD 18.90、清空 localStorage 后事实恢复。

实拍截图：[初始缺失](../artifacts/server-facts/01-missing.png)、[保存后仍待确认](../artifacts/server-facts/02-pending.png)、[确认后定价可用](../artifacts/server-facts/03-confirmed.png)。普通测试全部禁用真实 AI；Provider transport 使用 Mock。本轮没有运行 live smoke、没有启用 AI_LIVE_ENABLED，真实调用新增为 **0**。主开发库上一轮的两条 AiCall / 101 tokens 历史记录保留。

## 9. 实际演示

1. `npm run dev`，打开 `http://localhost:5173`，使用页面提供的 Demo 账户登录。
2. Materials 查看 `LM-KT-BTL-005-BLK-500` → Review Facts。
3. 包装重量 Missing / Pricing Blocked → Add Value 输入 `0.42` → Save Value。
4. 此时仍 Needs confirmation / Pricing Blocked；点击 Confirm 后显示人工来源、Confirmed、USD 19.20。
5. Analyze → 查看 V1 保留和 V2 增强字段 → 继续模板文案、审核和发布。
6. 清空 localStorage 后重新进入 Evidence，可看到服务端已保存的事实。
7. 主角可继续 XLSX / CSV → Top 1 → Analyze → Amazon 风险拦截 → 修订重审 → 发布 → CSV。

下一轮接 Qwen 业务前，仍需决定 Listing / Review 的服务端保存与授权、模型输入输出 schema、失败回退、预算入口，以及独立效果评估。本轮没有实现 Qwen Recommendation / Listing / Review，也没有真实平台发布或物流税费服务。
