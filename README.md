# PrismLaunch Full Demo

当前默认是完整演示模式：**React → Fastify → Prisma / SQLite → Cookie 登录**。商品、任务、事实、文案、审核和模拟发布均由服务端持久化。浏览器保留界面偏好与非权威快照。

QwenListingProvider 已真实生成 Amazon / Shopify 文案并通过校验、审核与模拟发布。默认仍使用模板，不自动花费模型 API；Qwen 需后端显式开启，失败时回退模板。

## 启动

需要 Node.js 22.12+，本机可使用：

```bash
cd /mnt/data/pyc/Create_new_products
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

- SQLite 权威保存：User、Session、Product、LaunchTask、TaskSelection、FactCard、Fact、Evidence、ListingDraft、ReviewResult、PublishResult、AI 调用元数据。
- 浏览器只保存界面偏好和非权威业务快照；文案绑定服务端 factsRevision，刷新 / 清空 localStorage 后仍可恢复数据库中的审核和发布。
- 目录 / 任务 / 事实在浏览器中仅有兼容性快照；会话初始化从 API 覆盖，清空 localStorage 后仍可恢复。旧 factEdits 不会自动升级成可信的服务端事实。
- XLSX / CSV 继续在浏览器按固定模板解析，服务端再校验并保存；替换 / 追加、重复处理和原始顺序保留。
- 模板生成、规则审核、发布授权与 CSV 下载全部由后端执行。事实变化使历史结果 stale；文案修改创建新版本并使该平台旧结果失效，保留历史。
- Key 只存服务端 `.env`，不提交、不打包到浏览器。默认 `AI_LIVE_ENABLED=false`。
- 推荐与证据补充仍是 Mock，审核仍为规则，发布仍为模拟；仅文案生成支持显式开启的 Qwen。
- Qwen 使用结构化 JSON、授权字段校验、版本检查、成功结果缓存和模板回退。
- 配置：`LISTING_PROVIDER=template` 默认；真实生成须 `LISTING_PROVIDER=qwen`、`AI_LIVE_ENABLED=true` 及后端 Key。

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
- [Qwen 真实调用验收与截图](artifacts/full-demo/QWEN_LISTING_VERIFICATION.md)
- [Full Demo 架构、API、持久化、Provider 与真实调用报告](docs/FULL_DEMO.md)
- [文案 / 审核 / 发布迁移与本轮验收](docs/LISTING_SERVER_MIGRATION.md)
- [上一轮事实迁移验收](docs/FACT_SERVER_MIGRATION.md)
- [上一轮后端基础验收](artifacts/full-demo/VERIFICATION.md)
- [供应商导入说明](SUPPLIER_IMPORT.md)
- [人工事实核对](FACT_REVIEW.md)
- [比赛版 3 / 5 分钟讲稿](docs/DEMO_SCRIPT.md)
- [比赛版问答](docs/DEMO_QA.md)
- [比赛版截图](artifacts/presentation/README.md)

比赛讲稿和旧截图描述的是冻结的离线比赛版；默认 Full Demo 需要先登录，产品 / 任务 / 事实存储边界以本文件和 Full Demo 文档为准。

示例文件仍位于 `public/demo/prismlaunch-supplier-demo.xlsx`、`public/demo/prismlaunch-supplier-demo.csv`，页面可以下载。
