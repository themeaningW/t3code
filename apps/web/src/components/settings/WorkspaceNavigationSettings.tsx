import { useWorkspaceNavigationStore } from "~/workspaceNavigationStore";
import { Switch } from "../ui/switch";
import { SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

export function WorkspaceNavigationSettings() {
  const state = useWorkspaceNavigationStore();
  return (
    <>
      <SettingsRow
        {...searchableSetting("project-collections")}
        description="Organize projects into named collections. Saved on this device; project sorting stays independent."
        control={
          <Switch
            checked={state.collectionsEnabled}
            onCheckedChange={state.setCollectionsEnabled}
            aria-label="Project collections"
          />
        }
      />
      <SettingsRow
        {...searchableSetting("thread-tabs")}
        description="Keep threads from different environments in a tab strip. Closing a tab leaves its agent running. Saved on this device."
        control={
          <Switch
            checked={state.tabsEnabled}
            onCheckedChange={state.setTabsEnabled}
            aria-label="Thread tabs"
          />
        }
      />
    </>
  );
}
