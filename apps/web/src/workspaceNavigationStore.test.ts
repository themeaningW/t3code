import { describe, expect, it } from "vite-plus/test";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { DraftId } from "./composerDraftStore";
import { createMemoryStorage } from "./lib/storage";
import {
  createWorkspaceNavigationStore,
  WORKSPACE_NAVIGATION_STORAGE_KEY,
} from "./workspaceNavigationStore";
import { parseWorkspaceNavigation, workspaceTabKey } from "./workspaceNavigation.logic";

const target = (id: string, environment = "local") => ({
  kind: "server" as const,
  threadRef: scopeThreadRef(EnvironmentId.make(environment), ThreadId.make(id)),
});

describe("project collections", () => {
  it("moves a project between groups and preserves assignments while projects are offline", () => {
    const store = createWorkspaceNavigationStore(createMemoryStorage()),
      s = store.getState;
    const study = s().createCollection("Study")!,
      work = s().createCollection("Work")!;
    s().assignProject("repository-one", study);
    s().assignProject("offline-repository", study);
    s().assignProject("repository-one", work);
    expect(s().collections.find((g) => g.id === study)?.projectKeys).toEqual([
      "offline-repository",
    ]);
    expect(s().collections.find((g) => g.id === work)?.projectKeys).toEqual(["repository-one"]);
    s().assignProject("repository-one", null);
    expect(s().collections.flatMap((g) => g.projectKeys)).toEqual(["offline-repository"]);
  });
  it("deleting a selected group clears its filter and leaves other groups intact", () => {
    const store = createWorkspaceNavigationStore(createMemoryStorage()),
      s = store.getState;
    const a = s().createCollection("A")!,
      b = s().createCollection("B")!;
    s().assignProject("one", a);
    s().assignProject("two", b);
    s().selectCollection(a);
    s().deleteCollection(a);
    expect(s().selectedCollectionId).toBeNull();
    expect(s().collections).toMatchObject([{ id: b, projectKeys: ["two"] }]);
  });
  it("persists group names, order, membership, collapse and selected filter", () => {
    const storage = createMemoryStorage(),
      store = createWorkspaceNavigationStore(storage),
      s = store.getState;
    const a = s().createCollection("A")!,
      b = s().createCollection("B")!;
    s().renameCollection(a, "Research");
    s().assignProject("first", a);
    s().assignProject("second", a);
    s().reorderProject(a, "second", "first");
    s().reorderCollection(b, a);
    s().toggleCollection(a);
    s().selectCollection(a);
    s().setCollectionsEnabled(true);
    const restored = createWorkspaceNavigationStore(storage).getState();
    expect(restored.collectionsEnabled).toBe(true);
    expect(restored.selectedCollectionId).toBe(a);
    expect(restored.collections).toMatchObject([
      { id: b },
      { id: a, name: "Research", collapsed: true, projectKeys: ["second", "first"] },
    ]);
  });
  it("ignores invalid destinations and empty group names", () => {
    const store = createWorkspaceNavigationStore(createMemoryStorage()),
      s = store.getState;
    const a = s().createCollection("A")!;
    s().assignProject("one", a);
    s().assignProject("one", "missing");
    expect(s().collections[0]?.projectKeys).toEqual(["one"]);
    expect(s().createCollection(" ")).toBeNull();
    s().renameCollection(a, " ");
    expect(s().collections[0]?.name).toBe("A");
  });
});

describe("thread tabs", () => {
  it("deduplicates a thread while preserving identical thread ids on different environments", () => {
    const store = createWorkspaceNavigationStore(createMemoryStorage()),
      s = store.getState;
    s().openTab(target("one"), "First");
    s().pinTab(workspaceTabKey(target("one")), true);
    s().openTab(target("one", "remote"), "Remote");
    s().openTab(target("one"), "Renamed");
    expect(s().tabs).toHaveLength(2);
    expect(s().tabs[0]).toMatchObject({ title: "Renamed", pinned: true });
    expect(s().activeTabKey).toBe(workspaceTabKey(target("one")));
  });
  it("closing active and background tabs preserves a usable neighbor and allows reopening", () => {
    const store = createWorkspaceNavigationStore(createMemoryStorage()),
      s = store.getState;
    for (const id of ["a", "b", "c"]) s().openTab(target(id), id);
    s().closeTab(workspaceTabKey(target("b")));
    expect(s().activeTabKey).toBe(workspaceTabKey(target("c")));
    expect(s().closeTab(workspaceTabKey(target("c")))?.key).toBe(workspaceTabKey(target("a")));
    expect(s().reopenTab()?.key).toBe(workspaceTabKey(target("c")));
    expect(s().tabs.map((t) => t.title)).toEqual(["a", "c"]);
  });
  it("preserves pinned tabs when closing others and maintains pinned-first ordering", () => {
    const store = createWorkspaceNavigationStore(createMemoryStorage()),
      s = store.getState;
    for (const id of ["a", "b", "c", "d"]) s().openTab(target(id), id);
    const key = (id: string) => workspaceTabKey(target(id));
    s().pinTab(key("b"), true);
    s().reorderTab(key("d"), key("a"));
    expect(s().tabs.map((t) => t.title)).toEqual(["b", "d", "a", "c"]);
    s().closeOtherTabs(key("d"));
    expect(s().tabs.map((t) => t.title)).toEqual(["b", "d"]);
  });
  it("promotes a draft without duplicating an existing server tab or losing its pin", () => {
    const store = createWorkspaceNavigationStore(createMemoryStorage()),
      s = store.getState;
    const draft = { kind: "draft" as const, draftId: DraftId.make("draft-one") };
    s().openTab(draft, "Draft");
    s().pinTab(workspaceTabKey(draft), true);
    s().openTab(target("one"), "Created");
    s().promoteDraft(draft.draftId, target("one").threadRef, "Sent");
    expect(s().tabs).toHaveLength(1);
    expect(s().tabs[0]).toMatchObject({
      key: workspaceTabKey(target("one")),
      title: "Sent",
      pinned: true,
    });
    expect(s().activeTabKey).toBe(workspaceTabKey(target("one")));
  });
  it("rehydrates open and closed tabs and keeps disabled features' saved layouts", () => {
    const storage = createMemoryStorage(),
      store = createWorkspaceNavigationStore(storage),
      s = store.getState;
    s().setTabsEnabled(true);
    s().openTab(target("a"), "A");
    s().openTab(target("b"), "B");
    s().closeTab(workspaceTabKey(target("a")));
    s().setTabsEnabled(false);
    const restored = createWorkspaceNavigationStore(storage);
    expect(restored.getState().tabsEnabled).toBe(false);
    expect(restored.getState().tabs[0]?.title).toBe("B");
    expect(restored.getState().reopenTab()?.title).toBe("A");
  });
  it("restores fifty tabs without adding conversation or terminal data to navigation storage", () => {
    const storage = createMemoryStorage(),
      store = createWorkspaceNavigationStore(storage);
    for (let i = 0; i < 50; i++) store.getState().openTab(target(String(i)), `Thread ${i}`);
    expect(createWorkspaceNavigationStore(storage).getState().tabs).toHaveLength(50);
    const persisted = storage.getItem(WORKSPACE_NAVIGATION_STORAGE_KEY) as string;
    expect(persisted).not.toContain("messages");
    expect(persisted).not.toContain("terminalId");
  });
});

describe("navigation storage validation", () => {
  it("drops corrupt entries and duplicates while retaining valid offline references", () => {
    const valid = { target: target("one"), key: "untrusted-key", title: "Valid", pinned: false };
    const parsed = parseWorkspaceNavigation({
      tabs: [{}, valid, valid],
      activeTabKey: "missing",
      collections: [
        { id: "a", name: "A", projectKeys: ["offline", "offline"] },
        { id: "b", name: "B", projectKeys: ["offline", "other"] },
      ],
      selectedCollectionId: "missing",
    });
    expect(parsed.tabs).toHaveLength(1);
    expect(parsed.activeTabKey).toBe(workspaceTabKey(valid.target));
    expect(parsed.collections.map((g) => g.projectKeys)).toEqual([["offline"], ["other"]]);
    expect(parsed.selectedCollectionId).toBeNull();
  });
});
