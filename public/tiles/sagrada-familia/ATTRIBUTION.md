# Data sources — Sagrada Família map

| Layer | Source | Licence | Attribution |
|---|---|---|---|
| Buildings (footprints, heights), roads, land use, water | OpenStreetMap via Overture Maps, release `2026-10-21.0` (themes buildings, transportation, base) | ODbL 1.0 (see `../ODbL-NOTICE.md`) | © OpenStreetMap contributors, Overture Maps Foundation |
| Imagery, near/mid range (terrain levels L5–L8, ≤ 4 km) | Ortofoto de Catalunya 25 cm, 2025 (`ortofoto_25cm_color_2025`), ICGC WMS `geoserveis.icgc.cat/servei/catalunya/orto-territorial/wms` | CC BY 4.0 — https://creativecommons.org/licenses/by/4.0/ (ICGC terms: https://www.icgc.cat/condicions) | Ortofoto © Institut Cartogràfic i Geològic de Catalunya (ICGC), CC BY 4.0 |
| Imagery, far range (L0–L4) | Sentinel-2 L2A true colour (TCI) + scene classification (SCL), tiles 31TDF and 31TDG, 2025-08-11, AWS Open Data `sentinel-cogs` | Copernicus Sentinel data licence (free, incl. commercial, attribution) | Contains modified Copernicus Sentinel data 2025 |
| Basilica model, building textures | procedural (this repository) | project licence | — |
| Terrain | Copernicus DEM GLO-30, tiles N41 E001 / N41 E002, AWS Open Data `copernicus-dem-30m` | Copernicus DEM licence (free, incl. commercial, attribution) | © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA |

Processing: reprojected to UTM 31N, local frame centred on the basilica
footprint; Sentinel-2 colour-graded and cloud/no-data masked with SCL; ICGC
resampled to 0.5–4 m/px, colour-matched to the Sentinel-2 grade, the basilica
footprint (cranes, scaffolding) painted over as plaza; all imagery encoded as
KTX2 (Basis Universal ETC1S) — these are adapted material under CC BY 4.0; the
surface model is smoothed into an approximate bare-ground model on the city
plain; buildings within 600 m keep their footprints, 600 m–2.7 km become
oriented boxes. The basilica itself is a procedural model (not from data).
