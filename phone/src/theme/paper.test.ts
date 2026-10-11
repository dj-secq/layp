import { describe, expect, it } from "vitest";
import { onPrimary, papers, primary, themeNames } from "./paper";

describe("desktop paper table", () => {
  it("keeps the shared primary", () => {
    expect(primary).toBe("#ffdc58");
    expect(onPrimary).toBe("#111111");
    expect(themeNames).toEqual(["light", "dark", "dusk", "ink", "sage", "sea", "bloom", "slate"]);
  });

  it("matches the desktop canvas, surface, ink, and ink-soft", () => {
    expect(papers.light).toMatchObject({
      scheme: "light",
      background: "#f4f1ea",
      grouped: "#fffcf8",
      ink: "#2c2824",
      secondary: "#4e4840",
      border: "#e3dcd0",
      muted: "#ebe4d6",
      danger: "#e63946",
    });
    expect(papers.dark).toMatchObject({
      scheme: "dark",
      background: "#1c1b19",
      grouped: "#282623",
      ink: "#f4efe6",
      secondary: "#b7b0a4",
      muted: "#32302c",
      danger: "#ff6b6b",
    });
    expect(papers.dusk.secondary).toBe("#ddd4c8");
    expect(papers.ink.secondary).toBe("#a8b6c4");
    expect(papers.slate.secondary).toBe("#555c66");
    expect(papers.sage.scheme).toBe("light");
    expect(papers.sea.scheme).toBe("light");
    expect(papers.bloom.scheme).toBe("light");
    expect(papers.dusk.scheme).toBe("dark");
    expect(papers.ink.scheme).toBe("dark");
  });
});
