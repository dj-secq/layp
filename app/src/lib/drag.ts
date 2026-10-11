import type { DragEvent } from "react";

export function markDragging(event: DragEvent<HTMLElement>) {
  event.currentTarget.dataset.dragging = "true";
}

export function clearDragging(event: DragEvent<HTMLElement>) {
  delete event.currentTarget.dataset.dragging;
}

export function enterDrop(event: DragEvent<HTMLElement>) {
  event.preventDefault();
  event.currentTarget.dataset.over = "true";
}

export function leaveDrop(event: DragEvent<HTMLElement>) {
  const next = event.relatedTarget;
  if (next instanceof Node && event.currentTarget.contains(next)) return;
  delete event.currentTarget.dataset.over;
}

export function clearDrop(event: DragEvent<HTMLElement>) {
  delete event.currentTarget.dataset.over;
}
