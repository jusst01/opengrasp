/* OpenGrasp — NEAR wallet layer (TESTNET).
 *
 * Optional by design: the game and hub work 100% without it. This layer adds
 *   1. "Connect Wallet" in the Expedition Hub header (NEAR Wallet Selector:
 *      Meteor Wallet + MyNearWallet),
 *   2. the player's on-chain points, read with a plain RPC view call
 *      (get_points — no wallet needed for reads),
 *   3. registerRun(): signs register_episode on the OpenGrasp policy
 *      contract from the PLAYER's account, so the player — not the dev
 *      account — is recorded as the episode's contributor and earns the
 *      points (see contract/src/lib.rs: register_episode is public, the
 *      caller becomes the contributor).
 *
 * Everything fails soft: if the CDN libraries cannot load (offline, blocked
 * CDN, no Web3 support), status becomes 'unavailable', the connect UI hides
 * itself, and nothing else on the page changes. No console-error spam.
 *
 * Contract: opengrasp.opengraspdev.testnet
 *   register_episode(task_id: String, quality: u8, content_hash: String) -> u64
 *   get_points(account: AccountId) -> u64
 */
(function () {
  'use strict';

  var CONTRACT_ID = 'opengrasp.opengraspdev.testnet';
  var NETWORK = 'testnet';
  var RPC_URL = 'https://test.rpc.fastnear.com';
  var SELECTOR_VERSION = '8.9.13';
  var CDN = 'https://cdn.jsdelivr.net/npm/@near-wallet-selector';
  var PENDING_KEY = 'opengrasp_pending_reg'; // in-flight tx marker (redirect wallets)

  var state = { status: 'idle', account: null, points: null };
  var selector = null;
  var modal = null;
  var loadPromise = null;
  var listeners = [];
  var redirectConsumed = false;

  // A wallet redirect (MyNearWallet) returns to the page with the outcome in
  // the URL. Capture it once, then scrub the URL so a refresh cannot replay it.
  var redirectInfo = null;
  try {
    var q = new URLSearchParams(window.location.search);
    var txHashes = q.get('transactionHashes');
    var errCode = q.get('errorCode');
    if (txHashes || errCode) {
      redirectInfo = {
        txHash: txHashes ? txHashes.split(',')[0] : null,
        error: errCode ? (q.get('errorMessage') || errCode) : null,
      };
      q.delete('transactionHashes'); q.delete('errorCode'); q.delete('errorMessage');
      var clean = window.location.pathname + (q.toString() ? '?' + q.toString() : '') + window.location.hash;
      window.history.replaceState(null, '', clean);
    }
  } catch (e) { /* URL parsing is best-effort */ }

  function snapshot() { return { status: state.status, account: state.account, points: state.points }; }
  function emit() {
    renderBox();
    var s = snapshot();
    listeners.slice().forEach(function (cb) { try { cb(s); } catch (e) { /* listener errors are theirs */ } });
  }
  function setState(patch) {
    var changed = false;
    for (var k in patch) { if (state[k] !== patch[k]) { state[k] = patch[k]; changed = true; } }
    if (changed) emit();
  }

  // ---------------------------------------------------------- points (view)
  function fetchPoints(account) {
    var argsJson = JSON.stringify({ account: account });
    var b64;
    try { b64 = btoa(argsJson); } catch (e) { return Promise.resolve(null); }
    return fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 'opengrasp-points', method: 'query',
        params: {
          request_type: 'call_function', account_id: CONTRACT_ID,
          method_name: 'get_points', args_base64: b64, finality: 'optimistic',
        },
      }),
    }).then(function (res) { return res.json(); }).then(function (j) {
      if (!j || !j.result || !j.result.result) return 0;
      var bytes = j.result.result;
      var text = '';
      for (var i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
      var val = JSON.parse(text);
      return typeof val === 'number' ? val : 0;
    }).catch(function () { return null; });
  }

  function refreshPoints() {
    if (!state.account) return Promise.resolve(null);
    var acct = state.account;
    return fetchPoints(acct).then(function (pts) {
      if (state.account === acct && pts !== null) setState({ points: pts });
      return pts;
    });
  }

  // ------------------------------------------------------------- hub widget
  function box() { return document.getElementById('walletBox'); }

  function renderBox() {
    var el = box();
    if (!el) return;
    if (state.status === 'unavailable') { el.innerHTML = ''; return; }
    if (state.status === 'connected' && state.account) {
      el.innerHTML =
        '<span class="hchip wchip-on">⛓ NEAR <b>' + escapeHtml(state.account) + '</b>' +
        (state.points === null ? '' : ' · <b>' + state.points + '</b> PTS ON-CHAIN') + '</span>' +
        '<button type="button" class="wbtn ghost" id="ogDisconnectBtn">Disconnect</button>';
    } else if (state.status === 'loading') {
      el.innerHTML = '<button type="button" class="wbtn" disabled>Loading wallet…</button>';
    } else {
      el.innerHTML = '<button type="button" class="wbtn" id="ogConnectBtn">⛓ Connect Wallet</button>' +
        '<span class="hchip wdim">NEAR TESTNET</span>';
    }
    var c = document.getElementById('ogConnectBtn');
    if (c) c.addEventListener('click', function () { connect(); });
    var d = document.getElementById('ogDisconnectBtn');
    if (d) d.addEventListener('click', function () { disconnect(); });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  // ------------------------------------------------------------ wallet core
  function loadLibs() {
    if (loadPromise) return loadPromise;
    // Preview/dev stub: a host page may pre-seed a wallet state (used by the
    // project's own preview harness). Inert in production — nothing sets it.
    if (typeof window.__OG_WALLET_STATE__ === 'object' && window.__OG_WALLET_STATE__) {
      state.status = window.__OG_WALLET_STATE__.status || 'ready';
      state.account = window.__OG_WALLET_STATE__.account || null;
      state.points = (typeof window.__OG_WALLET_STATE__.points === 'number') ? window.__OG_WALLET_STATE__.points : null;
      loadPromise = Promise.resolve(null);
      emit();
      return loadPromise;
    }
    setState({ status: 'loading' });
    loadPromise = Promise.all([
      import(CDN + '/core@' + SELECTOR_VERSION + '/+esm'),
      import(CDN + '/modal-ui-js@' + SELECTOR_VERSION + '/+esm'),
      import(CDN + '/meteor-wallet@' + SELECTOR_VERSION + '/+esm'),
      import(CDN + '/my-near-wallet@' + SELECTOR_VERSION + '/+esm'),
    ]).then(function (mods) {
      var core = mods[0], modalJs = mods[1], meteor = mods[2], mnw = mods[3];
      if (!document.querySelector('link[data-og-wallet-css]')) {
        var link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = CDN + '/modal-ui-js@' + SELECTOR_VERSION + '/styles.css';
        link.setAttribute('data-og-wallet-css', '1');
        document.head.appendChild(link);
      }
      return core.setupWalletSelector({
        network: NETWORK,
        modules: [meteor.setupMeteorWallet(), mnw.setupMyNearWallet()],
      }).then(function (sel) {
        selector = sel;
        modal = modalJs.setupModal(selector, {
          contractId: CONTRACT_ID,
          theme: 'auto',
          description: 'Register verified OpenGrasp runs on-chain: points are credited to YOUR account by the policy contract (70/20/10 licensing split, POLICY.md).',
        });
        var syncFromStore = function () {
          try {
            var s = selector.store.getState();
            var accounts = s.accounts || [];
            var active = null;
            for (var i = 0; i < accounts.length; i++) if (accounts[i].active) { active = accounts[i]; break; }
            var acct = (active || accounts[0] || {}).accountId || null;
            if (acct !== state.account) {
              setState({ account: acct, status: acct ? 'connected' : 'ready', points: acct ? state.points : null });
              if (acct) refreshPoints();
            }
          } catch (e) { /* store not ready yet */ }
        };
        try {
          if (selector.store.observable && typeof selector.store.observable.subscribe === 'function') {
            selector.store.observable.subscribe(syncFromStore);
          }
        } catch (e) { /* subscription is best-effort; connect() re-syncs */ }
        syncFromStore();
        if (!state.account) setState({ status: 'ready' });
        return selector;
      });
    }).catch(function () {
      selector = null; modal = null;
      setState({ status: 'unavailable' });
      return null;
    });
    return loadPromise;
  }

  function init() {
    renderBox();
    // Only warm the libraries when there is a plausible session to restore or
    // a redirect to finalize; otherwise load on first click (keeps the game
    // boot exactly as fast as before for wallet-less players).
    var hasSession = false;
    try { hasSession = !!window.localStorage.getItem('near-wallet-selector:selectedWalletId'); } catch (e) { /* ignore */ }
    var stubbed = typeof window.__OG_WALLET_STATE__ === 'object' && !!window.__OG_WALLET_STATE__;
    if (hasSession || redirectInfo || stubbed) loadLibs();
    return loadPromise || Promise.resolve(null);
  }

  function connect() {
    return loadLibs().then(function (sel) {
      if (!sel || !modal) { setState({ status: 'unavailable' }); return; }
      try { modal.show(); } catch (e) { setState({ status: 'unavailable' }); }
    });
  }

  function disconnect() {
    if (!selector) { setState({ account: null, points: null, status: 'ready' }); return Promise.resolve(); }
    return selector.wallet().then(function (w) { return w.signOut(); }).catch(function () { /* ignore */ })
      .then(function () { setState({ account: null, points: null, status: 'ready' }); });
  }

  // --------------------------------------------------------- register a run
  /* args: { task_id, quality, content_hash, key } — the JSON encoding below
   * is byte-for-byte the shape proven on-chain (register_onchain.sh and the
   * 2026-11-11 UI integration test, tx 92U8Fx3gEQT5my1gCbt1oAt3kyP9nJCL7aerFoWKyK8x):
   * task_id String, quality u8 as a JSON number, content_hash String. */
  function registerEpisode(args) {
    return loadLibs().then(function (sel) {
      if (!sel) throw new Error('Wallet unavailable');
      if (!state.account) throw new Error('Connect a wallet first');
      return selector.wallet();
    }).then(function (wallet) {
      try {
        window.localStorage.setItem(PENDING_KEY, JSON.stringify({
          key: args.key || null, hash: args.content_hash, ts: Date.now(),
        }));
      } catch (e) { /* private mode: redirect finalization just won't pair */ }
      return wallet.signAndSendTransaction({
        receiverId: CONTRACT_ID,
        actions: [{
          type: 'FunctionCall',
          params: {
            methodName: 'register_episode',
            args: { task_id: args.task_id, quality: args.quality, content_hash: args.content_hash },
            gas: '30000000000000', // 30 TGas, same as the proven CLI calls
            deposit: '0',
          },
        }],
      });
    }).then(function (outcomes) {
      try { window.localStorage.removeItem(PENDING_KEY); } catch (e) { /* ignore */ }
      var outcome = Array.isArray(outcomes) ? outcomes[0] : outcomes;
      var txHash = (outcome && outcome.transaction && outcome.transaction.hash) || null;
      refreshPoints();
      return { txHash: txHash };
    });
  }

  /* If a redirect wallet sent us back with a result, pair it with the
   * in-flight marker and hand it to the app exactly once. */
  function redirectResult() {
    if (redirectConsumed || !redirectInfo) return null;
    redirectConsumed = true;
    var pending = null;
    try { pending = JSON.parse(window.localStorage.getItem(PENDING_KEY) || 'null'); } catch (e) { /* ignore */ }
    try { window.localStorage.removeItem(PENDING_KEY); } catch (e) { /* ignore */ }
    if (!pending || !pending.key) return null;
    return { key: pending.key, txHash: redirectInfo.txHash, error: redirectInfo.error };
  }

  window.OGWallet = {
    CONTRACT_ID: CONTRACT_ID,
    init: init,
    connect: connect,
    disconnect: disconnect,
    registerEpisode: registerEpisode,
    refreshPoints: refreshPoints,
    redirectResult: redirectResult,
    accountId: function () { return state.account; },
    state: snapshot,
    onChange: function (cb) { if (typeof cb === 'function') listeners.push(cb); },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderBox);
  } else {
    renderBox();
  }
})();
