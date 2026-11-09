# Fork notes

This is a fork of [kunchenguid/quota-axi](https://github.com/kunchenguid/quota-axi)
maintained for
[herdr-quota-status](https://github.com/AshMcConnell/herdr-quota-status).

## Command Code monthly window

Upstream reports Command Code's `five_hour` and `weekly` windows but no
monthly percentage, because it deliberately reads only
`GET /alpha/whoami?limits=1` and `GET /alpha/billing/credits`.

This fork additionally reads:

- `GET /alpha/billing/subscriptions` for the active plan id and the billing
  period;
- `GET /alpha/usage/summary?since=<period start>` for monthly credits spent
  this period.

It reports a `monthly` window whose denominator is `monthlyCredits` remaining
plus `totalMonthlyCredits` spent, excludes purchased/free credits (they roll
over and are not paced by the monthly limit), and uses the subscription period
end as `resetsAt`. A small plan table is the fallback when the summary read
fails. `limited: false` responses stay credit-only and get no monthly window.

The extra reads happen only for Command Code, and only while a Command Code
credential is present and resolving. All endpoints stay on the fixed
`https://api.commandcode.ai` origin and remain read-only GETs.

## Weekday pace

Upstream measures pace against the calendar. This fork can measure a
provider's elapsed and remaining cycle time on a weekday clock instead, so an
account that is used only Monday through Friday is not read as having surplus
headroom after an idle weekend:

```json
{ "pace": { "weekdaysOnly": ["claude"] } }
```

in `~/.config/quota-axi/config.json` (`$XDG_CONFIG_HOME/quota-axi/config.json`
when `XDG_CONFIG_HOME` is set). Saturday and Sunday then contribute neither
elapsed nor remaining time for the named providers, and a run-out projection
is mapped back onto wall-clock time. The affected windows carry
`pace.clock: "weekdays"`; everything else about the report is unchanged, and
providers not in the list keep the calendar clock. This one setting
deliberately reaches TOON and JSON, unlike the `tui.*` display preferences:
it describes how the account is really used, so the derived pace and runway
are more accurate.

## Install

Clone and link the checkout so `quota-axi` on `PATH` runs this fork:

```sh
git clone https://github.com/AshMcConnell/quota-axi
cd quota-axi
pnpm install
pnpm build
npm link
```

`npm link` points the global `quota-axi` command at the checkout; rebuilding
after a source change is enough. A tarball install also works because
`prepublishOnly` builds `dist/`.

## Upstream

The fork keeps the upstream MIT license and copyright. The monthly change is
not suitable for an upstream PR as-is: upstream's public contract tests
explicitly forbid subscription and summary endpoints. It can go upstream only
if that policy changes.
