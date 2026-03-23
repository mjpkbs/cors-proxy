const ALLOWED_ORIGINS = [
  'https://mjpkbs.github.io',
  'http://localhost',
  'http://127.0.0.1',
];

const ALLOWED_HOSTS = [
  'query1.finance.yahoo.com',
  'query2.finance.yahoo.com',
  'fc.yahoo.com',
  'ecos.bok.or.kr',
];

function getCorsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
    'Access-Control-Max-Age': '86400',
  };
}

module.exports = async function handler(req, res) {
  const origin = req.headers.origin || '';

  // CORS headers on every response
  const cors = getCorsHeaders(origin);
  Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v));

  // Preflight
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const targetUrl = req.query.url;
  if (!targetUrl) {
    return res.status(200).json({ status: 'ok', usage: '/api/proxy?url=<encoded_url>' });
  }

  // Validate target host
  let hostname;
  try {
    hostname = new URL(targetUrl).hostname;
    if (!ALLOWED_HOSTS.includes(hostname)) {
      return res.status(403).json({ error: 'Host not allowed: ' + hostname });
    }
  } catch (e) {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  // Yahoo Finance: query1 → query2 fallback
  const urls = [targetUrl];
  if (targetUrl.includes('query1.finance.yahoo.com')) {
    urls.push(targetUrl.replace('query1.finance.yahoo.com', 'query2.finance.yahoo.com'));
  }

  let lastError = null;
  for (const url of urls) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
          'Accept': 'application/json',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });

      if (!response.ok) {
        lastError = new Error('Upstream HTTP ' + response.status);
        continue;
      }

      const data = await response.text();
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'public, max-age=30');
      return res.status(200).send(data);
    } catch (err) {
      lastError = err;
    }
  }

  return res.status(502).json({ error: lastError ? lastError.message : 'All attempts failed' });
};
