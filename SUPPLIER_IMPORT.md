# 供应商 Excel / CSV 导入说明

当前版本支持从真实本地 `.xlsx` / `.csv` 文件开始演示。文件由浏览器中的 SheetJS 解析，经 `services/mockApi.ts` 校验、保存，再进入已有上新流程。没有后端、在线文件上传或智能字段猜测。

## 从页面开始

1. 打开 `http://localhost:5173`，进入 **商品资料 / Materials**。
2. 点击顶部 **Excel (.xlsx)** 或 **CSV (.csv)**，下载示例。
3. 点击 **导入供应商文件 / Import Supplier File**，选择刚才下载的文件。
4. 默认方式为 **替换当前资料集**；先查看预览摘要和逐行校验结果。
5. 示例应显示：**8 行处理、6 个 Ready、1 个 Missing Data、1 个 Duplicate、0 个 Invalid row**。
6. 点击 **导入 7 个商品**。Materials 显示 7 个真实解析得到的商品，重复行不写入。
7. 点击缺包装重量商品 `LM-KT-IMP-005-BLK-500`，可查看 **Missing Data / Pricing Blocked**。
8. **创建演示任务 → Top 1 选择 → 分析证据 → USD 19.99 → 生成 Amazon 文案 → 审核 → R001 拦截 → 应用建议修订 → 再次审核 → 发布 → CSV 导出**。

点击 **载入内置数据 / Load Demo Dataset** 或 **重置演示 / Reset Demo**，均可恢复最初 10 个内置 SKU 并清除业务进度。语言偏好保留。

## 示例文件

- `public/demo/prismlaunch-supplier-demo.xlsx`
- `public/demo/prismlaunch-supplier-demo.csv`

二者内容一致，包含主角、缺包装重量、有吸管、750ml、三个不同颜色的完整商品和一行重复主角。

重复主角故意填写了 USD 99 的成本；系统应保留前面有效主角的 USD 8.20，跳过重复行，不能用 USD 99 覆盖它。

CSV 是可编辑的示例源文件。修改后可重新生成 XLSX：

```bash
node scripts/generate-supplier-sample.mjs
```

## 固定模板

第一行必须是下面 14 个列名：拼写、大小写完全一致，可调整列顺序，不支持增减列。Excel 只支持一个工作表；CSV 使用 UTF-8（可带 BOM）和英文逗号，支持标准引号、单元格内逗号及换行。

```csv
sku,productName,category,color,capacityMl,material,hasStraw,countryOfOrigin,supplierCost,declaredValue,packagingWeightKg,packageLengthCm,packageWidthCm,packageHeightCm
```

| 列 | 类型与规则 | Product 中的对应字段 |
| --- | --- | --- |
| `sku` | 必填文本；同一资料集内唯一 | `sku` |
| `productName` | 必填文本 | `name` |
| `category` | 必填文本；当前任务只推荐 `Home & Kitchen` | `category` |
| `color` | 必填文本；当前任务偏好 `Black` | `color` |
| `capacityMl` | 必填正整数，单位 ml | `capacity`；自动换算 `localizedCapacity` 为 fl oz |
| `material` | 必填文本 | `material` |
| `hasStraw` | 必填，true / false / 1 / 0，支持 Excel 布尔值 | `straw` |
| `countryOfOrigin` | 必填文本 | `countryOfOrigin` |
| `supplierCost` | 必填非负数，USD | `supplierCost` |
| `declaredValue` | 必填非负数，USD | `declaredValue` |
| `packagingWeightKg` | 可留空；填写时须为正数，kg | `packagingWeight` |
| `packageLengthCm` | 可留空；填写时须为正数，cm | 与宽、高合成 `packagingDimensions` |
| `packageWidthCm` | 同上 | 同上 |
| `packageHeightCm` | 同上 | 同上 |

限制：每个文件最多 2 MB、500 行商品；当前资料集最多 500 个商品。单字段最多 220 个字符。使用普通数据值，不支持公式、公式错误单元格或公式形式的文本。数字不带货币符号和千位分隔符。

缺列、额外列、重复表头、列名拼写错误或多工作表都会明确提示 **Unsupported supplier template**，不会猜测映射。

## 导入方式与重复处理

- **替换当前资料集（默认）**：以当前文件的有效商品替换整个目录。原有商品不参与本次去重；文件内同 SKU 仅保留第一条有效商品。
- **仅添加新 SKU**：保留当前商品，仅追加新 SKU。与已有目录重复或在文件内重复的 SKU 会跳过，不覆盖现有商品。
- **无效行**：缺必填项、非法数字或布尔值等会标为 Invalid row，并显示行号和字段原因。其他有效行仍可导入。
- **缺包装信息**：商品仍能保存，但标记 Missing Data、Pricing Blocked，不进入推荐。
- **整文件错误、全是无效 / 重复行、取消预览**：不修改当前目录、任务或审核状态。
- **成功导入（两种方式均如此）**：重置旧任务、证据、文案、审核和发布状态，避免沿用旧版本结果。

示例按默认替换方式导入后得到 7 个商品；按追加方式导入到最初 10 个 SKU 时，新增 3 个、跳过 5 个重复行，目录变为 13 个商品。再次追加同一示例，8 行全部重复，不再写入。

## 数据真实到哪一步

- 文件内容确实经过解析；颜色、容量、材质、吸管、产地、成本、申报价值、包装信息来自文件。
- 商品保存文件名、工作表名称和原始行号。导入商品的 FactCard V1 使用这些实际来源位置。
- `Confirmed` 在此 Demo 中仅表示完成固定模板的数据确认，不代表已独立验证供应商真实性。
- V2 的包装内含、工艺、杯盖等补充事实仍由原 Mock 流程提供，来源名称和页面说明明确标注 Mock。
- 推荐、文案生成、风险审核和发布继续使用原来的固定规则与模板，不连接外部业务 API。
- 采购成本和申报价值使用导入值。运费、关税、平台费用及最低利润仍是演示假设；示例主角为 USD 19.99。若导入主角的采购成本更高，价格不会低于模拟总成本加目标利润。
- 中英文切换只改变界面。商品原始值不会自动翻译；美国站文案和导出仍使用原有英文模板。
- 导入目录和结果摘要随业务状态保存在 localStorage；刷新恢复，旧版没有 `catalog` 字段的会话会自动补入内置目录。

## 验证和实现位置

```bash
npm run typecheck
npm run build
npm run test:e2e
```

项目没有独立 lint 脚本。浏览器测试会自行构建并在 4173 端口启动生产预览；平时演示使用 5173。

- `src/data/supplierTemplate.ts`：固定表头和大小限制。
- `src/services/supplierImport.ts`：读取、严格表头校验、逐行校验、SKU 去重、字段映射。
- `src/services/mockApi.ts`：预览与提交、目录持久化、回退、与原流程连接。
- `src/components/SupplierImport.tsx`：选择文件、预览、错误详情、导入摘要。
- `tests/import.spec.ts`：真实文件上传后的完整链路、追加去重、坏文件、数据连续性、中文手机界面、旧状态迁移。

SheetJS 使用官方固定发行包 0.20.3，安装依据：[Frameworks and Bundlers](https://docs.sheetjs.com/docs/getting-started/installation/frameworks/)。解析器打包为本地按需加载的资源，页面运行时不会从 SheetJS CDN 拉取脚本，也不会向它发送文件。

## 供应商表格的列

导入只认这套列名（大小写敏感，顺序任意）。必需列缺任何一列，整份文件都会被拒绝，并在提示里列出缺哪几列；其余列可以自由增减。

| 列名 | 必需 | 含义与边界 |
| --- | --- | --- |
| `sku` | 是 | 唯一编码。为空时系统会生成 `IMPORT-<行号>`，并记入待补 |
| `productName` | 是 | 商品名。包含"包/bag/tote"或"灯/lamp"时必须与类目一致，否则整行判错 |
| `category` | 是 | 一级类目，决定商品类型：`Bags & Accessories`→包、`Electronics`→灯、其余→瓶类 |
| `color` | 是 | 颜色，支持中英与修饰词（`哑光黑`＝`Matte Black`＝`black`） |
| `capacityMl` | 是 | 容量（毫升）。瓶类必须大于 0；缺失或为 0 记入待补 |
| `material` | 是 | 材质，支持 `304不锈钢`＝`Stainless Steel` |
| `hasStraw` | 是 | 是否带吸管：`true/false/1/0`。空值记入待补（别名 `straw` 亦可） |
| `countryOfOrigin` | 是 | 原产国，用于税费估算。空值记入待补 |
| `supplierCost` | 是 | 采购成本，决定定价。空值记入待补，售价显示"待补" |
| `declaredValue` | 是 | 申报价值，用于税费。空值记入待补 |
| `packagingWeightKg` | 否 | 包装重量（kg），定价与物流用；缺失则定价待补 |
| `packageLengthCm` `packageWidthCm` `packageHeightCm` | 否 | 包装尺寸（cm），同上 |

以下是**可选列**，按用途分三类：

| 列名 | 是否被读取 | 用途 |
| --- | --- | --- |
| `images` | 读取 | 该行引用的图片文件名（分号分隔）。导入时在所选资料文件夹里按文件名匹配，匹配不上会报"缺少文件" |
| `specs` | 读取 | 同上，用于规格 PDF |
| `assetUrls` / `imageUrls` | 读取 | 图片或 PDF 的下载链接（分号分隔）。走服务端下载通道：仅 https、域名白名单、禁内网、逐跳校验重定向；列名写错会静默没有图 |
| `model` `brand` `productType` `variant` `sourceRow` `estimatedFields` | 忽略 | 分析辅助列（型号、品牌、变体名、来源行号、哪些值是估算的）。可留可删，放进表格不会报错 |

注意两点：一是**列名必须完全一致**，写成 `capacity` 而不是 `capacityMl` 会被当作缺列；二是**被读取的四列改名不会报错，只会静默失效**，整理数据时不要改它们。

数据的准则是"**结构必须规范，格式可以宽容**"：类目与商品类型、瓶类容量这类**结构性问题**必须改数据，系统直接拒绝；全角/大小写/单位写法/同义词这类**格式差异**系统自己归一化；产地、材质、成本这类**缺失**记录为待补，不阻断流程。