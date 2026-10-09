import { Temporal } from "temporal-polyfill";
import { parseMinutes } from "./sleep";

export function cleanTitle(input: string): { title: string } | { error: string } {
  const title = input.trim();
  if (title.length < 1) return { error: "Add a title." };
  if (title.length > 500) return { error: "Titles can be 500 characters." };
  return { title };
}

export function cleanListName(input: string): { name: string } | { error: string } {
  const name = input.trim();
  if (name.length < 1) return { error: "Add a name." };
  if (name.length > 80) return { error: "Names can be 80 characters." };
  return { name };
}

export function cleanNotes(input: string): { notes: string } | { error: string } {
  if (input.length > 100_000) return { error: "Notes can be 100,000 characters." };
  return { notes: input };
}

export function cleanDuration(input: string): { minutes: number | null } | { error: string } {
  const trimmed = input.trim();
  if (!trimmed) return { minutes: null };
  if (!/^\d+$/.test(trimmed)) return { error: "Duration is 5 to 1440 minutes." };
  const minutes = Number(trimmed);
  if (minutes < 5 || minutes > 1440) return { error: "Duration is 5 to 1440 minutes." };
  return { minutes };
}

export function cleanDate(input: string): string | null {
  if (!input) return null;
  try {
    return Temporal.PlainDate.from(input).toString();
  } catch {
    return null;
  }
}

export function cleanTime(input: string): string | null {
  if (!input) return null;
  return parseMinutes(input) === null ? null : input;
}
