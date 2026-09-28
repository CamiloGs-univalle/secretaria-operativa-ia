import { useState } from 'react'
import { GraduationCap, User, Star, Tag, PenLine, ListChecks, X, Plus, RefreshCw, Trash2, Check } from 'lucide-react'

// Configuración → "Entrena a tu secretaria": todo lo que la persona le
// enseña para que la IA priorice, etiquete y redacte a SU manera.
const PLANTILLAS = [
  { t: 'Coordinación operativa', cargo: 'Coordinadora de operaciones', importante: 'Solicitudes de clientes, contrataciones, novedades de personal y todo lo que tenga fecha límite. Lo de gerencia siempre primero.' },
  { t: 'TI / Soporte', cargo: 'Auxiliar de TI', importante: 'Incidencias que bloquean a alguien, accesos y usuarios, compras de equipos y entregas de actas.' },
  { t: 'Talento humano', cargo: 'Analista de talento humano', importante: 'Certificados laborales, ingresos y retiros, nómina, incapacidades y documentos de contratación.' },
]

export default function EntrenamientoPanel({ entrenamiento: e, actualizar, agregarRegla, quitarRegla, guardado, iaActiva, onReanalizar, reanalizando, onProbar }){
  const set = (ruta, valor) => actualizar(x => { const n = structuredClone(x); const [a, b] = ruta.split('.'); if(b) n[a][b] = valor; else n[a] = valor; return n })
  const completitud = [e.perfil.cargo, e.perfil.importante, e.reglas.vip.length, e.reglas.palabrasClave.length, e.etiquetas.length, e.estilo.firma, e.instrucciones].filter(Boolean).length

  return (
    <div className="settings-section entrenamiento">
      <div className="settings-section-title" style={{justifyContent:'space-between'}}>
        <span style={{display:'flex',alignItems:'center',gap:8}}><GraduationCap size={15}/> Entrena a tu secretaria</span>
        <span className="entr-guardado">{guardado ? <><Check size={11}/> Guardado</> : 'Se guarda solo'}</span>
      </div>
      <p className="entr-intro">
        Lo que pongas aquí lo usa en cada respuesta, al revisar tu correo y al redactar borradores. Entre más le cuentes, más útil es.
        También aprende sola: cuando corriges la etiqueta de un correo en la Bandeja o le dices en el chat "de ahora en adelante…".
      </p>
      <div className="entr-progreso"><div style={{width:`${Math.round(completitud/7*100)}%`}}/></div>
      <small className="entr-muted">{completitud}/7 secciones con información{!iaActiva && ' · la IA está inactiva: se guardará igual para cuando la actives'}</small>

      <Bloque icono={User} titulo="Quién eres y qué te importa">
        {!e.perfil.cargo && !e.perfil.importante && (
          <div className="entr-plantillas">
            <span className="entr-muted">Empieza rápido:</span>
            {PLANTILLAS.map(p => <button key={p.t} className="btn sm ghost" onClick={() => actualizar(x => ({ ...x, perfil: { ...x.perfil, cargo: p.cargo, importante: p.importante } }))}>{p.t}</button>)}
          </div>
        )}
        <div className="entr-grid2">
          <label>Tu cargo<input className="input" value={e.perfil.cargo} onChange={ev => set('perfil.cargo', ev.target.value)} placeholder="Ej: Coordinadora de operaciones"/></label>
          <label>Área / equipo<input className="input" value={e.perfil.area} onChange={ev => set('perfil.area', ev.target.value)} placeholder="Ej: Operaciones sede Cali"/></label>
        </div>
        <label>¿Qué haces en tu día a día?<textarea className="input" rows={2} value={e.perfil.responsabilidades} onChange={ev => set('perfil.responsabilidades', ev.target.value)} placeholder="Ej: valido documentación de contratos, respondo a clientes, preparo el informe mensual de novedades…"/></label>
        <label>¿Qué es IMPORTANTE para ti?<textarea className="input" rows={3} value={e.perfil.importante} onChange={ev => set('perfil.importante', ev.target.value)} placeholder="Ej: todo lo que venga de gerencia o de clientes con contrato activo; lo que tenga fecha de vencimiento esta semana; nunca dejar sin respuesta a un colaborador más de 1 día."/></label>
      </Bloque>

      <Bloque icono={Star} titulo="Reglas de prioridad">
        <ListaChips titulo="Remitentes VIP" ayuda="Correos o dominios que siempre son importantes" tipo="vip" valores={e.reglas.vip} onAgregar={agregarRegla} onQuitar={quitarRegla} ejemplo="gerencia@proservis.com.co o @cliente.com" color="red"/>
        <ListaChips titulo="Temas importantes" ayuda="Palabras que suben la prioridad" tipo="palabrasClave" valores={e.reglas.palabrasClave} onAgregar={agregarRegla} onQuitar={quitarRegla} ejemplo="nómina, contrato, factura" color="orange"/>
        <ListaChips titulo="Ignorar" ayuda="Remitentes o palabras que no te importan" tipo="ignorar" valores={e.reglas.ignorar} onAgregar={agregarRegla} onQuitar={quitarRegla} ejemplo="newsletter, noreply@" color="gray"/>
      </Bloque>

      <Bloque icono={Tag} titulo="Tus etiquetas">
        <small className="entr-muted">Además de las básicas (Urgente, Requiere respuesta, Esperando respuesta, Falta información, Cerrado…). Dile cuándo usar cada una.</small>
        {e.etiquetas.map((t, i) => (
          <div key={i} className="entr-etiqueta">
            <input className="input" style={{maxWidth:170}} value={t.nombre} onChange={ev => actualizar(x => ({ ...x, etiquetas: x.etiquetas.map((y, j) => j === i ? { ...y, nombre: ev.target.value } : y) }))}/>
            <input className="input" value={t.descripcion} placeholder="Cuándo usarla…" onChange={ev => actualizar(x => ({ ...x, etiquetas: x.etiquetas.map((y, j) => j === i ? { ...y, descripcion: ev.target.value } : y) }))}/>
            <button className="btn sm ghost" aria-label="Quitar" onClick={() => actualizar(x => ({ ...x, etiquetas: x.etiquetas.filter((_, j) => j !== i) }))}><Trash2 size={12}/></button>
          </div>
        ))}
        <NuevaEtiqueta onAgregar={(nombre, descripcion) => actualizar(x => ({ ...x, etiquetas: [...x.etiquetas, { nombre, descripcion }] }))}/>
      </Bloque>

      <Bloque icono={PenLine} titulo="Cómo escribes">
        <div className="entr-grid2">
          <label>Tono
            <select className="input" value={e.estilo.tono} onChange={ev => set('estilo.tono', ev.target.value)}>
              {['cordial', 'formal', 'cercano', 'directo y breve'].map(o => <option key={o}>{o}</option>)}
            </select>
          </label>
          <label>Trato
            <select className="input" value={e.estilo.idioma} onChange={ev => set('estilo.idioma', ev.target.value)}>
              <option value="tú">Tutear (tú)</option><option value="usted">Usted</option>
            </select>
          </label>
        </div>
        <label>Firma para tus correos<textarea className="input" rows={3} value={e.estilo.firma} onChange={ev => set('estilo.firma', ev.target.value)} placeholder={'Cordialmente,\nAna Gómez\nCoordinadora de Operaciones — Proservis'}/></label>
      </Bloque>

      <Bloque icono={ListChecks} titulo="Instrucciones para tu secretaria">
        <textarea className="input" rows={4} value={e.instrucciones} onChange={ev => set('instrucciones', ev.target.value)}
          placeholder={'Escríbele como a una persona. Ej:\n- Si un proveedor manda una factura, recuérdame revisarla en 2 días.\n- Si alguien no responde en 3 días, propónme un seguimiento.\n- Los viernes dame un resumen de lo que quedó abierto.'}/>
      </Bloque>

      <Bloque icono={GraduationCap} titulo={`Lo que ha aprendido de tus correcciones (${e.ejemplos.length})`}>
        {!e.ejemplos.length && <small className="entr-muted">Aún nada. En la Bandeja, abre el menú ⋮ de un correo → "Corregir a la secretaria".</small>}
        {e.ejemplos.slice().reverse().slice(0, 8).map((x, i) => (
          <div key={i} className="memoria-row"><span><b>{x.asunto}</b> → {x.etiqueta || x.estado}{x.nota ? ` · ${x.nota}` : ''}</span><small>{x.fecha}</small>
            <button className="btn sm ghost" aria-label="Olvidar" onClick={() => actualizar(y => ({ ...y, ejemplos: y.ejemplos.filter(z => z !== x) }))}><X size={12}/></button></div>
        ))}
      </Bloque>

      {iaActiva && (
        <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:6}}>
          <button className="btn sm primary" disabled={reanalizando} onClick={onReanalizar}><RefreshCw size={13} className={reanalizando ? 'spin' : ''}/> {reanalizando ? 'Revisando…' : 'Volver a revisar mi correo con esto'}</button>
          <button className="btn sm" onClick={onProbar}>Preguntarle qué entendió</button>
        </div>
      )}
    </div>
  )
}

function Bloque({ icono: I, titulo, children }){
  return <div className="entr-bloque"><div className="entr-bloque-titulo"><I size={13}/> {titulo}</div>{children}</div>
}

function ListaChips({ titulo, ayuda, tipo, valores, onAgregar, onQuitar, ejemplo, color }){
  const [v, setV] = useState('')
  return (
    <div className="entr-chips-wrap">
      <div><b>{titulo}</b> <small className="entr-muted">— {ayuda}</small></div>
      <div className="entr-chips">
        {valores.map(x => <span key={x} className={`entr-chip ${color}`}>{x}<button onClick={() => onQuitar(tipo, x)} aria-label="Quitar"><X size={10}/></button></span>)}
        <form onSubmit={ev => { ev.preventDefault(); v.split(',').forEach(p => onAgregar(tipo, p)); setV('') }} style={{display:'flex',gap:4}}>
          <input className="input entr-chip-input" value={v} onChange={ev => setV(ev.target.value)} placeholder={ejemplo}/>
          <button className="btn sm" type="submit" disabled={!v.trim()}><Plus size={12}/></button>
        </form>
      </div>
    </div>
  )
}

function NuevaEtiqueta({ onAgregar }){
  const [n, setN] = useState(''), [d, setD] = useState('')
  return (
    <form className="entr-etiqueta" onSubmit={ev => { ev.preventDefault(); if(n.trim()){ onAgregar(n.trim(), d.trim()); setN(''); setD('') } }}>
      <input className="input" style={{maxWidth:170}} value={n} onChange={ev => setN(ev.target.value)} placeholder="Ej: Nómina"/>
      <input className="input" value={d} onChange={ev => setD(ev.target.value)} placeholder="Ej: pagos, desprendibles o novedades de nómina"/>
      <button className="btn sm" type="submit" disabled={!n.trim()}><Plus size={12}/> Agregar</button>
    </form>
  )
}
