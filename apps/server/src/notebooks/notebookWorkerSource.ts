// @effect-diagnostics nodeBuiltinImport:off - Development reads the worker at bootstrap; the CLI bundle embeds it.
import * as NodeFS from "node:fs";

export default NodeFS.readFileSync(new URL("./notebook_worker.py", import.meta.url), "utf8");
