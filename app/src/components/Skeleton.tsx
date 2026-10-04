import { startTransition, useCallback, useState, type ReactNode } from "react";

export function useViewLoad(key: string) {
  const [loaded, setLoaded] = useState<string | null>(null);
  const settle = useCallback((apply?: () => void) => {
    startTransition(() => {
      apply?.();
      setLoaded(key);
    });
  }, [key]);
  return { ready: loaded === key, settle };
}

type Kind = "year" | "month" | "rows" | "cards" | "board" | "matrix" | "stats" | "calendar" | "timeline";

export function Skeleton({ kind, label }: { kind: Kind; label: string }) {
  const frame = kind === "year" ? "year-months skeleton" : `skeleton skeleton-${kind}`;
  return (
    <div className={frame} role="status" aria-label={label}>
      {body(kind)}
    </div>
  );
}

function body(kind: Kind): ReactNode {
  if (kind === "year") {
    return Array.from({ length: 12 }, (_, index) => <span key={index} className="skeleton-block year-skel" />);
  }
  if (kind === "month" || kind === "calendar") {
    return (
      <div className="month-grid">
        {Array.from({ length: kind === "month" ? 35 : 21 }, (_, index) => (
          <span key={index} className="skeleton-block skeleton-cell" />
        ))}
      </div>
    );
  }
  if (kind === "stats") return <span className="skeleton-block stats-skel" />;
  const count = kind === "rows" ? 6 : kind === "cards" ? 3 : kind === "matrix" ? 4 : kind === "board" ? 3 : 4;
  return Array.from({ length: count }, (_, index) => <span key={index} className="skeleton-block" />);
}
