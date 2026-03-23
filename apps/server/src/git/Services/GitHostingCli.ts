import { ServiceMap } from "effect";
import type { Effect } from "effect";

import type { GitHostingCliError } from "../Errors.ts";

export interface GitHostingPullRequestSummary {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly baseRefName: string;
  readonly headRefName: string;
  readonly state?: "open" | "closed" | "merged";
  readonly updatedAt?: string | null;
  readonly isCrossRepository?: boolean;
  readonly headRepositoryNameWithOwner?: string | null;
  readonly headRepositoryOwnerLogin?: string | null;
}

export interface GitHostingRepositoryCloneUrls {
  readonly nameWithOwner: string;
  readonly url: string;
  readonly sshUrl: string;
}

export interface GitHostingCliShape {
  readonly listPullRequests: (input: {
    readonly cwd: string;
    readonly headSelector: string;
    readonly headBranch: string;
    readonly state: "open" | "closed" | "merged" | "all";
    readonly limit?: number;
    readonly headRepositoryNameWithOwner?: string | null;
    readonly headRepositoryOwnerLogin?: string | null;
  }) => Effect.Effect<ReadonlyArray<GitHostingPullRequestSummary>, GitHostingCliError>;

  readonly getPullRequest: (input: {
    readonly cwd: string;
    readonly reference: string;
  }) => Effect.Effect<GitHostingPullRequestSummary, GitHostingCliError>;

  readonly getRepositoryCloneUrls: (input: {
    readonly cwd: string;
    readonly repository: string;
  }) => Effect.Effect<GitHostingRepositoryCloneUrls, GitHostingCliError>;

  readonly createPullRequest: (input: {
    readonly cwd: string;
    readonly baseBranch: string;
    readonly headBranch: string;
    readonly title: string;
    readonly bodyFile: string;
    readonly headRepositoryNameWithOwner?: string | null;
    readonly headRepositoryOwnerLogin?: string | null;
  }) => Effect.Effect<void, GitHostingCliError>;

  readonly getDefaultBranch: (input: {
    readonly cwd: string;
  }) => Effect.Effect<string | null, GitHostingCliError>;

  readonly checkoutPullRequest: (input: {
    readonly cwd: string;
    readonly reference: string;
    readonly force?: boolean;
  }) => Effect.Effect<void, GitHostingCliError>;
}

export class GitHostingCli extends ServiceMap.Service<GitHostingCli, GitHostingCliShape>()(
  "t3/git/Services/GitHostingCli",
) {}
