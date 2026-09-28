import { Check, X, Loader2, Brain } from 'lucide-react'

// Un mensaje del chat de la secretaria, con las acciones que propone la IA
// (cada una se confirma o descarta con un botón — nunca se ejecutan solas).
export default function ChatMensaje({ m, onAccion }){
  return (
    <div className={`chat-msg chat-${m.de}`}>
      {String(m.texto || '').split('\n').map((l, j) => <div key={j}>{l || ' '}</div>)}
      {m.recordado?.length > 0 && (
        <div className="chat-recordado"><Brain size={11}/> Lo recordaré: {m.recordado.join(' · ')}</div>
      )}
      {m.acciones?.length > 0 && (
        <div className="chat-acciones">
          {m.acciones.map((a, i) => (
            <div key={i} className={`chat-accion ${a.estado}`}>
              <span className="chat-accion-texto">{a.descripcion}</span>
              {a.estado === 'pendiente' && (
                <span className="chat-accion-btns">
                  <button className="btn sm primary" onClick={() => onAccion(i, true)}><Check size={12}/> Sí, hazlo</button>
                  <button className="btn sm ghost" onClick={() => onAccion(i, false)} aria-label="Descartar"><X size={12}/></button>
                </span>
              )}
              {a.estado === 'ejecutando' && <span className="chat-accion-estado"><Loader2 size={12} className="spin"/> Haciéndolo…</span>}
              {a.estado === 'hecha' && <span className="chat-accion-estado ok">✓ {a.resultado || 'Hecho'}</span>}
              {a.estado === 'descartada' && <span className="chat-accion-estado">Descartado</span>}
              {a.estado === 'error' && <span className="chat-accion-estado err">⚠️ {a.resultado}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
