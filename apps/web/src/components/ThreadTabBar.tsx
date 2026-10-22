import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useParams, useRouter } from "@tanstack/react-router";
import { closestCenter, DndContext, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { horizontalListSortingStrategy, SortableContext, useSortable } from "@dnd-kit/sortable";
import { restrictToHorizontalAxis, restrictToFirstScrollableAncestor } from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";
import { ListFilterIcon, MoreHorizontalIcon, PinIcon, PlusIcon, XIcon } from "lucide-react";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { isThreadWorking } from "@t3tools/client-runtime/state/thread-inbox";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { isElectron } from "~/env";
import { cn } from "~/lib/utils";
import { isTerminalFocused } from "~/lib/terminalFocus";
import { isModelPickerOpen } from "~/modelPickerVisibility";
import { isCommandPaletteOpen } from "~/commandPaletteBus";
import { useProjects, useThreadShells } from "~/state/entities";
import { useConnectedEnvironmentIds, useEnvironmentIdentities } from "~/state/environments";
import { useWorkspaceNavigationStore } from "~/workspaceNavigationStore";
import { workspaceTabKey, type WorkspaceTab } from "~/workspaceNavigation.logic";
import { useComposerDraftStore } from "~/composerDraftStore";
import {
  buildDraftThreadRouteParams,
  buildThreadRouteParams,
  resolveThreadRouteTarget,
} from "~/threadRoutes";
import { useHandleNewThread } from "~/hooks/useHandleNewThread";
import { startNewThreadFromContext } from "~/lib/chatThreadActions";
import { useUiStateStore } from "~/uiStateStore";
import { hasUnseenCompletion, resolveThreadLastVisitedAt } from "./Sidebar.logic";
import { WorkspacePageHeader } from "./WorkspacePageHeader";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "./ui/menu";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
} from "./ui/dialog";

type TabPresentation = {
  title: string;
  subtitle: string;
  environmentId: string | null;
  status: string;
  statusColor: string;
};

function SortableThreadTab(props: {
  tab: WorkspaceTab;
  presentation: TabPresentation;
  active: boolean;
  focusable: boolean;
  onSelect: () => void;
  onClose: () => void;
  onKeyDown: (event: ReactKeyboardEvent) => void;
}) {
  const { tab, presentation } = props;
  const { setNodeRef, setActivatorNodeRef, listeners, transform, transition, isDragging } =
    useSortable({ id: tab.key });
  const state = useWorkspaceNavigationStore();
  const index = state.tabs.findIndex((t) => t.key === tab.key);
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "group/thread-tab relative flex w-48 shrink-0 items-center rounded-md border border-transparent pr-1 [-webkit-app-region:no-drag]",
        props.active ? "border-border bg-muted/60" : "hover:bg-muted/40",
        isDragging && "z-10 bg-background",
      )}
      onAuxClick={(event) => {
        if (event.button === 1) {
          event.preventDefault();
          props.onClose();
        }
      }}
    >
      <button
        ref={setActivatorNodeRef}
        {...listeners}
        type="button"
        role="tab"
        aria-selected={props.active}
        aria-controls="thread-tab-active-view"
        tabIndex={props.focusable ? 0 : -1}
        className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-2 py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        aria-label={`${presentation.title}, ${presentation.subtitle}, ${presentation.status}`}
        onClick={props.onSelect}
        onKeyDown={props.onKeyDown}
      >
        {tab.pinned ? <PinIcon className="size-3 shrink-0 text-muted-foreground" /> : null}
        <span
          aria-hidden
          className={cn("size-1.5 shrink-0 rounded-full", presentation.statusColor)}
        />
        <span className="min-w-0">
          <span className="block truncate text-xs">{presentation.title}</span>
          <span className="block truncate text-3xs text-muted-foreground">
            {presentation.subtitle}
          </span>
        </span>
        <span className="sr-only">{presentation.status}</span>
      </button>
      <Menu>
        <MenuTrigger
          render={
            <Button
              size="icon-micro"
              variant="ghost-muted"
              aria-label={`Tab options for ${presentation.title}`}
            />
          }
        >
          <MoreHorizontalIcon className="size-3" />
        </MenuTrigger>
        <MenuPopup align="end">
          <MenuItem onClick={() => state.pinTab(tab.key, !tab.pinned)}>
            {tab.pinned ? "Unpin tab" : "Pin tab"}
          </MenuItem>
          <MenuItem
            disabled={index <= 0 || state.tabs[index - 1]?.pinned !== tab.pinned}
            onClick={() => state.reorderTab(tab.key, state.tabs[index - 1]!.key)}
          >
            Move left
          </MenuItem>
          <MenuItem
            disabled={
              index >= state.tabs.length - 1 || state.tabs[index + 1]?.pinned !== tab.pinned
            }
            onClick={() => state.reorderTab(tab.key, state.tabs[index + 1]!.key)}
          >
            Move right
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            onClick={() => {
              state.closeOtherTabs(tab.key);
              props.onSelect();
            }}
          >
            Close other unpinned tabs
          </MenuItem>
          <MenuItem onClick={props.onClose}>Close tab</MenuItem>
        </MenuPopup>
      </Menu>
      <button
        type="button"
        aria-label={`Close tab ${presentation.title}`}
        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        onClick={props.onClose}
      >
        <XIcon className="size-3" />
      </button>
    </div>
  );
}

function EnabledThreadTabBar() {
  const state = useWorkspaceNavigationStore();
  const { openTab, closeTab, promoteDraft } = state;
  const router = useRouter();
  const { environmentId, threadId, draftId } = useParams({ strict: false });
  const target = useMemo(
    () => resolveThreadRouteTarget({ environmentId, threadId, draftId }),
    [environmentId, threadId, draftId],
  );
  const threads = useThreadShells(),
    projects = useProjects();
  const environments = useEnvironmentIdentities(),
    connectedIds = useConnectedEnvironmentIds();
  const visits = useUiStateStore((s) => s.threadLastVisitedAtById);
  const draftSessions = useComposerDraftStore((s) => s.draftThreadsByThreadKey);
  const { activeDraftThread, activeThread, defaultProjectRef, handleNewThread } =
    useHandleNewThread();
  const [managerOpen, setManagerOpen] = useState(false),
    [query, setQuery] = useState(""),
    [environmentFilter, setEnvironmentFilter] = useState("all");
  const scroller = useRef<HTMLDivElement>(null);
  const closedRoute = useRef<string | null>(null);
  const focusSelectedTab = useRef(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const byThread = useMemo(
    () =>
      new Map(
        threads.map((t) => [
          scopedThreadKey({ environmentId: t.environmentId, threadId: t.id }),
          t,
        ]),
      ),
    [threads],
  );
  const byProject = useMemo(
    () => new Map(projects.map((p) => [`${p.environmentId}:${p.id}`, p.title])),
    [projects],
  );
  const byEnvironment = useMemo(
    () => new Map(environments.map((e) => [e.environmentId, e.label])),
    [environments],
  );
  const connected = useMemo(() => new Set(connectedIds), [connectedIds]);
  const routeKey = target ? workspaceTabKey(target) : null;
  const routeThread =
    target?.kind === "server" ? byThread.get(scopedThreadKey(target.threadRef)) : null;
  const cachedTitle = state.tabs.find((t) => t.key === routeKey)?.title;
  const routeTitle =
    target?.kind === "draft" ? "New thread" : (routeThread?.title ?? cachedTitle ?? "Thread");

  useEffect(() => {
    for (const [draftId, session] of Object.entries(draftSessions)) {
      if (
        session.promotedTo &&
        useWorkspaceNavigationStore.getState().tabs.some((tab) => tab.key === `draft:${draftId}`)
      ) {
        const thread = byThread.get(scopedThreadKey(session.promotedTo));
        promoteDraft(draftId, session.promotedTo, thread?.title ?? "Thread");
      }
    }
  }, [draftSessions, byThread, promoteDraft]);
  useEffect(() => {
    if (closedRoute.current === routeKey) return;
    closedRoute.current = null;
    if (target) openTab(target, routeTitle);
  }, [target, routeKey, routeTitle, openTab]);
  useEffect(() => {
    if (!routeKey) return;
    const selected = scroller.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]');
    selected?.scrollIntoView({ block: "nearest", inline: "nearest" });
    if (focusSelectedTab.current) selected?.focus();
    focusSelectedTab.current = false;
  }, [routeKey]);

  const navigate = useCallback(
    (tab: WorkspaceTab) => {
      openTab(tab.target, tab.title);
      setManagerOpen(false);
      if (tab.target.kind === "server")
        void router.navigate({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams(tab.target.threadRef),
        });
      else
        void router.navigate({
          to: "/draft/$draftId",
          params: buildDraftThreadRouteParams(tab.target.draftId),
        });
    },
    [router, openTab],
  );
  const close = useCallback(
    (key: string) => {
      // Navigation can lag the store update, especially for an offline thread.
      if (key === routeKey) closedRoute.current = key;
      const next = closeTab(key);
      if (key === routeKey) {
        if (next) navigate(next);
        else void router.navigate({ to: "/" });
      }
    },
    [closeTab, routeKey, navigate, router],
  );
  const cycle = useCallback(
    (direction: number) => {
      if (state.tabs.length === 0) return;
      const index = state.tabs.findIndex((t) => t.key === routeKey);
      const nextIndex =
        index < 0
          ? direction > 0
            ? 0
            : state.tabs.length - 1
          : (index + direction + state.tabs.length) % state.tabs.length;
      const next = state.tabs[nextIndex];
      if (next) navigate(next);
    },
    [state.tabs, routeKey, navigate],
  );
  useEffect(() => {
    if (!isElectron) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        managerOpen ||
        isTerminalFocused() ||
        isModelPickerOpen() ||
        isCommandPaletteOpen()
      )
        return;
      if (event.ctrlKey && !event.altKey && !event.metaKey && event.key === "Tab") {
        event.preventDefault();
        cycle(event.shiftKey ? -1 : 1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cycle, managerOpen]);
  const presentation = (tab: WorkspaceTab): TabPresentation => {
    if (tab.target.kind === "draft") {
      const session = draftSessions[tab.target.draftId];
      return {
        title: tab.title,
        subtitle: session
          ? `${byProject.get(`${session.environmentId}:${session.projectId}`) ?? "New thread"} · ${byEnvironment.get(session.environmentId) ?? "Environment"}`
          : "Draft",
        environmentId: session?.environmentId ?? null,
        status: "Draft",
        statusColor: "bg-muted-foreground",
      };
    }
    const ref = tab.target.threadRef,
      thread: EnvironmentThreadShell | undefined = byThread.get(scopedThreadKey(ref));
    const label = byEnvironment.get(ref.environmentId) ?? ref.environmentId;
    const status = !connected.has(ref.environmentId)
      ? "Offline"
      : !thread
        ? "Unavailable"
        : thread.hasPendingApprovals || thread.hasPendingUserInput
          ? "Needs you"
          : isThreadWorking(thread)
            ? "Working"
            : hasUnseenCompletion({
                  ...thread,
                  lastVisitedAt: resolveThreadLastVisitedAt(
                    thread.lastVisitedAt,
                    visits[scopedThreadKey(ref)],
                  ),
                })
              ? "Unread"
              : "Ready";
    return {
      title: thread?.title ?? tab.title,
      subtitle: thread
        ? `${byProject.get(`${ref.environmentId}:${thread.projectId}`) ?? "No project"} · ${label}`
        : label,
      environmentId: ref.environmentId,
      status,
      statusColor:
        status === "Needs you"
          ? "bg-warning"
          : status === "Working"
            ? "bg-info"
            : status === "Unread"
              ? "bg-primary"
              : "bg-muted-foreground",
    };
  };
  const filterText = query.trim().toLocaleLowerCase();
  const visible = state.tabs.filter((tab) => {
    const p = presentation(tab);
    return (
      (environmentFilter === "all" || p.environmentId === environmentFilter) &&
      `${p.title} ${p.subtitle}`.toLocaleLowerCase().includes(filterText)
    );
  });
  const reopen = () => {
    const tab = state.reopenTab();
    if (tab) navigate(tab);
  };
  const keyboard = (event: ReactKeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      focusSelectedTab.current = true;
      cycle(event.key === "ArrowRight" ? 1 : -1);
    } else if (event.key === "Delete" && routeKey) {
      event.preventDefault();
      close(routeKey);
    }
  };
  return (
    <>
      <WorkspacePageHeader
        reserveNativeControls={isElectron}
        className="relative z-20 gap-1 border-b px-2 [-webkit-app-region:no-drag]"
      >
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToHorizontalAxis, restrictToFirstScrollableAncestor]}
          onDragEnd={({ active, over }) => {
            if (over) state.reorderTab(String(active.id), String(over.id));
          }}
        >
          <SortableContext
            items={state.tabs.map((t) => t.key)}
            strategy={horizontalListSortingStrategy}
          >
            <div
              ref={scroller}
              role="tablist"
              aria-label="Thread tabs"
              className="flex min-w-0 flex-1 gap-1 overflow-x-auto [-webkit-app-region:no-drag] [scrollbar-width:none]"
            >
              {state.tabs.map((tab) => (
                <SortableThreadTab
                  key={tab.key}
                  tab={tab}
                  presentation={presentation(tab)}
                  active={routeKey === tab.key}
                  focusable={
                    routeKey === tab.key || (routeKey === null && state.tabs[0]?.key === tab.key)
                  }
                  onSelect={() => navigate(tab)}
                  onClose={() => close(tab.key)}
                  onKeyDown={keyboard}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
        {/* Chat panel controls occupy the fixed titlebar area at the right. */}
        <div className="mr-36 flex shrink-0 items-center gap-1 [-webkit-app-region:no-drag]">
          <Button
            size="icon-sm"
            variant="ghost-muted"
            aria-label="New thread tab"
            onClick={() =>
              void startNewThreadFromContext({
                activeDraftThread,
                activeThread: activeThread ?? undefined,
                defaultProjectRef,
                handleNewThread,
              })
            }
          >
            <PlusIcon className="size-4" />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost-muted"
            aria-label="Manage thread tabs"
            onClick={() => setManagerOpen(true)}
          >
            <ListFilterIcon className="size-4" />
          </Button>
        </div>
      </WorkspacePageHeader>
      <Dialog open={managerOpen} onOpenChange={setManagerOpen}>
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Thread tabs</DialogTitle>
            <DialogDescription>
              Find a tab by thread, project or environment. Closing a tab keeps its agent running.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <Input
              autoFocus
              type="search"
              aria-label="Search open thread tabs"
              placeholder="Search open tabs"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <label className="flex items-center gap-2 text-xs">
              Environment{" "}
              <select
                className="min-w-0 flex-1 rounded border bg-background px-2 py-1.5"
                value={environmentFilter}
                onChange={(event) => setEnvironmentFilter(event.target.value)}
              >
                <option value="all">All environments</option>
                {environments.map((e) => (
                  <option key={e.environmentId} value={e.environmentId}>
                    {e.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="max-h-80 space-y-1 overflow-y-auto">
              {visible.map((tab) => {
                const p = presentation(tab);
                return (
                  <div key={tab.key} className="flex items-center gap-2">
                    <button
                      type="button"
                      className="min-w-0 flex-1 rounded px-2 py-2 text-left hover:bg-muted"
                      onClick={() => navigate(tab)}
                    >
                      <span className="block truncate text-sm">
                        {tab.pinned ? "Pinned · " : ""}
                        {p.title}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {p.subtitle} · {p.status}
                      </span>
                    </button>
                    <Button
                      size="icon-sm"
                      variant="ghost-muted"
                      aria-label={`Close tab ${p.title}`}
                      onClick={() => close(tab.key)}
                    >
                      <XIcon className="size-3.5" />
                    </Button>
                  </div>
                );
              })}
              {visible.length === 0 ? (
                <p className="text-sm text-muted-foreground">No matching tabs.</p>
              ) : null}
            </div>
            <Button variant="outline" disabled={state.closedTabs.length === 0} onClick={reopen}>
              Reopen last closed thread tab
            </Button>
          </DialogPanel>
        </DialogPopup>
      </Dialog>
    </>
  );
}

export function ThreadTabBar() {
  const enabled = useWorkspaceNavigationStore((s) => s.tabsEnabled);
  return enabled ? <EnabledThreadTabBar /> : null;
}
