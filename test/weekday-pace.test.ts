import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { quotaCommand } from "../src/commands.js";
import {
  addWeekdayMs,
  isWeekday,
  weekdayMsBetween,
} from "../src/lib/work-calendar.js";
import { computeWindowPace } from "../src/pace.js";
import type { QuotaAxiResponse, QuotaWindow } from "../src/types.js";

const DAY = 86_400_000;
const HOUR = 3_600_000;
const WEEK_SECONDS = 604_800;

/** Local wall-clock time, so weekday assertions hold in any time zone. */
function at(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute = 0,
): number {
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

// 2026-07-13 is a Monday; 2026-07-17 is a Friday.
const MONDAY = at(2026, 7, 13, 0);
const FRIDAY_NOON = at(2026, 7, 17, 12);
const SATURDAY_NOON = at(2026, 7, 18, 12);

function window(
  partial: Partial<QuotaWindow> & Pick<QuotaWindow, "id">,
): QuotaWindow {
  return {
    label: partial.id,
    kind: "weekly",
    ...partial,
  };
}

describe("weekday calendar", () => {
  it("counts only Monday through Friday in local time", () => {
    expect(isWeekday(MONDAY)).toBe(true);
    expect(isWeekday(SATURDAY_NOON)).toBe(false);
    expect(weekdayMsBetween(at(2026, 7, 13, 0), at(2026, 7, 18, 0))).toBe(
      5 * DAY,
    );
    // Friday noon to Monday noon is a weekday's worth of hours, not a weekend's.
    expect(weekdayMsBetween(FRIDAY_NOON, at(2026, 7, 20, 12))).toBe(24 * HOUR);
    expect(weekdayMsBetween(SATURDAY_NOON, at(2026, 7, 19, 12))).toBe(0);
    expect(weekdayMsBetween(FRIDAY_NOON, FRIDAY_NOON - HOUR)).toBe(0);
  });

  it("walks wall-clock time forward across the weekend", () => {
    expect(addWeekdayMs(FRIDAY_NOON, 0)).toBe(FRIDAY_NOON);
    expect(addWeekdayMs(FRIDAY_NOON, 12 * HOUR)).toBe(at(2026, 7, 18, 0));
    // Noon Friday plus a working day is noon Monday: the weekend costs nothing.
    expect(addWeekdayMs(FRIDAY_NOON, 24 * HOUR)).toBe(at(2026, 7, 20, 12));
    expect(addWeekdayMs(SATURDAY_NOON, 12 * HOUR)).toBe(at(2026, 7, 20, 12));
    expect(addWeekdayMs(MONDAY, 5 * DAY)).toBe(at(2026, 7, 18, 0));
  });

  it("refuses impossible inputs instead of inventing a timestamp", () => {
    expect(addWeekdayMs(FRIDAY_NOON, -1)).toBeUndefined();
    expect(addWeekdayMs(FRIDAY_NOON, Number.NaN)).toBeUndefined();
    expect(addWeekdayMs(FRIDAY_NOON, 1e18)).toBeUndefined();
  });
});

describe("weekday pace", () => {
  const now = at(2026, 7, 13, 13, 49); // Monday afternoon
  const reset = at(2026, 7, 17, 7); // Friday morning
  const weekly = window({
    id: "seven_day",
    percentUsed: 25,
    percentRemaining: 75,
    windowSeconds: WEEK_SECONDS,
    resetsAt: iso(reset),
  });

  it("does not read the weekend as surplus headroom", () => {
    const calendar = computeWindowPace(weekly, iso(now));
    expect(calendar.status).toBe("behind");
    expect(calendar.reservePercentPoints).toBeCloseTo(21.9147, 3);
    expect(calendar.burnMultiple).toBeCloseTo(0.5329, 3);
    expect(calendar.clock).toBeUndefined();

    const weekday = computeWindowPace(weekly, iso(now), { clock: "weekdays" });
    expect(weekday.clock).toBe("weekdays");
    expect(weekday.status).toBe("on_pace");
    expect(weekday.elapsedPercent).toBeCloseTo(25.6806, 3);
    expect(weekday.timeRemainingPercent).toBeCloseTo(74.3194, 3);
    expect(weekday.reservePercentPoints).toBeCloseTo(0.6806, 3);
    expect(weekday.burnMultiple).toBeCloseTo(0.9735, 3);
  });

  it("projects the run-out onto the working week, not the calendar", () => {
    const projected = computeWindowPace(weekly, iso(now), {
      clock: "weekdays",
    }).projectedExhaustedAt;
    expect(projected).toBeDefined();
    const date = new Date(projected!);
    expect(date.getDay()).toBe(5); // a Friday
    expect(date.getTime()).toBeGreaterThan(reset);
    expect(date.getHours()).toBeLessThanOrEqual(12);
  });

  it("stands still over the weekend until Monday", () => {
    const weekend = window({
      id: "seven_day",
      percentUsed: 25,
      percentRemaining: 75,
      windowSeconds: WEEK_SECONDS,
      resetsAt: iso(at(2026, 7, 24, 7)),
    });
    const saturday = computeWindowPace(weekend, iso(at(2026, 7, 18, 0)), {
      clock: "weekdays",
    });
    const sunday = computeWindowPace(weekend, iso(at(2026, 7, 19, 12)), {
      clock: "weekdays",
    });
    const monday = computeWindowPace(weekend, iso(at(2026, 7, 20, 0)), {
      clock: "weekdays",
    });
    expect(saturday.elapsedPercent).toBeCloseTo(14.1667, 3);
    expect(sunday.elapsedPercent).toBe(saturday.elapsedPercent);
    expect(monday.elapsedPercent).toBe(saturday.elapsedPercent);
    expect(sunday.burnMultiple).toBe(saturday.burnMultiple);
  });

  it("keeps the calendar clock for a cycle with no weekday time", () => {
    const session = window({
      id: "five_hour",
      kind: "session",
      percentUsed: 40,
      percentRemaining: 60,
      windowSeconds: 18_000,
      resetsAt: iso(at(2026, 7, 18, 15)),
    });
    const pace = computeWindowPace(session, iso(at(2026, 7, 18, 12)), {
      clock: "weekdays",
    });
    expect(pace.clock).toBeUndefined();
    expect(pace.elapsedPercent).toBeCloseTo(40, 3);
    expect(pace.reservePercentPoints).toBeCloseTo(0, 3);
  });
});

describe("pace.weekdaysOnly through the quota command", () => {
  const savedSnapshot = process.env.QUOTA_AXI_SNAPSHOT;
  let configRoot: string | undefined;

  afterEach(() => {
    vi.useRealTimers();
    if (savedSnapshot === undefined) delete process.env.QUOTA_AXI_SNAPSHOT;
    else process.env.QUOTA_AXI_SNAPSHOT = savedSnapshot;
    if (configRoot) rmSync(configRoot, { recursive: true, force: true });
    configRoot = undefined;
  });

  it("applies the weekday clock only to the providers it names", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(at(2026, 7, 13, 13, 49)));
    configRoot = join(process.env.XDG_CONFIG_HOME!, "quota-axi");
    mkdirSync(configRoot, { recursive: true });
    const reset = iso(at(2026, 7, 17, 7));
    const lane = (provider: string, source: string) => ({
      provider,
      label: provider === "claude" ? "Claude" : "Z.AI",
      source,
      windows: [
        {
          id: "seven_day",
          label: "week",
          kind: "weekly",
          percentUsed: 25,
          percentRemaining: 75,
          windowSeconds: WEEK_SECONDS,
          resetsAt: reset,
        },
      ],
      state: {
        status: "fresh",
        stale: false,
        refreshedAt: "2026-07-13T00:00:00.000Z",
        sourcesTried: ["snapshot"],
      },
    });
    const snapshot = join(configRoot, "snapshot.json");
    writeFileSync(
      snapshot,
      JSON.stringify({
        schemaVersion: 3,
        providers: [lane("claude", "oauth"), lane("zai", "api")],
      }),
    );
    writeFileSync(
      join(configRoot, "config.json"),
      JSON.stringify({ pace: { weekdaysOnly: ["claude"] } }),
    );
    process.env.QUOTA_AXI_SNAPSHOT = snapshot;

    const report = JSON.parse(
      await quotaCommand(
        ["--provider", "claude,zai", "--json", "--no-credential-refresh"],
        undefined,
      ),
    ) as QuotaAxiResponse;

    const claude = report.providers.find((p) => p.provider === "claude")!;
    const zai = report.providers.find((p) => p.provider === "zai")!;
    expect(claude.windows[0]!.pace).toMatchObject({
      clock: "weekdays",
      status: "on_pace",
    });
    expect(claude.windows[0]!.pace!.burnMultiple).toBeCloseTo(0.9735, 3);
    expect(zai.windows[0]!.pace!.clock).toBeUndefined();
    expect(zai.windows[0]!.pace!.status).toBe("behind");
    expect(zai.windows[0]!.pace!.burnMultiple).toBeCloseTo(0.5328, 3);
  });
});
