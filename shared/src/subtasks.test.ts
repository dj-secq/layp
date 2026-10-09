import { describe, expect, it } from "vitest";
import { parentCreatesCycle, subtaskTree, type SubtaskLink } from "./subtasks";

function link(id: string, parentId: string | null): SubtaskLink {
  return { id, parentId };
}

describe("subtask tree", () => {
  it("nests children in input order and stops at 8 levels", () => {
    const tasks: SubtaskLink[] = [link("root", null)];
    let parent = "root";
    for (let level = 1; level <= 9; level += 1) {
      const id = `n${level}`;
      tasks.push(link(id, parent));
      parent = id;
    }
    tasks.splice(1, 0, link("sib", "root"));
    const tree = subtaskTree(tasks, "root");
    expect(tree.map((node) => node.task.id)).toEqual(["sib", "n1"]);
    let node = tree[1];
    const chain = ["n1"];
    while (node.children.length > 0) {
      node = node.children[0];
      chain.push(node.task.id);
    }
    expect(chain).toEqual(["n1", "n2", "n3", "n4", "n5", "n6", "n7", "n8"]);
  });

  it("draws a cycle once under the first valid parent", () => {
    const tasks = [link("a", "root"), link("b", "a"), link("a", "b"), link("c", "b")];
    const tree = subtaskTree(tasks, "root");
    expect(tree).toEqual([
      {
        task: link("a", "root"),
        children: [
          {
            task: link("b", "a"),
            children: [{ task: link("c", "b"), children: [] }],
          },
        ],
      },
    ]);
  });

  it("refuses a parent that is the task or one of its descendants", () => {
    const tasks = [link("a", null), link("b", "a"), link("c", "b")];
    expect(parentCreatesCycle(tasks, "new", null)).toBe(false);
    expect(parentCreatesCycle(tasks, "new", "new")).toBe(true);
    expect(parentCreatesCycle(tasks, "a", "c")).toBe(true);
    expect(parentCreatesCycle(tasks, "c", "a")).toBe(false);
    expect(parentCreatesCycle([link("a", "b"), link("b", "a")], "fresh", "a")).toBe(false);
  });
});