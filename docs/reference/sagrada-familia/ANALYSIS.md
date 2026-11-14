# 사그라다 파밀리아 참고 사진 분석 (31장)

모델: `src/map/world/basilicaGeometry.js` → `tools/map-data/build_basilica.mjs` → `public/models/sagrada-familia/basilica.glb`.
기준: **완공 상태**. 사진 속 타워크레인·비계·공사 가림막·가설 구조물·공사 차량은 모델에 넣지 않았고, 가려진 부분은 실제 형태(사진의 다른 각도 또는 공식 설계)로 복원했습니다.

## 1. 촬영 방향별 분류

모든 사진이 드론·항공 사진입니다(지상 근접 사진 없음). 대부분 612 px 폭이라 조각 세부는 읽을 수 없고, 고해상도인 1·3번(약 2,000 px)이 근거리 디테일의 주 근거입니다.

| 분류 | 사진 | 읽은 내용 |
|---|---|---|
| 수난 파사드(남서, 사르데냐 거리) | 1, 3, 9, 10, 12, 14, 19, 30 | 기울어진 뼈 모양 기둥 6개, 흰 늑골 18개의 텐트형 박공, 꼭대기 금색 십자가, 4개 첨탑과 모자이크 꼭대기, 측랑의 뾰족 박공과 원형 창 |
| 탄생 파사드(북동, 가우디 광장·연못) | 6, 13, 20 | 더 어둡고 오래된 석재, 첨탑 4개, 성구실 격자 돔(13), 연못 공원 |
| 영광 파사드(남동, 마요르카 거리) | 5, 7, 21 | 크레인과 공사 중 부분만 보임 → 완공 형태는 공식 설계 근거 |
| 첨탑 상부 | 3, 4(야간), 5, 10, 11 | 길쭉한 빨강·주황·흰색 모자이크 꼭대기와 흰 구슬, 둥근 원판과 십자가, 마리아 탑의 별, 예수 탑 십자가 |
| 항공 전경 | 1, 2, 7, 8, 15, 16, 17, 18, 20, 23, 26, 28, 29, 31 | 실루엣·높이 비율, 도시 색감, 산(콜세롤라)·바다 방향 |
| 주변 거리·공원 | 2, 15, 16, 22, 24, 25, 27 | 모서리를 깎은 팔각 블록과 중정, 거리마다 이어지는 가로수, 성당 앞 두 광장(타원 잔디 / 연못) |

## 2. 기존 모델과 사진의 차이 → 보강 내용

| 항목 | 기존 | 사진·공식 자료 | 보강 |
|---|---|---|---|
| 첨탑 수 | 14 (영광 4개 없음) | 18 | 영광 첨탑 4개 추가 |
| 사도 첨탑 꼭대기 | 높이의 약 12 %, 작은 공 | 약 22–25 %, 띠 무늬 육각 기둥 + 흰 구슬 + 원판·금십자가 (3, 11) | 비율·형태·색 재구성, 파사드 바깥을 향한 원판 |
| 중앙 첨탑 단면 | 원형 회전체 | 모서리 둥근 사각형 + 세로 늑골 + 가로 띠 (1, 3, 11) | 리브 단면 탑으로 교체 |
| 예수 탑 | 십자가 크기 추정 | 172.5 m, 십자가 높이 17 m·폭 13.5 m | 치수 반영 |
| 수난 파사드 | 원통 기둥, 박공 띠 16개 | 뼈 모양 기둥, 늑골 18개, 프리즈 조각상 줄 (1, 3) | 형태 교체, 조각상 추가 |
| 탄생 파사드 | 박공 + 덩어리 140개 | 겹겹의 아치, 촘촘한 조각, 어두운 석재 (13) | 아치 4겹, 조각 420개 + 종유석, 색 조정 |
| 측랑·창 | 단순 박공 | 뾰족 박공 + 원형 창, 2단 창, 금색 첨두 (1, 3) | 창(유리 재질), 원형 창, 버트레스 |
| 후진(앱스) | 원뿔 7개 | 계단식 뾰족탑 왕관 (2, 4) | 3단 첨탑 + 안쪽 12개 |
| 성구실 | 없음 | 격자 원뿔 돔 2개 (1, 11, 13) | 드럼 + 격자 돔 + 첨두 |
| 석재 색 | 단일 톤 | 정오 사진 표본: 탑 #9f8162 / #978371, 수난 연한 사암, 박공 거의 흰색 | 부위별 색 + 근거리 석재 줄눈·결 |
| 주변 지붕 | 진한 빨강 기와 위주, 줄무늬 | 밝은 테라스·회색·차분한 테라코타 혼합 (사진 16, 22–25 군집: #c5b0a3, #bb846d, #9c9190) | 아틀라스 색·혼합 비율 조정, 줄무늬 제거 |

## 3. 근거 구분

### 사진 기반
- 수난·탄생 파사드의 형태와 색, 사도 첨탑 8개의 형태, 꼭대기 모자이크 장식
- 측랑 박공·창, 후진 첨탑, 성구실 돔(서쪽 성구실, 2016년 완공), 석재 색
- 주변 블록·지붕 색·가로수

### 공식 완공 설계·발표 기반 (사진에 완공 형태가 없음)
- **예수 그리스도 탑** 172.5 m, 네 팔 십자가 높이 17 m·폭 13.5 m, 흰 유약 세라믹·유리 (2026년 2월 완성 보도)
- **영광 파사드**: 앞면 30 m 구간을 받치는 기둥 8개(팔복), 쌍곡면 랜턴 16개(앞 7 + 뒤 9)가 가운데로 갈수록 높아지며 상부 약 80 m
- **영광 첨탑 4개**: 가운데 2개 117 m, 바깥 2개 112 m (출처마다 120 m로 적은 곳도 있어 **확정되지 않은 수치**)
- **두 번째 성구실**(북쪽 모서리)은 첫 번째를 본뜸, **회랑**과 후진 뒤 **성모승천 경당**(망토를 뜻하는 푸른 돔)
- 거리 쪽 계단·다리 등 영광 파사드 앞 도시 구간은 설계가 확정되지 않아 넣지 않았습니다.

사용한 웹 자료(이 세션에서 sagradafamilia.org·위키백과·icgc.cat 직접 접속은 막혀 있어 검색 결과와 보도를 근거로 함):
- [catalannews: 172.5 m reached as cross is installed](https://www.catalannews.com/society-science/item/sagrada-familia-reaches-1725-metres)
- [artdependence: final height 172.5 m](https://artdependence.com/articles/sagrada-familia-reaches-final-height-of-1725-metres-as-cross-is-installed/)
- [ara.cat: milestones until 2035](https://en.ara.cat/culture/these-will-be-the-great-milestones-of-the-sagrada-familia-until-2035_1_5760542.html)
- [visitarsagradafamilia.com: Glory façade design](https://visitarsagradafamilia.com/en/glory-facade-sagrada-familia/)
- [foreverbarcelona: tower heights](https://www.foreverbarcelona.com/sagrada-familia-towers-worth-it-which-better/)
- [tickets-sagradafamilia.co: 18 towers](https://tickets-sagradafamilia.co/sagrada-familia-towers/)
- [Foundation booklet (sacristy, cloister)](https://sagradafamilia.org/documents/20142/1000561/Booklet_04.pdf/5eb8514a-7bd2-77d0-15dc-9c9c0315cf23)
- [blog.sagradafamilia.org: Assumption chapel](https://blog.sagradafamilia.org/en/com-es-fan-les-escultures-de-la-capella-assumpta-i-simbolisme/)

## 4. LOD

| | 근거리 LOD0 (< 450 m) | 원거리 LOD1 |
|---|---|---|
| 삼각형 | 약 95 k | 약 17 k |
| 드로우콜 | 3 (석재·모자이크·유리) | 2 |
| 내용 | 모든 장식(구슬, 조각, 창, 격자 띠, 조각상) | 주요 형태만, 분할 수 절반 |

두 레벨 모두 `basilica.glb` 하나에 들어 있습니다(meshopt, 404 kB). 레벨이 바뀌면 그림자 캐시를 한 번 다시 그립니다. 충돌 형상(693개)은 LOD0 기준입니다.
