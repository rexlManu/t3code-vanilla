import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { PositiveInt, TrimmedNonEmptyString } from "@t3tools/contracts";
import { decodeJsonResult, formatSchemaError } from "@t3tools/shared/schemaJson";

export interface NormalizedGiteaPullRequestRecord {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly baseRefName: string;
  readonly headRefName: string;
  readonly state: "open" | "closed" | "merged";
  readonly updatedAt: Option.Option<DateTime.Utc>;
  readonly isCrossRepository?: boolean;
  readonly headRepositoryNameWithOwner?: string | null;
  readonly headRepositoryOwnerLogin?: string | null;
}

const GiteaRepositoryReferenceSchema = Schema.Struct({
  full_name: Schema.optional(Schema.String),
  fullName: Schema.optional(Schema.String),
});

const GiteaUserSchema = Schema.Struct({
  login: Schema.optional(Schema.String),
});

const GiteaPullRequestBranchSchema = Schema.Struct({
  ref: TrimmedNonEmptyString,
  repo: Schema.optional(Schema.NullOr(GiteaRepositoryReferenceSchema)),
  user: Schema.optional(Schema.NullOr(GiteaUserSchema)),
});

const GiteaPullRequestSchema = Schema.Struct({
  number: Schema.optional(PositiveInt),
  index: Schema.optional(PositiveInt),
  title: TrimmedNonEmptyString,
  html_url: Schema.optional(TrimmedNonEmptyString),
  url: Schema.optional(TrimmedNonEmptyString),
  base: GiteaPullRequestBranchSchema,
  head: GiteaPullRequestBranchSchema,
  state: Schema.optional(Schema.NullOr(Schema.String)),
  merged: Schema.optional(Schema.Boolean),
  merged_at: Schema.optional(Schema.OptionFromNullOr(Schema.DateTimeUtcFromString)),
  updated_at: Schema.optional(Schema.OptionFromNullOr(Schema.DateTimeUtcFromString)),
});

function trimOptionalString(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeGiteaPullRequestState(
  raw: Schema.Schema.Type<typeof GiteaPullRequestSchema>,
): "open" | "closed" | "merged" {
  if (raw.merged === true || Option.isSome(raw.merged_at ?? Option.none())) {
    return "merged";
  }
  return raw.state?.trim().toLowerCase() === "closed" ? "closed" : "open";
}

function repositoryNameWithOwner(
  repository: Schema.Schema.Type<typeof GiteaRepositoryReferenceSchema> | null | undefined,
): string | null {
  return trimOptionalString(repository?.full_name) ?? trimOptionalString(repository?.fullName);
}

function ownerLoginFromRepository(repositoryName: string | null): string | null {
  const [owner] = repositoryName?.split("/") ?? [];
  return trimOptionalString(owner);
}

function normalizeGiteaPullRequestRecord(
  raw: Schema.Schema.Type<typeof GiteaPullRequestSchema>,
): NormalizedGiteaPullRequestRecord {
  const headRepositoryNameWithOwner = repositoryNameWithOwner(raw.head.repo);
  const baseRepositoryNameWithOwner = repositoryNameWithOwner(raw.base.repo);
  const headRepositoryOwnerLogin =
    trimOptionalString(raw.head.user?.login) ??
    ownerLoginFromRepository(headRepositoryNameWithOwner);
  const isCrossRepository =
    headRepositoryNameWithOwner !== null && baseRepositoryNameWithOwner !== null
      ? headRepositoryNameWithOwner.toLowerCase() !== baseRepositoryNameWithOwner.toLowerCase()
      : undefined;

  return {
    number: raw.number ?? raw.index ?? 0,
    title: raw.title,
    url: raw.html_url ?? raw.url ?? "",
    baseRefName: raw.base.ref,
    headRefName: raw.head.ref,
    state: normalizeGiteaPullRequestState(raw),
    updatedAt: raw.updated_at ?? Option.none(),
    ...(typeof isCrossRepository === "boolean" ? { isCrossRepository } : {}),
    ...(headRepositoryNameWithOwner ? { headRepositoryNameWithOwner } : {}),
    ...(headRepositoryOwnerLogin ? { headRepositoryOwnerLogin } : {}),
  };
}

const decodeGiteaPullRequestList = decodeJsonResult(Schema.Array(Schema.Unknown));
const decodeGiteaPullRequest = decodeJsonResult(GiteaPullRequestSchema);
const decodeGiteaPullRequestEntry = Schema.decodeUnknownExit(GiteaPullRequestSchema);

export const formatGiteaJsonDecodeError = formatSchemaError;

export function decodeGiteaPullRequestListJson(
  raw: string,
): Result.Result<ReadonlyArray<NormalizedGiteaPullRequestRecord>, Cause.Cause<Schema.SchemaError>> {
  const result = decodeGiteaPullRequestList(raw);
  if (Result.isFailure(result)) {
    return Result.fail(result.failure);
  }

  const pullRequests: NormalizedGiteaPullRequestRecord[] = [];
  for (const entry of result.success) {
    const decodedEntry = decodeGiteaPullRequestEntry(entry);
    if (Exit.isFailure(decodedEntry)) {
      continue;
    }
    pullRequests.push(normalizeGiteaPullRequestRecord(decodedEntry.value));
  }
  return Result.succeed(pullRequests);
}

export function decodeGiteaPullRequestJson(
  raw: string,
): Result.Result<NormalizedGiteaPullRequestRecord, Cause.Cause<Schema.SchemaError>> {
  const result = decodeGiteaPullRequest(raw);
  if (Result.isSuccess(result)) {
    return Result.succeed(normalizeGiteaPullRequestRecord(result.success));
  }
  return Result.fail(result.failure);
}
