// Gráficas pequeñas y sin dependencias — SVG puro, coherentes con la paleta
// que ya usa el resto de la app (mismo azul/verde/rojo/naranja/cian).
// Un solo eje, un solo hue por serie, con etiqueta directa — nada de adornos.

export function Donut({ pct, size = 108, stroke = 12, color = 'var(--accent)', trackColor = 'var(--border)', label, sub }){
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const clamped = Math.max(0, Math.min(100, pct ?? 0))
  const dash = (clamped / 100) * c
  return (
    <div style={{display:'flex',alignItems:'center',gap:16}}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${label || 'Progreso'}: ${clamped}%`}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={trackColor} strokeWidth={stroke} />
        {clamped > 0 && (
          <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke}
            strokeDasharray={`${dash} ${c-dash}`} strokeLinecap="round"
            transform={`rotate(-90 ${size/2} ${size/2})`} />
        )}
        <text x="50%" y="49%" textAnchor="middle" dominantBaseline="middle" fontSize={size*0.22} fontWeight="800" fill="var(--text)">{Math.round(clamped)}%</text>
      </svg>
      {(label || sub) && (
        <div>
          {label && <div style={{fontWeight:700,fontSize:13,color:'var(--text)'}}>{label}</div>}
          {sub && <div style={{fontSize:12,color:'var(--muted)',marginTop:2,lineHeight:1.5}}>{sub}</div>}
        </div>
      )}
    </div>
  )
}

// Barra horizontal por categoría — para "dónde se concentra el trabajo" (área, tipo, etc.)
export function HBarList({ data, colors }){
  const max = Math.max(1, ...data.map(d => d.value))
  return (
    <div style={{display:'flex',flexDirection:'column',gap:10}}>
      {data.map((d,i)=>(
        <div key={d.label} style={{display:'grid',gridTemplateColumns:'110px 1fr 34px',gap:10,alignItems:'center'}}>
          <span style={{fontSize:12,fontWeight:600,color:'var(--text2)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{d.label}</span>
          <div style={{height:8,background:'var(--bg2)',borderRadius:8,overflow:'hidden'}}>
            <div style={{height:'100%',width:`${Math.round(d.value/max*100)}%`,background: (colors && colors[i%colors.length]) || 'var(--accent)',borderRadius:8,transition:'width .4s ease'}} />
          </div>
          <span style={{fontSize:12,fontWeight:700,color:'var(--text)',textAlign:'right'}}>{d.value}</span>
        </div>
      ))}
      {!data.length && <div className="empty-state">Sin datos todavía.</div>}
    </div>
  )
}

// Barras verticales de los últimos N días — actividad reciente (resueltos por día)
export function TrendBars({ data, color = 'var(--accent)' }){
  const max = Math.max(1, ...data.map(d => d.value))
  return (
    <div style={{display:'flex',gap:8,alignItems:'flex-end',height:96,padding:'0 2px'}}>
      {data.map(d=>(
        <div key={d.label} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:6,height:'100%',justifyContent:'flex-end'}} title={`${d.label}: ${d.value}`}>
          <span style={{fontSize:11,fontWeight:700,color: d.value?'var(--text)':'var(--muted2)'}}>{d.value||''}</span>
          <div style={{width:'100%',maxWidth:26,height:`${Math.max(4,Math.round(d.value/max*64))}px`,background: d.value? color : 'var(--border)',borderRadius:4}} />
          <span style={{fontSize:10.5,color:'var(--muted)',fontWeight:600}}>{d.label}</span>
        </div>
      ))}
    </div>
  )
}
