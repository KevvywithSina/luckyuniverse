// 럭키유니버스 수집기: 각 사이트의 공개 페이지/API에서 "진행 중" 쿠지·오리파를 모아 data/raw.json 으로 저장
import * as cheerio from 'cheerio';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const UA = 'Mozilla/5.0 (compatible; LuckyUniverseBot/0.1; aggregator of public kuji listings)';
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function get(url, type = 'text') {
  for (let i = 0; i < 3; i++) {
    try {
      // 응답이 없는 사이트가 수집 전체를 붙잡지 않도록 요청마다 30초 제한
      const r = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'ko-KR,ko;q=0.9' }, signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      await sleep(250);
      return type === 'json' ? r.json() : r.text();
    } catch (e) { if (i === 2) throw e; await sleep(1500 * (i + 1)); }
  }
}
const cut = (s, n) => (s || '').replace(/[|~]/g, '').trim().slice(0, n);
const diag = {};   // 사이트별 진단 정보 (0건일 때 로그에 출력)

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
    if (d.lastOne) pr.push(['LAST', cut(typeof d.lastOnePrize === 'string' ? d.lastOnePrize : (d.lastOnePrize?.name || '라스트원'), 30), 1, d.remainingTickets > 0 ? 1 : 0, 1]);
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

// ── 미라클쿠지: 공개 첫 화면의 쿠지판 카드 (제목 h2, "남은/전체장", "1장 가격원", 진행 중)
async function miraclekuji() {
  const B = 'https://www.miraclekuji.com'; const $ = cheerio.load(await get(B + '/')); const seen = new Set(); const out = [];
  const n = x => +String(x).replace(/,/g, '');
  $('a[href^="/rounds/"]').each((_, a) => {
    const h = $(a).attr('href'); if (seen.has(h)) return;
    const t = $(a).text().replace(/\s+/g, ' ').trim();
    if (!/진행 ?중|판매 ?중/.test(t)) return;
    // 화면 디자인이 번갈아 나옴: "잔여 366 / 500" 또는 "366/ 500장 남음"
    const m = t.match(/(?:잔여|남은)\s*([\d,]+)\s*\/\s*([\d,]+)/) || t.match(/([\d,]+)\s*\/\s*([\d,]+)\s*(?:장|칸)/); if (!m) return;
    const title = $(a).find('h2').first().text().replace(/\s+/g, ' ').trim() || (t.match(/칸\s*(.+?)\s*뽑으러/) || [])[1] || '';
    const price = n((t.match(/1장\s*([\d,]+)\s*원/) || [])[1] || 0);
    seen.add(h);
    if (n(m[1]) > 0 && title) out.push({ p: '미라클쿠지', id: h.split('/').pop(), k: 'kuji', t: title, shop: '미라클쿠지', cat: '', price, orig: 0, off: 0, live: 0,
      url: B + h, pr: [], tot: n(m[2]), rem: n(m[1]) });
  });
  return out;
}

// ── 피카유니버스: 공개 오리파 목록. 카드 안의 제목(h3), "남은 / 전체", 정가(원)를 요소 단위로 읽음
async function pikauniverse() {
  const B = 'https://www.pikauniverse.com'; const $ = cheerio.load(await get(B + '/oripa')); const seen = new Set(); const out = [];
  const n = x => +String(x).replace(/,/g, '');
  $('a[href^="/oripa/"]').each((_, a) => {
    const h = $(a).attr('href'); if (seen.has(h)) return;
    const title = $(a).find('h3').first().text().replace(/\s+/g, ' ').trim();
    const spans = $(a).find('span').toArray().map(x => $(x));
    const remEl = spans.find(x => /^[\d,]+$/.test(x.text().trim()));
    const priceEl = spans.find(x => /^[\d,]+원$/.test(x.text().trim()));
    const m = remEl && remEl.parent().text().replace(/\s+/g, ' ').match(/([\d,]+)\s*\/\s*([\d,]+)/);
    if (!title || !m) return; seen.add(h);
    if (n(m[1]) > 0) out.push({ p: '피카유니버스', id: h.split('/')[2], k: 'oripa', t: title, shop: 'PIKA UNIVERSE', cat: '포켓몬 TCG',
      price: priceEl ? n(priceEl.text().replace('원', '')) : 0, orig: 0, off: 0, live: 0, url: B + h, pr: [], tot: n(m[2]), rem: n(m[1]) });
  });
  return out;
}

// ── 쿠지사: 공개 상품 목록. 진행 중인 판만 상품 페이지에서 남은 티켓을 읽음
// 링크가 절대주소(https://kujisa.com/kuji/…)로도 나오고, 판매 중 카드에 '판매중' 글자가 없을 수 있어
// "끝났거나 아직인" 표시가 붙은 카드만 빼고 상품 페이지에서 남은 티켓으로 판단
async function kujisa() {
  const B = 'https://kujisa.com'; const $ = cheerio.load(await get(B + '/')); const out = []; const seen = new Set();
  const n = s => +String(s || '0').replace(/,/g, '');
  const DONE = /SOLD ?OUT|판매 ?종료|소진 ?100%|발매 ?(예정|대기)|출시 ?예정|공개 ?예정|COMING ?SOON/i;
  const links = $('a[href*="/kuji/"]').toArray().map(a => ({ h: ($(a).attr('href') || '').replace(/^https?:\/\/(www\.)?kujisa\.com/, ''), t: $(a).text().replace(/\s+/g, ' ').trim() }))
    .filter(l => /^\/kuji\/[^/?#]+\/?$/.test(l.h));
  diag.쿠지사 = { links: links.length, done: links.filter(l => DONE.test(l.t)).length };
  for (const { h, t } of links) {
    if (seen.has(h) || DONE.test(t)) continue; seen.add(h);
    const d = cheerio.load(await get(B + h)); const x = d('body').text().replace(/\s+/g, ' ');
    // "남은 티켓 12 / 80장" 또는 "남은 티켓 12" + "총 80장"
    const m = x.match(/남은 ?티켓\s*([\d,]+)\s*\/\s*([\d,]+)\s*장/);
    const rem = n(m ? m[1] : (x.match(/남은 ?티켓\s*([\d,]+)/) || [])[1]);
    const tot = n(m ? m[2] : (x.match(/총\s*([\d,]+)\s*장/) || [])[1]);
    const price = n((x.match(/(?:최종 ?)?판매가\s*([\d,]+)\s*원/) || x.match(/([\d,]+)\s*원/) || [])[1]);
    const title = d('h1').first().text().replace(/\s+/g, ' ').trim() || t;
    if (rem > 0) out.push({ p: '쿠지사', id: h.split('/').filter(Boolean).pop(), k: 'kuji', t: title.replace(/판매 ?중|진행 ?중/, '').replace(/^이치방쿠지\s*/, '').trim(), shop: '쿠지사', cat: '', price, orig: 0,
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

// ── 일본 오리파 공통: 페이지에 박힌 JSON 객체를 키 기준으로 꺼냄
function objectsAround(text, key) {
  const out = []; let from = 0;
  for (;;) {
    const i = text.indexOf(key, from); if (i < 0) break; from = i + key.length;
    const s = text.lastIndexOf('{"id":', i); if (s < 0) continue;
    let dep = 0, j = s; for (; j < text.length; j++) { const c = text[j]; if (c === '{') dep++; else if (c === '}') { dep--; if (dep === 0) break; } }
    try { out.push(JSON.parse(text.slice(s, j + 1))); } catch { /* 깨진 조각은 건너뜀 */ }
  }
  return out;
}
const JP_CAT = { pokemon: '포켓몬 TCG', one_piece: '원피스 카드', 'one-piece': '원피스 카드', yugioh: '유희왕', dragonball: '드래곤볼 카드', weiss: '바이스슈발츠', mtg: 'MTG' };

// ── DOPA!: 첫 화면에 실린 판매 중 팩 (1pt = 1엔)
async function dopa() {
  const B = 'https://dopa-game.jp'; const t = clean(await get(B + '/')); const seen = new Set(); const out = [];
  for (const o of objectsAround(t, '"remaining":')) {
    if (seen.has(o.id) || o.status !== 'released' || !(o.total > 0) || !(o.remaining > 0) || !o.name) continue; seen.add(o.id);
    const cat = String(o.category || 'pokemon');
    out.push({ p: 'DOPA', id: String(o.id), k: 'oripa', t: o.name, shop: 'DOPA!', cat: JP_CAT[cat] || 'TCG', price: +o.one_time_point || 0, cur: 'JPY', orig: 0, off: 0, live: 0,
      url: `${B}/${cat.replace(/_/g, '-')}/gacha/${o.id}`, pr: [], tot: o.total, rem: o.remaining, jp: 1 });
  }
  return out;
}

// ── magi: 공개 오리파 목록 (가격/1구, 남은/전체 구)
async function magi() {
  const B = 'https://magi.camp'; const $ = cheerio.load(await get(B + '/oripa/lotteries/')); const seen = new Set(); const out = [];
  const n = x => +String(x).replace(/[^\d]/g, '');
  const cards = $('a[href*="/oripa/lotteries/"]').filter((_, a) => /\/oripa\/lotteries\/\d+\/?$/.test($(a).attr('href') || ''));
  diag.magi = { links: cards.length };
  cards.each((_, a) => {
    const h = $(a).attr('href'); const txt = $(a).text().replace(/\s+/g, ' ').trim();
    // 1순위: 카드 class, 2순위: 화면 글자 "¥100/1口 残り496,854/500,000口 제목"
    const tm = txt.match(/¥\s*([\d,]+)\s*\/\s*1口\s*残り\s*([\d,]+)\s*\/\s*([\d,]+)\s*口\s*(.*)$/);
    const title = $(a).find('.online-oripa-card__title').text().trim() || (tm ? tm[4].trim() : '');
    const rem = n($(a).find('.remaining-amount-meter__remain').text()) || (tm ? n(tm[2]) : 0);
    const tot = n($(a).find('.remaining-amount-meter__amount').text()) || (tm ? n(tm[3]) : 0);
    const price = n($(a).find('.online-oripa-card__price').text()) || (tm ? n(tm[1]) : 0);
    if (!title || seen.has(h) || !(rem > 0)) return; seen.add(h);
    out.push({ p: 'magi', id: h.split('/').filter(Boolean).pop(), k: 'oripa', t: title, shop: 'magi', cat: '포켓몬 TCG', price, cur: 'JPY',
      orig: 0, off: 0, live: 0, url: h.startsWith('http') ? h : B + h, pr: [], tot, rem, jp: 1 });
  });
  if (!out.length) diag.magi.sample = cards.first().text().replace(/\s+/g, ' ').trim().slice(0, 150);
  return out;
}

// ── オリパワン: 첫 화면에 실린 팩 (남은 구수를 공개하는 팩만)
async function oripaone() {
  const B = 'https://oripaone.jp'; const t = clean(await get(B + '/')); const seen = new Set(); const out = [];
  for (const o of objectsAround(t, '"displayRemaining":')) {
    if (seen.has(o.id) || !o.title || !(o.quantity > 0) || !(o.remaining > 0) || o.visible !== 'public') continue; seen.add(o.id);
    const cat = (o.categories || ['pokemon'])[0];
    out.push({ p: '오리파원', id: o.id, k: 'oripa', t: o.title, shop: 'オリパワン', cat: JP_CAT[cat] || 'TCG', price: +o.price || 0, cur: 'JPY', orig: 0, off: 0, live: 0,
      url: `${B}/category/${cat}/${o.slug}`, pr: [], tot: o.quantity, rem: o.remaining, jp: 1 });
  }
  return out;
}

// ── 포케팝 TCG: 오리파 상품(번호별 옵션)의 품절 아닌 번호 수 = 남은 구수
async function pokepop() {
  const B = 'https://pokepop.kr'; const $ = cheerio.load(await get(B + '/')); const seen = new Set(); const out = [];
  const links = $('a[href*="/product/"]').map((_, a) => $(a).attr('href')).get().filter(h => /오리파|%EC%98%A4%EB%A6%AC%ED%8C%8C/.test(h));
  for (const h of links) {
    const id = (h.match(/\/(\d+)\/category\//) || h.match(/\/(\d+)\/?$/) || [])[1]; if (!id || seen.has(id)) continue; seen.add(id);
    const url = h.startsWith('http') ? h : B + encodeURI(decodeURI(h));
    const d = cheerio.load(await get(url));
    const opts = d('select option').map((_, o) => d(o).text().trim()).get().filter(t => /^\d+/.test(t));
    if (!opts.length) continue;
    const rem = opts.filter(t => !/품절/.test(t)).length;
    const txt = d('body').text().replace(/\s+/g, ' ');
    const title = (txt.match(/상품명\s*(.+?)\s*(?:소비자가|판매가)/) || [])[1] || d('title').text().trim();
    const price = +((txt.match(/판매가\s*([\d,]+)\s*원/) || [])[1] || '0').replace(/,/g, '');
    if (rem > 0) out.push({ p: '포케팝', id, k: 'oripa', t: title.trim(), shop: '포케팝 TCG', cat: '포켓몬', price, orig: 0, off: 0, live: 0, url, pr: [], tot: opts.length, rem });
  }
  return out;
}

// ── 화면 렌더링이 필요한 사이트용 브라우저 (Clove, 포카챠). 한 번 띄워서 같이 씀
let _browser = null;
async function page() {
  if (!_browser) { const { chromium } = await import('playwright'); _browser = await chromium.launch(); }
  const ctx = await _browser.newContext({ userAgent: UA + ' Chrome/130', locale: 'ko-KR', viewport: { width: 1280, height: 2000 } });
  return ctx.newPage();
}
async function scrollAll(pg, sel) {
  let last = -1;
  for (let i = 0; i < 12; i++) {
    await pg.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await pg.waitForTimeout(1200);
    const n = await pg.locator(sel).count(); if (n === last && i > 2) break; last = n;
  }
}

// ── Clove 오리파 한국어판: 카테고리별 화면에서 제목(이미지 alt)·1회 pt·남은/전체 구수
async function clove() {
  const B = 'https://oripa.clove.jp'; const pg = await page(); const out = new Map();
  const CAT = { Pokemon: '포켓몬', OnePiece: '원피스', Yugioh: '유희왕', WeissSchwarz: '바이스슈발츠', All: '' };
  try {
    for (const c of Object.keys(CAT)) {
      // 광고·분석 통신이 끝없이 이어져 'networkidle'에 도달하지 않음 → 카드가 화면에 뜨면 바로 읽음
      await pg.goto(`${B}/ko/oripa/${c}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      // 카드 링크 형식이 /ko/oripa/<카테고리>/<id> 가 아닐 수 있어 카테고리 메뉴 링크만 빼고 oripa 링크를 모두 봄
      const SEL = 'a[href*="/oripa/"]';
      await pg.waitForFunction(() => /1회/.test(document.body.innerText), null, { timeout: 30000 }).catch(() => {});
      await pg.waitForTimeout(1500); await scrollAll(pg, SEL);
      const rows = await pg.evaluate(cats => {
        const nav = new RegExp(`/oripa/(${cats.join('|')})/?$`);
        const hrefs = [...new Set([...document.querySelectorAll('a[href*="/oripa/"]')].map(a => a.getAttribute('href')))]
          .filter(h => h && !nav.test(h.split(/[?#]/)[0]));
        return hrefs.map(h => {
          let p = document.querySelector(`a[href="${h}"]`);
          for (let i = 0; i < 6 && p.parentElement; i++) { if (/1회/.test(p.innerText)) break; p = p.parentElement; }
          const t = p.innerText.replace(/\s+/g, ' ');
          const m = t.match(/([\d,]+)\s*(?:pt|PT|P)?\s*\/\s*1회\s*(?:남은\s*(?:수량)?\s*)?([\d,]+)\s*\/\s*([\d,]+)/);
          const img = p.querySelector('img[alt]:not([alt="coin"])');
          return { id: h.split(/[?#]/)[0].split('/').filter(Boolean).pop(), h, alt: img ? img.alt : '', m: m ? [m[1], m[2], m[3]] : null, t: t.slice(0, 120) };
        });
      }, Object.keys(CAT));
      if (c === 'All') diag.Clove = { url: pg.url(), links: rows.length, parsed: rows.filter(r => r.m).length, hrefs: rows.slice(0, 3).map(r => r.h),
        sample: rows[0]?.t || (await pg.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 200))) };
      for (const r of rows) {
        if (!r.m || out.has(r.id)) continue;
        const n = x => +x.replace(/,/g, '');
        const title = r.alt.replace(/\s*\|\s*클로브 오리파\(Clove\)\s*$/, '').replace(/^오리파\s*/, '').trim();
        if (!title || n(r.m[1]) <= 0 || n(r.m[2]) <= 0) continue;
        out.set(r.id, { p: 'Clove', id: r.id, k: 'oripa', t: title, shop: 'Clove 오리파', cat: CAT[c], price: n(r.m[0]), cur: 'PT', orig: 0, off: 0, live: 0,
          url: r.h.startsWith('http') ? r.h : B + r.h, pr: [], tot: n(r.m[2]), rem: n(r.m[1]), tr: /[぀-ヿ一-鿿]/.test(title) ? 1 : 0 });
      }
    }
  } finally { await pg.context().close(); }
  return [...out.values()];
}

// ── 포카챠: 셀럽 포토카드 가챠. 기간 판매라 남은 수량 없음, 오늘이 기간 안인 것만
async function pocacha() {
  const B = 'https://www.pocacha.im'; const pg = await page(); const out = [];
  try {
    await pg.goto(B + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await pg.waitForSelector('a[href^="/gacha/"]', { timeout: 30000 }).catch(() => {}); await pg.waitForTimeout(1500);
    const rows = await pg.evaluate(() => [...document.querySelectorAll('a[href^="/gacha/"]')].map(a => ({ h: a.getAttribute('href'), t: a.innerText.replace(/\s+/g, ' ').trim() })));
    const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10).replace(/-/g, '/');
    const seen = new Set();
    for (const r of rows) {
      const m = r.t.match(/^(.*?)(\d{4}\/\d{2}\/\d{2})\s*~\s*(\d{4}\/\d{2}\/\d{2})/); if (!m || seen.has(r.h)) continue; seen.add(r.h);
      if (m[2] > today || m[3] < today) continue;
      out.push({ p: '포카챠', id: r.h.split('/').pop(), k: 'gacha', t: m[1].trim(), shop: '포카챠', cat: '', price: 0, orig: 0, off: 0, live: 0,
        url: B + r.h, pr: [], tot: 0, rem: 0, u: 1, until: m[3] });
    }
  } finally { await pg.context().close(); }
  return out;
}

// ── 오리파코리아: 오리파 목록(campaigns) 화면에서 "제목 … 가격 원 / 1회 남은 수 X/Y" (화면 렌더링)
async function oripakorea() {
  const B = 'https://oripa-korea.com'; const pg = await page(); const out = [];
  try {
    await pg.goto(B + '/campaigns.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await pg.waitForSelector('a[href*="oripa-v2.html"]', { timeout: 30000 }).catch(() => {});
    await pg.waitForTimeout(2000); await scrollAll(pg, 'a[href*="oripa-v2.html"]');
    const rows = await pg.evaluate(() => [...document.querySelectorAll('a[href*="oripa-v2.html"]')].map(a => ({ h: a.getAttribute('href'), t: a.innerText.replace(/\s+/g, ' ').trim() })));
    const seen = new Set(); const n = x => +String(x).replace(/,/g, '');
    for (const r of rows) {
      const id = (r.h.match(/id=([\w-]+)/) || [])[1]; if (!id || seen.has(id)) continue;
      // 할인 표기("71%6,500원")가 있으면 건너뛰고 실제 1회 가격을 읽음
      const m = r.t.match(/^(.*?)\s*(?:\d+%\s*[\d,]+\s*원\s*)?([\d,]+)\s*원\s*\/\s*1회\s*남은 수\s*([\d,]+)\s*\/\s*([\d,]+)/);
      if (!m) continue; seen.add(id);
      const title = m[1].replace(/^(NEW|Event|EVENT|HOT|BEST)\s+/i, '').trim();
      if (n(m[3]) > 0 && title) out.push({ p: '오리파코리아', id, k: 'oripa', t: title, shop: '오리파코리아', cat: /원피스|OP-|ONE ?PIECE/i.test(title) ? '원피스' : '포켓몬',
        price: n(m[2]), orig: 0, off: 0, live: 0, url: `${B}/oripa-v2.html?id=${id}`, pr: [], tot: n(m[4]), rem: n(m[3]) });
    }
  } finally { await pg.context().close(); }
  return out;
}

// ── 오리파덕: "N구 완판 후 공개" 방식이라 남은 구수를 공개하지 않음 → 상품명·가격·총 구수만 (hid:1)
async function oripaduk() {
  const B = 'https://oripaduk.com'; const $ = cheerio.load(await get(B + '/oripa')); const seen = new Set(); const out = [];
  $('a[href*="/oripa/?idx="]').each((_, a) => {
    const h = $(a).attr('href'); const idx = (h.match(/idx=(\d+)/) || [])[1];
    const title = $(a).find('h2').first().text().replace(/\s+/g, ' ').trim();
    const price = +(($(a).find('p.pay').first().text().match(/([\d,]+)\s*원/) || [])[1] || '0').replace(/,/g, '');
    if (!idx || !title || seen.has(idx)) return;
    // 같은 상품 카드 안에 품절 표시가 있으면 제외
    let c = $(a); while (c.parent().length && c.parent().find('h2').length === 1) c = c.parent();
    if (/품절|SOLD ?OUT/i.test(c.text())) return;
    seen.add(idx);
    const tot = +((title.match(/(\d+)\s*구/) || [])[1] || '0');
    out.push({ p: '오리파덕', id: idx, k: 'oripa', t: title.replace(/🔸️?/g, ' ').replace(/\s+/g, ' ').trim(), shop: '오리파덕', cat: /루피|원피스|아카이누|키자루|아오키지|나미|우타/.test(title) ? '원피스' : '포켓몬',
      price, orig: 0, off: 0, live: 0, url: B + h, pr: [], tot, rem: 0, hid: 1 });
  });
  return out;
}

const SITES = { 라이브쿠지: livekuji, 쿠지샵: kujishop, 쿠지머신: kujimachine, 레전드쿠지: legendkuji, '2쿠지': twokuji, 코스믹쿠지: cosmickuji,
  미라클쿠지: miraclekuji, 피카유니버스: pikauniverse, 쿠지사: kujisa, '一番くじONLINE': ichibanOnline,
  magi, 오리파원: oripaone, 포케팝: pokepop, Clove: clove, 포카챠: pocacha,
  오리파코리아: oripakorea, 오리파덕: oripaduk };   // DOPA는 외부 수집기 접속을 막아(404) 제외
const prev = existsSync('data/raw.json') ? JSON.parse(readFileSync('data/raw.json', 'utf8')) : null;
const res = { collectedAt: new Date().toISOString(), sites: {}, items: [] };
for (const [name, fn] of Object.entries(SITES)) {
  try {
    const items = await fn();
    res.items.push(...items); res.sites[name] = { ok: true, at: new Date().toISOString(), count: items.length };
    // 0건이면 원인 추적용으로 찾은 링크 수·화면 글자 일부를 함께 남김
    console.log(name, items.length, items.length === 0 && diag[name] ? JSON.stringify(diag[name]) : '');
  } catch (e) {
    // 실패 시 이전 수집분을 유지하고 수집 시각을 그대로 표시
    const old = prev?.items.filter(i => i.p === name) || [];
    res.items.push(...old); res.sites[name] = { ok: false, at: prev?.sites?.[name]?.at || null, count: old.length, error: String(e.message || e).slice(0, 200) };
    console.error(name, 'FAILED', e.message);
  }
}
if (_browser) await _browser.close();
writeFileSync('data/raw.json', JSON.stringify(res));
