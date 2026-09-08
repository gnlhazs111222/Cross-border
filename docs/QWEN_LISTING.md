# PrismLaunch Qwen Listing 交付说明

本轮基于 `5bccb06`，在 `full-demo` 分支实现 QwenListingProvider。比赛标签与离线回退保留。只增加 Qwen 文案生成，没有实现 Qwen 推荐、证据提取、语义审核或真实平台发布。

## 1. 调用与保存

```text
ListingService：从 SQLite 读取当前任务、商品和事实版本
  → ListingProvider
      ├─ TemplateListingProvider（默认）
      └─ QwenListingProvider
          → TextModelProvider.generateStructured
          → BailianTextModelProvider / OpenAI JS SDK
          → JSON / Zod / Fact authorization
          → 成功：Qwen 文案
          → 失败：Template fallback
  → 重新检查 factsRevision 与 listingVersion
  → ListingDraft / SQLite
  → 显式 Rule Review
  → 后端 Publish authorization
```

生成请求在 SQLite 事务外执行，避免等待模型时占用数据库写事务。模型返回后再次检查版本；期间事实或文案已经改变时返回 409，不把旧输出写入新版本。这里的版本冲突不会被伪装成生成成功。

## 2. 配置与调用控制

默认配置见 `.env.example`：

```dotenv
LISTING_PROVIDER=template
AI_LIVE_ENABLED=false
BAILIAN_TEXT_MODEL=qwen3.6-flash
BAILIAN_LISTING_MAX_TOKENS=1800
```

只有 LISTING_PROVIDER=qwen、AI_LIVE_ENABLED=true 且后端 Key 存在时才调用 Qwen。请求 Qwen 但开关未开启或 Key 缺失时，返回带原因的 template_fallback。明确选择 template 时不创建模型请求。

普通开发与测试保持模板模式。自动测试强制禁用 Live、清空 Key、使用 Mock transport；本轮没有自动调用 qwen3.7-plus、qwen3.8-max 或其他供应商模型。

原每进程调用预算与 SDK 零重试保留。Listing 单次输出上限默认 1800 tokens；原连接 smoke 仍使用原短输出配置。达到输出 token 上限也视为失败并回退。

## 3. Prompt 与结构

Prompt 位于 `server/prompts/listing-v1.ts`，版本 **listing-qwen-v1**。Amazon / Shopify 使用不同的格式要求，共用事实授权原则。

模型只接收服务端构造的：platform、market、category、去掉成本 / 利润要求后的 task requirements、商品身份、factsRevision，以及已确认且允许使用的消费文案字段。

ALLOWED_FACTS 进一步受字段白名单约束：color、capacity、material、straw、countryOfOrigin、packageIncludes、finish、lidType。仅给出字段、标签、值和泛化来源类别，不发送私有文件名、行号、previousSource、数据库用户 ID 或认证信息。前端不能提交任意 Facts 作为可信生成输入。

不发送密码、Cookie、Session、供应商成本、申报价值、包装重量尺寸、运费、关税，也不发送 Rejected / Missing / Requires Confirmation 的事实记录。

输出结构：

```json
{
  "title": "...",
  "bullets": ["..."],
  "description": "...",
  "attributes": {"Color": "Black"},
  "usedFacts": [{"field": "color", "value": "Black"}]
}
```

Zod 检查非空值与长度：标题最多 200 字符，描述最多 1500 字符，每条卖点最多 300 字符；Amazon 3–5 条，Shopify 1–5 条。拒绝额外顶层字段和不符合结构的内容。

## 4. 事实授权校验与边界

`validateGeneratedListingAgainstFacts` 在 JSON 校验后检查：

- usedFacts 的字段必须属于当前已确认且允许的字段，不能重复或引用内部商业字段。
- 值须一致；允许确定性的大小写 / 空白规范化，以及已有容量文本中的 ml / fl oz 分项，不让模型自行发明换算。
- attributes 的键必须对应允许字段的 key 或 label，值与授权值匹配，不能加入未知属性或危险对象键。
- 拒绝 HTML、URL、内部商业内容、已知无依据绝对宣称和性能 / 认证词。
- 拒绝没有授权依据的新数值，以及常见颜色、材质、吸管规格冲突。

这是一组有限、保守的规则，**不是完整语义事实核验或平台合规认证**。usedFacts 也不是模型真实性的独立证明。未知表达、复杂否定、未覆盖的性能暗示仍可能需要人工复核；不把两次通过样例描述成模型永不幻觉。

失败输出不会保存成正常 Qwen 草稿。模型请求已成功但业务授权失败时，也会将对应 AiCall 标为失败并记录安全错误码。

## 5. Fallback 与 metadata

Live 关闭、缺 Key、预算不足、超时、HTTP 错误、空结果、非法 JSON、Zod 失败、输出 token 截断、未授权事实、规格冲突或其他 Provider 错误，均使用确定性模板继续流程。

ListingDraft.generationMode 为 template、qwen 或 template_fallback。已有 JSON data 保存 generation metadata：provider、model、promptVersion、inputHash、fallbackReason、aiCallId、cacheHit。factsRevision 继续使用原 factRevision 字段。

fallbackReason 只使用允许的错误码，不显示完整上游错误、请求头或 Key。回退时页面明确说明模板草稿已就绪，可继续审核。一次失败不会永久改掉全局 Provider 配置。

AiCall 增加 nullable promptVersion / inputHash，通过增量 migration 完成；没有新增第二套 Listing 数据表。

## 6. 缓存

Qwen Provider 使用每进程最多 100 条成功结果的内存缓存，并合并同时到达的相同请求。

SHA-256 key 包括平台、市场、类目、任务需求、商品身份、规范化允许事实、factsRevision、promptVersion 与 model；不含 userId、密码、Cookie、Session 或事实数据库 id。同一输入可以复用结果，但返回的 Fact Sources 始终用当前用户自己的事实记录重建。

事实值 / 版本、Prompt 版本、模型或平台变化都会 cache miss。失败和 fallback 不缓存。缓存命中不新增模型请求或 AiCall，metadata 指回原调用并标记 cacheHit。重启后缓存清空；这是轻量演示缓存，不是持久化计费缓存。

## 7. Review、风险注入与版本

正常 Qwen 文案不自动加入 `100% leakproof`。Template Demo 原首次风险注入保留；请求 Qwen 后发生模板回退也不自动加入风险。

新增显式 `Inject Demo Risk / 注入演示风险`：创建新文案版本，标记 riskDemoInjected，清除旧审核与发布。UI 明确说明是演示操作，不声称 Qwen 自动产生了该错误。该端点只在非生产模式开放，并验证用户与版本。

为了让合法 Qwen 改写能够继续审核，同时保持原规则机制：

- 服务端保存通过 schema + authorization 校验的原始 Qwen 输出作为私有比较基准，绑定 factsRevision / inputHash；普通 Listing DTO 不返回这个基准。
- RuleReviewProvider 仍检查 R001，并把当前文案与该已校验基准比较；后续人工改写不能改变基准，差异继续触发 R002。
- 运行 Review 是独立动作，生成成功不等于 Review Passed。
- Apply Suggested Fix 使用当前事实的安全模板，创建 template 新版本，仍须重新审核，不额外调用 Qwen。
- 发布仍检查版本、当前事实、有效审核与高风险问题，不能由 AI 绕过。

这没有实现 QwenReviewProvider，也没有通用语义审核。它只是把规则比较的参照从固定模板扩展到服务端已校验的 Qwen 原始文案。

## 8. 界面与 Capabilities

按本轮限制只添加轻量生成来源提示、折叠详情与显式风险按钮。沿用绿色 B2B 工作区，不重设计 Listing Studio。使用 ui-ux-pro-max 的状态反馈、键盘焦点、文字可读性和小屏检查指导；生成来源同时用文字说明，不仅依赖颜色。

`/api/capabilities` 的 listing.liveImplemented 现为 true，liveModel 返回当前配置。只有选择 qwen 且开关 / Key 满足条件时 activeProvider=qwen；其余为 template。默认模板和离线能力说明继续明确当前没有调用 LLM。

已查看真实保存的两份 Qwen 草稿：中文桌面与英文 375px 手机无页面横向溢出，Prompt / factsRevision 可展开查看。查看结果没有重复调用模型。

## 9. 验证与真实调用

最终本地检查：TypeScript、前后端 build、独立离线 build、security check 通过；**55 项服务端测试、44 项 E2E 通过**。相较上一轮新增 25 项服务端测试和 3 项 UI 测试。

覆盖输入过滤、schema、授权与冲突、缺 Key / Live 关闭 / Template 模式、超时、HTTP 错误、空结果、非法 JSON、token 上限、预算、任意 Provider 异常、模型结果缓存、不同用户的来源重建、平台隔离、规则审核、显式风险注入和生成期间版本改变。

UI 中 Qwen / fallback 显示的专门自动测试使用明确标注的响应 fixture；Provider 与 SQLite 全链路使用 mock transport。真实输出另外通过下面的手动验收检查，不能把 UI fixture 当成真实 API 结果。

实际真实验收及完整统计见 [QWEN_LISTING_VERIFICATION.md](../artifacts/full-demo/QWEN_LISTING_VERIFICATION.md)：本轮仅 **2 次 qwen3.6-flash、2311 tokens**，两平台均成功、无 fallback；累计为 4 次 / 2412 tokens。

## 10. 使用方式

默认启动仍不消耗真实 AI：

```bash
npm run dev
npm run ai:listing-smoke
```

显式 live 验收命令如下。当前两平台成功记录已存在，再次执行会跳过已完成平台；本轮不要重复验证。

```bash
LISTING_PROVIDER=qwen AI_LIVE_ENABLED=true NODE_TLS_REJECT_UNAUTHORIZED=1 npm run ai:listing-smoke -- --live
```

脚本还支持 `--platform amazon` / `--platform shopify`，并按数据库 listing_generation 调用计数设置六次验收上限。Key 始终从后端环境读取，脚本不打印凭据。默认 `.env` 未被改为 Live。

想查看已保存的真实 Qwen 输出而不再次付费，可在 5173 登录本地验收账户 `qwen-listing-smoke@prismlaunch.local`，密码 `Demo123456`，进入文案工作室查看两个平台。此账户仅为本地 Demo seed 类用途；查看和审核不发模型请求。在默认 template 配置下重新生成会得到模板版本。

后续真正开启业务 Qwen，需要服务端以 LISTING_PROVIDER=qwen、AI_LIVE_ENABLED=true 和已有 Key 启动；不要给前端放 Key。

下一轮 Qwen Review 仍缺独立标注样例、误报漏报评估、语义规则边界、证据冲突策略和人工复核标准。本轮到此停止。
