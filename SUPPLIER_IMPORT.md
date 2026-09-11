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
- `public/demo/prismlaunch-bag-demo.csv`

前两份水杯样例内容一致，包含主角、缺包装重量、有吸管、750ml、三个不同颜色的完整商品和一行重复主角。包类 CSV 包含一个黑色帆布托特包，用于完整包类演示。

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
| `category` | 必填文本；当前完整流程支持 `Home & Kitchen` 与 `Bags & Accessories` | `category` |
| `color` | 必填文本；当前任务偏好 `Black` | `color` |
| `capacityMl` | 水杯必填正整数，单位 ml；包类可留空 | `capacity`；水杯自动换算 `localizedCapacity` 为 fl oz |
| `material` | 必填文本 | `material` |
| `hasStraw` | 水杯必填，true / false / 1 / 0；包类可留空 | `straw` |
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
- **缺包装信息**：商品仍能保存并参与选品，但标记 Missing Data、Pricing Blocked；选中后需补齐并确认定价资料，才能得到建议售价和发布。
- **整文件错误、全是无效 / 重复行、取消预览**：不修改当前目录、任务或审核状态。
- **成功导入（两种方式均如此）**：重置旧任务、证据、文案、审核和发布状态，避免沿用旧版本结果。

示例按默认替换方式导入后得到 7 个商品；按追加方式导入到最初 10 个 SKU 时，新增 3 个、跳过 5 个重复行，目录变为 13 个商品。再次追加同一示例，8 行全部重复，不再写入。

## 数据真实到哪一步

- 文件内容确实经过解析；颜色、容量、材质、吸管、产地、成本、申报价值、包装信息来自文件。
- 商品保存文件名、工作表名称和原始行号。导入商品的 FactCard V1 使用这些实际来源位置。
- `Confirmed` 在此 Demo 中仅表示完成固定模板的数据确认，不代表已独立验证供应商真实性。
- V2 的包装内含、工艺、杯盖或包口/肩带等补充事实仍由 Mock 流程提供，来源名称和页面说明明确标注 Mock。
- 推荐、文案生成、风险审核和发布继续使用原来的固定规则与模板，不连接外部业务 API。
- 采购成本和申报价值使用导入值。运费、关税、平台费用及最低利润仍是演示假设，但不参与商品过滤或排序；选中 SKU 后，建议售价才读取这些定价资料和任务价格目标。示例主角在最低利润 USD 5 时为 USD 19.99；若采购成本或价格目标更高，价格不会低于模拟总成本加目标利润。
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
