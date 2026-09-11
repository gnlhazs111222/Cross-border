# 资料输入：图片与 PDF 资源导入

更新：2026-09-11。本次只做 C 线「资料输入」节点：接收图片与规格 PDF、按 SKU 关联、落库并暴露给下游。**不包含**多模态解析、不修改 v1/v2 事实卡语义、不影响推荐资格、审核白名单与定价。

## 1. 一句话说明

资产是**商品池级**的原始资料，属于某个 SKU，不属于某个任务或某张事实卡。文件本体存在磁盘，元数据存在 SQLite；下游解析器按 `productId` 读取资产列表，解析结果再以 `assetId` 回引用。

## 2. 数据模型：`ProductAsset`

建表迁移：`prisma/migrations/20260911000000_product_assets/migration.sql`。表名与模型名一致。

| 字段 | 类型 | 含义与约束 | 示例 |
| --- | --- | --- | --- |
| `id` | TEXT 主键 | cuid，接口里叫 `recordId` | `cm3k...` |
| `userId` | TEXT | 归属用户，级联删除 | 登录用户 id |
| `productId` | TEXT | 归属商品，级联删除 | `cuid` |
| `sku` | TEXT | 冗余保存，便于按 SKU 查询 | `LM-KT-BTL-001-BLK-500` |
| `kind` | TEXT | `image` / `pdf`，**由文件字节推断**，不采信前端 | `image` |
| `role` | TEXT | `main` / `detail` / `packaging` / `spec` / `other`；不传时按规则默认 | `main` |
| `fileName` | TEXT | 清洗后的原始文件名，仅用于展示 | `front view.png` |
| `mimeType` | TEXT | `image/png` / `image/jpeg` / `image/webp` / `application/pdf`，同样由字节推断 | `image/png` |
| `byteSize` | INTEGER | 解码后的真实字节数 | `4096` |
| `sha256` | TEXT | 文件内容哈希，用于去重与追溯 | `9f2c...` |
| `storageKey` | TEXT | 相对存储路径 `<userId>/<sha256>.<ext>` | `cm3k.../9f2c....png` |
| `parseStatus` | TEXT | `pending` / `parsed` / `failed`，默认 `pending`；本轮只写 `pending` | `pending` |
| `createdAt` / `updatedAt` | DATETIME | 上传时间与更新时间 | — |

唯一约束 `(productId, sha256)`：同一 SKU 下相同内容只保存一份。索引 `(userId, sku)` 便于按用户与 SKU 查询。

## 3. 文件落在哪里

- 目录：`ASSET_STORAGE_DIR`，默认 `.local/assets`（相对启动目录解析为绝对路径）。`.local/` 已在 `.gitignore` 中，不会进仓库。
- 路径：`<ASSET_STORAGE_DIR>/<userId>/<sha256>.<ext>`，扩展名由推断出的类型决定（png/jpg/webp/pdf）。
- 权限：写入时使用 `0600`。
- 原始文件名**不参与**路径拼接，只清洗后存进数据库，避免路径穿越。
- 内容寻址带来天然去重：重复上传相同字节不会新增文件，也不会新增行。
- 目录替换（`replace` 导入）或演示重置会级联删除数据库行，并调用 `pruneOrphanAssetFiles` 清掉该用户目录下已无引用的文件。

## 4. 上传校验规则

按顺序执行，任一失败即拒绝，且失败请求不写库、不落盘：

1. 体积：解码后不超过 `ASSET_MAX_BYTES`（默认 4 MB），超出返回 413 `asset_too_large`。
2. 类型：按魔数识别 PNG / JPEG / WebP / PDF，其他返回 400 `unsupported_asset_type`。
3. 一致性：请求声明的 `mimeType` 必须与推断结果一致，否则 400 `asset_type_mismatch`。
4. 数量：每个 SKU 不超过 `ASSET_MAX_PER_PRODUCT`（默认 20），超出返回 409 `asset_limit`。
5. 归属：商品必须属于当前登录用户，否则 404。
6. 编码：必须是标准 base64，否则 400 `invalid_asset_encoding`。

配置项（`server/config.ts` 与 `.env.example`）：`ASSET_STORAGE_DIR`、`ASSET_MAX_BYTES`、`ASSET_MAX_PER_PRODUCT`。上传路由的单次请求体上限由 `ASSET_MAX_BYTES × 1.4 + 8KB` 推导，给 base64 膨胀留余量。

`role` 缺省规则：PDF → `spec`；图片且该 SKU 还没有 `main` → `main`；否则 → `detail`。

## 5. 接口

全部要求登录（Cookie 会话），并且校验商品与资产的用户归属。

```text
GET    /api/products/:id/assets          id 可以是 recordId 或 SKU
POST   /api/products/:id/assets          单个文件，base64 JSON
GET    /api/assets/:id/content           返回原始字节，带真实 Content-Type
DELETE /api/assets/:id                   删除元数据并在无其他引用时删除文件
```

上传请求：

```json
{
  "fileName": "spec.pdf",
  "mimeType": "application/pdf",
  "role": "spec",
  "contentBase64": "JVBERi0xLjQK..."
}
```

上传响应（`data` 内）：

```json
{
  "asset": { "recordId": "...", "sku": "...", "kind": "pdf", "role": "spec", "fileName": "spec.pdf",
             "mimeType": "application/pdf", "byteSize": 4096, "sha256": "...", "parseStatus": "pending",
             "uploadedAt": "2026-09-11T02:00:00.000Z" },
  "duplicate": false,
  "assets": [ ]
}
```

`duplicate: true` 表示相同内容已存在，返回的是原有记录，前端不应提示“新增成功”。

删除响应：`{ "deleted": true, "assets": [...] }`，`assets` 是删除后该 SKU 的完整列表，前端直接用它覆盖本地状态即可。

## 6. 下游怎么用

1. **事实快照**：`GET /api/tasks/:taskId/products/:productId/fact-snapshot` 的返回体新增 `assets` 字段，内容与 `GET /api/products/:id/assets` 完全一致（同一次查询映射）。
2. **后续多模态解析**：解析器读取 `assets` 里 `parseStatus = 'pending'` 的记录，用 `recordId` 调 `GET /api/assets/:id/content` 取原始字节；解析产出写入 v2 增强字段时，通过 `assetId` / `recordId` 建立引用，必要时把 `parseStatus` 更新为 `parsed` 或 `failed`。
3. **审核与文案**：资产不直接进入 Listing 或审核输入。只有解析后变成 `Confirmed` 且 `allowed` 的事实才会进入 B 线的白名单（`COPY_FACTS`）。
4. **版本语义**：上传或删除资产**不会**改变 `factsRevision`，因此不会使已有审核或发布失效。真正使其失效的是事实卡变更，语义保持不变。

## 7. 与既有 `Evidence` 的关系

`FactCard.evidence` 仍是演示用的模拟证据元数据（表格 / 规格 PDF / 商品图各一条），本轮未改动，避免影响既有事实链路与测试。真实上传的资产走 `ProductAsset` 与快照的 `assets` 字段。后续第 4 步会把真实资产接入证据展示与解析结果引用，届时再决定是否替换 `Evidence` 的模拟行。

## 8. 未包含

分片 / 断点续传、对象存储、病毒扫描、图片尺寸与 EXIF 解析、PDF 文本抽取、解析状态回写接口、资产与事实字段的引用关系表。这些都属于后续节点。
