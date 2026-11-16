'use strict';
/* GET /s/nerby — a share link for X and Telegram. Crawlers read the meta tags and show the live
   card; people are sent straight on to the $NERBY page. The ?v= value keeps each share's
   image fresh, because X caches the card per link. */
const { data, price, usd, big } = require('../server/card');
const SITE = 'https://www.nerbyprotocol.xyz';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

module.exports = async function (req, res) {
  const v = (new URL(req.url, 'http://x').searchParams.get('v') || '').replace(/[^0-9a-z]/gi, '').slice(0, 20) || String(Math.floor(Date.now() / 600000));
  let desc = 'Live $NERBY price, market cap and total burned on Robinhood Chain.';
  try {
    const d = await data();
    desc = `Price ${price(d.price)} · Market cap ${usd(d.mcap)} · ${big(d.burned)} NERBY burned (${d.burnedPct.toFixed(2)}%). Live on Robinhood Chain.`;
  } catch (e) { /* the card still works without the numbers in the text */ }
  const img = `${SITE}/api/og?v=${v}`, title = '$NERBY live — Nerby Protocol';
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300');
  res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="website"><meta property="og:site_name" content="Nerby Protocol">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${SITE}/s/nerby?v=${v}">
<meta property="og:image" content="${img}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:site" content="@nerbyprotocol">
<meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(desc)}"><meta name="twitter:image" content="${img}">
<meta http-equiv="refresh" content="0;url=${SITE}/token.html">
<link rel="canonical" href="${SITE}/token.html">
</head><body style="background:#080c0a;color:#e9f5ea;font-family:system-ui,sans-serif"><p>Opening <a style="color:#c8ff6b" href="${SITE}/token.html">the $NERBY page</a>…</p></body></html>`);
};
