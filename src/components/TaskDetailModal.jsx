import { useState } from 'react'
import { Calendar, CalendarPlus, Users, X, Check, ExternalLink, Trash2 } from 'lucide-react'
import Pill from './ui/Pill.jsx'
import EstadoBadge from './ui/EstadoBadge.jsx'
import { estadoVisualProceso } from '../utils/estadoUtils.js'

// Modal de detalle de una tarjeta del Kanban (sección 32) — checklist de
// subtareas (las mismas `tareas` reales del proceso, no una copia), y un
// enlace a la ficha completa (historial, incidencias, correos asociados)
// que ya existe en la vista de Tabla, para no duplicar esa lógica.
export default function TaskDetailModal({proceso:p, onClose, onToggleSub, onMarcarListo, onEliminar, onVerDetalleCompleto, calendarConectado=false, enviandoCalendar=false, onEnviarCalendar}){
  const v = estadoVisualProceso(p)
  const [hora,setHora]=useState('09:00')
  const abierta = !['COMPLETADO','CERRADO','CANCELADO'].includes(p.estado)
  return (
    <div className="modal-card task-modal" onClick={e=>e.stopPropagation()}>
      <div className="modal-head">
        <div>
          <div className="modal-title">{p.titulo}</div>
          <div className="mono" style={{fontSize:11,color:'var(--muted)',marginTop:2}}>{p.id}</div>
        </div>
        <button className="modal-close" onClick={onClose}><X size={16}/></button>
      </div>
      <div style={{display:'flex',gap:8,flexWrap:'wrap',margin:'10px 0'}}>
        <EstadoBadge v={v}/>
        <Pill color={p.prioridad==='CRITICA'?'red':p.prioridad==='ALTA'?'orange':p.prioridad==='MEDIA'?'yellow':'blue'}>{p.prioridad}</Pill>
        <Pill color="gray">{p.area}</Pill>
      </div>
      {p.descripcion && <p style={{fontSize:13,color:'var(--text2)',lineHeight:1.55,background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:8,padding:'10px 12px',marginBottom:12}}>{p.descripcion}</p>}
      <div style={{fontSize:12,color:'var(--muted)',display:'flex',gap:14,flexWrap:'wrap',marginBottom:12}}>
        <span><Calendar size={12}/> Vence {p.fechaLimite}</span>
        <span><Users size={12}/> {p.responsable}</span>
      </div>
      <div className="modal-subtasks">
        <div style={{fontWeight:700,fontSize:12,marginBottom:8}}>Subtareas {p.tareas?.length? `(${p.tareas.filter(t=>t.done).length}/${p.tareas.length})`:''}</div>
        {!p.tareas?.length && <div style={{fontSize:12,color:'var(--muted)'}}>Sin subtareas.</div>}
        {(p.tareas||[]).map(t=>(
          <label key={t.id||t.titulo} className="subtask-row">
            <input type="checkbox" checked={!!t.done} onChange={()=>onToggleSub(t.id)}/>
            <span style={{textDecoration:t.done?'line-through':'none',color:t.done?'var(--muted)':'var(--text)'}}>{t.titulo}</span>
          </label>
        ))}
      </div>
      {calendarConectado && p.fechaLimite && (
        <div className="modal-calendar">
          {p.gcalEventId ? (
            <span style={{display:'flex',alignItems:'center',gap:6}}><CalendarPlus size={13}/> Ya está en tu Google Calendar
              {p.gcalEnlace && <a href={p.gcalEnlace} target="_blank" rel="noopener noreferrer" style={{display:'inline-flex',alignItems:'center',gap:3}}>abrir <ExternalLink size={11}/></a>}
            </span>
          ) : abierta && (
            <>
              <span>Recordatorio el {p.fechaLimite} a las</span>
              <input className="input" type="time" style={{width:100,padding:'4px 8px'}} value={hora} onChange={e=>setHora(e.target.value)}/>
              <button className="btn sm" disabled={enviandoCalendar || !hora} onClick={()=>onEnviarCalendar?.(hora)}><CalendarPlus size={13}/> {enviandoCalendar?'Enviando…':'Agregar a Google Calendar'}</button>
            </>
          )}
        </div>
      )}
      <div className="modal-actions">
        {!['COMPLETADO','CERRADO','CANCELADO'].includes(p.estado) && <button className="btn sm primary" onClick={onMarcarListo}><Check size={13}/> Marcar como completada</button>}
        <button className="btn sm ghost" onClick={onVerDetalleCompleto}><ExternalLink size={13}/> Ver detalle completo</button>
        {onEliminar && <button className="btn sm ghost" style={{color:'var(--red)'}} onClick={onEliminar}><Trash2 size={13}/> Eliminar</button>}
      </div>
    </div>
  )
}
