'use strict';
/* GET /api/market?network=robinhood&token=0x… — cached market data for the site's pages. */
const { market, MarketError, GT_NETWORK } = require('../server/market');

module.exports = async function (req, res) {
  const url = new URL(req.url, 'http://localhost');
  const network = url.searchParams.get('network') || 'robinhood', token = url.searchParams.get('token') || '';
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  if (!GT_NETWORK[network] || !/^0x[0-9a-fA-F]{40}$/.test(token)) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'Pass network and a 0x token address.' })); }
  try {
    const data = await market(network, token, true);
    res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=60, stale-while-revalidate=600');
    res.end(JSON.stringify(data));
  } catch (e) {
    res.statusCode = 503;
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ error: e instanceof MarketError ? e.message : 'Market data failed.' }));
  }
};
