# Policy contract (NEAR testnet) — design

One contract holds everything players normally have to take on trust.

## Constants (mirror `POLICY.md` exactly)

```
SPLIT_CONTRIBUTORS_BPS = 7000   // 70%
SPLIT_TREASURY_BPS     = 2000   // 20%
SPLIT_OPS_BPS          = 1000   // 10%
ACCEPT_THRESHOLD       = 60     // quality score
BASE_POINTS            = { pick_place: 100, stack_two: 200, colour_sort: 250 }
```

## State

- `episodes: Map<EpisodeId, Episode>` — `{ contributor, task_id, quality, points,
  content_hash, accepted, dataset_version: Option<u32> }`
- `points: Map<AccountId, u64>` — claimable accounting balance per contributor
- `datasets: Map<u32, DatasetVersion>` — `{ episode_ids, total_weighted_points,
  licensed_total: Balance }`

## Methods

- `register_episode(task_id, quality, content_hash)` — records an episode scored by
  the open formula; `points = base × quality / 100` credited when `quality ≥ 60`.
  (v0 trusts the submitted score; v1 verifies a recomputation proof — the formula is
  deterministic, so anyone can challenge a wrong score by re-running it on the
  published episode file.)
- `license_dataset(version)` — payable; splits the payment 70/20/10 at arrival.
  The 70% contributor share is distributed pro-rata by quality-weighted points of
  the episodes in that version.
- `claim_points()` — contributor withdraws their accumulated share in NEAR.
- `get_policy()` — returns every constant above, so any UI (including third-party
  ones) displays the real rates, not a copy that can drift.

## Why a contract for this at all?

Because the failure mode of closed teleoperation platforms is a spreadsheet:
conversion rates, acceptance decisions, and revenue splits that exist only inside
the company. Every one of those is a public constant or a public state entry here.

## Implementation status (2026-11-06)

- Source: `src/lib.rs` + `Cargo.toml` (near-sdk 5), written from this design doc
  and POLICY.md. Constants, method names, and the 70/20/10 split match exactly.
- NOT yet compiled — the writing VM has no Rust toolchain. Build on a machine
  with Rust + cargo-near: `cargo near build` (wasm target).
- Deploy (testnet) still needs Jallu's NEAR testnet account: it is the payout
  account and the initial `owner` / `treasury` / `ops` argument to `new`
  (all three can be the same account at first; re-pointing any of them later
  is an explicit owner call, so the change is public). Deploy command once the
  account exists:
  `near deploy <account>.testnet --wasmFile target/near/opengrasp-policy.wasm --initFunction new --initArgs '{"owner":"<account>.testnet","treasury":"<account>.testnet","ops":"<account>.testnet"}'`
  then verify with `near view <account>.testnet get_policy`.
- v0 trusts the submitted quality score (see `register_episode`); on-chain
  recomputation proof is v1, per the design above.
