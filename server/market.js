'use strict';
/* Nerby Protocol — market data (price, liquidity, volume, candles, trades) from the GeckoTerminal public API.
   Their free tier allows about 30 calls a minute, so results are cached here and at Vercel's edge. */
const GT = 'https://api.geckoterminal.com/api/v2';
const GT_NETWORK = { robinhood: 'robinhood', ethereum: 'eth', base: 'base', arbitrum: 'arbitrum', optimism: 'optimism', polygon: 'polygon_pos', bsc: 'bsc', avalanche: 'avax', linea: 'linea', scroll: 'scroll', gnosis: 'xdai', solana: 'solana' };
const TTL = 60 * 1000;
const cache = new Map();

class MarketError extends Error {}

async function gt(path) {
  let res;
  try { res = await fetch(GT + path, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(12000) }); } catch (e) { throw new MarketError('Market data is not reachable right now.'); }
  if (res.status === 404) return null;
  if (res.status === 429) throw new MarketError('Market data is busy right now. Try again in a minute.');
  if (!res.ok) throw new MarketError('Market data answered HTTP ' + res.status + '.');
  return res.json();
}

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

async function load(network, token, full) {
  const gn = GT_NETWORK[network];
  if (!gn) throw new MarketError('No market data for this network.');
  const evm = /^0x[0-9a-fA-F]{40}$/.test(token);
  if (!evm && !(network === 'solana' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(token))) throw new MarketError('token must be a token address.');
  const id = evm ? token.toLowerCase() : token; // Solana addresses are case-sensitive
  const t = await gt(`/networks/${gn}/tokens/${id}?include=top_pools`);
  if (!t || !t.data) return { listed: false, network, token, note: 'No trading pool was found for this token on GeckoTerminal.' };
  const a = t.data.attributes, pools = (t.included || []).filter((i) => i.type === 'pool');
  const out = {
    listed: true, network, token, source: 'GeckoTerminal',
    name: a.name, symbol: a.symbol, priceUsd: num(a.price_usd), fdvUsd: num(a.fdv_usd), marketCapUsd: num(a.market_cap_usd),
    liquidityUsd: num(a.total_reserve_in_usd), volume24hUsd: num(a.volume_usd && a.volume_usd.h24),
    pools: pools.slice(0, 5).map((p) => {
      const q = p.attributes;
      return {
        address: q.address, name: q.name, dex: p.relationships && p.relationships.dex && p.relationships.dex.data && p.relationships.dex.data.id,
        createdAt: q.pool_created_at, liquidityUsd: num(q.reserve_in_usd), priceUsd: num(q.base_token_price_usd), quotePriceUsd: num(q.quote_token_price_usd),
        priceChange: q.price_change_percentage, volumeUsd: q.volume_usd, transactions: q.transactions,
        url: `https://www.geckoterminal.com/${gn}/pools/${q.address}`
      };
    })
  };
  if (!full || !out.pools.length) return out;
  const pool = out.pools[0].address;
  const [candles, trades] = await Promise.all([
    gt(`/networks/${gn}/pools/${pool}/ohlcv/minute?aggregate=15&limit=300&currency=usd`).catch(() => null),
    gt(`/networks/${gn}/pools/${pool}/trades`).catch(() => null)
  ]);
  const tl = id.toLowerCase();
  if (!candles || !trades) out.partial = true;
  out.candles = candles && candles.data ? candles.data.attributes.ohlcv_list.map((c) => ({ t: c[0] * 1000, o: c[1], h: c[2], l: c[3], c: c[4], v: c[5] })).reverse() : [];
  out.trades = trades && trades.data ? trades.data.slice(0, 60).map((x) => {
    const r = x.attributes, buy = r.kind === 'buy';
    return { time: r.block_timestamp, kind: r.kind, tx: r.tx_hash, wallet: r.tx_from_address, usd: num(r.volume_in_usd), amount: num(buy ? r.to_token_amount : r.from_token_amount), priceUsd: num(buy ? r.price_to_in_usd : r.price_from_in_usd), sameToken: (buy ? r.to_token_address : r.from_token_address).toLowerCase() === tl };
  }).filter((x) => x.sameToken).map(({ sameToken, ...x }) => x) : [];
  return out;
}

async function market(network, token, full) {
  const base = network + ':' + (/^0x/.test(token) ? token.toLowerCase() : token), key = base + ':' + (full ? 1 : 0);
  // a full result also answers a summary request
  const hit = cache.get(key) || (full ? null : cache.get(base + ':1'));
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  try {
    const value = await load(network, token, full);
    // a partial answer (one sub-request was rate limited) is kept only briefly
    cache.set(key, { at: value.partial ? Date.now() - TTL + 15000 : Date.now(), value });
    if (cache.size > 200) cache.delete(cache.keys().next().value);
    return value;
  } catch (e) {
    if (hit) return Object.assign({}, hit.value, { stale: true });
    throw e;
  }
}

module.exports = { market, MarketError, GT_NETWORK };
