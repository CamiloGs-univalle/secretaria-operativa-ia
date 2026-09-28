import { useState } from 'react'
import { X, Plus, Trash2 } from 'lucide-react'

// Piezas del entrenamiento de la secretaria, usadas por las pestañas de
// Configuración (Conóceme / Prioridades / Memoria).
export const PLANTILLAS = [
  { t: '🧭 Coordinación', cargo: 'Coordinadora de operaciones', importante: 'Solicitudes de clientes, contrataciones, novedades de personal y todo lo que tenga fecha límite. Lo de gerencia siempre primero.' },
  { t: '💻 TI / Soporte', cargo: 'Auxiliar de TI', importante: 'Incidencias que bloquean a alguien, accesos y usuarios, compras de equipos y entregas de actas.' },
  { t: '👥 Talento humano', cargo: 'Analista de talento humano', importante: 'Certificados laborales, ingresos y retiros, nómina, incapacidades y documentos de contratación.' },
]

const setRuta = (actualizar) => (ruta, valor) => actualizar(x => { const n = structuredClone(x); const [a, b] = ruta.split('.'); if(b) n[a][b] = valor; else n[a] = valor; return n })

export function SeccionPerfil({ e, actualizar }){
  const set = setRuta(actualizar)
  return (
    <>
      {!e.perfil.cargo && !e.perfil.importante && (
        <div className="cfg-plantillas">
          <span>¿Te ayudo a empezar? Elige la que más se parezca a ti:</span>
          <div>{PLANTILLAS.map(p => <button key={p.t} className="cfg-plantilla" onClick={() => actualizar(x => ({ ...x, perfil: { ...x.perfil, cargo: p.cargo, importante: p.importante } }))}>{p.t}</button>)}</div>
        </div>
      )}
      <div className="cfg-grid2">
        <label className="cfg-campo"><span>Tu cargo</span><input className="input" value={e.perfil.cargo} onChange={ev => set('perfil.cargo', ev.target.value)} placeholder="Ej: Coordinadora de operaciones"/></label>
        <label className="cfg-campo"><span>Área / equipo</span><input className="input" value={e.perfil.area} onChange={ev => set('perfil.area', ev.target.value)} placeholder="Ej: Operaciones sede Cali"/></label>
      </div>
      <label className="cfg-campo"><span>¿Qué haces en tu día a día?</span><textarea className="input" rows={2} value={e.perfil.responsabilidades} onChange={ev => set('perfil.responsabilidades', ev.target.value)} placeholder="Ej: valido documentación de contratos, respondo a clientes, preparo el informe mensual…"/></label>
      <label className="cfg-campo destacado"><span>⭐ ¿Qué es IMPORTANTE para ti?</span><textarea className="input" rows={3} value={e.perfil.importante} onChange={ev => set('perfil.importante', ev.target.value)} placeholder="Ej: todo lo que venga de gerencia o de clientes activos; lo que vence esta semana; nunca dejar a un colaborador sin respuesta más de 1 día."/><small>Es lo que más usa para decidir qué te muestra primero.</small></label>
    </>
  )
}

export function SeccionEstilo({ e, actualizar }){
  const set = setRuta(actualizar)
  const tonos = [{ k: 'cordial', l: '😊 Cordial' }, { k: 'formal', l: '🎩 Formal' }, { k: 'cercano', l: '🤝 Cercano' }, { k: 'directo y breve', l: '⚡ Directo' }]
  return (
    <>
      <div className="cfg-campo"><span>Tono de tus correos</span>
        <div className="cfg-opciones">{tonos.map(t => <button key={t.k} className={e.estilo.tono === t.k ? 'on' : ''} onClick={() => set('estilo.tono', t.k)}>{t.l}</button>)}</div>
      </div>
      <div className="cfg-campo"><span>Trato</span>
        <div className="cfg-opciones">{[{ k: 'tú', l: 'Tutear (tú)' }, { k: 'usted', l: 'Usted' }].map(t => <button key={t.k} className={e.estilo.idioma === t.k ? 'on' : ''} onClick={() => set('estilo.idioma', t.k)}>{t.l}</button>)}</div>
      </div>
      <div className="cfg-grid2">
        <label className="cfg-campo"><span>Tu firma</span><textarea className="input" rows={4} value={e.estilo.firma} onChange={ev => set('estilo.firma', ev.target.value)} placeholder={'Cordialmente,\nAna Gómez\nCoordinadora de Operaciones — Proservis'}/></label>
        <div className="cfg-campo"><span>Así se verá un borrador</span>
          <div className="cfg-preview-correo">
            <p>{e.estilo.idioma === 'usted' ? 'Buen día, ¿cómo está?' : 'Hola, ¿cómo estás?'}</p>
            <p className="gris">{e.estilo.tono === 'formal' ? 'Por medio del presente le confirmo…' : e.estilo.tono === 'directo y breve' ? 'Confirmado: …' : e.estilo.tono === 'cercano' ? '¡Te cuento que ya quedó listo! …' : 'Te confirmo que …'}</p>
            <pre>{e.estilo.firma || '(tu firma)'}</pre>
          </div>
        </div>
      </div>
    </>
  )
}

export function SeccionInstrucciones({ e, actualizar }){
  const ejemplos = ['Si un proveedor manda una factura, recuérdame revisarla en 2 días.', 'Si alguien no responde en 3 días, propónme un seguimiento.', 'Los viernes dame un resumen de lo que quedó abierto.', 'Nunca archives correos de gerencia.']
  const agregar = t => actualizar(x => ({ ...x, instrucciones: (x.instrucciones ? x.instrucciones.trimEnd() + '\n' : '') + '- ' + t }))
  return (
    <>
      <textarea className="input cfg-instrucciones" rows={5} value={e.instrucciones} onChange={ev => actualizar(x => ({ ...x, instrucciones: ev.target.value }))} placeholder="Escríbele como a una persona…"/>
      <div className="cfg-sugerencias"><span>Ideas (clic para agregar):</span>{ejemplos.filter(t => !e.instrucciones.includes(t)).map(t => <button key={t} onClick={() => agregar(t)}><Plus size={10}/> {t}</button>)}</div>
    </>
  )
}

export function ListaChips({ titulo, ayuda, icono, tipo, valores, onAgregar, onQuitar, ejemplo, color }){
  const [v, setV] = useState('')
  return (
    <div className={`cfg-regla ${color}`}>
      <div className="cfg-regla-head"><span className="cfg-regla-icono">{icono}</span><div><b>{titulo}</b><small>{ayuda}</small></div><span className="cfg-contador">{valores.length}</span></div>
      <div className="cfg-chips">
        {valores.map(x => <span key={x} className="cfg-chip">{x}<button onClick={() => onQuitar(tipo, x)} aria-label="Quitar"><X size={10}/></button></span>)}
        {!valores.length && <span className="cfg-vacio">Nada todavía</span>}
      </div>
      <form onSubmit={ev => { ev.preventDefault(); v.split(',').forEach(p => onAgregar(tipo, p)); setV('') }} className="cfg-chip-form">
        <input className="input" value={v} onChange={ev => setV(ev.target.value)} placeholder={ejemplo}/>
        <button className="btn sm" type="submit" disabled={!v.trim()}><Plus size={12}/></button>
      </form>
    </div>
  )
}

export function SeccionEtiquetas({ e, actualizar }){
  const [n, setN] = useState(''), [d, setD] = useState('')
  const colores = ['#8B5CF6', '#4B7BEC', '#10B981', '#F59E0B', '#EF4444', '#EC4899', '#14B8A6']
  return (
    <>
      <div className="cfg-etiquetas-base"><span>Ya vienen de fábrica:</span>{['Urgente', 'Requiere respuesta', 'Esperando respuesta', 'Falta información', 'Cerrado', 'Informativo'].map(t => <em key={t}>{t}</em>)}</div>
      <div className="cfg-etiquetas">
        {e.etiquetas.map((t, i) => (
          <div key={i} className="cfg-etiqueta" style={{ '--c': colores[i % colores.length] }}>
            <input className="cfg-etiqueta-nombre" value={t.nombre} onChange={ev => actualizar(x => ({ ...x, etiquetas: x.etiquetas.map((y, j) => j === i ? { ...y, nombre: ev.target.value } : y) }))}/>
            <input className="cfg-etiqueta-desc" value={t.descripcion} placeholder="¿Cuándo usarla?" onChange={ev => actualizar(x => ({ ...x, etiquetas: x.etiquetas.map((y, j) => j === i ? { ...y, descripcion: ev.target.value } : y) }))}/>
            <button aria-label="Quitar" onClick={() => actualizar(x => ({ ...x, etiquetas: x.etiquetas.filter((_, j) => j !== i) }))}><Trash2 size={12}/></button>
          </div>
        ))}
      </div>
      <form className="cfg-nueva-etiqueta" onSubmit={ev => { ev.preventDefault(); if(n.trim()){ actualizar(x => ({ ...x, etiquetas: [...x.etiquetas, { nombre: n.trim(), descripcion: d.trim() }] })); setN(''); setD('') } }}>
        <input className="input" style={{maxWidth:170}} value={n} onChange={ev => setN(ev.target.value)} placeholder="Nueva: Nómina"/>
        <input className="input" value={d} onChange={ev => setD(ev.target.value)} placeholder="Cuándo usarla: pagos, desprendibles, novedades…"/>
        <button className="btn sm primary" type="submit" disabled={!n.trim()}><Plus size={12}/> Crear</button>
      </form>
    </>
  )
}
