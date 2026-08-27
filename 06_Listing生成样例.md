# Listing 生成样例

> **示例商品：** LumaNest 500ml 不锈钢随行水瓶（演示商品）  
> **生成前提：** 仅使用商品事实卡中“已确认且可写入 Listing”的字段；重量、包装清单、保温、防漏和认证信息不进入本次生成上下文。

## 一、事实与本地化摘要

| 项目 | 已确认、可用内容 | 不允许写入 |
|---|---|---|
| 容量 | 500 ml / 16.9 fl oz | — |
| 材质与颜色 | 304 stainless steel；Black | — |
| 尺寸 | 约 2.8 × 2.8 × 10.4 in | 未复核的重量 |
| 使用表达 | work, commute, campus, short trips | 保温、防漏、认证、安全承诺 |
| 包装与图片 | 主图、细节图可用 | 未确认的清洁刷／包装清单 |

## 二、建议售价

| 项目 | 示例 |
|---|---|
| 建议售价 | **USD 21.99** |
| 产生时间 | 商品事实确认后；使用任务 `PL-20260826-001` 的费用费率与汇率快照 |
| 计算依据 | 已确认供货资料、包装资料、税费预估、平台费用版本与“最低单件利润 ≥ USD 5” |
| 展示位置 | Listing 草稿的价格字段 |
| 操作状态 | `待运营确认`；运营人员可以修改，系统保留原建议值、修改原因和测算版本 |

**计算边界：** 每次创建新的上新任务时，系统重新获取最新可用参考汇率，并在该任务内冻结；新任务不会复用旧任务的汇率。费率阶梯、最低收费或类目差异由后台版本化规则迭代试算。支付／交易手续费、广告费、售后退款和长期仓储费等难以稳定估算的项目，不纳入比赛 MVP 的建议售价测算。
> 建议售价仅是基于当前任务快照和已确认资料的测算结果。运营人员可修改或不采用该值；系统应保留原建议值、人工修改原因、费用快照版本和事实卡版本，以便追溯。

## 三、Amazon US Listing 草稿

### 1. 商品标题

**LumaNest 16.9 fl oz Stainless Steel Water Bottle, 500 ml Reusable Drink Bottle, Black, Compact for Work and Commute**

> 标题将原始 `500 ml` 与美国常用容量 `16.9 fl oz` 并列呈现；具体字段格式仍由目标类目规则复核。

### 2. 五点卖点

1. **500 ML EVERYDAY CAPACITY:** Holds up to 500 ml / 16.9 fl oz for water and everyday drinks at work, on campus and during commutes.  
   `evidence: capacity`
2. **304 STAINLESS STEEL BODY:** Built with a 304 stainless steel bottle body in a clean black finish.  
   `evidence: material, color`
3. **COMPACT VERTICAL SHAPE:** Measures approximately 2.8 × 2.8 × 10.4 in for a compact daily-carry profile.  
   `evidence: dimensions`
4. **FOR DAILY ROUTINES:** A reusable drinkware option for desks, classes, commutes and short trips.  
   `evidence: confirmed use-context template`
5. **CHECK LISTING DETAILS BEFORE PURCHASE:** Review final product images and package information shown on this page.  
   `evidence: packaging status`

### 3. 商品描述

Bring a simple reusable bottle into your everyday routine with the LumaNest 500 ml Stainless Steel Water Bottle. The 16.9 fl oz capacity and compact vertical profile fit workdays, commutes, classes and short trips. Its black 304 stainless steel bottle body keeps the product presentation clean and practical.

Before publishing, the seller must confirm final package contents and review all product images, dimensions and care guidance.

### 4. 自动拦截的高风险表达

| 候选表达 | 拦截原因 | 处理 |
|---|---|---|
| Keeps drinks cold for 24 hours | 无性能证据 | 禁止输出 |
| 100% leakproof lid | 无测试或结构依据 | 禁止输出 |
| BPA-free and food-grade certified | 文件未完成市场适用性审核 | 禁止输出 |
| Dishwasher safe | 仅有低置信度邮件来源 | 标记待确认 |

## 四、Shopify US 商品草稿

### 1. 商品标题

**LumaNest 500 ml Stainless Steel Water Bottle – Black**

### 2. 详情页文案

#### A reusable bottle for everyday routines

The LumaNest 500 ml Stainless Steel Water Bottle is made for everyday carry at work, on campus, during commutes and while traveling. With a 16.9 fl oz capacity and a compact vertical shape, it is easy to keep close throughout the day.

**Product details**

- Capacity: 500 ml / 16.9 fl oz
- Material: 304 stainless steel bottle body
- Color: Black
- Dimensions: approximately 2.8 × 2.8 × 10.4 in
- Suggested occasions: office, commute, school and short trips

**Before you buy**

Please review final product images and package contents on this page. Product care guidance and certification-related information should be published only after seller confirmation.

### 3. SEO 与字段

| 字段 | 内容 |
|---|---|
| SEO Title | LumaNest 500 ml Stainless Steel Water Bottle – Black |
| Meta Description | Shop the LumaNest 500 ml stainless steel water bottle in black. A compact reusable 16.9 fl oz drink bottle for work, commute and travel. |
| URL Handle | lumanest-500ml-stainless-steel-water-bottle-black |
| Metafield: capacity | 500 ml / 16.9 fl oz |
| Metafield: material | 304 stainless steel |
| Metafield: evidence_status | verified_core_attributes |

## 五、受控生成过程

```text
已确认商品事实 + 本地化术语／单位规则 + 平台字段规则
                         ↓
生成标题、卖点、描述和结构化字段
                         ↓
每段内容绑定事实证据
                         ↓
检查必填项、字符数、风险词、未验证声明和图片一致性
                         ↓
输出可编辑 Listing 草稿 + 风险提示 + 发布建议
```

