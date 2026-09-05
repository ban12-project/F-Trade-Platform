# 目录候选与页码回归（Issue #268）

## 2026-09-05 技术修复

本轮按用户说明将本机参考资料用于测试。测试用途不确认工程事实，不产生 ProductReady，不替代 #6 的 SKU 授权分组或 Gate 01。#268 原始失败记录继续保留，本轮不是完整 M1 验收。

- 编号必须出现在明确的 SKU、Kit No.、Part No.、Type No. 或“编号”字段中。支持原有 RY/XDC 编号族，以及 XD/XC 和 Kit No. 下的分组数字；OE 列、部件编号标签、无标签数字和明确制动品类记录不作为候选。
- 保留每条记录出现位置，包括相同编号、相同正文的重复出现。重复编号标记为 `duplicate_identifier_review_required`；不判断它是变体还是冲突，不自动合并。
- CLI 按编号是否存在进行筛选，再应用 limit；每条结果携带独立 record_id、审核状态和来源位置。成功结果附带已使用的字段证据位置映射。所有结果仍需人工审核。
- 本地 PDF 原生文本由 MarkItDown 的 pdfminer 依赖按物理页提取；OCR 逐页保留页标记和空页。候选及字段证据保留物理页引用，不采用目录印刷页码。空页标记不算转换成功的正文。

## 可复现检查

```sh
pnpm exec tsx scripts/test-catalog-candidates.ts
pnpm test:catalog-preflight
pnpm test:product-agent-evidence
pnpm test:local-ocr
python scripts/test-local-ocr-preprocess.py --native-pdf
```

最后一项需要 requirements-dev.txt 中的 PDF 依赖；其余 OCR 防护测试使用 synthetic subprocess 响应。原生 PDF 测试实际解析三页合成输入，其中第二页为空。CI 同时运行这些检查。

本机 Node 24.15.0、pnpm 11.24.0 按 frozen lockfile 安装。类型检查、生产构建、生产测试路由隔离和 repository validation 通过。

## 原始测试资料复测

仅在本机进行原生文本提取和 Tesseract OCR，未调用商业模型或远程 OCR，未上传原文件、抽取文本或产品字段。两份 32 页扫描目录分别发现 30 和 47 条候选；48 页原生文本目录发现 0 条。这些是发现数量，不是准确率或通过审核的 SKU 数量。第一份扫描目录的一条候选已按物理页进行视觉定位抽查；未逐条核验全部候选。

## 仍需验证

- 48 页目录含多栏和未绑定标签的编号，当前结果为零候选。不能凭编号形状猜测记录归属；需要版式感知的记录切分及独立回归。
- 原生 PDF 按页提取保留顺序与页边界，但不恢复表格语义。扫描页 OCR 也不保证阅读顺序、准确率或多栏字段归属。
- 当前本地 OCR 回退仍以整份 PDF 没有正文为条件；混合文本/扫描页的 OCR 补全尚未实现。
- 未执行模型抽取、数据库写入、20-slot 正式验收或人工真实性审核。#268、#5、#6 应继续保持开放直到各自完整条件满足。


## 后续修复：原生 PDF 表格与混合页（2026-09-05）

对原始 PDF 的视觉复核更正了上轮推断：零候选目录中的多页有明确 Part No./OEM No. 表头；转换成纯文本时丢失了行列关联，不能把零候选解释为原文件没有标签。上轮的零候选结果保留为历史失败证据。

当前从水平原生文字的坐标恢复单一表头、至少两条编号行的表格。使用表头中心和编号行中心划分候选单元格；这是保守的版式关联，不代表已确认工程语义。重叠编号行、跨列/跨行文字、多个编号表头、带竖线的歧义内容、明确制动品类和不足两行的版式拒绝自动恢复。倾斜水印不作为表格数据。字段名称与值不改写，配套部件列中的 OE 也不会被提升为主产品 OE。

48 页原始测试目录复测：21 页恢复表格，62 条候选，其中 4 条为重复编号记录；48 个物理页边界全部保留。物理第 8、30 页进行了原 PDF 与转换表格的行列视觉抽查，没有完成全部 62 条逐字段核验。其余页面保持原生非结构化文本，不能将未恢复页面一概计为“没有产品”。

转换结果与 CLI 报告保留 `layout_recovered_pages`，并明确给出 `layout_recovery_requires_visual_verification`。这项提示不是 ProductReady 或 Gate 01 批准。

本地 OCR 改为只处理完全没有原生正文的页，按物理页序回填；原生页不会重新栅格化或被 OCR 覆盖。空白页仍保留。64 页文档限制、模式互斥、语言参数校验继续生效。具有少量原生文字但主体仍为图片的页面，不在这一回退条件覆盖范围内。

新增检查：

```sh
python scripts/test-pdf-catalog-layout.py --native-pdf
python scripts/test-local-ocr-preprocess.py --native-pdf --local-ocr
node --import tsx scripts/test-pdf-catalog-preflight.ts
```

前两项分别包含真实合成 PDF 解析，以及真实 Poppler/Tesseract 对四页原生/扫描/空白混合 PDF 的处理。第三项从合成 PDF 文件运行到 CLI 报告，证明重复记录、物理页和版式人工复核提示保留。CI 安装所需的 Poppler/Tesseract。运行镜像固定 `pdfplumber==0.11.10` 并包含表格恢复模块；已部署的不可变 Sandbox 镜像需要重建后才能使用此能力。镜像包含 Poppler/Tesseract；Sandbox 保持 deny-all 网络，并仅在服务端 `F_TRADE_LOCAL_OCR_ENABLED=1` 时启用本地 OCR，语言配置仍由 Python 校验。

仍未执行商业模型、数据库导入、20-slot 正式验收和人工 Gate 01；#268、#5、#6 的这些条件没有被本轮代码测试替代。
