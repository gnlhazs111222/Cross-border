# 比赛 PPT 截图

全部来自实际运行的 Chromium 页面，尺寸统一为 **1920×1080，16:9，中文界面**。没有生成虚构 UI，没有直接改业务 state 来伪造结果。

直接把 PNG 插入 PPT 即可。截图只保留正常页面内容、实际滚动位置及用户展开的来源；生成时关闭短暂通知以避免遮挡。

| 文件 | 演示画面 |
| --- | --- |
| `00-demo-capabilities.png` | REAL / LOCAL 与 DEMO / MOCK 能力说明 |
| `01-materials-import.png` | Materials、供应商导入、真实解析结果摘要 |
| `02-top3-recommendation.png` | Top 3、94 / 82 / 78 分、匹配理由及选择按钮 |
| `03-evidence-fact-review.png` | V1 / V2 说明、定价与 Fact Review |
| `04-missing-fact-pricing-blocked.png` | 缺包装重量、Missing、Pricing Blocked |
| `05-manual-confirmation-pricing-ready.png` | 人工确认 0.42 kg，USD 18.90，来源和绿色解锁反馈 |
| `06-listing-fact-sources.png` | 英文 Listing 与展开的实际 / Mock 事实来源 |
| `07-high-risk-blocked.png` | R001、高风险红色提示、修订动作及禁用的发布 |
| `08-review-required.png` | 已修订但尚未重审，黄色 Review required 与发布锁定 |
| `09-review-passed.png` | 已通过当前版本审核，允许模拟发布 |
| `10-publish-success.png` | 模拟发布成功及真实 CSV 下载入口 |

元数据记录在 `screenshots.json`。截图由 `tests/presentation.spec.ts` 的中文 1920×1080 用例生成：

```bash
npm run test:e2e -- --grep 'presentation zh-CN 1920'
```

测试会自动构建并在 4173 启动生产预览，请保持该端口空闲。普通演示用 5173。

配套：[演示讲稿](../../docs/DEMO_SCRIPT.md)、[评委问答](../../docs/DEMO_QA.md)、[UX Audit](../../docs/DEMO_UX_AUDIT.md)。

注意：本组图片分别截取主线和补事实支线的真实运行状态，不是同一个 SKU 的连续版本。主线使用 `LM-KT-BTL-001-BLK-500`；缺重量支线使用 `LM-KT-IMP-005-BLK-500`。
