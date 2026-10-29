# WP-UI-VISUAL-01 视觉稿 v2（2026-10-27）

三张稿都由本目录内的自包含 HTML 用无头 Chrome 渲染，改文案后重跑即可复现，不依赖 /tmp。

| 稿 | PNG | 源 | 说明 |
| --- | --- | --- | --- |
| 固定支出页 | `fixed-v2.png` | `fixed-v2.html` | 2 卡 + 右侧信息列；行副行只放类别；已付「再记一笔」/ 未付「记一笔」；分类小计带基准副标题 |
| 固定支出空态 | `empty-v2.png` | `empty-v2.html` | 主句 / 次句 / 按钮；副标题「每月要付的 · 0 项」；不渲染摘要与右侧列 |
| 超载三档 | `overload-v2.png` | `overload-v2.html` | 正常 / 临界 / 超载 + 白线「收入」；超载只标「超出 ¥5,046.73」；无三色图例；每档附结论句 |

复现命令（在仓库根执行）：

```bash
CH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
cd evidence/wp-ui-visual-01
"$CH" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
  --window-size=1200,820 --screenshot=fixed-v2.png "file://$PWD/fixed-v2.html"
"$CH" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
  --window-size=1200,700 --screenshot=empty-v2.png "file://$PWD/empty-v2.html"
"$CH" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
  --window-size=1060,870 --screenshot=overload-v2.png "file://$PWD/overload-v2.html"
```

边界：这是设计稿，不含产品代码改动；数值（3,528 / 2,628 / 900 / 13,000 / 18,046.73）为示意，不进代码。
