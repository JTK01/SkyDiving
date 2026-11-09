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
| `converging` | 화면 가장자리 구름이 곡선 경로로 중앙에 모이며 커지고 짙어짐, 카메라 전진, 하늘 어두워짐 → 2.2~2.8s 구름 내부 | 3.5s |
| `login` | 구름 내부 배경 위에 유리 카드 blur→sharp, 필드 순차 등장 | 1.5s |
| (signup) | 로그인 ⇄ 회원가입 카드 크로스페이드, 배경 유지 | 0.8s |
| `dissipating` | 구름이 중앙부터 찢어지듯 열리고 위·좌우로 흩어짐, God Rays, 카메라 전진 & 틸트, 월드 등장 | 5s |
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
- **전환 구름 = 깊이 3단 구름 개체** — `foreground`(가깝고 큼, 늦게 도착), `midground`(중앙으로 모이는 주요 구름), `background`(멀고 작음, 느리게 이동). 각 개체는 퍼프 여러 개로 된 적운 몸체이고, 이동 중에도 형태를 유지합니다.
  - 휴지(rest, 화면 가장자리) → 수렴(conv) → 흩어짐(disp) 위치를 화면 정규 좌표로 가지며 **곡선 경로(베지어)** 로 이동
  - 개체마다 다른 지연·속도·회전·약간의 크기 변화·난류 흔들림
  - 크기는 휴지 위치 기준 *월드 단위로 고정* → 카메라에 다가오며 원근으로 커짐(스프라이트를 부풀리지 않음 → 하나의 거대한 덩어리가 되지 않음)
  - 흩어질 때는 위·좌우로 이동하며 화면 밖으로 나간 뒤에만 사라짐(갑작스러운 투명화 없음)
- **튜닝** — `src/three/clouds/cloudLayout.js`의 `CLOUD_CONFIG.transition.layers`에서 레이어별 개수, 링(위치), 깊이, 크기, 접근량(`approach`), 수렴 정도(`pull`), 속도/지연, 곡률(`curl`), 회전(`spin`)을 조절합니다. 타이밍은 `src/scenes/CloudTransition.js`.

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

`?debug`를 붙여 열면 `window.__skydive`(`gsap`, `cine`, `getActiveTimeline`)가 노출됩니다. 예: 콘솔에서 `__skydive.getActiveTimeline().pause().seek(1.5)`로 전환 장면의 특정 시점을 멈춰 볼 수 있습니다.

## 실제 인증 백엔드 연결

1. `npm i @supabase/supabase-js` (또는 `firebase`)
2. `.env.example` → `.env` 복사 후 값 입력, `VITE_AUTH_PROVIDER=supabase`
3. `src/auth/AuthController.jsx`의 `PROVIDERS`에서 해당 줄 주석 해제

UI 코드는 `useAuth()`만 사용하므로 수정할 필요가 없습니다.

## 멀티플레이어 확장 포인트

- `three/WorldProps.jsx`의 `PLAYER_ANCHOR`, `AVATAR_SLOTS` — 원격 플레이어 아바타를 배치할 대형 슬롯
- `Jumper` 컴포넌트를 glTF 아바타로 교체
- HUD의 `FORMATION` 표시가 슬롯 수와 연동
