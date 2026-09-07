# 人工事实核对版本验收

日期：2026-09-07。目录：`/mnt/data/pyc/Create_new_products`，分支：`pyc`。

## 基线和范围

开始时已核对实际源码、类型、定价、文案和原有测试。稳定导入代码已在本地提交 `8c952fe`，无需再提交一次初版。

先重跑原有 16 项测试：**16 passed (25.6s)**，测试配置同时执行生产构建。之后增加人工 Fact Review，不新增后端、数据库、外部 AI 或业务 API。

原有进度总结 Markdown 在本轮开始前已有未提交修改，另有一份原先未跟踪的《项目流程梳理与优化建议.md》；均保留，不纳入本轮功能提交。测试重写的旧截图不纳入提交，新增的人工确认截图有意作为验收附件保留。

## 最终命令与结果

```bash
export PATH=/mnt/data/pyc/.nvm/versions/node/v22.23.2/bin:$PATH
npm run typecheck
npm run build
npm run test:e2e
```

- TypeScript：通过。
- Build：通过，Vite 7.3.6 生成生产资源。
- 全部测试：**22 passed (26.7s)**，原有 16 项未删除，新增 6 项。
- 共 20 项浏览器操作测试、2 项不启动浏览器的解析器 / 业务 API 校验。
- 仓库无独立 lint 命令；保留严格 TypeScript 检查。

## 新增六项测试实际覆盖

| 测试 | 验证结果 |
| --- | --- |
| 内置缺重量商品，中文 375px | 初始 Missing / Pricing Blocked；填 0.42 后仍待确认且阻断；Confirm 后来源人工确认、状态 Confirmed、建议价 USD 19.20；刷新恢复、目录显示 Ready，能继续生成 Shopify 文案 |
| 导入缺重量商品，英文 | XLSX 导入后修复 `LM-KT-IMP-005-BLK-500`，建议价 USD 18.90；记录真实原文件来源、前值和确认时间；原始目录数据不被改写；V2 分析不覆盖 V1 |
| 长宽高与非法数字 | 空值、0、负数保存失败；三项尺寸逐一补齐并确认，只有最后一项确认后解除定价阻断 |
| 双平台结果失效 | 先完成 Amazon 和 Shopify 发布；修改颜色后两个平台的文案、审核、发布全部清除；颜色待确认时不能生成，确认后生成 Ivory 文案并重新审核；再改重量重新阻断定价、清除旧结果 |
| 待确认 / 拒绝字段过滤 | 待确认杯盖、包装内容，以及拒绝工艺和防漏宣称不进入正常 Shopify 文案；确认 Flip-top lid、包装内容后使用新值；编辑容量、材质、原产国真实进入新文案；拒绝吸管后不产生有 / 无吸管的错误推断；V2-only 修改不反写 V1 |
| API 校验与入口约束 | Missing 不能 Confirm；非法重量不能保存；采购成本确认后真实改变价格但仍禁止用于消费者文案；防漏宣称不能编辑或授权；重复、疑似重复和类目不符商品不能借 Fact Review 入口绕过生成限制 |

原主角的 XLSX / CSV → Top 1 → V2 → 19.99 → Amazon → R001 → Fix → Re-review → Publish → CSV 两条导入链路继续通过。原有双语、刷新恢复、旧状态迁移、重复排除等回归也通过。

新增测试中曾发现导航按钮的无障碍名称随进度数字变化，导致精确定位失败；已将纯装饰序号设置为 `aria-hidden`，保持视觉结构，并重新通过测试。没有放宽业务断言或跳过失败用例。

## 状态、来源与失效规则

- 复用 `Fact.status`、`Fact.allowed`。状态为 Confirmed、Requires Confirmation、Missing、Rejected。
- 手动编辑先保存为待确认，Confirm 后才授权；禁止将空值或非法数值确认。
- 来源为 `Manual confirmation`，记录 `sourceKind: manual`、previousValue、previousSource、updatedAt、confirmedAt 和字段 revision。
- 原始目录保留，人工结果保存在 localStorage 的 `factEdits` 中；有效事实驱动目录视图、推荐、定价和文案。
- V1 增加长宽高后为 11 个基础字段。人工明确修改基础字段可更新 V1；V2 继承更新后的基础事实。只修改 V2 增强字段不会反写 V1。
- 重量、尺寸、采购成本改变定价确认条件及快照版本；颜色等非价格字段不改变定价版本。
- 任意人工事实变更均清除当前商品两个平台的旧文案、审核和发布结果。新文案记录事实版本，发布前再检查版本匹配。
- 正常文案与修订模板只使用 Confirmed 且 allowed 的事实。成本、申报价值、重量、尺寸始终禁止进入消费者文案。
- 为保持原主角演示步骤，主角既有 V2 Mock 确认状态保留；其他商品的新 V2 增强事实先待确认。独立的 Amazon 风险注入机制保留并在 UI 说明。

## 实际页面与截图

5173 本地生产预览正常响应。另通过浏览器在中文界面上传真实 XLSX 示例，打开缺重量商品，保存 0.42 kg、确认，核对价格为 USD 18.90，并保存截图：

`artifacts/fact-review-confirmed-zh.png`

详细操作说明见 `FACT_REVIEW.md`。人工确认是操作人员的决定记录，不代表新增独立证据或产品性能认证。物流等费用仍采用原 Demo 假设。

## 修改文件

- `src/components/FactReview.tsx`：事实表格、编辑对话框、确认 / 拒绝操作、来源详情。
- `src/services/factReview.ts`：编辑字段规则、单位、数值校验和文案权限。
- `src/services/mockApi.ts`：手动事实保存、有效商品视图、V1/V2 同步、定价、下游失效及发布检查。
- `src/types/index.ts`：扩展状态、人工元数据、事实版本和长宽高类型。
- `src/services/supplierImport.ts`：保留独立长宽高数值，支持逐项补齐。
- `src/pages/Materials.tsx`：缺资料商品的“核对事实”入口。
- `src/pages/EvidenceFacts.tsx`：接入 Fact Review 和定价结果。
- `src/pages/ListingStudio.tsx`：未确认必需事实及其他前置限制的禁用 / 提示。
- `src/pages/ReviewPublish.tsx`：修订说明根据当前已允许字段显示。
- `src/components/PricingPanel.tsx`：Pricing Ready 和确认输入缺失提示。
- `src/App.tsx`：有效目录视图与稳定的导航无障碍名称。
- `src/i18n/zh.json`、`src/styles.css`：中英文与沿用原风格的新增交互。
- `tests/fact-review.spec.ts`：新增六项验收。
- `README.md`、`FACT_REVIEW.md`、本记录及截图：文档和验收材料。

本轮只创建独立本地提交，不自动 push，不改写已有稳定提交。
