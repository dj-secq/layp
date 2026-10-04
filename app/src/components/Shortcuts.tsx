import { Button } from "./Button";
import { Dialog } from "./Dialog";

const ROWS: Array<[string, string]> = [
  ["q", "Quick add"],
  ["c", "Add on this page"],
  ["j / k", "Move the selection"],
  ["Enter", "Open the selected task"],
  ["Space", "Complete or reopen"],
  ["Left / Right", "Previous and next day"],
  ["Arrows, Enter", "Month and year grid"],
  ["t", "Jump to today"],
  ["Ctrl+\\", "Collapse or expand the sidebar"],
  ["Ctrl+F", "Search"],
  ["Ctrl+Shift+F", "Start or pause focus"],
  ["Ctrl+,", "Settings"],
  ["Esc", "Close"],
  ["?", "Shortcut list"],
];

export function Shortcuts({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Shortcuts" onClose={onClose}>
      <ul className="grid gap-2">
        {ROWS.map(([keys, action]) => (
          <li key={keys} className="flex items-baseline justify-between gap-4">
            <span>{action}</span>
            <span className="meta nums">{keys}</span>
          </li>
        ))}
      </ul>
      <Button variant="primary" className="mt-4" onClick={onClose}>
        Close
      </Button>
    </Dialog>
  );
}
