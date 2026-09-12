# Excel / CSV 导入版本验收

日期：2026-09-07。工作目录：`/mnt/data/pyc/Create_new_products`，分支：`pyc`。

## 阶段 1：先验证原版

- 检查实际 Git 状态、package.json、源码和项目结构。
- 原版应用源码已经被 Git 跟踪并提交；基线为 `c7edd86`（Demo 代码提交为 `a8c176e`），无需重复创建初版提交。
- 原有未跟踪文件《项目流程梳理与优化建议.md》未修改、未纳入本轮提交。
- 实际执行 `npm run typecheck`、`npm run build`、`npm run test:e2e`。
- 没有独立 lint 脚本，使用已有严格 TypeScript 检查。
- 生产构建及原有 8 项 Chromium 界面测试全部通过：**8 passed (24.9s)**。
- 主链路、缺包装重量、Duplicate / Possible Duplicate、刷新恢复、中英文切换均由原有测试实际点击验证；5173 本地预览返回 HTTP 200。

阶段 1 完成后才开始增加导入功能。

## 阶段 2：实现范围

保留五个工作区和原业务流程。新增固定模板的 Excel / CSV 解析、逐行校验、导入预览、重复跳过、目录保存和内置数据回退；没有后端、数据库、登录或真实业务 API。

样例：

- `public/demo/prismlaunch-supplier-demo.xlsx`
- `public/demo/prismlaunch-supplier-demo.csv`

默认替换导入：**8 行处理 → 6 Ready + 1 Missing Data + 1 Duplicate + 0 Invalid → 保存 7 个商品**。

追加到初始目录：**8 行处理 → 新增 3 个、跳过 5 个重复 → 目录共 13 个商品**。再次追加不增加商品。

导入商品的基础事实来自文件，并记录文件名、工作表和行号。PDF／图片不做解析，V2 新增字段标注为“模拟分析”的演示样例；推荐、文案与审核仍保留 Mock 标识。任意供应商声明并未因此获得独立事实验证。

## 实际执行的命令与结果

```bash
export PATH=/mnt/data/pyc/.nvm/versions/node/v22.23.2/bin:$PATH
npm run typecheck
npm run build
npm run test:e2e
npm install --save-exact https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
node scripts/generate-supplier-sample.mjs
npm run typecheck
npm run build
npm run test:e2e
```

安装增加 4 个包，当次 npm audit 报告 0 vulnerabilities。解析器按需加载，本地生产资源中独立拆为约 369.46 kB（gzip 125.32 kB）的文件解析代码。

最终结果：**TypeScript 通过，build 通过，16 passed (26.2s)**。16 项包含原有 8 项、新增 7 项浏览器操作和 1 项解析器校验测试。

新增验收覆盖：

| 用例 | 实际检查 |
| --- | --- |
| XLSX 样例完整链路 | 浏览器选择真实文件、预览、保存、7 个商品、缺重量阻断、Top 1、V1 来源、V2、19.99、R001、修订重审、发布、CSV、刷新、内置回退与 Reset |
| CSV 样例完整链路 | 同上，输入格式改为真实 CSV |
| 追加及重复导入 | 现有 SKU 与文件内重复均跳过，保留原值；再次导入时写入按钮禁用、目录不变 |
| 坏文件不改业务状态 | 列名错误、重复表头、空文件、仅表头、伪造 XLSX 提示错误；原任务和目录不变；取消预览不导入 |
| 解析器校验 | 缺 SKU / 商品名、负数、非法布尔值、缺包装信息；CSV 引号、逗号、换行；Excel 公式拒绝、原生布尔值；多表拒绝、2 MB 限制、500 行限制、表头重排 |
| 非内置商品的数据传递 | 浏览器导入自定义 350ml 商品，USD 12.00 成本 / USD 6.75 申报价值进入 V1，建议价变为 USD 23.00，证明未偷换回内置数据 |
| 中文手机界面 | 375px 导入、中文结果、语言切换不改业务状态、刷新恢复、缺重量阻断 |
| 旧状态兼容 | 删除新字段模拟旧版会话，刷新后补回内置 catalog，保留原任务 |

两种格式的样例全链路均监听浏览器 pageerror，未发现异常。

独立于 SheetJS，又使用 Python 标准库 `csv`、`zipfile`、`xml.etree.ElementTree` 检查样例：CSV 与 XLSX 的 14 个表头和 8 行内容完全一致，ZIP CRC 正常，无公式，重复主角和缺重量行均存在。

另在实际提供给用户的 5173 预览中，通过浏览器点击下载 Excel，再上传刚下载的文件并导入。界面截图保存为 `artifacts/imported-materials-zh.png`。

验证中发现的两处开发问题均已修正：生成示例的 Node ESM 脚本改用 `write` + `writeFileSync`；新增主链路测试等待商品选择请求完成后再读取 V1。最终全量回归通过。

## 文件变更

| 位置 | 变更用途 |
| --- | --- |
| `src/data/supplierTemplate.ts` | 固定 14 列和文件 / 行数限制 |
| `src/services/supplierImport.ts` | SheetJS 解析、字段映射、校验、去重和导入预览 |
| `src/services/mockApi.ts` | 导入预览与提交、当前目录、旧状态迁移、内置回退、事实来源与定价衔接 |
| `src/types/index.ts`、`src/data/mockData.ts` | 导入报告、来源、目录和申报价值类型；保留内置数据 |
| `src/components/SupplierImport.tsx` | 文件选择、模式、摘要、错误详情和下载入口 |
| `src/App.tsx` | 从已保存目录获取商品；区分内置与导入标识 |
| `src/pages/Materials.tsx` | 导入入口、动态目录和信息提示 |
| `src/pages/LaunchTasks.tsx` | 根据实际目录显示候选数，处理无候选状态 |
| `src/pages/EvidenceFacts.tsx`、`ReviewPublish.tsx` | 区分真实文件来源与 Mock 补充证据 |
| `src/styles.css`、`src/i18n/zh.json` | 延续原风格的导入区样式与中文翻译 |
| `package.json`、`package-lock.json` | 固定 SheetJS 0.20.3 依赖 |
| `public/demo/`、`scripts/generate-supplier-sample.mjs` | 真实 CSV / XLSX 示例和再生成脚本 |
| `tests/import.spec.ts` | 新增导入校验与完整链路测试 |
| `.gitattributes` | 示例 CSV 的换行格式 |
| `README.md`、`SUPPLIER_IMPORT.md`、进度总结、本验收记录 | 使用方法、当前边界与结果 |

## 仍有限制

只支持固定表头、单工作表、UTF-8 逗号分隔 CSV、普通值和小规模资料集。重复判断仅按精确 SKU；不做语义匹配或覆盖更新。成功导入会重置任务等下游状态。供应商行值真实解析，但后续智能能力和平台发布仍为 Mock。浏览器存储不可用或超过配额时，刷新不能保证恢复，会显示原有存储提示。
