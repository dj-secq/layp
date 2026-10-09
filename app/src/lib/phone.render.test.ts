import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { PhonePanel } from "../screens/SettingsScreen";

vi.mock("../state/AppState", () => ({
  useApp: () => ({ pushLayer: () => undefined, popLayer: () => undefined }),
}));

vi.mock("../components/Dialog", async () => {
  const { createElement: h } = await import("react");
  return {
    Dialog: ({ title, children }: { title: string; children: ReactNode }) =>
      h("section", null, h("h2", null, title), children),
  };
});

const base = {
  enabled: true,
  listening: true,
  host: "192.168.1.20",
  port: 47321,
  otherIpv4: ["10.0.0.2"],
  code: "layp:1:192.168.1.20:47321:K7NQ4R2M",
  expiresAt: "2026-10-08T12:05:00.000Z",
  pairedName: "Pocket",
  lastSyncAt: "2026-10-08T12:00:00.000Z",
  keyNote: null,
  showForget: true,
  error: null,
  replaceOpen: false,
  forgetOpen: false,
  onToggle: () => undefined,
  onMint: () => undefined,
  onConfirmReplace: () => undefined,
  onAskForget: () => undefined,
  onForget: () => undefined,
  onCloseReplace: () => undefined,
  onCloseForget: () => undefined,
};

it("shows the backup line, the pairing string, and the forget copy", () => {
  const html = renderToStaticMarkup(createElement(PhonePanel, base));
  expect(html).toContain("Export a backup before the first pairing.");
  expect(html).toContain("layp:1:192.168.1.20:47321:K7NQ4R2M");
  expect(html).toContain("Listening at 192.168.1.20:47321");
  expect(html).toContain("Other addresses: 10.0.0.2");
  expect(html).toContain("Paired with Pocket.");
  expect(html).toContain("Last sync 2026-10-08T12:00:00.000Z.");
  expect(html).toContain("<svg");
  expect(html).not.toContain("removed");

  const replace = renderToStaticMarkup(createElement(PhonePanel, { ...base, replaceOpen: true, code: null }));
  expect(replace).toContain("Replace the paired phone?");

  const forget = renderToStaticMarkup(createElement(PhonePanel, { ...base, forgetOpen: true }));
  expect(forget).toContain("The phone keeps the copy it already has and will not receive new rows.");
  expect(forget).not.toContain("removed");

  const unused = renderToStaticMarkup(createElement(PhonePanel, { ...base, pairedName: null, lastSyncAt: null, keyNote: "The key is unused." }));
  expect(unused).toContain("The key is unused.");
  const missing = renderToStaticMarkup(createElement(PhonePanel, { ...base, keyNote: "The key is missing.", code: null }));
  expect(missing).toContain("The key is missing.");
});
