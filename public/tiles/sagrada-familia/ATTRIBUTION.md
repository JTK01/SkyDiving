# Data sources — Sagrada Família map

| Layer | Source | Licence | Attribution |
|---|---|---|---|
| Buildings (footprints, heights), roads, land use, water | OpenStreetMap via Overture Maps, release `2026-10-21.0` (themes buildings, transportation, base) | ODbL 1.0 (see `../ODbL-NOTICE.md`) | © OpenStreetMap contributors, Overture Maps Foundation |
| Imagery | Sentinel-2 L2A true colour (TCI) + scene classification (SCL), tiles 31TDF and 31TDG, 2025-08-11, AWS Open Data `sentinel-cogs` | Copernicus Sentinel data licence (free, incl. commercial, attribution) | Contains modified Copernicus Sentinel data 2025 |
| Terrain | Copernicus DEM GLO-30, tiles N41 E001 / N41 E002, AWS Open Data `copernicus-dem-30m` | Copernicus DEM licence (free, incl. commercial, attribution) | © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA |

Processing: reprojected to UTM 31N, local frame centred on the basilica
footprint; imagery colour-graded and cloud/no-data masked with SCL; the
surface model is smoothed into an approximate bare-ground model on the city
plain; buildings within 600 m keep their footprints, 600 m–2.7 km become
oriented boxes. The basilica itself is a procedural model (not from data).
