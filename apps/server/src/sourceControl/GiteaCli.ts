import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";
import type * as DateTime from "effect/DateTime";
import {
  TrimmedNonEmptyString,
  type SourceControlRepositoryVisibility,
  type VcsError,
} from "@t3tools/contracts";
import { normalizeGitRemoteUrl } from "@t3tools/shared/git";

import * as GiteaPullRequests from "./giteaPullRequests.ts";
import type * as SourceControlProvider from "./SourceControlProvider.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";

const DEFAULT_TIMEOUT_MS = 30_000;

export class GiteaCliError extends Schema.TaggedErrorClass<GiteaCliError>()("GiteaCliError", {
  operation: Schema.String,
  detail: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {
  override get message(): string {
    return `Gitea CLI failed in ${this.operation}: ${this.detail}`;
  }
}

export interface GiteaPullRequestSummary {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly baseRefName: string;
  readonly headRefName: string;
  readonly state?: "open" | "closed" | "merged";
  readonly updatedAt?: Option.Option<DateTime.Utc>;
  readonly isCrossRepository?: boolean;
  readonly headRepositoryNameWithOwner?: string | null;
  readonly headRepositoryOwnerLogin?: string | null;
}

export interface GiteaRepositoryCloneUrls {
  readonly nameWithOwner: string;
  readonly url: string;
  readonly sshUrl: string;
}

export interface GiteaCliShape {
  readonly execute: (input: {
    readonly cwd: string;
    readonly args: ReadonlyArray<string>;
    readonly timeoutMs?: number;
  }) => Effect.Effect<VcsProcess.VcsProcessOutput, GiteaCliError>;
  readonly listPullRequests: (input: {
    readonly cwd: string;
    readonly context?: SourceControlProvider.SourceControlProviderContext;
    readonly state: "open" | "closed" | "merged" | "all";
    readonly limit?: number;
  }) => Effect.Effect<ReadonlyArray<GiteaPullRequestSummary>, GiteaCliError>;
  readonly getPullRequest: (input: {
    readonly cwd: string;
    readonly context?: SourceControlProvider.SourceControlProviderContext;
    readonly reference: string;
  }) => Effect.Effect<GiteaPullRequestSummary, GiteaCliError>;
  readonly getRepositoryCloneUrls: (input: {
    readonly cwd: string;
    readonly context?: SourceControlProvider.SourceControlProviderContext;
    readonly repository: string;
  }) => Effect.Effect<GiteaRepositoryCloneUrls, GiteaCliError>;
  readonly createRepository: (input: {
    readonly cwd: string;
    readonly repository: string;
    readonly visibility: SourceControlRepositoryVisibility;
  }) => Effect.Effect<GiteaRepositoryCloneUrls, GiteaCliError>;
  readonly createPullRequest: (input: {
    readonly cwd: string;
    readonly context?: SourceControlProvider.SourceControlProviderContext;
    readonly baseBranch: string;
    readonly headSelector: string;
    readonly title: string;
    readonly bodyFile: string;
  }) => Effect.Effect<void, GiteaCliError>;
  readonly getDefaultBranch: (input: {
    readonly cwd: string;
    readonly context?: SourceControlProvider.SourceControlProviderContext;
  }) => Effect.Effect<string | null, GiteaCliError>;
  readonly checkoutPullRequest: (input: {
    readonly cwd: string;
    readonly reference: string;
    readonly force?: boolean;
  }) => Effect.Effect<void, GiteaCliError>;
}

export class GiteaCli extends Context.Service<GiteaCli, GiteaCliShape>()(
  "t3/source-control/GiteaCli",
) {}

function errorText(error: VcsError | unknown): string {
  if (typeof error === "object" && error !== null) {
    const tag = "_tag" in error && typeof error._tag === "string" ? error._tag : "";
    const detail = "detail" in error && typeof error.detail === "string" ? error.detail : "";
    const message = "message" in error && typeof error.message === "string" ? error.message : "";
    return [tag, detail, message].filter(Boolean).join("\n");
  }
  return String(error);
}

function normalizeGiteaCliError(
  operation: "execute" | "stdout",
  error: VcsError | unknown,
): GiteaCliError {
  const text = errorText(error);
  const lower = text.toLowerCase();

  if (lower.includes("command not found: tea") || lower.includes("enoent")) {
    return new GiteaCliError({
      operation,
      detail: "Tea CLI (`tea`) is required for Gitea support but not available on PATH.",
      cause: error,
    });
  }

  if (
    lower.includes("no logins found") ||
    lower.includes("not logged in") ||
    lower.includes("authentication") ||
    lower.includes("unauthorized") ||
    lower.includes("forbidden") ||
    lower.includes("tea login")
  ) {
    return new GiteaCliError({
      operation,
      detail: "Tea CLI is not authenticated. Run `tea login add ...` and retry.",
      cause: error,
    });
  }

  if (lower.includes("pull request not found") || lower.includes("not found")) {
    return new GiteaCliError({
      operation,
      detail: "Pull request not found. Check the PR number or URL and try again.",
      cause: error,
    });
  }

  return new GiteaCliError({ operation, detail: text, cause: error });
}

const RawGiteaRepositoryCloneUrlsSchema = Schema.Struct({
  full_name: TrimmedNonEmptyString,
  html_url: Schema.optional(TrimmedNonEmptyString),
  clone_url: TrimmedNonEmptyString,
  ssh_url: TrimmedNonEmptyString,
});

const RawGiteaDefaultBranchSchema = Schema.Struct({
  full_name: TrimmedNonEmptyString,
  html_url: Schema.optional(TrimmedNonEmptyString),
  clone_url: TrimmedNonEmptyString,
  ssh_url: TrimmedNonEmptyString,
  default_branch: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
});

function decodeGiteaJson<S extends Schema.Top>(
  raw: string,
  schema: S,
  operation: "getRepositoryCloneUrls" | "getDefaultBranch" | "createRepository",
  invalidDetail: string,
): Effect.Effect<S["Type"], GiteaCliError, S["DecodingServices"]> {
  return Schema.decodeEffect(Schema.fromJsonString(schema))(raw).pipe(
    Effect.mapError(
      (error) =>
        new GiteaCliError({
          operation,
          detail: `${invalidDetail}: ${SchemaIssue.makeFormatterDefault()(error.issue)}`,
          cause: error,
        }),
    ),
  );
}

function normalizeRepositoryCloneUrls(
  raw: Schema.Schema.Type<typeof RawGiteaRepositoryCloneUrlsSchema>,
): GiteaRepositoryCloneUrls {
  return {
    nameWithOwner: raw.full_name,
    url: raw.html_url ?? raw.clone_url,
    sshUrl: raw.ssh_url,
  };
}

function repositoryPathFromRemoteUrl(remoteUrl: string): string | null {
  const normalized = normalizeGitRemoteUrl(remoteUrl);
  const firstSlash = normalized.indexOf("/");
  if (firstSlash <= 0 || firstSlash === normalized.length - 1) {
    return null;
  }
  return normalized.slice(firstSlash + 1);
}

function requireRepositoryPath(
  operation: string,
  input: {
    readonly context?: SourceControlProvider.SourceControlProviderContext;
    readonly repository?: string;
  },
): Effect.Effect<string, GiteaCliError> {
  const repository = input.repository?.trim();
  if (repository) return Effect.succeed(repository);

  const fromContext =
    input.context?.provider.kind === "gitea"
      ? repositoryPathFromRemoteUrl(input.context.remoteUrl)
      : null;
  if (fromContext) return Effect.succeed(fromContext);

  return Effect.fail(
    new GiteaCliError({
      operation,
      detail: "Could not resolve a Gitea repository path from the current git remote.",
    }),
  );
}

function encodeRepositoryPath(repository: string): string {
  return repository
    .split("/")
    .filter((segment) => segment.trim().length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function apiEndpoint(
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
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) search.set(key, String(value));
  }
  const endpoint = `/repos/${encodeRepositoryPath(repository)}${suffix}`;
  const queryString = search.toString();
  return queryString.length > 0 ? `${endpoint}?${queryString}` : endpoint;
}

function stateQueryValue(state: "open" | "closed" | "merged" | "all"): string {
  return state === "merged" ? "closed" : state;
}

function toSummaryWithOptionalUpdatedAt(
  record: GiteaPullRequests.NormalizedGiteaPullRequestRecord,
): GiteaPullRequestSummary {
  const { updatedAt, ...summary } = record;
  return Option.isSome(updatedAt) ? { ...summary, updatedAt } : summary;
}

function parseRepositoryPath(repository: string): {
  readonly owner: string | null;
  readonly name: string;
} {
  const parts = repository
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return {
    owner: parts.length > 1 ? parts.slice(0, -1).join("/") : null,
    name: parts.at(-1) ?? repository.trim(),
  };
}

export const make = Effect.fn("makeGiteaCli")(function* () {
  const process = yield* VcsProcess.VcsProcess;
  const fileSystem = yield* FileSystem.FileSystem;

  const execute: GiteaCliShape["execute"] = (input) =>
    process
      .run({
        operation: "GiteaCli.execute",
        command: "tea",
        args: input.args,
        cwd: input.cwd,
        timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      })
      .pipe(Effect.mapError((error) => normalizeGiteaCliError("execute", error)));

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

  return GiteaCli.of({
    execute,
    listPullRequests: (input) =>
      requireRepositoryPath("listPullRequests", input).pipe(
        Effect.flatMap((repository) =>
          executeApi({
            cwd: input.cwd,
            endpoint: apiEndpoint(repository, "/pulls", {
              state: stateQueryValue(input.state),
              limit: input.limit ?? 20,
              page: 1,
            }),
          }),
        ),
        Effect.flatMap((raw) =>
          raw.length === 0
            ? Effect.succeed([])
            : Effect.sync(() => GiteaPullRequests.decodeGiteaPullRequestListJson(raw)).pipe(
                Effect.flatMap((decoded) => {
                  if (!Result.isSuccess(decoded)) {
                    return Effect.fail(
                      new GiteaCliError({
                        operation: "listPullRequests",
                        detail: `Tea CLI returned invalid pull request list JSON: ${GiteaPullRequests.formatGiteaJsonDecodeError(decoded.failure)}`,
                        cause: decoded.failure,
                      }),
                    );
                  }

                  const filtered =
                    input.state === "merged"
                      ? decoded.success.filter((pullRequest) => pullRequest.state === "merged")
                      : decoded.success;
                  return Effect.succeed(filtered.map(toSummaryWithOptionalUpdatedAt));
                }),
              ),
        ),
      ),
    getPullRequest: (input) =>
      requireRepositoryPath("getPullRequest", input).pipe(
        Effect.flatMap((repository) =>
          executeApi({
            cwd: input.cwd,
            endpoint: apiEndpoint(repository, `/pulls/${encodeURIComponent(input.reference)}`),
          }),
        ),
        Effect.flatMap((raw) =>
          Effect.sync(() => GiteaPullRequests.decodeGiteaPullRequestJson(raw)).pipe(
            Effect.flatMap((decoded) => {
              if (!Result.isSuccess(decoded)) {
                return Effect.fail(
                  new GiteaCliError({
                    operation: "getPullRequest",
                    detail: `Tea CLI returned invalid pull request JSON: ${GiteaPullRequests.formatGiteaJsonDecodeError(decoded.failure)}`,
                    cause: decoded.failure,
                  }),
                );
              }
              return Effect.succeed(toSummaryWithOptionalUpdatedAt(decoded.success));
            }),
          ),
        ),
      ),
    getRepositoryCloneUrls: (input) =>
      requireRepositoryPath("getRepositoryCloneUrls", input).pipe(
        Effect.flatMap((repository) =>
          executeApi({ cwd: input.cwd, endpoint: apiEndpoint(repository) }),
        ),
        Effect.flatMap((raw) =>
          decodeGiteaJson(
            raw,
            RawGiteaRepositoryCloneUrlsSchema,
            "getRepositoryCloneUrls",
            "Tea CLI returned invalid repository JSON.",
          ),
        ),
        Effect.map(normalizeRepositoryCloneUrls),
      ),
    createRepository: (input) => {
      const { owner, name } = parseRepositoryPath(input.repository);
      return executeApi({
        cwd: input.cwd,
        method: "POST",
        endpoint: owner ? `/orgs/${encodeURIComponent(owner)}/repos` : "/user/repos",
        data: JSON.stringify({
          name,
          private: input.visibility === "private",
        }),
      }).pipe(
        Effect.flatMap((raw) =>
          decodeGiteaJson(
            raw,
            RawGiteaRepositoryCloneUrlsSchema,
            "createRepository",
            "Tea CLI returned invalid repository JSON.",
          ),
        ),
        Effect.map(normalizeRepositoryCloneUrls),
      );
    },
    createPullRequest: (input) =>
      Effect.all([
        requireRepositoryPath("createPullRequest", input),
        fileSystem.readFileString(input.bodyFile).pipe(
          Effect.mapError(
            (cause) =>
              new GiteaCliError({
                operation: "createPullRequest",
                detail: `Failed to read pull request body file ${input.bodyFile}.`,
                cause,
              }),
          ),
        ),
      ]).pipe(
        Effect.flatMap(([repository, body]) =>
          executeApi({
            cwd: input.cwd,
            method: "POST",
            endpoint: apiEndpoint(repository, "/pulls"),
            data: JSON.stringify({
              base: input.baseBranch,
              head: input.headSelector,
              title: input.title,
              body,
            }),
          }),
        ),
        Effect.asVoid,
      ),
    getDefaultBranch: (input) =>
      requireRepositoryPath("getDefaultBranch", input).pipe(
        Effect.flatMap((repository) =>
          executeApi({ cwd: input.cwd, endpoint: apiEndpoint(repository) }),
        ),
        Effect.flatMap((raw) =>
          decodeGiteaJson(
            raw,
            RawGiteaDefaultBranchSchema,
            "getDefaultBranch",
            "Tea CLI returned invalid repository JSON.",
          ),
        ),
        Effect.map((value) => value.default_branch ?? null),
      ),
    checkoutPullRequest: (input) =>
      execute({
        cwd: input.cwd,
        args: ["pr", "checkout", input.reference],
      }).pipe(Effect.asVoid),
  });
});

export const layer = Layer.effect(GiteaCli, make());
