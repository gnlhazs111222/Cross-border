# PrismLaunch Demo 验收记录

实际在 `/mnt/data/pyc/Create_new_products` 执行，使用本机 Node.js 22.23.2、npm 和 Chromium。现有项目书与流程图保留，未连接任何真实业务 API。

| 检查 | 结果 |
| --- | --- |
| `npm install` | 成功，安装 118 个包；当次 audit 为 0 vulnerabilities |
| `npm run typecheck` | 通过，严格 TypeScript 检查 |
| `npm run build` | 通过，生成 `dist/` |
| `npm run test:e2e` | **8 passed (24.5s)**，双语版本自动构建并测试生产预览 |
| 独立 Python CSV 解析 | 通过，1 条商品记录、12 列，SKU 正确，售价 19.99，无错列 |
| `git diff --check` | 通过 |

## 实际点击的关键路径

1. **Amazon 全链路**：Reset → 10 个 SKU → 创建任务 → Top 1 / 94 分 → Select → Evidence → V2 → USD 19.99 → Amazon 文案 → R001 拦截 → Publish Disabled → Apply Suggested Fix → 再 Review → Passed → Mock Publish → 下载 CSV。另检查刷新保留阻断与发布结果、Reset 清除任务，以及 10 个状态节点。
2. **缺资料与去重**：缺 packagingWeight 的 SKU 显示 Pricing Blocked，无建议价、无选择按钮；候选过滤剩 4 条，排除过滤为 6 条；duplicate 和 possible duplicate 不出现在 Top 3。
3. **Shopify**：在 Amazon 仍被拦截时独立生成、审核、发布 Shopify，得到 `SHOP-DEMO-1042 / Draft`；切回 Amazon 仍被阻断。
4. **人工修改**：审核通过后修改文案，旧审核立即失效；新增未证实内容触发 R002，修复并重审后才可发布。
5. **移动端与恢复**：375px / reduced motion 下完整点击至 Amazon 发布；无页面横向溢出；证据弹窗支持 Escape 关闭；损坏的存储可恢复到初始资料页。

FactCard V1 在生成 V2 前后做了对象比较，保持不变。消费者文案和导出内容不含 supplier cost / declared value / shipping / duty。Amazon 全链路监听未发现浏览器 pageerror。

## 可查看的验收产物

- `materials-desktop.png`：资料工作区，1440px
- `materials-mobile.png`：资料工作区，375px
- `listing-studio.png`：Amazon 文案及 Fact Sources
- `review-blocked.png`：R001 风险拦截与不可发布状态
- `publish-success.png`：Amazon 发布成功
- `publish-mobile.png`：手机端发布成功
- `amazon-demo.csv`：实际通过浏览器下载的样例

验证期间修复了手机表格隐藏辅助文本导致的页面横向溢出，以及当前环境 HTTP 代理造成的测试本地服务探测超时。修复后的生产版本五项验收全部通过。

## 双语版本追加验收

保留原有五项验收，另增加三项：1440px 中文完整链路、375px 中文完整链路，以及语言偏好覆盖浏览器默认语言并在刷新后保留。共八项全部通过。

中文完整链路覆盖资料搜索、缺包装重量、Top 3 理由、证据预览、V2、定价、Amazon 风险拦截与修订、CSV 下载及 Shopify Draft。额外在请求处理中、审核被阻断和审核通过时切换语言，并比较 localStorage 中业务状态的完整字符串，确认语言切换没有改动业务数据；中文界面下载的 CSV 保持英文。

中文截图：`materials-zh-1440.png`、`materials-zh-375.png`、`review-zh-1440.png`、`review-zh-375.png`。两种宽度下未出现页面横向溢出，中文全链路未发现浏览器 pageerror。

## Demo 边界

证据为固定提取结果；推荐与审核为确定性 Mock 规则；发布为本地模拟。任意改写不会获得真实 AI 审查，而是要求恢复已确认文案。CSV 为演示导出格式，未进行 Amazon 官方模板验证。无真实 OCR、LLM、物流税费查询、账号、后端或平台上传。
