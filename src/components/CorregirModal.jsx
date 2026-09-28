import { useState } from 'react'
import { GraduationCap, X } from 'lucide-react'

const ESTADOS = [
  { k: 'PENDIENTE_MI_RESPUESTA', l: '🟠 Me toca responder / actuar' },
  { k: 'ESPERANDO_OTRO', l: '🔵 Estoy esperando a la otra persona' },
  { k: 'FALTA_INFO', l: '🟡 Falta algo para cerrarlo' },
  { k: 'CERRADO', l: '✅ Ya está cerrado' },
  { k: 'INFORMATIVO', l: '⚪ Solo informativo, no requiere nada' },
]
export const ETIQUETAS_BASE = ['Urgente', 'Requiere respuesta', 'Esperando respuesta', 'Seguimiento', 'Falta información', 'Cerrado', 'Informativo', 'Incidencia', 'Aprobación', 'Documentos']

// "Corregir a la secretaria": la persona dice cómo debió clasificarse un
// correo. Se aplica ya a la tarea y queda como ejemplo para que la IA aprenda.
export default function CorregirModal({ correo, actual, etiquetasPropias = [], onGuardar, onCerrar, onVip }){
  const [estado, setEstado] = useState(actual?.estado || 'PENDIENTE_MI_RESPUESTA')
  const [etiqueta, setEtiqueta] = useState(actual?.etiquetas?.[0] || '')
  const [falta, setFalta] = useState(actual?.falta || '')
  const [nota, setNota] = useState('')
  const [vip, setVip] = useState(false)
  const opciones = [...etiquetasPropias.map(t => t.nombre), ...ETIQUETAS_BASE.filter(x => !etiquetasPropias.some(t => t.nombre === x))]
  return (
    <div className="modal-card task-modal" onClick={e => e.stopPropagation()}>
      <div className="modal-head">
        <div><div className="modal-title"><GraduationCap size={16}/> Corregir a la secretaria</div>
          <div style={{fontSize:12,color:'var(--muted)',marginTop:2}}>{correo.asunto}</div></div>
        <button className="modal-close" onClick={onCerrar}><X size={16}/></button>
      </div>
      {actual && <div className="modal-ia" style={{marginTop:10}}>Ella pensó: <b>{actual.etiquetas?.join(', ') || '—'}</b> · {ESTADOS.find(e => e.k === actual.estado)?.l || actual.estado}</div>}
      <div className="corregir-form">
        <label>¿En qué va esto realmente?
          <select className="input" value={estado} onChange={e => setEstado(e.target.value)}>{ESTADOS.map(e => <option key={e.k} value={e.k}>{e.l}</option>)}</select>
        </label>
        <label>Etiqueta correcta
          <select className="input" value={etiqueta} onChange={e => setEtiqueta(e.target.value)}><option value="">(sin etiqueta)</option>{opciones.map(o => <option key={o}>{o}</option>)}</select>
        </label>
        {estado === 'FALTA_INFO' && <label>¿Qué falta?<input className="input" value={falta} onChange={e => setFalta(e.target.value)} placeholder="Ej: la fecha de ingreso"/></label>}
        <label>¿Por qué? (opcional, le ayuda a aprender)<input className="input" value={nota} onChange={e => setNota(e.target.value)} placeholder="Ej: lo de este cliente siempre es urgente"/></label>
        <label className="corregir-check"><input type="checkbox" checked={vip} onChange={e => setVip(e.target.checked)}/> Este remitente siempre es importante (VIP)</label>
      </div>
      <div className="modal-actions">
        <button className="btn sm primary" onClick={() => { onGuardar({ estado, etiqueta, falta, nota }); if(vip) onVip?.() }}>Guardar y aprender</button>
        <button className="btn sm ghost" onClick={onCerrar}>Cancelar</button>
      </div>
    </div>
  )
}
