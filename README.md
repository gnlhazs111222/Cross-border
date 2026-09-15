# 海淘集市 · 跨境商品上新工作台

**团队：Baseline** ｜ 完整可运行 Demo（React + Fastify + Prisma / SQLite）

## 这个项目是什么

面向跨境电商运营团队的商品上新工作台：把国内供应商的中文资料，变成可以直接上架海外平台的英文商品页，**并且每一句话都能指回它的证据**。

- **目标用户**：没有专职数据整理团队的中小品牌方、工贸商家与跨境运营团队。协作角色三类：供应链人员（提供资料、对缺项负责）、选品与 Listing 运营（选 SKU、写英文页面）、审核人员／店铺负责人（发布前把关）。
- **输入**：中文 Excel / CSV（固定模板）、商品白底图与包装图、规格 PDF、质检报告图片。
- **输出**：Amazon 可直接导出的 CSV、Shopify 商品草稿（演示为模拟发布）。
- **核心链条**：资料导入与清洗 → 选品推荐 → 证据与事实（事实卡 V1 供应商基准 + V2 任务补充，三项核对：图片文字／质检报告／物流属性）+ 定价计算 → 文案生成（只用已确认事实）→ 审核与发布准备。
- **关键差异**：事实卡分层（V1 基准不被覆盖，V2 只叠加并标注来源）· 核对结论才允许进文案 · 每一次人工处置都留痕（谁、何时、依据哪张图）。

## 仓库导览（评委从这里看）

| 想看什么 | 去哪里 |
| --- | --- |
| **业务流程图** | [`01_业务流程图(3)_命名统一.html`](<01_业务流程图(3)_命名统一.html>)（浏览器直接打开） |
| **系统架构图 / 技术路线图** | [`02_系统架构图.html`](02_系统架构图.html)、[`02_系统架构图.png`](02_系统架构图.png)、[`02_技术路线图.html`](02_技术路线图.html) |
| **实际运行截图**（11 步完整流程） | [`docs/截图/`](docs/截图/README.md) |
| **完整 Demo 代码** | [`src/`](src)（前端）、[`server/`](server)（API/服务）、[`shared/`](shared)（共享领域逻辑）、[`prisma/`](prisma)（数据模型） |
| **数据文件** | [`evaluation/asset-import-sample/`](evaluation/asset-import-sample)：`商品参数信息表(上传).csv`、`危险品运输属性样本.csv`、`可选材料/`（故意做错的样张图）、`hazmat-images/`（质检报告样张）、`质检报告样本.csv` 等 |
| **模块说明** | [A 线 推荐](docs/A_LINE_RECOMMENDATION.md)、[B 线 语义审核](docs/B_REVIEW_IMPLEMENTATION.md)、[C 线 图片文字核对](docs/MULTIMODAL.md)、[供应商导入](docs/SUPPLIER_IMPORT.md)、[人工事实核对](docs/FACT_REVIEW.md)、[税价快照](docs/PRICING_SNAPSHOT.md) |
| **验证记录**（真实调用与验收数据） | [`docs/验证记录/`](docs/验证记录) 与 [集成验证](docs/A_B_INTEGRATION.md) |
| **测试** | [`tests/`](tests)（端到端）、[`server/tests/`](server/tests)（229 条服务端测试） |

## 启动


## 启动

需要 Node.js 22.12+，本机可使用：

```bash
cd /path/to/Projects # 替换为 main 分支的本地目录
export PATH=/mnt/data/pyc/.nvm/versions/node/v22.23.2/bin:$PATH
cp -n .env.example .env
chmod 600 .env
npm ci
npm run dev
```

- Web：`http://localhost:5173`
- API：`http://127.0.0.1:3001/api/health`
- 登录邮箱：`demo@prismlaunch.local`
- 演示密码：`Demo123456`

`npm run dev` 自动执行迁移与 seed，再同时启动 Web / API。重复 seed 不会覆盖已有目录。单独启动使用 `npm run dev:web`、`npm run dev:api`。

## 保留的离线比赛版

登录页可点击“打开离线比赛演示”，也可使用 `http://localhost:5173/?mode=local`。这个模式不需要 API 或登录。

```bash
npm run dev:local
# 或构建后预览
npm run build:local
npm run preview:local
```

独立离线模式默认端口 5174。稳定标签 `competition-demo-v1` 指向 `4a2920f`，原 `pyc` 分支保留。

## 数据与模型边界

- SQLite 权威保存：User、Session、Product、LaunchTask、PricingSnapshot、TaskSelection、FactCard、Fact、Evidence、ListingDraft、ReviewResult、PublishResult、AI 调用元数据。
- 创建任务时会持久化 `PricingSnapshot`：冻结参考汇率及来源、运费配置、关税规则、平台费配置和时间；售价计算读取当前任务快照，手动刷新会生成新版本并使旧发布结果失效。
- 浏览器只保存界面偏好和非权威业务快照；文案绑定服务端 factsRevision，刷新 / 清空 localStorage 后仍可恢复数据库中的审核和发布。
- 目录 / 任务 / 事实在浏览器中仅有兼容性快照；会话初始化从 API 覆盖，清空 localStorage 后仍可恢复。旧 factEdits 不会自动升级成可信的服务端事实。
- XLSX / CSV 继续在浏览器按固定模板解析，服务端再校验并保存；替换 / 追加、重复处理和原始顺序保留。
- 当前完整流程支持水杯与托特包，台灯继续在推荐前明确排除。托特包有独立的选品展示、事实字段、文案模板和承重风险审核；不是套用水杯容量、吸管或防漏规则。
- 模板生成、规则审核、发布授权与 CSV 下载全部由后端执行。事实变化使历史结果 stale；文案修改创建新版本并使该平台旧结果失效，保留历史。
- Key 只存服务端 `.env`，不提交、不打包到浏览器。默认 `AI_LIVE_ENABLED=false`。
- 推荐默认规则、文案默认模板、审核默认规则、图片文字核对默认离线；四者均支持单独显式开启 Qwen。证据区只保留供应商表格一条，PDF 与图片不做解析；发布仍为模拟。
- Qwen 推荐和生成使用结构化校验、版本检查及缓存，失败时分别回退规则或模板。Qwen 审核先执行本地硬规则，再验证模型结果；失败或歧义不会回退成通过。
- 配置默认：`RECOMMENDATION_PROVIDER=rule`、`LISTING_PROVIDER=template`、`REVIEW_PROVIDER=rules`、`MULTIMODAL_PROVIDER=local`。对应模块改为 `qwen`，并开启 `AI_LIVE_ENABLED=true`、配置后端 Key 后才尝试真实调用（图片文字核对还需 `BAILIAN_VL_MODEL`，默认 `qwen3.7-plus`）。查询、刷新、发布和 CSV 下载不会调用模型。
- 「核对与报警」面板（Evidence & Facts 页，事实表上方）随事实卡给出三条核对：图片文字、质检报告、物流属性确认。**正常一律静默，只有异常才报警**；报警必须由人处置：图片印字与事实不一致的那一行直接写出差异并给三个选项（直接保存图中印字 / 修改后保存 / 放弃该图），质检报告过期或与事实不一致可选采纳报告值或放弃该报告，不合格报告不可放弃、永久阻断发布。
- 处置走 `POST /api/tasks/:taskId/products/:productId/check-decisions`（带 `expectedRevision` 乐观锁）。放弃图片 / 报告是**记在商品上**的决定，重跑核对不再读取该证据；采纳印字或手改只写 v2，仍须人工确认才能进文案。
- 供应商表格新增两组可选列：物流申报 `liquid` / `battery` / `magnetic` / `aerosol` / `flammable` / `fragile`，质检报告 `reportNo` / `reportResult` / `reportValidUntil` / `reportCapacityMl` / `reportMaterial`（`reportNo` 留空表示没有报告）。必填列仍是原来 14 列。

## 检查与构建

```bash
npm run db:migrate
npm run db:seed
npm run typecheck
npm run build
npm run test:server
npm run test:e2e
npm run security:check
```

测试默认强制关闭 live 并清空测试进程中的 Key，E2E 数据库和账户独立。普通 smoke 也是 Mock：

```bash
npm run ai:smoke
```

真正调用必须显式启用：

```bash
AI_LIVE_ENABLED=true NODE_TLS_REJECT_UNAUTHORIZED=1 npm run ai:smoke -- --live
```

连接基础轮已经成功做过两次真实 smoke，不需重复；成功标记存在时命令自动跳过。默认每个 API 进程最多 20 次调用，smoke CLI 更严格地限制为两次，SDK 不自动重试。

文案专项验收命令 `npm run ai:listing-smoke` 默认为模板 dry run；显式 Live 用法及成功跳过规则见 Qwen 文档。本轮真实文案调用仅 2 次 / 2311 tokens，后续查看已保存文案无需再次调用。

## 文档与素材

- [Qwen Listing 本轮实现与使用说明](docs/QWEN_LISTING.md)
- [多模态模块：图片文字与事实核对](docs/MULTIMODAL.md)
- [危险品样本图片与质检报告样本（含手动测试步骤）](evaluation/asset-import-sample/质检报告样本说明.md)
- [Qwen 真实调用验收与截图](docs/验证记录/QWEN_LISTING_VERIFICATION.md)
- [Full Demo 架构、API、持久化、Provider 与真实调用报告](docs/FULL_DEMO.md)
- [上一轮后端基础验收](docs/验证记录/VERIFICATION.md)
- [供应商导入说明](docs/SUPPLIER_IMPORT.md)
- [托特包完整演示说明](docs/BAG_DEMO.md)
- [人工事实核对](docs/FACT_REVIEW.md)
- [任务级税价快照](docs/PRICING_SNAPSHOT.md)
- [比赛版 3 / 5 分钟讲稿](docs/DEMO_SCRIPT.md)
- [比赛版截图](docs/截图/README.md)

比赛讲稿和旧截图描述的是冻结的离线比赛版；默认 Full Demo 需要先登录，产品 / 任务 / 事实存储边界以本文件和 Full Demo 文档为准。

示例文件仍位于 `public/demo/haitao-supplier-demo.xlsx`、`public/demo/haitao-supplier-demo.csv`，页面可以下载。
