// POST /api/sheets/sync — Google Sheets API (doc 29)
// Sheets = vista operativa, no BD principal
export default async function handler(req,res){
  // const sheets = google.sheets({ version:'v4', auth: oauth2Client })
  // await sheets.spreadsheets.values.update({ spreadsheetId: process.env.SHEETS_ID, range:'Procesos!A2', valueInputOption:'RAW', resource:{ values: rows }})
  // Apps Script para formatos/automatizaciones auxiliares (doc 35) — no cerebro principal
  return res.json({ ok:true, sheet:'https://docs.google.com/spreadsheets/d/XXXX', rows: req.body?.length||0 })
}
