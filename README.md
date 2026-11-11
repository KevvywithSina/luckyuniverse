# 럭키유니버스

온라인 쿠지 사이트(라이브쿠지·쿠지샵·쿠지머신·레전드쿠지)에서 진행 중인 쿠지·오리파를 모아 보여주는 정적 현황판.

## 동작
- `.github/workflows/update.yml` 이 2시간마다 `npm run scrape`(공개 페이지/API 수집 → data/raw.json) → `npm run build`(라벨링 → dist/index.html) → GitHub Pages 배포
- 사이트 하나가 수집에 실패하면 직전 값을 유지하고, 화면 상단에 "갱신 실패·이전 값"으로 표시

## 설정 (코드 수정 없이)
- `config/site.json` : GA4 측정 ID(`ga4`), 문의·광고 구글 폼(`form.action`, `form.fields`), 아웃링크 UTM(`utm`)
- `config/overrides.json` : 오류 제보 반영(`hide`, `ip`, `type`). key = `사이트:id`

## 최초 배포
1. 이 폴더를 새 저장소에 올리고 Settings → Pages → Source 를 "GitHub Actions" 로 선택
2. Actions 탭에서 "수집·배포" 를 한 번 수동 실행
