'use strict';
/* GET /api/swap?op=token&q=…            → token info and how it trades
   GET /api/swap?op=quote&from&to&amount&address&slippage → a LI.FI route, checked */
const { token, lifiQuote, SwapError } = require('../server/swap');

module.exports = async function (req, res) {
  const u = new URL(req.url, 'http://x'), q = (k) => (u.searchParams.get(k) || '').trim();
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  const send = (code, body) => { res.statusCode = code; res.end(JSON.stringify(body)); };
  try {
    if (q('op') === 'token') return send(200, await token(q('q')));
    if (q('op') === 'quote') {
      const addr = /^0x[0-9a-fA-F]{40}$/, num = /^\d{1,78}$/;
      if (!addr.test(q('from')) || !addr.test(q('to')) || !addr.test(q('address')) || !num.test(q('amount'))) return send(400, { error: 'Bad quote request.' });
      const slip = Math.min(0.5, Math.max(0.001, Number(q('slippage')) || 0.02));
      return send(200, await lifiQuote({ from: q('from'), to: q('to'), amount: q('amount'), address: q('address'), slippage: slip }));
    }
    send(400, { error: 'Unknown op.' });
  } catch (e) {
    if (!(e instanceof SwapError)) console.error(e);
    send(e instanceof SwapError ? 422 : 500, { error: e instanceof SwapError ? e.message : 'Swap service error.' });
  }
};
