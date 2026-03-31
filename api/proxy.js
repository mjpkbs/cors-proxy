export default async function handler(req, res) {
  // CORS 헤더 먼저 설정
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  // Preflight 대응
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const targetUrl = req.query.url;

  if (!targetUrl) {
    return res.status(400).json({ error: 'url 파라미터가 필요합니다.' });
  }

  // 허용 도메인 화이트리스트 (보안)
  const ALLOWED_DOMAINS = [
    'sgisapi.mods.go.kr',       // SGIS 지도 API
    'apis.data.go.kr',           // 공공데이터포털 (선관위 NEC API)
    'openapi.gg.go.kr',          // 경기도 OpenAPI (혹시 필요할 때)
  ];

  let parsedUrl;
  try {
    parsedUrl = new URL(targetUrl);
  } catch {
    return res.status(400).json({ error: '유효하지 않은 URL입니다.' });
  }

  const hostname = parsedUrl.hostname;
  const isAllowed = ALLOWED_DOMAINS.some(domain => hostname === domain || hostname.endsWith('.' + domain));

  if (!isAllowed) {
    return res.status(403).json({ error: `허용되지 않은 도메인입니다: ${hostname}` });
  }

  try {
    // 요청 헤더 중 필요한 것만 전달
    const forwardHeaders = {};
    const allowedRequestHeaders = ['content-type', 'authorization', 'accept'];
    for (const key of allowedRequestHeaders) {
      if (req.headers[key]) {
        forwardHeaders[key] = req.headers[key];
      }
    }

    const fetchOptions = {
      method: req.method,
      headers: forwardHeaders,
    };

    // POST body 전달
    if (req.method === 'POST' && req.body) {
      fetchOptions.body = typeof req.body === 'string'
        ? req.body
        : JSON.stringify(req.body);
    }

    const response = await fetch(targetUrl, fetchOptions);

    // Content-Type 확인 후 적절히 반환
    const contentType = response.headers.get('content-type') || '';
    res.setHeader('Content-Type', contentType);

    // 응답 상태 코드 그대로 전달
    res.status(response.status);

    // 바이너리(GeoJSON 등)도 처리되도록 ArrayBuffer로
    const buffer = await response.arrayBuffer();
    return res.send(Buffer.from(buffer));

  } catch (err) {
    console.error('Proxy error:', err);
    return res.status(500).json({ error: `프록시 오류: ${err.message}` });
  }
}
