import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type { TuiShow } from "../tui.js";
import { PROVIDER_IDS, type ProviderId } from "../types.js";
import { readJsonFile } from "./fs.js";

/**
 * The user-level quota-axi configuration file:
 * `$XDG_CONFIG_HOME/quota-axi/config.json`, or `~/.config/quota-axi/config.json`
 * when `XDG_CONFIG_HOME` is unset. The `tui.*` entries are human display
 * preferences, so nothing an agent reads from quota-axi depends on them; the
 * `pace.*` entries describe how the account is really used and do reach the
 * derived pace and runway.
 */
export function userConfigFilePath(
  environment: Record<string, string | undefined> = process.env,
): string {
  const base = environment.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "quota-axi", "config.json");
}

/**
 * The `--tui` direction preference, `tui.show` in the user config file. Only
 * the exact values `used` and `remaining` are recognized; an absent,
 * unreadable, or malformed file, and any other value, keep the default
 * remaining view.
 */
export function readTuiShowPreference(
  file: string = userConfigFilePath(),
): TuiShow {
  const config = readJsonFile(file);
  const tui = isRecord(config) ? config.tui : undefined;
  const show = isRecord(tui) ? tui.show : undefined;
  return show === "used" ? "used" : "remaining";
}

/**
 * The providers whose pace is measured on a weekday clock, `pace.weekdaysOnly`
 * in the user config file: an array of provider IDs such as `["claude"]`.
 * Saturday and Sunday then contribute neither elapsed nor remaining time to
 * that provider's pace and run-out projection. Unknown or non-string entries
 * are ignored; an absent, unreadable, or malformed file selects no provider.
 */
export function readWeekdaysOnlyProviders(
  file: string = userConfigFilePath(),
): Set<ProviderId> {
  const config = readJsonFile(file);
  const pace = isRecord(config) ? config.pace : undefined;
  const entries = isRecord(pace) ? pace.weekdaysOnly : undefined;
  const selected = new Set<ProviderId>();
  if (!Array.isArray(entries)) return selected;
  for (const entry of entries) {
    if (typeof entry !== "string") continue;
    const id = entry.trim();
    if ((PROVIDER_IDS as readonly string[]).includes(id))
      selected.add(id as ProviderId);
  }
  return selected;
}

/** Resolves a lane to the label its card shows. */
export type TuiAccountLabels = (lane: {
  accountKey?: string;
  accountLocator?: { path: string };
}) => string | undefined;

/**
 * The `--tui` lane names, `tui.accountLabels` in the user config file: an
 * object from a lane's locator path (absolute, or `~/`-relative) or its
 * account key to the name its card shows. Paths are compared after `~`
 * expansion and symlink resolution, so a trailing slash or a linked directory
 * names the same lane; any other entry is matched exactly against the lane's
 * account key, so a relative path names nothing. An absent, unreadable, or
 * malformed file or setting names nothing; a non-string or blank label skips
 * only that entry.
 */
export function readTuiAccountLabels(
  file: string = userConfigFilePath(),
): TuiAccountLabels {
  const config = readJsonFile(file);
  const tui = isRecord(config) ? config.tui : undefined;
  const entries = isRecord(tui) ? tui.accountLabels : undefined;
  const paths = new Map<string, string>();
  const accountKeys = new Map<string, string>();
  if (isRecord(entries)) {
    for (const [entry, label] of Object.entries(entries)) {
      if (typeof label !== "string" || !label.trim()) continue;
      const expanded = expandHome(entry);
      if (isAbsolute(expanded))
        paths.set(canonicalPath(expanded), label.trim());
      else accountKeys.set(entry, label.trim());
    }
  }
  return ({ accountKey, accountLocator }) =>
    (accountKey && accountKeys.get(accountKey)) ||
    (accountLocator && paths.size > 0
      ? paths.get(canonicalPath(accountLocator.path))
      : undefined);
}

function expandHome(path: string): string {
  return path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}

function canonicalPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
