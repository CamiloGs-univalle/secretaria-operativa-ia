// Datos de DEMOSTRACIÓN — 100% ficticios, nunca correo real de nadie.
//
// Por qué existe este archivo: antes, el modo demostración (login con un
// nombre/correo inventado) terminaba mostrando el snapshot REAL del inbox de
// auxiliar.ti@proservis.com.co (ver gmailReal.json) — cualquiera podía
// "entrar en modo demostración" con datos falsos y ver nombres, correos y
// contenido real de la empresa. Esta función genera un inbox sintético con la
// misma forma que espera el motor (emailEngine.js / processGenerator.js),
// para que el dashboard de demo se vea completo y realista sin exponer nada
// real. Se usa solo cuando session.real es false — ver App.jsx.

const EMPRESA_DEMO = 'Grupo Andina Demo S.A.S.'

function iso(diasOffset, hora='14:00'){
  const d = new Date()
  d.setDate(d.getDate() + diasOffset)
  const [h,m] = hora.split(':')
  d.setHours(Number(h), Number(m), 0, 0)
  return d.toISOString()
}

export function generarCorreosDemo({ name = 'Persona Demo', email = 'demo@empresa-demo.com' } = {}){
  const primerNombre = (name || 'Demo').split(' ')[0]
  const yo = `${name} <${email}>`

  const plantillas = [
    {
      hilo:'d001', asunto:'URGENTE: bloqueo en certificación de proveedor', dias:0,
      de:'Laura Méndez <laura.mendez@proveedor-demo.com>',
      cuerpo:`Hola ${primerNombre},\n\nEsto es urgente — el proveedor no puede facturar hasta que enviemos la certificación firmada. ¿Podrías confirmar hoy mismo?\n\nGracias,\nLaura`
    },
    {
      hilo:'d002', asunto:'Inconveniente con el envío de equipos — Sede Cali', dias:0,
      de:'Andrés Rojas <andres.rojas@logistica-demo.com>',
      cuerpo:`Buenas,\n\nTuvimos un inconveniente con la transportadora y no fue posible entregar los equipos a tiempo. Estamos coordinando una nueva fecha, lamentamos el error.\n\nAndrés`
    },
    {
      hilo:'d003', asunto:'Solicitud: certificado laboral', dias:-1,
      de:'Carolina Vidal <carolina.vidal@rrhh-demo.com>',
      cuerpo:`Hola ${primerNombre}, por favor necesitamos que valides y aprobares el certificado laboral de un colaborador antes del viernes. Adjunto el formato.\n\nSaludos,\nCarolina`
    },
    {
      hilo:'d004', asunto:'Solicitud de aprobación — contratación auxiliar', dias:-1,
      de:'Marcela Ortiz <marcela.ortiz@rrhh-demo.com>',
      cuerpo:`${primerNombre}, ¿podrías confirmar la fecha de ingreso del nuevo auxiliar administrativo? Necesitamos tu aprobación para continuar con el proceso.\n\nMarcela`
    },
    {
      hilo:'d005', asunto:'Por favor enviar cotización actualizada', dias:-2,
      de:'Compras Demo <compras@interno-demo.com>',
      cuerpo:`Buen día, solicitamos enviar la cotización actualizada de insumos de oficina para aprobar el presupuesto del mes.\n\nGracias.`
    },
    {
      hilo:'d006', asunto:'Necesitamos confirmar asistencia a capacitación', dias:-2,
      de:'Bienestar Demo <bienestar@interno-demo.com>',
      cuerpo:`Hola, ¿podrías confirmar cuántas personas del equipo asistirán a la capacitación de pausas activas de este mes? Lo necesitamos para reservar el salón.`
    },
    {
      hilo:'d007', asunto:'No podemos entregarlo el jueves — reprogramar', dias:-1,
      de:'Diego Salazar <diego.salazar@proveedor-demo.com>',
      cuerpo:`Hola ${primerNombre}, no podemos entregarlo el jueves como quedamos, tenemos que reprogramar la entrega para el lunes. Quedamos atentos a tu confirmación.`
    },
    {
      hilo:'d008', asunto:'Cambiamos la fecha de la reunión de seguimiento', dias:-3,
      de:'Paola Gómez <paola.gomez@interno-demo.com>',
      cuerpo:`Buenas, cambiamos la fecha de la reunión para el miércoles a primera hora, mejor nos acomoda. ¿Te sirve?`
    },
    {
      hilo:'d009', asunto:'RE: Informe mensual de novedades', dias:-1,
      de:'Katherine Prada <katherine.prada@rrhh-demo.com>',
      cuerpo:`${primerNombre}, ya quedó listo el informe mensual de novedades, quedó corregido con las observaciones de la última revisión. Gracias por la paciencia.`
    },
    {
      hilo:'d010', asunto:'Proceso de auditoría interna finalizado', dias:-4,
      de:'Auditoría Demo <auditoria@interno-demo.com>',
      cuerpo:`Buen día, el proceso de auditoría interna del trimestre ya fue realizado y entregado al comité. Cualquier duda, quedamos atentos.`
    },
    {
      hilo:'d011', asunto:'Seguimiento: recordatorio de pendiente', dias:-3,
      de:'Julián Castro <julian.castro@proveedor-demo.com>',
      cuerpo:`Hola, quedamos pendientes de la respuesta sobre el contrato marco. Es un recordatorio amable, seguimos a la espera de tu confirmación.`
    },
    {
      hilo:'d012', asunto:'¿Cómo vamos con la renovación de la póliza?', dias:-5,
      de:'Sandra Beltrán <sandra.beltran@interno-demo.com>',
      cuerpo:`Hola ${primerNombre}, ¿cómo vamos con la renovación de la póliza? Seguimos pendientes de la respuesta de la aseguradora, cualquier novedad avísanos.`
    },
    {
      hilo:'d013', asunto:'Confirmamos recepción de documentos', dias:-6,
      de:'Recepción Demo <documentos@interno-demo.com>',
      cuerpo:`Confirmamos recepción de los documentos enviados el viernes. Gracias.`
    },
    {
      hilo:'d014', asunto:'Boletín mensual — novedades del sector', dias:-2,
      de:'Boletín Sectorial <newsletter@sector-demo.com>',
      cuerpo:`Este mes en el sector: nuevas regulaciones, eventos y capacitaciones disponibles. Descuentos especiales para asociados.`
    },
    {
      hilo:'d015', asunto:'Reunión de planeación — próxima semana', dias:-1,
      de:'Dirección Demo <direccion@interno-demo.com>',
      cuerpo:`Buen día equipo, agendamos la reunión de planeación para la próxima semana, comparto agenda preliminar. Confirmamos hora en los próximos días.`
    },
    {
      hilo:'d016', asunto:'Emergencia: sistema de nómina caído', dias:0,
      de:'Soporte Demo <soporte@interno-demo.com>',
      cuerpo:`${primerNombre}, es una emergencia — el sistema de nómina está caído y bloquea el pago de este mes. Necesitamos escalarlo de inmediato, es prioridad alta.`
    }
  ]

  return plantillas.map((p, i)=>({
    id: `demo-${p.hilo}-${i}`,
    hiloId: p.hilo,
    remitente: p.de,
    destinatarios: [yo],
    cc: [],
    asunto: p.asunto,
    fecha: iso(p.dias, `${9 + (i % 8)}:${(i*7)%60}`),
    cuerpo: p.cuerpo,
    etiquetas: ['INBOX'],
    adjuntos: []
  })).sort((a,b)=> new Date(b.fecha) - new Date(a.fecha))
}

export const DEMO_META = {
  empresa: EMPRESA_DEMO,
  note: 'Datos 100% ficticios generados localmente para el modo demostración — ningún dato real de Proservis.'
}
