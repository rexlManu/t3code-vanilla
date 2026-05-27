// This file mostly exists because we want dev mode to say "T3 Code (Dev)" instead of "electron"

import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const isDevelopment = Boolean(process.env.VITE_DEV_SERVER_URL);
const APP_DISPLAY_NAME = isDevelopment ? "T3 Code (Dev)" : "T3 Code (Alpha)";
const APP_BUNDLE_ID = isDevelopment ? "com.t3tools.t3code.dev" : "com.t3tools.t3code";
const LAUNCHER_VERSION = 2;

const __dirname = dirname(fileURLToPath(import.meta.url));
export const desktopDir = resolve(__dirname, "..");
const repoRoot = resolve(desktopDir, "..", "..");
const defaultIconPath = join(desktopDir, "resources", "icon.icns");
const developmentMacIconPngPath = join(repoRoot, "assets", "dev", "blueprint-macos-1024.png");

function trimNonEmpty(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeLinuxOzonePlatform(value) {
  const normalized = trimNonEmpty(value)?.toLowerCase();
  if (normalized === "auto" || normalized === "wayland" || normalized === "x11") {
    return normalized;
  }

  return null;
}

function hasWaylandSession(env) {
  if (trimNonEmpty(env.WAYLAND_DISPLAY)) {
    return true;
  }

  return trimNonEmpty(env.XDG_SESSION_TYPE)?.toLowerCase() === "wayland";
}

function normalizeDeviceScaleFactor(value) {
  const normalized = trimNonEmpty(value);
  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? normalized : null;
}

export function resolveElectronLaunchArgs(env = process.env) {
  if (process.platform !== "linux") {
    return [];
  }

  const args = [];
  const configuredOzonePlatform = normalizeLinuxOzonePlatform(env.T3CODE_LINUX_OZONE_PLATFORM);
  const ozonePlatform = configuredOzonePlatform ?? (hasWaylandSession(env) ? "wayland" : null);
  if (ozonePlatform) {
    args.push("--enable-features=UseOzonePlatform,WaylandWindowDecorations");
    args.push(`--ozone-platform=${ozonePlatform}`);
    args.push("--disable-features=WaylandFractionalScaleV1");
    args.push("--enable-wayland-ime");
  }

  const deviceScaleFactor = normalizeDeviceScaleFactor(env.T3CODE_FORCE_DEVICE_SCALE_FACTOR);
  if (deviceScaleFactor) {
    args.push(`--force-device-scale-factor=${deviceScaleFactor}`);
  }

  return args;
}

function setPlistString(plistPath, key, value) {
  const replaceResult = spawnSync("plutil", ["-replace", key, "-string", value, plistPath], {
    encoding: "utf8",
  });
  if (replaceResult.status === 0) {
    return;
  }

  const insertResult = spawnSync("plutil", ["-insert", key, "-string", value, plistPath], {
    encoding: "utf8",
  });
  if (insertResult.status === 0) {
    return;
  }

  const details = [replaceResult.stderr, insertResult.stderr].filter(Boolean).join("\n");
  throw new Error(`Failed to update plist key "${key}" at ${plistPath}: ${details}`.trim());
}

function runChecked(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status === 0) {
    return;
  }

  const details = [result.stdout, result.stderr].filter(Boolean).join("\n");
  throw new Error(`Failed to run ${command} ${args.join(" ")}: ${details}`.trim());
}

function ensureDevelopmentIconIcns(runtimeDir) {
  const generatedIconPath = join(runtimeDir, "icon-dev.icns");
  mkdirSync(runtimeDir, { recursive: true });

  if (!existsSync(developmentMacIconPngPath)) {
    return defaultIconPath;
  }

  const sourceMtimeMs = statSync(developmentMacIconPngPath).mtimeMs;
  if (existsSync(generatedIconPath) && statSync(generatedIconPath).mtimeMs >= sourceMtimeMs) {
    return generatedIconPath;
  }

  const iconsetRoot = mkdtempSync(join(runtimeDir, "dev-iconset-"));
  const iconsetDir = join(iconsetRoot, "icon.iconset");
  mkdirSync(iconsetDir, { recursive: true });

  try {
    for (const size of [16, 32, 128, 256, 512]) {
      runChecked("sips", [
        "-z",
        String(size),
        String(size),
        developmentMacIconPngPath,
        "--out",
        join(iconsetDir, `icon_${size}x${size}.png`),
      ]);

      const retinaSize = size * 2;
      runChecked("sips", [
        "-z",
        String(retinaSize),
        String(retinaSize),
        developmentMacIconPngPath,
        "--out",
        join(iconsetDir, `icon_${size}x${size}@2x.png`),
      ]);
    }

    runChecked("iconutil", ["-c", "icns", iconsetDir, "-o", generatedIconPath]);
    return generatedIconPath;
  } catch (error) {
    console.warn(
      "[desktop-launcher] Failed to generate dev macOS icon, falling back to default icon.",
      error,
    );
    return defaultIconPath;
  } finally {
    rmSync(iconsetRoot, { recursive: true, force: true });
  }
}

function patchMainBundleInfoPlist(appBundlePath, iconPath) {
  const infoPlistPath = join(appBundlePath, "Contents", "Info.plist");
  setPlistString(infoPlistPath, "CFBundleDisplayName", APP_DISPLAY_NAME);
  setPlistString(infoPlistPath, "CFBundleName", APP_DISPLAY_NAME);
  setPlistString(infoPlistPath, "CFBundleIdentifier", APP_BUNDLE_ID);
  setPlistString(infoPlistPath, "CFBundleIconFile", "icon.icns");

  const resourcesDir = join(appBundlePath, "Contents", "Resources");
  copyFileSync(iconPath, join(resourcesDir, "icon.icns"));
  copyFileSync(iconPath, join(resourcesDir, "electron.icns"));
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function buildMacLauncher(electronBinaryPath) {
  const sourceAppBundlePath = resolve(electronBinaryPath, "../../..");
  const runtimeDir = join(desktopDir, ".electron-runtime");
  const targetAppBundlePath = join(runtimeDir, `${APP_DISPLAY_NAME}.app`);
  const targetBinaryPath = join(targetAppBundlePath, "Contents", "MacOS", "Electron");
  const iconPath = isDevelopment ? ensureDevelopmentIconIcns(runtimeDir) : defaultIconPath;
  const metadataPath = join(runtimeDir, "metadata.json");

  mkdirSync(runtimeDir, { recursive: true });

  const expectedMetadata = {
    launcherVersion: LAUNCHER_VERSION,
    sourceAppBundlePath,
    sourceAppMtimeMs: statSync(sourceAppBundlePath).mtimeMs,
    iconMtimeMs: statSync(iconPath).mtimeMs,
  };

  const currentMetadata = readJson(metadataPath);
  if (
    existsSync(targetBinaryPath) &&
    currentMetadata &&
    JSON.stringify(currentMetadata) === JSON.stringify(expectedMetadata)
  ) {
    return targetBinaryPath;
  }

  rmSync(targetAppBundlePath, { recursive: true, force: true });
  cpSync(sourceAppBundlePath, targetAppBundlePath, { recursive: true });
  patchMainBundleInfoPlist(targetAppBundlePath, iconPath);
  writeFileSync(metadataPath, `${JSON.stringify(expectedMetadata, null, 2)}\n`);

  return targetBinaryPath;
}

export function resolveElectronPath() {
  const require = createRequire(import.meta.url);
  const electronBinaryPath = require("electron");

  if (process.platform !== "darwin") {
    return electronBinaryPath;
  }

  // Dev launches do not need a renamed app bundle badly enough to risk breaking
  // Electron helper resource lookup on macOS.
  if (isDevelopment) {
    return electronBinaryPath;
  }

  return buildMacLauncher(electronBinaryPath);
}
