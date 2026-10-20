import { Decimal } from "decimal.js";

export interface TrendLedgerRow {
  date: string;
  month: string;
  category: string;
  income: string;
  expense: string;
}
export interface DailyTrend {
  date: string;
  income: string;
  expense: string;
}
export interface CategoryTrend {
  category: string;
  months: Record<string, string>;
}
export interface TrendSummary {
  daily: DailyTrend[];
  monthly: Record<string, { income: string; expense: string }>;
  categories: CategoryTrend[];
  maxIncomeDay: string | null;
  maxExpenseDay: string | null;
  averageMonthlyExpense: string;
  copy: string;
}

const d = (value: string) => new Decimal(value);
const fixed = (value: Decimal) => value.toDecimalPlaces(2).toFixed(2);

export function aggregateTrends(rows: TrendLedgerRow[], months: string[]): TrendSummary {
  const daily = new Map<string, { income: Decimal; expense: Decimal }>();
  const monthly = new Map<string, { income: Decimal; expense: Decimal }>();
  const categoryMap = new Map<string, Map<string, Decimal>>();
  for (const row of rows) {
    const day = daily.get(row.date) ?? { income: new Decimal(0), expense: new Decimal(0) };
    day.income = day.income.plus(d(row.income));
    day.expense = day.expense.plus(d(row.expense));
    daily.set(row.date, day);
    const month = monthly.get(row.month) ?? { income: new Decimal(0), expense: new Decimal(0) };
    month.income = month.income.plus(d(row.income));
    month.expense = month.expense.plus(d(row.expense));
    monthly.set(row.month, month);
    const category = categoryMap.get(row.category) ?? new Map<string, Decimal>();
    category.set(row.month, (category.get(row.month) ?? new Decimal(0)).plus(d(row.expense)));
    categoryMap.set(row.category, category);
  }
  const dailyValues = [...daily.entries()].map(([date, v]) => ({
    date,
    income: fixed(v.income),
    expense: fixed(v.expense),
  }));
  const max = (field: "income" | "expense") =>
    dailyValues.reduce<string | null>((best, item) => {
      if (best === null) return item.date;
      const bestValue = daily.get(best)?.[field] ?? new Decimal(-1);
      return d(item[field]).gt(bestValue) ? item.date : best;
    }, null);
  const monthlyValues = Object.fromEntries(
    [...new Set(months)].map((month) => {
      const v = monthly.get(month) ?? { income: new Decimal(0), expense: new Decimal(0) };
      return [month, { income: fixed(v.income), expense: fixed(v.expense) }];
    }),
  );
  const categoryValues = [...categoryMap.entries()].map(([category, values]) => ({
    category,
    months: Object.fromEntries(
      months.map((month) => [month, fixed(values.get(month) ?? new Decimal(0))]),
    ),
  }));
  const expenses = Object.values(monthlyValues).map((v) => d(v.expense));
  const average = expenses.length
    ? fixed(expenses.reduce((a, b) => a.plus(b), new Decimal(0)).div(expenses.length))
    : "0.00";
  const latest = months.at(-1);
  const previous = months.at(-2);
  const latestExpense = latest ? d(monthlyValues[latest]?.expense ?? "0") : new Decimal(0);
  const previousExpense = previous ? d(monthlyValues[previous]?.expense ?? "0") : new Decimal(0);
  const delta = latestExpense.minus(previousExpense);
  const copy =
    rows.length === 0
      ? "还没有可展示的收支记录。"
      : delta.isZero()
        ? "这个月的支出和上月差不多。"
        : `这个月的支出比上月${delta.isPositive() ? "多" : "少"}了约 ${fixed(delta.abs())} 元。`;
  return {
    daily: dailyValues,
    monthly: monthlyValues,
    categories: categoryValues,
    maxIncomeDay: max("income"),
    maxExpenseDay: max("expense"),
    averageMonthlyExpense: average,
    copy,
  };
}
