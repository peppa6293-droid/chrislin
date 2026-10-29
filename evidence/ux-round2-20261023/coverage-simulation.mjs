// Read-only pre-check: how many ledger rows the rule table could recategorize per month.
import { DatabaseSync } from "node:sqlite";
import { suggestCategory } from "../../src/model/import-rules.ts";

const DB = "/Users/linte/Library/Application Support/com.personalfinance.console/personal-finance-console.sqlite3";
const EXPECTED_EXTRA = ["医疗", "居住", "水电", "保险", "教育"];
const db = new DatabaseSync(DB, { readOnly: true });
const categories = db.prepare("SELECT id,name FROM expense_categories WHERE active=1").all();
for (const name of EXPECTED_EXTRA) {
  if (!categories.some((category) => category.name === name)) {
    categories.push({ id: `missing:${name}`, name });
  }
}
const rows = db.prepare(
  "SELECT id,occurred_on,description,category_id FROM expenses ORDER BY occurred_on,id",
).all();
const months = new Map();
let total = 0;
let totalAmount = 0;
for (const row of rows) {
  const suggestion = suggestCategory(row.description, categories);
  if (!suggestion || suggestion.categoryId === row.category_id) continue;
  const month = String(row.occurred_on).slice(0, 7);
  const bucket = months.get(month) ?? { month, rows: 0, amount: 0, targets: {} };
  bucket.rows += 1;
  const amount = Number(db.prepare("SELECT amount FROM expenses WHERE id=?").get(row.id).amount);
  bucket.amount += amount;
  bucket.targets[suggestion.categoryName] = (bucket.targets[suggestion.categoryName] ?? 0) + 1;
  months.set(month, bucket);
  total += 1;
  totalAmount += amount;
}
console.log(JSON.stringify({ total, totalAmount, months: [...months.values()] }, null, 2));
db.close();
