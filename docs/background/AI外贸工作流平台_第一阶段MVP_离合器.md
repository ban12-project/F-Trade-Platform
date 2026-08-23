# AI 外贸工作流平台｜第一阶段 MVP 技术方案
## 试点品类：汽车离合器

## 1. 第一阶段目标

第一阶段暂时不做完整的“AI 外贸平台”，而是选择一个真实、明确的产品品类：

> **汽车离合器 / Clutch**

通过一家真实离合器工厂，验证一条最小外贸业务闭环：

```text
离合器产品资料
↓
AI 产品结构化
↓
AI 营销内容生成
↓
人工审核
↓
海外社媒发布
↓
海外客户询盘
↓
AI 需求识别
↓
人工报价
↓
AI 持续跟单
↓
形成有效商机
```

第一阶段核心目标不是“功能多”，而是：

> **证明 AI 能够真实参与离合器产品的海外获客和销售过程。**

---

## 2. 第一阶段 Demo 范围

建议第一版严格限制为：

```text
1 家离合器工厂
+
10–30 个真实离合器 SKU
+
1 个海外社媒渠道
+
4 个业务 Agent
+
1 个 Workflow Orchestrator
+
3 个 Human Gate
```

首批产品不需要覆盖工厂全部 SKU。

建议选择：

- 有完整参数的产品
- 市场需求比较明确的产品
- 有 OE / OEM Number 的产品
- 适配车型清晰的产品
- 最好有部分真实产品图片
- 工厂销售人员比较熟悉的产品

这样最容易判断 AI 输出到底是否正确。

---

## 3. 离合器产品范围

第一阶段建议围绕汽车离合器及离合器套装展开，例如：

- Clutch Disc / 离合器片
- Clutch Cover / Pressure Plate / 离合器压盘
- Release Bearing / 分离轴承
- Clutch Kit / 离合器套装

Demo 阶段建议进一步聚焦：

> **优先以 Clutch Kit（离合器套装）作为主要测试产品。**

原因是它更加接近真实的 B2B 出口交易单位，也方便测试“产品组成 + 车型适配 + OE 信息 + 报价”这一整套流程。

---

## 4. 第一阶段 5 个核心模块

第一阶段只保留：

1. **Product Agent**
2. **Content Agent**
3. **Sales Agent**
4. **Follow-up Agent**
5. **Workflow Orchestrator**

暂时不增加：

- 独立站 Agent
- 选品 Agent
- 专门的 Lead Scoring Agent
- 自动报价 Agent
- 物流 Agent
- 报关 Agent

能用规则和普通程序解决的事情，不使用 Agent。

---

## 5. Agent 01：Product Agent

### 核心职责

Product Agent 首先解决一个问题：

> **把工厂已有但格式混乱、不完整的离合器产品资料，转换成统一的产品数据。**

例如工厂可能提供一个 Excel：

| Model | OE | Size | Car |
|---|---|---|---|
| XXX | XXXXX | 240MM | Toyota XXX |

Product Agent 需要将其转换成统一的数据结构。

---

## 6. 离合器产品最小数据模型

第一阶段不要求工厂把所有数据补齐。

建议按照三个等级管理。

### A. 必须数据

至少需要：

```yaml
product:
  product_name:
  product_type:
  internal_sku:
  oe_number:
  application:
  vehicle_brand:
  vehicle_model:
```

例如：

```yaml
product_name: Clutch Kit
product_type: clutch_kit
internal_sku: CK-XXXX
oe_number:
  - "工厂提供的OE号码"
vehicle_brand: Toyota
vehicle_model: "对应车型"
```

### B. 推荐数据

工厂如果已有，则录入：

```yaml
specifications:
  clutch_diameter:
  spline_count:
  spline_size:
  friction_material:
  kit_contents:
  gross_weight:
  net_weight:
  package_size:
```

例如 Kit Contents 可以结构化为：

```yaml
kit_contents:
  - clutch_disc
  - pressure_plate
  - release_bearing
```

具体以真实工厂产品为准。

### C. 业务数据

例如：

```yaml
commercial:
  moq:
  estimated_lead_time:
  packaging:
  supported_customization:
  sample_available:
```

这些信息可以进入系统，但是：

> **不要求企业上传真实成本、底价、利润率等敏感数据。**

---

## 7. 第一阶段 Product Agent 工作流程

```text
工厂 Excel / CSV / PDF
↓
Product Agent
↓
识别产品字段
↓
标准化车型 / OE / 参数
↓
发现缺失字段
↓
人工补充必要数据
↓
生成标准 Product Object
```

例如 Agent 可以提示：

```text
当前产品资料完整度：72%

缺少：
- Spline Count
- Packaging
- MOQ

建议人工确认：
- OE Number
- Compatible Vehicle
```

---

## 8. Product Agent 不能做什么

离合器属于汽车零部件，涉及车型适配和机械参数。

因此 AI **禁止自行猜测**：

- OE Number
- 适配车型
- 离合器直径
- 花键数量
- 花键尺寸
- 扭矩能力
- 摩擦材料
- 产品认证
- 产品寿命
- 安全性能

基本原则：

> **营销语言可以生成，工程事实不能生成。**

工程事实必须来自：

> 工厂数据 / 已确认资料。

---

## 9. 离合器图片缺失处理

传统汽配工厂可能拥有：

- 产品参数
- OE Number
- 车型信息

但没有每个 SKU 的专业摄影图片。

第一阶段不应该要求工厂重新拍摄全部产品。

采用：

```text
真实产品图片
↓
AI 去背景
↓
AI 背景生成
↓
AI 排版
↓
社媒营销图
```

如果某些 SKU 完全没有图片：

优先：

```text
同系列真实产品图片
+
产品参数
+
人工确认
```

生成营销示意素材。

但是：

> AI 生成图片不得用来证明真实产品结构。

特别是：

- 花键
- 孔位
- 结构尺寸
- 摩擦片结构
- 零件数量

不能因为生成图片而发生改变。

---

## 10. Agent 02：Content Agent

Content Agent 的任务不是简单“写英文文案”。

而是：

> **把离合器产品数据转化成适合海外市场传播的内容。**

---

## 11. 第一阶段内容类型

只测试三种。

### A. 产品型内容

例如主题：

> Clutch Kit for Toyota XXX

内容围绕：

- Application
- OE Reference
- Product Type
- Kit Contents
- Manufacturing Capability
- Customization
- B2B Inquiry CTA

### B. 工厂能力内容

不直接销售某一个 SKU，而是展示：

- 工厂
- 生产设备
- 产品线
- QC
- 包装
- 出口能力
- 定制能力

这类内容对于 B2B 获客非常重要。

### C. 行业知识型内容

例如：

- How to identify the right clutch kit
- Clutch disc vs clutch kit
- How OE numbers help identify clutch parts
- What information suppliers need before quotation

这样可以降低账号“全部都是产品广告”的感觉。

---

## 12. Content Agent 输出结构

每次不是只生成一段文字，而是生成：

```yaml
content:
  objective:
  target_customer:
  platform:
  hook:
  body:
  product_facts:
  call_to_action:
  hashtags:
  visual_instruction:
```

例如 CTA 可以围绕：

> Send your OE number / vehicle model / required quantity for quotation.

这样直接帮助后面的 Sales Agent 获取结构化信息。

---

## 13. Human Gate 01：内容审核

```text
Content Agent
↓
Draft
↓
工厂 / 运营人工审核
↓
Approved
↓
Publish
```

人工重点检查：

- 产品型号是否正确
- OE Number 是否正确
- 车型适配是否正确
- 技术参数是否正确
- 图片是否与产品相符
- 是否存在过度营销
- 英文表达是否自然

AI 可以负责初稿。

> **事实由工厂负责最终确认。**

---

## 14. 第一阶段发布渠道

如果第一批目标客户主要是：

- 海外汽配经销商
- Wholesaler
- Distributor
- Importer
- Auto Parts Company

第一阶段建议：

> **先只跑一个主要渠道。**

这样可以准确测试：

```text
曝光
↓
互动
↓
询盘
↓
有效 RFQ
```

而不是同时铺大量平台导致无法判断问题到底出在哪里。

渠道发布本身第一阶段不单独设置 Agent。

使用：

> **Channel Workflow + API / 半自动发布**

完成。

---

## 15. Agent 03：Sales Agent

当海外客户产生询盘以后：

Sales Agent 接管第一阶段沟通。

比如客户只说：

> Hi, I need Toyota clutch kits. Price?

AI 不能马上报价。

它首先需要把模糊询盘转换成：

> **标准 RFQ。**

---

## 16. 离合器 RFQ 数据模型

建议设计：

```yaml
rfq:
  customer:
    name:
    company:
    country:

  product:
    product_type:
    oe_number:
    vehicle_brand:
    vehicle_model:
    vehicle_year:
    engine:
    required_specification:

  commercial:
    quantity:
    destination:
    packaging_requirement:
    expected_delivery:
    customization:
```

并不是每次询盘都必须全部填写。

Agent 根据缺失程度继续询问。

---

## 17. Sales Agent 示例

客户：

> Need clutch kits for Toyota, 500 pcs.

系统识别：

```text
已有信息：
✓ Product = Clutch Kit
✓ Brand = Toyota
✓ Quantity = 500 pcs

缺失关键数据：
× OE Number
× Vehicle Model
× Destination
```

Agent 可以继续询问客户：

> Could you share the OE number or exact vehicle model, and the destination country/port?

客户回复以后，继续完成 RFQ。

---

## 18. RFQ 完整度机制

可以给每个询盘增加：

```text
RFQ Completeness Score
```

例如：

```text
35% → 信息不足
70% → 基本可以询价
90% → 可以进入人工报价
```

这比让 AI 自己决定“能不能报价”更加可靠。

---

## 19. 报价流程

第一阶段坚持：

> **最终报价一定由人工决定。**

流程：

```text
Sales Agent
↓
RFQ Ready
↓
系统整理完整客户需求
↓
提交工厂销售人员
↓
人工确认价格
↓
正式报价
↓
客户
```

第一版甚至可以先不让 AI 生成价格。

AI 只负责：

> **把所有影响报价的信息整理完整。**

后续数据足够以后，再增加：

```text
AI Suggested Price Range
```

---

## 20. Human Gate 02：正式报价

例如系统显示：

```text
RFQ #00027

Product:
Clutch Kit

Vehicle:
Toyota XXX

OE:
XXXXXX

Quantity:
500 pcs

Destination:
Poland

Packaging:
Neutral Packaging

Customer:
XXX Auto Parts
```

下面直接提供：

```text
[输入单价]
[MOQ]
[Lead Time]
[Payment Terms]
[Quotation Validity]
[Approve & Send]
```

AI 不碰最终价格。

---

## 21. Agent 04：Follow-up Agent

报价之后进入非常关键的一步：

> **客户持续跟进。**

例如：

```text
Quotation Sent
↓
24h / 3 Days
↓
Customer No Reply
↓
Follow-up Agent
```

---

## 22. 离合器客户跟单策略

不能一直：

> Any update?

Follow-up Agent 应该理解：

- 客户购买什么产品
- OE
- 数量
- 国家
- 上次报价
- 客户上一次回复
- 当前销售阶段

然后根据上下文跟进。

### Follow-up 1

确认客户是否收到报价。

### Follow-up 2

补充：

- 产品规格
- Packaging
- Factory Information
- QC Information

### Follow-up 3

询问：

- Purchase schedule
- Target order timing
- Sample requirement

### Follow-up 4

如果客户仍然有兴趣：

提醒人工销售介入。

---

## 23. Lead Scoring 第一阶段采用规则

暂时不要增加 Agent。

例如：

```text
主动询盘                 +20
提供 OE Number           +15
明确数量                 +15
数量达到目标范围         +10
询问 Sample              +10
询问 Lead Time           +10
询问 Payment Terms       +15
二次主动回复             +15
```

形成：

```text
0–30   COLD
31–60  WARM
61–100 HOT
```

规则以后根据真实数据调整。

---

## 24. Workflow Orchestrator

Workflow Orchestrator 负责把全部动作串起来。

核心状态：

```text
PRODUCT_IMPORTED
↓
PRODUCT_REVIEW_REQUIRED
↓
PRODUCT_READY
↓
CONTENT_GENERATING
↓
CONTENT_REVIEW_REQUIRED
↓
CONTENT_APPROVED
↓
PUBLISHED
↓
LEAD_RECEIVED
↓
RFQ_COLLECTING
↓
RFQ_READY
↓
QUOTE_REVIEW_REQUIRED
↓
QUOTED
↓
FOLLOW_UP
↓
OPPORTUNITY
↓
WON / LOST
```

---

## 25. 第一阶段三个 Human Gate

整个 MVP 强制保留三个。

### Gate 01：产品 / 内容真实性

```text
AI
↓
人工确认
↓
发布
```

### Gate 02：报价

```text
RFQ
↓
人工报价
↓
发送
```

### Gate 03：交期

客户有明确采购意向后：

```text
Customer Requirement
↓
Factory
↓
人工确认生产能力 / 交期
↓
客户
```

---

## 26. 第一阶段技术模块

```text
                操作后台
                   │
                   ▼
          Workflow Orchestrator
                   │
        ┌──────────┼───────────┐
        │          │           │
        ▼          ▼           ▼
    Product     Content      Sales
     Agent       Agent       Agent
                               │
                               ▼
                         Follow-up Agent

                   │
                   ▼
              Model Router
                   │
        ┌──────────┼──────────┐
        ▼          ▼          ▼
       LLM       Image      Translation

                   │
                   ▼
              PostgreSQL

                   │
                   ▼
             Channel API
```

---

## 27. 第一阶段数据流

真正重要的是：

> Agent 之间不要直接靠自然语言互相“聊天”。

统一采用结构化数据。

例如：

```text
Factory Excel
↓
Product JSON
↓
Content JSON
↓
Published Post
↓
Lead JSON
↓
RFQ JSON
↓
Quotation
↓
Follow-up Record
```

这样后面增加任何 Agent 都比较容易。

---

## 28. 第一阶段测试产品

建议从工厂产品里面选择大约：

> **20 个离合器 SKU**

建立测试 Product Dataset。

最好包含不同情况：

### A 类
数据完整 + 有图片。

### B 类
数据完整 + 无图片。

### C 类
数据不完整 + 有图片。

### D 类
数据不完整 + 无图片。

这样才能测试：

> 平台到底能不能解决传统制造企业数据缺失的问题。

---

## 29. 第一阶段验收标准

### Product Agent

20 个产品里面：

- 参数正确识别
- OE 不被 AI 修改
- 车型不被 AI 虚构
- 缺失参数能够识别
- 可以生成统一 Product Object

### Content Agent

针对每个测试产品：

能够生成：

- 1 个社媒 Post
- 1 份英文产品介绍
- 1 个视觉素材方案

主要指标：

> **经过一次人工修改后即可发布。**

### Sales Agent

使用模拟和真实询盘测试。

例如输入：

> Hi, 500 pcs Toyota clutch kit, please quote.

Agent 应该：

1. 判断信息不足
2. 不直接报价
3. 识别已有字段
4. 提问缺失字段
5. 最终形成 RFQ

### Follow-up Agent

测试至少：

- 客户未读
- 客户已读未回复
- 客户表示价格高
- 客户表示稍后采购
- 客户询问样品
- 客户询问交期

Agent 必须根据情况采用不同策略。

---

## 30. 第一阶段最终 Demo

最终 Demo 不需要非常庞大。

只需要现场能够完整演示：

```text
上传离合器 Excel
↓
AI 自动识别 20 个产品
↓
打开其中一个 Clutch Kit
↓
AI 生成英文营销内容
↓
人工修改 / Approve
↓
发布
↓
模拟海外客户询盘
↓
AI 自动接待
↓
询问 OE / Vehicle / Quantity
↓
生成 RFQ
↓
提交人工
↓
人工输入报价
↓
发送
↓
客户暂时没有成交
↓
Follow-up Agent 接管
↓
持续跟进
↓
客户产生进一步采购意向
↓
提醒人工销售
```

如果这条线真正稳定跑通：

> **第一阶段技术 Demo 就成功。**

---

## 31. 第一阶段核心验证命题

我们实际上是在验证一个非常具体的问题：

> **一个原本没有完整海外数字营销和销售团队的中国离合器工厂，能不能只提供现有产品数据，由 AI 完成大量前端获客与销售辅助工作？**

最终希望把传统流程：

```text
工厂
+
外贸业务员
+
运营
+
翻译
+
设计
+
跟单
```

逐步变成：

```text
工厂
+
1 名人工销售 / 审核人员
+
AI 外贸 Workflow
```

第一阶段先证明这个模型成立。

再扩展：

```text
离合器
↓
汽配其他品类
↓
轴承
↓
激光设备
↓
其他制造业
```

而不是第一阶段同时覆盖所有行业。
