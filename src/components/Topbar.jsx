import { Sparkles, Search, Mail, Bell, ChevronDown } from 'lucide-react'
import Pill from './ui/Pill.jsx'

// Barra superior: buscador global, estado de Gmail/sincronización, campana
// de urgentes y el menú de cuenta (tema, sincronizar, cerrar sesión). Todo
// dato mostrado viene ya calculado desde los hooks — este componente solo
// presenta y delega acciones a los handlers que recibe.
export default function Topbar({
  busquedaTop, setBusquedaTop, setInboxFiltro, setTab,
  gmailConectado, session, handleSync, handleRealConnect,
  loading, syncing, stats,
  menuOpen, setMenuOpen, iniciales,
  theme, setTheme, handleLogout,
}){
  return (
    <header className="topbar">
      <div className="brand">
        <div className="logo"><Sparkles size={20} strokeWidth={2.2}/></div>
        <div><div className="brand-title">Mi Asistente</div><div className="brand-sub">Tu correo, en buenas manos</div></div>
      </div>
      <form className="topbar-search" onSubmit={e=>{e.preventDefault(); if(!busquedaTop.trim())return; setInboxFiltro(f=>({...f,q:busquedaTop,tab:'TODOS'})); setTab('inbox')}}>
        <Search size={15}/>
        <input value={busquedaTop} onChange={e=>setBusquedaTop(e.target.value)} placeholder="Buscar correos, personas, temas…"/>
      </form>
      <div className="top-actions">
        <button
          className="gmail-pill"
          onClick={()=> gmailConectado ? handleSync() : session.firebase ? handleRealConnect({name:session.nombre, email:session.email}) : handleSync()}
          title={gmailConectado ? 'Sincronizar Gmail' : 'Conectar Gmail real'}
        >
          <Mail size={14}/>
          <span className="dot" style={{background:loading?'#f59e0b':(gmailConectado?'#18875F':session.firebase?'#2563eb':'#94a3b8')}}/>
          <span>{syncing?'Sincronizando…':gmailConectado?'Conectado':session.firebase?'Conectar Gmail':'Modo demo'}</span>
        </button>
        <button className="bell-btn" onClick={()=>{setTab('inbox'); setInboxFiltro(f=>({...f,tab:'URGENTES'}))}} title="Correos urgentes" aria-label="Notificaciones">
          <Bell size={17}/>
          {(stats.crit+stats.venc)>0 && <span className="bell-badge">{stats.crit+stats.venc}</span>}
        </button>
        <div className="user-menu">
          <button className="user-chip" onClick={()=>setMenuOpen(o=>!o)} aria-label="Cuenta" aria-expanded={menuOpen}>
            <span className="avatar">{iniciales(session.nombre)}</span>
            <span style={{textAlign:'left'}}>
              <span className="user-chip-name" style={{display:'block'}}>{session.nombre}</span>
              <span className="user-chip-role">{gmailConectado?'Gmail conectado':session.firebase?'Google':'Demostración'}</span>
            </span>
            <span style={{color:'var(--muted)',display:'flex'}}><ChevronDown size={14}/></span>
          </button>
          {menuOpen && (
            <div className="user-menu-pop">
              <div style={{fontWeight:800,fontSize:13,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{session.nombre}</div>
              <div style={{fontSize:12,color:'var(--muted)',margin:'2px 0 8px',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{session.email}</div>
              <Pill color={gmailConectado?'green':session.firebase?'blue':'gray'}>{gmailConectado?'Gmail real conectado':session.firebase?'Google — Gmail sin conectar':'Modo demostración'}</Pill>
              {session.firebase && !gmailConectado && (
                <button className="btn sm" style={{width:'100%',marginTop:8,justifyContent:'center'}} onClick={()=>handleRealConnect({name:session.nombre, email:session.email})}>Conectar mi Gmail real</button>
              )}
              <button className="btn sm ghost" style={{width:'100%',marginTop:8,justifyContent:'center'}} onClick={handleSync}>{syncing?'Sincronizando…':'🔄 Sincronizar ahora'}</button>
              <button className="btn sm ghost" style={{width:'100%',marginTop:8,justifyContent:'center'}} onClick={()=>setTheme(theme==='light'?'dark':'light')}>{theme==='light'?'🌙 Modo oscuro':'☀️ Modo claro'}</button>
              <button className="btn sm ghost" style={{width:'100%',marginTop:8,justifyContent:'center'}} onClick={handleLogout}>Cerrar sesión</button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
