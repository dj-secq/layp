import { describe, expect, it } from "vitest";
import { formatClock, parseClock } from "./clock";

describe("parseClock", () => {
  it("stores 24-hour times and 12-hour times as HH:MM", () => {
    expect(parseClock("23:30")).toBe("23:30");
    expect(parseClock("7:05")).toBe("07:05");
    expect(parseClock("11:30 PM")).toBe("23:30");
    expect(parseClock("7:00 am")).toBe("07:00");
    expect(parseClock("12:00 AM")).toBe("00:00");
    expect(parseClock("12:15 PM")).toBe("12:15");
    expect(parseClock("")).toBeNull();
    expect(parseClock("noon")).toBeNull();
  });
});

describe("formatClock", () => {
  it("shows 11:30 PM for a 12-hour clock", () => {
    expect(formatClock("23:30", "12")).toBe("11:30 PM");
    expect(formatClock("07:00", "24")).toBe("07:00");
  });
});
