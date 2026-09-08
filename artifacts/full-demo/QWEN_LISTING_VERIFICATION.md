# Qwen Listing 真实验收摘要

日期：2026-09-08。先完成 Mock 测试、构建和 E2E，再执行两次显式真实 Listing 调用。真实调用只发生在本地 CLI 验收，不属于自动测试。

| 平台 | SKU | 模型 | factsRevision | 授权字段 | 延迟 | 输入 / 输出 / 总 tokens | 校验 | 回退 |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- |
| Amazon US | LM-KT-BTL-001-BLK-500 | qwen3.6-flash | 2 | 8 | 2384ms | 642 / 526 / 1168 | JSON、Zod、授权通过 | 无 |
| Shopify US | LM-KT-BTL-001-BLK-500 | qwen3.6-flash | 2 | 8 | 2675ms | 646 / 497 / 1143 | JSON、Zod、授权通过 | 无 |

本轮 **2 次，2311 tokens**；没有失败、隐藏重试或更高档模型调用。此前连接 smoke 是 2 次 / 101 tokens；SQLite 累计 **4 次 / 2412 tokens**。两次延迟只是观测值，不是性能基准。

Prompt version：`listing-qwen-v1`。AiCall 均记录 purpose=listing_generation、provider=bailian、模型、时间、usage、promptVersion 与 inputHash；没有保存 Key、Cookie 或完整 Prompt。

Amazon 标题：

> Black Stainless Steel Travel Bottle, 500ml / 16.9 fl oz, Matte Black Finish with Screw-top Lid

Shopify 标题：

> Black Stainless Steel Travel Bottle - 500ml / 16.9 fl oz

两者都返回了 5 条卖点、描述、属性和 8 项已使用事实。容量、颜色、材质、吸管、产地、包装内含、表面工艺和杯盖与授权数据一致。没有输出采购成本、申报价值、额外容量规格或 `100% leakproof`。

人工检查未观察到新增规格或明显绝对性能宣称。Amazon 的“secure closure”等一般描述仍不是独立性能检测证明；有限规则不能证明不存在任何隐含语义风险，不应据此宣称通用合规能力已验证。

两份文案写入 SQLite 后分别运行 RuleReviewProvider，并通过后端发布授权完成 Mock Publish。生成没有自动跳过审核，也没有真实平台上架。

保存结果随后通过实际 5173 页面加载，检查中文桌面及英文手机界面；这一过程没有点击生成、没有新增模型请求：

- [Amazon 中文文案](qwen-listing/amazon-zh.png)
- [Shopify 中文文案](qwen-listing/shopify-zh.png)
- [Shopify 手机界面](qwen-listing/shopify-mobile.png)

Mock 验收额外覆盖非法 JSON、Zod 失败、超时、HTTP 错误、未授权字段、错误数值、矛盾规格、无依据绝对宣称、输出 token 上限和调用预算；这些情况均返回可继续工作的模板草稿。缓存命中、生成期间事实变更以及显式风险注入后的 R001 也有自动测试。

最后结果：**55 项服务端测试、44 项 E2E 通过**，TypeScript、build、离线 build 与 security check 通过。自动测试真实 AI 调用为 0。

当前常规环境保持 template / Live disabled；已保存的 Qwen 结果可以查看，无需为了展示再次调用 API。验收脚本保留成功标记，避免重复请求。
