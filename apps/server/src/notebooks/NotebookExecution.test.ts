// @effect-diagnostics preferSchemaOverJson:off nodeBuiltinImport:off - Integration fixtures inspect the complete notebook document and detect the optional local Python runtime.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { it, expect, describe } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import { NotebookExecution } from "./NotebookExecution.ts";
import * as NotebookExecutionService from "./NotebookExecution.ts";
import * as ServerConfig from "../config.ts";
import * as WorkspaceFileSystem from "../workspace/WorkspaceFileSystem.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import * as WorkspaceEntries from "../workspace/WorkspaceEntries.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";

const available = NodeFS.existsSync(
  NodePath.join(
    NodeOS.homedir(),
    ".t3/tools/notebook-runtime",
    HostProcess.Platform.defaultValue() === "win32" ? "Scripts/python.exe" : "bin/python",
  ),
);
const files = WorkspaceFileSystem.layer.pipe(
  Layer.provide(WorkspacePaths.layer),
  Layer.provide(WorkspaceEntries.layer.pipe(Layer.provide(WorkspacePaths.layer))),
);
const layerTest = NotebookExecutionService.layer.pipe(
  Layer.provide(files),
  Layer.provide(VcsDriverRegistry.layer.pipe(Layer.provide(VcsProcess.layer))),
  Layer.provide(
    ServerConfig.ServerConfig.layerTest(process.cwd(), { prefix: "t3-notebook-test-" }),
  ),
  Layer.provideMerge(NodeServices.layer),
);
const fixture = (sources: string[]) =>
  JSON.stringify({
    nbformat: 4,
    nbformat_minor: 5,
    metadata: { custom: { keep: true } },
    cells: sources.map((source) => ({
      cell_type: "code",
      metadata: { keep: true },
      source,
      outputs: [],
      execution_count: null,
    })),
  });
const done = (target: { cwd: string; relativePath: string }) =>
  Effect.gen(function* () {
    const service = yield* NotebookExecution;
    for (let attempt = 0; attempt < 300; attempt++) {
      const state = yield* service.status(target);
      if (state.status !== "running") return state;
      yield* Effect.sleep("100 millis");
    }
    return yield* Effect.die("Notebook execution timed out");
  });

describe("Python notebook execution", () => {
  it.live.skipIf(!available)("stops a native sleep and allows another execution", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const service = yield* NotebookExecution;
      const cwd = yield* fs.makeTempDirectory({ prefix: "t3-notebook-stop-" });
      const target = { cwd, relativePath: "sleep.ipynb" };
      yield* fs.writeFileString(
        NodePath.join(cwd, target.relativePath),
        fixture([
          "from pathlib import Path\nimport time\nPath('started').write_text('yes')\ntime.sleep(60)",
          "print('ready')",
        ]),
      );
      yield* service.execute({ ...target, cellIndex: 0 });
      for (let i = 0; i < 200; i++) {
        if (yield* fs.exists(NodePath.join(cwd, "started"))) break;
        yield* Effect.sleep("100 millis");
      }
      expect(yield* fs.exists(NodePath.join(cwd, "started"))).toBe(true);
      yield* service.interrupt(target);
      const stopped = yield* done(target);
      expect(stopped.status).toBe("error");
      yield* service.execute({ ...target, cellIndex: 1 });
      const next = yield* done(target);
      expect(next.error).toBeNull();
      expect(next.status).toBe("completed");
      expect(next.results[0]?.outputs[0]?.text).toBe("ready\n");
    }).pipe(Effect.provide(layerTest)),
  );

  it.live.skipIf(!available)(
    "shares variables, captures a plot, persists metadata, interrupts and restarts",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const service = yield* NotebookExecution;
        const cwd = yield* fs.makeTempDirectory({ prefix: "t3-notebook-cells-" });
        const target = { cwd, relativePath: "shared.ipynb" };
        const filePath = NodePath.join(cwd, target.relativePath);
        yield* fs.writeFileString(
          filePath,
          fixture([
            "answer = 40",
            "print(answer + 2)",
            "import matplotlib.pyplot as plt\nplt.plot([1,2,3]); plt.show()",
            "while True: pass",
            "print(answer)",
          ]),
        );
        yield* service.execute({ ...target, cellIndex: 0 });
        const first = yield* done(target);
        expect(first.persisted).toBe(true);
        yield* service.execute({ ...target, cellIndex: 1 });
        const second = yield* done(target);
        expect(second.kernelId).toBe(first.kernelId);
        expect(second.results[0]?.outputs).toContainEqual({
          output_type: "stream",
          name: "stdout",
          text: "42\n",
        });
        yield* service.execute({ ...target, cellIndex: 2 });
        const plot = yield* done(target);
        expect(
          plot.results[0]?.outputs.some(
            (output) =>
              output.output_type === "display_data" &&
              typeof (output.data as Record<string, unknown>)["image/png"] === "string",
          ),
        ).toBe(true);
        const saved = JSON.parse(yield* fs.readFileString(filePath));
        expect(saved.metadata.custom.keep).toBe(true);
        expect(saved.cells[0].metadata.keep).toBe(true);
        expect(saved.cells[1].outputs[0].text).toBe("42\n");
        expect(saved.cells[2].execution_count).toBe(3);
        yield* service.execute({ ...target, cellIndex: 3 });
        // Wait until the sleeping cell owns the kernel, then interrupt it.
        for (let i = 0; i < 50; i++) {
          if ((yield* service.status(target)).activeCell === 3) break;
          yield* Effect.sleep("100 millis");
        }
        yield* service.interrupt(target);
        expect((yield* done(target)).status).toBe("error");
        yield* service.restart(target);
        yield* service.execute({ ...target, cellIndex: 4 });
        const restarted = yield* done(target);
        expect(restarted.kernelId).not.toBe(first.kernelId);
        expect(restarted.error).toContain("NameError");
      }).pipe(Effect.provide(layerTest)),
  );
  it.live.skipIf(!available)("rejects stale source and preserves edits made during execution", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const service = yield* NotebookExecution;
      const cwd = yield* fs.makeTempDirectory({ prefix: "t3-notebook-conflict-" });
      const target = { cwd, relativePath: "conflict.ipynb" };
      const filePath = NodePath.join(cwd, target.relativePath);
      const original = fixture(["import time\ntime.sleep(2)\nprint('done')"]);
      yield* fs.writeFileString(filePath, original);
      const stale = yield* Effect.result(service.execute({ ...target, expectedContents: "stale" }));
      expect(stale._tag).toBe("Failure");
      yield* service.execute({ ...target, expectedContents: original });
      const edited = fixture(["print('manual edit')"]);
      yield* fs.writeFileString(filePath, edited);
      const completed = yield* done(target);
      expect(completed.persisted).toBe(false);
      expect(completed.warning).toContain("changed during execution");
      expect(yield* fs.readFileString(filePath)).toBe(edited);
      expect(completed.results[0]?.outputs[0]?.text).toBe("done\n");
    }).pipe(Effect.provide(layerTest)),
  );
});
