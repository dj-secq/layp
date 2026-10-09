import { Temporal } from "temporal-polyfill";

export type WeekStart = "monday" | "sunday";

export function todayIso(): string {
  return Temporal.Now.plainDateISO().toString();
}

export function addDays(iso: string, days: number): string {
  return Temporal.PlainDate.from(iso).add({ days }).toString();
}

export function formatDay(iso: string): string {
  return Temporal.PlainDate.from(iso).toLocaleString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export function formatShortDay(iso: string): string {
  return Temporal.PlainDate.from(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function monthLabel(year: number, month: number): string {
  return Temporal.PlainDate.from({ year, month, day: 1 }).toLocaleString(undefined, {
    month: "long",
    year: "numeric",
  });
}

export function weekdayLabels(weekStart: WeekStart): string[] {
  const monday = Temporal.PlainDate.from("2024-01-01");
  const start = weekStart === "monday" ? monday : monday.subtract({ days: 1 });
  return Array.from({ length: 7 }, (_, index) =>
    start.add({ days: index }).toLocaleString(undefined, { weekday: "short" }),
  );
}

export function monthCells(year: number, month: number, weekStart: WeekStart): Array<string | null> {
  const first = Temporal.PlainDate.from({ year, month, day: 1 });
  const leading = weekStart === "monday" ? first.dayOfWeek - 1 : first.dayOfWeek % 7;
  const cells: Array<string | null> = Array.from({ length: leading }, () => null);
  for (let day = 1; day <= first.daysInMonth; day += 1) {
    cells.push(first.with({ day }).toString());
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const next = Temporal.PlainDate.from({ year, month, day: 1 }).add({ months: delta });
  return { year: next.year, month: next.month };
}
