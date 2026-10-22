import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { ScopedThreadRef } from "@t3tools/contracts";
import type { ThreadRouteTarget } from "./threadRoutes";
import { randomUUID } from "./lib/utils";
import { resolveStorage, type StateStorage } from "./lib/storage";
import {
  assignCollectionProject,
  closeWorkspaceTab,
  EMPTY_WORKSPACE_NAVIGATION,
  moveItem,
  parseWorkspaceNavigation,
  pinFirst,
  workspaceTabKey,
  type WorkspaceNavigationData,
  type WorkspaceTab,
} from "./workspaceNavigation.logic";

export const WORKSPACE_NAVIGATION_STORAGE_KEY = "t3code:workspace-navigation:v1";

interface WorkspaceNavigationStore extends WorkspaceNavigationData {
  setCollectionsEnabled: (enabled: boolean) => void;
  setTabsEnabled: (enabled: boolean) => void;
  createCollection: (name: string) => string | null;
  renameCollection: (id: string, name: string) => void;
  deleteCollection: (id: string) => void;
  selectCollection: (id: string | null) => void;
  toggleCollection: (id: string) => void;
  assignProject: (projectKey: string, id: string | null) => void;
  reorderCollection: (id: string, overId: string) => void;
  reorderProject: (id: string, projectKey: string, overKey: string) => void;
  openTab: (target: ThreadRouteTarget, title: string) => void;
  closeTab: (key: string) => WorkspaceTab | null;
  reopenTab: () => WorkspaceTab | null;
  pinTab: (key: string, pinned: boolean) => void;
  reorderTab: (key: string, overKey: string) => void;
  closeOtherTabs: (key: string) => void;
  promoteDraft: (draftId: string, ref: ScopedThreadRef, title: string) => void;
}

export function createWorkspaceNavigationStore(storage?: StateStorage) {
  return create<WorkspaceNavigationStore>()(
    persist(
      (set, get) => ({
        ...EMPTY_WORKSPACE_NAVIGATION,
        setCollectionsEnabled: (enabled) => set({ collectionsEnabled: enabled }),
        setTabsEnabled: (enabled) => set({ tabsEnabled: enabled }),
        createCollection: (name) => {
          if (!name.trim()) return null;
          const id = randomUUID();
          set((s) => ({
            collections: [
              ...s.collections,
              { id, name: name.trim(), projectKeys: [], collapsed: false },
            ],
          }));
          return id;
        },
        renameCollection: (id, name) => {
          if (name.trim())
            set((s) => ({
              collections: s.collections.map((g) =>
                g.id === id ? { ...g, name: name.trim() } : g,
              ),
            }));
        },
        deleteCollection: (id) =>
          set((s) => ({
            collections: s.collections.filter((g) => g.id !== id),
            selectedCollectionId: s.selectedCollectionId === id ? null : s.selectedCollectionId,
          })),
        selectCollection: (id) =>
          set((s) => ({
            selectedCollectionId: id !== null && s.collections.some((g) => g.id === id) ? id : null,
          })),
        toggleCollection: (id) =>
          set((s) => ({
            collections: s.collections.map((g) =>
              g.id === id ? { ...g, collapsed: !g.collapsed } : g,
            ),
          })),
        assignProject: (key, id) =>
          set((s) => ({ collections: assignCollectionProject(s.collections, key, id) })),
        reorderCollection: (id, overId) =>
          set((s) => ({
            collections: moveItem(
              s.collections,
              s.collections.findIndex((g) => g.id === id),
              s.collections.findIndex((g) => g.id === overId),
            ),
          })),
        reorderProject: (id, key, overKey) =>
          set((s) => ({
            collections: s.collections.map((g) =>
              g.id === id
                ? {
                    ...g,
                    projectKeys: moveItem(
                      g.projectKeys,
                      g.projectKeys.indexOf(key),
                      g.projectKeys.indexOf(overKey),
                    ),
                  }
                : g,
            ),
          })),
        openTab: (target, title) =>
          set((s) => {
            const key = workspaceTabKey(target),
              existing = s.tabs.find((t) => t.key === key);
            if (existing && existing.title === title && s.activeTabKey === key) return s;
            const tab: WorkspaceTab = {
              key,
              target,
              title: title || "Untitled thread",
              pinned: existing?.pinned ?? false,
            };
            return {
              tabs: existing
                ? s.tabs.map((t) => (t.key === key ? tab : t))
                : pinFirst([...s.tabs, tab]),
              activeTabKey: key,
              closedTabs: s.closedTabs.filter((t) => t.key !== key),
            };
          }),
        closeTab: (key) => {
          set((s) => closeWorkspaceTab(s, key));
          return get().tabs.find((t) => t.key === get().activeTabKey) ?? null;
        },
        reopenTab: () => {
          const tab = get().closedTabs.at(-1);
          if (!tab) return null;
          set((s) => ({
            tabs: pinFirst([...s.tabs.filter((t) => t.key !== tab.key), tab]),
            activeTabKey: tab.key,
            closedTabs: s.closedTabs.slice(0, -1),
          }));
          return tab;
        },
        pinTab: (key, pinned) =>
          set((s) => ({
            tabs: pinFirst(s.tabs.map((t) => (t.key === key ? { ...t, pinned } : t))),
          })),
        reorderTab: (key, overKey) =>
          set((s) => ({
            tabs: pinFirst(
              moveItem(
                s.tabs,
                s.tabs.findIndex((t) => t.key === key),
                s.tabs.findIndex((t) => t.key === overKey),
              ),
            ),
          })),
        closeOtherTabs: (key) =>
          set((s) => {
            if (!s.tabs.some((t) => t.key === key)) return s;
            const keep = s.tabs.filter((t) => t.key === key || t.pinned),
              close = s.tabs.filter((t) => t.key !== key && !t.pinned);
            return {
              tabs: keep,
              activeTabKey: keep.some((t) => t.key === s.activeTabKey) ? s.activeTabKey : key,
              closedTabs: [...s.closedTabs, ...close].slice(-30),
            };
          }),
        promoteDraft: (draftId, threadRef, title) =>
          set((s) => {
            const oldKey = `draft:${draftId}`,
              draft = s.tabs.find((t) => t.key === oldKey);
            if (!draft) return s;
            const target: ThreadRouteTarget = { kind: "server", threadRef },
              key = workspaceTabKey(target);
            const already = s.tabs.find((t) => t.key === key);
            return {
              tabs: pinFirst(
                s.tabs
                  .filter((t) => t.key !== key)
                  .map((t) =>
                    t.key === oldKey
                      ? {
                          ...t,
                          key,
                          target,
                          title,
                          pinned: draft.pinned || (already?.pinned ?? false),
                        }
                      : t,
                  ),
              ),
              activeTabKey: s.activeTabKey === oldKey ? key : s.activeTabKey,
              closedTabs: s.closedTabs.filter((t) => t.key !== oldKey),
            };
          }),
      }),
      {
        name: WORKSPACE_NAVIGATION_STORAGE_KEY,
        version: 1,
        storage: createJSONStorage(() =>
          resolveStorage(
            storage ?? (typeof window !== "undefined" ? window.localStorage : undefined),
          ),
        ),
        partialize: (state) => ({
          collectionsEnabled: state.collectionsEnabled,
          tabsEnabled: state.tabsEnabled,
          collections: state.collections,
          selectedCollectionId: state.selectedCollectionId,
          tabs: state.tabs,
          activeTabKey: state.activeTabKey,
          closedTabs: state.closedTabs,
        }),
        merge: (persisted, current) => ({ ...current, ...parseWorkspaceNavigation(persisted) }),
        migrate: parseWorkspaceNavigation,
      },
    ),
  );
}

export const useWorkspaceNavigationStore = createWorkspaceNavigationStore();
