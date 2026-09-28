import { useState, useEffect, useMemo } from 'react'
import { Sparkles, UserRound, Star, Brain, Bell, Plug, ShieldCheck, Mail, Calendar, MessageSquare, Check, ChevronRight, RefreshCw, X, Plus, Moon, Sun, Download, Trash2, Wand2, FlaskConical, Minus } from 'lucide-react'
import Switch from '../ui/Switch.jsx'
import { SeccionPerfil, SeccionEstilo, SeccionInstrucciones, ListaChips, SeccionEtiquetas } from './Entrenamiento.jsx'
import { evaluarReglas } from '../../hooks/useEntrenamientoIA.js'
import { diagnosticoCalendar } from '../../services/calendarService.js'
import { limpiarDatosDeEjemploFirestore, getAuditLog } from '../../data/mockFirebase.js'

// Configuración rediseñada: un "héroe" que dice qué tan lista está tu
// secretaria y qué falta, y pestañas cortas por tema en vez de una lista
// larga de ajustes. Todo lo que se cambia se guarda solo.
const PESTANAS = [
  { k: 'secretaria', l: 'Mi secretaria', i: Sparkles },
  { k: 'conoceme', l: 'Conóceme', i: UserRound },
  { k: 'prioridades', l: 'Prioridades', i: Star },
  { k: 'memoria', l: 'Memoria', i: Brain },
  { k: 'avisos', l: 'Avisos', i: Bell },
  { k: 'conexiones', l: 'Conexiones', i: Plug },
  { k: 'datos', l: 'Datos', i: ShieldCheck },
]

export default function ConfiguracionView(props){
  const { session, ia, gmailConectado, gcal, entrenamiento: e, memoria, entrenamientoGuardado } = props
  const clave = `mi_asistente_cfg_tab_${session.email}`
  const [tab, setTab] = useState(() => { try{ return localStorage.getItem(clave) || 'secretaria' }catch{ return 'secretaria' } })
  useEffect(() => { try{ localStorage.setItem(clave, tab) }catch{} }, [tab, clave])

  // Pasos para que la secretaria sea realmente útil (con a dónde ir).
  const pasos = useMemo(() => [
    { ok: !!ia.configured, t: 'IA activa', ir: 'conexiones' },
    { ok: !!gmailConectado, t: 'Gmail conectado', ir: 'conexiones' },
    { ok: !!gcal.connected, t: 'Calendar conectado', ir: 'conexiones' },
    { ok: !!(e.perfil.cargo && e.perfil.importante), t: 'Contarle qué es importante', ir: 'conoceme' },
    { ok: e.reglas.vip.length + e.reglas.palabrasClave.length > 0, t: 'Definir prioridades', ir: 'prioridades' },
    { ok: !!e.estilo.firma, t: 'Poner tu firma', ir: 'conoceme' },
    { ok: e.etiquetas.length > 0, t: 'Crear una etiqueta propia', ir: 'prioridades' },
  ], [ia.configured, gmailConectado, gcal.connected, e])
  const hechos = pasos.filter(p => p.ok).length
  const pct = Math.round(hechos / pasos.length * 100)
  const siguiente = pasos.find(p => !p.ok)
  const nombre = (session.nombre || '').split(' ')[0]

  return (
    <div className="cfg">
      <section className="cfg-hero">
        <div className="cfg-anillo" style={{ '--p': pct }}><span>{pct}%</span></div>
        <div className="cfg-hero-texto">
          <h2>{pct === 100 ? `¡Tu secretaria te conoce muy bien${nombre ? `, ${nombre}` : ''}! 🎉` : `Tu secretaria está lista al ${pct}%`}</h2>
          <p>{siguiente ? <>Siguiente paso: <button className="cfg-link" onClick={() => setTab(siguiente.ir)}>{siguiente.t} <ChevronRight size={13}/></button></> : 'Sigue corrigiéndola en la Bandeja cuando se equivoque: así aprende.'}</p>
          <div className="cfg-pasos">{pasos.map(p => <button key={p.t} className={p.ok ? 'ok' : ''} onClick={() => setTab(p.ir)}>{p.ok ? <Check size={11}/> : <span className="cfg-punto"/>} {p.t}</button>)}</div>
        </div>
        <div className="cfg-guardado">{entrenamientoGuardado ? <><Check size={11}/> Guardado</> : 'Todo se guarda solo'}</div>
      </section>

      <nav className="cfg-tabs" role="tablist">
        {PESTANAS.map(p => { const I = p.i; return (
          <button key={p.k} role="tab" aria-selected={tab === p.k} className={tab === p.k ? 'on' : ''} onClick={() => setTab(p.k)}><I size={15}/> <span>{p.l}</span></button>
        ) })}
      </nav>

      <div className="cfg-panel" key={tab}>
        {tab === 'secretaria' && <PanelSecretaria {...props} irA={setTab}/>}
        {tab === 'conoceme' && <PanelConoceme {...props}/>}
        {tab === 'prioridades' && <PanelPrioridades {...props}/>}
        {tab === 'memoria' && <PanelMemoria {...props}/>}
        {tab === 'avisos' && <PanelAvisos {...props}/>}
        {tab === 'conexiones' && <PanelConexiones {...props}/>}
        {tab === 'datos' && <PanelDatos {...props}/>}
      </div>
    </div>
  )
}

function Tarjeta({ titulo, subtitulo, icono, children, accion }){
  return (
    <div className="cfg-card">
      {(titulo || accion) && <div className="cfg-card-head"><div>{titulo && <h3>{icono} {titulo}</h3>}{subtitulo && <p>{subtitulo}</p>}</div>{accion}</div>}
      {children}
    </div>
  )
}

function Estado({ ok, parcial, texto }){
  return <span className={`cfg-estado ${ok ? 'ok' : parcial ? 'parcial' : 'no'}`}><span/>{texto}</span>
}

// ---------- Mi secretaria ----------
function PanelSecretaria({ ia, gmailConectado, gcal, configuracion, setConfiguracion, clasificando, reanalizarTodo, onProbar, probarIA, confianzaProm, irA }){
  const niveles = [
    { k: 'minimo', e: '🤫', t: 'Discreta', d: 'Solo me avisa lo urgente.' },
    { k: 'normal', e: '🙂', t: 'Equilibrada', d: 'Avisa y sugiere sin insistir.' },
    { k: 'proactivo', e: '🚀', t: 'Proactiva', d: 'Me recuerda seguido y propone respuestas.' },
  ]
  return (
    <>
      <div className="cfg-estados">
        <button className="cfg-estado-tile" onClick={() => irA('conexiones')}><Sparkles size={18}/><b>Inteligencia (Gemini)</b><Estado ok={ia.configured} texto={ia.configured ? 'Activa' : 'Inactiva'}/></button>
        <button className="cfg-estado-tile" onClick={() => irA('conexiones')}><Mail size={18}/><b>Gmail</b><Estado ok={gmailConectado} texto={gmailConectado ? 'Conectado' : 'Sin conectar'}/></button>
        <button className="cfg-estado-tile" onClick={() => irA('conexiones')}><Calendar size={18}/><b>Google Calendar</b><Estado ok={gcal.connected} texto={gcal.connected ? 'Conectado' : 'Sin conectar'}/></button>
      </div>

      <Tarjeta titulo="¿Cómo quieres que sea contigo?" icono="💬">
        <div className="cfg-niveles">
          {niveles.map(n => (
            <button key={n.k} className={configuracion.intervencion === n.k ? 'on' : ''} onClick={() => setConfiguracion(c => ({ ...c, intervencion: n.k }))}>
              <span className="cfg-nivel-emoji">{n.e}</span><b>{n.t}</b><small>{n.d}</small>{configuracion.intervencion === n.k && <Check size={14} className="cfg-nivel-check"/>}
            </button>
          ))}
        </div>
      </Tarjeta>

      <Tarjeta titulo="Lo que hace sola con tu correo" icono="🤖">
        <Fila titulo="Revisar mi correo automáticamente" texto="Etiqueta cada conversación, detecta si ya se cerró, si falta algo o a quién le toca, y actualiza tus tareas.">
          <Switch checked={configuracion.clasificacionIA !== false} onChange={v => setConfiguracion(c => ({ ...c, clasificacionIA: v }))}/>
        </Fila>
        <Fila titulo="Poner las etiquetas también en Gmail" texto={`Crea etiquetas "Mi Asistente/…" en tu Gmail real${!gmailConectado ? ' (requiere Gmail conectado)' : ''}.`}>
          <Switch checked={!!configuracion.etiquetarGmail} onChange={v => setConfiguracion(c => ({ ...c, etiquetarGmail: v }))}/>
        </Fila>
        <div className="cfg-acciones">
          <button className="btn sm primary" disabled={!ia.configured || clasificando} onClick={reanalizarTodo}><RefreshCw size={13} className={clasificando ? 'spin' : ''}/> {clasificando ? 'Revisando…' : 'Revisar mi correo ahora'}</button>
          <button className="btn sm" disabled={!ia.configured} onClick={onProbar}><Wand2 size={13}/> Preguntarle qué sabe de mí</button>
          <button className="btn sm ghost" disabled={!ia.configured} onClick={probarIA}><FlaskConical size={13}/> Probar conexión</button>
        </div>
        {confianzaProm != null && <div className="cfg-nota">Confianza promedio al clasificar: <b>{confianzaProm}%</b></div>}
      </Tarjeta>
    </>
  )
}

function Fila({ titulo, texto, children }){
  return <div className="cfg-fila"><div><b>{titulo}</b>{texto && <span>{texto}</span>}</div>{children}</div>
}

// ---------- Conóceme ----------
function PanelConoceme({ entrenamiento: e, actualizarEntrenamiento }){
  return (
    <>
      <Tarjeta titulo="Quién eres y qué te importa" icono="🙋" subtitulo="Con esto decide qué te muestra primero y cómo te habla.">
        <SeccionPerfil e={e} actualizar={actualizarEntrenamiento}/>
      </Tarjeta>
      <Tarjeta titulo="Cómo escribes" icono="✍️" subtitulo="Los borradores que te prepare saldrán con tu tono y tu firma.">
        <SeccionEstilo e={e} actualizar={actualizarEntrenamiento}/>
      </Tarjeta>
      <Tarjeta titulo="Instrucciones para tu secretaria" icono="📝" subtitulo="Escríbele como a una persona. Las sigue en el chat y al revisar tu correo.">
        <SeccionInstrucciones e={e} actualizar={actualizarEntrenamiento}/>
      </Tarjeta>
    </>
  )
}

// ---------- Prioridades ----------
function PanelPrioridades({ entrenamiento: e, actualizarEntrenamiento, agregarRegla, quitarRegla }){
  const [prueba, setPrueba] = useState({ de: '', asunto: '' })
  const r = (prueba.de || prueba.asunto) ? evaluarReglas(e, { remitente: prueba.de, asunto: prueba.asunto }) : null
  const veredicto = !r ? null : r.vip ? { c: 'red', t: '🔴 Importante: es un remitente VIP' } : r.ignorar ? { c: 'gray', t: '⚪ Lo tratará como informativo (está en "Ignorar")' } : r.clave ? { c: 'orange', t: `🟠 Subirá la prioridad: menciona "${r.clave}"` } : { c: 'blue', t: '🔵 Sin regla especial: decide la IA según lo que le contaste' }
  return (
    <>
      <div className="cfg-reglas">
        <ListaChips titulo="Siempre importante" ayuda="Personas o dominios VIP" icono="🔴" tipo="vip" valores={e.reglas.vip} onAgregar={agregarRegla} onQuitar={quitarRegla} ejemplo="gerencia@proservis.com.co o @cliente.com" color="red"/>
        <ListaChips titulo="Temas importantes" ayuda="Palabras que suben la prioridad" icono="🟠" tipo="palabrasClave" valores={e.reglas.palabrasClave} onAgregar={agregarRegla} onQuitar={quitarRegla} ejemplo="nómina, contrato, factura" color="orange"/>
        <ListaChips titulo="Ignorar" ayuda="Lo que no te importa" icono="⚪" tipo="ignorar" valores={e.reglas.ignorar} onAgregar={agregarRegla} onQuitar={quitarRegla} ejemplo="newsletter, noreply@" color="gray"/>
      </div>
      <Tarjeta titulo="Probador de reglas" icono="🧪" subtitulo="Escribe un remitente o asunto y mira cómo lo trataría.">
        <div className="cfg-grid2">
          <input className="input" value={prueba.de} onChange={ev => setPrueba(p => ({ ...p, de: ev.target.value }))} placeholder="De: juan@cliente.com"/>
          <input className="input" value={prueba.asunto} onChange={ev => setPrueba(p => ({ ...p, asunto: ev.target.value }))} placeholder="Asunto: Novedad de nómina septiembre"/>
        </div>
        {veredicto && <div className={`cfg-veredicto ${veredicto.c}`}>{veredicto.t}</div>}
      </Tarjeta>
      <Tarjeta titulo="Tus etiquetas" icono="🏷️" subtitulo="La secretaria las pone en tus correos cuando apliquen.">
        <SeccionEtiquetas e={e} actualizar={actualizarEntrenamiento}/>
      </Tarjeta>
    </>
  )
}

// ---------- Memoria ----------
function PanelMemoria({ memoria, recordar, olvidar, entrenamiento: e, actualizarEntrenamiento }){
  return (
    <>
      <Tarjeta titulo="Lo que recuerda de ti" icono="🧠" subtitulo='Díselo en el chat ("recuerda que Juan es el de compras") o agrégalo aquí.'>
        <form className="cfg-nueva-memoria" onSubmit={ev => { ev.preventDefault(); const v = ev.target.elements.nuevo.value.trim(); if(v){ recordar(v); ev.target.reset() } }}>
          <input name="nuevo" className="input" placeholder="Ej: Mi jefa es Marta Ruiz y prefiere reportes los lunes"/>
          <button className="btn sm primary" type="submit"><Plus size={13}/> Recordar</button>
        </form>
        <div className="cfg-notas">
          {!memoria.length && <div className="cfg-vacio-grande">🗒️ Todavía no recuerda nada.</div>}
          {memoria.slice().reverse().map((m, i) => (
            <div key={i} className="cfg-nota-pegada"><p>{m.texto}</p><small>{m.fecha}</small><button aria-label="Olvidar" onClick={() => olvidar(m.texto)}><X size={12}/></button></div>
          ))}
        </div>
      </Tarjeta>
      <Tarjeta titulo={`Aprendido de tus correcciones (${e.ejemplos.length})`} icono="🎓" subtitulo='En la Bandeja, menú ⋮ de un correo → "Corregir a la secretaria".'>
        {!e.ejemplos.length && <div className="cfg-vacio-grande">Aún no la has corregido.</div>}
        {e.ejemplos.slice().reverse().slice(0, 12).map((x, i) => (
          <div key={i} className="cfg-fila compacta"><div><b>{x.asunto}</b><span>→ {x.etiqueta || x.estado}{x.nota ? ` · ${x.nota}` : ''} · {x.fecha}</span></div>
            <button className="btn sm ghost" aria-label="Olvidar" onClick={() => actualizarEntrenamiento(y => ({ ...y, ejemplos: y.ejemplos.filter(z => z !== x) }))}><X size={12}/></button></div>
        ))}
      </Tarjeta>
    </>
  )
}

// ---------- Avisos ----------
function Stepper({ valor, min, max, onChange, disabled, sufijo }){
  return (
    <div className={`cfg-stepper ${disabled ? 'off' : ''}`}>
      <button disabled={disabled || valor <= min} onClick={() => onChange(valor - 1)}><Minus size={12}/></button>
      <span>{valor} {sufijo}</span>
      <button disabled={disabled || valor >= max} onClick={() => onChange(valor + 1)}><Plus size={12}/></button>
    </div>
  )
}
function PanelAvisos({ configuracion: c, setConfiguracion, theme, setTheme }){
  const set = (k, v) => setConfiguracion(x => ({ ...x, [k]: v }))
  return (
    <>
      <Tarjeta titulo="Tu horario" icono="🕗" subtitulo="Fuera de este horario no te interrumpe.">
        <div className="cfg-horario">
          <label>Empiezo<input className="input" type="time" value={c.horarioInicio} onChange={ev => set('horarioInicio', ev.target.value)}/></label>
          <div className="cfg-horario-barra"><span/></div>
          <label>Termino<input className="input" type="time" value={c.horarioFin} onChange={ev => set('horarioFin', ev.target.value)}/></label>
        </div>
      </Tarjeta>
      <Tarjeta titulo="Avisos" icono="🔔" accion={<Switch checked={c.avisosActivos !== false} onChange={v => set('avisosActivos', v)}/>}>
        <Fila titulo='🟡 "Vence pronto"' texto="Avísame antes de que algo se venza.">
          <Stepper valor={c.avisoDiasVencePronto} min={1} max={7} sufijo="días antes" disabled={c.avisosActivos === false} onChange={v => set('avisoDiasVencePronto', v)}/>
        </Fila>
        <Fila titulo='🟣 "Sin respuesta"' texto="Avísame si alguien no me contesta.">
          <Stepper valor={c.avisoDiasSeguimiento} min={1} max={14} sufijo="días" disabled={c.avisosActivos === false} onChange={v => set('avisoDiasSeguimiento', v)}/>
        </Fila>
      </Tarjeta>
      <Tarjeta titulo="Apariencia" icono="🎨">
        <div className="cfg-temas">
          <button className={theme !== 'dark' ? 'on' : ''} onClick={() => setTheme('light')}><Sun size={16}/> Claro</button>
          <button className={theme === 'dark' ? 'on' : ''} onClick={() => setTheme('dark')}><Moon size={16}/> Oscuro</button>
        </div>
      </Tarjeta>
    </>
  )
}

// ---------- Conexiones ----------
function PanelConexiones({ session, ia, probarIA, gmailConectado, handleRealConnect, gcal, conectarCalendar, desconectarCalendar, showToast }){
  const [diag, setDiag] = useState(null)
  const calTexto = gcal.connected ? 'Tus reuniones aparecen en Calendario y puedes enviarle vencimientos.' : !session.real ? 'No disponible en modo demostración.' : !gcal.configured ? 'Falta configurarlo en el servidor (COMPOSIO_GCAL_AUTH_CONFIG_ID).' : !gcal.gmail ? 'Primero conecta tu Gmail.' : 'Conéctalo para ver tus reuniones junto a tus tareas.'
  return (
    <>
      <div className="cfg-conexiones">
        <div className={`cfg-conexion ${ia.configured ? 'ok' : ''}`}>
          <div className="cfg-conexion-logo ia"><Sparkles size={20}/></div>
          <b>Gemini (IA)</b><p>{ia.configured ? 'Responde lo que sea, recuerda y revisa tu correo.' : !session.real ? 'No disponible en modo demostración.' : 'Falta GEMINI_API_KEY en Vercel.'}</p>
          <Estado ok={ia.configured} texto={ia.configured ? 'Activa' : 'Inactiva'}/>
          {ia.configured && <button className="btn sm ghost" onClick={probarIA}>Probar</button>}
        </div>
        <div className={`cfg-conexion ${gmailConectado ? 'ok' : ''}`}>
          <div className="cfg-conexion-logo gmail"><Mail size={20}/></div>
          <b>Gmail</b><p>{gmailConectado ? `Conectado como ${session.email}` : session.firebase ? 'Sesión de Google lista; falta conectar Gmail.' : 'Modo demostración.'}</p>
          <Estado ok={gmailConectado} texto={gmailConectado ? 'Conectado' : 'Sin conectar'}/>
          {!gmailConectado && session.firebase && <button className="btn sm primary" onClick={() => handleRealConnect({ name: session.nombre, email: session.email })}>Conectar</button>}
        </div>
        <div className={`cfg-conexion ${gcal.connected ? 'ok' : ''}`}>
          <div className="cfg-conexion-logo cal"><Calendar size={20}/></div>
          <b>Google Calendar</b><p>{calTexto}</p>
          <Estado ok={gcal.connected} texto={gcal.connected ? 'Conectado' : 'Sin conectar'}/>
          <div className="cfg-conexion-btns">
            {gcal.connected ? <>
              <button className="btn sm ghost" onClick={async () => { setDiag({ cargando: true }); try{ setDiag(await diagnosticoCalendar()) }catch(err){ setDiag({ error: err.message }) } }}>Diagnosticar</button>
              <button className="btn sm ghost" onClick={desconectarCalendar}>Desconectar</button>
            </> : gcal.configured && gcal.gmail && <button className="btn sm primary" onClick={conectarCalendar}>Conectar</button>}
          </div>
        </div>
        <div className="cfg-conexion pronto">
          <div className="cfg-conexion-logo slack"><MessageSquare size={20}/></div>
          <b>Slack</b><p>Todavía no existe esta integración.</p>
          <Estado texto="Próximamente"/>
        </div>
      </div>
      {diag && (
        <div className="diag-box">
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8}}>
            <b>{diag.cargando ? 'Diagnosticando Google Calendar…' : (diag.conclusion || diag.error)}</b>
            <span style={{display:'flex',gap:4}}>
              {!diag.cargando && <button className="btn sm" onClick={() => { navigator.clipboard?.writeText(JSON.stringify(diag, null, 2)); showToast('📋 Diagnóstico copiado') }}>Copiar</button>}
              <button className="btn sm ghost" onClick={() => setDiag(null)}><X size={12}/></button>
            </span>
          </div>
          {!diag.cargando && <pre>{JSON.stringify(diag, null, 2)}</pre>}
        </div>
      )}
      <div className="cfg-nota">Nada se muestra "Conectado" sin estarlo de verdad.</div>
    </>
  )
}

// ---------- Datos ----------
const ETIQUETAS_AUDIT = {
  sync_gmail: '🔄 Sincronizó Gmail', enviar_respuesta: '✉️ Envió una respuesta', enviar_respuesta_error: '⚠️ Falló un envío', reenvio: '↪️ Preparó un reenvío',
  proceso_listo: '✅ Marcó una tarea lista', exportar_csv: '⬇️ Descargó tareas en Excel', sheets_sync: '↗️ Sincronizó a Sheets', tarea_manual_creada: '📝 Creó una tarea',
  ia_clasificacion: '✨ La secretaria revisó el correo', ia_correccion: '🎓 Corrigió a la secretaria', calendar_evento_creado: '📅 Agendó en Calendar',
}
function PanelDatos({ session, exportarCSV, procesos, showToast }){
  const log = getAuditLog()
  return (
    <>
      <div className="cfg-estados">
        <button className="cfg-estado-tile" onClick={() => exportarCSV(procesos)}><Download size={18}/><b>Descargar mis tareas</b><small>Excel / Google Sheets</small></button>
        <div className="cfg-estado-tile"><ShieldCheck size={18}/><b>Solo tú ves lo tuyo</b><small>Aislado por cuenta ({session.email})</small></div>
        {session.firebase && <button className="cfg-estado-tile" onClick={async () => { const r = await limpiarDatosDeEjemploFirestore(); showToast(r.ok ? `🧹 Datos de ejemplo eliminados (${r.borrados})` : '⚠️ ' + (r.razon || 'No se pudo limpiar')) }}><Trash2 size={18}/><b>Limpiar datos de ejemplo</b><small>Si quedaron en Firestore</small></button>}
      </div>
      <Tarjeta titulo="Historial" icono="📜" subtitulo="Nada se envía ni se cierra sin que quede aquí.">
        {!log.length && <div className="cfg-vacio-grande">Aún no hay acciones registradas.</div>}
        <div className="cfg-timeline">
          {log.slice(0, 20).map((r, i) => (
            <div key={i} className="cfg-timeline-item">
              <span className="cfg-timeline-punto"/>
              <div><b>{ETIQUETAS_AUDIT[r.accion] || r.accion}</b>
                <span>{[r.to && `a ${String(r.to).split('<')[0].trim()}`, r.subject && `"${String(r.subject).slice(0, 60)}"`, r.proceso, r.hilos && `${r.hilos} conversaciones`].filter(Boolean).join(' · ')}</span>
                <small>{new Date(r.fecha).toLocaleString('es-CO')} · {r.usuario}</small></div>
            </div>
          ))}
        </div>
      </Tarjeta>
    </>
  )
}
