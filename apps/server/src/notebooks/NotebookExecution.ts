// @effect-diagnostics preferSchemaOverJson:off - Notebook JSON must round-trip unknown extension fields unchanged.
import {
  NotebookExecutionFailure,
  NotebookExecutionState,
  type NotebookExecuteInput,
  type NotebookTarget,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as ServerConfig from "../config.ts";
import * as WorkspaceFileSystem from "../workspace/WorkspaceFileSystem.ts";
import * as NodeNotebookKernel from "./NodeNotebookKernel.ts";

type Session = {
  kernel: NodeNotebookKernel.KernelHandle;
  lock: Semaphore.Semaphore;
  persisted: boolean;
  warning: string | null;
  pendingSave: boolean;
};
const decodeState = Schema.decodeUnknownSync(NotebookExecutionState);
const decodeDocument = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      nbformat: Schema.Literal(4),
      cells: Schema.Array(
        Schema.Struct({
          cell_type: Schema.String,
          source: Schema.Union([Schema.String, Schema.Array(Schema.String)]),
        }),
      ),
    }),
  ),
);

export class NotebookExecution extends Context.Service<
  NotebookExecution,
  {
    readonly execute: (
      input: NotebookExecuteInput,
    ) => Effect.Effect<NotebookExecutionState, NotebookExecutionFailure>;
    readonly status: (
      input: NotebookTarget,
    ) => Effect.Effect<NotebookExecutionState, NotebookExecutionFailure>;
    readonly interrupt: (
      input: NotebookTarget,
    ) => Effect.Effect<NotebookExecutionState, NotebookExecutionFailure>;
    readonly restart: (
      input: NotebookTarget,
    ) => Effect.Effect<NotebookExecutionState, NotebookExecutionFailure>;
  }
>()("t3/notebooks/NotebookExecution") {}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const home = yield* HostProcess.HomeDirectory;
  const platform = yield* HostProcess.Platform;
  const files = yield* WorkspaceFileSystem.WorkspaceFileSystem;
  const adapter = yield* NodeNotebookKernel.NotebookKernelAdapter;
  const scope = yield* Scope.Scope;
  const sessionLock = yield* Semaphore.make(1);
  const sessions = new Map<string, Session>();
  const failure = (cause: unknown) =>
    new NotebookExecutionFailure({ reason: "kernel-failed", cause });
  const read = (input: NotebookTarget) =>
    files
      .readFile(input)
      .pipe(
        Effect.mapError((cause) => new NotebookExecutionFailure({ reason: "file-error", cause })),
      );
  const request = (session: Session, input: Readonly<Record<string, unknown>>) =>
    Effect.tryPromise({
      try: async () => decodeState(await session.kernel.request(input)),
      catch: failure,
    });
  const getSession = (input: NotebookTarget) =>
    sessionLock.withPermit(
      Effect.gen(function* () {
        if (!/\.ipynb$/i.test(input.relativePath))
          return yield* new NotebookExecutionFailure({ reason: "invalid-notebook" });
        // Use the filesystem service's realpath boundary before starting any process.
        const file = yield* read(input);
        const canonical = yield* fs
          .realPath(path.resolve(input.cwd, input.relativePath))
          .pipe(Effect.mapError(failure));
        const key = platform === "win32" ? canonical.toLowerCase() : canonical;
        const existing = sessions.get(key);
        if (existing) return existing;
        if (file.truncated)
          return yield* new NotebookExecutionFailure({ reason: "invalid-notebook" });
        const suffix = platform === "win32" ? ["Scripts", "python.exe"] : ["bin", "python"];
        const candidates = [
          path.join(config.baseDir, "tools", "notebook-runtime", ...suffix),
          path.join(home, ".t3", "tools", "notebook-runtime", ...suffix),
        ];
        let python: string | undefined;
        for (const candidate of candidates)
          if (yield* fs.exists(candidate).pipe(Effect.mapError(failure))) {
            python = candidate;
            break;
          }
        if (!python) return yield* new NotebookExecutionFailure({ reason: "runtime-unavailable" });
        const kernel = yield* adapter
          .open(python, path.dirname(canonical))
          .pipe(Effect.provideService(Scope.Scope, scope));
        const session: Session = {
          kernel,
          lock: yield* Semaphore.make(1),
          persisted: false,
          warning: null,
          pendingSave: false,
        };
        sessions.set(key, session);
        return session;
      }),
    );
  const withPersistence = (
    session: Session,
    state: NotebookExecutionState,
  ): NotebookExecutionState => ({
    ...state,
    persisted: session.persisted,
    warning: session.warning ?? state.warning,
    status: session.pendingSave && state.status !== "running" ? "running" : state.status,
  });
  const execute: NotebookExecution["Service"]["execute"] = (input) =>
    Effect.gen(function* () {
      const session = yield* getSession(input);
      return yield* session.lock.withPermit(
        Effect.gen(function* () {
          const current = yield* request(session, { action: "status" });
          if (current.status === "running" || session.pendingSave)
            return yield* new NotebookExecutionFailure({ reason: "busy" });
          const file = yield* read(input);
          if (file.truncated)
            return yield* new NotebookExecutionFailure({ reason: "invalid-notebook" });
          if (input.expectedContents !== undefined && input.expectedContents !== file.contents)
            return yield* new NotebookExecutionFailure({ reason: "file-changed" });
          const document = yield* Effect.try({
            try: () => decodeDocument(file.contents),
            catch: () => new NotebookExecutionFailure({ reason: "invalid-notebook" }),
          });
          const cells = document.cells.flatMap((cell, cellIndex) =>
            cell.cell_type === "code" &&
            (input.cellIndex === undefined || input.cellIndex === cellIndex)
              ? [
                  {
                    cellIndex,
                    code: typeof cell.source === "string" ? cell.source : cell.source.join(""),
                  },
                ]
              : [],
          );
          if (!cells.length)
            return yield* new NotebookExecutionFailure({ reason: "invalid-notebook" });
          session.persisted = false;
          session.warning = null;
          session.pendingSave = true;
          const state = yield* request(session, {
            action: "execute",
            cells,
            kernelName: input.kernelName ?? current.kernelName,
          }).pipe(
            Effect.tapError(() =>
              Effect.sync(() => {
                session.pendingSave = false;
              }),
            ),
          );
          const complete = Effect.gen(function* () {
            const finished = yield* request(session, { action: "wait" });
            const latest = yield* read(input);
            if (latest.contents !== file.contents) {
              session.warning =
                "The notebook changed during execution. Results are available in this kernel but were not written over your edits.";
              return;
            }
            // Keep every unknown notebook field; execution only replaces outputs and execution counts.
            const updated: { cells: Array<Record<string, unknown>> } = JSON.parse(file.contents);
            for (const result of finished.results) {
              const cell = updated.cells[result.cellIndex];
              if (cell) {
                cell.outputs = result.outputs;
                cell.execution_count = result.executionCount;
              }
            }
            yield* files
              .writeFile({ ...input, contents: JSON.stringify(updated, null, 2) + "\n" })
              .pipe(
                Effect.mapError(
                  (cause) => new NotebookExecutionFailure({ reason: "file-error", cause }),
                ),
              );
            session.persisted = true;
          }).pipe(
            Effect.catch(() =>
              Effect.sync(() => {
                session.warning =
                  "Results could not be saved. They remain available in this kernel.";
              }),
            ),
            Effect.ensuring(
              Effect.sync(() => {
                session.pendingSave = false;
              }),
            ),
          );
          yield* Effect.forkIn(complete, scope);
          return withPersistence(session, state);
        }),
      );
    });
  const status = (input: NotebookTarget) =>
    Effect.gen(function* () {
      const session = yield* getSession(input);
      return withPersistence(session, yield* request(session, { action: "status" }));
    });
  const interrupt = (input: NotebookTarget) =>
    Effect.gen(function* () {
      const session = yield* getSession(input);
      return withPersistence(session, yield* request(session, { action: "interrupt" }));
    });
  const restart = (input: NotebookTarget) =>
    Effect.gen(function* () {
      const session = yield* getSession(input);
      return yield* session.lock.withPermit(
        Effect.gen(function* () {
          if (session.pendingSave) return yield* new NotebookExecutionFailure({ reason: "busy" });
          const state = yield* request(session, { action: "restart" });
          session.persisted = false;
          session.warning = null;
          return withPersistence(session, state);
        }),
      );
    });
  return NotebookExecution.of({ execute, status, interrupt, restart });
});

export const layer = Layer.effect(NotebookExecution, make).pipe(
  Layer.provide(NodeNotebookKernel.layer),
);
