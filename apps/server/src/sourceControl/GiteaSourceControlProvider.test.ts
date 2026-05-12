import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as GiteaCli from "./GiteaCli.ts";
import * as GiteaSourceControlProvider from "./GiteaSourceControlProvider.ts";

function makeProvider(gitea: Partial<GiteaCli.GiteaCliShape>) {
  return GiteaSourceControlProvider.make().pipe(
    Effect.provide(Layer.mock(GiteaCli.GiteaCli)(gitea)),
  );
}

it.effect("maps Gitea PR summaries into provider-neutral change requests", () =>
  Effect.gen(function* () {
    const provider = yield* makeProvider({
      getPullRequest: () =>
        Effect.succeed({
          number: 42,
          title: "Add Gitea provider",
          url: "https://gitea.com/pingdotgg/t3code/pulls/42",
          baseRefName: "main",
          headRefName: "feature/source-control",
          state: "open",
          isCrossRepository: true,
          headRepositoryNameWithOwner: "fork/t3code",
          headRepositoryOwnerLogin: "fork",
        }),
    });

    const changeRequest = yield* provider.getChangeRequest({
      cwd: "/repo",
      reference: "42",
    });

    assert.deepStrictEqual(changeRequest, {
      provider: "gitea",
      number: 42,
      title: "Add Gitea provider",
      url: "https://gitea.com/pingdotgg/t3code/pulls/42",
      baseRefName: "main",
      headRefName: "feature/source-control",
      state: "open",
      updatedAt: Option.none(),
      isCrossRepository: true,
      headRepositoryNameWithOwner: "fork/t3code",
      headRepositoryOwnerLogin: "fork",
    });
  }),
);

it.effect("creates Gitea PRs through provider-neutral input names", () =>
  Effect.gen(function* () {
    let createInput: Parameters<GiteaCli.GiteaCliShape["createPullRequest"]>[0] | null = null;
    const provider = yield* makeProvider({
      createPullRequest: (input) => {
        createInput = input;
        return Effect.void;
      },
    });

    yield* provider.createChangeRequest({
      cwd: "/repo",
      baseRefName: "main",
      headSelector: "feature/provider",
      title: "Provider PR",
      bodyFile: "/tmp/body.md",
    });

    assert.deepStrictEqual(createInput, {
      cwd: "/repo",
      baseBranch: "main",
      headSelector: "feature/provider",
      title: "Provider PR",
      bodyFile: "/tmp/body.md",
    });
  }),
);
