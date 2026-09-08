# 网站真实审核失败修复：无关位置字段为 null

版本：提示词保持 review-qwen-v8，规则升级为 review-hard-v6。

## 复现证据

读取独立验收任务历史版本的真实输入，核对 inputHash 与原失败完全一致。模型输出为合法 JSON，容量矛盾判定、事实引用及建议均正确，但 location 为 `{"field":"title","key":null}`；原 schema 拒绝 null，外部表现为 invalid_ai_json。

[修复前响应与校验路径](../artifacts/b-review/real-input-fix/before.json)

## 修复范围

在位置解析前将无关可选字段的 null 规范化为缺省值：标题/描述不需要的 key/index、bullet 不需要的 key、属性不需要的 index，以及可选 occurrence。保留未知字段和非空的错误字段，继续拒绝 bullet 的 null index、属性的 null key、伪造原句、无效引用。

没有丢弃问题或伪造位置；没有放宽必需引用、数字来源和发布权限；没有更换模型、调整提示词或添加自动重试。

## 验证

新增回归测试先复现失败，修复后通过，包含 null 兼容和必需位置/未知字段拒绝。104 项服务端测试、类型检查、842 文件凭据检查和 diff 检查通过。

在同一独立验收任务 B-ACCEPT-1788879026672 中，通过真实 Vite 代理和 HTTP API 验证：

1. 规则版本变化使旧批准失效；正常 500ml 文案重新审核通过。
2. 标题改为 750ml，旧审核失效，直接发布被 HTTP 409 拒绝。
3. 实际调用 Qwen 返回 blocked，定位 title 中的 750ml，引用 capacity，建议改回 500ml。发布仍被 HTTP 409 拒绝。
4. 修正后未审核不能发布；再次真实审核通过，重新读取仍保留当前授权。

修复后 3 次真实审核共 5013 tokens，均成功；诊断另 1 次调用 1761 tokens。本轮没有成功发布操作，没有改动用户原有任务。验收任务最终保留正确文案和通过状态。

[完整验收过程](../artifacts/b-review/real-input-fix/acceptance-after.json) · [真实调用审计](../artifacts/b-review/real-input-fix/audit-after.json)

浏览器工具不可用，本次是服务端业务闭环验收，不是浏览器页面/按钮视觉验收。其余已知模型语义和引用限制未因此消失。可在 http://localhost:5175/ 手动查看。
