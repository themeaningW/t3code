import {
  AuthTerminalOperateScope,
  type EnvironmentId,
  type NotebookExecutionState,
} from "@t3tools/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Cause from "effect/Cause";
import { Button } from "~/components/ui/button";
import {
  notebookExecute,
  notebookInterrupt,
  notebookRestart,
  notebookStatus,
} from "~/state/notebooks";
import { useAtomCommand } from "~/state/use-atom-command";
import { useAtomQueryRunner } from "~/state/use-atom-query-runner";
import { useEnvironmentScope } from "~/state/session";
import { NotebookPreview } from "./NotebookPreview";
import { FileSurfaceNotice } from "./fileSurfaceChrome";
type PreviewProps = Parameters<typeof NotebookPreview>[0];
export function ExecutableNotebook(
  props: PreviewProps & {
    readonly environmentId: EnvironmentId;
    readonly cwd: string;
    readonly onSaved: () => void;
  },
) {
  const allowed = useEnvironmentScope(props.environmentId, AuthTerminalOperateScope);
  const execute = useAtomCommand(notebookExecute, { reportFailure: false });
  const interrupt = useAtomCommand(notebookInterrupt, { reportFailure: false });
  const restart = useAtomCommand(notebookRestart, { reportFailure: false });
  const query = useAtomQueryRunner(notebookStatus, { refresh: true, reportFailure: false });
  const target = useMemo(
    () => ({
      environmentId: props.environmentId,
      input: { cwd: props.cwd, relativePath: props.name },
    }),
    [props.environmentId, props.cwd, props.name],
  );
  const [state, setState] = useState<NotebookExecutionState | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [pollEpoch, setPollEpoch] = useState(0);
  const [kernelName, setKernelName] = useState("python3");
  const refreshedRun = useRef<string | null>(null);
  const onSaved = useRef(props.onSaved);
  useEffect(() => {
    onSaved.current = props.onSaved;
  }, [props.onSaved]);
  const accept = useCallback((next: NotebookExecutionState) => {
    setState(next);
    if (next.persisted && next.runId !== refreshedRun.current) {
      refreshedRun.current = next.runId;
      onSaved.current();
    }
  }, []);
  useEffect(() => {
    // A command restarts polling immediately, including after the idle interval.
    void pollEpoch;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      const result = await query(target);
      if (disposed) return;
      if (result._tag === "Success") {
        accept(result.value);
        timer = setTimeout(
          () => {
            void poll();
          },
          result.value.status === "running" ? 500 : 10_000,
        );
      } else {
        setFailure(Cause.pretty(result.cause));
      }
    };
    void poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [accept, query, target, pollEpoch]);
  const run = async (action: "execute" | "interrupt" | "restart", cellIndex?: number) => {
    setPending(true);
    setFailure(null);
    try {
      const result =
        action === "execute"
          ? await execute({
              ...target,
              input: {
                ...target.input,
                kernelName,
                expectedContents: props.text,
                ...(cellIndex === undefined ? {} : { cellIndex }),
              },
            })
          : await (action === "interrupt" ? interrupt : restart)(target);
      if (result._tag === "Success") {
        accept(result.value);
        setPollEpoch((value) => value + 1);
      } else setFailure(Cause.pretty(result.cause));
    } finally {
      setPending(false);
    }
  };
  const running = pending || state?.status === "running";
  const displayedText = useMemo(() => {
    if (!state?.results.length) return props.text;
    try {
      const document = JSON.parse(props.text);
      for (const result of state.results) {
        const cell = document.cells[result.cellIndex];
        if (cell) {
          cell.outputs = result.outputs;
          cell.execution_count = result.executionCount;
        }
      }
      return JSON.stringify(document);
    } catch {
      return props.text;
    }
  }, [props.text, state]);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <select
          aria-label="Python kernel"
          className="max-w-56 rounded border bg-background px-2 py-1 text-xs"
          value={state?.kernelId ? state.kernelName : kernelName}
          disabled={running || !!state?.kernelId}
          onChange={(event) => setKernelName(event.target.value)}
        >
          {(state?.kernels.length
            ? state.kernels
            : [{ name: "python3", displayName: "Python 3" }]
          ).map((kernel) => (
            <option key={kernel.name} value={kernel.name}>
              {kernel.displayName}
            </option>
          ))}
        </select>
        <Button
          variant="outline"
          size="sm"
          disabled={!allowed || running || !state}
          onClick={() => void run("execute")}
        >
          Run all
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!allowed || !running || pending}
          onClick={() => void run("interrupt")}
        >
          Stop
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!allowed || running || !state}
          onClick={() => void run("restart")}
        >
          Restart
        </Button>
        <span role="status" className="text-xs text-muted-foreground">
          {state?.status ?? "Connecting"}
          {state?.activeCell != null ? ` · Cell ${state.activeCell + 1}` : ""}
          {state?.persisted ? " · Saved" : ""}
        </span>
      </div>
      {failure || state?.error ? (
        <FileSurfaceNotice>{failure ?? state?.error}</FileSurfaceNotice>
      ) : null}
      {state?.warning ? <FileSurfaceNotice>{state.warning}</FileSurfaceNotice> : null}
      <NotebookPreview
        {...props}
        text={displayedText}
        running={running || !allowed || !state}
        onRunCell={(index) => void run("execute", index)}
      />
    </div>
  );
}
