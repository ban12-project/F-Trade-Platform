# F-Trade Platform

AI 外贸工作流平台第一阶段 MVP，试点品类为汽车离合器。

## 当前目标

本仓库管理第一阶段的需求、数据契约、验证规则和研发交付流程。第一阶段只验证一条可控的业务闭环：

```text
产品资料 → 产品结构化 → 内容生成 → 人工审核 → 单渠道发布
→ 客户询盘 → RFQ 补全 → 人工报价 → 跟单 → 有效商机
```

第一阶段范围固定为：1 家工厂、约 20 个真实离合器 SKU、1 个海外渠道、4 个业务 Agent、1 个 Workflow Orchestrator 和 3 类 Human Gate。

## 重要边界

- 工程事实（OE、车型适配、尺寸、花键、材料、认证、寿命等）必须来自工厂资料或已确认证据，AI 不得猜测。
- AI 不生成或决定最终价格、生产交期和正式报价。
- GitHub 只跟踪研发交付，不保存真实客户、RFQ、报价、目的港或其他业务流水。
- `docs/reference/目录总表.pdf` 是制动盘/刹车片目录，仅作为跨品类表格格式参考，不是离合器数据源。
- 当前未选择首个社媒渠道和应用技术栈；这两个决定通过 GitHub Decision Issue 完成，不在初始化阶段擅自确定。

## 导航

- [MVP 技术方案](docs/background/AI外贸工作流平台_第一阶段MVP_离合器.md)
- [业务工作流与 Human Gate](docs/architecture/business-workflow.md)
- [数据契约总览](docs/architecture/data-contracts.md)
- [研发工作约定](CONTRIBUTING.md)
- [安全与数据分级](SECURITY.md)
- [项目状态](docs/PROJECT_STATUS.md)
- [参考资料说明](docs/reference/README.md)

## 研发流

```text
Issue → type/issue-short-name 分支 → Pull Request → repository-validate
→ squash merge → 自动关闭 Issue
```

Milestone 依赖关系：`M0 → M1 → {M2, M3} → M4 → M5`。

## 本地验证

需要 Python 3.11+、`jsonschema` 和 `PyYAML`：

```bash
python3 -m pip install -r requirements-dev.txt
python3 scripts/validate_repository.py
```

GitHub Actions 会在 Pull Request 和 `main` 推送时运行同一套核心校验。
