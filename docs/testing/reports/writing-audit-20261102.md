# 验收文档写作审查：2026-11-02

范围：审查时的 `docs/testing/**/*.md`，以及 `docs/` 下文件名含 acceptance 或验收的 Markdown。排除图片、JSON、原始 reference 文件和本报告。规则来自 [writing-guidelines](https://raw.githubusercontent.com/vercel-labs/writing-guidelines/main/command.md)。

逐文件扫描结构、段落、标题、代码块和可机械识别的措辞；另复核当前验收状态和发布手册的范围表述。不是对所有句子的语义审校，也没有重新执行历史验收。下面列出可定位的问题；未列出的问题不表示事实已经重新验证。历史报告保留当时日期、模型、版本及结果，不按当前产品行为重写。Vercel 网站专用元数据和 MDX 组件规则作为仓库适配建议，不作为测试失败。

优先修复现行操作文档中的范围混淆和执行条件，再整理历史报告格式。本次仅审查历史文档，不批量改写。

## 优先处理的现行文档

docs/testing/mvp1-acceptance-status.md:3 - 开头同段混合当前结论、历史运行时和素材范围；拆成当前状态与证据入口，保留历史章节。
docs/testing/product-publication-401.md:1 - 标题称完整旅程，但首段限定合成资料；在标题注明合成验收，避免读者把它当作真实发布证明。
docs/testing/video-workflow-runbook.md:1 - 将适用版本和当前支持的执行路径放到开头；历史恢复流程与现行操作需要可区分。

## docs/decisions/0010-product-final-fact-acceptance.md

docs/decisions/0010-product-final-fact-acceptance.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。

## docs/decisions/0011-remove-pitr-acceptance.md

docs/decisions/0011-remove-pitr-acceptance.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/decisions/0011-remove-pitr-acceptance.md:9 - 正文硬换行；将同一段落保留在一行，交给编辑器折行。 同类位置：14, 20, 26。

## docs/testing/browser-acceptance.md

docs/testing/browser-acceptance.md:1 - 结构检查通过；YAML 元数据不按正文换行处理。

## docs/testing/catalog-blocker-regression.md

docs/testing/catalog-blocker-regression.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。

## docs/testing/channel-onboarding.template.md

docs/testing/channel-onboarding.template.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。

## docs/testing/content-review-version.md

docs/testing/content-review-version.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/content-review-version.md:5 - 正文硬换行；将同一段落保留在一行，交给编辑器折行。 同类位置：9, 21。

## docs/testing/customer-journey-403.md

docs/testing/customer-journey-403.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。

## docs/testing/document-upload-read-recovery.md

docs/testing/document-upload-read-recovery.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/document-upload-read-recovery.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。
docs/testing/document-upload-read-recovery.md:3 - 正文硬换行；将同一段落保留在一行，交给编辑器折行。 同类位置：9, 15, 21。

## docs/testing/evidence-upload-provenance.md

docs/testing/evidence-upload-provenance.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/evidence-upload-provenance.md:3 - 正文硬换行；将同一段落保留在一行，交给编辑器折行。 同类位置：8, 16, 23, 40。

## docs/testing/evidence-upload-reconciliation.md

docs/testing/evidence-upload-reconciliation.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。

## docs/testing/harbor-agent-evals.md

docs/testing/harbor-agent-evals.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。

## docs/testing/hig-modern-web-audit.md

docs/testing/hig-modern-web-audit.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/hig-modern-web-audit.md:72 - 正文硬换行；将同一段落保留在一行，交给编辑器折行。

## docs/testing/mvp-acceptance-report.template.md

docs/testing/mvp-acceptance-report.template.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。

## docs/testing/mvp1-acceptance-status.md

docs/testing/mvp1-acceptance-status.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/mvp1-acceptance-status.md:7 - 正文硬换行；将同一段落保留在一行，交给编辑器折行。 同类位置：12, 16, 31, 37。

## docs/testing/mvp1-managed-sandbox-rollout.md

docs/testing/mvp1-managed-sandbox-rollout.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/mvp1-managed-sandbox-rollout.md:43 - 正文硬换行；将同一段落保留在一行，交给编辑器折行。 同类位置：54, 61, 67, 75。

## docs/testing/next-security-release-runbook.md

docs/testing/next-security-release-runbook.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/next-security-release-runbook.md:5 - 正文硬换行；将同一段落保留在一行，交给编辑器折行。 同类位置：12。

## docs/testing/official-camoufox-migration.md

docs/testing/official-camoufox-migration.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/official-camoufox-migration.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。
docs/testing/official-camoufox-migration.md:5 - 正文硬换行；将同一段落保留在一行，交给编辑器折行。 同类位置：14, 19, 26, 39, 45, 50, 61, 68, 74, 80, 87, 104, 114, 121, 129, 141, 148, 158, 166, 174, 186, 196, 203, 212, 231, 239, 250, 256, 270, 281, 300, 308, 312, 318, 321, 336, 345, 349, 353, 358, 363, 367, 373, 379, 384, 391, 400, 408, 415, 427。

## docs/testing/podman-browser-preflight.md

docs/testing/podman-browser-preflight.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/podman-browser-preflight.md:5 - 存在弱化精度的修饰词；删除或改为可验证描述。
docs/testing/podman-browser-preflight.md:30 - 正文硬换行；将同一段落保留在一行，交给编辑器折行。

## docs/testing/pr323-iteration-status.md

docs/testing/pr323-iteration-status.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。

## docs/testing/product-agent-acceptance.md

docs/testing/product-agent-acceptance.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。

## docs/testing/product-agent-model-selection.md

docs/testing/product-agent-model-selection.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。

## docs/testing/product-catalog-import.md

docs/testing/product-catalog-import.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/product-catalog-import.md:3 - 正文硬换行；将同一段落保留在一行，交给编辑器折行。 同类位置：8, 18, 21, 30, 46。

## docs/testing/product-catalog-intake.template.md

docs/testing/product-catalog-intake.template.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。

## docs/testing/product-cohort-protocol.md

docs/testing/product-cohort-protocol.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/product-cohort-protocol.md:34 - 正文硬换行；将同一段落保留在一行，交给编辑器折行。 同类位置：39。

## docs/testing/product-document-direct-upload.md

docs/testing/product-document-direct-upload.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/product-document-direct-upload.md:52 - 正文硬换行；将同一段落保留在一行，交给编辑器折行。 同类位置：59, 63, 67, 71。

## docs/testing/product-import-labels.md

docs/testing/product-import-labels.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/product-import-labels.md:5 - 正文硬换行；将同一段落保留在一行，交给编辑器折行。 同类位置：10, 14, 18, 22。

## docs/testing/product-pilot-authorization.template.md

docs/testing/product-pilot-authorization.template.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。

## docs/testing/product-publication-401.md

docs/testing/product-publication-401.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。

## docs/testing/product-safety-ablation.md

docs/testing/product-safety-ablation.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。

## docs/testing/project-instant-navigation.md

docs/testing/project-instant-navigation.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/project-instant-navigation.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。
docs/testing/project-instant-navigation.md:3 - 正文硬换行；将同一段落保留在一行，交给编辑器折行。 同类位置：9, 16, 32, 42, 50, 65, 73。

## docs/testing/quotation-review-version.md

docs/testing/quotation-review-version.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/quotation-review-version.md:5 - 正文硬换行；将同一段落保留在一行，交给编辑器折行。 同类位置：9, 13。

## docs/testing/reference-mock-workflow.md

docs/testing/reference-mock-workflow.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reference-mock-workflow.md:41 - 正文硬换行；将同一段落保留在一行，交给编辑器折行。 同类位置：47, 52, 57, 61, 67, 71, 76, 82, 86, 91, 96, 101, 105。

## docs/testing/remotion-local-encoding.md

docs/testing/remotion-local-encoding.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/remotion-local-encoding.md:54 - 正文硬换行；将同一段落保留在一行，交给编辑器折行。 同类位置：60, 71, 78, 81。

## docs/testing/reports/acceptance-ablation-20260928.md

docs/testing/reports/acceptance-ablation-20260928.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/acceptance-ablation-20260928.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/auth-security-20261030.md

docs/testing/reports/auth-security-20261030.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/auth-security-20261030.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/automatic-login-session-recovery-20261030.md

docs/testing/reports/automatic-login-session-recovery-20261030.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。

## docs/testing/reports/body-parser-cleanup-20261030.md

docs/testing/reports/body-parser-cleanup-20261030.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/body-parser-cleanup-20261030.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/braces-depth-guard-20261007.md

docs/testing/reports/braces-depth-guard-20261007.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/braces-depth-guard-20261007.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/browser-broker-gateway-20261101.md

docs/testing/reports/browser-broker-gateway-20261101.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/browser-broker-gateway-20261101.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。
docs/testing/reports/browser-broker-gateway-20261101.md:3 - 正文硬换行；将同一段落保留在一行，交给编辑器折行。 同类位置：11, 18, 22, 26, 30, 46, 52, 62。

## docs/testing/reports/browser-candidate-415-audit-20260926.md

docs/testing/reports/browser-candidate-415-audit-20260926.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/browser-candidate-415-audit-20260926.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/browser-diagnostics-runtime-20261002.md

docs/testing/reports/browser-diagnostics-runtime-20261002.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/browser-diagnostics-runtime-20261002.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。
docs/testing/reports/browser-diagnostics-runtime-20261002.md:3 - 正文硬换行；将同一段落保留在一行，交给编辑器折行。 同类位置：7, 15, 20, 28, 32, 39。

## docs/testing/reports/browser-dualstack-vps-20261101.md

docs/testing/reports/browser-dualstack-vps-20261101.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/browser-dualstack-vps-20261101.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。
docs/testing/reports/browser-dualstack-vps-20261101.md:3 - 正文硬换行；将同一段落保留在一行，交给编辑器折行。 同类位置：10, 17, 25, 33, 49, 57, 61, 64, 72, 83, 88。

## docs/testing/reports/browser-lifecycle-isolated-20261101.md

docs/testing/reports/browser-lifecycle-isolated-20261101.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/browser-lifecycle-isolated-20261101.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。
docs/testing/reports/browser-lifecycle-isolated-20261101.md:3 - 正文硬换行；将同一段落保留在一行，交给编辑器折行。 同类位置：9, 13, 19, 36, 44, 49, 56, 64。

## docs/testing/reports/browser-recovery-20261002.md

docs/testing/reports/browser-recovery-20261002.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/browser-recovery-20261002.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。
docs/testing/reports/browser-recovery-20261002.md:7 - 正文硬换行；将同一段落保留在一行，交给编辑器折行。 同类位置：13, 18, 28, 31, 34, 38, 43, 51, 56, 66, 74, 81, 88, 92, 97, 103。

## docs/testing/reports/browser-stun-isolated-20261101.md

docs/testing/reports/browser-stun-isolated-20261101.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/browser-stun-isolated-20261101.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。
docs/testing/reports/browser-stun-isolated-20261101.md:3 - 正文硬换行；将同一段落保留在一行，交给编辑器折行。 同类位置：11, 18, 21, 24, 41, 50, 69, 76, 83, 90。

## docs/testing/reports/browser-takeover-20260928.md

docs/testing/reports/browser-takeover-20260928.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/browser-takeover-20260928.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/catalog-browser-chain-20260916.md

docs/testing/reports/catalog-browser-chain-20260916.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/catalog-browser-chain-20260916.md:3 - 正文硬换行；将同一段落保留在一行，交给编辑器折行。 同类位置：8, 11, 23, 28, 33, 42, 49。

## docs/testing/reports/catalog-kit-label-recovery-20260916.md

docs/testing/reports/catalog-kit-label-recovery-20260916.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/catalog-kit-label-recovery-20260916.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/catalog-platform-gap-baseline-20260916.md

docs/testing/reports/catalog-platform-gap-baseline-20260916.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/catalog-platform-gap-baseline-20260916.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/catalog-product-media-acceptance-20261009.md

docs/testing/reports/catalog-product-media-acceptance-20261009.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/catalog-product-media-acceptance-20261009.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/database-material-acceptance-20260927.md

docs/testing/reports/database-material-acceptance-20260927.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/database-material-acceptance-20260927.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/deepmerge-security-20261101.md

docs/testing/reports/deepmerge-security-20261101.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/deepmerge-security-20261101.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。
docs/testing/reports/deepmerge-security-20261101.md:3 - 正文硬换行；将同一段落保留在一行，交给编辑器折行。 同类位置：9, 14, 23, 26, 33, 38。

## docs/testing/reports/dm-startup-diagnostics-20261031.md

docs/testing/reports/dm-startup-diagnostics-20261031.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/dm-startup-diagnostics-20261031.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。
docs/testing/reports/dm-startup-diagnostics-20261031.md:3 - 正文硬换行；将同一段落保留在一行，交给编辑器折行。 同类位置：7, 18, 30, 33, 39, 43, 48, 53, 62, 69, 87, 93, 102, 110, 120, 129, 135, 144。

## docs/testing/reports/document-image-20260916.md

docs/testing/reports/document-image-20260916.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/document-image-20260916.md:3 - 正文硬换行；将同一段落保留在一行，交给编辑器折行。 同类位置：13, 29, 32, 37。

## docs/testing/reports/embedded-viewer-20261101.md

docs/testing/reports/embedded-viewer-20261101.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/embedded-viewer-20261101.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。
docs/testing/reports/embedded-viewer-20261101.md:3 - 正文硬换行；将同一段落保留在一行，交给编辑器折行。 同类位置：8, 14, 22, 32, 43, 47, 53, 60, 67, 74, 81, 89。

## docs/testing/reports/existing-material-model-20260927.md

docs/testing/reports/existing-material-model-20260927.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/existing-material-model-20260927.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/facebook-automatic-pin-local-20260923.md

docs/testing/reports/facebook-automatic-pin-local-20260923.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/facebook-automatic-pin-local-20260923.md:82 - 数值与单位之间缺少空格；不要修改代码或原始测量值。 同类位置：106。

## docs/testing/reports/facebook-root-login-form-20261029.md

docs/testing/reports/facebook-root-login-form-20261029.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/facebook-root-login-form-20261029.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/facebook-status-500-20260927.md

docs/testing/reports/facebook-status-500-20260927.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/facebook-status-500-20260927.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/follow-up-plan-20261022.md

docs/testing/reports/follow-up-plan-20261022.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。

## docs/testing/reports/follow-up-six-contexts-20260916.md

docs/testing/reports/follow-up-six-contexts-20260916.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/follow-up-six-contexts-20260916.md:7 - 正文硬换行；将同一段落保留在一行，交给编辑器折行。 同类位置：21, 25, 38。

## docs/testing/reports/follow-up-strategy-preview-20261023.md

docs/testing/reports/follow-up-strategy-preview-20261023.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/follow-up-strategy-preview-20261023.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/gateway-reconnect-20261002.md

docs/testing/reports/gateway-reconnect-20261002.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/gateway-reconnect-20261002.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/harbor-acceptance-20260917.md

docs/testing/reports/harbor-acceptance-20260917.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。

## docs/testing/reports/harbor-gpt6-luna-20260927.md

docs/testing/reports/harbor-gpt6-luna-20260927.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/harbor-gpt6-luna-20260927.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/historical-source-reconciliation-20261007.md

docs/testing/reports/historical-source-reconciliation-20261007.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/historical-source-reconciliation-20261007.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/http-tooling-security-20261101.md

docs/testing/reports/http-tooling-security-20261101.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/http-tooling-security-20261101.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。
docs/testing/reports/http-tooling-security-20261101.md:3 - 正文硬换行；将同一段落保留在一行，交给编辑器折行。 同类位置：7, 15, 19, 26, 30。

## docs/testing/reports/inquiry-vehicle-labels-20261031.md

docs/testing/reports/inquiry-vehicle-labels-20261031.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。

## docs/testing/reports/integrated-demo-reconciliation-20261101.md

docs/testing/reports/integrated-demo-reconciliation-20261101.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/integrated-demo-reconciliation-20261101.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。
docs/testing/reports/integrated-demo-reconciliation-20261101.md:3 - 正文硬换行；将同一段落保留在一行，交给编辑器折行。 同类位置：10, 26, 33, 38。

## docs/testing/reports/interactive-login-lifecycle-20260927.md

docs/testing/reports/interactive-login-lifecycle-20260927.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/interactive-login-lifecycle-20260927.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/kimi-local-content-20260905.md

docs/testing/reports/kimi-local-content-20260905.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/kimi-local-content-20260905.md:3 - 正文硬换行；将同一段落保留在一行，交给编辑器折行。 同类位置：22, 25, 29。

## docs/testing/reports/local-delivery-checks-20260916.md

docs/testing/reports/local-delivery-checks-20260916.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/local-delivery-checks-20260916.md:3 - 正文硬换行；将同一段落保留在一行，交给编辑器折行。 同类位置：6, 17, 20。

## docs/testing/reports/m1-document-upload-write-guards-20261008.md

docs/testing/reports/m1-document-upload-write-guards-20261008.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/m1-document-upload-write-guards-20261008.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/m1-m2-editor-gaps-20261007.md

docs/testing/reports/m1-m2-editor-gaps-20261007.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/m1-m2-editor-gaps-20261007.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/m1-m2-reconciliation-20261007.md

docs/testing/reports/m1-m2-reconciliation-20261007.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/m1-m2-reconciliation-20261007.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/m1-oe-source-preservation-20261009.md

docs/testing/reports/m1-oe-source-preservation-20261009.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/m1-oe-source-preservation-20261009.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/m1-product-agent-write-guards-20261007.md

docs/testing/reports/m1-product-agent-write-guards-20261007.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。

## docs/testing/reports/m1-product-review-write-guards-20261007.md

docs/testing/reports/m1-product-review-write-guards-20261007.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。

## docs/testing/reports/m1-source-page-locations-20261007.md

docs/testing/reports/m1-source-page-locations-20261007.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。

## docs/testing/reports/m1-source-preview-names-20261007.md

docs/testing/reports/m1-source-preview-names-20261007.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/m1-source-preview-names-20261007.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/m2-captioned-video-receipt-20261012.md

docs/testing/reports/m2-captioned-video-receipt-20261012.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。

## docs/testing/reports/m2-composer-inspection-parity-20261011.md

docs/testing/reports/m2-composer-inspection-parity-20261011.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。

## docs/testing/reports/m2-content-draft-write-guards-20261008.md

docs/testing/reports/m2-content-draft-write-guards-20261008.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。

## docs/testing/reports/m2-content-generation-errors-20261007.md

docs/testing/reports/m2-content-generation-errors-20261007.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。

## docs/testing/reports/m2-content-generation-scope-20261007.md

docs/testing/reports/m2-content-generation-scope-20261007.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。

## docs/testing/reports/m2-content-review-write-guards-20261008.md

docs/testing/reports/m2-content-review-write-guards-20261008.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。

## docs/testing/reports/m2-content-revision-copy-write-guards-20261008.md

docs/testing/reports/m2-content-revision-copy-write-guards-20261008.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。

## docs/testing/reports/m2-current-profile-egress-20261010.md

docs/testing/reports/m2-current-profile-egress-20261010.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/m2-current-profile-egress-20261010.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/m2-human-reply-write-guards-20261008.md

docs/testing/reports/m2-human-reply-write-guards-20261008.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/m2-human-reply-write-guards-20261008.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/m2-inbound-routing-write-guards-20261008.md

docs/testing/reports/m2-inbound-routing-write-guards-20261008.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/m2-inbound-routing-write-guards-20261008.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/m2-managed-content-retention-20261010.md

docs/testing/reports/m2-managed-content-retention-20261010.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/m2-managed-content-retention-20261010.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/m2-native-inspection-contract-20261011.md

docs/testing/reports/m2-native-inspection-contract-20261011.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。

## docs/testing/reports/m2-neon-retention-checkpoint-20261010.md

docs/testing/reports/m2-neon-retention-checkpoint-20261010.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/m2-neon-retention-checkpoint-20261010.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/m2-neon-retention-checkpoint-20261101.md

docs/testing/reports/m2-neon-retention-checkpoint-20261101.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/m2-neon-retention-checkpoint-20261101.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。
docs/testing/reports/m2-neon-retention-checkpoint-20261101.md:3 - 正文硬换行；将同一段落保留在一行，交给编辑器折行。 同类位置：8, 14, 24, 34, 38, 43, 46, 50。

## docs/testing/reports/m2-observation-http-diagnostics-20261013.md

docs/testing/reports/m2-observation-http-diagnostics-20261013.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/m2-observation-http-diagnostics-20261013.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。
docs/testing/reports/m2-observation-http-diagnostics-20261013.md:3 - 正文硬换行；将同一段落保留在一行，交给编辑器折行。 同类位置：9, 22, 27, 35。

## docs/testing/reports/m2-pending-implementation-20261011.md

docs/testing/reports/m2-pending-implementation-20261011.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。

## docs/testing/reports/m2-publication-human-write-guards-20261008.md

docs/testing/reports/m2-publication-human-write-guards-20261008.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/m2-publication-human-write-guards-20261008.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/m2-publication-inspection-failures-20261011.md

docs/testing/reports/m2-publication-inspection-failures-20261011.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/m2-publication-inspection-failures-20261011.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/m2-publication-observation-diagnostics-20261013.md

docs/testing/reports/m2-publication-observation-diagnostics-20261013.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/m2-publication-observation-diagnostics-20261013.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/m2-publication-page-inspection-20261011.md

docs/testing/reports/m2-publication-page-inspection-20261011.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/m2-publication-page-inspection-20261011.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/m2-real-catalogue-video-acceptance-20261010.md

docs/testing/reports/m2-real-catalogue-video-acceptance-20261010.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/m2-real-catalogue-video-acceptance-20261010.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/m2-retention-enforcement-20261009.md

docs/testing/reports/m2-retention-enforcement-20261009.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。

## docs/testing/reports/m2-retention-history-protection-20261011.md

docs/testing/reports/m2-retention-history-protection-20261011.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。

## docs/testing/reports/m2-retention-operations-20261009.md

docs/testing/reports/m2-retention-operations-20261009.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。

## docs/testing/reports/m2-retention-owner-decision-20261009.md

docs/testing/reports/m2-retention-owner-decision-20261009.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。

## docs/testing/reports/m2-retention-restore-20261015.md

docs/testing/reports/m2-retention-restore-20261015.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/m2-retention-restore-20261015.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/m2-video-ai-source-guards-20261007.md

docs/testing/reports/m2-video-ai-source-guards-20261007.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。

## docs/testing/reports/m2-video-ai-version-guard-20261007.md

docs/testing/reports/m2-video-ai-version-guard-20261007.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。

## docs/testing/reports/m2-video-caption-20261011.md

docs/testing/reports/m2-video-caption-20261011.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/m2-video-caption-20261011.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/m2-video-cta-protection-20261007.md

docs/testing/reports/m2-video-cta-protection-20261007.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。

## docs/testing/reports/m2-video-draft-source-write-guards-20261008.md

docs/testing/reports/m2-video-draft-source-write-guards-20261008.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。

## docs/testing/reports/m2-video-receipt-return-scroll-20261013.md

docs/testing/reports/m2-video-receipt-return-scroll-20261013.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。

## docs/testing/reports/m2-video-review-copy-retention-20261010.md

docs/testing/reports/m2-video-review-copy-retention-20261010.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/m2-video-review-copy-retention-20261010.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/m2-video-review-write-guards-20261008.md

docs/testing/reports/m2-video-review-write-guards-20261008.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。

## docs/testing/reports/manual-product-images-20261010.md

docs/testing/reports/manual-product-images-20261010.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/manual-product-images-20261010.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/mcp-sdk-security-20261023.md

docs/testing/reports/mcp-sdk-security-20261023.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/mcp-sdk-security-20261023.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/messenger-observation-hydration-20260928.md

docs/testing/reports/messenger-observation-hydration-20260928.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/messenger-observation-hydration-20260928.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/meta-rule-source-review-20260926.md

docs/testing/reports/meta-rule-source-review-20260926.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/meta-rule-source-review-20260926.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/minimatch-preprocess-guard-20261101.md

docs/testing/reports/minimatch-preprocess-guard-20261101.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/minimatch-preprocess-guard-20261101.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。
docs/testing/reports/minimatch-preprocess-guard-20261101.md:3 - 正文硬换行；将同一段落保留在一行，交给编辑器折行。 同类位置：7, 15, 22, 30, 34, 38, 41, 44, 51, 54。

## docs/testing/reports/mvp1-acceptance-20260926.md

docs/testing/reports/mvp1-acceptance-20260926.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/mvp1-acceptance-20260926.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/mvp1-acceptance-checkpoint-20260923.md

docs/testing/reports/mvp1-acceptance-checkpoint-20260923.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/mvp1-acceptance-checkpoint-20260923.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/mvp1-implementation-audit-20261006.md

docs/testing/reports/mvp1-implementation-audit-20261006.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/mvp1-implementation-audit-20261006.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/mvp1-local-runtime-probe-20260926.md

docs/testing/reports/mvp1-local-runtime-probe-20260926.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/mvp1-local-runtime-probe-20260926.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/mvp1-non-dm-acceptance-20260918.md

docs/testing/reports/mvp1-non-dm-acceptance-20260918.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/mvp1-non-dm-acceptance-20260918.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/mvp1-podman-receipt-isolation-20261015.md

docs/testing/reports/mvp1-podman-receipt-isolation-20261015.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/mvp1-podman-receipt-isolation-20261015.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/mvp1-production-content-video-20260918.md

docs/testing/reports/mvp1-production-content-video-20260918.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/mvp1-production-content-video-20260918.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/mvp1-production-publication-attempt-20260924.md

docs/testing/reports/mvp1-production-publication-attempt-20260924.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/mvp1-production-publication-attempt-20260924.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/mvp1-production-session-checkpoint-20260924.md

docs/testing/reports/mvp1-production-session-checkpoint-20260924.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/mvp1-production-session-checkpoint-20260924.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/mvp1-publication-receipt-baseline-20260924.md

docs/testing/reports/mvp1-publication-receipt-baseline-20260924.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/mvp1-publication-receipt-baseline-20260924.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/mvp1-runtime-parity-20260923.md

docs/testing/reports/mvp1-runtime-parity-20260923.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/mvp1-runtime-parity-20260923.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。 同类位置：29。

## docs/testing/reports/mvp1-video-preclick-20260924.md

docs/testing/reports/mvp1-video-preclick-20260924.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。

## docs/testing/reports/native-inbox-podman-20261019.md

docs/testing/reports/native-inbox-podman-20261019.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/native-inbox-podman-20261019.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。
docs/testing/reports/native-inbox-podman-20261019.md:3 - 正文硬换行；将同一段落保留在一行，交给编辑器折行。 同类位置：8, 16, 21, 29, 37, 45, 53。

## docs/testing/reports/native-profile-414-20260923.md

docs/testing/reports/native-profile-414-20260923.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。

## docs/testing/reports/native-profile-live-startup-20261101.md

docs/testing/reports/native-profile-live-startup-20261101.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/native-profile-live-startup-20261101.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。
docs/testing/reports/native-profile-live-startup-20261101.md:3 - 正文硬换行；将同一段落保留在一行，交给编辑器折行。 同类位置：10, 20, 26, 31。

## docs/testing/reports/new-account-native-profile-20261031.md

docs/testing/reports/new-account-native-profile-20261031.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/new-account-native-profile-20261031.md:3 - 正文硬换行；将同一段落保留在一行，交给编辑器折行。 同类位置：10, 18, 29, 32, 37, 40, 45, 48, 52, 57, 65, 71, 79, 83, 87, 95, 98, 105, 115。

## docs/testing/reports/new-work-keyboard-20260927.md

docs/testing/reports/new-work-keyboard-20260927.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/new-work-keyboard-20260927.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/next-security-20261030.md

docs/testing/reports/next-security-20261030.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/next-security-20261030.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/open-issue-review-20261101.md

docs/testing/reports/open-issue-review-20261101.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/open-issue-review-20261101.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。
docs/testing/reports/open-issue-review-20261101.md:3 - 正文硬换行；将同一段落保留在一行，交给编辑器折行。 同类位置：19, 64, 67, 70, 81, 86, 90。

## docs/testing/reports/pdf-preflight-local-20261101.md

docs/testing/reports/pdf-preflight-local-20261101.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/pdf-preflight-local-20261101.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。
docs/testing/reports/pdf-preflight-local-20261101.md:3 - 正文硬换行；将同一段落保留在一行，交给编辑器折行。 同类位置：9, 18, 23, 28, 32。

## docs/testing/reports/private-blob-read-20260927.md

docs/testing/reports/private-blob-read-20260927.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/private-blob-read-20260927.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/private-upload-intake-diagnostics-20260916.md

docs/testing/reports/private-upload-intake-diagnostics-20260916.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/private-upload-intake-diagnostics-20260916.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/product-agent-kimi-20260920.md

docs/testing/reports/product-agent-kimi-20260920.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。

## docs/testing/reports/product-agent-live-20260919.md

docs/testing/reports/product-agent-live-20260919.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。

## docs/testing/reports/product-agent-mimo-20260920.md

docs/testing/reports/product-agent-mimo-20260920.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。

## docs/testing/reports/product-agent-mimo-v26-20260922.md

docs/testing/reports/product-agent-mimo-v26-20260922.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/product-agent-mimo-v26-20260922.md:32 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/product-agent-model-selection-20260922.md

docs/testing/reports/product-agent-model-selection-20260922.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/product-agent-model-selection-20260922.md:3 - 正文硬换行；将同一段落保留在一行，交给编辑器折行。
docs/testing/reports/product-agent-model-selection-20260922.md:13 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。 同类位置：50, 74。

## docs/testing/reports/product-cohort-run01-20260916.md

docs/testing/reports/product-cohort-run01-20260916.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/product-cohort-run01-20260916.md:3 - 正文硬换行；将同一段落保留在一行，交给编辑器折行。 同类位置：8, 20, 27, 32, 42, 47, 53, 60, 64, 68, 75, 81。

## docs/testing/reports/product-component-oe-regression-20260923.md

docs/testing/reports/product-component-oe-regression-20260923.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/product-component-oe-regression-20260923.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/product-evidence-source-labels-20261007.md

docs/testing/reports/product-evidence-source-labels-20261007.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/product-evidence-source-labels-20261007.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/product-final-fact-acceptance-20261009.md

docs/testing/reports/product-final-fact-acceptance-20261009.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/product-final-fact-acceptance-20261009.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/product-form-feedback-20261007.md

docs/testing/reports/product-form-feedback-20261007.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/product-form-feedback-20261007.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/product-intake-guidance-20261007.md

docs/testing/reports/product-intake-guidance-20261007.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/product-intake-guidance-20261007.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/product-intake-request-diagnostics-20261007.md

docs/testing/reports/product-intake-request-diagnostics-20261007.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/product-intake-request-diagnostics-20261007.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/product-introductions-20260917.md

docs/testing/reports/product-introductions-20260917.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/product-introductions-20260917.md:7 - 正文硬换行；将同一段落保留在一行，交给编辑器折行。 同类位置：26, 30, 33。

## docs/testing/reports/product-revision-evidence-20260916.md

docs/testing/reports/product-revision-evidence-20260916.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/product-revision-evidence-20260916.md:3 - 正文硬换行；将同一段落保留在一行，交给编辑器折行。 同类位置：6, 10, 19, 26, 32, 38, 45。

## docs/testing/reports/product-source-images-20260916.md

docs/testing/reports/product-source-images-20260916.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。

## docs/testing/reports/product-stream-field-types-20260916.md

docs/testing/reports/product-stream-field-types-20260916.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/product-stream-field-types-20260916.md:3 - 正文硬换行；将同一段落保留在一行，交给编辑器折行。 同类位置：6, 12, 18, 25, 35, 41, 48, 54, 60, 79。

## docs/testing/reports/production-acceptance-20260917.md

docs/testing/reports/production-acceptance-20260917.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/production-acceptance-20260917.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/production-pilot-preflight-20261007.md

docs/testing/reports/production-pilot-preflight-20261007.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/production-pilot-preflight-20261007.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/production-reference-upload-20261007.md

docs/testing/reports/production-reference-upload-20261007.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/production-reference-upload-20261007.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/production-rollout-20260927.md

docs/testing/reports/production-rollout-20260927.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/production-rollout-20260927.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/project-archive-20260926.md

docs/testing/reports/project-archive-20260926.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/project-archive-20260926.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/publication-media-batch-20261101.md

docs/testing/reports/publication-media-batch-20261101.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/publication-media-batch-20261101.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。
docs/testing/reports/publication-media-batch-20261101.md:3 - 正文硬换行；将同一段落保留在一行，交给编辑器折行。 同类位置：11, 20, 30, 42, 46, 53, 61。

## docs/testing/reports/publication-preclick-diagnosis-20261101.md

docs/testing/reports/publication-preclick-diagnosis-20261101.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/publication-preclick-diagnosis-20261101.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。
docs/testing/reports/publication-preclick-diagnosis-20261101.md:3 - 正文硬换行；将同一段落保留在一行，交给编辑器折行。 同类位置：7, 13, 20, 31, 36, 40, 44。

## docs/testing/reports/publication-vps-regression-20261101.md

docs/testing/reports/publication-vps-regression-20261101.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/publication-vps-regression-20261101.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。
docs/testing/reports/publication-vps-regression-20261101.md:3 - 正文硬换行；将同一段落保留在一行，交给编辑器折行。 同类位置：9, 29, 34。

## docs/testing/reports/reconciled-login-20260927.md

docs/testing/reports/reconciled-login-20260927.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。

## docs/testing/reports/reference-acceptance-20260905.md

docs/testing/reports/reference-acceptance-20260905.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/reference-acceptance-20260905.md:3 - 正文硬换行；将同一段落保留在一行，交给编辑器折行。 同类位置：17, 31, 36, 45。

## docs/testing/reports/reference-acceptance-20260917.md

docs/testing/reports/reference-acceptance-20260917.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/reference-acceptance-20260917.md:3 - 正文硬换行；将同一段落保留在一行，交给编辑器折行。 同类位置：24, 28, 33, 38, 45。

## docs/testing/reports/reference-application-20261006.md

docs/testing/reports/reference-application-20261006.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/reference-application-20261006.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/reference-real-source-review-20261008.md

docs/testing/reports/reference-real-source-review-20261008.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/reference-real-source-review-20261008.md:42 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/reference-test-review-20261006.md

docs/testing/reports/reference-test-review-20261006.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/reference-test-review-20261006.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/reference-video-intake-20260916.md

docs/testing/reports/reference-video-intake-20260916.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/reference-video-intake-20260916.md:3 - 正文硬换行；将同一段落保留在一行，交给编辑器折行。 同类位置：8, 16, 29, 36, 39, 45, 50, 54, 59。

## docs/testing/reports/rfq-inquiry-history-20261022.md

docs/testing/reports/rfq-inquiry-history-20261022.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。

## docs/testing/reports/rfq-optional-requirements-20261023.md

docs/testing/reports/rfq-optional-requirements-20261023.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/rfq-optional-requirements-20261023.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/rfq-product-type-20261022.md

docs/testing/reports/rfq-product-type-20261022.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/rfq-product-type-20261022.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。 同类位置：26。

## docs/testing/reports/runtime-credential-rotation-20261101.md

docs/testing/reports/runtime-credential-rotation-20261101.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/runtime-credential-rotation-20261101.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。
docs/testing/reports/runtime-credential-rotation-20261101.md:3 - 正文硬换行；将同一段落保留在一行，交给编辑器折行。 同类位置：8, 16, 22, 35。

## docs/testing/reports/sandbox-online-20260927.md

docs/testing/reports/sandbox-online-20260927.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。

## docs/testing/reports/sandbox-policy-fix-20260927.md

docs/testing/reports/sandbox-policy-fix-20260927.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。

## docs/testing/reports/sandbox-runtime-rollout-20261015.md

docs/testing/reports/sandbox-runtime-rollout-20261015.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/sandbox-runtime-rollout-20261015.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/sandbox-same-image-20260927.md

docs/testing/reports/sandbox-same-image-20260927.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/sandbox-same-image-20260927.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/sandbox-scope-supersession-20261101.md

docs/testing/reports/sandbox-scope-supersession-20261101.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/sandbox-scope-supersession-20261101.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。
docs/testing/reports/sandbox-scope-supersession-20261101.md:5 - 正文硬换行；将同一段落保留在一行，交给编辑器折行。 同类位置：9, 23, 27, 37, 52, 58。

## docs/testing/reports/sandbox-storage-cleanup-20261007.md

docs/testing/reports/sandbox-storage-cleanup-20261007.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/sandbox-storage-cleanup-20261007.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。
docs/testing/reports/sandbox-storage-cleanup-20261007.md:3 - 正文硬换行；将同一段落保留在一行，交给编辑器折行。 同类位置：14, 22, 27, 33, 39, 45, 52。

## docs/testing/reports/sandbox-template-image-bundle-20261015.md

docs/testing/reports/sandbox-template-image-bundle-20261015.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/sandbox-template-image-bundle-20261015.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/sandbox-template-native-restore-20261015.md

docs/testing/reports/sandbox-template-native-restore-20261015.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/sandbox-template-native-restore-20261015.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/sandbox-viewer-rollout-20261022.md

docs/testing/reports/sandbox-viewer-rollout-20261022.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/sandbox-viewer-rollout-20261022.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/scanned-catalog-cells-20261009.md

docs/testing/reports/scanned-catalog-cells-20261009.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。

## docs/testing/reports/scanned-catalog-row-boundaries-20261009.md

docs/testing/reports/scanned-catalog-row-boundaries-20261009.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。

## docs/testing/reports/scanned-disc-glyph-recovery-20261009.md

docs/testing/reports/scanned-disc-glyph-recovery-20261009.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/scanned-disc-glyph-recovery-20261009.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/scanned-disc-grid-recovery-20261009.md

docs/testing/reports/scanned-disc-grid-recovery-20261009.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/scanned-disc-grid-recovery-20261009.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/scanned-disc-source-columns-20261009.md

docs/testing/reports/scanned-disc-source-columns-20261009.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/scanned-disc-source-columns-20261009.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/scanned-kit-layout-20260916.md

docs/testing/reports/scanned-kit-layout-20260916.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/scanned-kit-layout-20260916.md:3 - 正文硬换行；将同一段落保留在一行，交给编辑器折行。 同类位置：8, 14, 28, 41, 49, 60, 67, 73, 80, 86, 101。

## docs/testing/reports/shadcn-zod4-security-20261101.md

docs/testing/reports/shadcn-zod4-security-20261101.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/shadcn-zod4-security-20261101.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。
docs/testing/reports/shadcn-zod4-security-20261101.md:3 - 正文硬换行；将同一段落保留在一行，交给编辑器折行。 同类位置：9, 14, 26, 32, 36, 41, 48, 61。

## docs/testing/reports/simulated-dm-sales-20261101.md

docs/testing/reports/simulated-dm-sales-20261101.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/simulated-dm-sales-20261101.md:3 - 正文硬换行；将同一段落保留在一行，交给编辑器折行。 同类位置：12, 32, 38, 46, 50, 58。

## docs/testing/reports/synthetic-upload-20261002.md

docs/testing/reports/synthetic-upload-20261002.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/synthetic-upload-20261002.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。
docs/testing/reports/synthetic-upload-20261002.md:3 - 正文硬换行；将同一段落保留在一行，交给编辑器折行。 同类位置：9, 16, 21, 28, 35, 42, 50, 56, 65。

## docs/testing/reports/synthetic-video-and-ui-20261002.md

docs/testing/reports/synthetic-video-and-ui-20261002.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/synthetic-video-and-ui-20261002.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。
docs/testing/reports/synthetic-video-and-ui-20261002.md:3 - 正文硬换行；将同一段落保留在一行，交给编辑器折行。 同类位置：11, 18, 25, 39, 47, 56, 61, 71, 81。

## docs/testing/reports/systeminformation-security-20261031.md

docs/testing/reports/systeminformation-security-20261031.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。

## docs/testing/reports/tooling-security-patches-20261007.md

docs/testing/reports/tooling-security-patches-20261007.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/tooling-security-patches-20261007.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/undici-security-20261030.md

docs/testing/reports/undici-security-20261030.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/undici-security-20261030.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/uri-ip-security-20261101.md

docs/testing/reports/uri-ip-security-20261101.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/uri-ip-security-20261101.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。
docs/testing/reports/uri-ip-security-20261101.md:3 - 正文硬换行；将同一段落保留在一行，交给编辑器折行。 同类位置：9, 13, 21, 24, 27, 31, 34, 37。

## docs/testing/reports/user-guide-walkthrough-20261101.md

docs/testing/reports/user-guide-walkthrough-20261101.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/user-guide-walkthrough-20261101.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。
docs/testing/reports/user-guide-walkthrough-20261101.md:3 - 正文硬换行；将同一段落保留在一行，交给编辑器折行。 同类位置：9, 17, 23, 32, 38, 49, 56, 62。

## docs/testing/reports/vercel-compute-return-20261101.md

docs/testing/reports/vercel-compute-return-20261101.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/vercel-compute-return-20261101.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。
docs/testing/reports/vercel-compute-return-20261101.md:3 - 正文硬换行；将同一段落保留在一行，交给编辑器折行。 同类位置：11, 14, 21, 26, 43, 50, 57。

## docs/testing/reports/vps-adaptive-admission-20261101.md

docs/testing/reports/vps-adaptive-admission-20261101.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/vps-adaptive-admission-20261101.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。
docs/testing/reports/vps-adaptive-admission-20261101.md:3 - 正文硬换行；将同一段落保留在一行，交给编辑器折行。 同类位置：11, 32, 39, 46, 49, 55, 63, 70, 75, 80。

## docs/testing/reports/vps-business-concurrency-20261101.md

docs/testing/reports/vps-business-concurrency-20261101.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/vps-business-concurrency-20261101.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。
docs/testing/reports/vps-business-concurrency-20261101.md:3 - 正文硬换行；将同一段落保留在一行，交给编辑器折行。 同类位置：12, 17, 20, 23, 36, 40, 47, 54。

## docs/testing/reports/vps-compute-20261101.md

docs/testing/reports/vps-compute-20261101.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/vps-compute-20261101.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。
docs/testing/reports/vps-compute-20261101.md:3 - 正文硬换行；将同一段落保留在一行，交给编辑器折行。 同类位置：22, 30, 37, 48, 57, 67, 76, 83, 99, 106, 113, 120, 127。

## docs/testing/reports/vps-legacy-build-architecture-20261101.md

docs/testing/reports/vps-legacy-build-architecture-20261101.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/vps-legacy-build-architecture-20261101.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。
docs/testing/reports/vps-legacy-build-architecture-20261101.md:3 - 正文硬换行；将同一段落保留在一行，交给编辑器折行。 同类位置：9, 17, 24。

## docs/testing/reports/vps-smoke-chain-runtime-20261101.md

docs/testing/reports/vps-smoke-chain-runtime-20261101.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/vps-smoke-chain-runtime-20261101.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。
docs/testing/reports/vps-smoke-chain-runtime-20261101.md:3 - 正文硬换行；将同一段落保留在一行，交给编辑器折行。 同类位置：9, 13, 16, 19, 24, 29, 37, 42。

## docs/testing/reports/vps-smoke-host-runtime-20261101.md

docs/testing/reports/vps-smoke-host-runtime-20261101.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/vps-smoke-host-runtime-20261101.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。
docs/testing/reports/vps-smoke-host-runtime-20261101.md:3 - 正文硬换行；将同一段落保留在一行，交给编辑器折行。 同类位置：10, 16, 24。

## docs/testing/reports/workflow-nanoid-replay-20261007.md

docs/testing/reports/workflow-nanoid-replay-20261007.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/workflow-nanoid-replay-20261007.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/workflow-queue-deadlines-20261007.md

docs/testing/reports/workflow-queue-deadlines-20261007.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/workflow-queue-deadlines-20261007.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/workflow-security-patches-20261007.md

docs/testing/reports/workflow-security-patches-20261007.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/workflow-security-patches-20261007.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/workspace-accessibility-20261101.md

docs/testing/reports/workspace-accessibility-20261101.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/workspace-accessibility-20261101.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。
docs/testing/reports/workspace-accessibility-20261101.md:3 - 正文硬换行；将同一段落保留在一行，交给编辑器折行。 同类位置：8, 16, 23, 31, 37, 44, 53, 59。

## docs/testing/reports/workspace-interaction-accessibility-20261101.md

docs/testing/reports/workspace-interaction-accessibility-20261101.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/workspace-interaction-accessibility-20261101.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。
docs/testing/reports/workspace-interaction-accessibility-20261101.md:3 - 正文硬换行；将同一段落保留在一行，交给编辑器折行。 同类位置：11, 16, 19, 23, 27, 34, 42, 47, 57, 64, 72, 79。

## docs/testing/reports/wsl-podman-acceptance-20260927.md

docs/testing/reports/wsl-podman-acceptance-20260927.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/wsl-podman-acceptance-20260927.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/reports/zod-bounds-20261030.md

docs/testing/reports/zod-bounds-20261030.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/reports/zod-bounds-20261030.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。 同类位置：15。

## docs/testing/sandbox-readonly-inspection.md

docs/testing/sandbox-readonly-inspection.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/sandbox-readonly-inspection.md:3 - 正文硬换行；将同一段落保留在一行，交给编辑器折行。 同类位置：8, 15, 22, 32, 40。

## docs/testing/social-controlled-pilot.template.md

docs/testing/social-controlled-pilot.template.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。

## docs/testing/synthetic-integration-demo.md

docs/testing/synthetic-integration-demo.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/synthetic-integration-demo.md:5 - 正文硬换行；将同一段落保留在一行，交给编辑器折行。
docs/testing/synthetic-integration-demo.md:23 - 代码块共 30 行；按步骤拆分并说明执行条件。

## docs/testing/text-publication-confirmation.md

docs/testing/text-publication-confirmation.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
docs/testing/text-publication-confirmation.md:1 - 标题或正文用破折号连接信息；改为冒号或独立句，保留日期。

## docs/testing/video-context-405.md

docs/testing/video-context-405.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。

## docs/testing/video-resource-measurements.md

docs/testing/video-resource-measurements.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。

## docs/testing/video-workflow-acceptance.md

docs/testing/video-workflow-acceptance.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。

## docs/testing/video-workflow-runbook.md

docs/testing/video-workflow-runbook.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。

## docs/testing/workspace-cutover-482.md

docs/testing/workspace-cutover-482.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。

## docs/testing/workspace-shell-399.md

docs/testing/workspace-shell-399.md:1 - 缺少文档类型声明；建议为现行手册标注 How-to、历史报告标注 Reference，先统一仓库约定。
