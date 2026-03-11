export type GitHostingPlatform = "github" | "gitlab" | "gitea";

export interface ParsedPullRequestReferenceUrl {
  readonly platform: GitHostingPlatform;
  readonly host: string;
  readonly repositoryNameWithOwner: string;
  readonly number: number;
  readonly url: string;
}

interface ParsedRemoteUrl {
  readonly protocol: "https" | "http" | "ssh" | "scp" | "git";
  readonly host: string;
  readonly port: string | null;
  readonly user: string | null;
  readonly repositoryNameWithOwner: string;
}

function normalizeRepositoryNameWithOwner(value: string | null | undefined): string | null {
  const trimmed = value?.trim().replace(/\/+$/g, "") ?? "";
  if (trimmed.length === 0) {
    return null;
  }

  const withoutGitSuffix = trimmed.replace(/\.git$/i, "").trim();
  if (withoutGitSuffix.length === 0) {
    return null;
  }

  const normalized = withoutGitSuffix
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .join("/");

  return normalized.length > 0 ? normalized : null;
}

function normalizeHost(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toLowerCase() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function parseRemoteUrl(url: string | null | undefined): ParsedRemoteUrl | null {
  const trimmed = url?.trim() ?? "";
  if (trimmed.length === 0) {
    return null;
  }

  const scpMatch = /^(?<user>[^@\s]+)@(?<host>[^:\s]+):(?<path>.+)$/.exec(trimmed);
  if (scpMatch?.groups) {
    const repositoryNameWithOwner = normalizeRepositoryNameWithOwner(scpMatch.groups.path);
    const host = normalizeHost(scpMatch.groups.host);
    if (repositoryNameWithOwner && host) {
      return {
        protocol: "scp",
        host,
        port: null,
        user: scpMatch.groups.user?.trim() || "git",
        repositoryNameWithOwner,
      };
    }
  }

  try {
    const parsed = new URL(trimmed);
    const host = normalizeHost(parsed.hostname);
    const repositoryNameWithOwner = normalizeRepositoryNameWithOwner(parsed.pathname);
    if (!host || !repositoryNameWithOwner) {
      return null;
    }

    const protocol = parsed.protocol.replace(/:$/g, "");
    if (
      protocol !== "https" &&
      protocol !== "http" &&
      protocol !== "ssh" &&
      protocol !== "git"
    ) {
      return null;
    }

    return {
      protocol,
      host,
      port: parsed.port.trim() || null,
      user: parsed.username.trim() || null,
      repositoryNameWithOwner,
    };
  } catch {
    return null;
  }
}

export function parseRepositoryNameWithOwnerFromRemoteUrl(url: string | null): string | null {
  return parseRemoteUrl(url)?.repositoryNameWithOwner ?? null;
}

export function parseRemoteHostFromUrl(url: string | null): string | null {
  return parseRemoteUrl(url)?.host ?? null;
}

export function buildRepositoryCloneUrlsFromRemoteUrl(
  sourceRemoteUrl: string | null,
  repositoryNameWithOwner: string,
): { url: string; sshUrl: string } | null {
  const parsed = parseRemoteUrl(sourceRemoteUrl);
  const normalizedRepositoryNameWithOwner =
    normalizeRepositoryNameWithOwner(repositoryNameWithOwner);
  if (!parsed || !normalizedRepositoryNameWithOwner) {
    return null;
  }

  const hostWithPort = parsed.port ? `${parsed.host}:${parsed.port}` : parsed.host;
  const urlProtocol = parsed.protocol === "http" ? "http" : "https";
  const sshUser = parsed.user?.trim() || "git";

  const url = `${urlProtocol}://${hostWithPort}/${normalizedRepositoryNameWithOwner}.git`;
  const sshUrl =
    parsed.protocol === "ssh"
      ? `ssh://${sshUser}@${hostWithPort}/${normalizedRepositoryNameWithOwner}.git`
      : `${sshUser}@${parsed.host}:${normalizedRepositoryNameWithOwner}.git`;

  return { url, sshUrl };
}

export function deriveWebBaseUrlFromRemoteUrl(sourceRemoteUrl: string | null): string | null {
  const parsed = parseRemoteUrl(sourceRemoteUrl);
  if (!parsed) {
    return null;
  }

  if (parsed.protocol === "https" || parsed.protocol === "http") {
    const hostWithPort = parsed.port ? `${parsed.host}:${parsed.port}` : parsed.host;
    return `${parsed.protocol}://${hostWithPort}`;
  }

  return `https://${parsed.host}`;
}

export function detectHostingPlatformFromHost(host: string | null): GitHostingPlatform | null {
  const normalizedHost = normalizeHost(host);
  if (!normalizedHost) {
    return null;
  }

  if (
    normalizedHost === "github.com" ||
    normalizedHost.endsWith(".github.com") ||
    normalizedHost.includes("github")
  ) {
    return "github";
  }

  if (
    normalizedHost === "gitlab.com" ||
    normalizedHost.endsWith(".gitlab.com") ||
    normalizedHost.includes("gitlab")
  ) {
    return "gitlab";
  }

  if (
    normalizedHost === "gitea.com" ||
    normalizedHost.endsWith(".gitea.com") ||
    normalizedHost.includes("gitea")
  ) {
    return "gitea";
  }

  return null;
}

function parsePullRequestUrlWithPattern(
  input: string,
  platform: GitHostingPlatform,
  pattern: RegExp,
): ParsedPullRequestReferenceUrl | null {
  const match = pattern.exec(input.trim());
  const host = normalizeHost(match?.groups?.host);
  const repositoryNameWithOwner = normalizeRepositoryNameWithOwner(
    match?.groups?.repositoryNameWithOwner,
  );
  const number = Number(match?.groups?.number ?? "");

  if (!host || !repositoryNameWithOwner || !Number.isInteger(number) || number <= 0) {
    return null;
  }

  return {
    platform,
    host,
    repositoryNameWithOwner,
    number,
    url: input.trim(),
  };
}

export function parsePullRequestReferenceUrl(
  input: string,
): ParsedPullRequestReferenceUrl | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return null;
  }

  return (
    parsePullRequestUrlWithPattern(
      trimmed,
      "github",
      /^https?:\/\/(?<host>[^/\s]+)\/(?<repositoryNameWithOwner>[^/\s]+\/[^/\s]+)\/pull\/(?<number>\d+)(?:[/?#].*)?$/i,
    ) ??
    parsePullRequestUrlWithPattern(
      trimmed,
      "gitlab",
      /^https?:\/\/(?<host>[^/\s]+)\/(?<repositoryNameWithOwner>.+?)\/(?:-\/)?merge[_-]requests\/(?<number>\d+)(?:[/?#].*)?$/i,
    ) ??
    parsePullRequestUrlWithPattern(
      trimmed,
      "gitea",
      /^https?:\/\/(?<host>[^/\s]+)\/(?<repositoryNameWithOwner>[^/\s]+\/[^/\s]+)\/pulls\/(?<number>\d+)(?:[/?#].*)?$/i,
    )
  );
}
