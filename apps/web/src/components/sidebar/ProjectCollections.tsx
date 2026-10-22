import { useState, type DragEvent } from "react";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  FolderIcon,
  MoreHorizontalIcon,
  PlusIcon,
} from "lucide-react";
import type { SidebarProjectSnapshot } from "~/sidebarProjectGrouping";
import { useWorkspaceNavigationStore } from "~/workspaceNavigationStore";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
  DialogFooter,
} from "../ui/dialog";
import { Menu, MenuTrigger, MenuPopup, MenuItem, MenuSeparator } from "../ui/menu";

const PROJECT_DRAG = "application/x-t3-collection-project";
const COLLECTION_DRAG = "application/x-t3-collection";

export function ProjectCollections(props: {
  projects: readonly SidebarProjectSnapshot[];
  selectedProjectKey: string | null;
  onProjectSelect: (key: string | null) => void;
  onCollectionSelect: (id: string | null) => void;
}) {
  const state = useWorkspaceNavigationStore();
  const [editing, setEditing] = useState<{ id: string | null; name: string } | null>(null);
  const assigned = new Set(state.collections.flatMap((g) => g.projectKeys));
  const byKey = new Map(props.projects.map((p) => [p.projectKey, p]));
  const drop = (event: DragEvent, id: string | null, overProject?: string) => {
    event.preventDefault();
    event.stopPropagation();
    const project = event.dataTransfer.getData(PROJECT_DRAG),
      collection = event.dataTransfer.getData(COLLECTION_DRAG);
    if (project) {
      const same = state.collections.find((g) => g.id === id)?.projectKeys.includes(project);
      if (same && id && overProject) state.reorderProject(id, project, overProject);
      else state.assignProject(project, id);
    } else if (collection && id) state.reorderCollection(collection, id);
  };
  const canDrop = (event: DragEvent) => {
    if (
      Array.from(event.dataTransfer.types).some((t) => t === PROJECT_DRAG || t === COLLECTION_DRAG)
    )
      event.preventDefault();
  };
  const projectRow = (project: SidebarProjectSnapshot, collectionId: string | null) => {
    const group = state.collections.find((g) => g.id === collectionId);
    const index = group?.projectKeys.indexOf(project.projectKey) ?? -1;
    return (
      <div
        key={project.projectKey}
        className="group/collection-project flex min-w-0 items-center gap-1"
        draggable
        onDragStart={(event) => {
          event.dataTransfer.setData(PROJECT_DRAG, project.projectKey);
          event.dataTransfer.effectAllowed = "move";
        }}
        onDragOver={canDrop}
        onDrop={(event) => drop(event, collectionId, project.projectKey)}
      >
        <button
          type="button"
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-sidebar-row-hover",
            props.selectedProjectKey === project.projectKey &&
              "bg-sidebar-row-hover text-sidebar-foreground",
          )}
          aria-pressed={props.selectedProjectKey === project.projectKey}
          onClick={() => props.onProjectSelect(project.projectKey)}
        >
          <FolderIcon className="size-3.5 shrink-0 text-sidebar-muted-foreground" />
          <span className="truncate">{project.displayName}</span>
        </button>
        <Menu>
          <MenuTrigger
            render={
              <Button
                size="icon-micro"
                variant="ghost-muted"
                aria-label={`Organize ${project.displayName}`}
              />
            }
          >
            <MoreHorizontalIcon className="size-3" />
          </MenuTrigger>
          <MenuPopup align="end">
            {state.collections.map((g) => (
              <MenuItem
                key={g.id}
                disabled={g.id === collectionId}
                onClick={() => state.assignProject(project.projectKey, g.id)}
              >
                Move to {g.name}
              </MenuItem>
            ))}
            <MenuItem
              disabled={collectionId === null}
              onClick={() => state.assignProject(project.projectKey, null)}
            >
              Move to Ungrouped
            </MenuItem>
            {group ? (
              <>
                <MenuSeparator />
                <MenuItem
                  disabled={index <= 0}
                  onClick={() =>
                    state.reorderProject(
                      group.id,
                      project.projectKey,
                      group.projectKeys[index - 1]!,
                    )
                  }
                >
                  Move up
                </MenuItem>
                <MenuItem
                  disabled={index < 0 || index >= group.projectKeys.length - 1}
                  onClick={() =>
                    state.reorderProject(
                      group.id,
                      project.projectKey,
                      group.projectKeys[index + 1]!,
                    )
                  }
                >
                  Move down
                </MenuItem>
              </>
            ) : null}
          </MenuPopup>
        </Menu>
      </div>
    );
  };
  if (!state.collectionsEnabled) return null;
  return (
    <section aria-label="Project collections" className="border-b border-sidebar-border px-2 pb-2">
      <div className="flex items-center justify-between gap-2 py-1">
        <span className="text-2xs font-medium text-sidebar-muted-foreground">Collections</span>
        <Button
          size="icon-xs"
          variant="ghost-muted"
          aria-label="New collection"
          onClick={() => setEditing({ id: null, name: "" })}
        >
          <PlusIcon className="size-3.5" />
        </Button>
      </div>
      <div className="max-h-64 overflow-y-auto overscroll-contain">
        <button
          type="button"
          className="w-full rounded px-2 py-1.5 text-left text-xs hover:bg-sidebar-row-hover"
          aria-pressed={state.selectedCollectionId === null && props.selectedProjectKey === null}
          onClick={() => props.onProjectSelect(null)}
        >
          All projects
        </button>
        {state.collections.map((group, index) => {
          const members = group.projectKeys.flatMap((key) =>
            byKey.has(key) ? [byKey.get(key)!] : [],
          );
          return (
            <div key={group.id} onDragOver={canDrop} onDrop={(event) => drop(event, group.id)}>
              <div
                className="flex items-center gap-1"
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData(COLLECTION_DRAG, group.id);
                  event.dataTransfer.effectAllowed = "move";
                }}
              >
                <button
                  type="button"
                  className="rounded p-1 hover:bg-sidebar-row-hover"
                  aria-label={`${group.collapsed ? "Expand" : "Collapse"} ${group.name}`}
                  aria-expanded={!group.collapsed}
                  onClick={() => state.toggleCollection(group.id)}
                >
                  {group.collapsed ? (
                    <ChevronRightIcon className="size-3.5" />
                  ) : (
                    <ChevronDownIcon className="size-3.5" />
                  )}
                </button>
                <button
                  type="button"
                  className={cn(
                    "min-w-0 flex-1 truncate rounded px-1 py-1.5 text-left text-xs font-medium hover:bg-sidebar-row-hover",
                    state.selectedCollectionId === group.id && "text-primary",
                  )}
                  aria-pressed={state.selectedCollectionId === group.id}
                  onClick={() => props.onCollectionSelect(group.id)}
                >
                  {group.name}{" "}
                  <span className="text-sidebar-muted-foreground">{members.length}</span>
                </button>
                <Menu>
                  <MenuTrigger
                    render={
                      <Button
                        size="icon-micro"
                        variant="ghost-muted"
                        aria-label={`Manage ${group.name}`}
                      />
                    }
                  >
                    <MoreHorizontalIcon className="size-3" />
                  </MenuTrigger>
                  <MenuPopup align="end">
                    <MenuItem onClick={() => setEditing({ id: group.id, name: group.name })}>
                      Rename collection
                    </MenuItem>
                    <MenuItem
                      disabled={index === 0}
                      onClick={() =>
                        state.reorderCollection(group.id, state.collections[index - 1]!.id)
                      }
                    >
                      Move up
                    </MenuItem>
                    <MenuItem
                      disabled={index === state.collections.length - 1}
                      onClick={() =>
                        state.reorderCollection(group.id, state.collections[index + 1]!.id)
                      }
                    >
                      Move down
                    </MenuItem>
                    <MenuSeparator />
                    <MenuItem onClick={() => state.deleteCollection(group.id)}>
                      Delete collection; keep projects
                    </MenuItem>
                  </MenuPopup>
                </Menu>
              </div>
              {!group.collapsed ? (
                <div className="pl-5">
                  {members.map((p) => projectRow(p, group.id))}
                  {members.length === 0 ? (
                    <p className="px-2 py-1 text-2xs text-sidebar-muted-foreground">
                      {group.projectKeys.length > 0
                        ? "Projects unavailable. Reconnect their environments to see them."
                        : "Drop projects here or use their menu."}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
        <div onDragOver={canDrop} onDrop={(event) => drop(event, null)}>
          <p className="px-2 pb-1 pt-3 text-2xs text-sidebar-muted-foreground">Ungrouped</p>
          {props.projects
            .filter((p) => !assigned.has(p.projectKey))
            .map((p) => projectRow(p, null))}
        </div>
      </div>
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Rename collection" : "New collection"}</DialogTitle>
            <DialogDescription>
              Collections organize your project list on this device.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!editing?.name.trim()) return;
              if (editing.id) state.renameCollection(editing.id, editing.name);
              else state.createCollection(editing.name);
              setEditing(null);
            }}
          >
            <DialogPanel>
              <Input
                autoFocus
                aria-label="Collection name"
                value={editing?.name ?? ""}
                maxLength={100}
                onChange={(event) =>
                  setEditing((current) =>
                    current ? { ...current, name: event.target.value } : null,
                  )
                }
              />
            </DialogPanel>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!editing?.name.trim()}>
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogPopup>
      </Dialog>
    </section>
  );
}
