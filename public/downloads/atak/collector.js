// Agente PS — coletor genérico ATAK/Frigosoft (SQL Server) → nuvem PS.
// MESMO pacote pra qualquer frigorífico: só o .env muda (config gerada na tela de Conectores).
// Roda DENTRO da rede do cliente (acesso ao SQL Server). A SENHA do SQL fica só aqui, no .env local
// (Pilar 2 — nunca trafega pro nosso backend). A identidade do agente é o AGENTE_TOKEN.
//
// A cada ciclo: (1) heartbeat "iniciando" → (2) lê os domínios ATIVOS do mapa na nuvem (config-driven,
// fn_atak_mapa_coletor) → (3) coleta cada domínio do SQL Server → (4) envia pra ingestão → (5) heartbeat
// "sucesso" (ou "falha" com o erro). O monitor da empresa (semáforo) reflete esse heartbeat em tempo real.
//
// Instalação: veja INSTALACAO.md. Requisitos: Node.js 18+ e `npm install` (mssql).
const sql = require('mssql')
const os = require('os')
const crypto = require('crypto')

const COLLECTOR_VERSION = 'agente-ps-1.0'

const {
  SUPABASE_URL, SUPABASE_ANON_KEY, AGENTE_TOKEN,
  ATAK_COMPANY_ID,
  ATAK_HOST, ATAK_PORTA = '1433', ATAK_BANCO, ATAK_USUARIO, ATAK_SENHA,
  ATAK_COD_FILIAL = '100', DOMINIOS = '',
  INGEST_URL = '', BATCH_SIZE = '500', ATAK_CARGA_DESDE = '',
} = process.env

const HOSTNAME = os.hostname()
const faltando = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'AGENTE_TOKEN', 'ATAK_HOST', 'ATAK_BANCO', 'ATAK_USUARIO']
  .filter((k) => !process.env[k])
if (faltando.length) { console.error('[ATAK] Faltam no .env: ' + faltando.join(', ')); process.exit(2) }
if (!ATAK_SENHA) console.warn('[ATAK] ATAK_SENHA vazia no .env — o TI precisa preencher a senha do SQL Server.')

const sqlConfig = {
  server: ATAK_HOST, port: Number(ATAK_PORTA), database: ATAK_BANCO,
  user: ATAK_USUARIO, password: ATAK_SENHA,
  options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true },
  requestTimeout: 120000,
}

// ── Heartbeat (telemetria de saúde) → fn_atak_heartbeat (autenticado pelo token). Nunca derruba o ciclo. ──
async function heartbeat(fase, extra) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/fn_atak_heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
      body: JSON.stringify({
        p_token: AGENTE_TOKEN, p_fase: fase, p_host: HOSTNAME, p_versao: COLLECTOR_VERSION,
        p_dominio: (extra && extra.dominio) || null, p_gravados: (extra && extra.gravados) ?? null,
        p_duracao_ms: (extra && extra.duracao_ms) ?? null, p_erro: (extra && extra.erro) || null,
      }),
    })
  } catch (e) { console.error('[ATAK] heartbeat falhou (ignorado):', e.message) }
}

// Lê o MAPA de domínios ativos da nuvem PS (fn_atak_mapa_coletor). Cada item:
// { dominio, tabela_origem, chave_fato_sql, coluna_watermark, watermark }.
async function lerMapa() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/fn_atak_mapa_coletor`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    body: JSON.stringify({ p_company_id: ATAK_COMPANY_ID }),
  })
  const txt = await res.text()
  if (!res.ok) throw new Error(`mapa ${res.status}: ${txt}`)
  const cfg = txt ? JSON.parse(txt) : null
  const todos = Array.isArray(cfg && cfg.dominios) ? cfg.dominios : []
  // filtro pelos domínios marcados na tela (DOMINIOS do .env); vazio = todos os ativos do mapa
  const marcados = DOMINIOS.split(',').map((s) => s.trim()).filter(Boolean)
  return marcados.length ? todos.filter((d) => marcados.includes(d.dominio)) : todos
}

function clean(rows) {
  return rows.map((r) => { const o = {}; for (const k of Object.keys(r)) { let v = r[k]; if (typeof v === 'string') v = v.trim(); o[k] = v === '' ? null : v } return o })
}

async function postBatch(registros, dominio) {
  if (!INGEST_URL) return 'sem INGEST_URL (só heartbeat)'
  const res = await fetch(INGEST_URL, {
    method: 'POST',
    // token do agente identifica a empresa na ingestão (Pilar 2 — sem segredo compartilhado no pacote).
    headers: { 'Content-Type': 'application/json', 'x-agente-token': AGENTE_TOKEN },
    body: JSON.stringify({ registros, collector_version: COLLECTOR_VERSION, hostname: HOSTNAME, dominio }),
  })
  const txt = await res.text()
  if (!res.ok) throw new Error(`Ingest ${res.status}: ${txt}`)
  return txt
}

async function enviarLotes(rows, dominio) {
  const size = Number(BATCH_SIZE); let enviados = 0
  for (let i = 0; i < rows.length; i += size) {
    const lote = rows.slice(i, i + size)
    await postBatch(lote, dominio); enviados += lote.length
    console.log(`[ATAK][${dominio}] lote ${Math.floor(i / size) + 1}: +${lote.length} (${enviados}/${rows.length})`)
  }
  return enviados
}

async function coletarDominio(pool, dom) {
  const wmCol = dom.coluna_watermark
  const hasWm = wmCol && !String(wmCol).startsWith('REVISAR')
  const incremental = hasWm && dom.watermark != null
  const piso = hasWm && dom.watermark == null && ATAK_CARGA_DESDE
  let where = ''
  if (incremental) where = ` WHERE [${wmCol}] > @ultimo`
  else if (piso) where = ` WHERE [${wmCol}] >= @desde`
  const hashRow = !dom.chave_fato_sql || String(dom.chave_fato_sql).trim().toUpperCase() === 'HASH_ROW'
  const query = hashRow ? `SELECT * FROM ${dom.tabela_origem}${where}` : `SELECT *, (${dom.chave_fato_sql}) AS __chave_fato FROM ${dom.tabela_origem}${where}`
  const req = pool.request()
  if (incremental) req.input('ultimo', sql.NVarChar, String(dom.watermark))
  else if (piso) req.input('desde', sql.NVarChar, String(ATAK_CARGA_DESDE))
  const rows = clean((await req.query(query)).recordset)
  const registros = []
  for (const row of rows) {
    let chave
    if (hashRow) chave = crypto.createHash('sha256').update(JSON.stringify(row, Object.keys(row).sort())).digest('hex')
    else { chave = row.__chave_fato; delete row.__chave_fato }
    if (chave == null || String(chave).trim() === '') continue
    registros.push({ cod_filial: String(ATAK_COD_FILIAL), chave_fato: String(chave).trim(), raw: row })
  }
  console.log(`[ATAK][${dom.dominio}] ${registros.length} registros ${incremental ? '(incremental)' : piso ? '(1ª carga)' : '(FULL)'}.`)
  if (registros.length) await enviarLotes(registros, dom.dominio)
  return registros.length
}

async function main() {
  const t0 = Date.now()
  await heartbeat('iniciando')
  let gravados = 0; let ultimoDominio = null
  try {
    console.log(`[ATAK] Conectando ${ATAK_HOST}:${ATAK_PORTA}/${ATAK_BANCO} ...`)
    const pool = await sql.connect(sqlConfig)
    const dominios = await lerMapa()
    if (!dominios.length) console.log('[ATAK] nenhum domínio ativo/marcado no mapa.')
    for (const dom of dominios) {
      ultimoDominio = dom.dominio
      try { gravados += await coletarDominio(pool, dom) }
      catch (e) { console.error(`[ATAK][${dom.dominio}] ERRO:`, e.message) } // um domínio não derruba os outros
    }
    await pool.close()
    await heartbeat('sucesso', { gravados, dominio: ultimoDominio, duracao_ms: Date.now() - t0 })
    console.log(`[ATAK] Concluído em ${((Date.now() - t0) / 1000).toFixed(1)}s · ${gravados} registros.`)
  } catch (e) {
    await heartbeat('falha', { erro: e.message, dominio: ultimoDominio, duracao_ms: Date.now() - t0 })
    console.error('[ATAK] ERRO:', e.message); process.exit(1)
  }
}

main()
