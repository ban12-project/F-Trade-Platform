# 贡献与交付约定

## 工作方式

1. 先创建或更新 Issue，再开始实现。
2. 从 `main` 创建短生命周期分支，命名为 `type/issue-short-name`。
3. Pull Request 必须关联 Issue，并说明范围、证据、验证结果和是否影响 Human Gate。
4. CI 通过后使用 squash merge；合并后删除分支。

## 事实与数据规则

- 不把推测写成产品事实；未知字段保持缺失并进入人工审核。
- 每个工程事实必须带来源或验证状态。
- 不在 Issue、PR、fixture 或日志中放入真实客户、真实价格、真实联系方式或生产秘密。
- 原始资料如果不确定是否可提交，先标记为 `type:risk`，不要直接上传。

## Issue 类型

- `type:epic`：一个可验收的阶段目标。
- `type:feature`：用户或业务能力。
- `type:task`：可独立交付的实现工作。
- `type:decision`：需要业务或技术确认的选择。
- `type:risk`：可能阻塞范围、数据或合规的风险。
- `type:bug`：已验证的偏差或回归。

## Pull Request 最低要求

- 有对应 Issue 和验收标准。
- 说明变更是否涉及 Product、Content、RFQ、Quotation 或 Workflow 契约。
- 提供本地验证命令和结果。
- 若修改工程事实，附来源引用；若没有来源，不得把字段改成“看起来合理”的值。
