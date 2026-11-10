// OpenGrasp policy contract — NEAR testnet, v0 draft.
// Implements contract/README.md + POLICY.md exactly. No native token is part
// of v0: rewards and dataset licensing are settled in NEAR.
// Points are an accounting unit; conversion rates are public constants on-chain.
//
// STATUS (2026-11-10): COMPILES clean (release WASM, 373,131 bytes) after two
// porting fixes for current near-sdk 5.x: borsh added as a direct dependency
// (its derive macros panic otherwise) and store-collection reads adapted to
// the Option<&V> API (.cloned() where an owned value is mutated/re-inserted).
// Deploy needs the payout account Jallu must create
// (owner / treasury / ops all take that account at first deploy; they can be
// re-pointed later by the owner, one explicit call each, so the change is public).
// v0 trusts the submitted quality score (formula is deterministic and public, so
// anyone can re-run it on the published episode file and challenge a wrong score);
// on-chain recomputation proof is v1, per the design doc.

use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::store::{LookupMap, UnorderedMap};
use near_sdk::{env, near, AccountId, NearToken, PanicOnDefault, Promise, require};

// ---- Public constants (mirror POLICY.md; a change here = a public commit) ----
pub const SPLIT_CONTRIBUTORS_BPS: u16 = 7000; // 70%
pub const SPLIT_TREASURY_BPS: u16 = 2000; // 20%
pub const SPLIT_OPS_BPS: u16 = 1000; // 10%
pub const ACCEPT_THRESHOLD: u8 = 60; // quality >= 60 is ACCEPTED
pub const BASE_POINTS_PICK_PLACE: u64 = 100;
pub const BASE_POINTS_STACK_TWO: u64 = 200;
pub const BASE_POINTS_COLOUR_SORT: u64 = 250;

fn base_points(task_id: &str) -> Option<u64> {
    match task_id {
        "pick_place" => Some(BASE_POINTS_PICK_PLACE),
        "stack_two" => Some(BASE_POINTS_STACK_TWO),
        "colour_sort" => Some(BASE_POINTS_COLOUR_SORT),
        _ => None,
    }
}

#[derive(BorshSerialize, BorshDeserialize, Clone)]
#[near(serializers = [json])]
pub struct Episode {
    pub contributor: AccountId,
    pub task_id: String,
    pub quality: u8,
    pub points: u64,
    pub content_hash: String,
    pub accepted: bool,
    pub dataset_version: Option<u32>,
}

#[derive(BorshSerialize, BorshDeserialize, Clone)]
#[near(serializers = [json])]
pub struct DatasetVersion {
    pub episode_ids: Vec<u64>,
    pub total_weighted_points: u64,
    pub licensed_total: NearToken,
}

#[derive(BorshSerialize, BorshDeserialize, Clone)]
#[near(serializers = [json])]
pub struct Policy {
    pub split_contributors_bps: u16,
    pub split_treasury_bps: u16,
    pub split_ops_bps: u16,
    pub accept_threshold: u8,
    pub base_points: BasePoints,
    pub native_token_live: bool,
}

#[derive(BorshSerialize, BorshDeserialize, Clone)]
#[near(serializers = [json])]
pub struct BasePoints {
    pub pick_place: u64,
    pub stack_two: u64,
    pub colour_sort: u64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner: AccountId,
    treasury: AccountId,
    ops: AccountId,
    next_episode_id: u64,
    next_dataset_version: u32,
    episodes: UnorderedMap<u64, Episode>,
    points: LookupMap<AccountId, u64>,
    // NEAR claimable per account, from licensed dataset splits.
    claimable: LookupMap<AccountId, NearToken>,
    datasets: LookupMap<u32, DatasetVersion>,
}

#[near]
impl Contract {
    #[init]
    pub fn new(owner: AccountId, treasury: AccountId, ops: AccountId) -> Self {
        require!(!env::state_exists(), "Already initialized");
        Self {
            owner,
            treasury,
            ops,
            next_episode_id: 0,
            next_dataset_version: 0,
            episodes: UnorderedMap::new(b"e"),
            points: LookupMap::new(b"p"),
            claimable: LookupMap::new(b"c"),
            datasets: LookupMap::new(b"d"),
        }
    }

    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "Owner only");
    }

    /// Records an episode scored by the open quality formula (POLICY.md).
    /// points = base * quality / 100, credited only when quality >= 60.
    /// v0 trusts the submitted score; the formula is deterministic, so anyone
    /// can challenge a wrong score by re-running it on the episode file.
    pub fn register_episode(
        &mut self,
        task_id: String,
        quality: u8,
        content_hash: String,
    ) -> u64 {
        let base = base_points(&task_id).expect("Unknown task_id");
        require!(quality <= 100, "quality must be 0..=100");
        require!(!content_hash.is_empty(), "content_hash required");
        let accepted = quality >= ACCEPT_THRESHOLD;
        let points = if accepted { base * quality as u64 / 100 } else { 0 };
        let contributor = env::predecessor_account_id();
        let id = self.next_episode_id;
        self.next_episode_id += 1;
        self.episodes.insert(
            id,
            Episode {
                contributor: contributor.clone(),
                task_id,
                quality,
                points,
                content_hash,
                accepted,
                dataset_version: None,
            },
        );
        if points > 0 {
            let cur = self.points.get(&contributor).copied().unwrap_or(0);
            self.points.insert(contributor, cur + points);
        }
        id
    }

    /// Owner groups accepted, unassigned episodes into a dataset version.
    pub fn create_dataset_version(&mut self, episode_ids: Vec<u64>) -> u32 {
        self.assert_owner();
        require!(!episode_ids.is_empty(), "No episodes");
        let mut total: u64 = 0;
        for id in &episode_ids {
            let mut ep = self.episodes.get(id).expect("Episode not found").clone();
            require!(ep.accepted, "Episode not accepted");
            require!(ep.dataset_version.is_none(), "Episode already in a dataset");
            total += ep.points;
            ep.dataset_version = Some(self.next_dataset_version);
            self.episodes.insert(*id, ep);
        }
        let version = self.next_dataset_version;
        self.next_dataset_version += 1;
        self.datasets.insert(
            version,
            DatasetVersion {
                episode_ids,
                total_weighted_points: total,
                licensed_total: NearToken::from_yoctonear(0),
            },
        );
        version
    }

    /// Payable: a buyer licenses a dataset version. The attached NEAR is split
    /// 70/20/10 at arrival. The 70% contributor share is distributed pro-rata
    /// by quality-weighted points of the episodes in that version, credited to
    /// each contributor's claimable balance (withdrawn via claim_points).
    #[payable]
    pub fn license_dataset(&mut self, version: u32) {
        let payment = env::attached_deposit();
        require!(payment.as_yoctonear() > 0, "Payment required");
        let mut ds = self.datasets.get(&version).expect("Dataset not found").clone();
        require!(ds.total_weighted_points > 0, "Dataset has no points");
        let contributors_amt =
            payment.as_yoctonear() * SPLIT_CONTRIBUTORS_BPS as u128 / 10_000;
        let treasury_amt = payment.as_yoctonear() * SPLIT_TREASURY_BPS as u128 / 10_000;
        let ops_amt = payment.as_yoctonear() * SPLIT_OPS_BPS as u128 / 10_000;
        // Distribute the contributor share pro-rata by episode points.
        for id in &ds.episode_ids {
            let ep = self.episodes.get(id).expect("Episode not found");
            let share = contributors_amt * ep.points as u128
                / ds.total_weighted_points as u128;
            if share > 0 {
                let cur = self
                    .claimable
                    .get(&ep.contributor)
                    .copied()
                    .unwrap_or(NearToken::from_yoctonear(0));
                self.claimable.insert(
                    ep.contributor.clone(),
                    NearToken::from_yoctonear(cur.as_yoctonear() + share),
                );
            }
        }
        // Treasury / ops shares accrue as claimable balances on those accounts.
        let t_cur = self
            .claimable
            .get(&self.treasury)
            .copied()
            .unwrap_or(NearToken::from_yoctonear(0));
        self.claimable.insert(
            self.treasury.clone(),
            NearToken::from_yoctonear(t_cur.as_yoctonear() + treasury_amt),
        );
        let o_cur = self
            .claimable
            .get(&self.ops)
            .copied()
            .unwrap_or(NearToken::from_yoctonear(0));
        self.claimable
            .insert(self.ops.clone(), NearToken::from_yoctonear(o_cur.as_yoctonear() + ops_amt));
        ds.licensed_total =
            NearToken::from_yoctonear(ds.licensed_total.as_yoctonear() + payment.as_yoctonear());
        self.datasets.insert(version, ds);
    }

    /// Withdraws the caller's accumulated NEAR share from licensed datasets.
    pub fn claim_points(&mut self) -> Promise {
        let who = env::predecessor_account_id();
        let amount = self
            .claimable
            .get(&who)
            .copied()
            .unwrap_or(NearToken::from_yoctonear(0));
        require!(amount.as_yoctonear() > 0, "Nothing to claim");
        self.claimable.insert(who.clone(), NearToken::from_yoctonear(0));
        Promise::new(who).transfer(amount)
    }

    // ---- Owner administration (each change is a public on-chain call) ----
    pub fn set_treasury(&mut self, account: AccountId) {
        self.assert_owner();
        self.treasury = account;
    }

    pub fn set_ops(&mut self, account: AccountId) {
        self.assert_owner();
        self.ops = account;
    }

    // ---- Views: the real rates, readable by any UI ----
    pub fn get_policy(&self) -> Policy {
        Policy {
            split_contributors_bps: SPLIT_CONTRIBUTORS_BPS,
            split_treasury_bps: SPLIT_TREASURY_BPS,
            split_ops_bps: SPLIT_OPS_BPS,
            accept_threshold: ACCEPT_THRESHOLD,
            base_points: BasePoints {
                pick_place: BASE_POINTS_PICK_PLACE,
                stack_two: BASE_POINTS_STACK_TWO,
                colour_sort: BASE_POINTS_COLOUR_SORT,
            },
            native_token_live: false,
        }
    }

    pub fn get_episode(&self, id: u64) -> Option<Episode> {
        self.episodes.get(&id).cloned()
    }

    pub fn get_points(&self, account: AccountId) -> u64 {
        self.points.get(&account).copied().unwrap_or(0)
    }

    pub fn get_claimable(&self, account: AccountId) -> NearToken {
        self.claimable
            .get(&account)
            .copied()
            .unwrap_or(NearToken::from_yoctonear(0))
    }

    pub fn get_dataset(&self, version: u32) -> Option<DatasetVersion> {
        self.datasets.get(&version).cloned()
    }

    pub fn get_owner(&self) -> AccountId {
        self.owner.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    fn alice_ctx() -> VMContextBuilder {
        let mut b = VMContextBuilder::new();
        b.predecessor_account_id("alice.testnet".parse().unwrap())
            .current_account_id("opengrasp.jusst1.testnet".parse().unwrap());
        b
    }

    fn fresh() -> Contract {
        Contract::new(
            "jusst1.testnet".parse().unwrap(),
            "jusst1.testnet".parse().unwrap(),
            "jusst1.testnet".parse().unwrap(),
        )
    }

    #[test]
    fn policy_constants_match_policy_md() {
        testing_env!(alice_ctx().build());
        let c = fresh();
        let p = c.get_policy();
        assert_eq!(p.split_contributors_bps, 7000);
        assert_eq!(p.split_treasury_bps, 2000);
        assert_eq!(p.split_ops_bps, 1000);
        assert_eq!(p.accept_threshold, 60);
        assert_eq!(p.base_points.pick_place, 100);
        assert_eq!(p.base_points.stack_two, 200);
        assert_eq!(p.base_points.colour_sort, 250);
        assert!(!p.native_token_live);
    }

    #[test]
    fn register_episode_points_math_and_threshold() {
        testing_env!(alice_ctx().build());
        let mut c = fresh();
        // quality 80 on stack_two (base 200) -> 160 points, accepted
        let id0 = c.register_episode("stack_two".into(), 80, "hash-a".into());
        assert_eq!(id0, 0);
        assert_eq!(c.get_points("alice.testnet".parse().unwrap()), 160);
        let ep0 = c.get_episode(0).unwrap();
        assert!(ep0.accepted);
        assert_eq!(ep0.points, 160);
        // quality 59 on pick_place -> below threshold: recorded, 0 points
        let id1 = c.register_episode("pick_place".into(), 59, "hash-b".into());
        assert_eq!(id1, 1);
        assert_eq!(c.get_points("alice.testnet".parse().unwrap()), 160);
        let ep1 = c.get_episode(1).unwrap();
        assert!(!ep1.accepted);
        assert_eq!(ep1.points, 0);
        // exactly at threshold 60 on colour_sort (base 250) -> 150 points
        c.register_episode("colour_sort".into(), 60, "hash-c".into());
        assert_eq!(c.get_points("alice.testnet".parse().unwrap()), 310);
    }

    #[test]
    #[should_panic(expected = "Unknown task_id")]
    fn register_episode_rejects_unknown_task() {
        testing_env!(alice_ctx().build());
        let mut c = fresh();
        c.register_episode("nope".into(), 90, "hash-x".into());
    }
}
