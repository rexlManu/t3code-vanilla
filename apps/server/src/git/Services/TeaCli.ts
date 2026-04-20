import { Context } from "effect";
import type { Effect } from "effect";

import type { ProcessRunResult } from "../../processRunner.ts";
import type { GitHostingCliError } from "@t3tools/contracts";

export interface TeaPullRequestSummary {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly baseRefName: string;
  readonly headRefName: string;
  readonly state: "open" | "closed" | "merged";
  readonly updatedAt: string | null;
  readonly isCrossRepository?: boolean;
  readonly headRepositoryNameWithOwner?: string | null;
  readonly headRepositoryOwnerLogin?: string | null;
}

export interface TeaRepositoryInfo {
  readonly nameWithOwner: string;
  readonly url: string;
  readonly sshUrl: string;
  readonly defaultBranch: string | null;
}

export interface TeaCliShape {
  readonly execute: (input: {
    readonly cwd: string;
    readonly args: ReadonlyArray<string>;
    readonly timeoutMs?: number;
  }) => Effect.Effect<ProcessRunResult, GitHostingCliError>;

  readonly listPullRequests: (input: {
    readonly cwd: string;
    readonly state: "open" | "closed" | "merged" | "all";
    readonly limit?: number;
  }) => Effect.Effect<ReadonlyArray<TeaPullRequestSummary>, GitHostingCliError>;

  readonly getPullRequest: (input: {
    readonly cwd: string;
    readonly reference: string;
  }) => Effect.Effect<TeaPullRequestSummary, GitHostingCliError>;

  readonly getRepositoryInfo: (input: {
    readonly cwd: string;
    readonly repository?: string;
  }) => Effect.Effect<TeaRepositoryInfo, GitHostingCliError>;

  readonly createPullRequest: (input: {
    readonly cwd: string;
    readonly baseBranch: string;
    readonly headSelector: string;
    readonly title: string;
    readonly body: string;
  }) => Effect.Effect<void, GitHostingCliError>;
}

export class TeaCli extends Context.Service<TeaCli, TeaCliShape>()("t3/git/Services/TeaCli") {}
