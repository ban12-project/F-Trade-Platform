# 真实 SKU 试点授权清单模板

## 保密边界

在受控的内部系统填写本清单。不要在本仓库、Issue、PR、fixture 或日志中写 SKU 名称、OE、车型、尺寸、图片、原始文件路径、工厂文档内容、联系人或报价。带回仓库的记录只能使用 `ProductPilotAuthorizationManifest` 契约允许的脱敏引用和聚合状态。

## 工厂授权

- 授权引用：`<sanitized-or-evidence-reference>`
- 使用范围：第一阶段 Product Agent 评测与 Gate 01 人工复核
- 授权状态：`draft` / `authorized`
- 原始资料保管位置：`<approved-private-system-reference>`

## Slot 分配

每个 slot 只填 source reference、保密等级和授权状态；产品事实保留在受控源系统。

| 组别 | slot 范围 | 数据完整度 | 实物图 | 数量 |
| --- | --- | --- | --- | --- |
| A | pilot-slot-01 至 05 | complete | real_product_image | 5 |
| B | pilot-slot-06 至 10 | complete | none | 5 |
| C | pilot-slot-11 至 15 | incomplete | real_product_image | 5 |
| D | pilot-slot-16 至 20 | incomplete | none | 5 |

每个 slot 必须确认：

- `source_ref` 只指向获批准的私有资料；不填原始路径或文件名。
- `confidentiality` 为 `internal`、`confidential` 或 `restricted`。
- `authorization_status` 为 `planned`、`authorized` 或 `rejected`。
- 未经授权或被拒绝的 slot 不进入 Product Agent 或 Harbor 评测。

只有全部 20 个 slot 获授权、A–D 各 5 个且与完整度/图片矩阵一致时，才可关闭 #6 并开始真实产品验收。
