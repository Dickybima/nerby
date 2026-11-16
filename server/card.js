'use strict';
/* Nerby Protocol — the live $NERBY share card (1200×630 PNG), drawn on the server from
   the latest price, burned supply and market data, so a pasted link shows today's numbers. */
const fs = require('fs');
const path = require('path');
const { callTool } = require('./tools');

const CA = '0xd17d0eabf76f2b3144da726efd341761f4697113';
const DEAD = '0x000000000000000000000000000000000000dEaD', ZERO = '0x0000000000000000000000000000000000000000';
const SUPPLY = 1e9;
const CURVE = '0xc6724F498424A7Df496F594Ddea382EBC1c5906c', ETH_USD = '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419';
const A = (f) => fs.readFileSync(path.join(__dirname, 'assets', f));
let fonts, globe, satori, Resvg;

function load() {
  if (fonts) return;
  fonts = [
    { name: 'Geist', data: A('geist-sans-latin-300-normal.woff'), weight: 300, style: 'normal' },
    { name: 'Geist', data: A('geist-sans-latin-400-normal.woff'), weight: 400, style: 'normal' },
    { name: 'Geist', data: A('geist-sans-latin-500-normal.woff'), weight: 500, style: 'normal' },
    { name: 'Mono', data: A('geist-mono-latin-500-normal.woff'), weight: 500, style: 'normal' }
  ];
  globe = 'data:image/png;base64,' + A('globe.png').toString('base64');
  satori = require('satori').default || require('satori');
  Resvg = require('@resvg/resvg-js').Resvg;
}

async function tool(name, args) {
  const r = await callTool(name, args);
  return r && !r.isError ? JSON.parse(r.content[0].text) : null;
}

async function data() {
  const call = (fn, args) => tool('call_contract', { network: 'robinhood', address: CA, function: fn, args: args || [] });
  const [m, dead, zero] = await Promise.all([
    tool('get_token_market', { network: 'robinhood', token: CA }).catch(() => null),
    call('balanceOf(address) view returns (uint256)', [DEAD]), call('balanceOf(address) view returns (uint256)', [ZERO])
  ]);
  const raw = (dead ? BigInt(dead.result) : 0n) + (zero ? BigInt(zero.result) : 0n);
  // if the market API is busy, price the token from the curve itself and Chainlink's ETH/USD feed
  let chainPrice = null;
  if (!m || !m.priceUsd) {
    const [res, feed] = await Promise.all([
      tool('call_contract', { network: 'robinhood', address: CURVE, function: 'getReserves() view returns (uint256,uint256)' }),
      tool('call_contract', { network: 'ethereum', address: ETH_USD, function: 'latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)' })
    ]);
    if (res && feed) chainPrice = Number(res.result[0]) / Number(res.result[1]) * Number(feed.result[1]) / 1e8;
  }
  const burned = Number(raw / 10n ** 18n);
  const pool = m && m.pools && m.pools[0];
  return {
    price: m && m.priceUsd ? Number(m.priceUsd) : chainPrice,
    change: pool && pool.priceChange && pool.priceChange.h24 !== undefined ? Number(pool.priceChange.h24) : null,
    liquidity: pool ? pool.liquidityUsd : m && m.liquidityUsd,
    volume: m && m.volume24hUsd,
    burned, burnedPct: burned / SUPPLY * 100,
    mcap: (m && m.priceUsd ? Number(m.priceUsd) : chainPrice) ? (m && m.priceUsd ? Number(m.priceUsd) : chainPrice) * (SUPPLY - burned) : null
  };
}

const usd = (v) => {
  if (v === null || v === undefined || isNaN(v)) return '—';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return '$' + (v / 1e3).toFixed(v >= 1e5 ? 0 : 2) + 'K';
  return '$' + v.toFixed(2);
};
const price = (p) => {
  if (!p) return '—';
  if (p >= 0.01) return '$' + p.toFixed(4);
  return '$' + p.toFixed(Math.max(0, -Math.floor(Math.log10(p)) - 1) + 4);
};
const big = (n) => Math.round(n).toLocaleString('en-US');

// satori takes a React-like tree; this small helper keeps the markup readable
function h(type, style, children) { return { type, props: { style: Object.assign({ display: 'flex' }, style || {}), children } }; }

function tree(d) {
  const up = d.change !== null && d.change >= 0;
  const stat = (label, value, sub, color) => h('div', { flexDirection: 'column', gap: 4, padding: '14px 20px', border: '1px solid #22352a', background: 'rgba(14,22,16,0.85)', flex: 1 }, [
    h('div', { fontSize: 15, letterSpacing: 3, color: '#7d9382', textTransform: 'uppercase' }, label),
    h('div', { fontSize: 30, color: color || '#e9f5ea', fontWeight: 400 }, value),
    sub ? h('div', { fontSize: 16, color: '#7d9382' }, sub) : null
  ].filter(Boolean));
  return h('div', { width: 1200, height: 630, background: '#080c0a', color: '#e9f5ea', fontFamily: 'Geist', position: 'relative', overflow: 'hidden', flexDirection: 'column', padding: '48px 56px' }, [
    h('div', { position: 'absolute', right: -60, top: 0, width: 560, height: 560, background: 'radial-gradient(circle, rgba(161,248,55,0.18) 0%, rgba(8,12,10,0) 62%)' }, []),
    { type: 'img', props: { src: globe, width: 380, height: 380, style: { position: 'absolute', right: 24, top: 64 } } },
    h('div', { alignItems: 'center', gap: 14, fontSize: 18, letterSpacing: 6, color: '#e4ffd6' }, [h('div', { width: 12, height: 12, borderRadius: 6, background: '#c8ff6b' }, []), 'NERBY PROTOCOL · $NERBY LIVE']),
    h('div', { flexDirection: 'column', marginTop: 26, gap: 2 }, [
      h('div', { fontSize: 22, letterSpacing: 5, color: '#c8ff6b', textTransform: 'uppercase' }, 'Price'),
      h('div', { alignItems: 'baseline', gap: 22 }, [
        h('div', { fontSize: 80, fontWeight: 300, letterSpacing: -3, lineHeight: 1.05 }, price(d.price)),
        d.change === null ? null : h('div', { fontSize: 26, fontFamily: 'Mono', color: up ? '#c8ff6b' : '#ff8a7a' }, (up ? '▲ ' : '▼ ') + Math.abs(d.change).toFixed(1) + '%')
      ].filter(Boolean))
    ]),
    h('div', { flexDirection: 'column', marginTop: 22, padding: '16px 22px', border: '1px solid rgba(255,150,60,0.45)', background: 'rgba(40,18,6,0.55)', width: 640, gap: 8 }, [
      h('div', { fontSize: 18, letterSpacing: 4, color: '#ffb46b', textTransform: 'uppercase' }, 'Total burned'),
      h('div', { alignItems: 'baseline', gap: 16 }, [
        h('div', { fontSize: 44, fontWeight: 300, color: '#fff3d6' }, big(d.burned) + ' NERBY'),
        h('div', { fontSize: 24, color: '#ffb46b' }, d.burnedPct.toFixed(2) + '%')
      ]),
      h('div', { height: 8, background: '#2a1a10', width: 592 }, [h('div', { width: Math.max(6, Math.min(592, d.burnedPct / 100 * 592)), height: 8, background: '#ff8a2a' }, [])])
    ]),
    h('div', { gap: 14, position: 'absolute', left: 56, width: 1088, top: 452 }, [
      stat('Market cap', usd(d.mcap)),
      stat('Liquidity', usd(d.liquidity)),
      stat('Volume 24h', usd(d.volume))
    ]),
    h('div', { position: 'absolute', left: 56, width: 1088, top: 572, justifyContent: 'space-between', fontSize: 16, color: '#7d9382', fontFamily: 'Mono' }, [
      h('div', {}, 'Robinhood Chain · updated ' + new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC'),
      h('div', { color: '#c8ff6b' }, 'nerbyprotocol.xyz/token.html')
    ])
  ]);
}

async function nerbyCard() {
  load();
  const d = await data();
  const svg = await satori(tree(d), { width: 1200, height: 630, fonts });
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } }).render().asPng();
  return { png, data: d };
}

module.exports = { nerbyCard, data, price, usd, big };
