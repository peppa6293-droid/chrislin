import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function localIsoDate(value: Date): string {
  const pad = (number: number) => String(number).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

export function shiftMonth(month: string, delta: number): string {
  if (!MONTH_PATTERN.test(month)) return month;
  const [yearText = "0", monthText = "1"] = month.split("-");
  const base = new Date(Number(yearText), Number(monthText) - 1 + delta, 1);
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}`;
}

/** Monday-first calendar grid; `null` entries are leading/trailing blanks. */
export function buildCalendarGrid(month: string): Array<string | null> {
  if (!MONTH_PATTERN.test(month)) return [];
  const [yearText = "0", monthText = "1"] = month.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const firstWeekday = new Date(year, monthIndex, 1).getDay(); // 0 = Sunday
  const leading = (firstWeekday + 6) % 7; // Monday-first
  const cells: Array<string | null> = Array.from({ length: leading }, () => null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(`${yearText}-${monthText}-${String(day).padStart(2, "0")}`);
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

/**
 * Date-only picker. It never produces a time component, matching the frozen
 * `YYYY-MM-DD` business-date contract of `v2-expense-service`.
 */
export function DateField({
  value,
  onChange,
  label = "日期",
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  disabled?: boolean;
}) {
  const today = localIsoDate(new Date());
  const safeValue = DATE_PATTERN.test(value) ? value : today;
  const [month, setMonth] = useState(safeValue.slice(0, 7));
  const cells = buildCalendarGrid(month);
  const [yearText = "", monthNumber = ""] = month.split("-");

  return (
    <section className="v2-date-field" aria-label={label}>
      <header className="v2-date-header">
        <button
          type="button"
          className="icon-button"
          aria-label="上个月"
          disabled={disabled}
          onClick={() => setMonth((current) => shiftMonth(current, -1))}
        >
          <ChevronLeft size={18} />
        </button>
        <strong>
          {yearText} 年 {Number(monthNumber)} 月
        </strong>
        <button
          type="button"
          className="icon-button"
          aria-label="下个月"
          disabled={disabled}
          onClick={() => setMonth((current) => shiftMonth(current, 1))}
        >
          <ChevronRight size={18} />
        </button>
      </header>
      <div className="v2-date-weekdays" aria-hidden="true">
        {WEEKDAYS.map((weekday) => (
          <span key={weekday}>{weekday}</span>
        ))}
      </div>
      <fieldset className="v2-date-grid" aria-label={`${yearText} 年 ${Number(monthNumber)} 月`}>
        {cells.map((date, index) =>
          date === null ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: calendar blanks carry no identity
            <span key={`blank-${index}`} aria-hidden="true" />
          ) : (
            <button
              key={date}
              type="button"
              aria-label={date}
              aria-pressed={date === safeValue}
              disabled={disabled}
              className={[date === safeValue ? "is-selected" : "", date === today ? "is-today" : ""]
                .filter(Boolean)
                .join(" ")}
              onClick={() => onChange(date)}
            >
              {Number(date.slice(8, 10))}
            </button>
          ),
        )}
      </fieldset>
      <footer className="v2-date-footer">
        <span>已选 {safeValue}</span>
        <button
          type="button"
          className="v2-text-button"
          disabled={disabled}
          onClick={() => {
            setMonth(today.slice(0, 7));
            onChange(today);
          }}
        >
          今天
        </button>
      </footer>
    </section>
  );
}
