// Coletor ATAK Frioeste -> Supabase (Edge Function atak-ingest).
// Roda DENTRO da rede Frioeste (acesso ao SQL Server).
//
// DOIS caminhos:
//   1) ABATE (legado)  -> dbo.tbRomaneioAbate -> ind_abate_atak (colunas tipadas).
//   2) DOMÍNIOS novos  -> ind_atak_fato (landing UNIVERSAL do F1). Manda o `raw`
//      INTEIRO da linha; os campos tipados saem das VIEWS (v_ind_embalagem/
//      v_ind_estoque), ajustáveis sem recarregar (resiliência F1). Começa por
//      embalagem (dbo.tbProduto) e estoque (dbo.tbProdutoSaldoDiario).
//
// Idempotente: ind_abate_atak dedup por (company,filial,chave_fato,seq_cabeca);
// ind_atak_fato dedup por (company,dominio,chave_fato). Re-rodar não duplica.
const sql = require('mssql')
const os = require('os')

const COLLECTOR_VERSION = 'atak-frioeste-2.0-multidominio'

const {
  ATAK_SQL_SERVER, ATAK_SQL_PORT, ATAK_SQL_DATABASE,
  ATAK_SQL_USER, ATAK_SQL_PASSWORD, ATAK_FILIAL = '100',
  ATAK_JANELA_DIAS = '5', INGEST_URL, INGEST_SECRET, BATCH_SIZE = '500',
  // Quais domínios genéricos rodar (além do abate). Ex.: 'embalagem,estoque'.
  ATAK_DOMINIOS = 'embalagem,estoque',
  ATAK_SKIP_ABATE = '',
  // Queries/colunas parametrizáveis (confirmar as colunas reais com SELECT TOP 5).
  ATAK_Q_EMBALAGEM = 'SELECT * FROM dbo.tbProduto',
  ATAK_CHAVE_EMBALAGEM = 'cod_produto,Cod_produto,CodProduto,codigo,Codigo,CODIGO',
  ATAK_Q_ESTOQUE = '',                 // se vazio, é montada abaixo (com/sem janela)
  ATAK_CHAVE_ESTOQUE = 'cod_produto,Cod_produto,CodProduto,codigo,Codigo,CODIGO',
  ATAK_DATA_ESTOQUE = 'data,Data,data_saldo,DataSaldo,dt_saldo,Dt_saldo',
  ATAK_ESTOQUE_DATA_COL = '',          // coluna de data p/ janela do estoque (recomendado)
  ATAK_ESTOQUE_JANELA_DIAS = '7',
} = process.env

if (!INGEST_URL || !INGEST_SECRET) {
  console.error('[ATAK] Faltam INGEST_URL / INGEST_SECRET no .env')
  process.exit(2)
}

const config = {
  server: ATAK_SQL_SERVER,
  port: Number(ATAK_SQL_PORT),
  database: ATAK_SQL_DATABASE,
  user: ATAK_SQL_USER,
  password: ATAK_SQL_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true },
  requestTimeout: 120000,
}

const HOSTNAME = os.hostname()

const QUERY_ABATE = `
SELECT
  Cod_filial AS cod_filial, Chave_fato AS chave_fato, Seq_cabeca AS seq_cabeca,
  Num_lote AS num_lote, CONVERT(date, Data_abate) AS data_abate, Datahora AS datahora_registro,
  Cod_produto AS cod_produto, Desc_classificacao AS desc_classificacao,
  Cod_classif AS cod_classif, Cod_precoce AS cod_precoce, Cod_cobertura AS cod_cobertura,
  Cod_conformacao AS cod_conformacao, Cod_maturidade AS cod_maturidade, Tipificacao_IA AS tipificacao_ia,
  Peso_carcaca1 AS peso_carcaca1, Peso_carcaca2 AS peso_carcaca2,
  Peso_carcaca1_resf AS peso_carcaca1_resf, Peso_carcaca2_resf AS peso_carcaca2_resf,
  Valor_arroba_pec AS valor_arroba_pec, Valor_arroba_nf AS valor_arroba_nf,
  Valor_arroba_tabela AS valor_arroba_tabela, Valor_arroba_calc AS valor_arroba_calc,
  Carne_magra AS carne_magra, Perc_carne_magra AS perc_carne_magra, Esp_toucinho AS esp_toucinho,
  ID_SISBOV AS id_sisbov, Rastreabilidade AS rastreabilidade,
  Cod_camara AS cod_camara, Cod_manejo AS cod_manejo
FROM dbo.tbRomaneioAbate
WHERE Cod_filial = @filial
  AND Data_abate >= DATEADD(day, -@janela, CAST(GETDATE() AS date))
ORDER BY Data_abate, Chave_fato, Seq_cabeca;
`

// Domínios genéricos → ind_atak_fato. `raw` = linha inteira; chave_fato robusta.
function buildDominios() {
  const q_estoque = ATAK_Q_ESTOQUE || (ATAK_ESTOQUE_DATA_COL
    ? `SELECT * FROM dbo.tbProdutoSaldoDiario WHERE ${ATAK_ESTOQUE_DATA_COL} >= DATEADD(day, -${Number(ATAK_ESTOQUE_JANELA_DIAS)}, CAST(GETDATE() AS date))`
    : 'SELECT * FROM dbo.tbProdutoSaldoDiario')
  return {
    embalagem: { query: ATAK_Q_EMBALAGEM, chaveCols: split(ATAK_CHAVE_EMBALAGEM), dataCols: null },
    estoque:   { query: q_estoque,        chaveCols: split(ATAK_CHAVE_ESTOQUE),   dataCols: split(ATAK_DATA_ESTOQUE) },
  }
}
const split = (s) => String(s).split(',').map((x) => x.trim()).filter(Boolean)

function clean(rows) {
  return rows.map((r) => {
    const o = {}
    for (const k of Object.keys(r)) {
      let v = r[k]
      if (typeof v === 'string') v = v.trim()
      o[k] = v === '' ? null : v
    }
    return o
  })
}

// Acha o 1º valor não-nulo entre colunas candidatas (robusto a casing do ATAK).
function pick(row, cols) {
  for (const c of cols) { if (row[c] != null && String(row[c]).trim() !== '') return row[c] }
  return null
}
function toYMD(v) {
  if (v == null) return null
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  const s = String(v).trim()
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : s.slice(0, 10)
}

async function postBatch(registros, dominio, mode) {
  const body = { registros, collector_version: COLLECTOR_VERSION, hostname: HOSTNAME }
  if (dominio) body.dominio = dominio
  if (mode) body.collector_mode = mode
  const res = await fetch(INGEST_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-ingest-secret': INGEST_SECRET },
    body: JSON.stringify(body),
  })
  const txt = await res.text()
  if (!res.ok) throw new Error(`Ingest ${res.status}: ${txt}`)
  return txt
}

async function enviarLotes(rows, dominio) {
  const size = Number(BATCH_SIZE)
  let enviados = 0
  for (let i = 0; i < rows.length; i += size) {
    const lote = rows.slice(i, i + size)
    const r = await postBatch(lote, dominio)
    enviados += lote.length
    console.log(`[ATAK][${dominio || 'abate'}] Lote ${Math.floor(i / size) + 1}: +${lote.length} (${enviados}/${rows.length}) -> ${r}`)
  }
  return enviados
}

async function coletarAbate(pool) {
  const req = pool.request()
  req.input('filial', sql.Char(3), String(ATAK_FILIAL))
  req.input('janela', sql.Int, Number(ATAK_JANELA_DIAS))
  const rows = clean((await req.query(QUERY_ABATE)).recordset)
  console.log(`[ATAK][abate] ${rows.length} cabecas na janela de ${ATAK_JANELA_DIAS} dia(s).`)
  if (rows.length) await enviarLotes(rows, null) // sem dominio → ind_abate_atak
}

async function coletarDominio(pool, dominio, cfg) {
  const rows = clean((await pool.request().query(cfg.query)).recordset)
  const registros = []
  let semChave = 0
  for (const row of rows) {
    const cod = pick(row, cfg.chaveCols)
    if (cod == null) { semChave++; continue }
    const chave = cfg.dataCols
      ? `${String(cod).trim()}|${toYMD(pick(row, cfg.dataCols))}`
      : String(cod).trim()
    registros.push({ cod_filial: String(ATAK_FILIAL), chave_fato: chave, raw: row })
  }
  console.log(`[ATAK][${dominio}] ${registros.length} registros${semChave ? ` (${semChave} sem chave, ignorados)` : ''}.`)
  if (registros.length) await enviarLotes(registros, dominio)
}

async function main() {
  const t0 = Date.now()
  console.log(`[ATAK] Conectando ${ATAK_SQL_SERVER}:${ATAK_SQL_PORT}/${ATAK_SQL_DATABASE} ...`)
  const pool = await sql.connect(config)

  if (!ATAK_SKIP_ABATE) {
    try { await coletarAbate(pool) } catch (e) { console.error('[ATAK][abate] ERRO:', e.message) }
  }

  const DOMINIOS = buildDominios()
  for (const dom of split(ATAK_DOMINIOS)) {
    const cfg = DOMINIOS[dom]
    if (!cfg) { console.warn(`[ATAK] domínio desconhecido: ${dom} (pulei)`); continue }
    try { await coletarDominio(pool, dom, cfg) }
    catch (e) { console.error(`[ATAK][${dom}] ERRO:`, e.message) } // um domínio não derruba os outros
  }

  await pool.close()
  console.log(`[ATAK] Concluido em ${((Date.now() - t0) / 1000).toFixed(1)}s.`)
}

main().catch((e) => { console.error('[ATAK] ERRO:', e.message); process.exit(1) })
