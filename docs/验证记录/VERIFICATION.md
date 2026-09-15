# Full Demo 验收记录

日期：2026-09-08。分支：`full-demo`。本轮基于 `4a2920f`；`pyc` 与 `competition-demo-v1` 均保留指向该比赛版提交。完整实现说明见 [FULL_DEMO.md](../../docs/FULL_DEMO.md)。

## 实际执行与结果

使用 Node.js 22.23.2，完成依赖安装、Prisma Client 生成、SQLite 迁移和账户 seed。最终连续执行：

```bash
npm run typecheck
npm run build
npm run test:server
npm run test:e2e
npm run build:local
npm run security:check
npm audit --omit=optional
```

| 检查 | 结果 |
| --- | --- |
| Web / Server TypeScript | 通过 |
| Vite + 服务端 esbuild 构建 | 通过 |
| 服务端测试 | 14 passed；真实 Provider 使用 mock transport |
| Playwright | 32 passed（1.4 分钟）；保留原 28 项测试及业务断言，新增 4 项 |
| 独立离线 competition 构建 | 通过 |
| 密钥扫描 | 源码、前后端构建和离线构建未包含实际凭据 |
| npm audit | 0 vulnerabilities |
| Git diff 空白检查 | 通过 |

服务端测试覆盖真实密码校验、Cookie 会话、未登录保护、产品导入与重新连接后持久化、任务和选择、用户间隔离、当前用户 reset、生产环境端点保护、能力状态、live 关闭 / 无 Key、预算、premium 开关、TLS 验证保护、超时、错误脱敏和结构化输出校验。

E2E 的每个浏览器测试使用独立真实登录账户。原有 XLSX / CSV、人工事实补齐、定价解除阻断、Amazon / Shopify、审核失效、发布与 CSV、双语、手机和演示展示检查继续通过。新增登录 UI / 退出、清空 localStorage 后数据库恢复、篡改浏览器目录快照不改变服务端数据、禁用 live 和离线零 API 流程。

## 实际运行页面

通过 `npm run dev` 启动 Web 5173 / API 3001，再实际操作浏览器：

1. 中文登录页使用 Demo 账户登录，验证 HttpOnly Cookie。
2. 上传真实 sample XLSX，数据库目录保存 7 个商品，顺序与文件一致。
3. 创建任务；清空全部 localStorage 后重新加载，目录与任务从服务器恢复。
4. 打开能力说明，显示 Fastify / SQLite / Cookie Auth，以及“已配置，真实调用未开启”。
5. 重置恢复 10 个内置商品，退出登录成功。
6. 独立打开 5174 离线构建，10 个商品可操作，无登录要求、零 API 请求。

开发服务器访问 `/.env`、`/.local/prismlaunch.db`、`/server/config.ts` 均返回 403。实际 `.env` 权限为 0600；数据库、凭据与运行产物均被 Git 忽略。

本轮截图已人工查看：

- [登录页](01-login.png)
- [服务端商品目录](02-server-catalog.png)
- [动态能力说明](03-capabilities.png)

测试产生的旧比赛截图改动已恢复，未替换原比赛版本的演示素材。

## 真实百炼验证：严格两次

仅显式运行一次：

```bash
AI_LIVE_ENABLED=true NODE_TLS_REJECT_UNAUTHORIZED=1 npm run ai:smoke -- --live
```

| 模型 | 用途 | 结果 | 耗时 | 输入 / 输出 / 总 tokens |
| --- | --- | --- | ---: | ---: |
| qwen3.6-flash | “你好” | 成功 | 515ms | 21 / 8 / 29 |
| qwen3.6-flash | 短 JSON | 成功且 Zod 校验通过 | 228ms | 61 / 11 / 72 |

合计 **2 次、101 tokens**，无自动重试、无其他模型调用。只读复核 SQLite `AiCall`，记录与上表一致。成功后未再请求真实 API；普通测试强制禁用 live，最终本地配置仍为 `AI_LIVE_ENABLED=false`。这些耗时只是两次观测，不是性能基准。

## 验收边界

User / Product / LaunchTask / TaskSelection 已由 SQLite 提供权威数据。FactCard、人工事实、Listing、Review 和 Mock Publish 的业务状态仍由浏览器保存；对应数据库表已准备但本轮未迁移其业务写入。正常业务使用 Mock / Template / Rules，Qwen 业务适配器仅预留接口。没有真实平台发布、OCR、物流税费服务或生产部署验收。

预算按后端进程计算，重启会重置，不是计费系统。数据库和服务使用本地演示配置，不代表已达到生产级安全、并发和运维要求。
