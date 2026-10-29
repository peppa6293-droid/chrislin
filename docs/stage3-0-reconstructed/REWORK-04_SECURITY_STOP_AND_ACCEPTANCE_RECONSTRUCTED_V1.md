# REWORK-04｜安全停止条件与验收边界（重建版 V1）

- 状态：`RECONSTRUCTED_NOT_HISTORICAL`
- 范围：审核治理与证据保留，不授权运行测试

## 安全停止条件

发现以下任一情况，立即停止，不修复现场、不删除文件、不继续扩大范围：

1. 目标 identifier 无法证明为非 Production；
2. 数据目录无法正向证明与 Production 分离；
3. 发现访问或写入 Production SQLite、WAL/SHM/journal、备份或 authority namespace；
4. 发现真实用户目录写入、真实账单读取或凭证/Keychain 值读取；
5. 默认命令、环境变量或配置继承可能改变目标身份；
6. 需要扩大权限、启动 App、运行脚本或读取敏感对象。

## 证据保留

保留真实文件路径、行号/配置键、时间、触发条件、已观察文本和停止原因；不得复制敏感值，不得把静态推断写成运行事实。

## 验收状态

- `CONFIRMED_STATIC_OK`：静态文件直接支持无偏差结论；
- `CONFIRMED_STATIC_DEVIATION`：静态直接发现风险或不符合项；
- `UNVERIFIED_RUNTIME_IMPACT`：静态可见但运行影响未验证；
- `EVIDENCE_INSUFFICIENT`：必要文件或授权证据缺失。

## 当前最终边界

本文及本目录重建材料不构成 3-1A-1 PASS，不授权 3-1A-2 或 3-1B。最终审核仍须区分历史交接缺失、当前静态偏差和未来运行验证项。
