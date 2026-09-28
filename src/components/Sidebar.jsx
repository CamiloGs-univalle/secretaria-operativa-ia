import { Sparkles, Bot, MessageSquare } from 'lucide-react'

const NAV_ICONS_LABELS = [
  {k:'dashboard',label:'Inicio'},
  {k:'inbox',label:'Bandeja inteligente'},
  {k:'seguimientos',label:'Seguimientos'},
  {k:'procesos',label:'Tareas'},
  {k:'calendario',label:'Calendario'},
  {k:'estadisticas',label:'Estadísticas'},
  {k:'contactos',label:'Contactos'},
  {k:'configuracion',label:'Configuración'},
]

// Barra lateral: navegación entre pestañas, etiquetas inteligentes (atajos
// filtrados a Inbox/Seguimientos/Tareas) y la tarjeta del asistente. Toda la
// data que muestra (contadores, badges) ya viene calculada por
// useCorreosYProcesos — este componente solo la presenta.
export default function Sidebar({ tab, setTab, correos, seguimientosFlat, stats, analisis, archivados, setInboxFiltro, gmailConectado, session, navIcons }){
  const items = NAV_ICONS_LABELS.map(it => ({
    ...it,
    badge: it.k==='inbox' ? correos.length
      : it.k==='seguimientos' ? seguimientosFlat.filter(s=>['PENDIENTE','PROXIMO','VENCIDO'].includes(s.estado)).length
      : it.k==='procesos' ? stats.total
      : undefined,
  }))
  const tags = [
    {label:'Urgentes',color:'red',n:analisis.filter(a=>a.a.prioridad.nivel==='CRITICA').length, onClick:()=>{setTab('inbox'); setInboxFiltro(f=>({...f,tab:'URGENTES'}))}},
    {label:'Requieren respuesta',color:'orange',n:analisis.filter(a=>a.a.accion.requiereAccion && a.a.turno.accionEsperadaDe==='COORDINADORA').length, onClick:()=>{setTab('inbox'); setInboxFiltro(f=>({...f,tab:'ACCION'}))}},
    {label:'Incidencias',color:'yellow',n:analisis.filter(a=>a.a.incidencia.existe).length, onClick:()=>{setTab('inbox'); setInboxFiltro(f=>({...f,tab:'INCIDENCIAS'}))}},
    {label:'Seguimientos',color:'blue',n:seguimientosFlat.filter(s=>['PENDIENTE','PROXIMO','VENCIDO'].includes(s.estado)).length, onClick:()=>setTab('seguimientos')},
    {label:'En proceso',color:'green',n:stats.enProc, onClick:()=>setTab('procesos')},
    {label:'Archivados',color:'gray',n:archivados.length, onClick:()=>{setTab('inbox'); setInboxFiltro(f=>({...f,tab:'ARCHIVADOS'}))}},
  ]
  return (
    <nav className="sidebar">
      <div className="logo-container">
        <div className="logo-icon-box"><Sparkles size={20}/></div>
        <div className="logo-text"><h1>Mi Asistente</h1><p>Gestor inteligente de correo</p></div>
      </div>

      <div className="nav-menu">
        {items.map(it=>{
          const Icon = navIcons[it.k]
          return (
            <button key={it.k} className={`nav-item ${tab===it.k?'active':''}`} onClick={()=>setTab(it.k)}>
              <span className="nav-icon"><Icon size={17} strokeWidth={2.1}/></span><span style={{flex:1}}>{it.label}</span>{it.badge>0 && <span className="badge">{it.badge}</span>}
            </button>
          )
        })}
      </div>

      <div className="section-title">Etiquetas inteligentes</div>
      <div className="tags-list">
        {tags.map(t=>(
          <div key={t.label} className="tag-item" role="button" tabIndex={0} onClick={t.onClick} onKeyDown={e=>{if(e.key==='Enter')t.onClick()}}>
            <span className="tag-left"><span className={`dot ${t.color}`}/>{t.label}</span><span>{t.n}</span>
          </div>
        ))}
      </div>

      <div className="ai-card">
        <div className="robot-icon"><Bot size={30}/></div>
        <h3>Tu asistente de correo</h3>
        <div className="ai-status"><span className="status-dot"/>{gmailConectado?'IA activa · datos reales':session.firebase?'IA activa · Gmail sin conectar':'IA activa · modo demo'}</div>
        <p>Analizo, organizo y te recuerdo lo importante. Tú solo actúa.</p>
        <button className="btn-ai" onClick={()=>{setTab('dashboard'); setTimeout(()=>document.querySelector('.asis-input-row input')?.focus(),80)}}><MessageSquare size={14}/> Preguntar algo</button>
      </div>
      <div className="sidebar-footer" role="button" tabIndex={0} onClick={()=>setTab('configuracion')}>
        <span className={`status-indicator ${gmailConectado?'':'demo'}`}/>
        <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{gmailConectado?'Gmail real conectado':session?.firebase?'Sesión Google activa':'Modo demostración'}</span>
      </div>
    </nav>
  )
}
