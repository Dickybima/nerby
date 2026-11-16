'use strict';
/* GET /api/og — the live $NERBY share card as a PNG. Cached at the edge for five minutes. */
const { nerbyCard } = require('../server/card');

module.exports = async function (req, res) {
  try {
    const { png } = await nerbyCard();
    res.statusCode = 200;
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=120, s-maxage=300, stale-while-revalidate=3600');
    res.end(png);
  } catch (e) {
    console.error(e);
    res.statusCode = 302;
    res.setHeader('Location', '/img/og.png');
    res.setHeader('Cache-Control', 'no-store');
    res.end();
  }
};
