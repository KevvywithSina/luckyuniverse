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
  // 오리파 팩: /pack 목록 페이지 안의 initialMachines 에 팩별 잔여가 모두 들어 있음
  const t = clean(await get(B + '/pack'));
  const re = /\{"id":"([0-9a-f-]{36})","name":"([^"]*)"[^{}]*?"total_quantity":(\d+),"remaining_quantity":(\d+),"price":(\d+)[^{}]*?"status":"([a-z_]+)"/g; let m;
  const seen = new Set();
  while ((m = re.exec(t))) if (m[6] === 'open' && +m[4] > 0 && !seen.has(m[1])) {
    seen.add(m[1]);
    out.push({ p: '쿠지머신', id: m[1], k: 'oripa', t: m[2], shop: 'TCG 오리파', cat: '포켓몬 TCG', price: +m[5], orig: 0, off: 0, live: 0,
      url: `${B}/pack/machine/${m[1]}`, pr: [], tot: +m[3], rem: +m[4] });
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


// ── 2쿠지: 공개 API (포인트 전용 쿠지는 현금 구매가 안 되어 제외)
async function twokuji() {
  const r = await get('https://2kuji.com/api/v1/kujis', 'json');
  return (r.data || []).filter(d => d.status === 'active' && d.paymentMode !== 'point_only' && +d.price > 0 && d.remainingTickets > 0).map(d => {
    const pr = (d.prizes || []).map(x => [String(x.grade).trim(), cut(x.name, 30), +x.total, +x.remaining, 0]);
    if (d.lastOne) pr.push(['LAST', cut(d.lastOnePrize?.name || d.lastOnePrize || '라스트원', 30), 1, d.remainingTickets > 0 ? 1 : 0, 1]);
    return { p: '2쿠지', id: d.id, k: 'kuji', t: d.name, shop: '2쿠지', cat: d.categoryName || '', price: +d.price, orig: 0, off: /오리지널|original/i.test(d.name) ? 0 : 1,
      live: 0, url: `https://2kuji.com/kuji/${encodeURIComponent(d.slug)}`, pr, tot: d.totalTickets, rem: d.remainingTickets };
  });
}

// ── 코스믹쿠지마켓: 공개 API (목록 → 상세의 상별 잔여)
async function cosmickuji() {
  const B = 'https://cosmic-kuji.com/api'; const list = []; let page = 1, pages = 1;
  do { const r = await get(`${B}/packages?page=${page}`, 'json'); list.push(...(r.data || [])); pages = r.meta?.totalPages || 1; page++; } while (page <= pages && page <= 10);
  const out = [];
  for (const p of list) {
    if (p.status !== 'active' || p.isSoldOut || p.isComingSoon || !(p.ticketSummary?.remaining > 0)) continue;
    const d = (await get(`${B}/packages/${p.id}/detail`, 'json')).data || {};
    const pr = (d.products || []).sort((a, b) => (a.isLastOne - b.isLastOne) || (a.displayOrder - b.displayOrder))
      .map(x => [x.isLastOne ? 'LAST' : String(x.productType || x.name).replace(/상$/, ''), cut(x.description || x.name, 30), x.ticketSummary?.total ?? 0, x.ticketSummary?.remaining ?? 0, x.isLastOne ? 1 : 0]);
    out.push({ p: '코스믹쿠지', id: p.id, k: 'kuji', t: p.name.replace(/^\[[^\]]+\]\s*/, ''), shop: '코스믹쿠지마켓', cat: '', price: p.pricePerTicket, orig: 0,
      off: /이치방쿠지|세가|타이토|아타리|애니마이|스퀘어/.test(p.name) ? 1 : 0, live: 0, url: `https://cosmic-kuji.com/packages/${p.id}`, pr,
      tot: p.ticketSummary.total, rem: p.ticketSummary.remaining });
  }
  return out;
}

// ── 미라클쿠지: 공개 첫 화면의 "판매 중 남은 X / Y칸" 카드 (가격·상별 구성은 목록에 없음)
async function miraclekuji() {
  const B = 'https://www.miraclekuji.com'; const $ = cheerio.load(await get(B + '/')); const seen = new Set(); const out = [];
  $('a[href^="/rounds/"]').each((_, a) => {
    const h = $(a).attr('href'); const t = $(a).text().replace(/\s+/g, ' ').trim();
    const m = t.match(/판매 ?중\s*남은\s*([\d,]+)\s*\/\s*([\d,]+)\s*칸\s*(.+?)\s*뽑으러/);
    if (!m || seen.has(h)) return; seen.add(h);
    const rem = +m[1].replace(/,/g, ''), tot = +m[2].replace(/,/g, '');
    if (rem > 0) out.push({ p: '미라클쿠지', id: h.split('/').pop(), k: 'kuji', t: m[3], shop: '미라클쿠지', cat: '', price: 0, orig: 0, off: 0, live: 0, url: B + h, pr: [], tot, rem });
  });
  return out;
}

// ── 피카유니버스: 공개 오리파 목록 "제목 남은/전체 · %가격원"
async function pikauniverse() {
  const B = 'https://www.pikauniverse.com'; const $ = cheerio.load(await get(B + '/oripa')); const seen = new Set(); const out = [];
  $('a[href^="/oripa/"]').each((_, a) => {
    const h = $(a).attr('href'); const t = $(a).text().replace(/\s+/g, ' ').trim();
    const m = t.match(/^(.*?)([\d,]+)\s*\/\s*([\d,]+)\s*·\s*\d+%\s*([\d,]+)원/);
    if (!m || seen.has(h)) return; seen.add(h);
    const n = x => +x.replace(/,/g, '');
    if (n(m[2]) > 0) out.push({ p: '피카유니버스', id: h.split('/')[2], k: 'oripa', t: m[1].trim(), shop: 'PIKA UNIVERSE', cat: '포켓몬 TCG', price: n(m[4]), orig: 0, off: 0, live: 0,
      url: B + h, pr: [], tot: n(m[3]), rem: n(m[2]) });
  });
  return out;
}

// ── 쿠지사: 공개 상품 목록. 진행 중인 판만 상품 페이지에서 남은 티켓을 읽음
async function kujisa() {
  const B = 'https://kujisa.com'; const $ = cheerio.load(await get(B + '/')); const out = []; const seen = new Set();
  for (const a of $('a[href^="/kuji/"]').toArray()) {
    const h = $(a).attr('href'); const t = $(a).text().replace(/\s+/g, ' ').trim();
    if (seen.has(h) || !/판매 ?중|진행 ?중/.test(t)) continue; seen.add(h);
    const d = cheerio.load(await get(B + h)); const x = d('body').text().replace(/\s+/g, ' ');
    const rem = +((x.match(/남은 ?티켓\s*([\d,]+)/) || [])[1] || '0').replace(/,/g, '');
    const tot = +((x.match(/총\s*([\d,]+)\s*장/) || [])[1] || '0').replace(/,/g, '');
    const price = +((x.match(/([\d,]+)\s*원/) || [])[1] || '0').replace(/,/g, '');
    if (rem > 0) out.push({ p: '쿠지사', id: h.split('/').pop(), k: 'kuji', t: t.replace(/판매 ?중|진행 ?중/, '').replace(/^이치방쿠지\s*/, ''), shop: '쿠지사', cat: '', price, orig: 0,
      off: 1, live: 0, url: B + h, pr: [], tot: tot || rem, rem });
  }
  return out;
}

// ── 일본 一番くじONLINE: 판매 중 목록. 온라인 일번쿠지는 기간 판매라 남은 수량 개념이 없음(u:1)
async function ichibanOnline() {
  const B = 'https://on-line.1kuji.com'; const $ = cheerio.load(await get(B + '/Form/Product/ProductList.aspx')); const out = [];
  $('.m-product-item').each((_, el) => {
    const a = $(el).find('a[href*="ProductDetail"]').filter((_, x) => !/vid=/.test($(x).attr('href'))).first();
    const title = (a.find('img').attr('alt') || '').trim(); const txt = $(el).text().replace(/\s+/g, ' ');
    const yen = +((txt.match(/¥([\d,]+)/) || [])[1] || '0').replace(/,/g, '');
    if (!title || !a.attr('href')) return;
    out.push({ p: '一番くじONLINE', id: (a.attr('href').match(/pid=([^&]+)/) || [])[1] || title, k: 'kuji', t: title.replace(/^一番くじ\s*/, ''), shop: 'BANDAI SPIRITS',
      cat: '', price: yen, cur: 'JPY', orig: 0, off: 1, live: 0, url: B + a.attr('href'), pr: [], tot: 0, rem: 0, u: 1, jp: 1 });
  });
  return out;
}

const SITES = { 라이브쿠지: livekuji, 쿠지샵: kujishop, 쿠지머신: kujimachine, 레전드쿠지: legendkuji, '2쿠지': twokuji, 코스믹쿠지: cosmickuji,
  미라클쿠지: miraclekuji, 피카유니버스: pikauniverse, 쿠지사: kujisa, '一番くじONLINE': ichibanOnline };
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
