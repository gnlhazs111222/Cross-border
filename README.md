# PrismLaunch Web Demo

跨境商品可信上新的本地演示：Materials → Launch Task → Top 3 → Evidence / FactCard V2 → Pricing → Listing → Review Block → Human Fix → Mock Publish。

现有项目书、流程图及资源目录完整保留。前端采用 React、Vite、TypeScript、Tailwind CSS，交互组件使用 Radix Dialog / Tabs 和 Lucide 图标。无需后端、账号或 API Key。

## 启动

需要 Node.js 22.12+。仓库提供 `.nvmrc`。

```bash
cd /mnt/data/pyc/Create_new_products
nvm use
npm ci
npm run dev -- --port 5173
```

访问 `http://localhost:5173`。如果当前终端没有加载 nvm，本机可直接运行：

```bash
cd /mnt/data/pyc/Create_new_products
export PATH=/mnt/data/pyc/.nvm/versions/node/v22.23.2/bin:$PATH
npm run dev -- --port 5173
```

## 中英文切换

右上角 **中文 / EN** 即时切换界面。首次访问跟随浏览器语言（中文浏览器显示中文，其他语言显示英文），之后记住上次选择。语言偏好独立保存在 `prismlaunch.language`，刷新和 Reset Demo 均不会清除。

五个工作区的导航、按钮、空状态、商品资料、推荐理由、事实字段、证据预览、价格说明、审核风险、发布结果与通知均支持双语。搜索支持中英文商品名、类目、颜色和 SKU，中途切换语言也保留搜索条件。

**界面语言与上新内容分开**：Amazon US / Shopify US 的消费者文案、英文编辑框和 CSV 保持英文。中文界面会标明该边界。切换语言不改变任务、SKU、FactCard、文案版本、审核通过状态或发布结果，生成过程中也可切换。

翻译字典位于 `src/i18n/zh.json`，语言状态和参数化文案由 `src/i18n/I18nContext.tsx` 管理，无在线翻译请求。

构建及预览：

```bash
npm run typecheck
npm run build
npm run preview -- --port 5173
```

## 演示路径（约 3 分钟）

1. 左侧 **Reset Demo**，Materials 显示 10 个 SKU、4 个候选和 6 个被排除商品。点击 SKU 查看资料。
2. **Create Demo Task**，固定任务 `PL-DEMO-001`，Amazon US / United States / Home & Kitchen，最低单位利润 USD 5。
3. Top 1 为 `LM-KT-BTL-001-BLK-500`，94 分。Top 2 有吸管扣 12 分；Top 3 容量过大扣 16 分。点击 Top 1 **Select SKU**。
4. 在 Evidence & Facts 查看三类 Mock Evidence，点击 **Analyze Evidence**。约 700ms 后生成 V2，保留 V1，新增包装内容、表面工艺、瓶盖类型及未证实的防漏宣称。
5. 展开字段来源与允许状态，查看 **Demo Pricing Snapshot v1 / USD 19.99**。成本合计 USD 14.20，最低利润 USD 5，建议价对应利润 USD 5.79。
6. **Continue to Listing Studio → Generate Amazon Listing**。展开 **Fact Sources** 检查来源。首次 Amazon 生成故意注入 `100% leakproof`，其余文案来自 V2 允许字段。
7. **Continue to Review → Run Review**。出现 **R001 / HIGH RISK**，**Publish** 不可点击。
8. **Apply Suggested Fix** 将违规描述替换为 `Secure screw-top lid designed for everyday carrying.`。此时仍不能发布；再次 **Run Review** 后出现 **Review Passed / High Risk Issues: 0**。
9. **Publish → Mock Publish Success / Amazon Listing Export Ready → Export Amazon CSV**，下载真实 CSV。
10. 切换 **Shopify US → Go to Listing Studio → Generate Shopify Listing → Continue to Review → Run Review → Publish**，显示 **Shopify Draft Created / SHOP-DEMO-1042 / Draft**。

额外展示：Materials 点击 `LM-KT-BTL-005-BLK-500`，显示 **Pricing Blocked / Missing Fact: Packaging Weight**，不显示建议价。Duplicate / Possible Duplicate 均不能进入推荐。搜索和候选筛选可操作。

## 状态与边界

- 数据统一经 `src/services/mockApi.ts` 访问，Promise 延迟模拟请求。
- localStorage 键为 `prismlaunch.demo.v1`；刷新保留任务、SKU、事实版本、各平台文案、审核和发布结果。Reset Demo 清除这些进度。
- Amazon 与 Shopify 的文案、审核、发布结果独立。改文案、重新生成或切换 SKU 都会使对应旧审核失效；发布还会在数据层再次检查当前版本。
- 商品成本、申报价值、运费与税费不进入消费者文案。只有第一次 Amazon 生成会添加用于风险演示的例外字段。
- 人工编辑会产生新版本。Mock Review 仅检查已知证据文案、预置风险和其他未确认修改；任意不同文案会触发 R002，修复会恢复已确认措辞。
- 全部数据固定模拟。没有实际文件上传 / OCR / LLM、物流 / 汇率 / 税则查询、真实平台发布、账号权限和后台服务。证据预览为提取字段，不包含真实原始 PDF 或表格。Amazon CSV 是演示格式，不是官方上传模板。这些不影响要求的 Demo 链路。
- 如果浏览器禁用 localStorage，界面显示提醒，并继续支持当前内存会话。

## 验证

```bash
npm run typecheck
npm run build
npx playwright install chromium
npm run test:e2e
```

Playwright 自动执行生产构建，再在端口 4173 启动预览，实际使用 Chromium 点击 UI，覆盖：完整 Amazon 发布与 CSV 下载、缺包装重量和重复排除、Shopify 独立发布、人工修改后的重新审核、移动端完整链路、刷新恢复、Reset、损坏存储恢复和证据弹窗键盘关闭。运行测试时请保持 4173 端口空闲；普通演示使用 5173。

测试截图和下载样本位于 `artifacts/`；HTML 报告在 `playwright-report/`，可使用 `npx playwright show-report` 查看。测试不会调用真实业务 API。

## 目录

```text
src/
  components/     通用控件、工作区上下文、定价与文案预览
  pages/          五个工作区
  data/           10 个 Mock SKU 和固定任务
  i18n/           中英文界面字典与独立语言偏好
  services/       Mock API、状态存储、推荐/审核/发布规则
  types/          TypeScript 数据契约
tests/            浏览器验收用例
public/           本地品牌图标
```
