# Qwen Recommendation A 线真实验收

日期：2026-09-08。A worktree：`Create_new_products_A`。真实调用只在本地 Mock、类型、build、server tests、E2E 和 security check 通过后显式执行。

本轮共 **5 次真实 qwen3.6-flash 请求，7935 tokens**，低于 8 次硬上限。没有 qwen3.8-max 或其他模型调用，自动测试真实调用为 0。前三次被校验拦截并回退；最后两次形成了真正的 Qwen 推荐结果。不能把前三次规则回退的正确 Top1 记为 Qwen 准确率。

## 1. 完整调用账本

| 尝试 | 任务 | 结果 | latency | 输入 / 输出 / 总 tokens |
| --- | --- | --- | ---: | ---: |
| 1 | 经典黑色约16oz无吸管 | 理由一致性校验拒绝，规则回退 | 2401ms | 1024 / 508 / 1532 |
| 2 | 同经典任务 | 近似容量摘要引发校验误报，规则回退 | 2479ms | 1165 / 503 / 1668 |
| 3 | 同经典任务 | 象牙白候选数据库 ID 被模型复制错一个字符，规则回退 | 2412ms | 1178 / 501 / 1679 |
| 4 | 同经典任务 | Qwen 输出通过结构与候选授权校验 | 2159ms | 1103 / 460 / 1563 |
| 5 | 明确要求黑色500ml带吸管 | Qwen 输出通过结构与候选授权校验 | 1693ms | 1098 / 395 / 1493 |

第一次没有保留触发拒绝的原句，不能断言是模型事实错误。第二次保留的输出中，正文正确写了 500ml / 16.9 fl oz，摘要使用 `~16oz`，由此定位到过度保守的比较校验。修正只允许有明确近似标记的整数盎司摘要或真实的容量比较；750ml 被描述成 500ml 仍拒绝。

第三次 ID 不匹配被正确拒绝，没有根据 SKU 静默修补。随后改为服务端绑定短引用 C1 / C2 等供模型返回，仍严格检查引用与 SKU，一致后才映射到真实 Product id。已捕获的理由在离线环境重放并加入回归，未为调试无限重复请求。

所有尝试记录在 A 数据库 AiCall，purpose=recommendation_generation。成功标记防止重复验收；显式诊断只保存在被忽略的 `.local/recommendation-diagnostics`，不记录 Key / Cookie / 完整敏感 Prompt。

## 2. 最终两个成功任务

两例都是 10 个输入商品、4 个 eligible、6 个由代码排除。模型没有收到那些被排除商品。

### 经典任务

Amazon US / United States / Home & Kitchen；黑色、约16oz、无吸管、通勤风格，优先包装与配件信息，minimumProfit=5（模拟定价门槛）。

| Rank | SKU | Score | 主要理由 / concern |
| --- | --- | ---: | --- |
| 1 | LM-KT-BTL-001-BLK-500 | 95 | 黑色、500ml / 16.9 fl oz、无吸管、资料完整 |
| 2 | LM-KT-BTL-003-BLK-750 | 80 | 黑色、无吸管；实际750ml，容量偏大 |
| 3 | LM-KT-BTL-004-WHT-500 | 60 | 500ml、无吸管；实际象牙白，不符合黑色偏好 |

人工判断：主角 Top1 合理。Qwen 更看重无吸管，因此把大容量 / 象牙白排在带吸管商品之前，与这份冻结标签对备选商品的等级排序不同。没有把这种分歧包装为模型优于规则。

### 明确带吸管任务

“A black 500ml bottle with a straw. A straw is required.” 其他任务字段相同。

| Rank | SKU | Score | 主要理由 / concern |
| --- | --- | ---: | --- |
| 1 | LM-KT-BTL-002-BLK-500 | 100 | 黑色、500ml、明确带吸管 |
| 2 | LM-KT-BTL-001-BLK-500 | 40 | 颜色容量匹配；实际无吸管 |
| 3 | LM-KT-BTL-003-BLK-750 | 20 | 黑色；容量750ml且无吸管 |

人工判断：需求变化后 Top1 正确切换。100 是候选中的任务匹配演示分，不是成功概率。原始第三名 summary 使用了“disqualify”这种容易与硬资格混淆的措辞；它没有改变候选资格。UI 展示可核对的 matched reasons 和 concerns，不直接展示自由 summary；原文保留在评测 JSON 中供审计。

## 3. 指标与边界

| 数据范围 / Provider | Top1 | Hit@3 | NDCG@3 | Invalid Candidate | 有限 Unsupported Reason 检查 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 12 个冻结合成案例 / rule | 9/11，81.8% | 11/11，100% | 0.9491 | 0 | 0 |
| 12 个案例 / qwen-mock | 81.8% | 100% | 0.9491 | 0 | 0 |
| 最终成功的相同 2 例 / rule | 100% | 100% | 1.0000 | 0 | 0 |
| 最终成功的相同 2 例 / qwen-live | 100% | 100% | 0.9062 | 0 | 0 |

一个无候选案例不进入排名指标分母，另外正确返回空列表。qwen-mock 使用规则示例，只验证接口 / 校验链，不能证明 Qwen 质量。

这些 0 值描述的是最终校验 / 回退后的输出，不是原始模型从不犯错。开发过程中实际有 3 次校验拒绝；其中至少一次是明确的模型 ID 复制错误，至少一次是检查器误报。理由审计只覆盖有限直接字段，不是完整语义标注。

**This is connectivity and behavior validation, not a statistically meaningful recommendation benchmark.**

完整结果：`artifacts/evaluation/recommendation/{rule,qwen-mock,qwen-live}/summary.json` 与 `summary.md`。live JSON 同时保存同例 rule 基线和累计开发尝试统计。

## 4. 验证与界面

最终自动测试、构建与页面实测结果见 `docs/A_LINE_RECOMMENDATION.md`。默认环境仍为 rule / Live disabled；查看已有 Qwen 排序不会产生新请求。

实际截图：

- （截图已归档）
- （截图已归档）
- （截图已归档）

本轮没有重新真实调用 Qwen Listing，也没有开发 B / C 线。
