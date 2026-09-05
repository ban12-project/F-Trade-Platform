# MVP1 营销视频剪辑验收

## 产品边界

MVP1 只把用户上传且登记权利证据的图片或视频，剪成最长 15 秒的私有营销视频。AI 可以根据代表帧和已核验产品事实提出剪辑初稿，但不能生成新视频素材，也不能补充未经工厂来源或人工确认的产品事实。

文本／图片生成视频、视频模型设置、供应商、生成任务、预算和重试不属于 MVP1。相关后端代码保留供以后评估，但服务端默认拒绝调用，只有显式设置 `VIDEO_GENERATION_ENABLED=1` 才能启用。

## 自动化检查

```bash
pnpm test:marketing-video-edit
pnpm test:video-visual-sampling
pnpm test:ffmpeg-renderer
pnpm test:video-preview-delivery
pnpm test:video-mvp-policy
pnpm test:e2e tests/e2e/project-workflow.spec.ts tests/e2e/video-workspace.spec.ts
```

媒体集成测试需要通过 `FFMPEG_BIN` 和 `FFPROBE_BIN` 指向可执行文件；FFmpeg 必须包含 libass 字幕滤镜。

## 已验证行为

| 验收点 | 结论 |
| --- | --- |
| 工作流入口 | 进入营销项目“营销视频”步骤后，再打开独立视频编辑器；返回时回到同一步骤，不依赖画布节点或检查器 |
| 素材范围 | 1–3 个 JPG、PNG、WebP、MP4 或 MOV 私有素材，必须登记权利证据 |
| 时长 | 单片段 1–10 秒，整条视频不超过 15 秒；客户端、Server Action 和渲染边界重复校验 |
| AI 初稿 | 只读取受控代表帧、素材引用和 ProductReady 事实，输出仍需通过同一 Zod 契约 |
| 剪辑合成 | 支持源片段起点、contain／cover、图片循环、静音／原声、字幕、最后两秒 CTA 和硬切拼接 |
| 私有预览 | 只返回同源认证流，不暴露 Blob 地址；成片必须属于受控视频聚合 |
| 人工审核 | FFmpeg 成片后才创建 Gate 01 请求；管理员审核成片，通过后也不会自动发布 |
| 生成隔离 | MVP1 UI 不展示视频生成入口，相关 Server Action 默认 fail-closed |

## 不在本次验收范围

- 背景音乐库、多轨时间线、复杂转场、自由裁切关键帧和批量多平台导出。
- 自动发布、真实社媒账号资格和真实获客效果。
- 视频生成模型、供应商凭据、生成预算与异步生成任务。
- 未经人工确认的 OE、车型、尺寸、花键、材料、认证、寿命、报价或交期事实。

## 人工检查点

1. 产品资料必须先成为 ProductReady，素材必须有权利证据。
2. 用户检查 AI 初稿的顺序、截取区间、字幕和 CTA 后才能请求合成。
3. 管理员在私有预览中核对画面、字幕、CTA 和事实来源，再通过或退回成片。
4. 发布仍由已授权人员通过独立受控流程发起。

## Issue #126：多平台真实媒体回归（2026-09-05）

`pnpm test:ffmpeg-renderer` 使用同一个黑底合成 master（320×240、25 FPS、44.1 kHz 单声道测试音），生成五个平台的项目预设版本。两个 1.5 秒片段分别保留原声和静音，并使用 cover／contain；成片通过 ffprobe 校验 H.264、AAC、尺寸、帧率和时间线时长。解码后的像素检查分别验证字幕和 CTA，PCM 能量检查验证原声与静音，生成的导出清单仍为 `review_required`。原始 master 的摘要在拒绝校验和渲染前后保持一致。

该测试已加入 repository-validate CI；它实际执行本地 FFmpeg 后端，不等同于已验证 Vercel Sandbox 镜像、真实资料权利、人工批准或平台接收。生产 Sandbox 的同一拼接步骤也统一输出 48 kHz 双声道 AAC，以避免混合原声与静音片段时采样率／声道不同造成漂移。修复前 3 秒时间线实测为 3.288526 秒，超出导出契约允许的 0.1 秒偏差。

### 预设来源风险：尚不能关闭 #126

项目精确预设不是平台全部可接受格式的枚举。2026-09-05 复核结果：

- [YouTube 编码建议](https://support.google.com/youtube/answer/1722171)接受多种帧率和宽高比；项目选择的 30 FPS、1920×1080 和 3600 秒上限不能全部称作官方硬性限制。
- [TikTok Media Transfer Guide](https://developers.tiktok.com/docs/en/content-posting-api-media-transfer-guide)记载 23–60 FPS、边长 360–4096 像素；最长发布时长还取决于账号。项目精确尺寸与帧率属于输出选择。
- [X 媒体建议](https://docs.x.com/x-api/media/quickstart/best-practices)的 Post video 时长按账号和 media category 区分，140 秒不能再作为通用 Post video 官方上限。
- Facebook／Instagram 的已记录官方链接本次读取失败，不能据此声称重新核验通过。

后续需分离项目输出选择与平台版本化约束，并补齐 Meta 来源证据、账号相关限制及尚未测量的编码属性。当前清单的 `project_export_preset` 仅说明记录的测量值是否符合可识别项目预设，不承诺平台接受或发布成功。上述来源复核不修改现有预设数值，也不授予真实资料或发布权限。

### 来源复核补充与语义修正

Meta 官方示例仓库的固定版本 `6c9706651c2ca0d21351764bb9e35a2fca0988a3` 提供了可读取的补充证据：

- [Instagram 官方示例要求](https://github.com/fbsamples/reels_publishing_apis/blob/6c9706651c2ca0d21351764bb9e35a2fca0988a3/insta_reels_publishing_api_sample/README.md#reels-requirements-for-publishing)：23–60 FPS、3–900 秒、AAC（不超过 48 kHz、1 或 2 声道）；还规定 progressive、closed GOP、4:2:0、文件大小等当前项目测量值未覆盖的属性。
- [Facebook 官方示例要求](https://github.com/fbsamples/reels_publishing_apis/blob/6c9706651c2ca0d21351764bb9e35a2fca0988a3/fb_reels_publishing_api_sample/README.md#video-requirements-for-publishing)：时长列为 4–60 秒，与项目 3–90 秒不一致。主文档本次无法读取，因此记录为未解决的来源冲突；没有把示例自动当作最新平台契约。

预设中的 `availability` 只控制项目私有渲染是否启用，取代含义过强的 `verification`。该语义修正不改变已保存预设版本和输出数值，不替代人工审核。导出清单升级为 1.1.0，在 `validation.scope = project_export_preset` 之外新增 `platformAcceptance.status = not_evaluated`，即使项目预设校验通过，也不声称平台或账号接受。平台规格、账号资格和发布结果仍需独立验证。

### 新成片编码证据

清单 schema 1.2.0 记录 encoding contract 1.0.0。新生成导出物除尺寸、帧率、时长和编码名称外，还必须从 ffprobe 获得 `pix_fmt`、`sample_aspect_ratio`、`sample_rate` 和 `channels`，并将它们保存在导出物及清单中。项目输出要求为 yuv420p、1:1 方形像素、音频采样率不超过 48 kHz、单声道或双声道；其中音频范围依据上面的固定版本 Instagram 官方示例，像素格式及方形像素也与上面的 X 官方建议一致。这是项目选定的输出范围，不是所有平台可接受格式的穷举。

本地 FFmpeg、Sandbox FFmpeg 和 Remotion Sandbox 使用相同的字段查询清单。未返回的字段保留 null；新导出校验报告具体缺失／不合格字段。旧记录缺少 encoding 时仍可读取，清单返回 unverified 并要求重新测量，不将旧记录补写成已核验。FFmpeg 两条渲染路径先按输入像素比例展开为方形像素，再缩放裁切，避免仅改像素比例标记导致画面变形。真实媒体矩阵使用 2:1 非方形像素源作为负向输入，验证五个平台成片均被归一化且保留完整编码测量。

本检查尚不覆盖 closed GOP、progressive 标志、容器 atom 顺序和全部账号限制，不能替代平台接受性判定。
