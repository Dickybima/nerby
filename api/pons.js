'use strict';
/* GET /api/pons — the Top Pons tokens ranking for the site, cached at the edge for two minutes. */
const { callTool } = require('../server/tools');

module.exports = async function (req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  const r = await callTool('get_top_pons_tokens', { limit: 50 });
  if (!r || r.isError) {
    res.statusCode = 503; res.setHeader('Cache-Control', 'no-store');
    return res.end(JSON.stringify({ error: r ? r.content[0].text : 'Unavailable' }));
  }
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=120, stale-while-revalidate=900');
  res.end(r.content[0].text);
};
