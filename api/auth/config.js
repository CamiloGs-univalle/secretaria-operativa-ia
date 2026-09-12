// Le dice al frontend si ya está lista la conexión real con Google (vía
// Composio), sin exponer ningún secreto.
export default async function handler(req, res){
  res.status(200).json({
    composioConfigured: !!(process.env.COMPOSIO_API_KEY && process.env.COMPOSIO_GMAIL_AUTH_CONFIG_ID)
  })
}
