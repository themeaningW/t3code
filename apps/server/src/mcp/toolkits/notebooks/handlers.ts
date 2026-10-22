import * as Effect from "effect/Effect";
import { NotebookExecution } from "../../../notebooks/NotebookExecution.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { readCaller } from "../../threadAccess.ts";
import { NotebookToolkit } from "./tools.ts";

export const layer = McpToolAccess.toLayer(NotebookToolkit, {
  notebook_execute: McpToolAccess.writesEnvironment((input) =>
    Effect.gen(function* () {
      return yield* (yield* NotebookExecution).execute(input);
    }),
  ),
  notebook_status: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      yield* readCaller();
      return yield* (yield* NotebookExecution).status(input);
    }),
  ),
  notebook_interrupt: McpToolAccess.writesEnvironment((input) =>
    Effect.gen(function* () {
      return yield* (yield* NotebookExecution).interrupt(input);
    }),
  ),
  notebook_restart: McpToolAccess.writesEnvironment((input) =>
    Effect.gen(function* () {
      return yield* (yield* NotebookExecution).restart(input);
    }),
  ),
});
