import { threadRuntimeIsActive, type EnvironmentThreadShell } from "./models.ts";
import { sortActiveThreadsByOrderKey, toSortableTimestamp } from "./threadSort.ts";
import type { SidebarInboxSortOrder } from "@t3tools/contracts/settings";

export const SIDEBAR_INBOX_SORT_OPTIONS = [
  { value: "default", label: "Default" },
  { value: "unread_completion", label: "Unread first, latest completion" },
  { value: "completion_desc", label: "Latest completion" },
  { value: "created_desc", label: "Newest created" },
  { value: "created_asc", label: "Oldest created" },
  { value: "title_asc", label: "Title: A–Z" },
  { value: "title_desc", label: "Title: Z–A" },
  { value: "manual", label: "Manual (drag to reorder)" },
] as const satisfies ReadonlyArray<{ value: SidebarInboxSortOrder; label: string }>;

export function resolveSidebarInboxSortOrder(input: {
  readonly overrides: Readonly<Record<string, SidebarInboxSortOrder>>;
  readonly projectScopeKey: string | null;
  readonly unreadCompletionOrderEnabled: boolean;
}): SidebarInboxSortOrder {
  return (
    input.overrides[JSON.stringify(input.projectScopeKey)] ??
    (input.projectScopeKey === null && input.unreadCompletionOrderEnabled
      ? "unread_completion"
      : "default")
  );
}

type SortableInboxThread = InboxThreadInput &
  Pick<EnvironmentThreadShell, "title" | "activeOrderKey">;

/** Explicit modes take precedence over the default inbox/working-shelf order. */
export function sortSidebarInboxThreads<T extends SortableInboxThread>(
  threads: readonly T[],
  mode: Exclude<SidebarInboxSortOrder, "default">,
  isUnread: (thread: T) => boolean,
  observedReturnAt?: (thread: T) => number | undefined,
): T[] {
  if (mode === "manual") return sortActiveThreadsByOrderKey(threads);
  if (mode === "unread_completion" || mode === "completion_desc") {
    return sortUnreadInboxThreadsByReturn(
      threads,
      mode === "unread_completion" ? isUnread : () => false,
      observedReturnAt,
    );
  }
  const titles = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  return [...threads].sort((left, right) => {
    const order =
      mode === "title_asc" || mode === "title_desc"
        ? titles.compare(left.title, right.title) * (mode === "title_desc" ? -1 : 1)
        : ((toSortableTimestamp(left.createdAt) ?? 0) -
            (toSortableTimestamp(right.createdAt) ?? 0)) *
          (mode === "created_desc" ? -1 : 1);
    return (
      order ||
      left.id.localeCompare(right.id) ||
      left.environmentId.localeCompare(right.environmentId)
    );
  });
}

type WorkingThreadInput = Pick<
  EnvironmentThreadShell,
  | "hasActionableProposedPlan"
  | "hasPendingApprovals"
  | "hasPendingUserInput"
  | "pendingSubagentRequest"
  | "interactionMode"
  | "latestRun"
  | "runtime"
>;

export function isThreadWorking(thread: WorkingThreadInput): boolean {
  if (thread.hasPendingApprovals || thread.hasPendingUserInput) return false;
  if (thread.pendingSubagentRequest != null) return false;
  if (!threadRuntimeIsActive(thread.runtime) && thread.runtime?.status !== "idle") return false;
  const run = thread.latestRun;
  const runSettled =
    run !== null &&
    run.status !== "preparing" &&
    run.status !== "queued" &&
    run.status !== "starting" &&
    run.status !== "running" &&
    run.status !== "waiting" &&
    thread.runtime?.activeRunId !== run.runId;
  return !(thread.interactionMode === "plan" && thread.hasActionableProposedPlan && runSettled);
}

type InboxThreadInput = Pick<
  EnvironmentThreadShell,
  "id" | "environmentId" | "createdAt" | "unsettledAt" | "latestRun"
>;

export function sortInboxThreadsByReturn<T extends InboxThreadInput>(
  threads: readonly T[],
  observedReturnAt?: (thread: T) => number | undefined,
): T[] {
  const timestamps = new Map(
    threads.map((thread) => [
      thread,
      Math.max(
        toSortableTimestamp(thread.createdAt) ?? 0,
        toSortableTimestamp(thread.unsettledAt ?? undefined) ?? 0,
        toSortableTimestamp(thread.latestRun?.requestedAt ?? undefined) ?? 0,
        toSortableTimestamp(thread.latestRun?.completedAt ?? undefined) ?? 0,
        observedReturnAt?.(thread) ?? 0,
      ),
    ]),
  );
  return sortNewestFirst(threads, timestamps);
}

type WorkingSortInput = Pick<
  EnvironmentThreadShell,
  "id" | "environmentId" | "createdAt" | "latestRun" | "latestUserAuthoredMessageAt"
>;

export function sortUnreadInboxThreadsByReturn<T extends InboxThreadInput>(
  threads: readonly T[],
  isUnread: (thread: T) => boolean,
  observedReturnAt?: (thread: T) => number | undefined,
): T[] {
  const timestamps = new Map(
    threads.map((thread) => [
      thread,
      toSortableTimestamp(thread.latestRun?.completedAt ?? undefined) ??
        observedReturnAt?.(thread) ??
        toSortableTimestamp(thread.latestRun?.requestedAt ?? undefined) ??
        toSortableTimestamp(thread.createdAt) ??
        0,
    ]),
  );
  const ordered = sortNewestFirst(threads, timestamps);
  const unread = ordered.filter(isUnread);
  const read = ordered.filter((thread) => !isUnread(thread));
  return [...unread, ...read];
}

export function sortWorkingThreadsBySend<T extends WorkingSortInput>(threads: readonly T[]): T[] {
  const timestamps = new Map(
    threads.map((thread) => [
      thread,
      Math.max(
        toSortableTimestamp(thread.createdAt) ?? 0,
        toSortableTimestamp(
          (thread.latestUserAuthoredMessageAt === undefined
            ? thread.latestRun?.requestedAt
            : thread.latestUserAuthoredMessageAt) ?? undefined,
        ) ?? 0,
      ),
    ]),
  );
  return sortNewestFirst(threads, timestamps);
}

function sortNewestFirst<T extends Pick<EnvironmentThreadShell, "id" | "environmentId">>(
  threads: readonly T[],
  timestamps: ReadonlyMap<T, number>,
): T[] {
  return [...threads].sort(
    (left, right) =>
      timestamps.get(right)! - timestamps.get(left)! ||
      left.id.localeCompare(right.id) ||
      left.environmentId.localeCompare(right.environmentId),
  );
}

/**
 * Keep one at module scope so the inbox order survives routes that unmount the
 * list. Call `observe` with every thread shell on each list rebuild, or with
 * null to reset while the beta is off.
 */
export function createInboxReturnTracker() {
  const keyOf = (thread: Pick<EnvironmentThreadShell, "environmentId" | "id">) =>
    `${thread.environmentId}:${thread.id}`;
  let lastWorkingKeys: ReadonlySet<string> | null = null;
  const returns = new Map<string, number>();
  return {
    observe(threads: ReadonlyArray<WorkingThreadInput & InboxThreadInput> | null): void {
      if (threads === null) {
        lastWorkingKeys = null;
        returns.clear();
        return;
      }
      const working = new Set<string>();
      const present = new Set<string>();
      for (const thread of threads) {
        const key = keyOf(thread);
        present.add(key);
        if (isThreadWorking(thread)) working.add(key);
      }
      for (const key of returns.keys()) {
        if (!present.has(key)) returns.delete(key);
      }
      // @effect-diagnostics-next-line globalDate:off
      const at = Date.now();
      for (const key of lastWorkingKeys ?? []) {
        if (present.has(key) && !working.has(key)) returns.set(key, at);
      }
      lastWorkingKeys = working;
    },
    returnedAt: (thread: Pick<EnvironmentThreadShell, "environmentId" | "id">) =>
      returns.get(keyOf(thread)),
  };
}
