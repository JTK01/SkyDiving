# SKY DIVE — Cinematic Web Experience

React + React Three Fiber + custom WebGL shaders + GSAP 로 만든 스카이다이빙 메타버스의 시네마틱 인트로 / 인증 / 메인 월드 프로토타입입니다.

## 실행 방법

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # 프로덕션 빌드 (dist/)
npm run preview    # 빌드 결과 미리보기
```

데모 계정: `demo@skydive.io` / `skydive123` (로그인 카드 하단 링크로 자동 입력). 회원가입한 계정은 브라우저 localStorage에 저장됩니다(개발용).

## 장면 흐름

| Phase | 내용 | 길이 |
|---|---|---|
| `intro` | 하늘 페이드 인 → 0.8s SKY DIVE → 1.8s PRESS TO START, 카메라 미세 호흡 | 대기 |
| `converging` | 카메라가 가속하며 정면의 거대한 적운(hero)으로 날아가 원근으로 화면이 채워지고(fov 55→62), 2.4s 구름 속으로 진입 → 2.5~3.0s 구름 내부 레이어로 전환, 수증기가 계속 스쳐 지나감 | 3.5s |
| `login` | 구름 내부 배경 위에 유리 카드 blur→sharp, 필드 순차 등장 | 1.5s |
| (signup) | 로그인 ⇄ 회원가입 카드 크로스페이드, 배경 유지 | 0.8s |
| `dissipating` | 카메라가 계속 전진, 수증기가 옅어지며 앞쪽부터 열림, 구름 뒤편의 얇은 자락이 화면 밖으로 지나간 뒤 맑은 하늘, God Rays, 틸트, 월드 등장 | 5s |
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
- **전환 구름 = 큰 적운 덩어리** — `foreground`/`midground`/`background` 레이어(각 3/8/6개)의 덩어리마다 퍼프 8~14개가 행 구조(넓고 평평한 바닥 → 위로 갈수록 작은 퍼프)로 촘촘히 겹쳐 하나의 실루엣을 이룸. 퍼프마다 몸체 높이에 따른 조명 기울기(`iSlope`)를 이어 받아 퍼프 경계가 드러나지 않음
- **월드 고정 레이아웃** — 전환 구름은 인트로 카메라 기준 화면 좌표로 배치된 뒤 월드에 고정(`cine.anchorMatrix`) → 카메라가 실제로 날아가며 시차가 생기고 구름을 통과함
- **hero 구름** — 비행 경로 위의 거대한 적운. 경로를 따라 5장의 완전한 구름 면(slice)으로 구성되어, 접근부터 마지막 면을 빠져나갈 때까지 정면이 항상 구름으로 채워짐. 출구 쪽 면은 얇고 반투명한 자락(`sliceAlpha`, `sliceDepth`)
- **구름 속(CloudInterior)** — 수증기 시트가 끝없이 확대되며 바깥으로 흘러가는 fly-through(`cine.push` = 속도)
- **튜닝** — `src/three/clouds/cloudLayout.js`의 `CLOUD_CONFIG.transition`(레이어별 개수·퍼프 수·위치·깊이·크기, `hero`의 거리·크기·slice 구성)과 `sea`(퍼프 수·크기). 비행 타이밍과 카메라 포즈는 `src/scenes/CloudTransition.js`, `src/state/cinematic.js`의 `CAMERA_POSES`.

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

## 디버그

`?debug`를 붙여 열면 `window.__skydive`(`gsap`, `cine`, `getActiveTimeline`, `cloudMs` = 구름 갱신 CPU 시간)가 노출됩니다. 예: 콘솔에서 `__skydive.getActiveTimeline().pause().seek(1.5)`로 전환 장면의 특정 시점을 멈춰 볼 수 있습니다.

## 실제 인증 백엔드 연결

1. `npm i @supabase/supabase-js` (또는 `firebase`)
2. `.env.example` → `.env` 복사 후 값 입력, `VITE_AUTH_PROVIDER=supabase`
3. `src/auth/AuthController.jsx`의 `PROVIDERS`에서 해당 줄 주석 해제

UI 코드는 `useAuth()`만 사용하므로 수정할 필요가 없습니다.

## 멀티플레이어 확장 포인트

- `three/WorldProps.jsx`의 `PLAYER_ANCHOR`, `AVATAR_SLOTS` — 원격 플레이어 아바타를 배치할 대형 슬롯
- `Jumper` 컴포넌트를 glTF 아바타로 교체
- HUD의 `FORMATION` 표시가 슬롯 수와 연동
