import * as Schema from "effect/Schema";
import { NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const NotebookTarget = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: TrimmedNonEmptyString,
});
export const NotebookExecuteInput = Schema.Struct({
  ...NotebookTarget.fields,
  cellIndex: Schema.optionalKey(NonNegativeInt),
  kernelName: Schema.optionalKey(TrimmedNonEmptyString),
  expectedContents: Schema.optionalKey(Schema.String),
});
export type NotebookExecuteInput = typeof NotebookExecuteInput.Type;
export type NotebookTarget = typeof NotebookTarget.Type;
export const NotebookCellResult = Schema.Struct({
  cellIndex: NonNegativeInt,
  executionCount: Schema.NullOr(NonNegativeInt),
  outputs: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)),
});
export const NotebookExecutionState = Schema.Struct({
  status: Schema.Literals(["idle", "running", "completed", "error"]),
  kernelName: Schema.String,
  kernelId: Schema.NullOr(Schema.String),
  activeCell: Schema.NullOr(NonNegativeInt),
  runId: Schema.NullOr(Schema.String),
  results: Schema.Array(NotebookCellResult),
  kernels: Schema.Array(Schema.Struct({ name: Schema.String, displayName: Schema.String })),
  error: Schema.NullOr(Schema.String),
  warning: Schema.NullOr(Schema.String),
  persisted: Schema.Boolean,
});
export type NotebookExecutionState = typeof NotebookExecutionState.Type;
export class NotebookExecutionFailure extends Schema.TaggedError<NotebookExecutionFailure>()(
  "NotebookExecutionFailure",
  {
    reason: Schema.Literals([
      "runtime-unavailable",
      "invalid-notebook",
      "file-changed",
      "kernel-failed",
      "busy",
      "file-error",
    ]),
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {
  override get message(): string {
    switch (this.reason) {
      case "runtime-unavailable":
        return "Python notebook runtime is unavailable on this environment.";
      case "invalid-notebook":
        return "Select a fully loaded Python notebook and a code cell.";
      case "file-changed":
        return "The notebook changed. Reload it before running code.";
      case "busy":
        return "This notebook is already running. Stop it before starting or restarting.";
      case "file-error":
        return "The notebook could not be read or saved.";
      case "kernel-failed":
        return "The Python kernel could not complete this request.";
    }
  }
}
