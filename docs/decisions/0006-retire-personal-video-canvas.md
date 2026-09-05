# ADR 0006：移除个人视频画布布局持久化

- 状态：Accepted
- 日期：2026-09-05
- 关联：Issue #260

## 证据与范围

当前应用和组件没有调用个人视频布局的读取或保存入口。`loadVideoCanvasDocument` 仅存在于旧存储模块；`saveVideoCanvasAction` 没有调用方。保留它们意味着继续维护一条不可达的写入路径。

删除 `lib/video/canvas-store.ts`、保存 Action、保存输入契约及当前数据库 schema 中的个人布局表。`VideoCanvasDocument` 和 `videoCanvasDocumentSchema` 继续用于已有视频后端的场景关系校验，其图节点、边、环路和事实绑定规则不变。营销视频剪辑、渲染、审核和事实门禁不受此清理影响。

## 迁移与验证

迁移 0027 只执行 `DROP TABLE "video_canvas_document"`，不使用 CASCADE。若部署环境存在额外依赖，迁移应失败并等待调查，不能连带删除未知对象。应用前应按该环境的备份策略保存旧布局；本次研发没有连接或删除现有业务数据库的数据。历史迁移和审计记录保留。

TypeScript、视频图契约、仓库校验和迁移检查验证源代码范围；CI 的临时 PostgreSQL 执行完整迁移链。构建和浏览器回归继续验证现有应用路径。
