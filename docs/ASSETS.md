# 3D 에셋 출처와 라이선스

맵 화면에서 쓰는 3D 모델과 텍스처는 **모두 이 저장소의 스크립트로 절차적으로 생성**합니다. 외부 3D 모델, 사진 텍스처, 서드파티 아트는 쓰지 않습니다. 생성 스크립트와 결과물은 저장소 라이선스를 따릅니다.

| 에셋 | 생성 스크립트 | 형식 / 용량 | 출처 |
|---|---|---|---|
| `public/models/sagrada-familia/basilica.glb` (LOD0 약 17만 / LOD1 약 1.6만 삼각형, 정점 AO 베이크) | `tools/map-data/build_basilica.mjs` ← `src/map/world/basilicaGeometry.js` | glb, meshopt, 약 1.47 MB | 자체 제작(절차적) |
| `public/models/sagrada-familia/colliders.json` | 같은 스크립트 | JSON 24 kB | 자체 제작 |
| `public/textures/stone_albedo.ktx2`, `stone_normal.ktx2` (석재 4종 + 모자이크, 색·노멀·AO) | `tools/map-data/build_stone_textures.py` | KTX2 48 kB + 341 kB | 자체 제작(절차적 노이즈) |
| `public/models/trees/trees.glb` (4종 × 2 LOD) | `tools/map-data/build_trees.mjs` ← `src/map/world/treeGeometry.js` | glb, meshopt, 178 kB | 자체 제작 |
| `public/textures/trees.ktx2` (잎 카드 4종 + 수피 4종) | `tools/map-data/build_tree_textures.py` | KTX2 357 kB | 자체 제작(절차적 그림) |
| `public/textures/tree_impostors.ktx2` (반구 8×8 방향 임포스터) | `tools/map-data/build_trees.mjs` (헤드리스 Chromium에서 베이크) | KTX2 519 kB | 자체 제작 |
| `public/textures/buildings.ktx2`, `detail_normal.ktx2` | `tools/map-data/build_textures.py` | KTX2 | 자체 제작 |

## 참고 자료 (에셋에는 포함되지 않음)
- `docs/reference/sagrada-familia/` 사진 31장: 형태·색 대조용입니다. 텍스처나 베이크 원본으로 쓰지 않았습니다. 일부 사진에는 언론사 워터마크(연합뉴스 등)가 있고 저작권 상태가 확인되지 않았으므로, 저장소를 공개 배포할 때는 이 폴더를 빼거나 권리를 확인하세요.
- 완공 설계 근거(웹 보도·재단 자료)는 `docs/reference/sagrada-familia/ANALYSIS.md`에 정리했습니다.
- 수종 근거: 바르셀로나 가로수 중 플라타너스 비율 보도([3Cat](https://www.3cat.cat/3catinfo/barcelona-vol-diversificar-els-arbres-i-reduir-el-platan-al-15-del-total-en-cinc-anys/noticia/3166944/), [VilaWeb](https://www.vilaweb.cat/noticies/barcelona-vol-reduir-quantitat-plataners/)). 사진 속 광장의 우산소나무·사이프러스.
- 공개 3D 모델 검토 결과: CC BY 등 재사용 가능한 glTF 모델은 찾지 못했습니다(유료·에디토리얼 전용이거나 3D 프린트용). Google 3D Tiles는 약관상 추출이 금지되어 쓰지 않았습니다.

## 지도 데이터
타일 데이터 라이선스는 `public/tiles/ODbL-NOTICE.md`, `public/tiles/sagrada-familia/ATTRIBUTION.md`를 보세요(OSM/Overture ODbL, Copernicus, Sentinel-2, ICGC CC BY 4.0).
