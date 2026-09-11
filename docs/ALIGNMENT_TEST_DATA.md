# 对齐测试数据：不联网的做法

更新：2026-09-11。用途只有一个：**用数据回答"要不要上 embedding"以及"规则够不够"**。
全部命令都不联网、不需要 API Key、不调用模型。爬虫已按需求移除。

## 1. 三条路径

| 命令 | 需要启动应用 | 用到的数据 |
| --- | --- | --- |
| `npm run align:catalog` | 否（直接读 SQLite，只读） | 商品池 + 已上传图片的 sha256 |
| `npm run align:report -- a.xlsx b.csv` | 否 | 你手上的 Excel / CSV |
| `npm run make:test-images` + `npm run attach:images` | 上传时需要 | 生成的测试图片 |

三条都输出同一套统计（同一／冲突／灰区／无关），并写出一份带 `human_label` 空列的待人工标注文件。

## 2. 内置 mock 商品没有图片，先造几张

这不是没实现，是没数据：内置的 10 个商品在界面上只有 SVG 占位，没有任何真实图片文件。所以要验证图片哈希这条信号，得先有图片。

```powershell
npm run make:test-images -- --out .local\test-images --count 4
```

它会写出 `image-01.png` … `image-04.png`，以及一个 **与 `image-01.png` 字节完全相同** 的 `image-01-copy.png`。文件是脚本生成的合法 PNG（8 位真彩、320×320），不依赖任何图片库。

## 3. 把图片挂到两个不同 SKU 上

**方式一：命令行（推荐，一步完成）**

```powershell
# 终端 A：先起后端
npm run dev:api

# 终端 B：把同内容的图片挂到两个不同 SKU
npm run attach:images -- --assign "LM-KT-BTL-001-BLK-500=.local/test-images/image-01.png" --assign "LM-KT-BTL-002-BLK-500=.local/test-images/image-01-copy.png"
```

参数：`--base`（默认 `http://127.0.0.1:3001`）、`--email` / `--password`（默认 demo 账户）。脚本会登录、上传、打印每个 SKU 得到的 sha256 和是否已存在，然后提示你跑报告。

**方式二：界面**：`npm run dev` → 登录 → 商品资料 → 点开商品 → "原始资源" → 选择文件上传。

## 4. 出报告

```powershell
npm run align:catalog -- --pairs .local\catalog-pairs.csv --json .local\catalog.json
```

预期看到的变化（这也是这条信号被验证的证据）：

- `products with images` 从 0 变成 2；
- `distinct image hashes` 是 1（两张图字节相同）；
- 输出里出现 `Pairs matched through image content`，把两个不同 SKU 判为**同一**；
- 如果把其中一张换成 `image-02.png` 再传一次，这条匹配就消失——说明判定确实来自图片内容，不是巧合。

## 5. 怎么用它决定 embedding

灰区占比**只说明规则分不开，不说明需要 embedding**。真正的判据是灰区里有多少确实是同一个商品：

1. 打开 `*-pairs-to-review.csv`；
2. 给每行 `human_label` 填 `same` 或 `different`；
3. 把文件和上面的控制台输出发我。

如果灰区大多是 `different`，说明它们只是"看起来像"，embedding 只会给高相似度，正确做法是补词典或调规则；如果灰区里确实有相当比例的 `same`，那才是 embedding 的收益点，而且只在这一个区间调用。

## 6. 有真实资料时的用法

```powershell
npm run align:report -- "D:\资料\a.xlsx" "D:\资料\b.csv" --pairs .local\pairs.csv --json .local\report.json
```

报告会额外给出**跨文件**的同一商品对数、冲突对数与灰区对数，也就是"同一商品出现在多份文件里"的情况。

## 7. 已知限制

- 图片哈希信号只统计**图片**资产；规格 PDF 不算身份证据（同一份 PDF 可能被多个供应商共用）。
- 规则优先级是：SKU/型号相同 → 图片哈希相同 → SKU 不同则不同。两个不同编码但图片字节相同时会判"同一"，若关键属性冲突则降级为"冲突"。
- 商品池目前只有内置 mock 数据，属性高度相似的商品少，因此灰区占比会偏低；真实资料进来后这个数字才有决策意义。
