const CHECK = /^\[( |x)\](.*)$/;

export type ChecklistLine = {
  index: number;
  done: boolean;
  text: string;
};

export function checklistLines(notes: string): ChecklistLine[] {
  return notes.split("\n").flatMap((line, index) => {
    const match = CHECK.exec(line);
    if (!match) return [];
    return [{ index, done: match[1] === "x", text: match[2].replace(/^ /, "") }];
  });
}

export function toggleChecklistLine(notes: string, index: number): string {
  const lines = notes.split("\n");
  const match = CHECK.exec(lines[index] ?? "");
  if (!match) return notes;
  const mark = match[1] === "x" ? " " : "x";
  lines[index] = `[${mark}]${match[2]}`;
  return lines.join("\n");
}
