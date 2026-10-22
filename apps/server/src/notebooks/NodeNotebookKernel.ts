// @effect-diagnostics nodeBuiltinImport:off globalTimers:off preferSchemaOverJson:off - Node process callbacks bridge the kernel's JSON-lines protocol.
import * as NodeChildProcess from "node:child_process";
import * as NodeReadline from "node:readline";
import { NotebookExecutionFailure } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import workerSource from "./notebook_worker.py?raw";

export interface KernelHandle {
  readonly request: (input: Readonly<Record<string, unknown>>) => Promise<unknown>;
  readonly close: () => void;
}

const decodeReply = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      id: Schema.Number,
      result: Schema.optionalKey(Schema.Unknown),
      error: Schema.optionalKey(Schema.NullOr(Schema.String)),
    }),
  ),
);
function spawnKernel(python: string, cwd: string): KernelHandle {
  const child = NodeChildProcess.spawn(python, ["-I", "-u", "-c", workerSource], {
    cwd,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let serial = 0;
  let stopped = false;
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (cause: unknown) => void }
  >();
  const failPending = (cause: unknown) => {
    stopped = true;
    for (const waiter of pending.values()) waiter.reject(cause);
    pending.clear();
  };
  child.on("error", failPending);
  child.on("exit", () => failPending(new Error("Notebook worker stopped.")));
  child.stdin.on("error", failPending);
  child.stderr.resume();
  NodeReadline.createInterface({ input: child.stdout }).on("line", (line) => {
    let message: { id: number; result?: unknown; error?: string | null };
    try {
      message = decodeReply(line);
    } catch {
      failPending(new Error("Invalid notebook worker response."));
      return;
    }
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error));
    else waiter.resolve(message.result);
  });
  return {
    request: (input) =>
      new Promise((resolve, reject) => {
        if (stopped) {
          reject(new Error("Notebook worker is not running."));
          return;
        }
        const id = ++serial;
        pending.set(id, { resolve, reject });
        child.stdin.write(JSON.stringify({ ...input, id }) + "\n");
      }),
    close: () => {
      child.stdin.end();
      const timer = setTimeout(() => {
        if (!stopped) child.kill();
      }, 3_000);
      timer.unref();
    },
  };
}

export class NotebookKernelAdapter extends Context.Service<
  NotebookKernelAdapter,
  {
    readonly open: (
      python: string,
      cwd: string,
    ) => Effect.Effect<KernelHandle, NotebookExecutionFailure, Scope.Scope>;
  }
>()("t3/notebooks/NodeNotebookKernel/NotebookKernelAdapter") {}

export const layer = Layer.succeed(
  NotebookKernelAdapter,
  NotebookKernelAdapter.of({
    open: (python, cwd) =>
      Effect.acquireRelease(
        Effect.try({
          try: () => spawnKernel(python, cwd),
          catch: (cause) => new NotebookExecutionFailure({ reason: "runtime-unavailable", cause }),
        }),
        (kernel) => Effect.sync(kernel.close),
      ),
  }),
);
