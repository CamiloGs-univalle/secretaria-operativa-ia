import { useState, useEffect, useMemo } from 'react'
import { getProcesos, updateProceso, audit } from './data/mockFirebase.js'
import { analizarCorreoCompleto, sugerirRespuesta } from './engine/emailEngine.js'
import { fetchRealGmail, GMAIL_META } from './services/gmailService.js'
import { generarProcesosDesdeCorreos } from './services/processGenerator.js'
import { responderHilo } from './services/gmailSendService.js'
import './App.css'

function Pill({children, color}){ return <span className={`pill pill-${color}`}>{children}</span> }
function PrioridadDot({n}){ const m={CRITICA:'crit',ALTA:'alta',MEDIA:'media',BAJA:'baja',INFORMATIVA:'info'}; return <span className={`dot dot-${m[n]||'baja'}`} /> }
function Toast({msg,onClose}){ if(!msg) return null; return <div className="toast"><span>{msg}</span><button onClick={onClose}>✕</button></div> }

export default function App(){
  const [theme,setTheme]=useState(()=> localStorage.getItem('soia_theme')||'light')
  useEffect(()=>{ document.documentElement.setAttribute('data-theme',theme); localStorage.setItem('soia_theme',theme)},[theme])
  const [procesos,setProcesos]=useState(()=>getProcesos())
  const [correos,setCorreos]=useState([])
  const [loading,setLoading]=useState(true)
  const [filtro,setFiltro]=useState({q:'', prior:'TODAS', estado:'TODOS', area:'TODAS'})
  const [inboxFiltro,setInboxFiltro]=useState({q:'', tab:'TODOS'}) // TODOS, ACCION, URGENTES, INCIDENCIAS, NO_RELEVANTE
  const [sel,setSel]=useState(null)
  const [tab,setTab]=useState('dashboard')
  const [analisis,setAnalisis]=useState([])
  const [mascotaInput,setMascotaInput]=useState('')
  const [mascotaLog,setMascotaLog]=useState([{t:'08:00',m:'¡Buenos días Señora Coordinadora! Cargando Gmail real de '+GMAIL_META.account+'…'}])
  const [showNotif,setShowNotif]=useState(true)
  const [syncing,setSyncing]=useState(false)
  const [toast,setToast]=useState('')
  const showToast=(m)=>{ setToast(m); setTimeout(()=>setToast(''),3500)}
  const [reply,setReply]=useState(null) // {correo, analisis, proceso, sugerencia, asunto, cuerpo}
  const [sending,setSending]=useState(false)

  useEffect(()=>{
    (async()=>{
      setLoading(true)
      const real=await fetchRealGmail({maxResults:30})
      setCorreos(real)
      const {procesos:gen}=generarProcesosDesdeCorreos(real,getProcesos())
      setProcesos(gen)
      setLoading(false)
      setMascotaLog(l=>[...l,{t:new Date().toLocaleTimeString().slice(0,5),m:`Hecho Señor — ${real.length} correos REALES de ${GMAIL_META.account} cargados. ${gen.length} procesos. Inbox ya ordenado.`}])
    })()
  },[])
  useEffect(()=>{
    if(!correos.length) return
    setAnalisis(correos.map(c=>({correo:c, a:analizarCorreoCompleto(c, procesos.find(p=>p.correos?.includes(c.id))||null)})))
  },[correos,procesos])

  const refresh=()=>setProcesos(getProcesos())
  const stats=useMemo(()=>{
    const crit=procesos.filter(p=>p.prioridad==='CRITICA').length
    const alta=procesos.filter(p=>p.prioridad==='ALTA').length
    const enProc=procesos.filter(p=>['EN_PROCESO','PENDIENTE','SEGUIMIENTO'].includes(p.estado)).length
    const esperando=procesos.filter(p=>p.estado==='ESPERANDO').length
    const venc=procesos.filter(p=>p.estado==='VENCIDO'||p.retraso>0).length
    const total=procesos.length
    const hoy=procesos.filter(p=>p.fechaLimite===new Date().toISOString().slice(0,10)).length
    return {crit,alta,enProc,esperando,venc,total,hoy}
  },[procesos])

  const recomendaciones=useMemo(()=>{
    const order={CRITICA:4,ALTA:3,MEDIA:2,BAJA:1,INFORMATIVA:0}
    return [...procesos].filter(p=>!['CERRADO','COMPLETADO'].includes(p.estado)).sort((a,b)=>{
      if(order[b.prioridad]!==order[a.prioridad]) return order[b.prioridad]-order[a.prioridad]
      return new Date(a.fechaLimite)-new Date(b.fechaLimite)
    }).slice(0,3).map((p,i)=>({rank:i+1,p,motivo:p.prioridad==='CRITICA'&&p.retraso>0?`Vencido +${p.retraso}d • bloquea ${p.area}`:p.prioridad==='CRITICA'?`Vence ${p.fechaLimite} • bloquea siguiente paso`:p.tiempoTranscurrido/p.tiempoObjetivo>=0.8?`${Math.round(p.tiempoTranscurrido/p.tiempoObjetivo*100)}% SLA consumido`:`Esperando ${p.tiempoTranscurrido}d • turno ${p.turnoActual}`}))
  },[procesos])

  const filtrados=useMemo(()=>procesos.filter(p=>{
    if(filtro.prior!=='TODAS'&&p.prioridad!==filtro.prior) return false
    if(filtro.estado!=='TODOS'&&p.estado!==filtro.estado) return false
    if(filtro.area!=='TODAS'&&p.area!==filtro.area) return false
    if(filtro.q && !(p.titulo+p.id+p.area).toLowerCase().includes(filtro.q.toLowerCase())) return false
    return true
  }),[procesos,filtro])

  const inboxFiltrado=useMemo(()=>{
    let list=[...analisis]
    if(inboxFiltro.q) list=list.filter(({correo})=> (correo.asunto+correo.cuerpo+correo.remitente).toLowerCase().includes(inboxFiltro.q.toLowerCase()))
    if(inboxFiltro.tab==='ACCION') list=list.filter(x=>x.a.accion.requiereAccion)
    if(inboxFiltro.tab==='URGENTES') list=list.filter(x=>x.a.prioridad.nivel==='CRITICA'||x.a.clasificacion.tipo==='URGENTE')
    if(inboxFiltro.tab==='INCIDENCIAS') list=list.filter(x=>x.a.incidencia.existe)
    if(inboxFiltro.tab==='NO_RELEVANTE') list=list.filter(x=>!x.a.relevancia.esRelevante)
    // ordenar: críticas primero, luego por fecha desc
    return list.sort((a,b)=> (b.a.prioridad.score - a.a.prioridad.score) || (new Date(b.correo.fecha)-new Date(a.correo.fecha)))
  },[analisis,inboxFiltro])

  const plan=[{h:'08:00',t:'Informe operativo — Cali',d:'Corregir Juan Pérez (vence hoy)',pri:'CRITICA'},{h:'09:00',t:'Aprobación María López',d:'Validar y aprobar contratación',pri:'CRITICA'},{h:'09:30',t:'Seguimientos',d:'Proveedor X + Usuarios Epsilon',pri:'ALTA'},{h:'10:00',t:'Certificación Carlos Ruiz',d:'Entregar antes 14:00',pri:'CRITICA'},{h:'11:00',t:'Bloque libre',d:'Colchón para imprevistos',pri:'BAJA'},{h:'14:00',t:'Reprogramación logística',d:'Confirmar lunes con operación',pri:'MEDIA'}]

  async function handleSync(){
    setSyncing(true); audit('sync_gmail',{account:GMAIL_META.account}); const fresh=await fetchRealGmail({maxResults:30}); setCorreos(fresh); const {procesos:gen}=generarProcesosDesdeCorreos(fresh,procesos); setProcesos(gen); setSyncing(false); showToast(`Sincronizado: ${fresh.length} correos reales`); setMascotaLog(l=>[...l,{t:new Date().toLocaleTimeString().slice(0,5),m:`Sincronizado Señor — ${fresh.length} correos, inbox reordenado.`}])
  }
  function handleInstruccion(txt){
    const low=txt.toLowerCase()
    if(!sel){ setMascotaLog(l=>[...l,{t:'ahora',m:'Seleccione un proceso Señor.'}]); return }
    if(/ya qued[oó] listo|completado|cerrar/.test(low)){ updateProceso(sel.id,{estado:'COMPLETADO',etapa:'Por cerrar'}); refresh(); showToast(`${sel.id} marcado completado`); setMascotaLog(l=>[...l,{t:'ahora',m:`Listo Señor — ${sel.id} posible cierre. ¿Cerrar?`}])}
    else if(/reenviar|mandar a carlos/.test(low)){ audit('reenvio',{id:sel.id}); showToast(`Reenvío preparado a Carlos — requiere confirmación`); setMascotaLog(l=>[...l,{t:'ahora',m:`Reenvío de ${sel.id} a Carlos listo Señor. ¿Confirmo envío?`}])}
    else if(/mañana/.test(low)){ const d=new Date(); d.setDate(d.getDate()+1); updateProceso(sel.id,{fechaLimite:d.toISOString().slice(0,10),proximaAccion:'Reprogramado mañana'}); refresh(); showToast('Reprogramado para mañana')}
    else if(/seguimiento.*lunes|hazle seguimiento/.test(low)){ updateProceso(sel.id,{seguimientos:[...(sel.seguimientos||[]),{fecha:'2026-09-15',nota:'Seguimiento lunes voz'}]}); refresh(); showToast('Seguimiento lunes agendado')}
    else if(/urgente/.test(low)){ updateProceso(sel.id,{prioridad:'CRITICA'}); refresh(); showToast('Prioridad → CRÍTICA')}
    else { showToast(`Instrucción registrada: ${txt.slice(0,30)}`)}
    setMascotaInput('')
  }
  function marcarCerrado(id){ updateProceso(id,{estado:'CERRADO',fechaCierre:new Date().toISOString()}); refresh(); showToast(`${id} cerrado`); setMascotaLog(l=>[...l,{t:'ahora',m:`${id} cerrado Señor. ¡Excelente!`}])}
  function marcarLeido(id){ setCorreos(c=>c.map(x=> x.id===id? {...x, etiquetas: x.etiquetas.filter(l=>l!=='UNREAD')}:x)); showToast('Marcado leído')}
  function archivarCorreo(id){ setCorreos(c=>c.filter(x=>x.id!==id)); showToast('Archivado — inbox más limpio')}
  function abrirResponder(correo){
    const a = analisis.find(x=> x.correo.id===correo.id)?.a || analizarCorreoCompleto(correo, null)
    const proc = procesos.find(p=> p.correos?.includes(correo.id) || p.hiloId===correo.hiloId) || null
    const hilo = correos.filter(c=> c.hiloId===correo.hiloId).sort((x,y)=> new Date(x.fecha)-new Date(y.fecha))
    const sug = sugerirRespuesta(correo, a, proc, hilo)
    setReply({ correo, analisis:a, proceso:proc, sugerencia:sug, asunto: sug.asunto, cuerpo: sug.cuerpo })
  }
  async function enviarRespuesta(){
    if(!reply) return
    if(!confirm(`¿Enviar respuesta a ${reply.correo.remitente.split('<')[0].trim()}?\n\nAsunto: ${reply.asunto}\n\nAction Guard: se registrará en auditoría.`)) return
    setSending(true)
    const res = await responderHilo({ correoOriginal: reply.correo, subject: reply.asunto, body: reply.cuerpo })
    audit('enviar_respuesta', { to: reply.correo.remitente, subject: reply.asunto, threadId: reply.correo.hiloId, via: res.via, id: res.id })
    setSending(false); setReply(null); showToast(res.via==='gmail-api' ? '✉️ Respuesta enviada por Gmail REAL' : '✉️ Respuesta registrada (simulado — configure OAuth para envío real)')
    setMascotaLog(l=>[...l,{t:new Date().toLocaleTimeString().slice(0,5), m:`Respuesta enviada a ${reply.correo.remitente.split('<')[0].trim()} — hilo ${reply.correo.hiloId.slice(0,8)}`}])
    // marcar como respondido: actualizar proceso
    if(reply.proceso) { updateProceso(reply.proceso.id,{ estado:'ESPERANDO', etapa:'Esperando respuesta externa', ultimaActividad: new Date().toISOString() }); setProcesos(getProcesos()) }
  }

  return (
    <div className="app">
      <Toast msg={toast} onClose={()=>setToast('')} />
      <header className="topbar">
        <div className="brand">
          <div className="logo">SO</div>
          <div><div className="brand-title">Secretaria Operativa IA</div><div className="brand-sub">Centro de Control • Gmail → IA → Firebase → Web • Inbox ordenado</div></div>
        </div>
        <div className="top-actions">
          <div className="sync">
            <span className="mono" style={{fontSize:11,background:'var(--bg2)',border:'1px solid var(--border)',padding:'5px 10px',borderRadius:999,color:'var(--muted)'}}><span style={{width:7,height:7,background:loading?'#f59e0b':'#059669',borderRadius:'50%',display:'inline-block',marginRight:7}}/>GMAIL REAL • {GMAIL_META.account} • {loading? 'cargando…':`${correos.length} correos`}</span>
            <button className="btn primary" onClick={handleSync}>{syncing?'Sincronizando…':'Sincronizar Gmail'}</button>
          </div>
          <button className="theme-toggle" onClick={()=>setTheme(theme==='light'?'dark':'light')} title="Tema">{theme==='light'?'🌙':'☀️'}</button>
          <div className="avatar">CG</div>
        </div>
      </header>

      <div className="layout">
        <nav className="sidebar">
          {[
            {k:'dashboard',label:'Dashboard',icon:'◧',desc:'Resumen ejecutivo'},
            {k:'inbox',label:'Inbox Ordenado',icon:'✉',desc:`${correos.length} • ${analisis.filter(a=>a.a.accion.requiereAccion).length} requieren acción`},
            {k:'procesos',label:'Procesos',icon:'▦',desc:`${stats.total} procesos • ${stats.crit} críticos`},
            {k:'correos',label:'Análisis IA',icon:'🧠',desc:`${analisis.filter(a=>a.a.relevancia.esRelevante).length} relevantes`},
            {k:'sheets',label:'Sheets',icon:'▭',desc:'Vista operativa'},
            {k:'auditoria',label:'Auditoría',icon:'≡',desc:'Action Guard'},
          ].map(it=>(
            <button key={it.k} className={`nav-item ${tab===it.k?'active':''}`} onClick={()=>setTab(it.k)}>
              <span className="nav-icon">{it.icon}</span><span><b>{it.label}</b><small>{it.desc}</small></span>
            </button>
          ))}
          <div className="sidebar-card">
            <div style={{fontWeight:800,fontSize:12,marginBottom:6}}>Inbox ordenado</div>
            <div className="mono" style={{fontSize:11,lineHeight:1.6,color:'var(--muted)'}}>Gmail desordenado → IA clasifica → Inbox con: Requieren acción, Urgentes, Hoy, Esta semana.<br/>Todo filtrable y archivable.</div>
            <div style={{marginTop:10,display:'flex',gap:6,flexWrap:'wrap'}}><Pill color="blue">Tiempo real</Pill><Pill color="green">Ordenado</Pill></div>
          </div>
          <div className="confianza-card"><div style={{fontSize:12,fontWeight:800}}>Confianza IA 94%</div><div style={{fontSize:11,color:'var(--muted)',margin:'4px 0 8px'}}>95-100 auto • 80-94 revisión • &lt;60 no actuar</div><div className="bar"><div style={{width:'94%'}}/></div></div>
        </nav>

        <main className="main">
          {tab==='dashboard' && (
            <>
              <div style={{background:'linear-gradient(135deg,#eff6ff,#f8fafc)',border:'1px solid #bfdbfe',borderRadius:12,padding:'12px 16px',display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:8}}>
                <span className="mono" style={{fontSize:11,color:'#1e40af',fontWeight:700}}>🔴 DATOS REALES — {GMAIL_META.account} • {correos.length} correos analizados • Inbox ordenado por prioridad • Snapshot {GMAIL_META.snapshot.slice(0,10)}</span>
                <span style={{fontSize:11,color:'var(--muted)'}}>Live <b>/api/gmail/live</b> en producción</span>
              </div>

              <div className="section-label">Resumen ejecutivo</div>
              <div className="kpis">
                {[
                  {label:'Críticas',value:stats.crit,color:'#dc2626',sub:'Atender ahora • hoy',trend:'↑'},
                  {label:'Altas',value:stats.alta,color:'#d97706',sub:'Durante el día',trend:'→'},
                  {label:'En proceso',value:stats.enProc,color:'#1e40af',sub:'Activos',trend:''},
                  {label:'Esperando',value:stats.esperando,color:'#0891b2',sub:'Respuesta externa',trend:''},
                  {label:'Vencidas',value:stats.venc,color:'#991b1b',sub:'Requieren corrección',trend: stats.venc>0?'!':''},
                  {label:'Hoy vencen',value:stats.hoy,color:'#059669',sub:'Fecha límite hoy',trend:''},
                ].map(k=>(
                  <div key={k.label} className="kpi" onClick={()=>{setTab('procesos'); setFiltro(f=>({...f, prior: k.label==='Críticas'?'CRITICA':k.label==='Altas'?'ALTA':'TODAS'}))}} style={{cursor:'pointer'}}>
                    <div className="kpi-head"><span style={{background:k.color}} className="kdot"/>{k.label} <span style={{marginLeft:'auto',fontSize:11}}>{k.trend}</span></div>
                    <div className="kpi-val">{loading?'—':k.value}</div><div className="kpi-sub">{k.sub}</div>
                  </div>
                ))}
              </div>

              <div className="grid2">
                <div className="card">
                  <div className="card-head"><h3>🧠 Haz estas 3 primero — IA prioriza</h3><span className="mono" style={{fontSize:11,color:'var(--muted)'}}>Explicable • clic para ir</span></div>
                  <div className="reco-list">
                    {recomendaciones.map(r=>(
                      <div key={r.p.id} className="reco" onClick={()=>{setSel(r.p); setTab('procesos')}}>
                        <div className="reco-rank">{r.rank}</div>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontWeight:700,fontSize:13,display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}><PrioridadDot n={r.p.prioridad}/><span style={{whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{r.p.titulo}</span><Pill color={r.p.prioridad==='CRITICA'?'red':'orange'}>{r.p.prioridad}</Pill></div>
                          <div style={{fontSize:12,color:'var(--muted)',marginTop:4,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{r.motivo} • vence {r.p.fechaLimite} • {r.p.estado}</div>
                          <div style={{fontSize:11,color:'var(--muted)',marginTop:2}}>Turno: <b style={{color: r.p.turnoActual==='COORDINADORA'?'#dc2626':'#0891b2'}}>{r.p.turnoActual}</b> • {r.p.proximaAccion.slice(0,50)}</div>
                        </div>
                        <button className="btn sm" onClick={(e)=>{e.stopPropagation(); setSel(r.p); setTab('procesos')}}>Ver →</button>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="card">
                  <div className="card-head"><h3>📅 Plan del día — automático</h3><small style={{color:'var(--muted)'}}>Deja 30% libre para imprevistos</small></div>
                  <div className="timeline-plan">
                    {plan.map(p=>(
                      <div key={p.h} className="plan-row">
                        <div className="plan-h">{p.h}</div><div className={`plan-dot ${p.pri==='CRITICA'?'crit':p.pri==='ALTA'?'alta':'mid'}`} />
                        <div style={{flex:1}}><div style={{fontWeight:600,fontSize:13}}>{p.t}</div><div style={{fontSize:12,color:'var(--muted)'}}>{p.d}</div></div>
                        <Pill color={p.pri==='CRITICA'?'red':p.pri==='ALTA'?'orange':'gray'}>{p.pri}</Pill>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="card">
                <div className="card-head"><h3>✉️ Inbox ordenado — vista previa</h3><div style={{display:'flex',gap:8}}><button className="btn sm" onClick={()=>setTab('inbox')}>Abrir inbox completo →</button><button className="btn sm ghost" onClick={handleSync}>Actualizar</button></div></div>
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th style={{width:36}}></th><th>Correo (ordenado por prioridad)</th><th>Clasificación</th><th>Turno</th><th>Prioridad</th><th></th></tr></thead>
                    <tbody>
                      {inboxFiltrado.slice(0,6).map(({correo,a})=>(
                        <tr key={correo.id} style={{opacity: !a.relevancia.esRelevante?0.55:1}}>
                          <td><input type="checkbox" /></td>
                          <td><div style={{fontWeight:700,fontSize:13,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:340}}>{correo.asunto}</div><div style={{fontSize:11,color:'var(--muted)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:340}}>{correo.remitente.split('<')[0].trim()} • {correo.fecha.slice(0,10)} {correo.etiquetas.includes('UNREAD')&&'• ● no leído'}</div><div style={{fontSize:12,color:'var(--text2)',marginTop:2,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:340}}>{correo.cuerpo.slice(0,80)}…</div></td>
                          <td><Pill color={a.clasificacion.tipo==='SOLICITUD'?'blue':a.clasificacion.tipo==='INCIDENCIA'?'red':a.clasificacion.tipo==='URGENTE'?'red':'gray'}>{a.clasificacion.tipo}</Pill><div style={{fontSize:11,color:'var(--muted)',marginTop:2}}>{a.relevancia.score}% relev.</div></td>
                          <td style={{fontSize:12}}>{a.turno.accionEsperadaDe==='COORDINADORA'?<b style={{color:'#dc2626'}}>TÚ</b>:<span style={{color:'#0891b2'}}>Externo</span>}<div style={{fontSize:11,color:'var(--muted)'}}>{a.turno.tipoRespuesta}</div></td>
                          <td><PrioridadDot n={a.prioridad.nivel}/><small style={{marginLeft:6,fontWeight:700}}>{a.prioridad.nivel}</small><div style={{fontSize:11,color:'var(--muted)'}}>{a.prioridad.score}/100</div></td>
                          <td><div style={{display:'flex',gap:6,flexWrap:'wrap'}}><button className="btn sm primary" onClick={()=>abrirResponder(correo)}>Responder IA</button><button className="btn sm" onClick={()=>{ const p=procesos.find(x=>x.correos?.includes(correo.id)); if(p){ setSel(p); setTab('procesos')} else showToast('Sin proceso — correo informativo')}}>Ver</button><button className="btn sm ghost" onClick={()=>archivarCorreo(correo.id)}>Archivar</button></div></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{marginTop:10,fontSize:11,color:'var(--muted)'}}>Inbox ordenado: críticas arriba, informativos abajo, auto-archivados grises. Todo filtrable en pestaña Inbox.</div>
              </div>

              <div className="card">
                <div className="card-head"><h3>📊 Indicadores ejecutivos</h3><span className="mono" style={{fontSize:11,color:'var(--muted)'}}>Volumen • Productividad • Cumplimiento</span></div>
                <div className="indicators">
                  <div><b>Volumen</b><div className="mono">recibidos 47 • procesados {correos.length} • procesos {stats.total} • cerrados {procesos.filter(p=>p.estado==='CERRADO').length}</div><div className="bar" style={{height:4}}><div style={{width:'76%'}}/></div></div>
                  <div><b>Productividad</b><div className="mono">2.1 días prom • 3.2/día • 8 tareas hechas</div><div className="bar" style={{height:4}}><div style={{width:'68%'}}/></div></div>
                  <div><b>Cumplimiento</b><div className="mono">72% a tiempo • 28% fuera • retraso 1.4d</div><div className="bar" style={{height:4,background:'#fef2f2'}}><div style={{width:'72%',background:'#059669'}}/></div></div>
                  <div><b>Incidencias</b><div className="mono">2 activas • 12% tasa • causas: info, reprog</div><div className="bar" style={{height:4}}><div style={{width:'12%',background:'#dc2626'}}/></div></div>
                </div>
              </div>
            </>
          )}

          {tab==='inbox' && (
            <>
              <div className="card">
                <div className="card-head"><h3>✉️ Inbox Ordenado — tu bandeja, pero profesional</h3><span className="mono" style={{fontSize:11,color:'var(--muted)'}}>{correos.length} correos reales • ordenados por prioridad, no por llegada</span></div>
                <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:12}}>
                  {[
                    {k:'TODOS',l:`Todos (${analisis.length})`},{k:'ACCION',l:`Requieren acción (${analisis.filter(a=>a.a.accion.requiereAccion).length})`},{k:'URGENTES',l:`Urgentes (${analisis.filter(a=>a.a.prioridad.nivel==='CRITICA').length})`},{k:'INCIDENCIAS',l:`Incidencias (${analisis.filter(a=>a.a.incidencia.existe).length})`},{k:'NO_RELEVANTE',l:'Archivados auto'},
                  ].map(t=>(
                    <button key={t.k} className={`btn sm ${inboxFiltro.tab===t.k?'primary':''}`} onClick={()=>setInboxFiltro(f=>({...f,tab:t.k}))}>{t.l}</button>
                  ))}
                  <input placeholder="Buscar asunto, remitente, cuerpo…" value={inboxFiltro.q} onChange={e=>setInboxFiltro(f=>({...f,q:e.target.value}))} style={{flex:1,minWidth:200,background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:8,padding:'8px 12px',fontSize:13}}/>
                  <button className="btn sm ghost" onClick={()=>setInboxFiltro({q:'',tab:'TODOS'})}>Limpiar</button>
                </div>
                <div style={{display:'flex',gap:8,marginBottom:12,flexWrap:'wrap'}}>
                  <button className="btn sm" onClick={()=>showToast('Todos marcados leídos')}>Marcar leídos</button>
                  <button className="btn sm" onClick={()=>showToast('Archivados seleccionados')}>Archivar selección</button>
                  <span className="mono" style={{fontSize:11,color:'var(--muted)',alignSelf:'center',marginLeft:8}}>Tip: críticas rojas arriba, informativos grises abajo — así ves primero lo que importa</span>
                </div>
                <div style={{display:'flex',flexDirection:'column',gap:8}}>
                  {inboxFiltrado.map(({correo,a})=>(
                    <div key={correo.id} className="mail-card" style={{display:'flex',gap:14,alignItems:'flex-start', opacity: !a.relevancia.esRelevante?0.6:1, borderLeft: a.prioridad.nivel==='CRITICA'?'3px solid #dc2626': a.prioridad.nivel==='ALTA'?'3px solid #d97706':'1px solid var(--border)'}}>
                      <input type="checkbox" style={{marginTop:6}}/>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
                          <span style={{fontWeight:800,fontSize:13,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{correo.asunto}</span>
                          {correo.etiquetas.includes('UNREAD')&&<span style={{width:8,height:8,background:'#1e40af',borderRadius:'50%'}}/>}
                          <Pill color={a.clasificacion.tipo==='URGENTE'?'red':a.clasificacion.tipo==='INCIDENCIA'?'red':a.clasificacion.tipo==='SOLICITUD'?'blue':'gray'}>{a.clasificacion.tipo}</Pill>
                          <PrioridadDot n={a.prioridad.nivel}/><small style={{fontWeight:700}}>{a.prioridad.nivel}</small>
                          <span className="mono" style={{fontSize:11,color:'var(--muted)',marginLeft:'auto'}}>{correo.fecha.slice(0,16).replace('T',' ')} • {Math.round(a.confianza*100)}%</span>
                        </div>
                        <div style={{fontSize:12,color:'var(--text2)',marginTop:4,lineHeight:1.5,display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical',overflow:'hidden'}}>{correo.cuerpo.slice(0,180)}…</div>
                        <div style={{fontSize:11,color:'var(--muted)',marginTop:6,display:'flex',gap:8,flexWrap:'wrap'}}>
                          <span>De: {correo.remitente.split('<')[0].trim()}</span>•<span>Turno: <b style={{color: a.turno.accionEsperadaDe==='COORDINADORA'?'#dc2626':'#0891b2'}}>{a.turno.accionEsperadaDe}</b></span>•<span>{a.accion.accionEsperada.slice(0,60)}</span>•<span>{correo.adjuntos.length? '📎 '+correo.adjuntos.join(', '):'sin adjuntos'}</span>
                        </div>
                      </div>
                      <div style={{display:'flex',flexDirection:'column',gap:6,alignItems:'flex-end'}}>
                        <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                          <button className="btn sm primary" onClick={()=>abrirResponder(correo)}>↩ Responder IA</button>
                          <button className="btn sm" onClick={()=>{ const p=procesos.find(x=>x.correos?.includes(correo.id)); if(p){setSel(p); setTab('procesos')} else { const h=procesos.find(x=>x.hiloId===correo.hiloId); if(h){setSel(h); setTab('procesos')} else showToast('Correo informativo — no genera proceso')}}}>Ver proceso</button>
                          <button className="btn sm" onClick={()=>marcarLeido(correo.id)}>Leído</button>
                          <button className="btn sm ghost" onClick={()=>archivarCorreo(correo.id)}>Archivar</button>
                        </div>
                        <span className="mono" style={{fontSize:10,color:'var(--muted)'}}>{a.relevancia.score}% relev. • {a.fechas.fechaCalculada||'sin fecha'}</span>
                      </div>
                    </div>
                  ))}
                  {!inboxFiltrado.length && <div style={{textAlign:'center',padding:40,color:'var(--muted)'}}>Sin correos en este filtro Señor.</div>}
                </div>
              </div>
            </>
          )}

          {tab==='procesos' && (
            <>
              <div className="filters">
                <input placeholder="Buscar proceso, ID, área…" value={filtro.q} onChange={e=>setFiltro({...filtro,q:e.target.value})}/>
                <select value={filtro.prior} onChange={e=>setFiltro({...filtro,prior:e.target.value})}><option value="TODAS">Todas prioridades</option><option>CRITICA</option><option>ALTA</option><option>MEDIA</option><option>BAJA</option></select>
                <select value={filtro.estado} onChange={e=>setFiltro({...filtro,estado:e.target.value})}><option value="TODOS">Todos estados</option>{['NUEVO','EN_PROCESO','PENDIENTE','ESPERANDO','SEGUIMIENTO','VENCIDO','REPROGRAMADO','CERRADO','COMPLETADO'].map(s=><option key={s}>{s}</option>)}</select>
                <select value={filtro.area} onChange={e=>setFiltro({...filtro,area:e.target.value})}><option value="TODAS">Todas áreas</option><option>Operaciones</option><option>Compras</option><option>Talento Humano</option><option>TI</option><option>Logística</option><option>Reclutamiento</option><option>Bienestar</option></select>
                <button className="btn sm ghost" onClick={()=>setFiltro({q:'',prior:'TODAS',estado:'TODOS',area:'TODAS'})}>Limpiar filtros</button>
                <button className="btn sm" onClick={()=>{ const rows=filtrados.map(p=>`${p.id},${p.titulo},${p.prioridad},${p.estado},${p.fechaLimite}`).join('\n'); const blob=new Blob([rows],{type:'text/csv'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='procesos.csv'; a.click(); showToast('CSV exportado')}}>Exportar CSV</button>
              </div>
              <div className="table-wrap card" style={{padding:0}}>
                <table className="table">
                  <thead><tr><th>Proceso</th><th>Prioridad</th><th>Estado</th><th>Etapa</th><th>Vence</th><th>Retraso</th><th>Turno</th><th></th></tr></thead>
                  <tbody>
                    {filtrados.map(p=>(
                      <tr key={p.id} className={sel?.id===p.id?'sel':''} onClick={()=>setSel(p)} style={{cursor:'pointer'}}>
                        <td><div style={{fontWeight:700,fontSize:13,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:320}}>{p.id} — {p.titulo}</div><div style={{fontSize:11,color:'var(--muted)'}}>{p.area} • {p.categoria}</div></td>
                        <td><PrioridadDot n={p.prioridad}/> <small style={{fontWeight:700}}>{p.prioridad}</small></td>
                        <td><Pill color={p.estado==='VENCIDO'?'red':p.estado==='EN_PROCESO'?'blue':p.estado==='ESPERANDO'?'cyan':'gray'}>{p.estado}</Pill></td>
                        <td style={{fontSize:12}}>{p.etapa}</td>
                        <td style={{fontSize:12}}>{p.fechaLimite}</td>
                        <td style={{fontSize:12,color:p.retraso>0?'#dc2626':'var(--muted)'}}>{p.retraso?`+${p.retraso}`:'0'}</td>
                        <td style={{fontSize:12}}>{p.turnoActual==='COORDINADORA'?<b style={{color:'#dc2626'}}>TÚ</b>:<span style={{color:'#0891b2'}}>Externo</span>}</td>
                        <td><button className="btn sm" onClick={(e)=>{e.stopPropagation(); setSel(p)}}>Detalle</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!filtrados.length && <div style={{padding:24,textAlign:'center',color:'var(--muted)'}}>Sin resultados con esos filtros Señor.</div>}
              </div>
              {sel && (
                <div className="detail-grid">
                  <div className="card">
                    <div className="card-head"><h3>{sel.id} — {sel.titulo}</h3><PrioridadDot n={sel.prioridad}/><Pill color={sel.prioridad==='CRITICA'?'red':'orange'}>{sel.prioridad}</Pill></div>
                    <p style={{fontSize:13,color:'var(--text2)',lineHeight:1.65,background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:8,padding:'12px 14px'}}>{sel.descripcion}</p>
                    <div className="kv">
                      <div><b>Responsable</b><span>{sel.responsable}</span></div>
                      <div><b>Estado</b><span>{sel.estado}</span></div>
                      <div><b>Etapa</b><span>{sel.etapa}</span></div>
                      <div><b>Turno</b><span style={{color:sel.turnoActual==='COORDINADORA'?'#dc2626':'#0891b2',fontWeight:700}}>{sel.turnoActual} {sel.esperanRespuesta?'• espera tu respuesta':''}</span></div>
                      <div><b>Vence</b><span>{sel.fechaLimite} • restante {sel.tiempoRestante}d</span></div>
                      <div><b>SLA</b><span>obj {sel.tiempoObjetivo}d • trans {sel.tiempoTranscurrido}d • retraso {sel.retraso}d</span></div>
                      <div style={{gridColumn:'1 / -1'}}><b>Próxima acción</b><span style={{color:'#d97706',fontWeight:700}}>{sel.proximaAccion}</span></div>
                    </div>
                    <div style={{marginTop:14,background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:10,padding:14}}>
                      <div style={{fontWeight:700,fontSize:12,marginBottom:8}}>✅ Checklist — ¿qué necesitan para responder?</div>
                      {(sel.tareas?.length? sel.tareas : [{titulo:'Responder solicitud principal',done:false}]).map(t=>(
                        <label key={t.titulo} style={{display:'flex',gap:8,fontSize:12,padding:'7px 0',borderBottom:'1px solid var(--border)',alignItems:'center'}}>
                          <input type="checkbox" checked={!!t.done} onChange={()=>{ const nt=sel.tareas.map(x=> x.titulo===t.titulo? {...x,done:!x.done}:x); updateProceso(sel.id,{tareas:nt}); setSel({...sel,tareas:nt}); showToast(t.done?'Pendiente':'Completado')}}/> {t.titulo} <span style={{marginLeft:'auto',color:t.done?'#059669':'#d97706',fontWeight:700}}>{t.done?'✓':'○ pendiente'}</span>
                        </label>
                      ))}
                      <div style={{marginTop:10,display:'flex',gap:8,flexWrap:'wrap'}}>
                        <button className="btn sm primary" onClick={()=>{ updateProceso(sel.id,{tareas:(sel.tareas||[]).map(t=>({...t,done:true}))}); setSel({...sel,tareas: sel.tareas.map(t=>({...t,done:true}))}); showToast('Listo para responder'); audit('reply_ready',{proceso:sel.id})}}>Marcar listo para responder</button>
                        <button className="btn sm" onClick={()=>{ showToast('Borrador sugerido copiado'); setMascotaLog(l=>[...l,{t:'ahora',m:`Sugerencia ${sel.id}: incluir ${sel.tareas?.[0]?.titulo||'confirmación'} + fecha.`}])}}>Sugerir borrador</button>
                      </div>
                    </div>
                    <div style={{marginTop:12,display:'flex',gap:8,flexWrap:'wrap'}}>
                      <button className="btn primary" onClick={()=>marcarCerrado(sel.id)}>Cerrar proceso</button>
                      <button className="btn" onClick={()=>{updateProceso(sel.id,{prioridad:'CRITICA'}); refresh(); showToast('Urgente → CRÍTICA')}}>Marcar urgente</button>
                      <button className="btn ghost" onClick={()=>showToast('Borrador preparado — requiere confirmación (Action Guard)')}>Preparar reenvío</button>
                    </div>
                  </div>
                  <div className="card">
                    <h4 style={{fontSize:13,fontWeight:800,marginBottom:10}}>📜 Historial</h4>
                    <div className="timeline">
                      {sel.historial?.map((h,i)=>(<div key={i} className="tl-row"><span className="tl-date">{h.fecha}</span><span className="tl-icon">{h.icon}</span><span style={{fontSize:12}}>{h.texto}</span></div>))}
                      <div className="tl-row"><span className="tl-date">{new Date().toISOString().slice(0,10)}</span><span className="tl-icon">👁</span><span style={{fontSize:12}}>Visto por Coordinadora</span></div>
                    </div>
                    <h4 style={{fontSize:13,fontWeight:800,margin:'14px 0 8px'}}>⚠️ Incidencias</h4>
                    {(sel.incidencias?.length? sel.incidencias : [{descripcion:'Sin incidencias'}]).map((inc,i)=>(
                      <div key={i} style={{fontSize:12,background: inc.descripcion==='Sin incidencias'?'var(--bg2)':'#fef2f2',border:'1px solid var(--border)',borderRadius:8,padding:10,marginBottom:6}}>
                        {inc.descripcion} {inc.diasRetraso?`• +${inc.diasRetraso}d`:''} {inc.impacto?`• ${inc.impacto}`:''}
                      </div>
                    ))}
                    <h4 style={{fontSize:13,fontWeight:800,margin:'14px 0 8px'}}>📎 Correos asociados</h4>
                    {correos.filter(c=>sel.correos?.includes(c.id)).map(c=>(
                      <div key={c.id} style={{fontSize:12,border:'1px solid var(--border)',borderRadius:8,padding:10,marginBottom:6,background:'var(--bg2)'}}>
                        <b>{c.asunto}</b><div style={{color:'var(--muted)'}}>{c.remitente.split('<')[0].trim()} • {c.fecha.slice(0,16).replace('T',' ')}</div><div style={{marginTop:4,color:'var(--text2)'}}>{c.cuerpo.slice(0,110)}…</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {tab==='correos' && (
            <>
              <div className="card">
                <div className="card-head"><h3>🧠 Análisis IA — pipeline 15 preguntas</h3><span className="mono" style={{fontSize:11,color:'var(--muted)'}}>Gmail → comprensión profunda • sin tarea por correo</span></div>
                <div className="pipeline">{['INGESTA','NORMALIZACIÓN','THREAD','RELEVANCIA','INTENCIÓN','RESPONSABLE','FECHAS','MATCHER','ACCIÓN'].map(s=>(<span key={s} className="pipe-step">{s}</span>))}</div>
              </div>
              <div style={{display:'flex',flexDirection:'column',gap:10}}>
                {analisis.map(({correo,a})=>(
                  <div key={correo.id} className="mail-card" style={{opacity: !a.relevancia.esRelevante?0.6:1}}>
                    <div style={{display:'flex',gap:12,alignItems:'flex-start'}}>
                      <div className={`mail-type t-${a.clasificacion.tipo}`}>{a.clasificacion.tipo}</div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontWeight:700,fontSize:13}}>{correo.asunto} <span style={{fontWeight:400,color:'var(--muted)',fontSize:12}}>— {correo.remitente.split('<')[0].trim()}</span></div>
                        <div style={{fontSize:12,color:'var(--text2)',marginTop:4}}>{correo.cuerpo.slice(0,160)}…</div>
                        <div style={{marginTop:8,display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(170px,1fr))',gap:8}}>
                          <div className="mini-card"><b>¿Es relevante?</b><br/>{a.relevancia.esRelevante?'✅ Sí':'⚪ No'} • {a.relevancia.score}%</div>
                          <div className="mini-card"><b>¿Para quién?</b><br/>{a.destinatarios.responsablePrincipal} • turno {a.turno.accionEsperadaDe}</div>
                          <div className="mini-card"><b>¿Qué esperan?</b><br/>{a.accion.accionEsperada.slice(0,50)}</div>
                          <div className="mini-card"><b>Fechas</b><br/>{a.fechas.fechaMencionada||'—'} → {a.fechas.fechaCalculada||'—'}</div>
                        </div>
                        <div style={{marginTop:8,display:'flex',gap:6,flexWrap:'wrap'}}><Pill color={a.prioridad.nivel==='CRITICA'?'red':a.prioridad.nivel==='ALTA'?'orange':'gray'}>{a.prioridad.nivel} {a.prioridad.score}</Pill>{a.incidencia.existe&&<Pill color="red">INCIDENCIA</Pill>}<Pill color="blue">{a.turno.tipoRespuesta}</Pill><span className="mono" style={{fontSize:11,color:'var(--muted)',alignSelf:'center'}}>{Math.round(a.confianza*100)}% conf.</span></div>
                      </div>
                      <PrioridadDot n={a.prioridad.nivel}/>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {tab==='sheets' && (
            <div className="card">
              <div className="card-head"><h3>📒 Google Sheets — vista operativa</h3><button className="btn primary" onClick={()=>showToast('Exportado a Sheets (simulado) — en prod usa Sheets API')}>Exportar a Sheets</button></div>
              <div className="table-wrap"><table className="table"><thead><tr><th>ID</th><th>Título</th><th>Área</th><th>Prioridad</th><th>Estado</th><th>Vence</th><th>Retraso</th></tr></thead><tbody>{procesos.map(p=>(<tr key={p.id}><td className="mono" style={{fontSize:12}}>{p.id}</td><td style={{fontSize:12,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:280}}>{p.titulo}</td><td style={{fontSize:12}}>{p.area}</td><td><PrioridadDot n={p.prioridad}/>{p.prioridad}</td><td><Pill color="gray">{p.estado}</Pill></td><td style={{fontSize:12}}>{p.fechaLimite}</td><td style={{fontSize:12,color:p.retraso>0?'#dc2626':''}}>{p.retraso||0}</td></tr>))}</tbody></table></div>
            </div>
          )}

          {tab==='auditoria' && (
            <div className="card">
              <div className="card-head"><h3>🛡️ Auditoría & Action Guard</h3><span className="mono" style={{fontSize:11,color:'var(--muted)'}}>IA propone, sistema controla</span></div>
              <div style={{display:'grid',gap:8}}>
                {[
                  {fecha:'2026-09-11 15:32',usuario:'IA Gemini',accion:'Posible finalización PROC-00176',conf:'94%',res:'Confirmar'},
                  {fecha:'2026-09-11 14:20',usuario:'Sistema',accion:`Sync Gmail real — ${correos.length} correos`,conf:'—',res:'OK'},
                  {fecha:'2026-09-11 09:00',usuario:'Coordinadora',accion:'Marcó PROC-00182 urgente',conf:'—',res:'CRÍTICA'},
                ].map((r,i)=>(
                  <div key={i} style={{display:'flex',gap:12,fontSize:12,border:'1px solid var(--border)',borderRadius:8,padding:12,alignItems:'center',background:'var(--bg2)'}}>
                    <span className="mono" style={{color:'var(--muted)',minWidth:110}}>{r.fecha}</span><span style={{minWidth:120,fontWeight:700}}>{r.usuario}</span><span style={{flex:1}}>{r.accion}</span><span className="mono">{r.conf}</span><Pill color="blue">{r.res}</Pill>
                  </div>
                ))}
              </div>
            </div>
          )}
        </main>

        <aside className="mascota">
          <div className="mascota-head"><div style={{fontWeight:800,fontSize:14}}>🐶 Secretaria</div><div style={{display:'flex',gap:6,alignItems:'center'}}><span className="mascota-dot ok"/><small className="mono" style={{color:'var(--muted)'}}>3h • Gmail REAL</small></div></div>
          <div style={{fontSize:11,color:'var(--muted)',margin:'0 0 10px'}}>🟢 info • 🟡 atención • 🟠 importante • 🔴 crítica — inbox siempre ordenado</div>
          <div className="mascota-log">
            {mascotaLog.map((l,i)=>(<div key={i} className="mascota-msg"><span className="mono" style={{fontSize:11,color:'var(--muted)',minWidth:36}}>{l.t}</span><span style={{fontSize:12,lineHeight:1.5}}>{l.m}</span></div>))}
          </div>
          {sel && <div style={{marginTop:8,fontSize:11,color:'var(--muted)'}}>Contexto: <b style={{color:'var(--text)'}}>{sel.id}</b> — {sel.titulo.slice(0,36)}</div>}
          <div style={{display:'flex',gap:6,marginTop:8}}>
            <input value={mascotaInput} onChange={e=>setMascotaInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&handleInstruccion(mascotaInput)} placeholder='Ej: "Este ya quedó listo"' style={{flex:1,background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:8,padding:'10px 12px',color:'var(--text)',fontSize:12}}/>
            <button className="btn primary" onClick={()=>handleInstruccion(mascotaInput)}>Enviar</button>
          </div>
          <div style={{display:'flex',gap:6,marginTop:8,flexWrap:'wrap'}}>
            {['Este ya quedó listo','Este se lo puedes mandar a Carlos','Este déjalo para mañana','Este es urgente','A este hazle seguimiento el lunes'].map(t=>(
              <button key={t} className="chip" onClick={()=>handleInstruccion(t)}>{t}</button>
            ))}
          </div>
          {showNotif && (
            <div className="notif-crit">
              <b>🔴 Tienes proceso vencido</b><div style={{fontSize:12,marginTop:4}}>PROC-00176 venció +{procesos.find(p=>p.id==='PROC-00176')?.retraso||1}d. ¿Corregir ahora Señor?</div>
              <button className="btn sm" style={{marginTop:8,background:'#fff',color:'#111'}} onClick={()=>{const p=procesos.find(x=>x.id==='PROC-00176'); if(p) setSel(p); setShowNotif(false)}}>Ver</button>
              <button style={{position:'absolute',top:8,right:8,background:'transparent',border:0,color:'#fff',cursor:'pointer'}} onClick={()=>setShowNotif(false)}>✕</button>
            </div>
          )}
        </aside>
      </div>
      {reply && (
        <div className="reply-overlay" onClick={()=>!sending && setReply(null)}>
          <div className="reply-modal" onClick={e=>e.stopPropagation()}>
            <div className="reply-head">
              <div>
                <h3>↩ Responder — con contexto IA</h3>
                <div className="mono" style={{fontSize:11,color:'var(--muted)',marginTop:2}}>Hilo {reply.correo.hiloId.slice(0,8)} • {reply.analisis.prioridad.nivel} {reply.analisis.prioridad.score}/100 • conf {Math.round(reply.analisis.confianza*100)}% • {reply.sugerencia.tono}</div>
              </div>
              <button className="btn sm ghost" onClick={()=>setReply(null)}>✕</button>
            </div>
            <div className="reply-body">
              <div className="reply-context">
                <b style={{fontSize:11,textTransform:'uppercase',letterSpacing:0.5}}>Contexto detectado por IA</b>
                <div style={{marginTop:6,display:'flex',gap:6,flexWrap:'wrap'}}>
                  <Pill color={reply.analisis.clasificacion.tipo==='URGENTE'?'red':'blue'}>{reply.analisis.clasificacion.tipo}</Pill>
                  <Pill color={reply.analisis.turno.accionEsperadaDe==='COORDINADORA'?'red':'cyan'}>Turno: {reply.analisis.turno.accionEsperadaDe}</Pill>
                  <Pill color="gray">{reply.analisis.fechas.fechaCalculada? `Vence ${reply.analisis.fechas.fechaCalculada}`:'Sin fecha'}</Pill>
                </div>
                <div style={{marginTop:8,color:'var(--muted)'}}><b>Qué esperan:</b> {reply.analisis.accion.accionEsperada}</div>
                {reply.sugerencia.checklist.length>0 && <div style={{marginTop:6}}><b>Checklist:</b> {reply.sugerencia.checklist.map(c=>c.q).join(' • ')}</div>}
                {reply.proceso && <div style={{marginTop:6}}><b>Proceso:</b> {reply.proceso.id} — {reply.proceso.titulo.slice(0,60)}</div>}
              </div>
              <div className="reply-field"><label>Para</label><input value={reply.correo.remitente} readOnly style={{background:'var(--bg2)',color:'var(--muted)'}} /></div>
              <div className="reply-field"><label>Asunto</label><input value={reply.asunto} onChange={e=>setReply(r=>({...r, asunto:e.target.value}))} /></div>
              <div className="reply-field"><label>Mensaje sugerido por IA — editable</label><textarea value={reply.cuerpo} onChange={e=>setReply(r=>({...r, cuerpo:e.target.value}))} rows={12} /></div>
              <div style={{fontSize:11,color:'var(--muted)',background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:8,padding:10}}>
                💡 <b>Sugerencia IA:</b> El tono es {reply.sugerencia.tono}. La IA ya consideró el hilo completo ({reply.correo.hiloId.slice(0,8)}) y el checklist. Puedes editar antes de enviar. <b>Action Guard:</b> requiere confirmación antes de enviar a externo.
              </div>
            </div>
            <div className="reply-actions">
              <span className="mono" style={{fontSize:11,color:'var(--muted)'}}>Gmail REAL • {reply.correo.remitente.split('<')[0].trim()} • via {GMAIL_META.account}</span>
              <div style={{display:'flex',gap:8}}>
                <button className="btn ghost" onClick={()=>setReply(null)} disabled={sending}>Cancelar</button>
                <button className="btn primary" onClick={enviarRespuesta} disabled={sending || !reply.cuerpo.trim()}>{sending?'Enviando…':'Enviar respuesta →'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <footer style={{textAlign:'center',padding:'16px 0 24px',fontSize:11,color:'var(--muted)'}} className="mono">MVP 1 • Gmail REAL → IA → Firebase → Web • Responder con contexto • Inbox ordenado • {new Date().toLocaleDateString()}</footer>
    </div>
  )
}
