# SKY DIVE — Cinematic Web Experience

React + React Three Fiber + custom WebGL shaders + GSAP 로 만든 스카이다이빙 메타버스의 시네마틱 인트로 / 인증 / 메인 월드 프로토타입입니다.

## 실행 방법

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # 프로덕션 빌드 (dist/)
npm run preview    # 빌드 결과 미리보기
npm test           # 낙하 충돌 판정 단위 테스트 (node --test)
```

데모 계정: `demo@skydive.io` / `skydive123` (로그인 카드 하단 링크로 자동 입력). 회원가입한 계정은 브라우저 localStorage에 저장됩니다(개발용).

## 장면 흐름

| Phase | 내용 | 길이 |
|---|---|---|
| `intro` | 고도 540에서 수평선 약간 아래를 바라봄: 상층 구름층(start deck)과 그 아래 구름바다, 화면 중앙은 트여 있음 | 대기 |
| `converging` | 스카이다이빙: pitch −0.18→−1.2로 숙이며 낙하 시작(가속), 상층 구름층의 강하 클러스터로 진입하는 순간(2.35s) 구름 내부 레이어로 전환, 로그인은 구름 속에서 아래를 보는 상태 | 3.5s |
| `login` | 구름 내부 배경 위에 유리 카드 blur→sharp, 필드 순차 등장 | 1.5s |
| (signup) | 로그인 ⇄ 회원가입 카드 크로스페이드, 배경 유지 | 0.8s |
| `dissipating` | 구름 안 일정 속도 하강(60 u/s) → 수증기가 화면 전체에서 불규칙하게 옅어짐(얇은 곳부터, 앞 시트 → 뒤 시트, 위로 흘러감) → 틈 사이로 아래 구름바다 → 감속하며 pitch를 들어 고도 142의 WORLD 포즈로 수평 비행 | 5s |
| `world` | SKY DIVE METAVERSE 메인 월드 + HUD | – |
| `reconverging` | SIGN OUT 시 구름이 다시 몰려와 로그인으로 복귀 | 2.8s |

## 파일 구조

```
src/
├─ App.jsx                      # 레이아웃: Canvas + UI 레이어 + 로딩 베일
├─ state/
│  ├─ useExperience.js          # Scene 상태 머신 (zustand) + 입력 잠금
│  └─ cinematic.js              # GSAP가 트윈하는 가변 파라미터, 카메라 포즈
├─ scenes/                      # DOM/UI 장면 + 연출 감독
│  ├─ CloudTransition.js        # ★ 장면별 GSAP Timeline (intro/convergence/dissipation/reconvergence)
│  ├─ IntroScene.jsx            # Scene 01
│  ├─ AuthStage.jsx             # Scene 03/04 카드 등장·전환·성공 처리
│  ├─ LoginScene.jsx            # 로그인 카드
│  ├─ SignupScene.jsx           # 회원가입 카드
│  ├─ Field.jsx                 # 유리 입력창 + 에러
│  └─ MetaverseScene.jsx        # 메인 월드 HUD
├─ three/                       # WebGL 레이어
│  ├─ Experience.jsx            # Canvas, 적응형 해상도, 준비 신호
│  ├─ CameraController.jsx      # 리그 포즈 + 호흡 + 포인터 패럴랙스 + 세로화면 FOV
│  ├─ Sky.jsx                   # 하늘 돔 셰이더 (그라데이션, 태양, 지평선 헤이즈)
│  ├─ Terrain.jsx               # 구름 위로 솟은 설산
│  ├─ GodRays.jsx               # 화면공간 빛내림
│  ├─ WorldProps.jsx            # 플레이어 점퍼, 멀티플레이 슬롯(AVATAR_SLOTS), 공기 입자
│  └─ clouds/
│     ├─ CloudSystem.jsx        # ★ 모든 구름: 단일 인스턴스 드로우, 매 프레임 깊이 정렬
│     ├─ cloudLayout.js         # ★ 구름 위치·크기·밀도·이동 방향 설정 (CLOUD_CONFIG)
│     ├─ cloudShader.js         # 빌보드 볼륨 라이팅 셰이더
│     ├─ cloudTextures.js       # 절차적 적운 스프라이트 아틀라스 + 디테일 노이즈
│     ├─ CloudFloor.jsx         # 연속된 구름 바다 바닥
│     └─ CloudInterior.jsx      # "구름 속" 전체화면 레이어 + 중앙부터 열리는 효과
├─ auth/
│  ├─ AuthController.jsx        # UI가 쓰는 유일한 인증 API (useAuth)
│  ├─ validation.js             # 이메일/사용자명/비밀번호 규칙
│  └─ providers/
│     ├─ AuthProvider.js        # 프로바이더 계약
│     ├─ localAuthProvider.js   # 개발용 localStorage 프로바이더 (기본)
│     ├─ supabaseAuthProvider.js
│     └─ firebaseAuthProvider.js
├─ hooks/usePerformanceTier.js  # high/low 품질 티어 (모바일 자동 감지)
└─ styles/global.css
```

## 구름 시스템 구조

구름은 이미지 페이드가 아니라 **실제로 이동하는 3D 구름 개체**입니다.

- **레이어** — `sea`(구름 바다), `cumulus`(원경 적운 기둥), `transition`(카메라 기준 전환 구름). 모두 하나의 `InstancedBufferGeometry`로 그리고, 반투명 합성이 정확하도록 매 프레임 뒤→앞 정렬합니다.
- **시작 화면 = WORLD 레이어 + start deck** — 시작 화면은 WORLD의 sea·cumulus 레이어를 그대로 보여 주고, 그 위에 상층 구름층(`CLOUD_CONFIG.startDeck`)을 깝니다. start deck은 cumulus와 *같은 퍼프 생성 함수*(크기·알파·타일·명암·기울기)로 cumulus 상층 덱(y 270~370)을 템플릿 삼아 지터 격자에 배치하며, 시작 화면 중앙 40% 영역과 강하 지점 주변은 비웁니다. WORLD 진입 전 화면 밖에서 `cine.deck`으로 사라지므로 WORLD는 이전과 동일합니다.
- **강하 클러스터** — 시작 카메라 바로 아래(x 0, z −60)의 촘촘한 구름. START에서 카메라가 낙하하며 통과하고, 로그인 성공 후 그 아래로 빠져나옵니다.
- **transition / hero** — 현재 비활성(`transition.enabled: false`). 코드는 남아 있어 다시 켤 수 있습니다.
- **구름 속(CloudInterior)** — 수증기 시트가 끝없이 확대되며 바깥으로 흘러가는 fly-through(`cine.push` = 속도).
  - 닫힘(로그아웃): `cine.open` 1→0, 화면 가장자리부터 닫히는 반경 마스크.
  - 걷힘(로그인 성공): `cine.clear` 0→1, 각 시트의 노이즈 밀도 기준 마스크 — 밀도가 낮은 곳부터 화면 전체에서 동시에 틈이 생기고, 앞 시트가 먼저·뒤 시트가 나중에 걷힘. `cine.rise`로 수증기가 위로 흘러감. 조정 값은 `INTERIOR_LOOK.clear*`, `riseRates`.
- **튜닝** — `src/three/clouds/cloudLayout.js`의 `CLOUD_CONFIG.startDeck`(강하 클러스터, 격자·간격·빈칸 비율, 중앙 비우기 `keepClear`). `sea`·`cumulus`는 WORLD 구름이므로 시작 화면 때문에 바꾸지 않습니다. 비행 타이밍과 카메라 포즈는 `src/scenes/CloudTransition.js`, `src/state/cinematic.js`의 `CAMERA_POSES`.

### 질감 조정 상수

- `src/three/clouds/cloudShader.js` → `CLOUD_LOOK`: 가장자리 침식(`edgeErosion`), 노이즈 옥타브 비중(`edgeWeights`, 고주파는 작게), 경계 투명 램프(`bodyStart`/`bodyEnd`), 명암 램프(`shadeRamp`/`litRamp`), 측면광·요철 강도
- `src/three/clouds/CloudInterior.jsx` → `INTERIOR_LOOK`: 시트 coverage 램프, 열림/닫힘 가장자리 폭, 명암 램프

### 전환 규칙 (`src/scenes/CloudTransition.js`)

- `.set` / 0.4초 미만 tween 없음 — 모든 변화는 easing tween
- 구름 내부 레이어는 균일 페이드하지 않음: 휴지 상태는 `cover 0, open 1`(구멍이 화면 밖 → 보이지 않음). `open` 1→0으로 가장자리부터 닫히고, 0→1로 중앙부터 열림(`closeBank` / `openBank`, 보이는 하늘 면적이 시간에 거의 선형으로 변하는 ease)
- 카메라 위치·fog 변경은 구름이 완전히 닫힌 뒤에만(`isBankClosed()`)
- 3D 레이어는 `isBankClosed()`일 때만 끄며, 이때 interior의 뒷 시트는 항상 불투명하므로 화면에 변화가 없음
- UI 페이드(인트로 타이틀/버튼, HUD)는 구름이 덮는 구간과 겹치도록 길게

### 렌더링

- **실루엣** — `cloudTextures.js`가 적운 몸체(부드러운 밀도 돔)를 절차적으로 생성한 아틀라스.
- **디테일** — 셰이더에서 Worley(셀룰러) + fBm 노이즈 텍스처(`vapor`)로 가장자리를 침식해 작은 둥근 돌출부와 수증기 같은 가장자리를 픽셀 단위로 생성 → 가까이 다가가도 흐려지지 않음.
- **명암** — 실루엣 밀도의 유한 차분 노멀 + 태양 방향 자기 그림자 + Worley 볼록/주름 명암 → 빛 받는 면은 밝게, 그늘은 회청색. 역광 실버 라이닝, 바닥 어둡게, 대기 원근.
- **구름 속 화면** — `CloudInterior`: 서로 다른 속도로 흐르고 확대되는 3겹의 수증기 시트(깊이감), 로그인 성공 시 중앙부터 찢어지듯 열림.

## 성능

- 품질 티어(`usePerformanceTier`): 모바일/저사양은 구름 수 50%, 텍스처 256px, DPR 0.75~1.1 (`?tier=high|low`로 강제 가능)
- FPS 기반 적응형 해상도 (`AdaptiveResolution`)
- 구름이 화면을 완전히 덮은 동안(로그인 화면)에는 구름·지형·바닥 렌더링과 CPU 계산을 건너뜀
- 모든 연출 값은 React 상태가 아닌 가변 객체 → 애니메이션 중 리렌더 없음
- 타임라인 시작 시 이전 타임라인 kill + 전역 `locked` 플래그로 중복 클릭 방지

## 맵 선택 (로그인 이후)

- WORLD 화면 좌측의 반투명 패널(`src/scenes/MapSelect.jsx`)에 맵 목록이 표시되고, 맵을 고르면 패널 옆에 원거리 전경 미리보기와 **입장** 버튼이 나타납니다.
- 맵 목록은 `src/data/maps.js`의 `MAPS` 배열 하나로 관리합니다. 맵 추가 = 항목 추가: `world`(타일 세트·랜드마크 위치/방향·낙하 설정), `preview`(캡처 이미지, 공전 반경·고도·주시 높이·주기·시작 방위·fov).
- 잠금: 사용자가 처음 선택한 플레이 가능 맵이 '내 맵', 나머지는 잠금 아이콘(`src/state/useMapAccess.js`). 포인트 해금은 `unlock.cost` + `unlockedIds`로 이후 구현.
- 라우트: `/maps/:id` (`src/router/router.js`). 정적 호스팅 시 SPA fallback 필요.

## 3D 맵 (사그라다 파밀리아)

| 구역 | 표현 | 데이터 |
|---|---|---|
| 근거리 ≤600 m | 실제 건물 외곽선 돌출(파사드·지붕·1층 KTX2 아틀라스), 가로수(≤1.3 km), 성당 절차적 모델(완공 상태, 18개 첨탑, LOD 2단계, meshopt glb) | Overture Maps(OSM), 참고 사진·공식 설계 |
| 중거리 ≤2.7 km | 건물을 방향 있는 박스로 인스턴싱(같은 아틀라스), 프리셋별 표시 거리 1.6/2.3/2.7 km | Overture Maps(OSM) |
| 지형 | 쿼드트리 L0 65 km … L8 256 m, 경사·고도 재질 혼합 + 디테일 노멀 | Copernicus DEM GLO-30 |
| 항공영상 | L5–L8(≤3 km): ICGC 25 cm 정사영상 512 px, L0–L4: Sentinel-2, 모두 KTX2(ETC1S) | ICGC(CC BY 4.0), Sentinel-2 |

- 타일: `public/tiles/<map>/` (≈8.2 MB, JS 번들 밖). 카메라 위치에 따라 필요한 타일만 요청·업로드하고 LRU로 해제. 기본 URL `VITE_TILES_BASE_URL`, 이미지 소스 `VITE_MAP_IMAGERY`(기본 `hybrid`). 생성 도구: `tools/map-data/`.
- 성당: 참고 사진 31장(`docs/reference/sagrada-familia/`)과 공식 완공 설계를 근거로 만든 완공 상태 모델(크레인·비계 없음). 분류·차이·근거 구분은 `docs/reference/sagrada-familia/ANALYSIS.md`. 450 m 이내에서만 고디테일 LOD0(약 169 k 삼각형: 실제로 뚫린 첨탑 루버, 창 트레이서리, 변위 조각면의 탄생 파사드, 조각상, 모자이크 능선, 정점 AO 베이크)을 그리고 그 밖은 LOD1(약 16 k). 근거리에서는 석재 4종(마름돌·조각면·다공질·모자이크)의 색·노멀·AO 텍스처를 월드 좌표 3면 투영으로 입힙니다. 에셋 출처: `docs/ASSETS.md`. 생성: `node tools/map-data/build_basilica.mjs`.
- 나무: 가로수·공원 수목 4종(런던 플라타너스·팽나무(Celtis)·우산소나무·지중해 사이프러스, 사진과 시 가로수 통계 기준). 거리는 플라타너스 72 %·팽나무 28 %, 광장·공원은 소나무 40 %·사이프러스 20 %·플라타너스·팽나무 각 20 %. 줄기·가지 튜브 + 알파 잎 카드(오프라인 절차적 생성, `tools/map-data/build_trees.mjs`, `build_tree_textures.py`). LOD: 근거리(가장 가까운 30그루, 45 m, 그루당 0.6–1.5 k 삼각형) → 중거리(260 m, 1,200그루, 140–210 삼각형) → 원거리 반구 8×8 방향 임포스터(쿼드 1장). 종·레벨별 인스턴싱으로 드로우콜 9개 이하.
- 렌더링: 고정 낮 태양 + RoomEnvironment IBL, 높이 감쇠 대기 원근(시선 적분 안개) + 하늘 돔, 성당 주변 ±320 m만 그림자(정적 캐시: 지오메트리가 바뀔 때만 다시 그림), Neutral 톤매핑, 하프 해상도 블룸.
- 품질 프리셋(`src/map/quality.js`): 저/중/고 = 해상도 배율 0.6–0.85 / 0.7–1.0 / 0.85–1.0, 그림자 없음/1024/2048, 블룸 off/on/on, 타일 80/120/160, 나무 거리 500/800/1300 m. 첫 진입 시 GPU 이름으로 추정(모바일 → 저), 플레이 화면 우상단에서 수동 전환(선택 저장, `자동`으로 복귀), `?q=low|medium|high`로 강제. 해상도 배율은 1초마다 프레임 시간(목표 16.7 ms)에 맞춰 자동 조정.
- 외곽: 하늘 지평선색 = 안개색 = 지평선 아래색이라 지형 끝(32 km)이 하늘로 녹아듭니다. 단색 바닥 없음.
- 낙하: 성당 상공 1,200 m, WASD/방향키 + 드래그, 수평 반경 350 m. **지면·건물·성당에 몸(반지름 0.5 m 구)이 닿는 순간** '낙하 종료'(무엇에 닿았는지·접촉 속도·지면에서의 높이 표시).
- 카메라: 입력이 없으면 화면이 정지 상태를 유지합니다. 물리는 120 Hz 고정 스텝으로 계산하고 화면은 마지막 두 스텝 사이를 보간해 프레임 속도와 무관하게 같은 낙하가 됩니다. 플레이 화면 우상단 '바람 흔들림'(기본 끔)을 켜면 ±0.03°, 0.3–0.6 Hz의 미세한 흔들림만 더해집니다(선택 저장).
- 착지 후 지상 이동: 지면에 닿으면 착지 지점 반경 50 m 안에서 WASD/방향키로 걷고(1.4 m/s, Shift 4 m/s) 드래그로 시점을 돌립니다(위로 85°까지, 첨탑 꼭대기 확인 가능). 눈높이 1.6 m, 반지름 0.35 m 캡슐로 건물·성당에 막히며 벽을 따라 미끄러집니다. 건물 지붕에 착지하면 그 지붕 외곽선 안에서만, 성당 위에 착지하면 둘러보기만 가능합니다. '다시 낙하'는 상단 바에 계속 표시됩니다.
- 충돌(`src/map/play/collision.js`): 지형은 렌더링과 같은 삼각형(L8 4 m 격자)으로 높이 계산, 근거리 건물은 외곽선 기둥(렌더링과 같은 바닥 −2 m … 지붕), 성당은 `colliders.json`의 단순화 형상 396개(박스·박공·원뿔대·회전체·구·첨탑 — 첨탑은 그려진 단면 반지름을 끝 0.25 m까지 그대로 따름). 매 프레임 이동 구간을 0.25 m 간격으로 쓸어 검사하고 첫 접촉을 이분 탐색으로 1 cm 이내까지 좁혀 터미널 속도에서도 관통하지 않습니다. 16 m 격자로 후보만 검사. `npm test`: 첨탑 끝·첨탑 옆 스침·옥상·벽·지면·고속 관통·그려진 성당 표면과의 일치(접촉점 99 %가 0.5 m 이내) 검증.
- 미리보기 = 같은 월드(`src/map/MapStage.jsx`, `MapStageHost.jsx`): 최저 해상도 지형(L0–L1, ≈100 kB)만으로 첫 프레임 → 중거리 건물 → 근거리 건물 → 지형 세분화(최대 L4). 로딩 중엔 같은 시점 캡처(`preview.jpg`). 패널을 닫거나 다른 맵을 고르면 캔버스·GPU 자원·타일 캐시 해제. 입장 시 같은 캔버스·캐시를 그대로 쓰며 낙하 시작점으로 카메라 비행.
- 크레딧: 맵 화면 하단 링크, `public/tiles/ODbL-NOTICE.md`, `public/tiles/<map>/ATTRIBUTION.md`.

### 실기기 성능 확인

1. `npm run build && npm run preview -- --host` 후 휴대폰/PC 브라우저로 접속.
2. 주소에 `?debug`를 붙이면 콘솔에서 `__skydive.drop.state`(낙하 상태), `__skydive.mapCamera`를 볼 수 있습니다.
3. **FPS**: Chrome DevTools → Rendering → *Frame Rendering Stats* 켜기(또는 Performance 패널 녹화). 모바일은 `chrome://inspect` 원격 디버깅으로 같은 방법.
4. **미리보기 로딩 시간**: DevTools → Network에서 *Disable cache* + 실제 회선(또는 *Fast 4G* 스로틀) → 맵 카드 클릭 후 Performance 패널에서 클릭부터 미리보기 캔버스가 나타나는 시점(캡처 이미지 → 3D 전환)까지 측정. 중요 요청은 `manifest.json`, `height|imagery/{0,1}/…`(≈100 kB), `preview.jpg`.
5. 품질 비교: 맵 화면은 `?q=low|medium|high`(인트로 구름은 `?tier=low|high`).
6. **낙하 벤치마크(권장)**: `/maps/sagrada-familia?bench&q=medium` — 손대지 않으면 1,200 m에서 자동으로 천천히 회전하며 수평선 쪽으로 고개를 들고 낙하해 성당 첨탑에 닿습니다(약 25초). 종료 창에 평균 fps, 1% low(99 백분위 프레임 시간), 최저 fps, 30 fps 미만 프레임 비율, 버퍼 해상도, GPU 이름이 표시되고 콘솔에 `[bench] {...}` JSON이 찍힙니다(첫 1초 = 셰이더 컴파일·업로드는 제외하고 최악값만 따로 표시). 해상도 배율을 고정하려면 `&scale=1`(자동 조정 끔).
7. 맵 화면에 `?debug`를 붙이면 우상단에 1초 평균/최악 프레임 시간, 해상도 배율, 드로우콜·삼각형·지오메트리·텍스처 수가 표시됩니다.

## 디버그

`?debug`를 붙여 열면 `window.__skydive`(`gsap`, `cine`, `getActiveTimeline`, `cloudMs` = 구름 갱신 CPU 시간, 맵 화면에선 `drop`·`mapCamera`·`mapScene`, 캡처용 `orbitFrozen`)가 노출됩니다. 예: 콘솔에서 `__skydive.getActiveTimeline().pause().seek(1.5)`로 전환 장면의 특정 시점을 멈춰 볼 수 있습니다.

## 실제 인증 백엔드 연결

1. `npm i @supabase/supabase-js` (또는 `firebase`)
2. `.env.example` → `.env` 복사 후 값 입력, `VITE_AUTH_PROVIDER=supabase`
3. `src/auth/AuthController.jsx`의 `PROVIDERS`에서 해당 줄 주석 해제

UI 코드는 `useAuth()`만 사용하므로 수정할 필요가 없습니다.

## 멀티플레이어 확장 포인트

- `three/WorldProps.jsx`의 `PLAYER_ANCHOR`, `AVATAR_SLOTS` — 원격 플레이어 아바타를 배치할 대형 슬롯
- `Jumper` 컴포넌트를 glTF 아바타로 교체
- HUD의 `FORMATION` 표시가 슬롯 수와 연동
