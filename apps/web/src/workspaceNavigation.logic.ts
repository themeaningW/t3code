import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { ScopedThreadRef } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import type { DraftId } from "./composerDraftStore";
import type { ThreadRouteTarget } from "./threadRoutes";

export interface ProjectCollection {
  id: string;
  name: string;
  projectKeys: string[];
  collapsed: boolean;
}

export interface WorkspaceTab {
  key: string;
  target: ThreadRouteTarget;
  title: string;
  pinned: boolean;
}

export interface WorkspaceNavigationData {
  collectionsEnabled: boolean;
  ungroupedCollapsed: boolean;
  collectionsPaneHeight: number | null;
  tabsEnabled: boolean;
  collections: ProjectCollection[];
  selectedCollectionId: string | null;
  tabs: WorkspaceTab[];
  activeTabKey: string | null;
  closedTabs: WorkspaceTab[];
}

export const EMPTY_WORKSPACE_NAVIGATION: WorkspaceNavigationData = {
  collectionsEnabled: false,
  ungroupedCollapsed: false,
  collectionsPaneHeight: null,
  tabsEnabled: false,
  collections: [],
  selectedCollectionId: null,
  tabs: [],
  activeTabKey: null,
  closedTabs: [],
};

export function workspaceTabKey(target: ThreadRouteTarget): string {
  return target.kind === "draft"
    ? `draft:${target.draftId}`
    : `thread:${scopedThreadKey(target.threadRef)}`;
}

export const collectionScopeKey = (id: string) => `\0collection:${id}`;

export function normalizeCollectionsPaneHeight(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(1200, Math.max(64, Math.round(value)))
    : null;
}

const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const text = (value: unknown) => (typeof value === "string" ? value : "");
const isThreadRef = Schema.is(ScopedThreadRef);

function parseTab(value: unknown): WorkspaceTab | null {
  const tab = object(value),
    rawTarget = object(tab?.target);
  if (!tab || !rawTarget) return null;
  const target: ThreadRouteTarget | null =
    rawTarget.kind === "server" && isThreadRef(rawTarget.threadRef)
      ? { kind: "server", threadRef: rawTarget.threadRef }
      : rawTarget.kind === "draft" && text(rawTarget.draftId).length > 0
        ? { kind: "draft", draftId: rawTarget.draftId as DraftId }
        : null;
  return target
    ? {
        key: workspaceTabKey(target),
        target,
        title: text(tab.title).trim() || "Untitled thread",
        pinned: tab.pinned === true,
      }
    : null;
}

export function parseWorkspaceNavigation(value: unknown): WorkspaceNavigationData {
  const raw = object(value) ?? {};
  const groupIds = new Set<string>(),
    assigned = new Set<string>();
  const collections: ProjectCollection[] = [];
  for (const value of Array.isArray(raw.collections) ? raw.collections : []) {
    const group = object(value),
      id = text(group?.id),
      name = text(group?.name).trim();
    if (!id || !name || groupIds.has(id)) continue;
    groupIds.add(id);
    const projectKeys: string[] = [];
    for (const key of Array.isArray(group?.projectKeys) ? group.projectKeys : []) {
      if (typeof key !== "string" || !key || assigned.has(key)) continue;
      assigned.add(key);
      projectKeys.push(key);
    }
    collections.push({ id, name, projectKeys, collapsed: group?.collapsed === true });
  }
  const uniqueTabs = (input: unknown) => {
    const keys = new Set<string>();
    return (Array.isArray(input) ? input : []).flatMap((value) => {
      const tab = parseTab(value);
      if (!tab || keys.has(tab.key)) return [];
      keys.add(tab.key);
      return [tab];
    });
  };
  const tabs = pinFirst(uniqueTabs(raw.tabs));
  return {
    collectionsEnabled: raw.collectionsEnabled === true,
    ungroupedCollapsed: raw.ungroupedCollapsed === true,
    collectionsPaneHeight: normalizeCollectionsPaneHeight(raw.collectionsPaneHeight),
    tabsEnabled: raw.tabsEnabled === true,
    collections,
    selectedCollectionId: groupIds.has(text(raw.selectedCollectionId))
      ? text(raw.selectedCollectionId)
      : null,
    tabs,
    activeTabKey: tabs.some((t) => t.key === raw.activeTabKey)
      ? text(raw.activeTabKey)
      : (tabs[0]?.key ?? null),
    closedTabs: uniqueTabs(raw.closedTabs)
      .filter((t) => !tabs.some((open) => open.key === t.key))
      .slice(-30),
  };
}

export function pinFirst(tabs: readonly WorkspaceTab[]): WorkspaceTab[] {
  return [...tabs.filter((t) => t.pinned), ...tabs.filter((t) => !t.pinned)];
}

export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  if (from < 0 || to < 0 || from >= items.length || to >= items.length || from === to)
    return [...items];
  const next = [...items],
    moved = next.splice(from, 1)[0]!;
  next.splice(to, 0, moved);
  return next;
}

export function assignCollectionProject(
  collections: readonly ProjectCollection[],
  projectKey: string,
  destinationId: string | null,
): ProjectCollection[] {
  if (destinationId !== null && !collections.some((g) => g.id === destinationId))
    return [...collections];
  return collections.map((group) => ({
    ...group,
    projectKeys:
      group.id === destinationId
        ? [...group.projectKeys.filter((key) => key !== projectKey), projectKey]
        : group.projectKeys.filter((key) => key !== projectKey),
  }));
}

export function closeWorkspaceTab(
  data: WorkspaceNavigationData,
  key: string,
): WorkspaceNavigationData {
  const index = data.tabs.findIndex((t) => t.key === key),
    tab = data.tabs[index];
  if (!tab) return data;
  const tabs = data.tabs.filter((t) => t.key !== key);
  return {
    ...data,
    tabs,
    activeTabKey:
      data.activeTabKey === key
        ? (tabs[Math.min(index, tabs.length - 1)]?.key ?? null)
        : data.activeTabKey,
    closedTabs: [...data.closedTabs.filter((t) => t.key !== key), tab].slice(-30),
  };
}
