/** Membership for Today. Grouping happens after this query returns rows. */
export const TASKS_FOR_DATE_WHERE = `deleted_at IS NULL AND parent_id IS NULL
  AND list_id IN (SELECT id FROM lists WHERE archived_at IS NULL)
  AND (
    due_on = $1
    OR start_on = $1
    OR ($1 = $2 AND completed_at IS NULL AND pinned = 1)
    OR ($1 = $2 AND completed_at IS NULL AND due_on IS NOT NULL AND due_on < $2)
  )`;
