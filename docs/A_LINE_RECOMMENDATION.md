# A 线：可编辑任务与 Qwen 推荐

> 历史说明：本文件记录 `79cac0e` 当时的实现。2026-09-11 起，当前 `main` 已按项目书现版解除选品与定价耦合；下述“最低利润作为推荐门槛”等内容仅用于追溯旧版本，不代表当前行为。

本轮基于 `a8a7c63`（包含稳定功能提交 `3fea260`），在独立 worktree `/mnt/data/pyc/Create_new_products_A`、分支 `feat/qwen-recommendation` 开发。没有合并到 full-demo。A worktree 独立安装依赖、独立复制 SQLite；主 worktree 与比赛标签保持原样。

## 1. 完成范围

```text
创建 / 编辑 Launch Task
→ SQLite 保存任务与 revision
→ Server Product + 当前任务的 Confirmed Facts
→ 共享 Hard Filter
→ Eligible candidates
→ Rule 或 QwenRecommendationProvider
→ JSON / Zod / Candidate authorization
→ 保存 Recommendation snapshot
→ Top 3、匹配分、理由、concerns、来源
→ 选择商品
→ 原 Fact / Listing / Review / Publish 流程
```

没有开发 Qwen Review、Qwen Evidence、图片 / PDF 解析或真实电商服务。没有改变 Pricing 公式、Fact 状态体系或 Listing factsRevision 体系。

## 2. Task UI 与保存

在原 Launch Tasks 摘要区域增加 New Task、Edit Current Task、Load Demo Task、Run Recommendation。

表单支持 Platform（Amazon US / Shopify US）、Market、Category、自然语言 Requirements、Minimum Unit Profit。市场和类目是任务上下文；不代表新增真实平台或税费规则。保存后从 SQLite 恢复，平台默认为任务选择的平台。

- POST `/api/tasks`：创建任务，沿用现有 code 和通用任务结构。
- PATCH `/api/tasks/:id`：编辑当前任务，要求 expectedRevision。
- 修改任务递增 revision，清除当前选择，使旧推荐失效，并调用已有下游失效钩子标记旧文案 / 审核 / 发布；商品目录保留。
- 旧版本写入返回 409。表单保留自身打开时的 task id / revision，不在冲突后偷偷覆盖新版本。

自定义任务保存和输入时均不调用模型。用户必须点击 Run Recommendation。原 Create Demo Task 和 Load Demo Task 是明确的比赛快捷操作，只运行确定性推荐，保留 `PL-DEMO-001` 与原 94 / 82 / 78 场景。

## 3. Hard Filter

规则位于 `shared/recommendation.ts`，服务端推荐、选择资格和 Full Demo 浏览器候选资格共用：

- Duplicate / Possible Duplicate 排除。
- 类目与当前任务的规范值不匹配排除，沿用后续事实 / 文案流程的精确匹配约定。
- 当前状态不是 search_ready、缺必要事实或包装重量 / 尺寸排除。
- 当前瓶类文案工作流不支持的商品类型排除。
- 当前模拟售价对应的单位利润低于任务 minimumProfit 时排除。

最低利润使用现有定价纯函数与固定成本假设比较；没有改变定价公式或加入实时费用。它是推荐门槛，不是模型自行计算的商业收益。

已产生任务事实卡的商品使用服务端有效事实视图；其余使用服务器从 Product 生成的基础事实。Rejected / pending 的必要字段使候选不再合格。可在 Fact Review 补齐、确认后重新运行推荐，商品会重新进入候选池。

## 4. Qwen Provider 与校验

保留 RecommendationProvider 的数组返回契约，增加可选版本 / 事实 context。新实现位于 `server/providers/qwenRecommendation.ts`，经现有 TextModelProvider 调用百炼，不在推荐 Service 新建 SDK client。

默认：

```dotenv
RECOMMENDATION_PROVIDER=rule
RECOMMENDATION_MAX_TOKENS=1800
AI_LIVE_ENABLED=false
```

只有选择 qwen、Live=true、Key 已配置时调用模型。模型从现有 BAILIAN_TEXT_MODEL 读取，默认 qwen3.6-flash，不自动升级 premium。

Prompt：`recommendation-qwen-v1`。模型只看到 task 平台 / 市场 / 类目 / 需求 / minimumProfit，以及通过筛选的候选短引用、SKU、名称、类目、完整度摘要和消费者相关已确认事实。短引用 C1 / C2 由服务端生成，返回后严格核对引用与 SKU，再映射到真实 Product id，避免让模型抄长数据库 ID。

不发送 userId、Cookie、Key、供应商成本、申报价值、私有文件路径或无关来源历史。商品旧名称可能滞后，Prompt 要求以结构化已确认事实为准。模型不得自行计算真实利润。

结构化返回 rankedCandidates，包含 productId、sku、score、matchedReasons、concerns、summary。Zod 和授权检查要求：

- 只返回输入集合中的商品，id / SKU 必须匹配，不能重复。
- 返回数量为 min(3, eligible count)，分数为 0–100 整数并按降序排列。
- 理由非空且受长度限制。
- 当前核心颜色、容量、吸管、材质的明显冲突会被拒绝；concerns 可明确比较实际属性和用户偏好。允许明确近似的整数盎司摘要及真实大小比较，不允许改写实际毫升规格。
- 禁止明显未经支持的认证、绝对宣称和销售预测。

分数定义为相对任务匹配分，不是模型置信度、概率、销量或收益预测。理由校验是有限规则，不能替代通用语义核验。

## 5. Fallback、缓存与持久化

Live 关闭、缺 Key、超时、HTTP 错误、非法 JSON / schema、未知候选、重复结果、非法分数、理由冲突、预算不足或 Provider 异常时，使用确定性规则回退。

规则回退保留经典 Demo 评分；自定义需求使用有限关键词 / 数值偏好规则，已知不能完整理解复杂优先级与所有风格偏好。规则只作稳定 fallback，不宣称通用自然语言理解。

结果记录 rule / qwen / rule_fallback，以及 model、promptVersion、fallbackReason、aiCallId、inputHash、cacheHit。超过 40 个合格候选时回退规则，避免发送过大的模型请求；不会偷偷把 hard-excluded 商品交给模型。

缓存沿用轻量成功结果缓存方式：每进程最多 100 条，合并并发同输入。Key 包含任务内容、候选 id / 相关事实、taskRevision、catalogRevision、candidateVersion、Prompt 与模型。变化导致 miss；失败不缓存。

Prisma 仅给 LaunchTask 增加一个 nullable JSON `recommendationSnapshot`，没有新建复杂推荐表。保存最近一次推荐及版本信息。

- GET `/api/tasks/:id/recommendations` 只读数据库和重新判断当前版本，不调用模型。
- POST 同一路径显式运行，携带 expectedTaskRevision；可明确选择 rule 快捷模式。
- Task / 相关 Fact 变化使旧 snapshot stale，旧 Top3 不再展示为当前有效结果。
- 资料导入 / reset 沿用原语义清理相关任务，旧推荐随任务被移除。
- 模型等待期间不占 SQLite 写事务，保存前重新检查任务、目录和候选版本，冲突返回 409。

## 6. 评测

`evaluation/recommendation/cases.json` 冻结 12 个合成案例和手工预期，覆盖不同容量、吸管、颜色、材质、包装信息、条件冲突、无完全匹配、接近候选、无候选与利润门槛。预期标签不由评分函数生成，也不发给模型；尚未经过外部专家标注。

默认 rule 和 qwen-mock 不调用真实模型。qwen-mock 使用规则示例验证 Provider / 校验链，不能把它的指标当成 Qwen 效果。

Rule：Top1 9/11（81.8%），Hit@3 11/11（100%），NDCG@3 0.9491，Invalid Candidate Rate=0，有限 Unsupported Reason 检查=0；另一个无候选案例正确返回空。指标定义、配对比较与输出说明见 `evaluation/recommendation/README.md`。

真实验收用了 5 次请求（3 次被校验拦下并回退，2 次成功），共 7935 tokens；最终成功的两例 Top1 / Hit@3 都为 100%，NDCG@3 为 0.9062，同例 rule 为 1.0，不证明 Qwen 整体优于规则。真实小样本验证和完整调用统计见 `artifacts/full-demo/QWEN_RECOMMENDATION_VERIFICATION.md`。仅比较少量真实任务，不把它写成统计结论。

## 7. 验证与演示

已执行依赖安装、Prisma Client 生成、增量 migration、TypeScript、build、服务端和 E2E 回归、rule / qwen-mock 评测、离线构建和密钥检查。最终结果：**82 项服务端测试、48 项 E2E 通过**；原 Qwen Listing、事实、审核、发布和离线测试继续通过。新增 27 项服务端测试和 4 项 E2E。TypeScript、build、离线 build、security check 通过；所有自动测试真实模型调用为 0。另在 5175 实测了已保存 Qwen 排序的中文桌面 / 手机显示，并从自定义 Shopify 任务、规则推荐、带吸管 SKU、事实、模板文案、审核走到模拟发布和刷新恢复，没有新增真实模型调用。

A worktree 的独立启动方式：

```bash
cd /mnt/data/pyc/Create_new_products_A
export PATH=/mnt/data/pyc/.nvm/versions/node/v22.23.2/bin:$PATH
API_PORT=3005 npm run dev:api
# 另一终端
API_PROXY_TARGET=http://127.0.0.1:3005 npm run dev:web -- --port 5175
```

A 线 Web：`http://localhost:5175`。普通 Demo 账户为 demo@prismlaunch.local / Demo123456。查看最后一次成功 Qwen 排序可使用 recommendation-evaluation@prismlaunch.local / Demo123456，进入上新任务页；查看不产生模型请求。默认不调用真实模型。

演示：上新任务 → 新建 / 编辑 → 保存 → 运行推荐 → 查看资格规则与 Top3 → 选择商品 → 原 Evidence / Listing / Review / Publish。载入演示任务可回到原固定需求；它不重置商品目录。

## 8. 集成边界与冲突风险

新增代码集中在任务 UI、recommendation Service / Provider / Prompt、共享候选规则和 evaluation 目录。

为集成最小修改了：server/app.ts、server/config.ts、server/validation.ts、server/services/tasks.ts、server/providers/domain.ts、shared/contracts.ts、src/types/index.ts、src/services/apiClient.ts、src/services/mockApi.ts、Capabilities、语言字典、package.json、.env.example、Prisma Schema、tsconfig.server.json。

**没有修改** server/services/listings.ts、QwenListingProvider、Fact Service、Review / Publish 授权或 CSV 实现。任务编辑仅调用原有下游失效函数。

B/C 线将来可能同时修改 app 路由、Provider 导出、Capabilities、配置、类型、语言字典及 package scripts，这些位置需要人工合并检查。Prisma 新增 migration 需要确认与其他分支 migration 的顺序。本轮不自动 merge 或 push，也不改写 full-demo / competition-demo-v1。
