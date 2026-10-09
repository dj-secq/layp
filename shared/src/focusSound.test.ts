import { describe, expect, it } from "vitest";
import { chimePlays, clipForTransition, parseFocusSound } from "./focusSound";

const sounds = { work: "soft" as const, break: "bell" as const };

describe("parseFocusSound", () => {
  it("uses bell when the setting is missing and keeps an explicit none", () => {
    expect(parseFocusSound(undefined)).toBe("bell");
    expect(parseFocusSound("")).toBe("bell");
    expect(parseFocusSound("chime")).toBe("bell");
    expect(parseFocusSound("none")).toBe("none");
    expect(parseFocusSound("soft")).toBe("soft");
  });
});

describe("clipForTransition", () => {
  it("plays the phase clip only when the timer reaches zero", () => {
    expect(clipForTransition("work", sounds, "elapsed")).toBe("soft");
    expect(clipForTransition("break", sounds, "elapsed")).toBe("bell");
    expect(clipForTransition("work", { work: "none", break: "click" }, "elapsed")).toBeNull();
    expect(clipForTransition("work", sounds, "skip")).toBeNull();
    expect(clipForTransition("break", sounds, "cancel")).toBeNull();
    expect(clipForTransition("work", sounds, "pause")).toBeNull();
  });
});

describe("chimePlays", () => {
  it("rings eight times only when the phase elapses", () => {
    expect(chimePlays("work", sounds, "elapsed")).toBe(8);
    expect(chimePlays("break", sounds, "elapsed")).toBe(8);
    expect(chimePlays("work", { work: "none", break: "bell" }, "elapsed")).toBe(0);
    expect(chimePlays("work", sounds, "skip")).toBe(0);
    expect(chimePlays("work", sounds, "cancel")).toBe(0);
    expect(chimePlays("work", sounds, "pause")).toBe(0);
  });
});
