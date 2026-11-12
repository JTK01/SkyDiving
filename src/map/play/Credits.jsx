import { useState } from 'react'
import { TILES_BASE } from '../env'

/** data credits for the map screen (ODbL attribution + Copernicus) */
export default function Credits({ manifest }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="map-credits__link" onClick={() => setOpen(true)}>
        © OpenStreetMap contributors · Overture Maps · Copernicus — 데이터 출처
      </button>
      {open && (
        <div className="map-credits" role="dialog" aria-label="데이터 출처" onClick={() => setOpen(false)}>
          <div className="map-credits__card" onClick={(e) => e.stopPropagation()}>
            <h2>데이터 출처</h2>
            <ul>
              {manifest.attribution.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
            <p>
              건물·도로·토지이용 데이터는{' '}
              <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
                OpenStreetMap
              </a>{' '}
              데이터로, 가공된 타일은{' '}
              <a href={`${TILES_BASE}/ODbL-NOTICE.md`} target="_blank" rel="noreferrer">
                ODbL 1.0
              </a>{' '}
              으로 제공됩니다 (
              <a href={`${TILES_BASE}/${manifest.map}/ATTRIBUTION.md`} target="_blank" rel="noreferrer">
                상세
              </a>
              ).
            </p>
            <button type="button" className="btn btn--primary" onClick={() => setOpen(false)}>
              닫기
            </button>
          </div>
        </div>
      )}
    </>
  )
}
