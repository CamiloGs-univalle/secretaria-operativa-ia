import { useState, useEffect } from 'react'

// Archivados, configuración y recordatorios generales — persistidos por
// cuenta (session.email) en vez de globales, para que varias personas
// usando la misma app en el mismo navegador (demo) no se pisen el
// localStorage entre sí. Se cargan apenas se conoce el email de la sesión
// y se vuelven a guardar cada vez que cambian.
export function useConfiguracionPersistida(sessionEmail){
  const [archivados,setArchivados]=useState([]) // correos archivados — visibles en la pestaña Archivados, nunca se pierden
  const [configuracion,setConfiguracion]=useState(()=>{
    try{ return {intervencion:'normal', horarioInicio:'08:00', horarioFin:'18:00', avisoDiasVencePronto:2, avisoDiasSeguimiento:3, avisosActivos:true, ...JSON.parse(localStorage.getItem('mi_asistente_config')||'{}')} }
    catch{ return {intervencion:'normal', horarioInicio:'08:00', horarioFin:'18:00', avisoDiasVencePronto:2, avisoDiasSeguimiento:3} }
  })
  const [recordatoriosGenerales,setRecordatoriosGenerales]=useState([]) // "recuérdame X" que no calzó con ningún contacto/tarea existente

  useEffect(()=>{
    if(!sessionEmail) return
    try{ setArchivados(JSON.parse(localStorage.getItem(`mi_asistente_archivados_${sessionEmail}`)||'[]')) }catch{ setArchivados([]) }
    try{ setConfiguracion(c=>({...c, ...JSON.parse(localStorage.getItem(`mi_asistente_config_${sessionEmail}`)||'{}')})) }catch{}
    try{ setRecordatoriosGenerales(JSON.parse(localStorage.getItem(`mi_asistente_recordatorios_${sessionEmail}`)||'[]')) }catch{ setRecordatoriosGenerales([]) }
  },[sessionEmail])
  useEffect(()=>{
    if(!sessionEmail) return
    try{ localStorage.setItem(`mi_asistente_archivados_${sessionEmail}`, JSON.stringify(archivados.slice(0,300))) }catch{}
  },[archivados,sessionEmail])
  useEffect(()=>{
    if(!sessionEmail) return
    try{ localStorage.setItem(`mi_asistente_config_${sessionEmail}`, JSON.stringify(configuracion)) }catch{}
  },[configuracion,sessionEmail])
  useEffect(()=>{
    if(!sessionEmail) return
    try{ localStorage.setItem(`mi_asistente_recordatorios_${sessionEmail}`, JSON.stringify(recordatoriosGenerales.slice(0,200))) }catch{}
  },[recordatoriosGenerales,sessionEmail])

  return { archivados, setArchivados, configuracion, setConfiguracion, recordatoriosGenerales, setRecordatoriosGenerales }
}
