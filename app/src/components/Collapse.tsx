import { useRef, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cx } from "../lib/cx";

function visible(children: ReactNode): boolean {
  return children !== null && children !== undefined && children !== false;
}

export function Collapse({ open, children, className }: { open: boolean; children: ReactNode; className?: string }) {
  const held = useRef<ReactNode>(null);
  if (visible(children)) held.current = children;
  return (
    <div className={cx("reveal", className)} data-open={open ? "true" : "false"}>
      <div className="reveal-inner" inert={open ? undefined : true}>
        {visible(children) ? children : held.current}
      </div>
    </div>
  );
}

export function Fold({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="fold">
      <button type="button" className="fold-summary" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <ChevronRight size={14} strokeWidth={1.75} aria-hidden />
        {title}
      </button>
      <Collapse open={open}>{children}</Collapse>
    </div>
  );
}
