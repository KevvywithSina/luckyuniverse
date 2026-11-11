// 럭키유니버스 수집기: 각 사이트의 공개 페이지/API에서 "진행 중" 쿠지·오리파를 모아 data/raw.json 으로 저장
import * as cheerio from 'cheerio';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const UA = 'Mozilla/5.0 (compatible; LuckyUniverseBot/0.1; aggregator of public kuji listings)';
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function get(url, type = 'text') {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'ko-KR,ko;q=0.9' } });
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      await sleep(250);
      return type === 'json' ? r.json() : r.text();
    } catch (e) { if (i === 2) throw e; await sleep(1500 * (i + 1)); }
  }
}
const cut = (s, n) => (s || '').replace(/[|~]/g, '').trim().slice(0, n);

// ── 라이브쿠지: 공개 상품 API
async function livekuji() {
  const all = []; let p = 1, pc = 1;
  do {
    const r = await get(`https://livekuji.com/api/products/popular?search=&page=${p}&pageSize=40&sort=popular&categorySlug=kuji`, 'json');
    all.push(...r.data); pc = r.meta.pagination.pageCount; p++;
  } while (p <= pc);
  return all.filter(d => d.saleStatus === 'sale').map(d => ({
    p: '라이브쿠지', id: d.documentId, k: 'kuji', t: d.title, shop: d.store?.name || '', cat: d.category?.name || '',
    price: d.price, orig: d.originalPrice || 0, off: d.kujiType === 'official' ? 1 : 0,
    live: d.liveSaleType && d.liveSaleType !== 'live_off' ? 1 : 0,
    url: `https://livekuji.com/store/${d.store?.slug}/products/${d.documentId}`,
    pr: (d.prizeItems || []).map(i => [i.isLastOne ? 'LAST' : String(i.grade).trim(), cut(i.name, 30), i.totalQuantity, i.remainQuantity, i.isLastOne ? 1 : 0]),
  }));
}

// ── 쿠지샵: 진행 중 쿠지 목록(/kuji-system/) → 각 상품 페이지의 상별 현황
async function kujishop() {
  const $ = cheerio.load(await get('https://kujishop.com/kuji-system/'));
  const links = [...new Set($('a').filter((_, a) => $(a).text().trim() === '구매하기').map((_, a) => $(a).attr('href').replace('http://', 'https://')).get())];
  const out = [];
  for (const u of links) {
    const d = cheerio.load(await get(u));
    const title = d('title').text().replace(' – 쿠지샵', '').replace(/^▷\s*/, '').replace('[이치방쿠지] ', '').trim();
    const pr = d('.prize-status-factor').map((_, f) => {
      const g = (d(f).attr('class').match(/prize-status-factor-([A-Za-z0-9]+)/) || [])[1];
      return [[g, cut(d(f).find('.prize-description').text(), 30), +d(f).find('.prize-total-count').text(), +d(f).find('.prize-available-count').text(), 0]];
    }).get();
    const txt = d('body').text().replace(/\s+/g, ' ');
    const m = txt.match(/전체\s*(\d+)개 중 남은 티켓은\s*(\d+)개/);
    const price = +((txt.match(/티켓 #\d+\s*([\d,]+)₩/) || [])[1] || '0').replace(/,/g, '');
    if (!m || +m[2] === 0) continue;
    out.push({ p: '쿠지샵', id: u.split('/').filter(Boolean).pop(), k: 'kuji', t: title, shop: '쿠지샵', cat: '', price, orig: 0,
      off: /쿠지샵쿠지/.test(title) ? 0 : 1, live: 0, url: u, pr, tot: +m[1], rem: +m[2] });
  }
  return out;
}

// ── 쿠지머신: 쿠지 머신(구성 공개) + 오리파 팩(구성 비공개)
const clean = t => t.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
const grab = t => {
  const k = '"initialPreview":'; const s = t.indexOf(k); if (s < 0) return null; const st = s + k.length;
  if (t.slice(st, st + 4) === 'null') return null;
  let dep = 0, i = st; for (; i < t.length; i++) { const c = t[i]; if (c === '{') dep++; else if (c === '}') { dep--; if (dep === 0) break; } }
  return JSON.parse(t.slice(st, i + 1));
};
const hrefs = (html, re) => { const $ = cheerio.load(html); return [...new Set($('a').map((_, a) => $(a).attr('href')).get().filter(h => h && re.test(h)))]; };
async function kujimachine() {
  const B = 'https://kujimachine.com'; const out = [];
  for (const h of hrefs(await get(B + '/kuji'), /^\/kuji\/[0-9a-f-]{36}$/)) {
    const t = clean(await get(B + h)); const prod = ((t.match(/<title>([^<]+)/) || [])[1] || '').split(' - ')[0].trim();
    const re = /\{"id":"([0-9a-f-]{36})","product_id":"[0-9a-f-]{36}","name":"([^"]*)"[^{}]*?"status":"([a-z_]+)"/g; let m; const ids = new Set();
    while ((m = re.exec(t))) if (m[3] === 'open') ids.add(m[1]);
    for (const id of ids) {
      const pv = grab(clean(await get(`${B}/gatcha/machine/${id}`))); if (!pv) continue; const M = pv.machine;
      const pr = pv.categories.sort((a, b) => a.display_order - b.display_order).map(c => {
        const it = (pv.items || []).find(i => i.category_id === c.id);
        return [c.name.replace(/상$/, ''), cut(it?.name, 30), c.total_quantity, c.remaining_quantity, 0];
      });
      if (M.last_one_name) pr.push(['LAST', cut(M.last_one_name, 30), 1, M.remaining_quantity > 0 ? 1 : 0, 1]);
      if (M.remaining_quantity > 0) out.push({ p: '쿠지머신', id, k: 'kuji', t: M.name, shop: prod, cat: '', price: M.price, orig: 0, off: 0, live: 0,
        url: `${B}/gatcha/machine/${id}`, pr, tot: M.total_quantity, rem: M.remaining_quantity });
    }
  }
  let packs = hrefs(await get(B + '/pack'), /^\/pack\/[0-9a-f-]{36}$/);
  const seen = new Set();
  for (const h of packs) {
    const t = clean(await get(B + h));
    const re = /\{"id":"([0-9a-f-]{36})","name":"([^"]*)"[^{}]*?"total_quantity":(\d+),"remaining_quantity":(\d+),"price":(\d+)[^{}]*?"status":"([a-z_]+)"/g; let m;
    while ((m = re.exec(t))) if (m[6] === 'open' && +m[4] > 0 && !seen.has(m[1])) {
      seen.add(m[1]);
      out.push({ p: '쿠지머신', id: m[1], k: 'oripa', t: m[2], shop: 'TCG 오리파', cat: '포켓몬 TCG', price: +m[5], orig: 0, off: 0, live: 0,
        url: B + h, pr: [], tot: +m[3], rem: +m[4] });
    }
  }
  return out;
}

// ── 전설의쿠지(레전드쿠지): 공개 API
async function legendkuji() {
  const B = 'https://legendkuji.com';
  const sets = (await get(B + '/online-kuji/sets', 'json')).filter(s => s.status === 'active');
  const out = [];
  for (const s of sets) {
    const d = await get(`${B}/online-kuji/sets/${s.id}`, 'json');
    const pr = (d.prizeStats || []).map(p => { const last = /last/i.test(p.rank); return [last ? 'LAST' : p.rank.replace(/상$/, ''), cut(p.name, 30), p.total, p.remain, last ? 1 : 0]; });
    if (d.lastOneEnabled && !pr.some(p => p[4])) pr.push(['LAST', cut(d.lastOneProduct, 30), 1, d.totalCount - d.soldCount > 0 ? 1 : 0, 1]);
    const rem = d.totalCount - d.soldCount; if (rem <= 0) continue;
    out.push({ p: '레전드쿠지', id: s.id, k: 'kuji', t: d.title, shop: '전설의쿠지샵', cat: '', price: d.unitPrice, orig: 0,
      off: /자체/.test(d.title) ? 0 : 1, live: 0, url: B + '/shop.html', pr, tot: d.totalCount, rem });
  }
  return out;
}

const SITES = { 라이브쿠지: livekuji, 쿠지샵: kujishop, 쿠지머신: kujimachine, 레전드쿠지: legendkuji };
const prev = existsSync('data/raw.json') ? JSON.parse(readFileSync('data/raw.json', 'utf8')) : null;
const res = { collectedAt: new Date().toISOString(), sites: {}, items: [] };
for (const [name, fn] of Object.entries(SITES)) {
  try {
    const items = await fn();
    res.items.push(...items); res.sites[name] = { ok: true, at: new Date().toISOString(), count: items.length };
    console.log(name, items.length);
  } catch (e) {
    // 실패 시 이전 수집분을 유지하고 수집 시각을 그대로 표시
    const old = prev?.items.filter(i => i.p === name) || [];
    res.items.push(...old); res.sites[name] = { ok: false, at: prev?.sites?.[name]?.at || null, count: old.length, error: String(e.message || e).slice(0, 200) };
    console.error(name, 'FAILED', e.message);
  }
}
writeFileSync('data/raw.json', JSON.stringify(res));
