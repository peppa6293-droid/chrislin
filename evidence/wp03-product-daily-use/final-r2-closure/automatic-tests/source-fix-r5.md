# R5 product fix

- Product fix commit: `fd1d9e8714173167430baa2ab9325557a9e80775`.
- Defect: during new-month pending debt facts, Home debt card still rendered `home.mandatoryDebtService` from the prior Home model even while top-level pending UI and debt page correctly required confirmation.
- Fix: use consumer copy “本月应还待确认 / 待确认” while any current-month debt fact is pending; render the numeric due only when all debt facts are confirmed.
- Regression: UI test asserts pending label/value and absence of `¥500.00` from the stale-model fixture.
- Fresh R5 native bundle was built from this commit and strict codesign passed. R5 real November UI reproduced pending A=0/B=pending and confirmed B=200; Home showed pending without stale 500 and recovered to 200 after full confirmation.
