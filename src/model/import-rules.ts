/**
 * Local-only classification rules for imported bill rows and ledger cleanup.
 *
 * Nothing here calls a network or a model service: a merchant/summary keyword
 * table maps to one of the user's own category names. Rules stay deterministic
 * so the same row always gets the same suggestion and the user can audit it.
 */

export interface CategoryOption {
  id: string;
  name: string;
}

export interface AccountOption {
  id: string;
  name: string;
}

export interface CategorySuggestion {
  categoryId: string;
  categoryName: string;
  /** 0–1. Anything below `LOW_CONFIDENCE_THRESHOLD` is shown for review. */
  confidence: number;
  /** The keyword that matched, shown to the user as the reason. */
  matched: string;
}

export const LOW_CONFIDENCE_THRESHOLD = 0.8;

interface Rule {
  keywords: string[];
  categoryAliases: string[];
  confidence: number;
}

const RULES: Rule[] = [
  {
    keywords: [
      "美团",
      "饿了么",
      "肯德基",
      "麦当劳",
      "星巴克",
      "瑞幸",
      "喜茶",
      "蜜雪冰城",
      "海底捞",
      "餐",
      "饭",
      "外卖",
      "咖啡",
      "奶茶",
      "面包",
      "食堂",
    ],
    categoryAliases: ["吃饭", "餐饮", "饮食", "food", "外卖"],
    confidence: 0.95,
  },
  {
    keywords: [
      "滴滴",
      "高德打车",
      "地铁",
      "公交",
      "高铁",
      "火车",
      "机票",
      "航空",
      "出租",
      "打车",
      "加油",
      "停车",
      "共享单车",
      "哈啰",
      "青桔",
    ],
    categoryAliases: ["出行", "交通", "通勤", "transport"],
    confidence: 0.95,
  },
  {
    keywords: [
      "淘宝",
      "天猫",
      "京东",
      "拼多多",
      "唯品会",
      "苏宁",
      "闲鱼",
      "商场",
      "优衣库",
      "衣服",
      "鞋",
      "箱包",
    ],
    categoryAliases: ["买东西", "购物", "服饰", "shopping"],
    confidence: 0.9,
  },
  {
    keywords: ["超市", "盒马", "永辉", "沃尔玛", "华润", "便利店", "全家", "罗森", "7-11", "日用"],
    categoryAliases: ["日用", "生活用品", "超市", "household"],
    confidence: 0.85,
  },
  {
    keywords: [
      "电影",
      "影院",
      "游戏",
      "steam",
      "腾讯视频",
      "爱奇艺",
      "优酷",
      "网易云",
      "qq音乐",
      "演出",
      "门票",
      "ktv",
    ],
    categoryAliases: ["娱乐", "休闲", "entertainment"],
    confidence: 0.9,
  },
  {
    keywords: ["房租", "租金", "物业", "中介", "房贷", "链家", "自如", "贝壳"],
    categoryAliases: ["居住", "房租", "住房", "housing"],
    confidence: 0.95,
  },
  {
    keywords: [
      "水费",
      "电费",
      "燃气",
      "煤气",
      "话费",
      "宽带",
      "网费",
      "中国移动",
      "中国联通",
      "中国电信",
    ],
    categoryAliases: ["水电", "通讯", "居住", "水电通讯", "utilities"],
    confidence: 0.9,
  },
  {
    keywords: ["保险", "保费", "人寿", "平安保险", "众安", "平安", "太保", "人保"],
    categoryAliases: ["保险", "insurance"],
    confidence: 0.95,
  },
  {
    keywords: ["医院", "药房", "药店", "诊所", "体检", "挂号"],
    categoryAliases: ["医疗", "健康", "医药", "medical"],
    confidence: 0.9,
  },
  {
    keywords: ["学费", "培训", "课程", "教育", "书店", "图书", "新东方", "学而思"],
    categoryAliases: ["教育", "学习", "education"],
    confidence: 0.85,
  },
];

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "");
}

function resolveCategory(aliases: string[], categories: CategoryOption[]): CategoryOption | null {
  for (const alias of aliases) {
    const normalizedAlias = normalize(alias);
    const exact = categories.find((category) => normalize(category.name) === normalizedAlias);
    if (exact) return exact;
  }
  for (const alias of aliases) {
    const normalizedAlias = normalize(alias);
    const partial = categories.find(
      (category) =>
        normalize(category.name).includes(normalizedAlias) ||
        normalizedAlias.includes(normalize(category.name)),
    );
    if (partial) return partial;
  }
  return null;
}

/**
 * Returns the best local suggestion for a merchant/summary string, or `null`
 * when no rule can resolve to one of the user's existing categories.
 */
export function suggestCategory(
  description: string | null | undefined,
  categories: CategoryOption[],
): CategorySuggestion | null {
  if (!description || categories.length === 0) return null;
  const text = normalize(description);
  let best: { rule: Rule; keyword: string } | null = null;
  for (const rule of RULES) {
    for (const keyword of rule.keywords) {
      if (!text.includes(normalize(keyword))) continue;
      if (!best || normalize(keyword).length > normalize(best.keyword).length) {
        best = { rule, keyword };
      }
    }
  }
  if (!best) return null;
  const category = resolveCategory(best.rule.categoryAliases, categories);
  if (!category) return null;
  return {
    categoryId: category.id,
    categoryName: category.name,
    confidence: best.rule.confidence,
    matched: best.keyword,
  };
}

export function suggestAccount(
  description: string | null | undefined,
  accounts: AccountOption[],
): string | null {
  if (!description) return null;
  const text = normalize(description);
  const hints: Array<[string[], string]> = [
    [["支付宝", "alipay"], "支付宝"],
    [["微信", "wechat", "财付通"], "微信"],
    [["银行卡", "储蓄卡", "信用卡"], "银行"],
  ];
  for (const [keywords, accountHint] of hints) {
    if (!keywords.some((keyword) => text.includes(normalize(keyword)))) continue;
    const match = accounts.find((account) =>
      normalize(account.name).includes(normalize(accountHint)),
    );
    if (match) return match.id;
  }
  return null;
}

/** True when the row should be surfaced for a human decision. */
export function needsReview(suggestion: CategorySuggestion | null): boolean {
  return suggestion === null || suggestion.confidence < LOW_CONFIDENCE_THRESHOLD;
}

/**
 * Detects the provider from the CSV header instead of trusting the radio button.
 * Returns `null` when the header is not one of the supported shapes.
 */
export function detectImportProvider(content: string): "ALIPAY_CSV" | "WECHAT_CSV" | null {
  const header = content.split(/\r?\n/, 1)[0] ?? "";
  if (header.includes("交易单号") || header.includes("金额(元)") || header.includes("收/支")) {
    return "WECHAT_CSV";
  }
  if (header.includes("交易号") || header.includes("交易对方") || header.includes("收支")) {
    return "ALIPAY_CSV";
  }
  return null;
}
