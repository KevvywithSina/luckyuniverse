// GA4 일일 리포트 수집: GA4 Data API → data/ga-report.json
// 필요 환경변수: GA4_PROPERTY_ID(숫자), GA4_SA_KEY(서비스 계정 JSON 원문)
// 외부 패키지 없이 서비스 계정 JWT로 토큰을 받아 runReport를 호출한다.
import { createSign } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';

const PROP = (process.env.GA4_PROPERTY_ID || '').trim();
const KEY = process.env.GA4_SA_KEY || '';
if (!PROP || !KEY) {
  console.log('GA4_PROPERTY_ID 또는 GA4_SA_KEY 없음: GA 리포트 건너뜀');
  process.exit(0);
}

const sa = JSON.parse(KEY);
const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');

async function token() {
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'RS256', typ: 'JWT' });
  const body = b64({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/analytics.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  });
  const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(sa.private_key, 'base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${head}.${body}.${sig}`,
    }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('토큰 발급 실패: ' + JSON.stringify(j));
  return j.access_token;
}

const TOK = await token();

async function report(name, req) {
  try {
    const r = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${PROP}:runReport`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOK}`, 'content-type': 'application/json' },
      body: JSON.stringify(req),
    });
    const j = await r.json();
    if (j.error) return { name, error: j.error.message };
    const dims = (j.dimensionHeaders || []).map((h) => h.name);
    const mets = (j.metricHeaders || []).map((h) => h.name);
    const rows = (j.rows || []).map((row) => {
      const o = {};
      row.dimensionValues?.forEach((v, i) => (o[dims[i]] = v.value));
      row.metricValues?.forEach((v, i) => (o[mets[i]] = Number(v.value)));
      return o;
    });
    return { name, rows };
  } catch (e) {
    return { name, error: String(e) };
  }
}

// 최근 2일(어제, 그제)을 날짜별로 받아 전일 비교가 가능하게 한다. 오늘(진행 중) 값도 참고용으로 포함.
const range = [{ startDate: '2daysAgo', endDate: 'today' }];
const ev = (n) => ({ filter: { fieldName: 'eventName', stringFilter: { value: n } } });

const out = { property: PROP, generatedAt: new Date().toISOString(), reports: [] };
out.reports.push(
  await report('daily', {
    dateRanges: range,
    dimensions: [{ name: 'date' }],
    metrics: [
      { name: 'activeUsers' }, { name: 'newUsers' }, { name: 'sessions' },
      { name: 'engagedSessions' }, { name: 'averageSessionDuration' },
      { name: 'screenPageViews' }, { name: 'bounceRate' },
    ],
  }),
  await report('source', {
    dateRanges: range,
    dimensions: [{ name: 'date' }, { name: 'sessionSourceMedium' }],
    metrics: [{ name: 'sessions' }, { name: 'newUsers' }],
    limit: 50,
  }),
  await report('device_country', {
    dateRanges: range,
    dimensions: [{ name: 'date' }, { name: 'deviceCategory' }, { name: 'country' }],
    metrics: [{ name: 'activeUsers' }],
    limit: 50,
  }),
  await report('events', {
    dateRanges: range,
    dimensions: [{ name: 'date' }, { name: 'eventName' }],
    metrics: [{ name: 'eventCount' }, { name: 'totalUsers' }],
    limit: 100,
  }),
  // 아래는 GA 관리 > 맞춤 정의에 이벤트 매개변수를 등록해야 값이 나온다. 없으면 error 로 남고 리포트는 계속 진행.
  await report('outbound_by_platform', {
    dateRanges: range,
    dimensions: [{ name: 'date' }, { name: 'customEvent:platform' }],
    metrics: [{ name: 'eventCount' }, { name: 'totalUsers' }],
    dimensionFilter: ev('outbound_click'),
    limit: 50,
  }),
  await report('outbound_by_item', {
    dateRanges: range,
    dimensions: [{ name: 'customEvent:item' }, { name: 'customEvent:position' }],
    metrics: [{ name: 'eventCount' }],
    dimensionFilter: ev('outbound_click'),
    limit: 30,
  }),
  await report('search_terms', {
    dateRanges: range,
    dimensions: [{ name: 'customEvent:search_term' }],
    metrics: [{ name: 'eventCount' }],
    dimensionFilter: ev('search'),
    limit: 30,
  }),
);

mkdirSync('data', { recursive: true });
writeFileSync('data/ga-report.json', JSON.stringify(out, null, 1));
for (const r of out.reports) console.log(r.name, r.error ? 'ERROR ' + r.error : r.rows.length + ' rows');
