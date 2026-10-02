# Meta 规则来源复核 — 2026-09-26

关联 #318 / #126 / #454。结论：**来源适用性未验证，平台接受未评估**。本轮补齐独立、可校验的来源审计契约，不修改导出预设，不试探真实账号，不关闭 #318 或 #126。

## 当前目标与来源

项目现行目标仍是 [ADR 0002](../../decisions/0002-camofox-facebook-personal-profile-mvp1.md) 的 Facebook Personal Profile 浏览器路径。它不等同于 Reels Publishing API。Instagram 账号、登录方式和发布 API 版本尚未选定。单个导出文件没有因此取得目标账号或发布授权。

| 来源 | 本轮观察 | 适用边界 |
| --- | --- | --- |
| [Facebook 开发者文档](https://developers.facebook.com/documentation/video-api/guides/reels-publishing) | 无法读取 | 当前版本和适用规则未知；不以搜索摘要替代 |
| [Meta Facebook Postman 集合](https://www.postman.com/meta/facebook/folder/simabyk/reels-publishing) | 只取得导航，没有规则正文 | #318 中 2026-09-05 的 4–60 秒观察是历史证据，不能标成本页本轮核实 |
| [Meta Facebook 示例 README，固定提交](https://github.com/fbsamples/reels_publishing_apis/blob/7bf98f94e75d841ecc9612c0061881d1d713c6bd/fb_reels_publishing_api_sample/README.md) | 本轮可读，记载 4–60 秒 | Git 提交固定了样例文档，不是当前平台规则或 API 的版本；不证明 Profile 浏览器接受条件 |
| [Instagram 开发者文档](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media) | 无法读取 | 当前规则版本未知 |
| [Meta Instagram Postman 集合](https://www.postman.com/meta/instagram/folder/830j7my/reels-publishing) | 可读，位于 Facebook Login API 集合 | 文档内容可观察；尚不能证明目标账号、选定接口和版本适用性 |

Instagram 集合列出的范围为 3–900 秒、23–60 FPS、横向最多 1920 像素，推荐 9:16，音频 AAC 48 kHz；同时列出视频比特率上限 25 Mbps、音频比特率 128 kbps 和文件上限 1 GB。项目的精确 1080×1920、30 FPS 属于输出选择。没有把集合的数值升级为生产平台校验规则。

Facebook 的 **项目 3–90 秒**与**示例文档 4–60 秒**继续保留为明确差异。由于来源路径及当前版本未确立，本轮没有依据样例去收紧或放宽项目预设。

其他项目参考页也已只读核对：[YouTube](https://support.google.com/youtube/answer/1722171) 提供编码建议；[TikTok](https://developers.tiktok.com/docs/en/content-posting-api-media-transfer-guide) 将上传与账号可发布时长区分；[X](https://docs.x.com/x-api/media/quickstart/best-practices) 区分 Post／DM、media_category 和账号权益。这些观察进一步说明单一导出预设不能充当账号无关的平台认证；本次 Meta 契约未扩展成这三个平台的完整规则实现。

## 独立契约与回归

机器记录见 [JSON 审计记录](meta-rule-source-review-20260926.json)。`lib/video/rule-source-review.ts` 的 1.0.0 契约仅表示不完整审计：

- 区分抓取时间、可读性、文档修订、平台规则版本和来源范围。样例 commit 保存在 documentRevision，ruleVersion 保持 null。
- 单独记录项目发布范围；Profile 浏览器路径不能被填成 Graph API 版本，未选择的路径不能宣称账号资格。
- sourceApplicability 固定为 unverified，platformAcceptance 固定为 not_evaluated。未知项不能为空；未来完整认证需要另行设计和验收，不自动随时间变成通过。
- 当前可获得的文件大小和平均比特率仅在 ffprobe 有值时可用；缺失保持 null，峰值比特率仍未测量。未把平均值代作峰值。

`test-video-rule-source-review.ts` 校验真实脱敏审计记录，并拒绝把“预设 enabled”“来源可读”“样例已固定提交”改写成平台通过。该回归加入 repository-validate，独立于导出预设的 availability。导出清单仍沿用现有 schema 1.3.0 和 not_evaluated，不新增公共接口或 `MvpAcceptanceSummary` 状态。

## 关闭条件

| #318 条件 | 本轮结果 |
| --- | --- |
| 目标路径／账号及当前规则版本 | 部分：项目 Profile 浏览器路径明确；当前适用规则版本仍外部阻塞；Instagram 未选择 |
| 解释两组时长差异 | 部分：已固定样例来源并明确项目选择，尚不能决定哪个是当前 Profile 规则 |
| 资源测量与未知项 | 通过技术记录；沿用 [资源测量契约](../video-resource-measurements.md)，不把未知算通过 |
| 独立来源状态契约与回归 | 已实现，等待最终 PR CI |

当前闭环仍为 pending；本轮资料不授予发布或真实模型调用权限，也不把 #49 官方 API 路线重新列为 Profile MVP 前置条件。
