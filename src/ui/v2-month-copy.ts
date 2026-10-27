/** 首页「本月消费」卡无记录时的 20 句轮换文案。顺序即批准顺序，不得改写或重排。 */
export const MONTH_ROTATION_LINES = [
  "不是哥们，账本开无痕模式了？",
  "我请问呢，今天的流水呢？",
  "钱包：我出场了。账本：你谁？",
  "好好好，账本主打一个查无此人。",
  "记账？包的！动手？下次一定。",
  "账本：我嘞个豆，怎么还是空的？",
  "爱你老己，别光爱付款码啊！",
  "花没花不知道，账是一笔没记。",
  "这账本安静得像开了静音外挂。",
  "我要验牌！消费记录请出示！",
  "账本进入大睡理论，叫不醒一点。",
  "今日含账量：0，抽象浓度：拉满。",
  "钱包演悬疑剧，账本连剧本都没拿。",
  "不是，你的记账按钮被封印了？",
  "小钱家：记录呢？你：在路上了。",
  "账本都长草了，真不来拔一下？",
  "这波属于是赛博失忆，谁懂啊！",
  "先记一笔，主打一个不烧心。",
  "强者喝大水，王者记流水！",
  "再不记账，钱包要申请当场对质了。",
] as const;

/** 同一个本地自然日恒定一句；次日顺延；第 21 天回到第 1 句。用 home.asOfDate，不用 new Date()。 */
export function pickDailyLine(asOfDate: string): string {
  const [year = 1970, month = 1, day = 1] = asOfDate.split("-").map(Number);
  const dayIndex = Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
  const size = MONTH_ROTATION_LINES.length;
  return MONTH_ROTATION_LINES[((dayIndex % size) + size) % size] ?? MONTH_ROTATION_LINES[0];
}
