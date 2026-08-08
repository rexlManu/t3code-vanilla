import * as Option from "effect/Option";

export type JoinPath = (first: string, ...segments: string[]) => string;

function normalizeConfiguredPath(value: Option.Option<string>): Option.Option<string> {
  if (Option.isNone(value)) {
    return Option.none();
  }
  const trimmed = value.value.trim();
  return trimmed.length > 0 ? Option.some(trimmed) : Option.none();
}

export function resolveDesktopBaseDir(input: {
  readonly homeDirectory: string;
  readonly joinPath: JoinPath;
  readonly t3Home: Option.Option<string>;
}): string {
  return Option.getOrElse(normalizeConfiguredPath(input.t3Home), () =>
    input.joinPath(input.homeDirectory, ".t3"),
  );
}

export function resolveDesktopStateDir(input: {
  readonly baseDir: string;
  readonly isDevelopment: boolean;
  readonly joinPath: JoinPath;
  readonly stateProfile: Option.Option<string>;
  readonly t3Home: Option.Option<string>;
}): string {
  const defaultProfile =
    input.isDevelopment && Option.isNone(normalizeConfiguredPath(input.t3Home))
      ? "dev"
      : "userdata";
  const stateProfile = Option.getOrElse(
    normalizeConfiguredPath(input.stateProfile),
    () => defaultProfile,
  );
  return input.joinPath(input.baseDir, stateProfile);
}
