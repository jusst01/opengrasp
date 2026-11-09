# OpenGrasp — Published Policy (v0, testnet)

These are the numbers the game runs on. They are mirrored as constants in the NEAR
policy contract. If a number changes, it changes here, in a public commit, first.

## Token status and sustainability

OpenGrasp does **not** launch, sell, or distribute a native token as part of the
NEAR Hackathon build. Contributor rewards and dataset licensing are accounted
in points and settled in NEAR under the rates in this policy.

A future protocol token is not ruled out. If one is introduced, its role will
be limited to product utility: paying for dataset access and custom data
collection, opening contributor bounties, and coordinating governance. It will
not change points already earned or the dataset revenue split retroactively.
Its supply, allocations, treasury wallets, vesting, and unlock rules must be
published before launch. Until then, no OpenGrasp token exists, and nothing in
this policy is an offer to sell one.

## Points per accepted episode

| Quest (task id) | Base points | Par time |
|---|---|---|
| Relic Evacuation (`pick_place`) | 100 | 30 s |
| Restore the Monolith (`stack_two`) | 200 | 45 s |
| Restock the Potion Shelf (`colour_sort`) | 250 | 60 s |

`points = base_points × quality / 100`, paid only for **accepted** episodes.
Quality and points are each rounded to the nearest integer.

## Quality formula (deterministic, re-runnable by anyone)

```
quality = 0                                        if the task was not completed
quality = 40 + 30·smoothness + 20·speed + 10·path  otherwise

smoothness = clamp(1 − mean_jerk / 60, 0, 1)       mean jerk of the gripper tip (m/s³)
speed      = clamp(1 − duration / par_time, 0, 1)
path       = clamp(1 − (tip_path / ideal_path − 1) / 2, 0, 1)

ACCEPTED if quality ≥ 60.
```

`mean_jerk` is computed by finite differences over the recorded frame timestamps
(midpoint times between samples), and `duration` is the last frame's timestamp —
so the score is exactly reproducible from the exported episode file alone.

The same formula runs in the browser (instant feedback to the player) and is the
reference for on-chain verification. Same episode file in → same score out.

## Dataset licensing split

When a dataset built from contributed episodes is licensed, the payment is split
by the contract at the moment it arrives:

- **70% — contributors**, pro-rata by quality-weighted points across the episodes
  included in that dataset version
- **20% — treasury** (dataset curation, new tasks, infrastructure)
- **10% — operations**

## Dataset transparency

Every dataset version publishes: episode count, acceptance rate, score
distribution, the task mix, and the list of episode hashes included. A buyer can
verify that the episodes they paid for are the episodes that were scored.

## What we will never do

- Change a conversion rate retroactively.
- Sell contributor episodes without the split above.
- Launch a token without first publishing its supply, allocations, treasury wallets, vesting, and unlock schedule.
