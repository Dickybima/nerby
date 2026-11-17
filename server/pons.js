'use strict';
/* Nerby Protocol — Top Pons tokens on Robinhood Chain. Pons tokens trade on three venues that
   GeckoTerminal tracks separately: the Pons V2 bonding curves, the pools they graduate into, and
   the older Pons pools. This merges them into one ranking by 24h volume and, for tokens still on
   a curve, reads how close each one is to graduating. Cached, because the API is rate-limited. */
const GT = 'https://api.geckoterminal.com/api/v2/networks/robinhood';
const VENUES = { 'pons-v2': 'curve', 'pons-v2-dex': 'graduated', 'pons-dot-family': 'pons' };
const TTL = 120 * 1000;
let cache = null;

async function gt(path) {
  const res = await fetch(GT + path, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
  if (res.status === 429) throw new Error('rate limited');
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}
const n = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

async function load(readCurve) {
  // two pages for the busy Pons V2 venues, one for the older pools: five calls every two minutes
  const pages = [['pons-v2', 1], ['pons-v2', 2], ['pons-v2-dex', 1], ['pons-v2-dex', 2], ['pons-dot-family', 1]];
  const lists = await Promise.all(pages.map(([dex, page]) =>
    gt(`/dexes/${dex}/pools?sort=h24_volume_usd_desc&include=base_token&page=${page}`).then((d) => ({ dex, d })).catch(() => ({ dex, d: null }))));
  if (lists.every((x) => !x.d)) throw new Error('No Pons data right now.');
  const byToken = new Map();
  for (const { dex, d } of lists) {
    if (!d) continue;
    const toks = {};
    for (const t of d.included || []) if (t.type === 'token') toks[t.id] = t.attributes;
    for (const p of d.data || []) {
      const a = p.attributes, tid = p.relationships.base_token.data.id, t = toks[tid] || {};
      const addr = (t.address || tid.split('_')[1] || '').toLowerCase();
      if (!addr) continue;
      const vol = n(a.volume_usd && a.volume_usd.h24) || 0;
      const tx = (a.transactions && a.transactions.h24) || {};
      const cur = byToken.get(addr);
      const entry = cur || {
        address: addr, name: t.name || a.name.split(' / ')[0], symbol: t.symbol || a.name.split(' / ')[0], image: t.image_url && !/missing/.test(t.image_url) ? t.image_url : null,
        volume24h: 0, buys24h: 0, sells24h: 0, pools: []
      };
      entry.volume24h += vol;
      entry.buys24h += tx.buys || 0; entry.sells24h += tx.sells || 0;
      entry.pools.push({ address: a.address, venue: VENUES[dex], name: a.name, volume24h: vol, liquidityUsd: n(a.reserve_in_usd), createdAt: a.pool_created_at });
      // the busiest pool sets the price figures shown for the token
      if (!cur || vol >= Math.max.apply(null, entry.pools.map((x) => x.volume24h))) {
        entry.priceUsd = n(a.base_token_price_usd);
        entry.change24h = n(a.price_change_percentage && a.price_change_percentage.h24);
        entry.fdvUsd = n(a.fdv_usd);
        entry.marketCapUsd = n(a.market_cap_usd);
        entry.stage = VENUES[dex];
        entry.chart = `https://www.geckoterminal.com/robinhood/pools/${a.address}`;
      }
      if (!entry.createdAt || a.pool_created_at < entry.createdAt) entry.createdAt = a.pool_created_at;
      entry.liquidityUsd = entry.pools.reduce((s, x) => s + (x.liquidityUsd || 0), 0);
      byToken.set(addr, entry);
    }
  }
  const tokens = [...byToken.values()].sort((x, y) => y.volume24h - x.volume24h);
  // a token that has graduated keeps an old curve pool; only tokens without a graduated pool are "on curve"
  for (const t of tokens) {
    const curve = t.pools.find((p) => p.venue === 'curve');
    if (t.pools.some((p) => p.venue === 'graduated')) t.stage = 'graduated';
    t.curve = curve && t.stage === 'curve' ? curve.address : null;
  }
  if (readCurve) {
    await Promise.all(tokens.filter((t) => t.curve).slice(0, 30).map(async (t) => {
      try {
        const [real, goal] = await Promise.all([readCurve(t.curve, 'realQuoteReserve() view returns (uint256)'), readCurve(t.curve, 'graduationThreshold() view returns (uint256)')]);
        if (real !== null && goal) t.graduationPercent = Math.min(100, Number(BigInt(real) * 10000n / BigInt(goal)) / 100);
      } catch (e) { /* progress is optional */ }
    }));
  }
  tokens.forEach((t, i) => { t.rank = i + 1; });
  return { updatedAt: new Date().toISOString(), source: 'GeckoTerminal', count: tokens.length, tokens };
}

async function topPons(readCurve) {
  if (cache && Date.now() - cache.at < TTL) return cache.value;
  try {
    const value = await load(readCurve);
    cache = { at: Date.now(), value };
    return value;
  } catch (e) {
    if (cache) return Object.assign({}, cache.value, { stale: true });
    throw e;
  }
}

module.exports = { topPons };
