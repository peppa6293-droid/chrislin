import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { buildCalendarGrid, localIsoDate, shiftMonth } from "./DateField.js";

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];
const DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** Date-only calendar popover; it never produces a time component (§6). */
export function V2CalendarPicker({
  value,
  onChange,
  label = "日期",
  disabled = false,
  error = "",
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  disabled?: boolean;
  error?: string;
}) {
  const today = localIsoDate(new Date());
  const safeValue = DATE_PATTERN.test(value) ? value : today;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(safeValue);
  const [month, setMonth] = useState(safeValue.slice(0, 7));
  const rootRef = useRef<HTMLDivElement>(null);
  const cells = buildCalendarGrid(month);
  const [yearText = "", monthNumber = ""] = month.split("-");
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!open) {
      setAnchor(null);
      return;
    }
    // Fixed-positioned so the popover can escape scroll containers such as
    // the quick-entry sheet (overflow:auto). Re-anchor on resize/scroll.
    function place() {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = 360;
      const height = 380;
      const gap = 8;
      const margin = 8;
      const left = Math.min(Math.max(margin, rect.left), window.innerWidth - width - margin);
      const below = rect.bottom + gap;
      const top =
        below + height <= window.innerHeight - margin
          ? below
          : Math.max(margin, rect.top - gap - height);
      setAnchor({ top, left });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDocumentKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
      }
    }
    document.addEventListener("keydown", onDocumentKey, true);
    return () => document.removeEventListener("keydown", onDocumentKey, true);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onOutside(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [open]);

  function moveFocus(date: string, delta: number) {
    const [year = 0, monthIndex = 1, day = 1] = date.split("-").map(Number);
    const next = new Date(year, monthIndex - 1, day + delta);
    const nextDate = localIsoDate(next);
    setDraft(nextDate);
    setMonth(nextDate.slice(0, 7));
    window.requestAnimationFrame(() => {
      rootRef.current?.querySelector<HTMLButtonElement>(`[data-date="${nextDate}"]`)?.focus();
    });
  }

  return (
    <div className="v2-calendar-picker" ref={rootRef}>
      <button
        className={`v2-calendar-trigger ${error ? "is-error" : ""}`}
        type="button"
        aria-label={`${label} ${safeValue}`}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          setDraft(safeValue);
          setMonth(safeValue.slice(0, 7));
          setOpen((current) => !current);
        }}
      >
        <CalendarDays size={20} aria-hidden="true" />
        <span>{safeValue.replaceAll("-", " / ")}</span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {error && <span className="v2-calendar-error">{error}</span>}
      {open && anchor && (
        <div
          className="v2-calendar-popover"
          role="dialog"
          aria-label="选择日期"
          style={{ top: anchor.top, left: anchor.left }}
        >
          <header className="v2-calendar-head">
            <strong>选择日期</strong>
            <span>
              {yearText} 年 {Number(monthNumber)} 月
            </span>
          </header>
          <div className="v2-calendar-monthbar">
            <button
              className="v2-icon-btn"
              type="button"
              aria-label="上个月"
              onClick={() => setMonth((current) => shiftMonth(current, -1))}
            >
              <ChevronLeft size={18} />
            </button>
            <span>
              {yearText} 年 {Number(monthNumber)} 月
            </span>
            <button
              className="v2-icon-btn"
              type="button"
              aria-label="下个月"
              onClick={() => setMonth((current) => shiftMonth(current, 1))}
            >
              <ChevronRight size={18} />
            </button>
          </div>
          <div className="v2-calendar-weekdays" aria-hidden="true">
            {WEEKDAYS.map((weekday) => (
              <span key={weekday}>{weekday}</span>
            ))}
          </div>
          {/* biome-ignore lint/a11y/useSemanticElements: date picker grid, not tabular data */}
          <div
            className="v2-calendar-grid"
            role="grid"
            aria-label={`${yearText} 年 ${monthNumber} 月`}
          >
            {cells.map((date, index) =>
              date === null ? (
                // biome-ignore lint/suspicious/noArrayIndexKey: calendar blanks carry no identity
                <span key={`blank-${index}`} aria-hidden="true" />
              ) : (
                // biome-ignore lint/a11y/useSemanticElements: date button inside the calendar grid
                <button
                  key={date}
                  type="button"
                  role="gridcell"
                  data-date={date}
                  aria-label={date === today ? `${date} 今天` : date}
                  aria-selected={date === draft}
                  className={[date === draft ? "is-selected" : "", date === today ? "is-today" : ""]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => setDraft(date)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowLeft") moveFocus(date, -1);
                    else if (event.key === "ArrowRight") moveFocus(date, 1);
                    else if (event.key === "ArrowUp") moveFocus(date, -7);
                    else if (event.key === "ArrowDown") moveFocus(date, 7);
                    else if (event.key === "Enter") setDraft(date);
                  }}
                >
                  {Number(date.slice(8, 10))}
                  {date === today && <small>今天</small>}
                </button>
              ),
            )}
          </div>
          <footer className="v2-calendar-footer">
            <button
              className="v2-btn v2-btn--secondary"
              type="button"
              onClick={() => setOpen(false)}
            >
              取消
            </button>
            <button
              className="v2-btn v2-btn--primary"
              type="button"
              onClick={() => {
                onChange(draft);
                setOpen(false);
              }}
            >
              确定
            </button>
          </footer>
        </div>
      )}
    </div>
  );
}
