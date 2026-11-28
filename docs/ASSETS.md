# 3D 에셋 출처와 라이선스

맵 화면에서 쓰는 3D 모델과 텍스처는 대부분 **이 저장소의 스크립트로 절차적으로 생성**합니다. 예외는 착지 후 지면에 쓰는 사진 기반 PBR 텍스처로, 모두 [ambientCG](https://ambientcg.com)의 **CC0 1.0**(퍼블릭 도메인, 출처 표기 의무 없음) 소재입니다(아래 표). 외부 3D 모델과 서드파티 아트는 쓰지 않습니다. 생성 스크립트와 결과물은 저장소 라이선스를 따릅니다.

| 에셋 | 생성 스크립트 | 형식 / 용량 | 출처 |
|---|---|---|---|
| `public/models/sagrada-familia/basilica.glb` (LOD0 약 17만 / LOD1 약 1.6만 삼각형, 정점 AO 베이크) | `tools/map-data/build_basilica.mjs` ← `src/map/world/basilicaGeometry.js` | glb, meshopt, 약 1.47 MB | 자체 제작(절차적) |
| `public/models/sagrada-familia/colliders.json` | 같은 스크립트 | JSON 24 kB | 자체 제작 |
| `public/textures/stone_albedo.ktx2`, `stone_normal.ktx2` (석재 4종 + 모자이크, 색·노멀·AO) | `tools/map-data/build_stone_textures.py` | KTX2 48 kB + 341 kB | 자체 제작(절차적 노이즈) |
| `public/models/trees/trees.glb` (4종 × 2 LOD) | `tools/map-data/build_trees.mjs` ← `src/map/world/treeGeometry.js` | glb, meshopt, 178 kB | 자체 제작 |
| `public/textures/trees.ktx2` (잎 카드 4종 + 수피 4종) | `tools/map-data/build_tree_textures.py` | KTX2 357 kB | 자체 제작(절차적 그림) |
| `public/textures/tree_impostors.ktx2` (반구 8×8 방향 임포스터) | `tools/map-data/build_trees.mjs` (헤드리스 Chromium에서 베이크) | KTX2 519 kB | 자체 제작 |
| `docs/reference/assets/avatar_src/*.fbx` (아바타 원본: 메시 5만 삼각형, 4096² 컬러 + 노멀/거칠기/금속 텍스처, Mixamo 뼈대 41개, 동작 8개) | 사용자 제공(Tripo 생성 + Mixamo 리깅) | FBX 8개, 각 약 16 MB | 사용자 소유. Tripo / Mixamo 이용 약관 적용 |
| `public/models/characters/player.glb` (근거리 20k / 원거리 4.5k 삼각형, 뼈대 41개, 클립 10개) + `player_color.ktx2` (2048², ETC1S) + `player_normal.ktx2` (512², UASTC) | `tools/map-data/build_avatar.mjs` ← 위 FBX | glb 415 kB + KTX2 463 kB + 301 kB | 위와 같음 |
| 낙하산 (324 삼각형 + 줄 40개) | `src/map/characters/player.js` (런타임 생성) | 코드에 포함 | 자체 디자인 |
| `public/models/characters/critters.bin` (의인화 동물 24종 × 2 LOD, 근거리 약 5k / 원거리 약 1.3k 삼각형, meshopt 압축) | `tools/map-data/build_critters.mjs` ← `critterMesh.mjs`, `src/map/characters/critters.js` | 1.4 MB (구역 진입 시 로드) | 자체 디자인(hapjang.com의 동물 표현 방식 — 툰 셰이딩·털결·외곽선·셰이더 얼굴 — 을 분석해 참고, 코드·에셋은 가져오지 않음) |
| `public/textures/buildings.ktx2`, `detail_normal.ktx2` | `tools/map-data/build_textures.py` | KTX2 | 자체 제작 |
| `public/textures/ground_albedo.ktx2` (3072×2048, ETC1S) + `ground_normal.ktx2` (1536×1024, ETC1S) — 착지 후 지면 6종 | `tools/map-data/build_ground_textures.py` (ambientCG 1K-JPG를 받아 셀마다 감싼 여백을 둔 3×2 아틀라스로) | KTX2 928 kB + 314 kB | ambientCG CC0 1.0: [Asphalt031](https://ambientcg.com/view?id=Asphalt031)(차도), [Concrete034](https://ambientcg.com/view?id=Concrete034)(파놋 시멘트 바탕 — 20 cm 네 알 무늬 요철은 셰이더에서 절차적으로), [Grass004](https://ambientcg.com/view?id=Grass004)(잔디), [Ground054](https://ambientcg.com/view?id=Ground054)(사울로 흙길), [Gravel023](https://ambientcg.com/view?id=Gravel023)(가로수 구덩이 자갈), [Concrete046](https://ambientcg.com/view?id=Concrete046)(밝은 석재) |
| `public/tiles/sagrada-familia/streets/mask.png` (0.5 m/px, ±450 m: 차도 경계 거리장·지면 종류·연못 경계·부드러운 경계장) + `streets.bin` (차선·횡단보도 삼각형, 연석·연못 테두리) | `tools/map-data/build_streets.py` ← 타일의 도로 중심선·구역·나무·건물 외곽선 | PNG 647 kB + 290 kB | 지도 데이터에서 파생(Overture/OSM, ODbL) |

## 참고 자료 (에셋에는 포함되지 않음)
- `docs/reference/player_npc/player_npc.png`: hapjang.com 화면 캡처입니다. 비율·체형·색감·스타일을 참고하는 데만 썼고, hapjang의 모델·텍스처·코드는 가져오거나 복제하지 않았습니다. 이 캡처의 권리는 hapjang에 있으므로 저장소를 공개 배포할 때는 빼는 것이 안전합니다.
- `docs/reference/sagrada-familia/` 사진 31장: 형태·색 대조용입니다. 텍스처나 베이크 원본으로 쓰지 않았습니다. 일부 사진에는 언론사 워터마크(연합뉴스 등)가 있고 저작권 상태가 확인되지 않았으므로, 저장소를 공개 배포할 때는 이 폴더를 빼거나 권리를 확인하세요.
- 완공 설계 근거(웹 보도·재단 자료)는 `docs/reference/sagrada-familia/ANALYSIS.md`에 정리했습니다.
- 수종 근거: 바르셀로나 가로수 중 플라타너스 비율 보도([3Cat](https://www.3cat.cat/3catinfo/barcelona-vol-diversificar-els-arbres-i-reduir-el-platan-al-15-del-total-en-cinc-anys/noticia/3166944/), [VilaWeb](https://www.vilaweb.cat/noticies/barcelona-vol-reduir-quantitat-plataners/)). 사진 속 광장의 우산소나무·사이프러스.
- 공개 3D 모델 검토 결과: CC BY 등 재사용 가능한 glTF 모델은 찾지 못했습니다(유료·에디토리얼 전용이거나 3D 프린트용). Google 3D Tiles는 약관상 추출이 금지되어 쓰지 않았습니다.

## 지도 데이터
타일 데이터 라이선스는 `public/tiles/ODbL-NOTICE.md`, `public/tiles/sagrada-familia/ATTRIBUTION.md`를 보세요(OSM/Overture ODbL, Copernicus, Sentinel-2, ICGC CC BY 4.0).
