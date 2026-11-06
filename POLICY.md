# OpenGrasp — Published Policy (v0, testnet)

These are the numbers the game runs on. They are mirrored as constants in the NEAR
policy contract. If a number changes, it changes here, in a public commit, first.

## There is no OpenGrasp token

Rewards are denominated and paid in **NEAR**. There is no token to vest, unlock,
or quietly sell. Points are an accounting unit inside the contract, nothing else.

## Points per accepted episode

| Task | Base points | Par time |
|---|---|---|
| Pick & Place | 100 | 30 s |
| Stack Two | 200 | 45 s |
| Colour Sort | 250 | 60 s |

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
- Introduce a token and allocate ourselves a vesting bag.
