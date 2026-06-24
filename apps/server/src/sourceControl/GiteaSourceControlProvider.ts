import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { SourceControlProviderError, type ChangeRequest } from "@t3tools/contracts";

import * as GiteaCli from "./GiteaCli.ts";
import * as SourceControlProvider from "./SourceControlProvider.ts";
import * as SourceControlProviderDiscovery from "./SourceControlProviderDiscovery.ts";

function providerError(
  operation: string,
  cwd: string,
  cause: GiteaCli.GiteaCliError,
): SourceControlProviderError {
  return new SourceControlProviderError({
    provider: "gitea",
    operation,
    cwd,
    detail: cause.detail,
    cause,
  });
}

function toChangeRequest(summary: GiteaCli.GiteaPullRequestSummary): ChangeRequest {
  return {
    provider: "gitea",
    number: summary.number,
    title: summary.title,
    url: summary.url,
    baseRefName: summary.baseRefName,
    headRefName: summary.headRefName,
    state: summary.state ?? "open",
    updatedAt: summary.updatedAt ?? Option.none(),
    ...(summary.isCrossRepository !== undefined
      ? { isCrossRepository: summary.isCrossRepository }
      : {}),
    ...(summary.headRepositoryNameWithOwner !== undefined
      ? { headRepositoryNameWithOwner: summary.headRepositoryNameWithOwner }
      : {}),
    ...(summary.headRepositoryOwnerLogin !== undefined
      ? { headRepositoryOwnerLogin: summary.headRepositoryOwnerLogin }
      : {}),
  };
}

function parseTeaLoginListTable(
  output: string,
): { readonly account: string; readonly host: string } | null {
  for (const line of output.split(/\r?\n/u)) {
    const cells = line
      .split("│")
      .map((cell) => cell.trim())
      .filter((cell) => cell.length > 0);
    if (cells.length < 4 || cells[0] === "NAME" || !cells[1]?.startsWith("http")) {
      continue;
    }

    const account = cells[3];
    if (!account || account === "USER") {
      continue;
    }

    try {
      return { account, host: new URL(cells[1]).host };
    } catch {
      const host = cells[2];
      if (host) {
        return { account, host };
      }
    }
  }
  return null;
}

function parseGiteaAuth(input: SourceControlProviderDiscovery.SourceControlAuthProbeInput) {
  const output = SourceControlProviderDiscovery.combinedAuthOutput(input);
  const tableAuth = parseTeaLoginListTable(output);
  const account =
    tableAuth?.account ??
    SourceControlProviderDiscovery.matchFirst(output, [
      /Logged in as\s+([^\s(]+)/iu,
      /User(?:Name)?:\s*([^\s(]+)/iu,
    ]);
  const host = tableAuth?.host ?? SourceControlProviderDiscovery.parseCliHost(output);

  if (input.exitCode !== 0) {
    return SourceControlProviderDiscovery.providerAuth({
      status: "unauthenticated",
      host,
      detail:
        SourceControlProviderDiscovery.firstSafeAuthLine(output) ??
        "Run `tea login add` to authenticate Tea CLI.",
    });
  }

  return SourceControlProviderDiscovery.providerAuth({
    status: account ? "authenticated" : "unknown",
    ...(account ? { account } : {}),
    host,
    detail: account
      ? undefined
      : (SourceControlProviderDiscovery.firstSafeAuthLine(output) ??
        "Tea CLI auth status could not be parsed."),
  });
}

export const discovery = {
  type: "cli",
  kind: "gitea",
  label: "Gitea",
  executable: "tea",
  versionArgs: ["--version"],
  authArgs: ["login", "list"],
  parseAuth: parseGiteaAuth,
  installHint:
    "Install Tea CLI (`tea`) from https://gitea.com/gitea/tea or your package manager, then run `tea login add`.",
} satisfies SourceControlProviderDiscovery.SourceControlCliDiscoverySpec;

export const make = Effect.fn("makeGiteaSourceControlProvider")(function* () {
  const gitea = yield* GiteaCli.GiteaCli;

  return SourceControlProvider.SourceControlProvider.of({
    kind: "gitea",
    listChangeRequests: (input) =>
      gitea
        .listPullRequests({
          cwd: input.cwd,
          ...(input.context ? { context: input.context } : {}),
          state: input.state,
          ...(input.limit !== undefined ? { limit: input.limit } : {}),
        })
        .pipe(
          Effect.map((items) => items.map(toChangeRequest)),
          Effect.mapError((error) => providerError("listChangeRequests", input.cwd, error)),
        ),
    getChangeRequest: (input) =>
      gitea.getPullRequest(input).pipe(
        Effect.map(toChangeRequest),
        Effect.mapError((error) => providerError("getChangeRequest", input.cwd, error)),
      ),
    createChangeRequest: (input) =>
      gitea
        .createPullRequest({
          cwd: input.cwd,
          ...(input.context ? { context: input.context } : {}),
          baseBranch: input.baseRefName,
          headSelector: input.headSelector,
          title: input.title,
          bodyFile: input.bodyFile,
        })
        .pipe(Effect.mapError((error) => providerError("createChangeRequest", input.cwd, error))),
    getRepositoryCloneUrls: (input) =>
      gitea
        .getRepositoryCloneUrls(input)
        .pipe(
          Effect.mapError((error) => providerError("getRepositoryCloneUrls", input.cwd, error)),
        ),
    createRepository: (input) =>
      gitea
        .createRepository(input)
        .pipe(Effect.mapError((error) => providerError("createRepository", input.cwd, error))),
    getDefaultBranch: (input) =>
      gitea
        .getDefaultBranch(input)
        .pipe(Effect.mapError((error) => providerError("getDefaultBranch", input.cwd, error))),
    checkoutChangeRequest: (input) =>
      gitea
        .checkoutPullRequest(input)
        .pipe(Effect.mapError((error) => providerError("checkoutChangeRequest", input.cwd, error))),
  });
});

export const layer = Layer.effect(SourceControlProvider.SourceControlProvider, make());
