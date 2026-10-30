# M1 步骤 3 报告（2026-10-30）：首次设置只留四组

状态：自动化部分通过；真机目视与读回待 Owner 按固定输入操作一次（我无法在真机截图/点击）。

## 触发条件调查（任务书要求）
- `requiresSafetyRecoveryHorizon` 只在模型 `safety.ts:63-65` 同时满足「安全缺口>0」且「计划收入−核心义务>0」时为真；隐藏资产/债务后，这两项仍只取决于收入、必要支出、现金、目标月数。
- 探针结果（horizon-trigger-probe.txt）：收入10000/必要4000/现金5000/目标6月 → 需要恢复周期；现金30000 → 不需要；目标0月、收入=必要支出、必要支出为0 → 不需要；现金选"不计入安全储备"(5000) → 需要。
- 结论：恢复周期那一步（原第 5 步）必须保留，因为用户填的四组就可能触发它；不改公式。

## 改了什么
1. `src/ui/Onboarding.tsx`：删资产、债务的状态、校验和界面分区；提交时 `assets: []`、`debts: []`（空事实，不是"已知为零"）；第 3 步标题改为「你现在有多少现金？」。修改前副本 Onboarding.before.tsx（sha256 8b8dff45…）。
2. `tests/onboarding-safety-eligibility.test.tsx`：删除 3 条资产相关用例（功能已不在 M1），旧"混合候选"用例改为 M1 四组端到端；加 5 条收入非法输入 UI 用例；改前副本 onboarding-safety-eligibility.before.test.tsx。
3. 新增 `tests/m1-onboarding-four-groups.test.ts`（服务层，真实迁移后的内存库）。
未改：src/model、migrations、签名、HomeScreen（入口隐藏是步骤 5）。

## 验收证据
| 项 | 证据 | 结果 |
|---|---|---|
| 无资产/债务入口 | UI 端到端用例断言「流动投资资产」「债务」「债务名称」不存在 | 通过 |
| 合法输入保存并回读一致 | 服务层用例：toEqual(getHomeApplicationState) ；assets、debts 表 0 行；income_records=10000；cash 快照=20000 或 30000 | 通过 |
| 返回不丢输入 | 沿用既有 Onboarding 组件的 step 状态（未改动）；无新增专测 | 待验证（仅靠既有代码，未专测） |
| 非法输入明确报错且不落库 | UI：收入 -1/abc/100.123/1,000/空 被拦，且 onComplete、getRequirement 均未调用；服务：必要支出负、现金负、目标月负、NaN、期望消费为空，均拒绝并 profiles/financial_settings/income_records/cash_accounts 全 0 | 通过 |
| 重复提交不生成第二套档案 | 第二次 completeOnboarding 被拒；profiles=1、cash_accounts=1、收入仍 10000（靠 profiles.singleton_id 唯一约束） | 通过 |
| 恢复周期按模型要求出现 | 服务用例 requiresSafetyRecoveryHorizon true/false 与拒绝写入 | 通过 |
| 部分失败事务回滚 | 沿用既有用例（product-service.test.ts「rolls back all onboarding writes」）仍通过 | 通过 |
| 门禁 | lint 0（202 文件）、tsc 0、vitest 57 文件 583 passed/44 skipped（exit-codes.txt） | 通过 |
| 保护区未变 | src/model+migrations 哈希 5eb32540…e2da3 与 S0 相同 | 通过 |
| 真机包 | IPA sha256 c1535ac3…b242b1，bundle id smoke，Team SSRKA7A4TN，lab 命中 0；覆盖安装（未卸载，容器保留）；launch 成功，pid 1165 存活；库 user_version=8、profiles=0、cash_accounts=0（仍为空，等待首次设置） | 通过 |
| 真机首次设置界面与保存 | 无截图能力（无 idevicescreenshot） | 待验证，需 Owner |

## 发现的问题（未处理，报给 Owner）
- 收入写 `-1` 在服务层不会被拒（模型只检查"有限"，不检查非负），只有 UI 的正则拦住。M1 的入口只有这个 UI，所以不影响 M1；不改共享模型。我把该用例放在 UI 层测试，没有当服务层通过项。
- 模型对"没有填资产/债务"一律按空处理；首页文案若显示"总债务 0"会被读成"确认无债务"。这是步骤 5 要处理的显示问题。

## 请 Owner 在手机上做一次（固定输入）
首次设置依次填：收入 10000；住房 4000（其他留空）；现金账户名称「现金」、余额 30000、可用于安全储备选「可以」；安全覆盖目标 6 个月；最低现金覆盖 1 个月；期望每月弹性消费 2000；点完成设置。
预期：不出现恢复周期步骤（30000 ≥ 6×4000）；进入首页。完成后告诉我，我取库读回：profiles=1、income_records.amount=10000、cash 快照 30000、assets=0、debts=0、essential 4000。

---
# 更新：Owner 已在真机完成首次设置，读库结果 —— 步骤 3 通过

取库：device-after-setup.sqlite3，sha256 eaca6f03…5632bc；库文件修改时间 03:41；无 -wal/-shm 文件（devicectl 对二者返回 error 7000 文件不存在，与 files-after-setup.txt 只列 1 个文件一致）。完整输出 readback-after-setup.txt。

| 字段 | 预期 | 真机读回 | 结果 |
|---|---|---|---|
| profiles | 1 | 1（display_name=chris，选填项，Owner 自行填写） | 通过 |
| 稳定收入 | 10000 | PLANNING/EXPECTED/10000/2026-10-30 | 通过 |
| 必要支出 | 住房 4000 | HOUSING=4000（仅此一项） | 通过 |
| 现金账户 | 现金，计入安全储备 | 现金 / safety=1 | 通过 |
| 现金快照 | 30000 | 30000@2026-10-30 | 通过 |
| 安全覆盖目标 | 6 | 6.0 | 通过 |
| 最低现金覆盖 | 1 | 1.0 | 通过 |
| 期望月弹性消费 | 2000 | 2000 | 通过 |
| 恢复周期 | 不出现 | NULL（未填） | 通过 |
| assets / debts | 0 / 0 | 0 / 0 | 通过 |
| expense_records | 0 | 0（未产生任何消费） | 通过 |
| integrity_check | ok | ok | 通过 |

附带证据：写入日期 2026-10-30 与设备本地日一致（设备时区 Asia/Shanghai，M0 日志已证）；这只证明设置日期正确，跨日/跨月边界仍属步骤 4 的验收。

仍待验证：界面截图（无工具）；「返回不丢输入」未专测；进入首页后看到的是旧的完整首页（步骤 5 处理）。
