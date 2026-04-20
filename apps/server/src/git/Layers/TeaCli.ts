import { Effect, Layer } from "effect";

import { GitHostingCliError } from "@t3tools/contracts";
import { parseRepositoryPathFromRemoteUrl } from "@t3tools/shared/git";
import { runProcess } from "../../processRunner.ts";
import { GitCore } from "../Services/GitCore.ts";
import {
  TeaCli,
  type TeaCliShape,
  type TeaPullRequestSummary,
  type TeaRepositoryInfo,
} from "../Services/TeaCli.ts";

const DEFAULT_TIMEOUT_MS = 30_000;

function normalizeTeaCliError(operation: string, error: unknown): GitHostingCliError {
  if (error instanceof Error) {
    if (error.message.includes("Command not found: tea")) {
      return new GitHostingCliError({
        operation,
        detail:
          "Tea CLI (`tea`) is required for Gitea pull request support but is not available on PATH.",
        cause: error,
      });
    }

    const lower = error.message.toLowerCase();
    if (
      lower.includes("no logins found") ||
      lower.includes("no available login") ||
      lower.includes("not logged in") ||
      lower.includes("authentication") ||
      lower.includes("unauthorized") ||
      lower.includes("forbidden") ||
      lower.includes("tea login")
    ) {
      return new GitHostingCliError({
        operation,
        detail:
          "Tea CLI is not authenticated for this repository. Run `tea login add ...` and retry.",
        cause: error,
      });
    }

    if (
      lower.includes("pull request not found") ||
      lower.includes("no pull requests found") ||
      lower.includes("the target couldn't be found") ||
      lower.includes("404")
    ) {
      return new GitHostingCliError({
        operation,
        detail: "Pull request not found. Check the PR number or URL and try again.",
        cause: error,
      });
    }

    return new GitHostingCliError({
      operation,
      detail: `Tea CLI command failed: ${error.message}`,
      cause: error,
    });
  }

  return new GitHostingCliError({
    operation,
    detail: "Tea CLI command failed.",
    cause: error,
  });
}

function trimOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function normalizeTeaPullRequestState(
  record: Record<string, unknown>,
): "open" | "closed" | "merged" {
  if (record.merged === true || trimOptionalString(record.merged_at) !== null) {
    return "merged";
  }

  const state = trimOptionalString(record.state)?.toLowerCase();
  if (state === "closed") {
    return "closed";
  }

  return "open";
}

function normalizeTeaPullRequestSummary(raw: unknown): TeaPullRequestSummary | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const record = raw as Record<string, unknown>;
  const base =
    typeof record.base === "object" && record.base !== null
      ? (record.base as Record<string, unknown>)
      : null;
  const head =
    typeof record.head === "object" && record.head !== null
      ? (record.head as Record<string, unknown>)
      : null;
  const baseRepo =
    base && typeof base.repo === "object" && base.repo !== null
      ? (base.repo as Record<string, unknown>)
      : null;
  const headRepo =
    head && typeof head.repo === "object" && head.repo !== null
      ? (head.repo as Record<string, unknown>)
      : null;
  const headUser =
    head && typeof head.user === "object" && head.user !== null
      ? (head.user as Record<string, unknown>)
      : null;

  const number = readNumber(record.number) ?? readNumber(record.index);
  const title = trimOptionalString(record.title);
  const url = trimOptionalString(record.html_url) ?? trimOptionalString(record.url);
  const baseRefName = trimOptionalString(base?.ref) ?? trimOptionalString(record.baseRefName);
  const headRefName = trimOptionalString(head?.ref) ?? trimOptionalString(record.headRefName);

  if (number === null || !title || !url || !baseRefName || !headRefName) {
    return null;
  }

  const headRepositoryNameWithOwner =
    trimOptionalString(headRepo?.full_name) ??
    trimOptionalString(record.headRepositoryNameWithOwner);
  const headRepositoryOwnerLogin =
    trimOptionalString(headUser?.login) ??
    trimOptionalString(record.headRepositoryOwnerLogin) ??
    headRepositoryNameWithOwner?.split("/")[0] ??
    null;
  const baseRepositoryNameWithOwner = trimOptionalString(baseRepo?.full_name);
  const isCrossRepository =
    headRepositoryNameWithOwner !== null &&
    baseRepositoryNameWithOwner !== null &&
    headRepositoryNameWithOwner.toLowerCase() !== baseRepositoryNameWithOwner.toLowerCase();

  return {
    number,
    title,
    url,
    baseRefName,
    headRefName,
    state: normalizeTeaPullRequestState(record),
    updatedAt: trimOptionalString(record.updated_at) ?? trimOptionalString(record.updatedAt),
    ...(headRepositoryNameWithOwner ? { headRepositoryNameWithOwner } : {}),
    ...(headRepositoryOwnerLogin ? { headRepositoryOwnerLogin } : {}),
    ...(isCrossRepository ? { isCrossRepository } : {}),
  };
}

function normalizeTeaPullRequestList(raw: string): ReadonlyArray<TeaPullRequestSummary> {
  const parsed = JSON.parse(extractJsonPayload(raw)) as unknown;
  const entries = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object"
      ? ((parsed as Record<string, unknown>).pull_requests ??
        (parsed as Record<string, unknown>).data ??
        [])
      : [];

  return Array.isArray(entries)
    ? entries
        .map((entry) => normalizeTeaPullRequestSummary(entry))
        .filter((entry): entry is TeaPullRequestSummary => entry !== null)
    : [];
}

function normalizeTeaRepositoryInfo(raw: string): TeaRepositoryInfo {
  const parsed = JSON.parse(extractJsonPayload(raw)) as Record<string, unknown>;
  const nameWithOwner =
    trimOptionalString(parsed.full_name) ??
    trimOptionalString(parsed.nameWithOwner) ??
    trimOptionalString(parsed.fullName);
  const url = trimOptionalString(parsed.clone_url) ?? trimOptionalString(parsed.url);
  const sshUrl = trimOptionalString(parsed.ssh_url) ?? trimOptionalString(parsed.sshUrl);

  if (!nameWithOwner || !url || !sshUrl) {
    throw new Error("Tea CLI returned invalid repository JSON.");
  }

  return {
    nameWithOwner,
    url,
    sshUrl,
    defaultBranch:
      trimOptionalString(parsed.default_branch) ?? trimOptionalString(parsed.defaultBranch),
  };
}

function extractJsonPayload(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return trimmed;
  }

  const objectStart = trimmed.indexOf("{");
  const arrayStart = trimmed.indexOf("[");
  const start =
    objectStart === -1
      ? arrayStart
      : arrayStart === -1
        ? objectStart
        : Math.min(objectStart, arrayStart);

  return start > 0 ? trimmed.slice(start) : trimmed;
}

function encodeRepositoryPath(repository: string): string {
  return repository
    .split("/")
    .filter((segment) => segment.trim().length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function buildTeaApiEndpoint(
  repository: string,
  pathSuffix = "",
  query?: Readonly<Record<string, string | number | undefined>>,
): string {
  const suffix = pathSuffix.startsWith("/")
    ? pathSuffix
    : pathSuffix.length > 0
      ? `/${pathSuffix}`
      : "";
  const search = new URLSearchParams();
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) {
        continue;
      }
      search.set(key, String(value));
    }
  }

  const endpoint = `/repos/${encodeRepositoryPath(repository)}${suffix}`;
  const queryString = search.toString();
  return queryString.length > 0 ? `${endpoint}?${queryString}` : endpoint;
}

const makeTeaCli = Effect.gen(function* () {
  const gitCore = yield* GitCore;

  const readConfigValueNullable = (cwd: string, key: string) =>
    gitCore.readConfigValue(cwd, key).pipe(Effect.catch(() => Effect.succeed(null)));

  const resolveRepositoryPath = Effect.fn("TeaCli.resolveRepositoryPath")(function* (cwd: string) {
    const details = yield* gitCore
      .statusDetailsLocal(cwd)
      .pipe(Effect.catch(() => Effect.succeed(null)));
    const preferredRemoteName =
      details?.branch === null || details?.branch === undefined
        ? "origin"
        : ((yield* readConfigValueNullable(cwd, `branch.${details.branch}.remote`)) ?? "origin");
    const remoteUrl =
      (yield* readConfigValueNullable(cwd, `remote.${preferredRemoteName}.url`)) ??
      (yield* readConfigValueNullable(cwd, "remote.origin.url"));
    const repositoryPath = parseRepositoryPathFromRemoteUrl(remoteUrl);

    if (!repositoryPath) {
      return yield* new GitHostingCliError({
        operation: "resolveRepositoryPath",
        detail: "Could not resolve a repository path from the current git remotes.",
      });
    }

    return repositoryPath;
  });

  const execute: TeaCliShape["execute"] = (input) =>
    Effect.tryPromise({
      try: () =>
        runProcess("tea", input.args, {
          cwd: input.cwd,
          timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        }),
      catch: (error) => normalizeTeaCliError("execute", error),
    });

  const executeApi = (input: {
    readonly cwd: string;
    readonly endpoint: string;
    readonly method?: "GET" | "POST";
    readonly data?: string;
  }) =>
    execute({
      cwd: input.cwd,
      args: [
        "api",
        ...(input.method ? ["--method", input.method] : []),
        ...(input.data ? ["--data", input.data] : []),
        input.endpoint,
      ],
    }).pipe(Effect.map((result) => result.stdout.trim()));

  return {
    execute,
    listPullRequests: (input) =>
      resolveRepositoryPath(input.cwd).pipe(
        Effect.flatMap((repository) => {
          const requestedState = input.state === "merged" ? "closed" : input.state;
          return executeApi({
            cwd: input.cwd,
            endpoint: buildTeaApiEndpoint(repository, "/pulls", {
              state: requestedState,
              limit: input.limit ?? 20,
              page: 1,
            }),
          }).pipe(
            Effect.flatMap((raw) =>
              Effect.try({
                try: () => {
                  const pullRequests = raw.length === 0 ? [] : normalizeTeaPullRequestList(raw);
                  return input.state === "merged"
                    ? pullRequests.filter((pullRequest) => pullRequest.state === "merged")
                    : pullRequests;
                },
                catch: (error) => normalizeTeaCliError("listPullRequests", error),
              }),
            ),
          );
        }),
      ),
    getPullRequest: (input) =>
      resolveRepositoryPath(input.cwd).pipe(
        Effect.flatMap((repository) =>
          executeApi({
            cwd: input.cwd,
            endpoint: buildTeaApiEndpoint(
              repository,
              `/pulls/${encodeURIComponent(input.reference)}`,
            ),
          }),
        ),
        Effect.flatMap((raw) =>
          Effect.try({
            try: () => {
              const normalized = normalizeTeaPullRequestSummary(
                JSON.parse(extractJsonPayload(raw)),
              );
              if (!normalized) {
                throw new Error("Tea CLI returned invalid pull request JSON.");
              }
              return normalized;
            },
            catch: (error) => normalizeTeaCliError("getPullRequest", error),
          }),
        ),
      ),
    getRepositoryInfo: (input) =>
      Effect.succeed(input.repository).pipe(
        Effect.flatMap((repository) =>
          repository ? Effect.succeed(repository) : resolveRepositoryPath(input.cwd),
        ),
        Effect.flatMap((repository) =>
          executeApi({
            cwd: input.cwd,
            endpoint: buildTeaApiEndpoint(repository),
          }),
        ),
        Effect.flatMap((raw) =>
          Effect.try({
            try: () => normalizeTeaRepositoryInfo(raw),
            catch: (error) => normalizeTeaCliError("getRepositoryInfo", error),
          }),
        ),
      ),
    createPullRequest: (input) =>
      resolveRepositoryPath(input.cwd).pipe(
        Effect.flatMap((repository) =>
          executeApi({
            cwd: input.cwd,
            method: "POST",
            endpoint: buildTeaApiEndpoint(repository, "/pulls"),
            data: JSON.stringify({
              base: input.baseBranch,
              head: input.headSelector,
              title: input.title,
              body: input.body,
            }),
          }),
        ),
        Effect.asVoid,
      ),
  } satisfies TeaCliShape;
});

export const TeaCliLive = Layer.effect(TeaCli, makeTeaCli);
