# 产品目录接收清单模板

这是一份用于**受控内部系统**的接收清单。它借鉴目录的字段组织方式，但不保存产品名称、SKU、OE、车型、尺寸、图片、原始文件名、路径或任何工程事实。不要将已填写的真实清单提交到 GitHub；仓库中只保留 synthetic fixture 和脱敏聚合结果。

## 何时使用

在工厂交付资料、但尚未开始 Product Agent 提取前填写。每个来源文件先取得授权，再在私有系统中生成不可逆的 `evidence-*` 或 `sanitized-*` 引用。随后将每一个候选产品分配到 A–D 的一个 slot。

## 清单字段

| 字段 | 填写规则 |
| --- | --- |
| `authorization_ref` | 指向私有授权记录；不能是文件路径、联系人或原始文件名。 |
| `source_documents[].document_ref` | 私有来源的脱敏引用。 |
| `media_type` | 仅记录文件类型，如 `pdf`、`xlsx`。 |
| `use_authorization` | 未授权保持 `pending` 或 `rejected`，不得进入提取。 |
| `conversion_status` | 先使用 `not_run`；只在人工批准后允许 `approved_for_extraction`。 |
| `slots[]` | 固定使用 `pilot-slot-01` 至 `pilot-slot-20`，与 A–D 矩阵保持一致。 |
| `source_ref` | 只存脱敏证据引用，不填写页码原文、产品编号或原文件路径。 |
| `blocker_codes` | 记录授权、转换、字段或图片复核阻塞原因，不能用猜测的产品值解决。 |

## 操作顺序

1. 在私有系统取得工厂资料的允许用途，并填入 `authorization_ref`。
2. 录入来源文件的脱敏引用与媒介类型；尚未授权的文件保持 `pending`。
3. 将 20 个候选项分配到 A–D：A/B 为完整资料，C/D 为不完整资料；A/C 有实物图，B/D 无实物图。
4. 对授权且可提取的来源，在本机受控环境运行 `pnpm product-agent:catalog -- --preflight --document <authorized-file>`。只保留输出的哈希、文件类型、候选数和人工复核原因。
5. 预检通过不等于 ProductReady。将实际资料继续交由字段级证据核对、一次修订限制和 Gate 01 人工批准。

## 契约

使用 `contracts/testing/product-catalog-intake.schema.json` 校验清单结构。真实清单不应进入仓库；提交到 Git 的只能是与 `data/fixtures/product-catalog-intake.synthetic.json` 等价的 synthetic 测试数据。
