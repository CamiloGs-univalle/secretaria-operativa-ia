import { useState, useEffect, useRef, useMemo } from 'react'
import { getEstadoMascota, generarRecordatorio, interpretarInstruccion } from '../engine/mascotaEngine.js'
import { audit } from '../data/mockFirebase.js'

const FRECUENCIAS = [
  { id:'1h', label:'1h', horas:[8,9,10,11,12,13,14,15,16,17] },
  { id:'3h', label:'3h', horas:[8,11,14,17] },
  { id:'6h', label:'6h', horas:[8,14] },
]

function formatHora(d){ return d.toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit'}) }

export default function Mascota({ procesos=[], analisis=[], sel=null, viewCorreo=null, onAction, showToast }){
  const [frecuencia,setFrecuencia]=useState(()=> localStorage.getItem('soia_mascota_freq')||'3h')
  const [abierto,setAbierto]=useState(()=>{
    const v=localStorage.getItem('soia_mascota_abierto')
    return v===null ? false : v==='1'
  })
  const [mensajes,setMensajes]=useState(()=> {
    try{ return JSON.parse(localStorage.getItem('soia_mascota_log')||'null') || [] }catch{ return [] }
  })
  const [entrada,setEntrada]=useState('')
  const [confirmando,setConfirmando]=useState(null)
  const [hasNew,setHasNew]=useState(false)
  const logRef=useRef(null)
  const estado = getEstadoMascota({ procesos, analisis })
  const freqConf = FRECUENCIAS.find(f=>f.id===frecuencia) || FRECUENCIAS[1]

  // Top 3 conciso — sin duplicar toda la tabla web, solo lo que debe hacer AHORA
  const top3 = useMemo(()=>{
    const order={CRITICA:4,ALTA:3,MEDIA:2,BAJA:1,INFORMATIVA:0}
    return [...procesos].filter(p=>!['CERRADO','COMPLETADO'].includes(p.estado)).sort((a,b)=>{
      if(order[b.prioridad]!==order[a.prioridad]) return order[b.prioridad]-order[a.prioridad]
      return new Date(a.fechaLimite)-new Date(b.fechaLimite)
    }).slice(0,3)
  },[procesos])

  // Persistir
  useEffect(()=>{ try{ localStorage.setItem('soia_mascota_log', JSON.stringify(mensajes.slice(-40)))}catch{} },[mensajes])
  useEffect(()=>{
    localStorage.setItem('soia_mascota_freq', frecuencia)
    try{ window.mascotaAPI?.sendFrecuencia?.(frecuencia) }catch{}
  },[frecuencia])
  useEffect(()=>{ localStorage.setItem('soia_mascota_abierto', abierto?'1':'0') },[abierto])
  useEffect(()=>{ if(logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight },[mensajes, abierto])
  useEffect(()=>{
    try{ window.mascotaAPI?.sendStats?.(estado.stats) }catch{}
  },[estado.stats])

  // Bienvenida solo si vacío — concisa
  useEffect(()=>{
    if(mensajes.length===0){
      const saludo = estado.id==='EMERGENCIA'
        ? `🔴 ¡Señor, ${estado.stats?.venc||0} vencido(s) — empecemos por el primero!`
        : estado.id==='IMPORTANTE'
        ? `🟠 Señor, ${estado.stats?.alta||0} pendiente(s) importante(s).`
        : `🟢 ¡Hola Señor! Todo al día.`
      setMensajes(m=>[...m, { id: Date.now(), de:'mascota', texto: saludo, hora: formatHora(new Date()), estado: estado.id }])
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[])

  // Recordatorio periódico — conciso y ágil, no llena de tablas
  useEffect(()=>{
    const tick = ()=>{
      const now=new Date()
      const h=now.getHours(), min=now.getMinutes()
      if(min!==0) return
      if(!freqConf.horas.includes(h)) return
      const key=`soia_mascota_notif_${now.toISOString().slice(0,10)}_${h}`
      if(localStorage.getItem(key)) return
      localStorage.setItem(key,'1')
      const texto = generarRecordatorio(h, { procesos })
      const notif = { id: Date.now(), de:'mascota', texto, hora: formatHora(now), tipo:'recordatorio', estado: estado.id }
      setMensajes(m=>[...m, notif])
      setHasNew(true)
      try{
        if(window.Notification && Notification.permission==='granted'){
          new Notification('Secretaria IA', { body: texto })
        } else if(window.Notification && Notification.permission!=='denied'){
          Notification.requestPermission()
        }
      }catch{}
    }
    const id=setInterval(tick, 60*1000)
    return ()=> clearInterval(id)
  },[freqConf, procesos, estado.id])

  // Registrar el listener UNA sola vez (deps []). Antes dependía de [procesos]
  // y procesos cambia con frecuencia (cualquier acción sobre un proceso) —
  // cada cambio volvía a registrar un handler nuevo sin quitar el anterior,
  // acumulando listeners (y notificaciones duplicadas) durante la sesión.
  // Usamos un ref para leer los procesos más recientes sin re-suscribirnos.
  const procesosRef = useRef(procesos)
  useEffect(()=>{ procesosRef.current = procesos },[procesos])
  useEffect(()=>{
    const handler = (e,data)=>{
      if(data?.hour) {
        const texto = generarRecordatorio(data.hour, { procesos: procesosRef.current })
        setMensajes(m=>[...m, { id: Date.now(), de:'mascota', texto, hora: formatHora(new Date()), tipo:'recordatorio' }])
        setHasNew(true)
      }
    }
    try{ window.mascotaAPI?.onNotif?.(handler) }catch{}
    return ()=>{ try{ window.mascotaAPI?.offNotif?.(handler) }catch{} }
  },[])

  function pushMensaje(de, texto, extra={}){
    setMensajes(m=>[...m, { id: Date.now()+Math.random(), de, texto, hora: formatHora(new Date()), ...extra }])
    if(de==='mascota' && !abierto) setHasNew(true)
  }

  function handleInstructions(txtOverride){
    const raw = (txtOverride ?? entrada).trim()
    if(!raw) return
    pushMensaje('usuario', raw)
    setEntrada('')
    const contexto = {
      proceso: sel || (viewCorreo?.proc) || null,
      correo: viewCorreo?.correo || null,
    }
    // Si dice "este" y no hay selección, guía concisa en vez de fallback silencioso
    if(/este/i.test(raw) && !contexto.proceso && !contexto.correo){
      const fallback = top3[0] || procesos[0]
      if(fallback){
        contexto.proceso = fallback
        pushMensaje('mascota', `Entendido Señor — tomaré "${fallback.titulo.slice(0,45)}" como referencia.`)
      } else {
        pushMensaje('mascota', `Señor, seleccione un proceso en la web y vuelva a decirme “${raw}”.`)
        return
      }
    } else if(!contexto.proceso && !contexto.correo){
      contexto.proceso = top3[0] || procesos[0] || null
    }
    const interp = interpretarInstruccion(raw, contexto)
    audit('mascota_instruccion', { texto: raw, intent: interp.intent, confianza: interp.confianza, proceso: contexto.proceso?.id, correo: contexto.correo?.id })
    if(interp.intent==='UNKNOWN'){
      pushMensaje('mascota', interp.explicacion)
      return
    }
    if(interp.requiereConfirmacion){
      pushMensaje('mascota', `${interp.explicacion}`, { intent: interp.intent })
      setConfirmando({ interpretacion: interp, contexto })
      return
    }
    ejecutarAccion(interp, contexto)
  }

  function ejecutarAccion(interp, contexto){
    const proc = contexto.proceso
    const correo = contexto.correo
    let msg=''
    try{
      switch(interp.intent){
        case 'COMPLETAR': {
          if(!proc){ msg='Seleccione un proceso Señor.'; break }
          onAction?.({ type:'COMPLETAR', proceso: proc, interpretacion: interp })
          audit('mascota_completar', { proceso: proc.id, accion:'POSIBLE_FINALIZACION' })
          msg = `🟢 Marcado "${proc.titulo.slice(0,40)}" como listo. ¿Lo cierro?`
          setConfirmando({ interpretacion: { ...interp, intent:'CERRAR_CONFIRMADO', descripcion:'Cerrar definitivamente' }, contexto })
          break
        }
        case 'CERRAR_CONFIRMADO': {
          onAction?.({ type:'CERRAR', proceso: proc })
          audit('mascota_cerrar', { proceso: proc.id, accion:'CERRADO' })
          msg = `✅ Cerrado ${proc.id} Señor.`
          break
        }
        case 'REENVIAR': {
          if(!proc && !correo){ msg='Seleccione un correo Señor.'; break }
          onAction?.({ type:'REENVIAR', proceso: proc, correo, destinatario: interp.destinatario, interpretacion: interp })
          audit('mascota_reenvio_preparado', { proceso: proc?.id, correo: correo?.id, destinatario: interp.destinatario })
          msg = `📨 Borrador a ${interp.destinatario} listo — confirme envío.`
          break
        }
        case 'REPROGRAMAR': {
          if(!proc){ msg='Seleccione un proceso Señor.'; break }
          onAction?.({ type:'REPROGRAMAR', proceso: proc, fecha: interp.fecha })
          audit('mascota_reprogramar', { proceso: proc.id, fecha: interp.fecha.iso })
          msg = `📅 ${proc.id} → ${interp.fecha.label} (${interp.fecha.iso})`
          break
        }
        case 'SEGUIMIENTO': {
          if(!proc){ msg='Seleccione un proceso Señor.'; break }
          onAction?.({ type:'SEGUIMIENTO', proceso: proc, fecha: interp.fecha })
          audit('mascota_seguimiento', { proceso: proc.id, fecha: interp.fecha.iso })
          msg = `🔔 Seguimiento ${interp.fecha.label}${interp.fecha.iso?` (${interp.fecha.iso})`:''} agendado.`
          break
        }
        case 'URGENTE': {
          if(!proc){ msg='Seleccione un proceso Señor.'; break }
          onAction?.({ type:'URGENTE', proceso: proc })
          audit('mascota_urgente', { proceso: proc.id })
          msg = `🔴 ${proc.id} ahora es CRÍTICA Señor.`
          break
        }
        default:
          msg = interp.explicacion
      }
    }catch(e){
      msg = `Disculpe Señor: ${e.message}`
    }
    if(msg){ pushMensaje('mascota', msg); showToast?.(msg) }
  }

  const dotColor = estado.id==='EMERGENCIA' ? '#dc2626' : estado.id==='IMPORTANTE' ? '#d97706' : estado.id==='INFO' ? '#eab308' : '#059669'
  const resumenCorto = estado.id==='EMERGENCIA' ? `${estado.stats?.venc||0} vencidas` : estado.id==='IMPORTANTE' ? `${estado.stats?.alta||0} altas` : `al día`
  const showBadge = hasNew && !abierto

  return (
    <>
      {/* FAB flotante — ágil, siempre visible, no ocupa tabla */}
      <button
        onClick={()=>{ setAbierto(v=>!v); if(hasNew) setHasNew(false)}}
        className="mascota-fab"
        aria-label="Abrir mascota secretaria"
        style={{ background: dotColor }}
      >
        <span style={{fontSize:22}}>{estado.emoji}</span>
        <span className="mascota-fab-label">{abierto ? '—' : resumenCorto}</span>
        {showBadge && <span className="mascota-fab-dot" />}
      </button>

      {abierto && (
        <div className="mascota-flotante" role="dialog" aria-label="Mascota Secretaria">
          {/* Header ultra conciso */}
          <div className="mascota-float-head">
            <div style={{display:'flex',gap:8,alignItems:'center'}}>
              <span>{estado.emoji}</span>
              <b style={{fontSize:13}}>Mascota</b>
              <span style={{fontSize:10,background:dotColor,color:'#fff',padding:'2px 6px',borderRadius:999}}>{estado.mensaje.replace('Tienes un proceso vencido.','Vencido').replace('Hay una tarea que deberías revisar.','Importante').replace('Tengo una actualización.','Actualización').replace('Sin problemas.','Al día')}</span>
            </div>
            <div style={{display:'flex',gap:6,alignItems:'center'}}>
              <select value={frecuencia} onChange={e=>setFrecuencia(e.target.value)} className="mascota-freq">
                {FRECUENCIAS.map(f=> <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
              <button className="btn sm ghost" onClick={()=>setAbierto(false)} aria-label="Cerrar">✕</button>
            </div>
          </div>

          {/* Qué debe hacer AHORA — conciso, no tabla completa */}
          <div className="mascota-quick">
            <div style={{fontSize:10,fontWeight:700,letterSpacing:.5,textTransform:'uppercase',color:'var(--muted)',marginBottom:6}}>Haz estas ahora — tu mano derecha</div>
            {top3.length ? top3.map((p,i)=>(
              <button key={p.id} className="mascota-todo" onClick={()=>{ onAction?.({type:'FOCUS', proceso:p}); showToast?.(p.titulo) }}>
                <span className="mascota-todo-rank">{i+1}</span>
                <span style={{flex:1,textAlign:'left',minWidth:0}}>
                  <span style={{fontSize:12,fontWeight:700,display:'block',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{p.titulo.slice(0,46)}</span>
                  <span style={{fontSize:10,color:'var(--muted)'}}>{p.prioridad==='CRITICA'?'🔴':p.prioridad==='ALTA'?'🟠':'🟡'} {p.prioridad} • vence {p.fechaLimite} {p.retraso?`• +${p.retraso}d`:''}</span>
                </span>
              </button>
            )) : <div style={{fontSize:12,color:'var(--muted)'}}>Sin pendientes Señor — ¡al día!</div>}
          </div>

          {/* Log conciso — solo últimos 3 */}
          <div ref={logRef} className="mascota-float-log">
            {mensajes.slice(-3).map(m=>(
              <div key={m.id} className={`mascota-float-msg ${m.de}`}>
                <span style={{fontSize:11}}>{m.de==='mascota'? estado.emoji : '👤'}</span>
                <span style={{fontSize:11,lineHeight:1.4,whiteSpace:'pre-wrap'}}>{m.texto}</span>
              </div>
            ))}
            {mensajes.length===0 && <div style={{fontSize:11,color:'var(--muted)',textAlign:'center'}}>Hola Señor — ¿en qué le ayudo?</div>}
          </div>

          {/* Chips ágiles — 5 en 2 filas compactas */}
          <div className="mascota-float-chips">
            {['Este ya quedó listo','Mándalo a Carlos','Déjalo para mañana','Seguimiento lunes','Es urgente'].map(chip=>(
              <button key={chip} className="mascota-chip" onClick={()=>handleInstructions(chip)}>{chip}</button>
            ))}
          </div>

          {confirmando && (
            <div className="mascota-confirm">
              <div style={{fontSize:11,fontWeight:700}}>⚠️ Confirmar: {confirmando.interpretacion.descripcion} {confirmando.interpretacion.destinatario?`→ ${confirmando.interpretacion.destinatario}`:''}</div>
              <div style={{display:'flex',gap:6,marginTop:6}}>
                <button className="btn primary sm" onClick={()=>{ const c={...confirmando}; setConfirmando(null); ejecutarAccion(c.interpretacion,c.contexto) }}>Confirmar</button>
                <button className="btn sm" onClick={()=>{ pushMensaje('mascota','Cancelado Señor.'); setConfirmando(null)}}>Cancelar</button>
              </div>
            </div>
          )}

          <div className="mascota-float-input">
            <input
              value={entrada}
              onChange={e=>setEntrada(e.target.value)}
              onKeyDown={e=>{ if(e.key==='Enter') handleInstructions() }}
              placeholder="Dígame: ya quedó listo, para mañana..."
              aria-label="Instrucción para mascota"
            />
            <button className="btn primary sm" onClick={()=>handleInstructions()}>↗</button>
          </div>
        </div>
      )}
    </>
  )
}
