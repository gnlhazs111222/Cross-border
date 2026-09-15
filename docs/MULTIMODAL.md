# 多模态模块：图片文字与事实核对（业务流程图模块 4）

对应 `01_业务流程图.html` 的模块 `truth`：**多模态解析与事实卡更新**，上游是智能检索与上新推荐，下游接售价计算、受控 Listing 生成与平台审核。

## 1. 这个模块回答什么

一个问题：**商品图片上印的文字，和我们手上的商品事实一致吗？**

同一个面板（Evidence & Facts 页的「核对与报警」）还随行核对另外两件事：**质检报告**与**运输属性申报**。三条核对遵守同一条规矩——**正常就静默，异常才报警**，报警必须由人处置并留下记录（见 §6）。

它的边界由流程图里的模块 guard 定死，代码按同一口径实现：

- 是图片识别与图片文字—资料核验的**唯一**模块；导入阶段只解析表格字段、建立图片资源关联，不做图片识别（见 `grill-me_逻辑冲突审问与修订记录.md`）。
- **不修改 v1 基础事实**。核对结论只标注在任务级 v2 卡片上，v1 必须逐字节保持供应商交付时的样子（有测试断言守着）。
- **不把图上印字当证据升级结论**。印字只是供应商自己的宣称：性能（保温／防漏／承重）、认证、安全合规一律不给结论，模型要是给了，结论会被直接丢弃。材质与产地可以核对（图上印 `SUS304`、`Made in China` 与事实相符就记「一致」），但那只是"宣称与事实相符"，不等于事实被证明。
- 流程图 guard 禁止的是把**视觉印象**伪造成材质／原产国／性能／认证／安全；本模块读的是供应商自己印在瓶身／包装上的**文字**（`SUS304`、`Made in China`、`500 ml`），只标记"印字与事实是否相符"。两者不冲突：印字是宣称，不是证明。
- **不自动确认任何东西**。所有结论都是"给人看的标注"，图片上新读到的文字只能成为待确认候选。
- 不生成 Listing、不给可发布结论。

## 2. 什么时候跑

1. **随「Analyze Evidence」自动跑一次**：创建 v2 时顺带核对一遍，和事实卡一起产出。
2. **「Re-check printed text」按钮**：只重跑图片文字核对，不重建事实卡。换图、补图之后用它，不会丢掉已有人工确认过的 v2 数据。

两个入口都在 Evidence & Facts 页。服务端 `POST /api/tasks/:taskId/products/:productId/analyze` 与 `POST .../image-check`。

## 3. 传输范围（成本与隐私）

云端多模态模型只收到**当前选中 SKU 的最小必要图片**：

- 只取该 SKU 自己的图片，按 `main → detail → packaging → spec → other` 排序，最多 4 张、合计不超过 6 MB；超出部分记为 `skipped` 并写明原因。
- 只发消费者可见字段；`supplierCost`、`declaredValue` 这类内部数字不进入模型输入。
- 每次核对都在证据里留下**传输清单**（文件名、字节数、sha256）与调用日志（`aiCall`，`purpose=image_check`）。离线模式传输清单为空数组，因为确实什么都没发出去。

## 4. 判定与写回

每条结论是一个字段级判定：

| 判定 | 含义 |
| --- | --- |
| `agree` | 图上印的文字与事实值相符（比语义不比拼写：`500 ml` 与 `500ml / 16.9 fl oz` 算相符） |
| `differ` | 图上印的是别的值（不同数字／型号／材质名／国别），并记录图中原文 |
| `not_visible` | 照片里没有这句话 |
| `unreadable` | 有字但糊／被裁切／反光，读不出来 |
| `not_checked` | 离线模式没读图上文字，需要人或视觉模型看一眼 |

`agree` 有一条确定性底线，管的是**事实里没有数字、图上却印了数字**这一种情况：事实说「整体」（纯钛、全铜、Pure Titanium），图上写同样的整体（`钛含量 =100%`、`100% 纯钛`）算相符；图上只写出一部分或一个下限（`钛含量 >99.8%`、`99.8% titanium`）就不算相符——那是图上多出来的含量宣称，必须报到人面前（判定为 `differ`），不能因为模型说“意思差不多”就归档成相符。事实里本来就没有「整体」含义时（`Stainless Steel` 遇上 `SUS304`），图上多出来的型号/等级同样报 `differ`。两边都带数字（或都不带）时仍按模型的语义阅读——`500 ml` 与 `500ml / 16.9 fl oz`、材质清单换个顺序书写，都仍然算相符。

**这条底线只在模型给出结论时才生效**，所以提示词（`multimodal-v3`）另外要求覆盖：读得到的字不许跳过——图上印了某字段的字样就必须给出该字段的结论（`agree`／`differ`／`unreadable` 且带原文引用），`not_visible` 只用于图上真的没有这个字段；**材质含量与等级（`钛含量 >99.8%`、`100% 钛`、`纯钛`、`SUS304`、`316不锈钢`）一律算 materialMark**，不能当成宣传标语略过。整张图一条结论都没给时，证据卡里会点名写下 `…: the reading returned no finding for any fact.`，避免“模型没读到”看起来像“图片与事实一致”。

写回规则：

- 判定作为 `imageCheck` 标注挂在 **v2** 对应事实上（Fact Review 表格新增「Picture text check」列 + 汇总行，并显示图中原文）。同一字段多条结论时，`differ` 优先于 `agree`，高置信优先。
- **一次核对拥有它自己写下的标注**：重跑时，这次没有比对到的字段，上一次留下的 `imageCheck` 会被清掉——否则卡片会一直挂着一条早就不是这次结论、也没人再核对过的判定。离线模式不受影响：它本来就会给每个可核对字段写一条 `not_checked`，那是它这次的真实结论。
- **汇总行只统计真的有结论的字段**（`agree`／`differ`／`not_visible`／`unreadable`）。`not_checked` 不是结论，不进汇总；哪个字段没核对到，看表格里那一行的徽标。
- 不改 value、不改 status、不自动确认。**`agree` 行保持原样**，只标徽标与图中原文（正确的先不动）；**`differ` 行直接在列里写出问题**——引号里是图中印字、紧跟着是我们手上的值——并给出三个处置按钮，见 §5。
- **只判文字，不判外观**：颜色观感、表面工艺、包口、肩带这类纯外观属性不再是核对目标；`agree`／`differ` 必须带图中原文引用，没有引用直接丢弃。
- **一致 ≠ 被证明**：即使图上印着 `SUS304`，也只记「一致」，仍需人工确认，且不会自动进入文案。
- 图片上看得见、但表单里没有的信息（如杯身印刷文字）做成 `imageVisibleText`／`imagePackagingMark` 候选写进 v2，状态 `Requires Confirmation`、不允许进入文案；人已经拥有的字段永不被机器覆盖。
- 每次核对写一条 `image_check` 证据（协议、模型、传输清单、逐条结论），在 Evidence & Facts 页可以点开看。重跑是**替换**自己那条证据，不是追加。

## 5. 不一致怎么裁决

`differ` 不是模块自己能决定的事。**问题就在核对处直说，只给三个答案**：

核对面板里，`differ` 那一行直接写出不一致：**两边换算到同一套单位**再显示，例如「容量：图中 “8.8 fl oz”（原印 260ml），事实 “25.4 fl oz”。」——单位按界面上的单位切换（美制／英制／公制）走，图和事实永远在同一套单位里比较；换算后会变数的地方用括号补上图上原文，数字没变的（例如 “260ml” 显示成 “260 ml”）就不重复。数字无法换算的一列（例如 `400ML/600ML/1000ML/1500ML/2000ML` 这种一串尺寸）按图上原文显示，不硬取第一个数。下面跟三个按钮：

| 选项 | 做什么 |
| --- | --- |
| **直接保存图中印字** | 把图上文字写进 v2：**这个处置本身就是确认**——状态 `Confirmed`（文案字段同时允许进入文案）、原值存为 `previousValue`、来源记为图片，并使下游 Listing／审核／发布失效。文案工作室不会再为它要第二次确认 |
| **修改后保存** | 打开事实编辑弹窗（标题变成「修改有争议的取值」），由人改成第三个值再保存；同样直接记为 `Confirmed`；服务端校验取值合法，非法值返回 409 `invalid_fact` |
| **放弃该图** | 这张图从本 SKU 的核对里剔除：记一条 `CheckDecision{target:image_text, ref:文件名}`（含处置人与时间）在**商品**上；清掉它贡献的 `imageCheck` 标注，并且**它凭空带来的候选字段**（`imageVisibleText`／`imagePackagingMark` 这类，`sourceKind=image` 的机器观测）**随图一起删除**——卡上原有的字段只清标注、不删行。之后**重跑不再读取也不再发送**这张图，证据 notes 里写明 `Dropped from the check by a recorded human decision` |

三个动作共用一条路由 `POST /api/tasks/:taskId/products/:productId/check-decisions`（`server/services/checks.ts`；前端 `src/services/apiClient.ts` 的 `facts.checkDecision`），请求带 `expectedRevision` 做乐观锁，陈旧版本返回 409 `facts_changed`。决定记在**商品**上（`checkDecisions`）与事实卡上，换图、重跑都带不走它。

**图片不一致不进 Materials 的待裁决队列。** 那张队列表（「Rows waiting for a decision」）只回答「**上传的供应商文件错在哪**」——导入的冲突、缺字段、可疑行。图片的处置就在核对面板里、挨着它的证据做（见 §6 的图片信息核对列），早先版本排进队列的 `mode=image_check` 行会在下一次核对时被清掉。这样一页只问一件事，不会把两种完全不同的问题混在一张待办里。

对一个没有争议的字段做这些动作，服务端返回 409 `not_a_dispute`，不会被静默吞掉。

`agree` 行**保持原样**：徽标 + 图中原文引用，不加按钮——正确的先不动。

## 6. 核对与报警：质检报告与物流属性

证据与事实页的顺序是：**「核对与报警」在最上面** → 「定价计算」→ 「事实卡对照」（默认收起，点开是 V1／V2 逐字段并排）。同一个「核对与报警」面板（`src/components/CheckAlerts.tsx`）列出三条核对，遵守同一条规矩：**正常一律静默**（灰字一行说明现状），**只有异常才报警**（红／琥珀 notice + 处置按钮）。

面板是一张表，格式与下方的事实核对表一致：**表头一行放三个核对，一个核对一列**（图片信息核对｜质检报告｜物流属性确认），下面一行是每列的内容——这条核对查出了什么、以及关掉它要点的按钮。**「图片信息核对」这一列再分两个子列：证据描述 ｜ 操作**（一条证据一行字，对应的处置就在右边），另外两列因为本来就一句话 + 一个按钮，不再细分。报警的那一列整列按严重度着色（红／琥珀），列头带警示图标，标题徽标给出报警条数。窄屏（≤700px）时同一张表按列堆叠，用列头（含子列）当每块的小标题。前端报警与服务端发布门禁读的是同一份 `shared/checks.ts`，所以「异常」不可能有两套口径。

### 6.1 质检报告

数据来自供应商表格的 5 个可选列（`reportNo`／`reportResult`／`reportValidUntil`／`reportCapacityMl`／`reportMaterial`，见 `docs/ASSET_IMPORT.md`），解析后挂在 `Product.qualityReport` 上。`reportNo` 留空 = 这个 SKU 没有报告。**没有报告也可以直接在核对面板里提交**（「提交质检报告」→ 报告编号／结论／有效期，`POST /api/products/:id/quality-report`，落在商品行上），不需要为了补一份报告重新导入整张供应商表。

**质检报告是必须的：没有它进不了下一步。** 商品的 `qualityReport` 为空、或报告 `expired`／`mismatch`／`failed` 时，「继续到文案工作室」是关的（页头按钮禁用，路线图点「文案工作室」会被拦下并提示），直到提交一份可用报告、或按下面的处置把报警关掉。判定口径是 `reportClearsNextStep()`（`shared/checks.ts`）：**报告在档且 `publishBlocked` 为假**才放行。

| 判定 | 触发条件 | 面板表现 | 可否处置 |
| --- | --- | --- | --- |
| `not_registered`（无报告） | 商品上没有 `qualityReport` | 琥珀报警：`该 SKU 未提交质检报告，下一步保持关闭。` + 「提交质检报告」 | 提交一份即放行 |
| `not_registered`（被放弃） | 报告在档，但被人放弃过 | 静默：`报告 QA-001 已按人工决定不再参与核对。` | — |
| `clear` | 报告在有效期内，且报告声明的容量／材质与事实一致 | 静默：`报告 QA-001：已登记，有效期至 …，与商品事实一致。` | — |
| `expired` | `reportValidUntil` 早于今天 | 琥珀报警：`报告 QA-002 已于 2026-03-31 过期。` + 「提交质检报告」/「放弃该报告」 | 可换可放弃 |
| `mismatch` | 报告声明的容量或材质与事实不一致 | 红色报警：逐条写出「容量：报告写的是 “750 ml”，我方事实为 “500 ml”。」，每条一个「采纳报告值」，外加「放弃该报告」 | 可处置 |
| `failed` | `reportResult` = 不合格 | 红色报警：`报告 QA-003 结论不合格。` + 「提交质检报告」 | **不可放弃**，只能换一份合格报告 |

- 比较对象**任务卡优先**：有 v2 卡片时用卡片上的 `capacity`／`material`（容忍 `500ml / 16.9 fl oz` 取整为 500），没有卡片才退回商品行。
- 处置有两条：**采纳报告值**（写进 v2，仍需人工确认，不会自动进文案）或**放弃该报告**（记 `CheckDecision{target:quality_report}`，报警消失，决定留痕）。
- 发布门禁（`server/services/listings.ts` 的 `canPublishListing`）读同一份判定：`publishBlocked` 为真时草稿不能发布——不合格报告永久阻断，过期／不一致阻断到人处置完为止。发布门禁本身**不**要求「有报告」这一条（这一步卡的是流程入口，见上）；要连发布也一起卡，改 `shared/checks.ts` 一处即可。

### 6.2 物流属性确认

委托现成的 `HazmatNotice`（`shared/hazmat.ts`）：**已申报且无风险**时静默成一行 `已申报且无风险：无需运输资料。`；**禁区品**（`forbidden`）与**缺资料**（`needs_documents`）是报警，进「需要处理的核对」并给处置按钮。**易碎只是打包提示**（不阻断发布），所以它留在下面的「没有异常的核对」里，不占报警数。图片上的印字不影响这条判定——HAZ-004 是 `flammable`，图上写 `NON-FLAMMABLE` 也没用。

## 7. 离线模式与降级

- `MULTIMODAL_PROVIDER=local`（默认）：完全不读图片内容，只做**文件级**核对——表格引用了但图片库没收到的文件、同一张 sha256 被多个 SKU 复用（最便宜的"这张图可能不属于本商品"信号），其余属性一律 `not_checked`。绝不猜值。
- `MULTIMODAL_PROVIDER=qwen`：走视觉模型（`BAILIAN_VL_MODEL`，默认 `qwen3.7-plus`），需要 `AI_LIVE_ENABLED=true` 与 `BAILIAN_API_KEY`。
- 真实调用失败不会让事实卡失败：结果**降级为离线判定**，证据里记 `fallbackReason` 与失败的错误码，模式记为 `local`，绝不谎称视觉模型看过图片。
- 测试环境强制 `local`，自动化测试不发真实请求。
- 证据区只展示真实存在的内容：一条供应商表格，加图片文字核对产出的 `image_check` 卡。模拟的「规格 PDF / 商品图」两张证据卡已删除——文档与图片解析没有实现，不再展示不存在的提取结果。
- V2 里由 Analyze 追加的字段（包装内容、表面工艺、瓶盖／包口／肩带类型）统一标注为 `Mock analysis`：模拟分析 · 演示样例 · 未解析任何文件。

## 8. 代码位置

| 位置 | 内容 |
| --- | --- |
| `shared/multimodal.ts` | 合同与纯逻辑：判定枚举、可核对文字字段 `IMAGE_TEXT_FACT_KEYS`／禁区字段 `IMAGE_EXCLUDED_KEYS`、候选字段、离线判定、资源核对、证据文本 |
| `server/prompts/multimodal-v2.ts` | 系统提示词与输入构造（读图上印字并与事实比对；按原样引用、比语义不比拼写） |
| `server/providers/multimodalValidation.ts` | zod 输出合同与结论清洗：丢弃引用未发送图片、提问不了的属性名、禁区字段、未知字段、重复项，以及没有原文引用的 `agree`／`differ`（单条不合法只丢这一条，不让整次调用失败） |
| `server/providers/multimodal.ts` | `LocalImageCheckProvider` / `QwenImageCheckProvider` |
| `server/providers/multimodalRuntime.ts` | 运行时工厂，模式来自配置 |
| `server/services/multimodal.ts` | `runImageCheck`（取图、传输清单、调用）／`storeImageCheck`（写回 v2、证据、排队）／`applyImageCheckResolution`（裁决落地） |
| `shared/checks.ts` | 质检判定与处置日志（同构：前端报警与服务端发布门禁共用；`assessInspection`／`inspectionTargets`／`ignoredRefs`／`appliedFactDecision`） |
| `server/services/checks.ts` | `POST .../check-decisions` 的落地：采纳印字／手改／放弃图片／放弃报告，带 `expectedRevision` 乐观锁 |
| `src/components/CheckAlerts.tsx` | 「核对与报警」面板：三条核对，报警在上、无异常在下 |
| `src/components/FactReview.tsx`、`src/pages/EvidenceFacts.tsx`、`src/components/ImportReview.tsx` | 事实卡对照（V1｜V2 逐字段并排，改动标出，逐字段 编辑／确认／拒绝）、证据卡与重跑按钮、上传队列文案 |

## 9. 测试

`server/tests/multimodal.test.ts`（10 条，全部不发真实请求，用假 transport 顶替模型）：

- 离线模式不读图片内容、不动 v1、如实报告持有与缺失的文件；
- 表格引用了没上传的图片会被点名，跨 SKU 复用同一张图片会被提示；
- 真模型路径里，禁区字段（性能／安全／认证／成本）结论与被引用但未发送的图片结论都会被丢弃，`differ` 落在事实卡上、不进上传队列；
- 图上印的材质／原产国可以与事实「一致」，但那只是标注；没有原文引用的 `agree`／`differ` 会被丢弃，图中新读到的文字只成为待确认候选；
- 「保留资料值」什么都不改；「采纳图中印字」只写 v2、保持待确认、不允许进文案，且图片文字核对不能另建商品；
- 重跑替换证据、清掉未裁决行；真实调用失败时降级为离线判定；
- 名字像生图模型（`qwen-image-*` / `wan*-image`）的配置会在启动时被点名 warning，名字本身照原样透传（warning 是提醒，不是偷偷改写）。

`server/tests/checks.test.ts`（15 条）覆盖本轮新增的核对与报警：

- 质检判定纯逻辑 7 条：未登记静默、在档且一致为 `clear`、过期、不合格不可放弃、容量不一致、材质不一致、被人工放弃后不再报警；
- 处置路由 8 条（API 集成）：`adopt_printed_text` 写 v2 并关掉队列行、`edited` 手改、`discard_image` 记决定／清标注／重跑不复活且 `by` 是当前账号、陈旧 `expectedRevision` 返回 409、空 asset 返回 400、不存在的报告返回 404、`discard_report` 落库、`edited` 走导入裁决路由返回 400。

```bash
NODE_ENV=test AI_LIVE_ENABLED=false BAILIAN_API_KEY= node --import tsx --test server/tests/*.test.ts
```

全量服务端测试 **217 条全绿**。

## 10. 视觉模型（已确认）

当前选用 **`qwen3.7-plus`**（`BAILIAN_VL_MODEL`）。这是实测确认的，不是按名字挑的：

- 端点 `GET /models` 只声明 23 个模型，整份清单留痕在 `.local/vision-smoke-models.json`：**没有任何 `-vl` / `-omni` 专用视觉模型**。
- 清单里的 `qwen-image-2.0`、`qwen-image-2.0-pro`、`wan2.7-image`、`wan2.7-image-pro` 是**生图**模型。名字里有 image，但收到带图的 chat 请求会被直接拒掉：`bailian_http_400`，报文 `Either 'text' or 'image' must be provided, but not both.`。用它们做图片核对**永远失败**，而且看起来像"网络/接口坏了"。
- **`qwen3.x` 系列是多模态的**，接图正常：实测 `qwen3.7-plus` 对一张 64x64 PNG 返回 200 并给出 finding。自检脚本的候选顺序：`qwen3.7-plus` → `qwen3.6-plus` → `qwen3.8-flash` → `qwen3.6-flash`。
- 图片长宽必须大于 10px，1x1 会被拒（`The image length and width do not meet the model restrictions. [height:1 or width:1 must be larger than 10]`），自检脚本因此运行时合成一张 64x64 PNG，而不是手贴 base64。
- `qwen3.8-max` 也是 `qwen3.x`，但被本项目的 premium 守卫挡住（`premium_disabled`），**不能**用来读图。

`.env` 里的三行（`BAILIAN_VL_MODEL` 的缺省值也已经是它）：

```
BAILIAN_VL_MODEL=qwen3.7-plus
MULTIMODAL_PROVIDER=qwen
AI_LIVE_ENABLED=true
```

换模型只改 `BAILIAN_VL_MODEL` 一行并**重启 API**：`tsx watch` 只监听源码、不会重载 `.env`，不重启的话页面「当前生效服务商」还会显示旧模型。重启后 `GET /api/capabilities` 的 `evidence.liveModel` 会跟着变，用它确认最省事。

配置里写了生图模型名时，`createMultimodalRuntime()` 会在启动日志打一条 warning（`looks like a picture-generating model`），免得下次再把 400 当网络问题排查。

### 自检脚本（可选）

`npm run ai:vision-smoke` 走**真实的 `QwenImageCheckProvider`**，发一张运行时合成的 64x64 PNG 做一次极小核对调用，用来确认模型名在当前端点确实能通：

```
npm run ai:vision-smoke                                        # 空跑，不发请求
npm run ai:vision-smoke -- --live                              # 试 4 个候选，每个一次调用，失败不重试
npm run ai:vision-smoke -- --live --models qwen3.7-plus        # 只试指定模型
npm run ai:vision-smoke -- --live --write                      # 顺手把胜出的模型写回 .env
```

- 先 `GET /models` 把端点声明的模型全部打印出来并写入 `.local/vision-smoke-models.json`，再逐个试；只有名字匹配 `/vl|vision|omni/` 或以 `qwen3.` 开头的才当候选。
- 失败原因打印成错误码：`bailian_http_404` 模型名不在本端点、`bailian_http_400` 该模型不吃带图请求、`bailian_auth_failed` Key 不对、`bailian_timeout` / `bailian_connection_error` 网络问题。
- 结果留痕 `.local/vision-smoke-last.json`（只有模型名、成败、错误码、耗时，没有密钥、请求体与原始响应）。
- 不写 `aiCall` 审计行：它是配置检查，不是业务运行。

真调用失败时结果**降级为离线判定**并在证据里写明错误码，模式记为 `local`，事实卡不会因此失败。

### 面板上的五种状态

面板不把「没跑」「没图」「图被放弃」「没读成」「读成了」混成一句话，`shared/checks.ts` 的 `assessImageText()` 把证据里的 `image_check` 归成五类，`src/components/CheckAlerts.tsx` 的「图片信息核对」列按类渲染（每次运行都把**图库里那张被放弃的图**以 `status: 'dropped'` 列在证据里，所以面板说得出「图在、只是退出了核对」）：

- `not_run`：还没有证据 → 灰字「尚未核对。」
- `no_pictures`：该 SKU 图库里一张图都没有 → 琥珀色报警 + 「去 Materials 上传图片」。**图片必须先上传到图库**，只把文件名写进表格的图片列不算：服务端只送已上传的 asset。
- `dropped`：图库里有图，但**唯一的那张被人工放弃了**（`CheckDecision{target:image_text}`）→ 琥珀色报警「这张图已被人工放弃，不再参与核对。」+ 「恢复该图」（把那条决定撤掉，下次核对重新读取）。**这正是「明明有图片却说没有图片」的那个 bug**：早先被放弃的图被从证据里悄悄剔掉，面板只能看到「零张图」。
- `not_read`：有图，但一张都没送出去 → 琥珀色报警，并把 `fallbackReason`（如 `bailian_http_400`）跟在后面。
- `read`：确实读了图，这时才逐条列出不一致。


## 11. 演示素材（危险品样本图与质检报告样本）

`evaluation/asset-import-sample/hazmat-images/` 里有 5 张给危险品样本行配套的合成图（`npm run make:hazmat-images` 生成）。它们不是仿画，就是**商品池那张展示图**：瓶身、吸管、高光、小三角和卡片底色都来自 `src/components/ui.tsx` 的 `ProductVisual`（同一份路径数据），颜色取自同一张 `colorHex` 配色表，只是放大成整幅商品图：

- 每张都**故意**印上与本行事实不符的容量／产地，所以一定会有 `differ` 报警；HAZ-005 的 `MADE IN CHINA` 与事实「中国」相符，用来对照一条 `agree`。
- HAZ-001 画成粉色带吸管（申报 Black、无吸管）、HAZ-005 画成蓝色（申报 White 陶瓷）：连商品本身都不对。这类**外观**差异模块不报——它只读文字，这正是它 guard 里写明的那条边界。
- 每张还挂一句夸张标语（`KEEPS HOT 72H`、`BPA FREE`、`AEROSOL FREE`、`NON-FLAMMABLE`、`HAND PAINTED`）：这些词永远不能变成事实，最多成为 `imageVisibleText` 待确认候选；模型要是硬塞 `leakproof`／`bpaFree` 之类的 key，会被服务端丢弃并在证据 notes 里留痕。
- 图片**不影响危险品判定**：HAZ-004 是 `flammable`，永久阻断，图上写 `NON-FLAMMABLE` 也没用。

逐行说明与上传命令见 `evaluation/asset-import-sample/危险品样本图片说明.md`。

配套的**质检报告样本**在 `evaluation/asset-import-sample/质检报告样本.csv`（6 行，覆盖静默／过期／不合格／容量不一致／无报告／材质不一致），列说明、逐行预期与手动测试步骤见 `evaluation/asset-import-sample/质检报告样本说明.md`。
