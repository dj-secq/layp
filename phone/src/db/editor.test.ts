import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { draftFromRule, parseRule, recurrenceSave, rule, serializeRule } from "@layp/shared";
import { expect, it, vi } from "vitest";

vi.mock("./open", () => ({
  openPhoneDatabase: async () => {
    throw new Error("editor tests drive SQL through node:sqlite");
  },
}));
import { completeOn } from "./complete";
import { DIARY_PAUSE_MS, emptyDay, saveDayOn } from "./days";
import { applyMigrations } from "./migrate";
import { named, nodeRun, openMemory } from "./node-run";
import { readClock } from "./settings";
import type { Run } from "./sql";
import { addQuickOn, createOn, loadInboxOn, patchOn, reopenOn } from "./tasks";

const stamp = "2026-10-08T12:00:00.000Z";
const sunday = { today: "2026-10-04", minutes: 15 * 60 };

async function prepare(): Promise<DatabaseSync> {
  const db = openMemory();
  const files = ["001_schema.sql", "002_checklist_reminders.sql", "003_attachments.sql", "004_fts.sql", "005_phone.sql"].map(
    (name, index) => ({
      version: index + 1,
      sql: readFileSync(fileURLToPath(new URL(`../../../app/src-tauri/migrations/${name}`, import.meta.url)), "utf8"),
    }),
  );
  await applyMigrations(
    {
      exec: async (sql) => {
        db.exec(sql);
      },
      all: async (sql, values) => {
        const statement = db.prepare(sql);
        return (values?.length ? statement.all(named(values)) : statement.all()) as Record<string, unknown>[];
      },
      run: async (sql, values) => {
        const statement = db.prepare(sql);
        if (values?.length) statement.run(named(values));
        else statement.run();
      },
      transaction: async (body) => {
        db.exec("BEGIN");
        try {
          await body();
          db.exec("COMMIT");
        } catch (err) {
          db.exec("ROLLBACK");
          throw err;
        }
      },
    },
    files,
  );
  db.prepare(
    `INSERT INTO lists (id, folder_id, name, color, sort_order, archived_at, is_inbox, created_at, updated_at)
     VALUES ('school', NULL, 'School', '#ffdc58', 1, NULL, 0, $created, $created)`,
  ).run({ $created: stamp });
  db.prepare(`INSERT INTO sections (id, list_id, name, sort_order) VALUES ('school-late', 'school', 'Later', 1)`).run();
  db.prepare(`INSERT INTO sections (id, list_id, name, sort_order) VALUES ('school-open', 'school', 'Open', 0)`).run();
  return db;
}

function tracing(db: DatabaseSync): { run: Run; sqls: string[] } {
  const sqls: string[] = [];
  const run: Run = async (statements) => {
    sqls.push(...statements.map((statement) => statement.sql));
    return nodeRun(db, () => stamp)(statements);
  };
  return { run, sqls };
}

it("keeps the diary pause at 400 ms and stamps a day without dropping a stale write", async () => {
  expect(DIARY_PAUSE_MS).toBe(400);
  const db = await prepare();
  const { run, sqls } = tracing(db);
  const first = await saveDayOn(run, { ...emptyDay("2026-10-08"), diary: "morning", workoutNote: "x".repeat(600) }, stamp);
  expect(first.status).toBe("saved");
  if (first.status !== "saved") return;
  expect(first.row.updatedAt).toBe(stamp);
  expect(first.row.workoutNote).toHaveLength(500);
  const stale = await saveDayOn(run, { ...first.row, updatedAt: "2020-01-01T00:00:00.000Z", diary: "nope" }, "2026-10-08T13:00:00.000Z");
  expect(stale.status).toBe("conflict");
  const kept = db.prepare(`SELECT diary, workout_note, updated_at FROM days WHERE day = '2026-10-08'`).get() as {
    diary: string;
    workout_note: string;
    updated_at: string;
  };
  expect(kept.diary).toBe("morning");
  expect(kept.updated_at).toBe(stamp);
  const forced = await saveDayOn(run, { ...first.row, diary: "kept" }, "2026-10-08T13:00:00.000Z", true);
  expect(forced.status).toBe("saved");
  expect((db.prepare(`SELECT diary FROM days WHERE day = '2026-10-08'`).get() as { diary: string }).diary).toBe("kept");
  expect(sqls.some((sql) => sql.trimStart().startsWith("BEGIN"))).toBe(false);
  const rejected = await saveDayOn(run, { ...emptyDay("2026-10-09"), mood: 9 }, stamp);
  expect(rejected).toEqual({ status: "error", message: "Not saved" });
  expect(db.prepare(`SELECT COUNT(*) AS n FROM days WHERE day = '2026-10-09'`).get()).toEqual({ n: 0 });
});

it("stores gym friday 6pm at 18:00 and does not create a missing list", async () => {
  const db = await prepare();
  const { run, sqls } = tracing(db);
  const before = db.prepare(`SELECT COUNT(*) AS n FROM lists`).get() as { n: number };
  const gym = await addQuickOn(run, "gym friday 6pm", sunday, stamp, () => "gym-1");
  expect(gym.status).toBe("saved");
  if (gym.status !== "saved") return;
  expect(gym.row).toMatchObject({ title: "gym", listId: "inbox", sectionId: "inbox-open", dueOn: "2026-10-09", dueTime: "18:00" });
  const row = db.prepare(`SELECT due_on, due_time, list_id FROM tasks WHERE id = 'gym-1'`).get() as {
    due_on: string;
    due_time: string;
    list_id: string;
  };
  expect(row).toEqual({ due_on: "2026-10-09", due_time: "18:00", list_id: "inbox" });
  const missing = await addQuickOn(run, "essay in NoSuch", sunday, stamp, () => "missing-1");
  expect(missing).toMatchObject({ status: "saved", notice: "No list named NoSuch." });
  expect((db.prepare(`SELECT list_id, section_id FROM tasks WHERE id = 'missing-1'`).get() as { list_id: string; section_id: string })).toEqual({
    list_id: "inbox",
    section_id: "inbox-open",
  });
  expect(db.prepare(`SELECT COUNT(*) AS n FROM lists`).get()).toEqual(before);
  const school = await addQuickOn(run, "essay p1 in School", sunday, stamp, () => "essay-1");
  expect(school.status).toBe("saved");
  if (school.status !== "saved") return;
  expect(school.row).toMatchObject({ listId: "school", sectionId: "school-open", priority: "high", important: true });
  expect(school.notice).toBeNull();
  expect(sqls.some((sql) => sql.trimStart().startsWith("BEGIN"))).toBe(false);
  expect(sqls.some((sql) => /\$1[0-9]/.test(sql) && !sql.includes("$10") && !sql.includes("$11") && !sql.includes("$12"))).toBe(false);
});

it("adds a plain inbox title and saves a recurrence onto a task with no due date", async () => {
  const db = await prepare();
  const { run } = tracing(db);
  const inbox = await loadInboxOn(run);
  const added = await createOn(
    run,
    { title: "buy milk", notes: "", listId: inbox.lists.find((list) => list.isInbox)?.id ?? "", sectionId: "inbox-open" },
    stamp,
    "milk",
  );
  expect(added.status).toBe("saved");
  const again = await loadInboxOn(run);
  expect(again.tasks.map((task) => task.title)).toContain("buy milk");
  const draft = draftFromRule(null);
  draft.freq = "daily";
  const recurrence = recurrenceSave(draft, { dueOn: null, dueTime: null }, "2026-10-08", 15 * 60);
  if (added.status !== "saved") return;
  const patched = await patchOn(run, added.row, { recurrence: recurrence.recurrence, dueOn: recurrence.dueOn }, "2026-10-08T15:00:00.000Z");
  expect(patched.status).toBe("saved");
  const stored = db.prepare(`SELECT due_on, recurrence_json FROM tasks WHERE id = 'milk'`).get() as {
    due_on: string;
    recurrence_json: string;
  };
  expect(stored.due_on).toBe(recurrence.dueOn);
  expect(parseRule(stored.recurrence_json)?.freq).toBe("daily");
  expect((await readClock(run))).toBe("12");
});

it("reopens without deleting the later occurrence and drops a checklist reminder with the notes", async () => {
  const db = await prepare();
  const { run, sqls } = tracing(db);
  const created = await createOn(
    run,
    {
      title: "Gym",
      notes: "[ ] shoes",
      listId: "inbox",
      sectionId: "inbox-open",
      dueOn: "2026-10-08",
      dueTime: "18:00",
      recurrence: rule({ freq: "daily", end: { type: "count", remaining: 3 } }),
    },
    stamp,
    "gym",
  );
  expect(created.status).toBe("saved");
  db.prepare(
    `INSERT INTO checklist_reminders (id, task_id, line_text, due_on, due_time, minutes_before, fired_at, created_at)
     VALUES ('check-1', 'gym', 'shoes', '2026-10-08', NULL, 5, NULL, $created)`,
  ).run({ $created: stamp });
  if (created.status !== "saved") return;
  const task = {
    ...created.row,
    recurrenceJson: serializeRule(rule({ freq: "daily", end: { type: "count", remaining: 3 } })),
  };
  let spawned = 0;
  expect(
    await completeOn(run, "gym", stamp, "2026-10-08", () => (spawned++ === 0 ? "next-1" : `copy-${spawned}`)),
  ).toBe("saved");
  expect(db.prepare(`SELECT COUNT(*) AS n FROM tasks`).get()).toEqual({ n: 2 });
  const beforeReopen = sqls.length;
  expect(await reopenOn(run, "gym", "2026-10-08T16:00:00.000Z")).toBe("saved");
  const reopenSql = sqls.slice(beforeReopen).join("\n");
  expect(reopenSql).not.toContain("DELETE");
  expect(db.prepare(`SELECT COUNT(*) AS n FROM tasks`).get()).toEqual({ n: 2 });
  expect((db.prepare(`SELECT completed_at FROM tasks WHERE id = 'gym'`).get() as { completed_at: string | null }).completed_at).toBeNull();
  expect(db.prepare(`SELECT id FROM tasks WHERE id = 'next-1'`).get()).toEqual({ id: "next-1" });
  const cleared = await patchOn(run, { ...task, completedAt: null, updatedAt: "2026-10-08T16:00:00.000Z" }, { notes: "" }, "2026-10-08T17:00:00.000Z", false, () => "del-1");
  expect(cleared.status).toBe("saved");
  expect(db.prepare(`SELECT id FROM checklist_reminders WHERE id = 'check-1'`).get()).toBeUndefined();
  expect(db.prepare(`SELECT entity, entity_id FROM deletions WHERE id = 'del-1'`).get()).toEqual({
    entity: "checklist_reminders",
    entity_id: "check-1",
  });
});
