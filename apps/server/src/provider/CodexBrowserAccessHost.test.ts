// @effect-diagnostics nodeBuiltinImport:off -- Checks the real private socket directory and teardown.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import { assert, describe, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import { makeCodexBrowserAccessHost } from "./CodexBrowserAccessHost.ts";
import { requestBrowserAccess } from "./testFixtures/browserAccessClient.ts";

describe("CodexBrowserAccessHost", () => {
  it.effect("signs decisions over the real pipe and closes it when the session ends", () =>
    Effect.gen(function* () {
      const request = { sessionId: "owned-session", turnId: "active-turn" };
      const environment = yield* Effect.scoped(
        Effect.gen(function* () {
          const environment = yield* makeCodexBrowserAccessHost((candidate) =>
            Effect.succeed(
              candidate.sessionId === request.sessionId && candidate.turnId === request.turnId,
            ),
          );
          assert.isTrue(yield* requestBrowserAccess(environment, request));
          assert.isFalse(
            yield* requestBrowserAccess(environment, { ...request, turnId: "finished" }),
          );
          assert.isFalse(
            yield* requestBrowserAccess(environment, { ...request, executorId: "foreign" }),
          );
          return environment;
        }),
      );
      assert.isUndefined(yield* requestBrowserAccess(environment, request));
    }),
  );

  it.effect("keeps its socket in an owner-only directory that closing removes", () =>
    Effect.gen(function* () {
      if ((yield* HostProcess.Platform) === "win32") return;
      const directory = yield* Effect.scoped(
        Effect.gen(function* () {
          const environment = yield* makeCodexBrowserAccessHost(() => Effect.succeed(true));
          const directory = NodePath.dirname(environment.BROWSER_USE_ACCESS_PIPE_PATH);
          assert.equal((yield* Effect.promise(() => NodeFSP.stat(directory))).mode & 0o777, 0o700);
          return directory;
        }),
      );
      const exists = yield* Effect.promise(() =>
        NodeFSP.access(directory).then(
          () => true,
          () => false,
        ),
      );
      assert.isFalse(exists);
    }),
  );
});
