// Vercel Edge Function — CORS 프록시
// Edge Runtime: 전 세계 엣지 노드에서 실행, 스트리밍 지원, 타임아웃 없음
// 대용량 SGIS GeoJSON (수 MB) 처리 가능
export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

// 허용 도메인 화이트리스트 (보안)
const ALLOWED = [
  'sgisapi.mods.go.kr',
  'apis.data.go.kr',
  'www.data.go.kr',
];

export default async function handler(req) {
  // Preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  const { searchParams } = new URL(req.url);
  const target = searchParams.get('url');

  if (!target) {
    return new Response(JSON.stringify({ error: 'url param missing' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...CORS },
    });
  }

  // 도메인 화이트리스트 검사
  let targetHost;
  try {
    targetHost = new URL(target).hostname;
  } catch {
    return new Response(JSON.stringify({ error: 'invalid url' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...CORS },
    });
  }

  if (!ALLOWED.some(h => targetHost === h || targetHost.endsWith('.' + h))) {
    return new Response(JSON.stringify({ error: `blocked: ${targetHost}` }), {
      status: 403,
      headers: { 'Content-Type': 'application/json', ...CORS },
    });
  }

  try {
    const upstream = await fetch(target, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; KBS-ElectionMap/1.0)',
        'Accept': 'application/json, */*',
      },
    });

    // 응답을 그대로 스트리밍 — 버퍼링 없이 바이트 통과
    // Edge Runtime은 Response body를 ReadableStream으로 직접 전달 가능
    const contentType = upstream.headers.get('Content-Type') || 'application/json';

    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'no-store',
        ...CORS,
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', ...CORS },
    });
  }
}
