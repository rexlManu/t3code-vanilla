import { readFile } from "node:fs/promises";

import { Effect, Layer } from "effect";

import { runProcess } from "../../processRunner";
import { GitHostingCliError } from "../Errors.ts";
import {
  detectHostingPlatformFromHost,
  deriveWebBaseUrlFromRemoteUrl,
  parsePullRequestReferenceUrl,
  parseRemoteHostFromUrl,
} from "../hosting.ts";
import {
  GitHostingCli,
  type GitHostingCliShape,
  type GitHostingPullRequestSummary,
} from "../Services/GitHostingCli.ts";
import { GitHubCli } from "../Services/GitHubCli.ts";

const DEFAULT_TIMEOUT_MS = 30_000;
const DETECTION_TIMEOUT_MS = 2_000;

function toStringValue(value: unknown): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 ? trimmed : null;
}

function toNullableStringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function toPositiveInt(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function toBooleanValue(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function toObjectRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function parseJson(raw: string): unknown {
  return JSON.parse(raw);
}

function normalizePullRequestState(input: {
  state?: string | null;
  mergedAt?: string | null;
  merged?: boolean | null;
}): "open" | "closed" | "merged" {
  const state = input.state?.trim().toLowerCase() ?? "";
  if (input.merged || (input.mergedAt?.trim() ?? "").length > 0 || state === "merged") {
    return "merged";
  }
  if (state === "closed") {
    return "closed";
  }
  return "open";
}

function parseGitLabSummary(
  value: unknown,
  sourceProjectPath?: string | null,
): GitHostingPullRequestSummary | null {
  const record = toObjectRecord(value);
  if (!record) {
    return null;
  }

  const number = toPositiveInt(record.iid);
  const title = toStringValue(record.title);
  const url = toStringValue(record.web_url);
  const baseRefName = toStringValue(record.target_branch);
  const headRefName = toStringValue(record.source_branch);
  if (!number || !title || !url || !baseRefName || !headRefName) {
    return null;
  }

  const normalizedSourceProjectPath = toStringValue(sourceProjectPath);
  const headRepositoryOwnerLogin =
    normalizedSourceProjectPath?.split("/")[0]?.trim() || null;
  const sourceProjectId =
    typeof record.source_project_id === "number" ? record.source_project_id : null;
  const targetProjectId =
    typeof record.target_project_id === "number" ? record.target_project_id : null;

  return {
    number,
    title,
    url,
    baseRefName,
    headRefName,
    state: normalizePullRequestState({
      state: toStringValue(record.state),
      mergedAt: toNullableStringValue(record.merged_at),
    }),
    updatedAt: toNullableStringValue(record.updated_at),
    ...(sourceProjectId !== null && targetProjectId !== null
      ? { isCrossRepository: sourceProjectId !== targetProjectId }
      : {}),
    ...(normalizedSourceProjectPath ? { headRepositoryNameWithOwner: normalizedSourceProjectPath } : {}),
    ...(headRepositoryOwnerLogin ? { headRepositoryOwnerLogin } : {}),
  };
}

function parseGiteaSummary(value: unknown): GitHostingPullRequestSummary | null {
  const record = toObjectRecord(value);
  if (!record) {
    return null;
  }

  const number = toPositiveInt(record.number);
  const title = toStringValue(record.title);
  const url = toStringValue(record.html_url);
  const base = toObjectRecord(record.base);
  const head = toObjectRecord(record.head);
  const baseRefName = toStringValue(base?.ref);
  const headRefName = toStringValue(head?.ref);
  if (!number || !title || !url || !baseRefName || !headRefName) {
    return null;
  }

  const headRepo = toObjectRecord(head?.repo);
  const baseRepo = toObjectRecord(base?.repo);
  const headOwner = toObjectRecord(headRepo?.owner);
  const headRepositoryNameWithOwner =
    toStringValue(headRepo?.full_name) ?? toStringValue(headRepo?.name);
  const headRepositoryOwnerLogin =
    toStringValue(headOwner?.login) ?? toStringValue(headOwner?.username);
  const baseRepositoryNameWithOwner =
    toStringValue(baseRepo?.full_name) ?? toStringValue(baseRepo?.name);

  return {
    number,
    title,
    url,
    baseRefName,
    headRefName,
    state: normalizePullRequestState({
      state: toStringValue(record.state),
      mergedAt: toNullableStringValue(record.merged_at),
      merged:
        toBooleanValue(record.merged) ??
        toBooleanValue(record.has_merged) ??
        false,
    }),
    updatedAt: toNullableStringValue(record.updated_at),
    ...(headRepositoryNameWithOwner && baseRepositoryNameWithOwner
      ? {
          isCrossRepository:
            headRepositoryNameWithOwner.toLowerCase() !==
            baseRepositoryNameWithOwner.toLowerCase(),
        }
      : {}),
    ...(headRepositoryNameWithOwner ? { headRepositoryNameWithOwner } : {}),
    ...(headRepositoryOwnerLogin ? { headRepositoryOwnerLogin } : {}),
  };
}

function parseGitLabRepositoryCloneUrls(
  value: unknown,
): { nameWithOwner: string; url: string; sshUrl: string } | null {
  const record = toObjectRecord(value);
  const nameWithOwner = toStringValue(record?.path_with_namespace);
  const url = toStringValue(record?.http_url_to_repo);
  const sshUrl = toStringValue(record?.ssh_url_to_repo);
  if (!nameWithOwner || !url || !sshUrl) {
    return null;
  }
  return { nameWithOwner, url, sshUrl };
}

function parseGiteaRepositoryCloneUrls(
  value: unknown,
): { nameWithOwner: string; url: string; sshUrl: string } | null {
  const record = toObjectRecord(value);
  const nameWithOwner = toStringValue(record?.full_name);
  const url = toStringValue(record?.clone_url);
  const sshUrl = toStringValue(record?.ssh_url);
  if (!nameWithOwner || !url || !sshUrl) {
    return null;
  }
  return { nameWithOwner, url, sshUrl };
}

function normalizeGitLabError(operation: string, error: unknown): GitHostingCliError {
  if (error instanceof Error) {
    if (error.message.includes("Command not found: glab")) {
      return new GitHostingCliError({
        operation,
        detail: "GitLab CLI (`glab`) is required but not available on PATH.",
        cause: error,
      });
    }

    const lower = error.message.toLowerCase();
    if (
      lower.includes("glab auth login") ||
      lower.includes("not logged in") ||
      lower.includes("authentication") ||
      lower.includes("unauthorized") ||
      lower.includes("forbidden")
    ) {
      return new GitHostingCliError({
        operation,
        detail: "GitLab CLI is not authenticated. Run `glab auth login` and retry.",
        cause: error,
      });
    }

    if (
      lower.includes("merge request not found") ||
      lower.includes("404 project not found") ||
      lower.includes("404 not found")
    ) {
      return new GitHostingCliError({
        operation,
        detail: "Pull request not found. Check the PR number or URL and try again.",
        cause: error,
      });
    }

    return new GitHostingCliError({
      operation,
      detail: `GitLab CLI command failed: ${error.message}`,
      cause: error,
    });
  }

  return new GitHostingCliError({
    operation,
    detail: "GitLab CLI command failed.",
    cause: error,
  });
}

function normalizeGiteaError(operation: string, error: unknown): GitHostingCliError {
  if (error instanceof Error) {
    if (error.message.includes("Command not found: tea")) {
      return new GitHostingCliError({
        operation,
        detail: "Gitea CLI (`tea`) is required but not available on PATH.",
        cause: error,
      });
    }

    const lower = error.message.toLowerCase();
    if (
      lower.includes("tea login add") ||
      lower.includes("no logins") ||
      lower.includes("not logged in") ||
      lower.includes("unauthorized") ||
      lower.includes("forbidden")
    ) {
      return new GitHostingCliError({
        operation,
        detail: "Gitea CLI is not authenticated. Run `tea login add` and retry.",
        cause: error,
      });
    }

    if (
      lower.includes("404") ||
      lower.includes("not found") ||
      lower.includes("pull request index is required")
    ) {
      return new GitHostingCliError({
        operation,
        detail: "Pull request not found. Check the PR number or URL and try again.",
        cause: error,
      });
    }

    return new GitHostingCliError({
      operation,
      detail: `Gitea CLI command failed: ${error.message}`,
      cause: error,
    });
  }

  return new GitHostingCliError({
    operation,
    detail: "Gitea CLI command failed.",
    cause: error,
  });
}

function normalizeGitHubError(operation: string, error: unknown): GitHostingCliError {
  if (error instanceof Error) {
    return new GitHostingCliError({
      operation,
      detail: error.message,
      cause: error,
    });
  }

  return new GitHostingCliError({
    operation,
    detail: "GitHub CLI command failed.",
    cause: error,
  });
}

async function probePlatformFromBaseUrl(baseUrl: string, path: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, DETECTION_TIMEOUT_MS);

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      return false;
    }

    const data = await response.json().catch(() => null);
    return !!(data && typeof data === "object" && "version" in data);
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveRepositoryRemoteUrl(cwd: string): Promise<string | null> {
  try {
    const origin = await runProcess("git", ["remote", "get-url", "origin"], {
      cwd,
      timeoutMs: DEFAULT_TIMEOUT_MS,
    });
    const trimmed = origin.stdout.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  } catch {
    // fall through
  }

  try {
    const remotes = await runProcess("git", ["remote"], {
      cwd,
      timeoutMs: DEFAULT_TIMEOUT_MS,
    });
    for (const remoteName of remotes.stdout.split(/\r?\n/g).map((value) => value.trim())) {
      if (remoteName.length === 0) {
        continue;
      }
      try {
        const result = await runProcess("git", ["remote", "get-url", remoteName], {
          cwd,
          timeoutMs: DEFAULT_TIMEOUT_MS,
        });
        const trimmed = result.stdout.trim();
        if (trimmed.length > 0) {
          return trimmed;
        }
      } catch {
        // keep probing other remotes
      }
    }
  } catch {
    // ignored
  }

  return null;
}

const makeGitHostingCli = Effect.gen(function* () {
  const gitHubCli = yield* GitHubCli;

  const platformCache = new Map<string, "github" | "gitlab" | "gitea">();
  const hostProbeCache = new Map<string, "gitlab" | "gitea" | null>();

  const detectPlatform = (cwd: string, reference?: string) =>
    Effect.tryPromise({
      try: async () => {
        const referencePlatform = reference ? parsePullRequestReferenceUrl(reference)?.platform : null;
        if (referencePlatform) {
          return referencePlatform;
        }

        const cached = platformCache.get(cwd);
        if (cached) {
          return cached;
        }

        const remoteUrl = await resolveRepositoryRemoteUrl(cwd);
        const host = parseRemoteHostFromUrl(remoteUrl);
        const hostPlatform = detectHostingPlatformFromHost(host);
        if (hostPlatform) {
          platformCache.set(cwd, hostPlatform);
          return hostPlatform;
        }

        const baseUrl = deriveWebBaseUrlFromRemoteUrl(remoteUrl);
        if (baseUrl) {
          const cachedProbe = hostProbeCache.get(baseUrl);
          if (cachedProbe) {
            platformCache.set(cwd, cachedProbe);
            return cachedProbe;
          }

          if (await probePlatformFromBaseUrl(baseUrl, "/api/v4/version")) {
            hostProbeCache.set(baseUrl, "gitlab");
            platformCache.set(cwd, "gitlab");
            return "gitlab";
          }
          if (await probePlatformFromBaseUrl(baseUrl, "/api/v1/version")) {
            hostProbeCache.set(baseUrl, "gitea");
            platformCache.set(cwd, "gitea");
            return "gitea";
          }

          hostProbeCache.set(baseUrl, null);
        }

        platformCache.set(cwd, "github");
        return "github";
      },
      catch: (error) =>
        new GitHostingCliError({
          operation: "detectPlatform",
          detail: error instanceof Error ? error.message : "Failed to detect git hosting provider.",
          cause: error,
        }),
    });

  const runGlab = (operation: string, cwd: string, args: ReadonlyArray<string>) =>
    Effect.tryPromise({
      try: () =>
        runProcess("glab", args, {
          cwd,
          timeoutMs: DEFAULT_TIMEOUT_MS,
        }),
      catch: (error) => normalizeGitLabError(operation, error),
    });

  const runTea = (operation: string, cwd: string, args: ReadonlyArray<string>) =>
    Effect.tryPromise({
      try: () =>
        runProcess("tea", args, {
          cwd,
          timeoutMs: DEFAULT_TIMEOUT_MS,
        }),
      catch: (error) => normalizeGiteaError(operation, error),
    });

  const resolveGitLabSourceProjectPath = (cwd: string, sourceProjectId: number | null) =>
    sourceProjectId === null
      ? Effect.succeed<string | null>(null)
      : runGlab("getPullRequest", cwd, ["api", `projects/${sourceProjectId}`]).pipe(
          Effect.map((result) => result.stdout.trim()),
          Effect.flatMap((raw) =>
            Effect.try({
              try: () => parseJson(raw),
              catch: (error) => normalizeGitLabError("getPullRequest", error),
            }),
          ),
          Effect.map((json) => {
            const record = toObjectRecord(json);
            return toStringValue(record?.path_with_namespace);
          }),
        );

  const listGitLabPullRequests: GitHostingCliShape["listPullRequests"] = (input) =>
    runGlab("listPullRequests", input.cwd, [
      "mr",
      "list",
      ...(input.state === "all"
        ? ["--all"]
        : input.state === "closed"
          ? ["--closed"]
          : input.state === "merged"
            ? ["--merged"]
            : []),
      "--source-branch",
      input.headBranch,
      "--per-page",
      String(input.limit ?? 1),
      "--output",
      "json",
    ]).pipe(
      Effect.map((result) => result.stdout.trim()),
      Effect.flatMap((raw) =>
        raw.length === 0
          ? Effect.succeed([])
          : Effect.try({
              try: () => parseJson(raw),
              catch: (error) => normalizeGitLabError("listPullRequests", error),
            }),
      ),
      Effect.map((json) => {
        if (!Array.isArray(json)) {
          return [];
        }
        return json
          .map((entry) => parseGitLabSummary(entry))
          .filter((entry): entry is GitHostingPullRequestSummary => entry !== null);
      }),
    );

  const getGitLabPullRequest: GitHostingCliShape["getPullRequest"] = (input) =>
    Effect.gen(function* () {
      const parsedReference = parsePullRequestReferenceUrl(input.reference);
      const viewResult = yield* runGlab("getPullRequest", input.cwd, [
        "mr",
        "view",
        ...(parsedReference?.repositoryNameWithOwner
          ? ["--repo", parsedReference.repositoryNameWithOwner]
          : []),
        String(parsedReference?.number ?? input.reference),
        "--output",
        "json",
      ]);
      const raw = yield* Effect.try({
        try: () => parseJson(viewResult.stdout.trim()),
        catch: (error) => normalizeGitLabError("getPullRequest", error),
      });
      const record = toObjectRecord(raw);
      const sourceProjectId =
        record && typeof record.source_project_id === "number" ? record.source_project_id : null;
      const summary = parseGitLabSummary(
        raw,
        yield* resolveGitLabSourceProjectPath(input.cwd, sourceProjectId),
      );
      if (!summary) {
        return yield* new GitHostingCliError({
          operation: "getPullRequest",
          detail: "GitLab CLI returned invalid merge request JSON.",
        });
      }
      return summary;
    });

  const createGitLabPullRequest: GitHostingCliShape["createPullRequest"] = (input) =>
    Effect.tryPromise({
      try: async () => {
        const body = await readFile(input.bodyFile, "utf8");
        await runProcess(
          "glab",
          [
            "mr",
            "create",
            "--target-branch",
            input.baseBranch,
            "--source-branch",
            input.headBranch,
            "--title",
            input.title,
            "--description",
            body,
            "--yes",
            ...(input.headRepositoryNameWithOwner
              ? ["--head", input.headRepositoryNameWithOwner]
              : []),
          ],
          {
            cwd: input.cwd,
            timeoutMs: DEFAULT_TIMEOUT_MS,
          },
        );
      },
      catch: (error) => normalizeGitLabError("createPullRequest", error),
    });

  const getGitLabDefaultBranch: GitHostingCliShape["getDefaultBranch"] = (input) =>
    runGlab("getDefaultBranch", input.cwd, ["repo", "view", "--output", "json"]).pipe(
      Effect.map((result) => result.stdout.trim()),
      Effect.flatMap((raw) =>
        Effect.try({
          try: () => parseJson(raw),
          catch: (error) => normalizeGitLabError("getDefaultBranch", error),
        }),
      ),
      Effect.map((json) => {
        const record = toObjectRecord(json);
        return toStringValue(record?.default_branch);
      }),
    );

  const getGitLabRepositoryCloneUrls: GitHostingCliShape["getRepositoryCloneUrls"] = (input) =>
    runGlab("getRepositoryCloneUrls", input.cwd, [
      "repo",
      "view",
      input.repository,
      "--output",
      "json",
    ]).pipe(
      Effect.map((result) => result.stdout.trim()),
      Effect.flatMap((raw) =>
        Effect.try({
          try: () => parseJson(raw),
          catch: (error) => normalizeGitLabError("getRepositoryCloneUrls", error),
        }),
      ),
      Effect.flatMap((json) => {
        const cloneUrls = parseGitLabRepositoryCloneUrls(json);
        if (!cloneUrls) {
          return Effect.fail(
            new GitHostingCliError({
              operation: "getRepositoryCloneUrls",
              detail: "GitLab CLI returned invalid repository JSON.",
            }),
          );
        }
        return Effect.succeed(cloneUrls);
      }),
    );

  const checkoutGitLabPullRequest: GitHostingCliShape["checkoutPullRequest"] = (input) => {
    const parsedReference = parsePullRequestReferenceUrl(input.reference);
    return runGlab("checkoutPullRequest", input.cwd, [
      "mr",
      "checkout",
      ...(parsedReference?.repositoryNameWithOwner
        ? ["--repo", parsedReference.repositoryNameWithOwner]
        : []),
      String(parsedReference?.number ?? input.reference),
    ]).pipe(Effect.asVoid);
  };

  const listGiteaPullRequests: GitHostingCliShape["listPullRequests"] = (input) =>
    runTea("listPullRequests", input.cwd, [
      "api",
      `/repos/{owner}/{repo}/pulls?state=${encodeURIComponent(
        input.state === "merged" ? "closed" : input.state,
      )}&page=1&limit=${encodeURIComponent(String(input.limit ?? 1))}`,
    ]).pipe(
      Effect.map((result) => result.stdout.trim()),
      Effect.flatMap((raw) =>
        raw.length === 0
          ? Effect.succeed([])
          : Effect.try({
              try: () => parseJson(raw),
              catch: (error) => normalizeGiteaError("listPullRequests", error),
            }),
      ),
      Effect.map((json) => {
        if (!Array.isArray(json)) {
          return [];
        }

        const expectedHeadNames = new Set(
          [input.headBranch, input.headSelector]
            .map((value) => value.trim())
            .filter((value) => value.length > 0),
        );
        if (input.headRepositoryOwnerLogin?.trim()) {
          expectedHeadNames.add(`${input.headRepositoryOwnerLogin.trim()}:${input.headBranch}`);
        }

        return json
          .map((entry) => {
            const summary = parseGiteaSummary(entry);
            if (!summary) {
              return null;
            }

            const record = toObjectRecord(entry);
            const head = toObjectRecord(record?.head);
            const headLabel = toStringValue(head?.label);
            if (expectedHeadNames.size === 0) {
              return summary;
            }

            return expectedHeadNames.has(summary.headRefName) ||
              (headLabel !== null && expectedHeadNames.has(headLabel))
              ? summary
              : null;
          })
          .filter((entry): entry is GitHostingPullRequestSummary => entry !== null);
      }),
    );

  const getGiteaPullRequest: GitHostingCliShape["getPullRequest"] = (input) => {
    const parsedReference = parsePullRequestReferenceUrl(input.reference);
    return runTea("getPullRequest", input.cwd, [
      "api",
      ...(parsedReference?.repositoryNameWithOwner
        ? ["--repo", parsedReference.repositoryNameWithOwner]
        : []),
      `/repos/${parsedReference?.repositoryNameWithOwner ?? "{owner}/{repo}"}/pulls/${
        parsedReference?.number ?? input.reference
      }`,
    ]).pipe(
      Effect.map((result) => result.stdout.trim()),
      Effect.flatMap((raw) =>
        Effect.try({
          try: () => parseJson(raw),
          catch: (error) => normalizeGiteaError("getPullRequest", error),
        }),
      ),
      Effect.flatMap((json) => {
        const summary = parseGiteaSummary(json);
        if (!summary) {
          return Effect.fail(
            new GitHostingCliError({
              operation: "getPullRequest",
              detail: "Gitea CLI returned invalid pull request JSON.",
            }),
          );
        }
        return Effect.succeed(summary);
      }),
    );
  };

  const createGiteaPullRequest: GitHostingCliShape["createPullRequest"] = (input) =>
    Effect.tryPromise({
      try: async () => {
        const body = await readFile(input.bodyFile, "utf8");
        const head =
          input.headRepositoryOwnerLogin?.trim()
            ? `${input.headRepositoryOwnerLogin.trim()}:${input.headBranch}`
            : input.headBranch;
        await runProcess(
          "tea",
          [
            "pulls",
            "create",
            "--base",
            input.baseBranch,
            "--head",
            head,
            "--title",
            input.title,
            "--description",
            body,
          ],
          {
            cwd: input.cwd,
            timeoutMs: DEFAULT_TIMEOUT_MS,
          },
        );
      },
      catch: (error) => normalizeGiteaError("createPullRequest", error),
    });

  const getGiteaRepositoryCloneUrls: GitHostingCliShape["getRepositoryCloneUrls"] = (input) =>
    runTea("getRepositoryCloneUrls", input.cwd, ["api", `/repos/${input.repository}`]).pipe(
      Effect.map((result) => result.stdout.trim()),
      Effect.flatMap((raw) =>
        Effect.try({
          try: () => parseJson(raw),
          catch: (error) => normalizeGiteaError("getRepositoryCloneUrls", error),
        }),
      ),
      Effect.flatMap((json) => {
        const cloneUrls = parseGiteaRepositoryCloneUrls(json);
        if (!cloneUrls) {
          return Effect.fail(
            new GitHostingCliError({
              operation: "getRepositoryCloneUrls",
              detail: "Gitea CLI returned invalid repository JSON.",
            }),
          );
        }
        return Effect.succeed(cloneUrls);
      }),
    );

  const getGiteaDefaultBranch: GitHostingCliShape["getDefaultBranch"] = (input) =>
    runTea("getDefaultBranch", input.cwd, ["api", "/repos/{owner}/{repo}"]).pipe(
      Effect.map((result) => result.stdout.trim()),
      Effect.flatMap((raw) =>
        Effect.try({
          try: () => parseJson(raw),
          catch: (error) => normalizeGiteaError("getDefaultBranch", error),
        }),
      ),
      Effect.map((json) => {
        const record = toObjectRecord(json);
        return toStringValue(record?.default_branch);
      }),
    );

  const checkoutGiteaPullRequest: GitHostingCliShape["checkoutPullRequest"] = (input) => {
    const parsedReference = parsePullRequestReferenceUrl(input.reference);
    return runTea("checkoutPullRequest", input.cwd, [
      "pulls",
      "checkout",
      ...(parsedReference?.repositoryNameWithOwner
        ? ["--repo", parsedReference.repositoryNameWithOwner]
        : []),
      "--branch",
      String(parsedReference?.number ?? input.reference),
    ]).pipe(Effect.asVoid);
  };

  const service = {
    listPullRequests: (input) =>
      detectPlatform(input.cwd).pipe(
        Effect.flatMap((platform) => {
          if (platform === "gitlab") {
            return listGitLabPullRequests(input);
          }
          if (platform === "gitea") {
            return listGiteaPullRequests(input);
          }
          return gitHubCli
            .listPullRequests({
              cwd: input.cwd,
              headSelector: input.headSelector,
              state: input.state,
              ...(input.limit !== undefined ? { limit: input.limit } : {}),
            })
            .pipe(Effect.mapError((error) => normalizeGitHubError("listPullRequests", error)));
        }),
      ),
    getPullRequest: (input) =>
      detectPlatform(input.cwd, input.reference).pipe(
        Effect.flatMap((platform) => {
          if (platform === "gitlab") {
            return getGitLabPullRequest(input);
          }
          if (platform === "gitea") {
            return getGiteaPullRequest(input);
          }
          return gitHubCli
            .getPullRequest(input)
            .pipe(Effect.mapError((error) => normalizeGitHubError("getPullRequest", error)));
        }),
      ),
    getRepositoryCloneUrls: (input) =>
      detectPlatform(input.cwd).pipe(
        Effect.flatMap((platform) => {
          if (platform === "gitlab") {
            return getGitLabRepositoryCloneUrls(input);
          }
          if (platform === "gitea") {
            return getGiteaRepositoryCloneUrls(input);
          }
          return gitHubCli
            .getRepositoryCloneUrls(input)
            .pipe(
              Effect.mapError((error) => normalizeGitHubError("getRepositoryCloneUrls", error)),
            );
        }),
      ),
    createPullRequest: (input) =>
      detectPlatform(input.cwd).pipe(
        Effect.flatMap((platform) => {
          if (platform === "gitlab") {
            return createGitLabPullRequest(input);
          }
          if (platform === "gitea") {
            return createGiteaPullRequest(input);
          }
          const headSelector =
            input.headRepositoryOwnerLogin?.trim()
              ? `${input.headRepositoryOwnerLogin.trim()}:${input.headBranch}`
              : input.headBranch;
          return gitHubCli
            .createPullRequest({
              cwd: input.cwd,
              baseBranch: input.baseBranch,
              headSelector,
              title: input.title,
              bodyFile: input.bodyFile,
            })
            .pipe(Effect.mapError((error) => normalizeGitHubError("createPullRequest", error)));
        }),
      ),
    getDefaultBranch: (input) =>
      detectPlatform(input.cwd).pipe(
        Effect.flatMap((platform) => {
          if (platform === "gitlab") {
            return getGitLabDefaultBranch(input);
          }
          if (platform === "gitea") {
            return getGiteaDefaultBranch(input);
          }
          return gitHubCli
            .getDefaultBranch(input)
            .pipe(Effect.mapError((error) => normalizeGitHubError("getDefaultBranch", error)));
        }),
      ),
    checkoutPullRequest: (input) =>
      detectPlatform(input.cwd, input.reference).pipe(
        Effect.flatMap((platform) => {
          if (platform === "gitlab") {
            return checkoutGitLabPullRequest(input);
          }
          if (platform === "gitea") {
            return checkoutGiteaPullRequest(input);
          }
          return gitHubCli
            .checkoutPullRequest(input)
            .pipe(Effect.mapError((error) => normalizeGitHubError("checkoutPullRequest", error)));
        }),
      ),
  } satisfies GitHostingCliShape;

  return service;
});

export const GitHostingCliLive = Layer.effect(GitHostingCli, makeGitHostingCli);
