# ADR 0002：受控 CamoFox Facebook Personal Profile MVP1 传输

## 决策

在 MVP1 中，允许一个获授权 Facebook Personal Profile 使用 CamoFox 和一个固定的 Decodo 美国独享静态 ISP IP 执行受控发布与被动 DM 观察。该决策由 GitHub #155 记录，并仅适用于此 MVP1 实验。

## 边界

- 只发布经 Gate 01 批准、并被管理员逐帖确认的文本、单图或已批准视频。
- 只处理用户主动发起的 DM；自动回复只能使用确定性 RFQ 澄清模板。
- DM 正文在业务库中以独立密钥加密保存 30 天；Cookie、Profile、代理凭据、trace 和截图不进入业务库或 Git。
- 仅使用单一固定出口 IP；不使用代理轮换、CAPTCHA 服务、Cookie 导入、自动登录恢复或不确定副作用重试。

## 停止条件与回退

安全检查、验证码、2FA、登录失效、出口 IP 不符、页面结构不确定或不确定的发布/回复结果会暂停渠道。恢复只能由账户本人完成；回退方式是停止 Worker 并由人工直接使用 Facebook 网页处理。

## 后果

浏览器观察没有官方 webhook 的投递保证。带 DOM 消息 ID 的观察可按 ID 去重；派生指纹只能作 best-effort 去重，不能宣称 exactly-once。该风险已被业务负责人接受，但不降低产品事实、报价、交期和凭据保护边界。
