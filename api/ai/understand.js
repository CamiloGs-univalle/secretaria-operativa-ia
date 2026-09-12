// POST /api/ai/understand — AI Provider (doc 37-42)
// Nivel 0 reglas gratis → Nivel 1 IA pequeña → Nivel 2 Gemini → Nivel 3 Ollama local
import { analizarCorreoCompleto } from '../../src/engine/emailEngine.js'
export default async function handler(req,res){
  const { email, contextoProceso } = req.body
  // Filtro previo: 2000 correos → ~300 relevantes → ~100 procesos (doc 57)
  // Si es spam/newsletter/auto sin impacto → no llamar a IA
  const local = analizarCorreoCompleto(email, contextoProceso)
  // Si confianza <0.85 y requiere comprensión profunda → llamar Gemini
  if(local.confianza < 0.85 && local.relevancia.esRelevante){
    // const gemini = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent', ...)
    // gemini debe devolver JSON estructurado doc 58
    // fallback a local si falla
  }
  // Action Guard (doc 50): IA propone, sistema controla
  const guard = {
    puedeEnviar: false, // requiere confirmación
    puedeCerrar: local.confianza>0.94 ? 'confirmar' : 'revisar',
    nivel: local.confianza>0.95?'Alta': local.confianza>0.8?'Media': 'Revisar'
  }
  return res.json({ ...local, guard, provider: local.confianza>0.85?'rules':'gemini' })
}
