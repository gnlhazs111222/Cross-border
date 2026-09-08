# B 审核独立评测 v1

这是独立于生成器的固定样例评测，不是经过人工审核的标准答案集。48 个样例及预期标签由 AI 编写，**尚未由人复核**。不要把结果宣传为真实审核准确率。

24 个 dev、24 个 holdout 覆盖合理改写、遗漏非必填事实、属性冲突、显式/隐含无依据宣称、未授权事实、内部信息、提示注入、歧义和背包/台灯探测。holdout 只作冻结的留出样例，文件对开发者可见，并非盲测。不要根据模型输出修改期望标签；人工纠正标签时增加数据集版本、记录原因，并重新报告基线。运行器记录完整数据集 SHA-256。

离线运行（不读密钥、不调用模型）：

```powershell
node --import tsx evaluation/review/run.ts --provider rule --split all
```

显式实时调用（需本机已配置 Key 和 AI_LIVE_ENABLED=true；会消费 API 额度）：

```powershell
node --import tsx evaluation/review/run.ts --provider qwen --live --split dev --limit 4
```

首次建议最多 4 条。实时必须提供 limit，每次硬上限 12 条，不重试。相同参数再次运行会再次调用，并非使用缓存。大规模运行前先检查少量调用的格式、延迟和成本。选取采用样例顺序前 N 条；小批不能代表全风险类别。

输出：`artifacts/evaluation/review/<timestamp-provider-random>/`，逐样例原始结构化结论、生成元数据（包括调用提供的 Token 信息）、延迟、输入哈希、配对规则结果、汇总报告。文件以排他创建方式写入，不覆盖历史记录。标签和 rationale 不传入模型，仅传 `input`。异常信息采用固定错误码，避免泄漏上游响应或密钥。

## 指标解释

- blocked 为二元正类：TP 正确阻断、FP 错误阻断、FN 错误放行、TN 正确放行。
- 误报率 FP/(FP+TN)，漏报率 FN/(FN+TP)；只在模型给出 passed/blocked 且标签明确的样例上计算。
- failed 和 needs_human_review 独立计数，不当作正确识别，也不隐藏；同时报告二元覆盖率和全样例状态完全匹配率。
- 分母为零返回 null，不能解释为 100%。歧义标签另计，记录被放行数量。
- Qwen 与规则结果必须基于同一批样例配对比较。当前规则对冻结参考文案做差异检测、不检查 attributes，因此存在系统性误报和漏报。

上线结论前必须由至少一名业务同学复核标签，重点复核 secure、compact、sturdy 等歧义描述；随后补充真实匿名样例。真实小样本调用与失败记录见 [B交付说明](../../docs/B_REVIEW_IMPLEMENTATION.md)，不代表已完成人工标注或全量真实评测。

当前 Provider 复用现有消费者事实白名单；品类扩展字段可能未获传入模型。因此跨品类和新增性能字段的正确样例用于暴露接口能力缺口，不代表系统已经支持这些品类。dev/holdout 中包含相似风险的不同表述，不能据此宣称对全新品类或全新风险的泛化效果。
