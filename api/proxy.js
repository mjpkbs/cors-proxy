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

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// Yahoo Finance 쿠키+크럼 캐시 (콜드 스타트 간 재사용)
let cachedAuth = null;
let cachedAuthTime = 0;
const AUTH_TTL = 5 * 60 * 1000; // 5분

async function getYahooAuth() {
  // 캐시된 인증 정보가 유효하면 재사용
  if (cachedAuth && (Date.now() - cachedAuthTime) < AUTH_TTL) {
    return cachedAuth;
  }

  // 1단계: fc.yahoo.com에서 쿠키 획득
  const cookieResp = await fetch('https://fc.yahoo.com/', {
    method: 'GET',
    headers: { 'User-Agent': UA },
    redirect: 'manual',
  });

  const setCookies = cookieResp.headers.get('set-cookie') || '';
  // 모든 쿠키를 추출해서 하나의 문자열로 합치기
  const cookies = setCookies.split(/,(?=[^ ])/).map(function(c) {
    return c.split(';')[0].trim();
  }).filter(Boolean).join('; ');

  if (!cookies) {
    throw new Error('Failed to get Yahoo cookies');
  }

  // 2단계: 크럼 획득
  const crumbResp = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
    method: 'GET',
    headers: {
      'User-Agent': UA,
      'Cookie': cookies,
    },
  });

  if (!crumbResp.ok) {
    throw new Error('Failed to get crumb: HTTP ' + crumbResp.status);
  }

  const crumb = await crumbResp.text();
  if (!crumb || crumb.length > 50) {
    throw new Error('Invalid crumb received');
  }

  cachedAuth = { cookies: cookies, crumb: crumb };
  cachedAuthTime = Date.now();
  return cachedAuth;
}

async function fetchYahoo(targetUrl) {
  var auth;
  try {
    auth = await getYahooAuth();
  } catch (e) {
    // 인증 실패 시 쿠키 없이 시도
    auth = null;
  }

  // 크럼을 URL에 추가
  var url = targetUrl;
  if (auth) {
    var separator = url.includes('?') ? '&' : '?';
    url = url + separator + 'crumb=' + encodeURIComponent(auth.crumb);
  }

  var headers = {
    'User-Agent': UA,
    'Accept': 'application/json',
    'Accept-Language': 'en-US,en;q=0.9',
  };
  if (auth) {
    headers['Cookie'] = auth.cookies;
  }

  var resp = await fetch(url, { method: 'GET', headers: headers });

  // 401/403이면 캐시 무효화 후 재시도
  if ((resp.status === 401 || resp.status === 403) && auth) {
    cachedAuth = null;
    cachedAuthTime = 0;
    auth = await getYahooAuth();

    url = targetUrl;
    var sep = url.includes('?') ? '&' : '?';
    url = url + sep + 'crumb=' + encodeURIComponent(auth.crumb);
    headers['Cookie'] = auth.cookies;

    resp = await fetch(url, { method: 'GET', headers: headers });
  }

  return resp;
}

module.exports = async function handler(req, res) {
  var origin = req.headers.origin || '';

  // CORS headers
  var cors = getCorsHeaders(origin);
  Object.keys(cors).forEach(function(k) { res.setHeader(k, cors[k]); });

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  var targetUrl = req.query.url;
  if (!targetUrl) {
    return res.status(200).json({ status: 'ok', usage: '?url=<encoded_url>' });
  }

  // Validate target host
  var hostname;
  try {
    hostname = new URL(targetUrl).hostname;
    if (ALLOWED_HOSTS.indexOf(hostname) === -1) {
      return res.status(403).json({ error: 'Host not allowed: ' + hostname });
    }
  } catch (e) {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  // Yahoo Finance → 쿠키+크럼 인증 사용
  var isYahoo = hostname.includes('yahoo.com');

  // query1 → query2 폴백
  var urls = [targetUrl];
  if (targetUrl.includes('query1.finance.yahoo.com')) {
    urls.push(targetUrl.replace('query1.finance.yahoo.com', 'query2.finance.yahoo.com'));
  }

  var lastError = null;
  for (var i = 0; i < urls.length; i++) {
    try {
      var response;
      if (isYahoo) {
        response = await fetchYahoo(urls[i]);
      } else {
        response = await fetch(urls[i], {
          method: 'GET',
          headers: { 'User-Agent': UA, 'Accept': 'application/json' },
        });
      }

      if (!response.ok) {
        lastError = new Error('Upstream HTTP ' + response.status);
        continue;
      }

      var data = await response.text();
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'public, max-age=30');
      return res.status(200).send(data);
    } catch (err) {
      lastError = err;
    }
  }

  return res.status(502).json({
    error: lastError ? lastError.message : 'All attempts failed',
    hint: 'Yahoo Finance may be blocking this server region',
  });
};
