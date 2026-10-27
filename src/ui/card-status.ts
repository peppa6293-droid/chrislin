/** 首页两张卡的展示状态。loading 只在真实刷新超过防抖阈值时出现。 */
export type CardStatus = "ready" | "loading" | "disabled";

/** 禁用态标题；全仓只允许这一处定义。 */
export const CARD_DISABLED_TITLE = "暂时无法查看";
