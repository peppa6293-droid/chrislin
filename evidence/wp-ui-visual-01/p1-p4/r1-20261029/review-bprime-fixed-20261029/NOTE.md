# R1 B′ 默认三宽复测（large 假 FAIL 更正）

## 结论

上一轮复核的 `large -21.67px` 不是源码回退，而是**证据台 dist 未重建**：`harness/dist` 是 .gitignore 的构建产物，最后一次构建在 02:25（B′ 之前），CSS 仍是 `padding: 0 6%`。
旧几何可复算：232 × 0.84 − 2 × (232 × 0.06) = **167.04px**，与复核 metrics 的金额框 `167.09px` 吻合；B′ 的 `2.05rem` 应为 **129.28px**。

## 本次做法

1. 用当前 `src/ui/v2-structure-ring.css` 重建 harness：`npx vite build`；产物 CSS 中已确认 `padding:0 2.05rem`。
2. 跑官方 `shoot-r1.mjs --mode default`，390/760/980 五态。
3. 给 `shoot-r1.mjs` 加开跑前强制重建（避免同类假 FAIL 再发生），同参数复跑结果一致。

产物哈希：
- `dist/assets/index-DQ7ETAcc.css` sha256 `e213088335ea9f896ec14bd2d8b293ba23e79b042721af130e9dcbac9a2af69a`
- `dist/assets/index-B_q1MYG9.js` sha256 `2d11af8561149e63655fc2bc33c759f3eb6656a9237eaee3fa83f76c26b5e958`

## large 对照（默认根字号 16px）

| 宽度 | 金额框 w×h | 行数 | 字号 | 几何余量 | 基线 | 判定 |
|---|---|---|---|---|---|---|
| 390 | 129.31 × 52.78 | 2 | 22px | **−4.65** | −6.96 | 优于基线 +2.31px |
| 760 | 129.31 × 52.78 | 2 | 22px | **−4.65** | −6.96 | 优于基线 +2.31px |
| 980 | 129.31 × 52.78 | 2 | 22px | **−4.65** | −6.96 | 优于基线 +2.31px |

其余四态（actual / zero-burden / pending / over-both）三宽均为：单行 22px、余量 +1.84（zero-burden +44.83）、无横向溢出、金额未出卡。`scrollWidth == innerWidth` 全部成立。

## 边界说明

- `large` 仍是负余量（−4.65），但已优于基线 −6.96；按复核口径「不要求 ≥0，只要求不劣于基线」通过。该残余与 200% 根缩放同属发布前无障碍专项。
- 本轮未改产品代码；B′ 仍是 `padding: 0 2.05rem` 单行改动，`inset: 8%`、环宽 `min(14.5rem, 100%)`、字号 `1.375rem` 未动。
