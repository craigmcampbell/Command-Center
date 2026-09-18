import { expect, it, vi } from "vitest";
vi.mock("./http", () => ({ fetchWithTimeout: vi.fn() }));
import { fetchWithTimeout } from "./http";
import { getDueTasks } from "./todoist";
it("includes undated project tasks with subtasks without changing Home's due filter", async () => {
  vi.mocked(fetchWithTimeout).mockImplementation(async input => new Response(JSON.stringify({ results: String(input).includes("/projects") ? [{ id: "p", name: "Work" }] : [
    { id: "parent", content: "Build app", project_id: "p", labels: [], priority: 1 },
    { id: "child", content: "Review", parent_id: "parent", project_id: "p", labels: [], priority: 1 },
  ] }), { status: 200 }));
  const home = await getDueTasks({ apiToken: "test" });
  expect(home.tasks).toEqual([]);
  const projects = await getDueTasks({ apiToken: "test" }, true);
  expect(projects.tasks.find(t => t.id === "parent")).toMatchObject({ due: null, subtasks: [{ id: "child", content: "Review" }] });
});
