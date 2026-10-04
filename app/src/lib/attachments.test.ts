import { describe, expect, it } from "vitest";
import { attachmentBlock, fileTitle, formatBytes } from "./attachments";

describe("attachments", () => {
  it("stops at 20 files", () => {
    expect(attachmentBlock(19)).toBeNull();
    expect(attachmentBlock(20)).toBe("A task can have 20 files.");
  });

  it("keeps only the file name", () => {
    expect(fileTitle("/tmp/notes.txt")).toBe("notes.txt");
    expect(fileTitle("..")).toBe("File");
  });

  it("formats a size", () => {
    expect(formatBytes(12)).toBe("12 B");
    expect(formatBytes(2048)).toBe("2 KB");
  });
});
