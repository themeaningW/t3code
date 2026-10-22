import {
  NotebookExecuteInput,
  NotebookTarget,
  NotebookExecutionState,
  NotebookExecutionFailure,
  OrchestratorMcpFailure,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import { NotebookExecution } from "../../../notebooks/NotebookExecution.ts";
import { ThreadManagementService } from "../../../orchestration-v2/ThreadManagementService.ts";
import { McpInvocationContext } from "../../McpInvocationContext.ts";

const shared = {
  success: NotebookExecutionState,
  failure: Schema.Union([NotebookExecutionFailure, OrchestratorMcpFailure]),
  failureMode: "return" as const,
  dependencies: [NotebookExecution, ThreadManagementService, McpInvocationContext],
};
export const NotebookToolkit = Toolkit.make(
  Tool.make("notebook_execute", {
    ...shared,
    parameters: NotebookExecuteInput,
    description:
      "Execute a saved .ipynb code cell (zero-based cellIndex) or all code cells (omit cellIndex). Uses the same persistent Python kernel as the T3 notebook panel, sharing variables. Returns immediately; poll notebook_status until finished. Saves outputs/counts to the notebook unless its source changed during execution. Requires full access. Never runs arbitrary unsaved source. cwd is the absolute workspace root, relativePath is relative to that root. The kernel survives closing the panel but not restarting T3.",
  }),
  Tool.make("notebook_status", {
    ...shared,
    parameters: NotebookTarget,
    description:
      "Read shared notebook kernel status and latest execution results, including errors, plots, save status and warnings. Uses the same cwd/relativePath as notebook_execute and the T3 panel.",
  }).annotate(Tool.Readonly, true),
  Tool.make("notebook_interrupt", {
    ...shared,
    parameters: NotebookTarget,
    description:
      "Interrupt running notebook execution. Keeps the same kernel and existing variables. Poll notebook_status for completion. Requires full access.",
  }),
  Tool.make("notebook_restart", {
    ...shared,
    parameters: NotebookTarget,
    description:
      "Shut down the notebook kernel and clear its variables. The next execution starts a fresh kernel. Stop running execution first. Saved notebook outputs are retained. Requires full access.",
  }),
);
