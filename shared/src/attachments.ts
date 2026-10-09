export const MAX_ATTACHMENTS = 20;

export function attachmentBlock(count: number): string | null {
  if (count >= MAX_ATTACHMENTS) return "A task can have 20 files.";
  return null;
}

export function fileTitle(path: string): string {
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const name = (slash >= 0 ? path.slice(slash + 1) : path).trim();
  if (!name || name === "." || name === "..") return "File";
  return name.slice(0, 200);
}

export function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size < 0) return "0 B";
  if (size < 1024) return `${Math.round(size)} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
