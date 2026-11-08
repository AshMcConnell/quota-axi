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

## Install

```sh
npm install -g github:AshMcConnell/quota-axi
```

The `prepare` script builds `dist/` during a git install. To work on the fork
itself:

```sh
pnpm install
pnpm test
pnpm build
```

## Upstream

The fork keeps the upstream MIT license and copyright. The monthly change is
not suitable for an upstream PR as-is: upstream's public contract tests
explicitly forbid subscription and summary endpoints. It can go upstream only
if that policy changes.
