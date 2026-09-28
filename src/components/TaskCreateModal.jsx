import { useState } from 'react'
import { X, Plus } from 'lucide-react'
import { fechaLocalISO } from '../utils/dateUtils.js'

// Modal "+ Nueva tarea" (sección 32) — crea una tarea manual real (no un
// borrador local): queda guardada igual que cualquier otra en Firestore.
export default function TaskCreateModal({onClose, onCreate}){
  const [titulo,setTitulo]=useState('')
  const [descripcion,setDescripcion]=useState('')
  const [prioridad,setPrioridad]=useState('MEDIA')
  const [area,setArea]=useState('Operaciones')
  const [fechaLimite,setFechaLimite]=useState(()=>fechaLocalISO(new Date(Date.now()+3*86400000)))
  const [subtareas,setSubtareas]=useState([''])
  return (
    <div className="modal-card task-modal" onClick={e=>e.stopPropagation()}>
      <div className="modal-head">
        <div className="modal-title">Nueva tarea</div>
        <button className="modal-close" onClick={onClose}><X size={16}/></button>
      </div>
      <form onSubmit={e=>{ e.preventDefault(); if(!titulo.trim()) return; onCreate({titulo,descripcion,prioridad,area,fechaLimite,subtareas}) }}>
        <label className="form-field"><span>Título</span><input className="input" autoFocus value={titulo} onChange={e=>setTitulo(e.target.value)} placeholder="Ej: Revisar contrato con proveedor" required/></label>
        <label className="form-field"><span>Descripción</span><textarea className="input" rows={3} value={descripcion} onChange={e=>setDescripcion(e.target.value)} placeholder="Detalle opcional…"/></label>
        <div style={{display:'flex',gap:10}}>
          <label className="form-field" style={{flex:1}}><span>Prioridad</span>
            <select className="input" value={prioridad} onChange={e=>setPrioridad(e.target.value)}><option value="CRITICA">Crítica</option><option value="ALTA">Alta</option><option value="MEDIA">Media</option><option value="BAJA">Baja</option></select>
          </label>
          <label className="form-field" style={{flex:1}}><span>Vence</span><input className="input" type="date" value={fechaLimite} onChange={e=>setFechaLimite(e.target.value)}/></label>
        </div>
        <label className="form-field"><span>Área</span>
          <select className="input" value={area} onChange={e=>setArea(e.target.value)}><option>Operaciones</option><option>Compras</option><option>Talento Humano</option><option>TI</option><option>Logística</option><option>Reclutamiento</option><option>Bienestar</option></select>
        </label>
        <div className="form-field"><span>Subtareas</span>
          {subtareas.map((s,i)=>(
            <div key={i} style={{display:'flex',gap:6,marginBottom:6}}>
              <input className="input" value={s} onChange={e=>setSubtareas(arr=>arr.map((x,j)=>j===i?e.target.value:x))} placeholder={`Subtarea ${i+1}`}/>
              {subtareas.length>1 && <button type="button" className="btn sm ghost" onClick={()=>setSubtareas(arr=>arr.filter((_,j)=>j!==i))}><X size={13}/></button>}
            </div>
          ))}
          <button type="button" className="btn sm ghost" onClick={()=>setSubtareas(arr=>[...arr,''])}><Plus size={12}/> Agregar subtarea</button>
        </div>
        <div className="modal-actions">
          <button type="submit" className="btn primary sm" disabled={!titulo.trim()}>Crear tarea</button>
          <button type="button" className="btn sm ghost" onClick={onClose}>Cancelar</button>
        </div>
      </form>
    </div>
  )
}
