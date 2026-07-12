import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { ChildProcessSpawner } from "effect/unstable/process";

import * as GiteaCli from "./GiteaCli.ts";
import * as GiteaSourceControlProvider from "./GiteaSourceControlProvider.ts";

const TEA_LOGIN_LIST_OUTPUT = `
┌──────┬──────────────────────┬──────────────┬──────────┬─────────┐
│ NAME │         URL          │   SSH HOST   │   USER   │ DEFAULT │
├──────┼──────────────────────┼──────────────┼──────────┼─────────┤
│ manu │ https://git.manu.moe │ git.manu.moe │ rexlManu │ false   │
└──────┴──────────────────────┴──────────────┴──────────┴─────────┘
`;

function makeProvider(gitea: Partial<GiteaCli.GiteaCliShape>) {
  return GiteaSourceControlProvider.make().pipe(
    Effect.provide(Layer.mock(GiteaCli.GiteaCli)(gitea)),
  );
}

it("parses Tea login list table output", () => {
  const auth = GiteaSourceControlProvider.discovery.parseAuth({
    exitCode: ChildProcessSpawner.ExitCode(0),
    stderr: "",
    stdout: TEA_LOGIN_LIST_OUTPUT,
  });

  assert.strictEqual(auth.status, "authenticated");
  assert.deepStrictEqual(auth.account, Option.some("rexlManu"));
  assert.deepStrictEqual(auth.host, Option.some("git.manu.moe"));
});

it("refines unknown Gitea remotes when Tea is authenticated to the matching host", () => {
  const provider = GiteaSourceControlProvider.discovery.refineUnknownRemote?.({
    cwd: "/repo",
    context: {
      provider: {
        kind: "unknown",
        name: "git.manu.moe",
        baseUrl: "https://git.manu.moe",
      },
      remoteName: "origin",
      remoteUrl: "https://git.manu.moe/rexlManu/t3code.git",
    },
    auth: {
      exitCode: ChildProcessSpawner.ExitCode(0),
      stdout: TEA_LOGIN_LIST_OUTPUT,
      stderr: "",
    },
  });

  assert.deepStrictEqual(provider, {
    kind: "gitea",
    name: "Gitea Self-Hosted",
    baseUrl: "https://git.manu.moe",
  });
});

it("refines unknown Gitea remotes with mixed-case provider hosts", () => {
  const provider = GiteaSourceControlProvider.discovery.refineUnknownRemote?.({
    cwd: "/repo",
    context: {
      provider: {
        kind: "unknown",
        name: "Git.Manu.Moe",
        baseUrl: "https://Git.Manu.Moe",
      },
      remoteName: "origin",
      remoteUrl: "https://Git.Manu.Moe/rexlManu/t3code.git",
    },
    auth: {
      exitCode: ChildProcessSpawner.ExitCode(0),
      stdout: TEA_LOGIN_LIST_OUTPUT,
      stderr: "",
    },
  });

  assert.deepStrictEqual(provider, {
    kind: "gitea",
    name: "Gitea Self-Hosted",
    baseUrl: "https://Git.Manu.Moe",
  });
});

it("refines unknown Gitea remotes when remote uses a non-default SSH port", () => {
  const provider = GiteaSourceControlProvider.discovery.refineUnknownRemote?.({
    cwd: "/repo",
    context: {
      provider: {
        kind: "unknown",
        name: "git.it-lampe.de:2222",
        baseUrl: "https://git.it-lampe.de:2222",
      },
      remoteName: "origin",
      remoteUrl: "ssh://git@git.it-lampe.de:2222/rexlManu/german-anime-extensions.git",
    },
    auth: {
      exitCode: ChildProcessSpawner.ExitCode(0),
      stdout: `
┌─────────────────┬─────────────────────────┬─────────────────┬──────────┬─────────┐
│      NAME       │           URL           │    SSH HOST     │   USER   │ DEFAULT │
├─────────────────┼─────────────────────────┼─────────────────┼──────────┼─────────┤
│ git.it-lampe.de │ https://git.it-lampe.de │ git.it-lampe.de │ rexlManu │ false   │
└─────────────────┴─────────────────────────┴─────────────────┴──────────┴─────────┘
`,
      stderr: "",
    },
  });

  assert.deepStrictEqual(provider, {
    kind: "gitea",
    name: "Gitea Self-Hosted",
    baseUrl: "https://git.it-lampe.de:2222",
  });
});

it("refines unknown Gitea remotes when Tea uses a distinct SSH host", () => {
  const provider = GiteaSourceControlProvider.discovery.refineUnknownRemote?.({
    cwd: "/repo",
    context: {
      provider: {
        kind: "unknown",
        name: "ssh.git.example.com",
        baseUrl: "https://ssh.git.example.com",
      },
      remoteName: "origin",
      remoteUrl: "git@ssh.git.example.com:rexlManu/t3code.git",
    },
    auth: {
      exitCode: ChildProcessSpawner.ExitCode(0),
      stdout: `
┌──────────────────────────────────────────────────────────────┐
│ NAME │           URL           │       SSH HOST        │   USER   │ DEFAULT │
├─────────────────────────────────────────────────────────────┤
│ gitea │ https://git.example.com │ ssh.git.example.com │ rexlManu │ false   │
└──────────────────────────────────────────────────────────────┘
`,
      stderr: "",
    },
  });

  assert.deepStrictEqual(provider, {
    kind: "gitea",
    name: "Gitea Self-Hosted",
    baseUrl: "https://ssh.git.example.com",
  });
});

it("does not refine unknown Gitea remotes when Tea is not authenticated to the host", () => {
  const provider = GiteaSourceControlProvider.discovery.refineUnknownRemote?.({
    cwd: "/repo",
    context: {
      provider: {
        kind: "unknown",
        name: "git.example.com",
        baseUrl: "https://git.example.com",
      },
      remoteName: "origin",
      remoteUrl: "https://git.example.com/rexlManu/t3code.git",
    },
    auth: {
      exitCode: ChildProcessSpawner.ExitCode(0),
      stdout: TEA_LOGIN_LIST_OUTPUT,
      stderr: "",
    },
  });

  assert.strictEqual(provider, null);
});

it("refines unknown Gitea remotes with multiple Tea login entries", () => {
  const provider = GiteaSourceControlProvider.discovery.refineUnknownRemote?.({
    cwd: "/repo",
    context: {
      provider: {
        kind: "unknown",
        name: "git.example.com",
        baseUrl: "https://git.example.com",
      },
      remoteName: "origin",
      remoteUrl: "https://git.example.com/rexlManu/t3code.git",
    },
    auth: {
      exitCode: ChildProcessSpawner.ExitCode(0),
      stdout: `
┌──────┬──────────────────────┬──────────────┬──────────┬─────────┐
│ NAME │         URL          │   SSH HOST   │   USER   │ DEFAULT │
├──────┼──────────────────────┼──────────────┼──────────┼─────────┤
│ manu │ https://git.manu.moe │ git.manu.moe │ rexlManu │ false   │
│ exmp │ https://git.example.com │ git.example.com │ other-user │ true   │
└──────┴──────────────────────┴──────────────┴──────────┴─────────┘
`,
      stderr: "",
    },
  });

  assert.deepStrictEqual(provider, {
    kind: "gitea",
    name: "Gitea Self-Hosted",
    baseUrl: "https://git.example.com",
  });
});

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
