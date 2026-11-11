// raw.json + 보정값 → 작품/상품유형 라벨링 → dist/index.html
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
const raw = JSON.parse(readFileSync('data/raw.json', 'utf8'));
const cfg = JSON.parse(readFileSync('config/site.json', 'utf8'));
const ov = JSON.parse(readFileSync('config/overrides.json', 'utf8'));

const KW = [['헌터헌터','HUNTER X HUNTER'],['포켓몬','포켓몬'],['PIKACHU','포켓몬'],['CHARIZARD','포켓몬'],['ポケモン','포켓몬'],['ポケカ','포켓몬'],['進撃の巨人','진격의 거인'],['ONE PIECE','원피스'],['ワンピース','원피스'],['ドラゴンボール','드래곤볼'],['鬼滅','귀멸의 칼날'],['呪術廻戦','주술회전'],['ちいかわ','치이카와'],['ホロライブ','홀로라이브'],['ガンダム','건담'],['崩壊','붕괴'],['ベルセルク','베르세르크'],['プリキュア','프리큐어'],['たまごっち','다마고치'],['遊戯王','유희왕'],['히로아카','나의 히어로 아카데미아'],['나히아','나의 히어로 아카데미아'],
  ['미도리야','나의 히어로 아카데미아'],['PLUS ULTRA','나의 히어로 아카데미아'],['귀멸','귀멸의 칼날'],['거인','진격의 거인'],['니케','승리의 여신 NIKKE'],
  ['베르세르크','베르세르크'],['근육맨','근육맨'],['FATE','Fate'],['페그오','Fate'],['카구라바치','카구라바치'],['학원아이돌','아이돌마스터'],['북두의 권','북두의 권'],
  ['홀로라이브','홀로라이브'],['붕괴','붕괴'],['공각기동대','공각기동대'],['치이카와','치이카와'],['해리포터','해리포터'],['스파이더맨','마블'],['주술회전','주술회전'],
  ['도쿄 리벤저스','도쿄 리벤저스'],['쿠로미','산리오'],['한교동','산리오'],['포차코','산리오'],['미쿠','하츠네 미쿠'],['카드 캡터','카드캡터 체리'],['드래곤볼','드래곤볼'],['원피스','원피스']];
const cats = [...new Set(raw.items.map(i => i.cat).filter(Boolean))].sort((a, b) => b.length - a.length);
// 같은 작품이 '포켓몬'·'포켓몬 TCG'처럼 갈라지지 않게 작품명으로 통일 (상품 종류는 상품군 필터가 따로 구분)
const IP_NORM = { '포켓몬 TCG': '포켓몬', '원피스 카드': '원피스', '드래곤볼 카드': '드래곤볼', 'TCG': '믹스·기타' };
function ipOf(it) { const v = ipOf0(it); return IP_NORM[v] || v; }
function ipOf0(it) {
  const t = it.t;
  if (/\bIVE\b/.test(t)) return 'IVE';
  for (const [k, v] of KW) if (t.toLowerCase().includes(k.toLowerCase())) return v;
  if (it.cat && it.shop !== '쿠지토리') return it.cat;   // 쿠지토리는 카테고리 오분류가 잦아 제목 우선
  for (const c of cats) if (t.includes(c)) return c;
  return '믹스·기타';
}
const top3 = pr => pr.filter(p => !p[4]).slice(0, 3);
function typeOf(it) {
  const names = [it.t, ...top3(it.pr).map(p => p[1])].join(' ');
  if (it.k === 'oripa' || /TCG|카드 ?박스|부스터|확장팩|오리파|1 ?box|1박스|일판/i.test(names)) return 'TCG';
  if (/피규어|figure|넨도|스케일|1\/[5-8]|룩업|소프비|MASTERLIS|POP UP|아츠|S-FIRE|알터|ALTER|스피리테일|루미나스타|Luminasta|FIGURIZM|XStellar|Trio Try|그란디스타|흉상/i.test(names)) return '피규어';
  if (/인형|봉제|누이|마스코트/.test(names)) return '인형';
  return '굿즈';
}
const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const tr = { ...(existsSync('data/tr-cache.json') ? JSON.parse(readFileSync('data/tr-cache.json', 'utf8')) : {}), ...JSON.parse(readFileSync('config/translations.json', 'utf8')) };
const items = [];
for (const it0 of raw.items) {
  const it = it0.jp && tr[it0.t] ? { ...it0, t: tr[it0.t], jt: it0.t } : it0;
  const key = `${it.p}:${it.id}`;
  if (ov.hide.includes(key)) continue;
  const nonLast = it.pr.filter(p => !p[4]);
  const tot = it.tot ?? nonLast.reduce((s, p) => s + p[2], 0);
  const rem = it.rem ?? nonLast.reduce((s, p) => s + p[3], 0);
  if (!it.u && rem <= 0) continue;
  if (!/^https:\/\/[^\s"'<>]+$/.test(it.url || '')) continue;   // 이상한 링크(javascript: 등) 차단
  items.push({ ...it, key, tot, rem, ip: ov.ip[key] || ipOf(it), ty: ov.type[key] || typeOf(it), pin: ov.pin.some(x => (x.key || x) === key && (!x.until || x.until >= today)) ? 1 : 0 });
}
const payload = { meta: { collectedAt: raw.collectedAt, sites: raw.sites, builtAt: new Date().toISOString() }, config: cfg, items };
const tpl = readFileSync('src/template.html', 'utf8');
const clean = JSON.stringify(payload).replace(/[\u0000-\u001f\u2028\u2029]/g, ' ');
const b64 = Buffer.from(clean, 'utf8').toString('base64');
const html = tpl.replace('__PAYLOAD__', () => b64)
  .replace('__GA__', () => /^G-[A-Z0-9]{4,20}$/.test(cfg.ga4 || '') ? `<script async src="https://www.googletagmanager.com/gtag/js?id=${cfg.ga4}"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${cfg.ga4}');</script>` : '');
mkdirSync('dist', { recursive: true });
writeFileSync('dist/index.html', html);
writeFileSync('dist/robots.txt', readFileSync('src/robots.txt', 'utf8'));
const cnt = {}; items.forEach(i => cnt[i.ty] = (cnt[i.ty] || 0) + 1);
console.log('items', items.length, cnt);
