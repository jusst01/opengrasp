# OpenGrasp — NEAR Hackathon submission pack (draft, Tue 2026-11-10)

Prepared for Jallu to review. Nothing here is submitted. Deadline: **Sat 2026-11-15 06:59 WIB**.
Live game: https://jusst01.github.io/opengrasp/v2/ · Repo: https://github.com/jusst01/opengrasp

## What is being submitted (v2, as shipped and playtested)

- **Game:** browser robot-arm teleoperation, MuJoCo-WASM 3.12 + Franka Panda 7-DOF,
  real contact physics, Cartesian end-effector control. Playtested by Jallu
  2026-11-10, confirmed smooth after his 5-point controls fix (commit 3224afa).
- **Expedition Hub + 3 levels** (commit 990f3bc, verified live 2026-11-10 19:00 WIB): 01 Rescue the Relic,
  02 Restore the Monolith (stone drum must sit UPRIGHT, tilt meter), 03 Restock the
  Potion Shelf (fragile flask). Finish a task → back to hub → up to 5 verified runs per task (failed runs don't consume; stars = best run, points accumulate; each verified run starts from a jittered prop pose, recorded in the episode JSON). Practice mode always open, never locks/earns. Adventure narrative
  lives in the hub (shrine restoration + expedition log).
- **Dataset angle:** every episode recorded at 30 Hz and exportable as JSON
  (opengrasp-episode v2, assists declared). Open quality formula, acceptance
  threshold 60, base points 100/200/250 per level.
- **Transparency (the pitch):** points conversion and dataset-licensing split
  (70% contributors / 20% treasury / 10% ops) are published constants in
  `POLICY.md`, mirrored in the Rust policy contract in `contract/`
  (near-sdk 5, uncompiled). No token launch or sale in this build; rewards and
  licensing settle in NEAR. A future utility token only with published
  supply/allocation/vesting first.
- **Track:** Games (Games With Real Economies), cross: NFTs. Still the only
  robot/teleoperation entry among 415 projects (scrape 2026-11-10).

## Still open before submitting (checklist)

- [x] **NEAR testnet payout account** — `jusst1.testnet` (Jallu, 2026-11-10).
- [x] Compile + deploy policy contract to testnet — DONE 2026-11-11:
      `opengrasp.opengraspdev.testnet`, deploy+init tx
      `G5djeSXKrxNUhe7yeeM6WifPgi7uj6J94HsxofpgEzWh`, `get_policy()` verified
      on-chain (70/20/10, threshold 60, base 100/200/250), owner
      `jusst1.testnet`. Submission form payout account: `jusst1.testnet`.
- [ ] Hugging Face dataset v0 from recorded episodes (Muse).
- [ ] Demo video of real gameplay (Muse: gameplay capture + programmatic
      animation; AI video generation is region-blocked).
- [ ] Jallu posts the X demo thread below, sends the post URL to Muse.
- [ ] Submission form (public repo + X post + form).

## Open question from Jallu (not decided)

"2 model lagi kali ya buat demo, biar gak cuman 1 ini aja, atau 5 sekalian?"
Current state: 1 arm model (Franka Panda) across 3 levels. Adding a 2nd arm
model before the deadline is a scope call — the 3 levels already give demo
variety, and the contract/dataset/video still need the remaining days. Default
recommendation: ship v2 as-is for the deadline; extra arm models are Season 1.

## Form answers (draft — adapt to the actual form fields)

- **Project name:** OpenGrasp
- **Tagline:** The transparent robot-data game — play a robot arm, train real robots, and read the economics in the contract.
- **Track:** Games With Real Economies (cross: NFTs That Do Something)
- **Description:** OpenGrasp is a browser teleoperation game: drive a Franka Panda
  arm (MuJoCo physics) through expedition tasks, and every session is recorded
  as a robot-training episode in LeRobot-style format. Teleoperation games are
  the cheapest way to collect manipulation data at scale — but incumbents keep
  their points conversion and dataset-licensing economics in a private
  spreadsheet. OpenGrasp publishes both as open constants (POLICY.md) enforced
  by a NEAR policy contract: quality formula and acceptance threshold are
  public, episodes are contributor-owned, and dataset licensing revenue splits
  70/20/10 on-chain. No token in this build; settlement in NEAR.
- **What makes it different:** radical transparency vs Axis Robotics (Base) —
  published conversion, published 70/20/10 split, public QC data, verifiable
  trajectory scoring anyone can re-run from the episode file.
- **Live demo:** https://jusst01.github.io/opengrasp/v2/
- **Repo:** https://github.com/jusst01/opengrasp
- **Contract:** `contract/` (Rust, near-sdk 5) — LIVE on testnet at `opengrasp.opengraspdev.testnet`, owner/payout `jusst1.testnet`
- **Video / X post:** <Jallu's X post URL after posting>

## X thread draft (Jallu posts; video on tweet 1)

1. Robot data is the bottleneck for robot learning — and the games collecting it
   keep their economics in a black box. We built OpenGrasp to fix that. 🧵
   @NEARProtocol #NEARHackathon [VIDEO]
2. You drive a real physics robot arm in the browser — MuJoCo, Franka Panda,
   contact physics. Every session is recorded as a training episode, 30 Hz,
   LeRobot-style. Play the game, produce the dataset.
3. Three expeditions in the hub: rescue a fragile relic, restore a monolith,
   restock a potion shelf. Each one takes up to 5 verified runs — failed runs
   don't count, stars are your best run, and every verified run starts from a
   slightly different prop pose so the data actually varies. Practice stays open.
   The shrine rebuilds as you go.
4. Here's the part incumbents won't show you: our points conversion and our
   dataset-licensing split are published constants, in the repo and in a NEAR
   contract. 70% of licensing revenue goes to the contributors, pro-rata by
   quality-weighted points. 20% treasury, 10% ops. Read it, don't trust it.
5. Quality is scored by an open formula — smoothness, speed, path efficiency —
   and anyone can re-run it on the episode file and get the same score.
   Accepted episodes earn points. Rejected ones tell you why.
6. No token in this build. Rewards and licensing settle in NEAR. If a utility
   token ever comes, its supply, allocation and vesting get published first.
   Play it now: https://jusst01.github.io/opengrasp/v2/
7. Built for the NEAR Hackathon, Games track. Repo:
   https://github.com/jusst01/opengrasp — the policy, the formula and the
   contract are all public. Go play, and your play becomes robot data.
