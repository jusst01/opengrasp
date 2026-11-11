# OpenGrasp — the transparent robot-data game

**Built at NEAR HACKATHON** · Track: **Games With Real Economies** (cross: NFTs That Do Something)

Robotics has a data problem, not a model problem. Manipulation policies are trained on
human demonstrations, and quality demonstrations are scarce and expensive. Games are
the cheapest way to collect them at scale: people play a robot-arm teleoperation game,
every play session is recorded as a training episode, and the episodes become a dataset
in the standard [LeRobot](https://huggingface.co/docs/lerobot) layout that anyone can
train on.

OpenGrasp is that game — with the economics inverted from how incumbents run it.

## The research gap: teleoperation data, without the black box

Browser teleoperation games already exist on other chains (e.g. Axis Robotics on Base).
They prove the demand. But their economics are a black box, and the market has noticed:

| | Closed incumbents | OpenGrasp |
|---|---|---|
| Points → payout conversion | Undisclosed, off-chain, changeable at will | **Published constants** (see `POLICY.md`), enforced by the NEAR policy contract — **live on testnet at `opengrasp.opengraspdev.testnet`** (owner `jusst1.testnet`; verify with `get_policy()`) |
| Native token | Yes — with vesting wallets the community has to sleuth on-chain | **No token launch or sale in this build.** Rewards and licensing settle in NEAR; any future utility token requires published supply, wallet, and vesting terms before launch |
| Dataset licensing revenue | Opaque | **On-chain split: 70% contributors / 20% treasury / 10% ops** |
| Which demonstrations count? | Undisclosed acceptance | **Open quality formula** (below); acceptance rate is public |
| Who owns an episode? | The platform | The contributor — episodes are registered assets (NEP-171 roadmap) |

The recurring complaint is not simply that a platform has a token; it is that
conversion rates and treasury decisions cannot be verified. Whether or not
every accusation is fair, the root cause is structural: **when the rates
live in a private spreadsheet, nobody can verify anything.** OpenGrasp's answer is to put
the rates in a contract and the scoring formula in this repo.

## How it works

1. **Play.** Drive a 5-DOF SO-ARM-style manipulator (keyboard or sliders) through a task:
   pick-and-place, colour sorting, stacking.
2. **Record.** Every session is recorded at 30 Hz — joint states, gripper, object poses —
   in LeRobot-style episode format (`observation.state` / `action` per frame).
3. **Score.** An open, deterministic quality formula grades the episode: task success,
   trajectory smoothness (mean jerk), speed vs. par time, and path efficiency.
   Episodes below the bar are rejected — *and the rejection reason is shown to the player*.
4. **Earn.** Accepted episodes earn points at published rates. When the dataset is
   licensed, revenue is split on-chain, pro-rata to contributors' quality-weighted points.
5. **Verify.** Anyone can re-run the scoring formula on the exported episode file and
   get the same score. The dataset card publishes episodes, acceptance rate, and score
   distribution.

## NEAR's role

- The **policy contract** (source in `contract/`) is **live on NEAR testnet at
  `opengrasp.opengraspdev.testnet`** (owner `jusst1.testnet`). It holds the
  conversion rates, the revenue split, and the episode registry as public
  constants and state — the part of the system players normally have to trust
  becomes the part they can read. The design and constants are public now, ahead of
  deployment, so they can be audited before any value moves.
- **Episodes as assets:** accepted episodes are registered on-chain; the NEP-171
  episode-asset layer (royalty-bearing ownership of a single demonstration) is the
  next milestone.
- **Accounts players never notice:** the game is playable end-to-end in the browser
  with no wallet; an account only enters when points are claimed.
- **Sustainability:** dataset licensing and paid data collection are the intended
  operating revenue. A protocol utility token may be evaluated after the
  hackathon for marketplace access, custom bounties, and governance; it is not
  launched or sold as part of this submission.

## Try it

- **Play:** open `index.html` (or the GitHub Pages deployment) in any modern browser.
  Pick a task → **Start Episode**. Controls are gamer-layout: `Q/E` base, `W/S`
  shoulder, `A/D` elbow, `Z/X` wrist pitch, `C/V` wrist roll, `Space` gripper,
  `F` save checkpoint, `G` load checkpoint, `R` reset. Or use the mouse: **drag the
  gripper** and inverse kinematics moves the arm, **double-click a cube** and the arm
  flies to it and grabs it, **double-click the target zone** and it flies there so you
  can fine-tune the drop. A **Sensitivity** slider (10–300%) scales key speed and drag
  travel. A wrist camera (picture-in-picture, like a real SO-ARM wrist cam),
  a translucent goal ghost, and a live goal-match percentage keep the target obvious.
  Joint motion is smoothed, and a floor guard keeps the gripper and links from
  passing through the table (12 mm recovery tolerance, documented in the code).
  *Do this — see that:* finish the orange pick-and-place and an episode card appears
  with its quality score, accept/reject verdict, and a downloadable episode file.
- **Convert an episode to a LeRobot dataset:**
  `python3 tools/to_lerobot.py episode.json out/` produces `meta/info.json`,
  `meta/episodes.jsonl`, and `data/chunk-000/episode_000000.parquet`
  (parquet needs `pandas` + `pyarrow`; without them it writes JSONL and says so).

## Repo layout

- `index.html` — the whole game: Three.js sim, task engine, recorder, scorer, export.
- `POLICY.md` — the published economics: rates, split, quality formula. These numbers
  are the contract constants; changing them means changing this file in public.
- `contract/` — NEAR testnet policy/registry contract design and interface.
- `tools/to_lerobot.py` — episode JSON → LeRobot dataset layout converter.

## Roadmap — Season 1

Shipped in the hackathon build:

- [x] Playable sim: expedition hub + 3 tasks, 30 Hz recording, open quality
  scoring, LeRobot-style export
- [x] NEAR testnet policy contract live: `opengrasp.opengraspdev.testnet` —
  published rates, episode registry, quality-weighted points
- [x] Dataset v0 live on Hugging Face:
  https://huggingface.co/datasets/arrijalufr/opengrasp-episodes-v0 — 15
  episodes, 9,092 frames, LeRobot parquet; all 15 episodes are registered
  on-chain (2,521 points)

Season 1 adds content and activation on top of machinery that already exists —
episode registration, quality scoring, points, and dataset versions all work
today; none of the items below needs new infrastructure:

- **A second robot arm.** A new embodiment joins the expedition, so
  contributed data spans more than one machine.
- **Two new expedition sites.** The Sunken Forge and The Sky Observatory —
  already charted as locked sites on the hub map — open for verified runs.
- **Dataset v1.** The first 100 episodes from human players replace the
  scripted seed data of v0. They are registered and grouped into a dataset
  version through the same contract calls the v0 seed episodes used.
- **Dataset licensing live on NEAR mainnet.** Buyers pay in NEAR and the
  contract executes the published split — 70% contributors / 20% treasury /
  10% ops. The policy contract already supports dataset versions and
  licensing claims, so this step is activation on mainnet, not new
  infrastructure.

## Disclosure

OpenGrasp is the author's first and currently only project in this hackathon.

## License

MIT
