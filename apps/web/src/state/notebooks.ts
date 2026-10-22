import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "@t3tools/client-runtime/state/runtime";
import { WS_METHODS } from "@t3tools/contracts";
import { connectionAtomRuntime } from "../connection/runtime";

export const notebookStatus = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "notebooks:status",
  tag: WS_METHODS.notebooksStatus,
  staleTimeMs: 0,
  idleTtlMs: 5_000,
});
export const notebookExecute = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "notebooks:execute",
  tag: WS_METHODS.notebooksExecute,
});
export const notebookInterrupt = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "notebooks:interrupt",
  tag: WS_METHODS.notebooksInterrupt,
});
export const notebookRestart = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "notebooks:restart",
  tag: WS_METHODS.notebooksRestart,
});
