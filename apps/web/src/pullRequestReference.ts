const PULL_REQUEST_URL_PATTERN =
  /^https:\/\/[^/]+\/[^/\s]+\/[^/\s]+\/(?:pull|pulls|merge_requests)\/(\d+)(?:[/?#].*)?$/i;
const PULL_REQUEST_NUMBER_PATTERN = /^#?(\d+)$/;
const CLI_PR_CHECKOUT_PATTERN = /^(?:gh|tea)\s+pr\s+(?:checkout|view)\s+(.+)$/i;

export function parsePullRequestReference(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const cliCheckoutMatch = CLI_PR_CHECKOUT_PATTERN.exec(trimmed);
  const normalizedInput = cliCheckoutMatch?.[1]?.trim() ?? trimmed;
  if (normalizedInput.length === 0) {
    return null;
  }

  const urlMatch = PULL_REQUEST_URL_PATTERN.exec(normalizedInput);
  if (urlMatch?.[1]) {
    return normalizedInput;
  }

  const numberMatch = PULL_REQUEST_NUMBER_PATTERN.exec(normalizedInput);
  if (numberMatch?.[1]) {
    return numberMatch[1];
  }

  return null;
}
