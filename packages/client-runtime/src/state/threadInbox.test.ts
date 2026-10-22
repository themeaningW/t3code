import { EnvironmentId, ProviderInstanceId, RunId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  createInboxReturnTracker,
  sortWorkingThreadsBySend,
  sortUnreadInboxThreadsByReturn,
  resolveSidebarInboxSortOrder,
  sortSidebarInboxThreads,
} from "./threadInbox.ts";

const environmentId = EnvironmentId.make("environment-1");

describe("per-project inbox sorting", () => {
  const sortable = (
    id: string,
    title: string,
    createdAt: string,
    activeOrderKey: string | null = null,
  ) => ({
    ...thread(id, false),
    title,
    createdAt,
    activeOrderKey,
  });

  it("keeps project choices independent from All projects and the legacy setting", () => {
    const overrides = {
      [JSON.stringify("project-a")]: "created_asc" as const,
      null: "title_asc" as const,
    };
    const resolve = (projectScopeKey: string | null) =>
      resolveSidebarInboxSortOrder({
        overrides,
        projectScopeKey,
        unreadCompletionOrderEnabled: true,
      });
    expect(resolve("project-a")).toBe("created_asc");
    expect(resolve("project-b")).toBe("default");
    expect(resolve(null)).toBe("title_asc");
    expect(
      resolveSidebarInboxSortOrder({
        overrides: {},
        projectScopeKey: null,
        unreadCompletionOrderEnabled: true,
      }),
    ).toBe("unread_completion");
    expect(
      resolveSidebarInboxSortOrder({
        overrides: { null: "default" },
        projectScopeKey: null,
        unreadCompletionOrderEnabled: true,
      }),
    ).toBe("default");
    // A project literally named "null" cannot collide with the All-projects view.
    expect(resolve("null")).toBe("default");
  });

  it("sorts by creation and natural title without modifying the source", () => {
    const threads = [
      sortable("a", "task 10", "2026-06-01T00:00:00Z"),
      sortable("b", "Task 2", "2026-06-03T00:00:00Z"),
      sortable("c", "alpha", "2026-06-02T00:00:00Z"),
    ];
    const ids = (mode: "created_asc" | "created_desc" | "title_asc" | "title_desc") =>
      sortSidebarInboxThreads(threads, mode, () => false).map((t) => t.id);
    expect(ids("created_asc")).toEqual(["a", "c", "b"]);
    expect(ids("created_desc")).toEqual(["b", "c", "a"]);
    expect(ids("title_asc")).toEqual(["c", "b", "a"]);
    expect(ids("title_desc")).toEqual(["a", "b", "c"]);
    expect(threads.map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("retains manual keys through completion, read-state and rename changes", () => {
    const threads = [
      sortable("a", "Zulu", "2026-06-01T00:00:00Z", "b"),
      sortable("b", "Alpha", "2026-06-02T00:00:00Z", "n"),
    ];
    const updated = threads.map((t) => ({
      ...t,
      title: "Renamed",
      latestRun: {
        runId: RunId.make("finished"),
        status: "completed" as const,
        requestedAt: "2026-06-04T00:00:00Z",
        completedAt: "2026-06-04T01:00:00Z",
        startedAt: null,
        assistantMessageId: null,
      },
    }));
    expect(sortSidebarInboxThreads(threads, "manual", () => true).map((t) => t.id)).toEqual([
      "a",
      "b",
    ]);
    expect(sortSidebarInboxThreads(updated, "manual", () => false).map((t) => t.id)).toEqual([
      "a",
      "b",
    ]);
  });

  it("separates completion order from unread priority and ignores manual keys", () => {
    const threads = [
      {
        ...sortable("a", "Alpha", "2026-06-01T00:00:00Z", "n"),
        latestRun: {
          runId: RunId.make("finished"),
          status: "completed" as const,
          requestedAt: "2026-06-01T00:00:00Z",
          completedAt: "2026-06-04T00:00:00Z",
          startedAt: null,
          assistantMessageId: null,
        },
      },
      sortable("b", "Beta", "2026-06-02T00:00:00Z", "b"),
    ];
    expect(
      sortSidebarInboxThreads(threads, "completion_desc", (t) => t.id === "b").map((t) => t.id),
    ).toEqual(["a", "b"]);
    expect(
      sortSidebarInboxThreads(threads, "unread_completion", (t) => t.id === "b").map((t) => t.id),
    ).toEqual(["b", "a"]);
  });
});

describe("unread completion order", () => {
  it("places unread completions above newer read completions and orders each group by return", () => {
    const finished = (id: string, completedAt: string) => ({
      ...thread(id, false),
      latestRun: {
        runId: RunId.make(id),
        status: "completed" as const,
        requestedAt: "2026-06-01T00:00:00.000Z",
        startedAt: null,
        completedAt,
        assistantMessageId: null,
      },
    });
    const input = [
      finished("read", "2026-06-04T00:00:00Z"),
      finished("unread-old", "2026-06-02T00:00:00Z"),
      finished("unread-new", "2026-06-03T00:00:00Z"),
    ];
    expect(
      sortUnreadInboxThreadsByReturn(input, (t) => t.id.startsWith("unread")).map((t) => t.id),
    ).toEqual(["unread-new", "unread-old", "read"]);
    expect(input[0]?.id).toBe("read");
    expect(sortUnreadInboxThreadsByReturn(input, () => false).map((t) => t.id)).toEqual([
      "read",
      "unread-new",
      "unread-old",
    ]);
  });
});

function thread(id: string, working: boolean) {
  return {
    id: ThreadId.make(id),
    environmentId,
    createdAt: "2026-06-01T00:00:00.000Z",
    unsettledAt: null,
    latestRun: null,
    hasActionableProposedPlan: false,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    interactionMode: "default" as const,
    runtime: working
      ? {
          status: "running" as const,
          activeRunId: null,
          providerInstanceId: ProviderInstanceId.make("codex"),
          providerName: "Codex",
          lastError: null,
          updatedAt: "2026-06-01T00:00:00.000Z",
        }
      : null,
  };
}

describe("createInboxReturnTracker", () => {
  it("stamps a thread when it stops working, but never on the first observation", () => {
    const tracker = createInboxReturnTracker();
    tracker.observe([thread("a", true), thread("b", false)]);
    expect(tracker.returnedAt(thread("a", true))).toBeUndefined();
    expect(tracker.returnedAt(thread("b", false))).toBeUndefined();

    tracker.observe([thread("a", false), thread("b", false)]);
    expect(tracker.returnedAt(thread("a", false))).toBeDefined();
    expect(tracker.returnedAt(thread("b", false))).toBeUndefined();
  });

  it("forgets deleted threads and resets when the beta turns off", () => {
    const tracker = createInboxReturnTracker();
    tracker.observe([thread("a", true), thread("b", true)]);
    tracker.observe([thread("a", false), thread("b", false)]);
    tracker.observe([thread("b", false)]);
    expect(tracker.returnedAt(thread("a", false))).toBeUndefined();
    expect(tracker.returnedAt(thread("b", false))).toBeDefined();

    tracker.observe(null);
    expect(tracker.returnedAt(thread("b", false))).toBeUndefined();
    tracker.observe([thread("b", true)]);
    tracker.observe([thread("b", false)]);
    expect(tracker.returnedAt(thread("b", false))).toBeDefined();
  });
});

describe("sortWorkingThreadsBySend", () => {
  it("orders by the last message the user sent, not by later runs", () => {
    const sentFirst = {
      ...thread("sent-first", true),
      latestUserAuthoredMessageAt: "2026-06-01T01:00:00.000Z",
      latestRun: {
        runId: RunId.make("run:wake"),
        status: "running" as const,
        requestedAt: "2026-06-01T04:00:00.000Z",
        startedAt: "2026-06-01T04:00:00.000Z",
        completedAt: null,
        assistantMessageId: null,
      },
    };
    const sentLast = {
      ...thread("sent-last", true),
      latestUserAuthoredMessageAt: "2026-06-01T02:00:00.000Z",
    };
    const launched = { ...thread("launched", true), latestUserAuthoredMessageAt: null };
    expect(
      sortWorkingThreadsBySend([launched, sentFirst, sentLast]).map((thread) => thread.id),
    ).toEqual(["sent-last", "sent-first", "launched"]);
  });
});
