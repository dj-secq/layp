import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Temporal } from "temporal-polyfill";
import { monthCells, monthLabel, shiftMonth, weekdayLabels, type WeekStart } from "../lib/dates";
import { useApp } from "../state/AppState";
import { Button } from "./Button";

export function MonthPicker({
  value,
  weekStart,
  onPick,
  onClose,
}: {
  value: string;
  weekStart: WeekStart;
  onPick: (iso: string) => void;
  onClose: () => void;
}) {
  const initial = Temporal.PlainDate.from(value);
  const [cursor, setCursor] = useState({ year: initial.year, month: initial.month });
  const { pushLayer, popLayer } = useApp();
  const cells = monthCells(cursor.year, cursor.month, weekStart);
  const labels = weekdayLabels(weekStart);

  useEffect(() => {
    pushLayer();
    return () => popLayer();
  }, [pushLayer, popLayer]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div className="panel absolute z-40 mt-2 w-[280px]" role="dialog" aria-label="Choose a date">
      <div className="mb-3 flex items-center justify-between gap-2">
        <Button small aria-label="Previous month" onClick={() => setCursor((current) => shiftMonth(current.year, current.month, -1))}>
          <ChevronLeft size={16} aria-hidden />
        </Button>
        <span className="font-bold">{monthLabel(cursor.year, cursor.month)}</span>
        <Button small aria-label="Next month" onClick={() => setCursor((current) => shiftMonth(current.year, current.month, 1))}>
          <ChevronRight size={16} aria-hidden />
        </Button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center">
        {labels.map((label) => (
          <span key={label} className="meta">
            {label}
          </span>
        ))}
        {cells.map((iso, index) =>
          iso ? (
            <button
              key={iso}
              type="button"
              className="press-sm nums h-8 bg-surface"
              aria-current={iso === value ? "date" : undefined}
              style={iso === value ? { background: "var(--primary)", color: "#111" } : undefined}
              onClick={() => onPick(iso)}
            >
              {Number(iso.slice(-2))}
            </button>
          ) : (
            <span key={`empty-${index}`} />
          ),
        )}
      </div>
    </div>
  );
}
