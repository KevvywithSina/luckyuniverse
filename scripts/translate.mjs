// 일본 상품명 자동 번역 (DeepL). GitHub Secrets 의 DEEPL_KEY 가 있을 때만 동작하고, 번역 결과는 data/tr-cache.json 에 쌓아 재사용
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const key = process.env.DEEPL_KEY || '';
const raw = JSON.parse(readFileSync('data/raw.json', 'utf8'));
const manual = JSON.parse(readFileSync('config/translations.json', 'utf8'));
const cache = existsSync('data/tr-cache.json') ? JSON.parse(readFileSync('data/tr-cache.json', 'utf8')) : {};
const need = [...new Set(raw.items.filter(i => i.jp).map(i => i.t))].filter(t => !manual[t] && !cache[t]);
console.log('번역 필요', need.length, key ? '' : '(DEEPL_KEY 없음: 원문 표시)');
if (key && need.length) {
  const host = key.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
  for (let i = 0; i < need.length; i += 40) {
    const batch = need.slice(i, i + 40);
    try {
      const r = await fetch(host + '/v2/translate', { method: 'POST', headers: { 'Authorization': 'DeepL-Auth-Key ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: batch, source_lang: 'JA', target_lang: 'KO' }) });
      if (!r.ok) { console.error('DeepL', r.status); break; }
      const j = await r.json(); j.translations.forEach((t, k) => { cache[batch[k]] = t.text; });
    } catch (e) { console.error('DeepL 실패', e.message); break; }
  }
}
writeFileSync('data/tr-cache.json', JSON.stringify(cache));
