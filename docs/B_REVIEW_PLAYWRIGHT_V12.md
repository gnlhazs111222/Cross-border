# v12 网页复验

2026-09-09，使用当前会话实际可用的 Playwright MCP browser_navigate、browser_snapshot、click、type 等工具操作 http://localhost:5175/。恢复本地服务后登录演示账户，验收任务 B-ACCEPT-1788879026672，Shopify 平台。

结果：本轮正常、修改失效、规格拦截、修正后通过流程验证通过。

- 起始版本 14 为正确 500ml 文案，已有审核通过结果，发布按钮可用。
- 仅将标题改为 750ml，保存版本 15；刷新后仍为待审核，发布按钮禁用。
- 主动运行真实 Qwen 审核，页面仅显示一条规格矛盾，位置为标题，原句 750ml，引用 capacity，建议改为 500ml；未误报正确属性。发布禁用，刷新后拦截状态保留。
- 恢复标题 500ml，保存版本 16；仍待审核、发布禁用。主动审核后通过，刷新后仍通过，发布按钮可用。
- 追踪显示 qwen3.6-flash、review-qwen-v12、review-hard-v8，最终文案/事实/任务版本为 16/2/1。
- 未点击发布，未修改事实卡。当前页重新加载后的控制台错误数为 0；首次进入登录页时曾出现未登录相关请求错误，不能宣称整个浏览会话从未有错误。

本轮两次真实调用：版本 15 为 cmttzjb560006qq7wfc31brl2，版本 16 为 cmttzm96z000bqq7wem3qpc2g。记录见 [calls.json](../artifacts/b-review/playwright-v12/calls.json)。页面快照由 Playwright MCP 保存于 .playwright-mcp 和 v12-browser-final.md。

本轮没有重新制造 failed 场景，其锁定行为证据仍见此前 v9 网页失败验收；也未处理 R2-09 的 lidType 引用缺失。此次补齐的是 [空建议修复报告](B_REVIEW_EMPTY_FIX.md) 中因浏览器断连而未完成的正常/错误/修正网页复验。
