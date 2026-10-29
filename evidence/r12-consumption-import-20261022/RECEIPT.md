# R12 消费流水导入回执

日期：2026-10-22
执行：按 `docs/EXEC-R12-CONSUMPTION-IMPORT-INSTRUCTIONS.md`（户主已放行）
结论：**R12_PARTIAL** —— 12 批全部按锚点导入成功、SQL 回读全对；**但导入后 App 冷启动报「暂时打不开账本」，首页读数无法回读**。已按红线保留现场、停手，未做任何修补（未删行、未改库、未改代码/包）。

---

## 1. 转换

12 个 CSV 均按 §3 锚点逐批一致（行数/金额）。行级文件不入库，登记如下（`data/consumption-exports-20261021/`）：

| 文件 | 行数 | 金额 | SHA-256 |
|------|------|------|---------|
| r12-alipay-餐饮.csv | 149 | 9,532.59 | `9491673bcd9a5512c75de8f5510269e1106afb35df709e01bc413d070749ea6a` |
| r12-alipay-交通.csv | 60 | 11,078.83 | `ec685681a2be532a75cc14c9c4e09bde1a7e8a9d4f6d460fdd4ccc8b1256194b` |
| r12-alipay-购物.csv | 108 | 15,490.20 | `be90d9dccb00e63546706752ae96121c4c4aa9a9499120282b42d76458b72194` |
| r12-alipay-娱乐.csv | 58 | 6,352.83 | `367b3ab46885261fde22e7dbdaffdb6f25f678e13fce06367c7e2019b3b514ef` |
| r12-alipay-家居.csv | 19 | 7,794.42 | `7bf7e400c79606ea25f7502434f4a63abf5c6333975567d1edee4e545891899e` |
| r12-alipay-其他.csv | 91 | 15,720.40 | `7a2f89b79d7a99428f37bf5a473f3ca072c5fa1e5e91585bf7d56de8ce5a35f8` |
| r12-wechat-餐饮.csv | 78 | 3,389.92 | `916990242feabe2126cb3f7c07a6461aaf2cece696cb74e73ab4ec145e96a7b5` |
| r12-wechat-交通.csv | 149 | 7,564.31 | `e6014cbb47515382dc09e9d64449bbec17ec78f50fac044659e2f696588f127e` |
| r12-wechat-购物.csv | 10 | 3,059.69 | `bde835f4bba89e1d987035cb131a4652f0d370d4d5ac32b86eef75e440d07ae9` |
| r12-wechat-娱乐.csv | 21 | 5,345.54 | `f6d5faaa11e91c721102c5039581f9ad982da3bd598bd2e22767f6da8a37e70f` |
| r12-wechat-家居.csv | 13 | 110.00 | `deec0d7f35f97a7b7668d4dc6c10b05f0c461aacdb5c2da04ff7da55bfc643b3` |
| r12-wechat-其他.csv | 68 | 15,011.38 | `618da18fbe6e13e91190792ce225c415efe76ddd7c73b89dac8ed89d6a80f1e5` |
| 合计 | **824** | **100,450.11** | — |

对照表：`data/consumption-exports-20261021/r12-mapping.csv`，1,699 行数据行（含表头 1,700 行），SHA-256 `5da5ab0f5f016b981d57a047e77e0485aad9290d551e58d0ca7ac3f95e0d862e`
转换脚本：`data/consumption-exports-20261021/r12_convert.py`，SHA-256 `9ed1c656288ad0fa7c67896bd5236447a9013996120d2603f1100713861f98c4`

## 2. 导入（只走 App「账单导入」界面）

包：`/Applications/Personal Finance Console.app`（bundle id `com.personalfinance.console`），未改包、未重建。账户一律「现金」。

| 批次 | 界面回执 written / skipped / error | 锚点 | 截图 |
|------|-----------------------------------|------|------|
| 01 alipay-餐饮 | 149 / 0 / 0 | 149 | `receipts/01-alipay-餐饮.png` |
| 02 alipay-交通 | 60 / 0 / 0 | 60 | `receipts/02-alipay-交通.png` |
| 03 alipay-购物 | 108 / 0 / 0 | 108 | `receipts/03-alipay-购物.png` |
| 04 alipay-娱乐 | 58 / 0 / 0 | 58 | `receipts/04-alipay-娱乐.png` |
| 05 alipay-家居 | 19 / 0 / 0 | 19 | `receipts/05-alipay-家居.png` |
| 06 alipay-其他 | 91 / 0 / 0 | 91 | `receipts/06-alipay-其他.png` |
| 07 wechat-餐饮 | 78 / 0 / 0 | 78 | `receipts/07-wechat-餐饮.png` |
| 08 wechat-交通 | 149 / 0 / 0 | 149 | `receipts/08-wechat-交通.png` |
| 09 wechat-购物 | 10 / 0 / 0 | 10 | `receipts/09-wechat-购物.png` |
| 10 wechat-娱乐 | 21 / 0 / 0 | 21 | `receipts/10-wechat-娱乐.png` |
| 11 wechat-家居 | 13 / 0 / 0 | 13 | `receipts/11-wechat-家居.png` |
| 12 wechat-其他 | 68 / 0 / 0 | 68 | `receipts/12-wechat-其他.png` |

12 批预览均为「重复跳过 0｜异常 0」，默认账户均为「现金」，默认分类与批次一致。

## 3. SQL 只读回读（`sql-readback.log`）

- `expenses` = **825**（锚点 825）
- `expense_records` = **826**（锚点 826）
- `import_batches` = **12**（锚点 12）
- 导入总额 = **100,450.11**（锚点 100,450.11）
- 12 批 `written_rows = valid_rows = total_rows`，`skipped_rows = 0`，`error_rows = 0`
- 逐批 `source_file_sha256` 与 §1 对应 CSV 哈希一致
- 10 月债务合计 172,579.53，与 R11 锚点一致（本任务未动债务/收入/计划/快照）

## 4. 界面读数截图

- 首页「已花」= 100,513.11：**未能取得**（启动即报错，见 §5）
- 启动报错现场：`00-post-import-startup-error.png`；AX 树：`10-startup-error-ax.txt`

## 5. 异常／偏差（阻断回读）

导入后按 bundle id 正常退出并重新启动，App 停在：

```
PERSONAL FINANCE
暂时打不开账本
Stored facts or settings could not be used to calculate the monthly model.
[更新财务数据] [重新打开]
```

「重新打开」无效；数据库本身只读回读全部正常。定位结果：

- 根因：源账单里有 **14 行金额为 0.00 的支出**（支付宝「医保支付(不含自费)」13 行 + 「0 元付定」1 行），它们是真实原始流水，转换按 §2「金额原样」保留，导入预览也计为可导入并全部写入（14 行均属已放行锚点，对总额无影响）。
- App 模型校验要求支出金额 > 0（`src/model/validation.ts` `NON_POSITIVE_VALUE`），首页读当前月支出时命中其中 **2026-10 的 3 行 0.00**，抛出 `ModelValidationError`，被包装成 `ApplicationModelError` 显示为上述报错，首页无法打开。
- 已用仓库同一份模型源码做只读复现：单条 `amount=0.00` 即抛 `NON_POSITIVE_VALUE`。该复现只编译到 `/tmp`，未改仓库、未改包。
- 影响范围：本次导入的 14 行 0 元流水全部为合理原始数据，不是转换错误；异常是 App「导入接受 0 元 / 模型拒绝 0 元」的口径不一致，属应用缺陷（B 类），在本次真数导入下首次暴露。

**已执行红线动作**：停手、保留现场（App 保持报错页未再操作）；未删除/修改任何导入行；未 SQL 直插；未改代码、未重建包；未动债务/收入/计划/快照/备份。恢复方案待户主/审核员裁决，见 `INCIDENT-20261022-startup-block.md`。

## 6. 已知限制（§7，如实登记）

1. 导入行 `kind` 恒为现金支出（`CASH_DEBIT`），花呗/信用卡支付也按现金支出入账；总额不受影响，付款账户归属失真。
2. 12 批账户统一落「现金」（2026-10-22 审核员裁决）。逐行真实付款方式留在对照表与源 JSONL。
3. 应用内 description 仅保留交易对方，商品说明/付款方式不落库，留在对照表。
4. 分类导入后永久，App 无编辑/删除入口。
5. 导入界面不展示行级错误，只显示失败条数。
6. 微信部分退款消费行整行排除（不冲减），支付宝全额退款已关联剔除。
7. **72 笔平台单分类瑕疵**（美团/淘宝等约 8,204 元标签可能挂错、金额无误），户主已知情接受，照原样导入。

## 7. 附：本回执涉及的文件

- `sql-readback.log` —— 只读 SQL 回读原始输出
- `00-post-import-startup-error.png` —— 导入后冷启动报错现场
- `10-startup-error-ax.txt` —— 报错页 AX 文本
- `INCIDENT-20261022-startup-block.md` —— 异常定位、影响与待裁决方案
- `receipts/01..12-*.png` —— 12 批导入回执
