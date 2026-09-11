# 托特包完整流程 Demo

当前版本新增一个边界明确的托特包闭环，不宣称支持任意包类或台灯。

## 演示入口

1. 登录 Full Demo，进入“上新任务”。
2. 点击“载入包类演示”。系统只推荐 `Bags & Accessories` 中的托特包，台灯仍被排除。
3. 选择 `LM-BG-TOT-009-BLK`；若先导入 `public/demo/prismlaunch-bag-demo.csv`，则选择 `LM-BG-TOT-101-BLK`。
4. 进入证据与事实。V1 包含颜色、材质、包袋类型、产地及内部定价字段，不出现水杯容量或吸管。
5. 点击“分析证据”。V2 增加包装内含、可见纹理、包口和肩带；这些图片衍生字段默认待人工确认。确认包口和肩带后，它们才会进入文案。
6. 进入文案工作室，生成 Amazon 文案，确认已出现 `Open top closure` 和 `Dual shoulder straps`。首稿还会故意加入 `Guaranteed to carry up to 50 kg.`，用于演示无证据承重宣称拦截。
7. 运行审核，确认出现 `R003 Unsupported load claim`；应用建议修订，再次审核通过。
8. 模拟发布并下载 Amazon CSV。导出内容不得出现水杯、容量、吸管、防漏或 50kg 承重宣称。

## 数据与能力边界

- 固定模板仍是 14 列；水杯必须填写 `capacityMl` 和 `hasStraw`，包类可将两列留空。
- 包类基础事实来自供应商行；图片/PDF 补充仍是带明确标记的 Mock，并未进行真实视觉识别或 PDF 解析。
- 图片只能支持可见外形、包口和肩带候选，不能证明帆布真实性、耐用性或承重能力。
- 模板、规则推荐和规则审核均已覆盖托特包。Qwen Prompt/授权字段已经扩展为包类结构，但本轮没有发起新的真实模型调用，因此不能把模板测试当成 Qwen 包类效果证据。
- 台灯仍返回 `Unsupported product type`，没有进入推荐、事实生成和 Listing 流程。

## 验证

```bash
npm run typecheck
npm run build
npm run test:server
npx playwright test tests/bag-flow.spec.ts
npm run test:e2e
```
