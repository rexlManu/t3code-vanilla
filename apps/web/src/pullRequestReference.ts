const PULL_REQUEST_URL_PATTERNS = [
  /^https?:\/\/[^/\s]+\/[^/\s]+\/[^/\s]+\/pull\/(\d+)(?:[/?#].*)?$/i,
  /^https?:\/\/[^/\s]+\/.+?\/(?:-\/)?merge[_-]requests\/(\d+)(?:[/?#].*)?$/i,
  /^https?:\/\/[^/\s]+\/[^/\s]+\/[^/\s]+\/pulls\/(\d+)(?:[/?#].*)?$/i,
] as const;
const PULL_REQUEST_NUMBER_PATTERN = /^#?(\d+)$/;

export function parsePullRequestReference(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return null;
  }

  for (const pattern of PULL_REQUEST_URL_PATTERNS) {
    const urlMatch = pattern.exec(trimmed);
    if (urlMatch?.[1]) {
      return trimmed;
    }
  }

  const numberMatch = PULL_REQUEST_NUMBER_PATTERN.exec(trimmed);
  if (numberMatch?.[1]) {
    return trimmed.startsWith("#") ? trimmed : numberMatch[1];
  }

  return null;
}
