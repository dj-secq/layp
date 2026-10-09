export type SectionRef = { id: string; name: string; sortOrder: number };

/** Same order as `firstSectionId`: sort order, then name. */
export function compareSections(a: { sortOrder: number; name: string }, b: { sortOrder: number; name: string }): number {
  return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
}

export function sectionDeletePlan(
  sections: SectionRef[],
  id: string,
): { error: "Last section stays." } | { targetId: string } {
  if (sections.length < 2) return { error: "Last section stays." };
  const remaining = sections.filter((section) => section.id !== id).sort(compareSections);
  const targetId = remaining[0]?.id;
  if (!targetId) return { error: "Last section stays." };
  return { targetId };
}
