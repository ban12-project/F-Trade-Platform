# 旧 Facebook 状态轮询 500 — #472

生产 b34e7ad 在浏览器及设置页每 15 秒请求状态时返回 500：Zod 报 workerId、channelRef、accountRef 缺失。全局拥有者通知组件未检查独立 Worker 是否启用/完整配置，即挂载旧账号状态轮询。托管浏览器的账号配置不能自动充当旧 Worker scope。

WSL Podman、Node 24.21.0、禁网回归直接调用原状态读取函数：缺失配置抛出同类 ZodError，首次失败保留于本地。修复后未启用、缺失、部分或空 scope 返回 null 且不查询数据库；有效配置仍读取真实账户和渠道状态。通知组件在服务端检查可用配置，旧设置面板显示未配置提示。Worker 签名及所有写入的严格 scope、身份权限校验保持原样；不捕获数据库故障伪装为未配置。

新回归纳入既有 Facebook worker CI。WSL Podman 回归通过、完整 TypeScript 通过；相关 PostgreSQL 消融夹具显式开启旧 Worker 并断言状态存在。聚合验收不因 UI 修复而改变业务结论。

## 本次生产启动的独立证据

500 不是手动打开任务失败的证据。只读数据库核对显示本次唯一新 interactive 运行已 completed、failure 为 null、自动登录观察结果 ready、claimedAt 为空、ticketUsed 为 false。节点随后 stopped，无未完成会话或操作。说明应用已创建并执行本次任务，未领取保存的登录凭据；未发生发布或 DM。票据未使用，不宣称用户已接入远程视图。

生产页面修复与后续实际查看仍需部署复验。不得因控制台 500 重发旧任务或改写原运行记录。
