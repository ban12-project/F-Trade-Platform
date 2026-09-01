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
pnpm test:e2e tests/e2e/project-canvas.spec.ts
```

媒体集成测试需要通过 `FFMPEG_BIN` 和 `FFPROBE_BIN` 指向可执行文件；FFmpeg 必须包含 libass 字幕滤镜。

## 已验证行为

| 验收点 | 结论 |
| --- | --- |
| 画布入口 | 点击项目画布“营销视频”节点，在桌面 Panel 或移动端 Drawer 中打开编辑器 |
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
