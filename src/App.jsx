import { useState, useEffect, useMemo } from 'react'
import { getProcesos, saveProcesos, setModoAlmacenamiento, updateProceso, audit, setUsuarioActual } from './data/mockFirebase.js'
import { fetchProcesosFirestore, subscribeProcesosFirestore, saveProcesoFirestore } from './data/mockFirebase.js'
import { analizarCorreoCompleto } from './engine/emailEngine.js'
import { fetchRealGmail, archivarGmailReal } from './services/gmailService.js'
import { generarCorreosDemo } from './data/demoGmail.js'
import { generarProcesosDesdeCorreos } from './services/processGenerator.js'
import LoginScreen from './components/LoginScreen.jsx'
import { getDemoUser, setDemoUser, clearDemoUser, fetchRealSession, logoutReal, signInWithGoogle, logoutFirebase, onFirebaseAuthChange } from './services/authService.js'
import './App.css'

function fechaLocalISO(d=new Date()){const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');return `${y}-${m}-${day}`}
function fechaVencida(p){return !!p.fechaLimite && p.fechaLimite < fechaLocalISO() && !['CERRADO','COMPLETADO','CANCELADO'].includes(p.estado)}

export default function App(){
  const [session,setSession]=useState(undefined)
  const [tab,setTab]=useState('inicio')
  const [procesos,setProcesos]=useState([])
  const [correos,setCorreos]=useState([])
  const [filtro,setFiltro]=useState('todas')
  const [busqueda,setBusqueda]=useState('')
  const [toast,setToast]=useState(null)
  const showToast=(m)=>{setToast(m); setTimeout(()=>setToast(null),3000)}

  useEffect(()=>{
    const unsub=onFirebaseAuthChange(async(fbUser)=>{
      if(fbUser){ setModoAlmacenamiento(false); setSession(fbUser); const l=await fetchProcesosFirestore(fbUser.email); if(l) setProcesos(l); return }
      const real=await fetchRealSession()
      if(real){ setModoAlmacenamiento(false); setSession({nombre:real.name||real.email,email:real.email,real:true}); return }
      const demo=getDemoUser()
      if(demo){ setModoAlmacenamiento(true); setSession({...demo,real:false}); return }
      setModoAlmacenamiento(true); setSession(null)
    })
    return ()=>unsub&&unsub()
  },[])

  useEffect(()=>{
    if(!session) return
    setUsuarioActual(session.nombre||session.email)
    ;(async()=>{
      let list=[]
      let gmailSession=session.real?await fetchRealSession():null
      if(gmailSession && session.email && gmailSession.email?.toLowerCase().trim()!==session.email.toLowerCase().trim()){ gmailSession=null }
      if(gmailSession){ try{ list=await fetchRealGmail({maxResults:20})}catch(e){} }
      else if(!session.real){ list=generarCorreosDemo({name:session.nombre,email:session.email}) }
      if(session.firebase && !gmailSession) return
      setCorreos(list)
      const base=gmailSession?getProcesos():[]
      const {procesos:gen}=generarProcesosDesdeCorreos(list,base,gmailSession?181:5000,session.email)
      saveProcesos(gen); setProcesos(gen)
    })()
  },[session])

  const kpi=useMemo(()=>{
    const pend=procesos.filter(p=>!['COMPLETADO','CERRADO','CANCELADO'].includes(p.estado))
    return {
      urgente: pend.filter(p=>p.prioridad==='CRITICA').length,
      alta: pend.filter(p=>p.prioridad==='ALTA').length,
      media: pend.filter(p=>p.prioridad==='MEDIA').length,
      baja: pend.filter(p=>p.prioridad==='BAJA').length,
      comp: procesos.filter(p=>['COMPLETADO','CERRADO'].includes(p.estado)).length
    }
  },[procesos])

  const tareasInicio=useMemo(()=>{
    let l=[...procesos]
    if(filtro!=='todas') l=l.filter(p=>{
      if(filtro==='pendientes') return !['COMPLETADO','CERRADO','CANCELADO'].includes(p.estado)
      if(filtro==='completadas') return ['COMPLETADO','CERRADO'].includes(p.estado)
      const m={urgente:'CRITICA',alta:'ALTA',media:'MEDIA',baja:'BAJA'}
      return p.prioridad===m[filtro]
    })
    if(busqueda) l=l.filter(p=> (p.titulo+p.descripcion).toLowerCase().includes(busqueda.toLowerCase()))
    return l.slice(0,5)
  },[procesos,filtro,busqueda])

  function toggleDone(id){
    const p=procesos.find(x=>x.id===id)
    const isDone=['COMPLETADO','CERRADO'].includes(p.estado)
    updateProceso(id,{estado:isDone?'PENDIENTE':'COMPLETADO'})
    setProcesos([...getProcesos()])
    showToast(isDone?'Reactivada':'Completada')
  }

  if(session===undefined) return <div style={{minHeight:'100vh',display:'grid',placeItems:'center'}}>Cargando...</div>
  if(!session) return <LoginScreen onDemoLogin={(u)=>{const d={nombre:u.name,email:u.email,real:false}; setDemoUser(d); setSession(d)}} onGoogleLogin={async()=>{const u=await signInWithGoogle(); setSession(u)}} onRealConnect={()=>{}} loginStatus={null} loginEsperado={null} loginConectado={null} composioConfigured={false} />

  return (
    <div className="app-container">
      <aside className="sidebar">
        <div className="logo-container">
          <i className="fa-solid fa-envelope-open-text logo-icon"></i>
          <div className="logo-text"><h1>MailAssistant</h1><p>Tu asistente de correo y tareas</p></div>
        </div>
        <nav className="nav-menu">
          <a className={`nav-item ${tab==='inicio'?'active':''}`} onClick={()=>setTab('inicio')}><i className="fa-solid fa-house"></i><span>Inicio</span></a>
          <a className={`nav-item ${tab==='bandeja'?'active':''}`} onClick={()=>setTab('bandeja')}><i className="fa-solid fa-inbox"></i><span>Bandeja inteligente</span><span className="badge">{correos.length}</span></a>
          <a className={`nav-item ${tab==='tareas'?'active':''}`} onClick={()=>setTab('tareas')}><i className="fa-solid fa-list-check"></i><span>Tareas</span><span className="badge">{procesos.filter(p=>!['COMPLETADO','CERRADO','CANCELADO'].includes(p.estado)).length}</span></a>
          <a className={`nav-item ${tab==='calendario'?'active':''}`} onClick={()=>setTab('calendario')}><i className="fa-solid fa-calendar-days"></i><span>Calendario</span></a>
          <a className={`nav-item ${tab==='contactos'?'active':''}`} onClick={()=>setTab('contactos')}><i className="fa-solid fa-user"></i><span>Contactos</span></a>
          <a className={`nav-item ${tab==='estadisticas'?'active':''}`} onClick={()=>setTab('estadisticas')}><i className="fa-solid fa-chart-simple"></i><span>Estadísticas</span></a>
          <a className={`nav-item ${tab==='configuracion'?'active':''}`} onClick={()=>setTab('configuracion')}><i className="fa-solid fa-gear"></i><span>Configuración</span></a>
        </nav>
        <div className="section-title">Etiquetas inteligentes</div>
        <div className="tags-list">
          <div className="tag-item" onClick={()=>{setTab('tareas'); setFiltro('urgente')}}><div className="tag-left"><span className="dot red"></span><span>Requiere acción</span></div><span>{kpi.urgente}</span></div>
          <div className="tag-item" onClick={()=>{setTab('tareas'); setFiltro('alta')}}><div className="tag-left"><span className="dot orange"></span><span>Responder</span></div><span>{kpi.alta}</span></div>
          <div className="tag-item"><div className="tag-left"><span className="dot yellow"></span><span>Pendiente / Seguimiento</span></div><span>{kpi.media}</span></div>
          <div className="tag-item"><div className="tag-left"><span className="dot blue"></span><span>Información</span></div><span>{kpi.baja}</span></div>
          <div className="tag-item"><div className="tag-left"><span className="dot green"></span><span>Resuelto</span></div><span>{kpi.comp}</span></div>
        </div>
        <div className="ai-card">
          <i className="fa-solid fa-robot robot-icon"></i>
          <h3>Tu asistente IA</h3>
          <div className="ai-status"><span className="status-dot"></span><span>En línea</span></div>
          <p>Estoy analizando tus correos, organizando tareas y buscando lo más importante para ti.</p>
          <button className="btn-ai" onClick={()=>setTab('inicio')}><i className="fa-solid fa-wand-magic-sparkles"></i> Ver sugerencias</button>
        </div>
        <div className="sidebar-footer">
          <span className="status-indicator"></span>
          <i className="fa-brands fa-google" style={{color:'#ea4335'}}></i>
          <span>Gmail conectado</span>
        </div>
      </aside>

      <main className="main-content">
        <header className="top-header">
          <div className="search-container">
            <i className="fa-brands fa-google gmail-logo"></i>
            <div className="search-bar">
              <i className="fa-solid fa-magnifying-glass"></i>
              <input type="text" placeholder="Buscar correos, tareas, personas..." value={busqueda} onChange={e=>setBusqueda(e.target.value)} />
              <i className="fa-solid fa-sliders settings-icon"></i>
            </div>
          </div>
          <div className="header-actions">
            <button className="notification-btn"><i className="fa-regular fa-bell"></i><span className="notification-badge">3</span></button>
            <div className="user-profile">
              <img src="https://i.pravatar.cc/150?img=11" alt="User" />
              <div className="user-info"><h4>{session.nombre}</h4><p>Modo demo</p></div>
              <i className="fa-solid fa-chevron-down" style={{fontSize:12}}></i>
            </div>
          </div>
        </header>

        <div className={tab==='inicio'?'view active':'view'} id="view-inicio">
          <section className="welcome-banner">
            <div className="banner-top">
              <div className="banner-title"><i className="fa-regular fa-sun"></i> ¡Buenos días, {session.nombre?.split(' ')[0]||'Johan'}! 👋</div>
              <div className="banner-date"><i className="fa-regular fa-calendar"></i> {new Date().toLocaleDateString('es-ES',{weekday:'long',day:'numeric',month:'long'})}</div>
            </div>
            <p className="banner-subtitle">Aquí tienes un resumen de lo más importante para hoy.</p>
            <div className="banner-quote"><i className="fa-solid fa-quote-left"></i> "La organización no es una meta, es un hábito."</div>
            <div className="banner-weather">
              <div className="temp"><i className="fa-regular fa-sun"></i> 22°C</div>
              <div className="location">Medellín</div>
            </div>
          </section>

          <section className="kpi-grid">
            <div className="kpi-card red" onClick={()=>setTab('bandeja')}><div className="kpi-header"><div className="kpi-icon"><i className="fa-regular fa-envelope"></i></div><span className="kpi-count">{kpi.urgente}</span></div><p className="kpi-label">Correos requieren acción inmediata</p><button className="kpi-btn">Ver correos <i className="fa-solid fa-chevron-right"></i></button></div>
            <div className="kpi-card orange" onClick={()=>setTab('bandeja')}><div className="kpi-header"><div className="kpi-icon"><i className="fa-regular fa-comment-dots"></i></div><span className="kpi-count">{kpi.alta}</span></div><p className="kpi-label">Correos para responder</p><button className="kpi-btn">Ver correos <i className="fa-solid fa-chevron-right"></i></button></div>
            <div className="kpi-card yellow" onClick={()=>setTab('tareas')}><div className="kpi-header"><div className="kpi-icon"><i className="fa-regular fa-clock"></i></div><span className="kpi-count">{kpi.media}</span></div><p className="kpi-label">Pendientes / Seguimiento</p><button className="kpi-btn">Ver tareas <i className="fa-solid fa-chevron-right"></i></button></div>
            <div className="kpi-card blue"><div className="kpi-header"><div className="kpi-icon"><i className="fa-solid fa-info-circle"></i></div><span className="kpi-count">{kpi.baja}</span></div><p className="kpi-label">Correos informativos</p><button className="kpi-btn">Ver correos <i className="fa-solid fa-chevron-right"></i></button></div>
            <div className="kpi-card green"><div className="kpi-header"><div className="kpi-icon"><i className="fa-regular fa-circle-check"></i></div><span className="kpi-count">{kpi.comp}</span></div><p className="kpi-label">Resueltos hoy</p><button className="kpi-btn">Ver historial <i className="fa-solid fa-chevron-right"></i></button></div>
          </section>

          <section className="tasks-section">
            <div className="section-header">
              <div className="section-header-left">
                <i className="fa-solid fa-bullseye"></i>
                <div><h2>Tareas y correos prioritarios</h2><p>Lo más importante, en un solo lugar. Puedes marcar como realizado, delegar o programar.</p></div>
              </div>
              <button className="btn-link" onClick={()=>setTab('tareas')}>Ver todas las tareas <i className="fa-solid fa-chevron-right"></i></button>
            </div>
            <div className="filter-bar">
              <div className={`filter-chip ${filtro==='todas'?'active':''}`} onClick={()=>setFiltro('todas')}>Todas</div>
              <div className={`filter-chip ${filtro==='urgente'?'active':''}`} onClick={()=>setFiltro('urgente')}>Urgentes</div>
              <div className={`filter-chip ${filtro==='alta'?'active':''}`} onClick={()=>setFiltro('alta')}>Alta</div>
              <div className={`filter-chip ${filtro==='media'?'active':''}`} onClick={()=>setFiltro('media')}>Media</div>
              <div className={`filter-chip ${filtro==='pendientes'?'active':''}`} onClick={()=>setFiltro('pendientes')}>Pendientes</div>
            </div>
            <div className="task-list">
              {tareasInicio.map(t=>(
                <div key={t.id} className={`task-item ${['COMPLETADO','CERRADO'].includes(t.estado)?'completed':''}`}>
                  <div className="task-checkbox-wrapper"><div className={`task-checkbox ${['COMPLETADO','CERRADO'].includes(t.estado)?'checked':''}`} onClick={()=>toggleDone(t.id)}><i className="fa-solid fa-check" style={{fontSize:12}}></i></div></div>
                  <div className={`task-priority ${t.prioridad==='CRITICA'?'urgente':t.prioridad==='ALTA'?'alta':t.prioridad==='MEDIA'?'media':'baja'}`}>{t.prioridad==='CRITICA'?'Urgente':t.prioridad}</div>
                  <div className="task-icon"><i className="fa-regular fa-envelope"></i></div>
                  <div className="task-content">
                    <h4>{t.titulo}</h4>
                    <p>{(t.descripcion||'').slice(0,80)}</p>
                    <div className="task-meta"><span>De: {t.responsable}</span><span>{t.fechaLimite}</span></div>
                  </div>
                  <div className="task-date">
                    <div className="date red">Vence {t.fechaLimite}</div>
                    <div className="status">{t.estado}</div>
                  </div>
                  <div className="task-action">
                    <button className="btn-task" onClick={()=>toggleDone(t.id)}>{['COMPLETADO','CERRADO'].includes(t.estado)?'Completada':'Ver correo'}</button>
                    <button className="btn-task-icon" onClick={()=>alert('Editar')}><i className="fa-solid fa-pen"></i></button>
                    <button className="btn-task-icon delete" onClick={()=>{ if(confirm('Eliminar?')){ const r=procesos.filter(x=>x.id!==t.id); saveProcesos(r); setProcesos(r) } }}><i className="fa-solid fa-trash"></i></button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className={tab==='bandeja'?'view active':'view'}>
          <div className="email-list">
            {correos.slice(0,8).map(c=>(
              <div key={c.id} className="email-item">
                <input type="checkbox" className="email-checkbox" />
                <i className="fa-solid fa-star email-star"></i>
                <div className="email-info"><h4>{c.asunto}</h4><p>{c.cuerpo.slice(0,50)}</p></div>
                <div className="email-tags"><span className="tag blue">Info</span></div>
                <div className="email-date">{c.fecha.slice(0,10)}</div>
              </div>
            ))}
          </div>
        </div>

        <div className={tab==='tareas'?'view active':'view'}>
          <div className="kanban-board">
            {[
              {k:'pendiente',l:'Pendientes',e:'PENDIENTE'},
              {k:'progreso',l:'En Progreso',e:'EN_PROCESO'},
              {k:'completada',l:'Completadas',e:'COMPLETADO'},
            ].map(col=>(
              <div key={col.k} className="kanban-column">
                <div className="kanban-header"><span>{col.l}</span><span className="kanban-count">{procesos.filter(p=>p.estado===col.e).length}</span></div>
                <div className="kanban-cards">
                  {procesos.filter(p=>p.estado===col.e).slice(0,3).map(t=>(
                    <div key={t.id} className="kanban-card">
                      <h4>{t.titulo}</h4>
                      <p>{(t.descripcion||'').slice(0,50)}</p>
                      <div className="kanban-card-footer"><span className="tag blue">{t.prioridad}</span><span>{t.fechaLimite}</span></div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className={tab==='calendario'?'view active':'view'}>
          <div className="calendar-grid">
            <div className="calendar-header-cell">Lun</div><div className="calendar-header-cell">Mar</div><div className="calendar-header-cell">Mié</div><div className="calendar-header-cell">Jue</div><div className="calendar-header-cell">Vie</div><div className="calendar-header-cell">Sáb</div><div className="calendar-header-cell">Dom</div>
            {Array.from({length:21},(_,i)=>14+i).map(d=>(
              <div key={d} className="calendar-cell">
                <span className={`calendar-date ${d===18?'today':''}`}>{d}</span>
                {d===18 && <><div className="calendar-event">09:00 Revisión</div><div className="calendar-event orange">11:00 Reunión</div></>}
              </div>
            ))}
          </div>
        </div>

        <div className={tab==='contactos'?'view active':'view'}>
          <div className="contacts-grid">
            <div className="contact-card"><img src="https://i.pravatar.cc/150?img=11" alt="c" /><h4>Johan García</h4><p>Administrador</p><span className="email">johan@empresa.com</span></div>
            <div className="contact-card"><img src="https://i.pravatar.cc/150?img=12" alt="c" /><h4>Carlos Mendoza</h4><p>Ventas</p><span className="email">carlos@empresa.com</span></div>
          </div>
        </div>

        <div className={tab==='estadisticas'?'view active':'view'}>
          <div className="stats-grid">
            <div className="chart-card"><h3>Correos por día</h3><div className="bar-chart"><div className="bar-wrapper"><div className="bar" style={{height:'60%'}}></div><span className="bar-label">Lun</span></div></div></div>
            <div className="chart-card"><h3>Distribución</h3><div className="bar-chart"><div className="bar-wrapper"><div className="bar" style={{height:'80%'}}></div><span className="bar-label">Resuelto</span></div></div></div>
          </div>
        </div>

        <div className={tab==='configuracion'?'view active':'view'}>
          <div className="settings-card"><h3>Configuración</h3><p>Conecta tu Gmail para ver datos reales.</p></div>
        </div>

      </main>

      <aside className="right-panel">
        <div className="panel-card">
          <div className="panel-header"><h3><i className="fa-regular fa-calendar"></i> Tu agenda de hoy</h3><a href="#">Ver calendario</a></div>
          <div className="agenda-list">
            <div className="agenda-item"><div className="agenda-time">09:00</div><div className="agenda-dot blue"></div><div className="agenda-content"><h4>Revisión de pendientes</h4><p>Oficina</p></div></div>
            <div className="agenda-item"><div className="agenda-time">11:00</div><div className="agenda-dot blue"></div><div className="agenda-content"><h4>Reunión con equipo operativo</h4><p>Teams</p></div></div>
          </div>
        </div>
        <div className="panel-card">
          <div className="panel-header"><h3><i className="fa-regular fa-chart-bar"></i> Resumen de la semana</h3></div>
          <div className="weekly-summary"><div className="big-number">{correos.length}</div><div className="big-label">Correos</div></div>
        </div>
        <div className="ai-suggestion-card">
          <i className="fa-solid fa-rocket bg-icon"></i>
          <h4>¿Qué debería hacer ahora?</h4>
          <p>Te recomiendo empezar por la tarea más urgente.</p>
          <button className="btn-ai-suggestion" onClick={()=>setTab('tareas')}>Ver sugerencia</button>
        </div>
      </aside>
    </div>
  )
}
