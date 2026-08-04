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
const crypto = require('crypto')

const COLLECTOR_VERSION = 'atak-frioeste-3.0-config-driven'

const {
  ATAK_SQL_SERVER, ATAK_SQL_PORT, ATAK_SQL_DATABASE,
  ATAK_SQL_USER, ATAK_SQL_PASSWORD, ATAK_FILIAL = '100',
  ATAK_JANELA_DIAS = '5', INGEST_URL, INGEST_SECRET, BATCH_SIZE = '500',
  ATAK_SKIP_ABATE = '',
  // CONFIG-DRIVEN: os domínios genéricos vêm do MAPA na nuvem PS (atak_fonte_mapa), lido por
  // fn_atak_mapa_coletor. Zero código novo por domínio depois — só ativar a linha no mapa.
  // (anon key é pública; a senha do SQL Server continua só nas vars ATAK_SQL_* — Pilar 2.)
  SUPABASE_URL, SUPABASE_ANON_KEY, ATAK_COMPANY_ID = '975365cc-9e5a-4251-9022-68c6bfde10d8',
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

// Lê o MAPA de domínios ativos da nuvem PS (fn_atak_mapa_coletor) — template global + a empresa.
// Cada item: { dominio, tabela_origem, chave_fato_sql, coluna_watermark, watermark }.
// watermark = último ponto já coletado (null → carga FULL, ex.: 1ª irrigação).
async function lerMapa() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !ATAK_COMPANY_ID) {
    console.warn('[ATAK] sem SUPABASE_URL/SUPABASE_ANON_KEY/ATAK_COMPANY_ID no .env — pulo os domínios genéricos (só abate).')
    return []
  }
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/fn_atak_mapa_coletor`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    body: JSON.stringify({ p_company_id: ATAK_COMPANY_ID }),
  })
  const txt = await res.text()
  if (!res.ok) throw new Error(`mapa ${res.status}: ${txt}`)
  const cfg = txt ? JSON.parse(txt) : null
  return Array.isArray(cfg && cfg.dominios) ? cfg.dominios : []
}

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

// Coleta 1 domínio do mapa → ind_atak_fato. A chave_fato_sql é uma EXPRESSÃO SQL: quem computa é o
// próprio SQL Server (robusto a casing/estrutura), sem adivinhar colunas no JS. `raw` = linha inteira.
// Incremental quando há coluna_watermark real + watermark (WHERE > @ultimo); senão FULL.
async function coletarDominioMapa(pool, dom) {
  const wmCol = dom.coluna_watermark
  const incremental = wmCol && !String(wmCol).startsWith('REVISAR') && dom.watermark != null
  // colchete o nome da coluna: watermark pode vir "sujo" (espaço/ponto/maiúsculas, ex.: [TITULO.DATA EMISSAO]).
  const where = incremental ? ` WHERE [${wmCol}] > @ultimo` : ''
  // HASH_ROW (ou chave vazia): evento/snapshot SEM chave natural → hash sha256 da linha (idempotente).
  // Senão: chave natural = EXPRESSÃO SQL computada no SQL Server (robusto a casing).
  const hashRow = !dom.chave_fato_sql || String(dom.chave_fato_sql).trim().toUpperCase() === 'HASH_ROW'
  const query = hashRow
    ? `SELECT * FROM ${dom.tabela_origem}${where}`
    : `SELECT *, (${dom.chave_fato_sql}) AS __chave_fato FROM ${dom.tabela_origem}${where}`
  const req = pool.request()
  if (incremental) req.input('ultimo', sql.NVarChar, String(dom.watermark))
  const rows = clean((await req.query(query)).recordset)
  const registros = []
  let semChave = 0
  for (const row of rows) {
    let chave
    if (hashRow) {
      // ordem estável das colunas → mesmo hash pra mesma linha (zero colisão; upsert no-op se repetir).
      chave = crypto.createHash('sha256').update(JSON.stringify(row, Object.keys(row).sort())).digest('hex')
    } else {
      chave = row.__chave_fato
      delete row.__chave_fato
    }
    if (chave == null || String(chave).trim() === '') { semChave++; continue }
    registros.push({ cod_filial: String(ATAK_FILIAL), chave_fato: String(chave).trim(), raw: row })
  }
  console.log(`[ATAK][${dom.dominio}] ${registros.length} registros ${incremental ? '(incremental)' : '(FULL)'}${hashRow ? ' [hash]' : ''}${semChave ? ` · ${semChave} sem chave` : ''}.`)
  if (registros.length) await enviarLotes(registros, dom.dominio)
  return registros.length
}

// Puxa TODOS os domínios ativos do mapa (config-driven). Isolado do abate; cada domínio em try/catch.
async function pullDominiosGenericos(pool) {
  let dominios = []
  try { dominios = await lerMapa() }
  catch (e) { console.error('[ATAK] falha ao ler o mapa (sigo só com abate):', e.message); return }
  if (!dominios.length) { console.log('[ATAK] nenhum domínio ativo no mapa — só abate.'); return }
  for (const dom of dominios) {
    try { await coletarDominioMapa(pool, dom) }
    catch (e) { console.error(`[ATAK][${dom.dominio}] ERRO:`, e.message) } // um domínio não derruba os outros
  }
}

async function main() {
  const t0 = Date.now()
  console.log(`[ATAK] Conectando ${ATAK_SQL_SERVER}:${ATAK_SQL_PORT}/${ATAK_SQL_DATABASE} ...`)
  const pool = await sql.connect(config)

  // 1) ABATE primeiro — caminho intacto (RD-38, sagrado): → ind_abate_atak.
  if (!ATAK_SKIP_ABATE) {
    try { await coletarAbate(pool) } catch (e) { console.error('[ATAK][abate] ERRO:', e.message) }
  }

  // 2) domínios genéricos, config-driven pelo mapa (nuvem PS) → ind_atak_fato. Nada compartilhado
  //    com o abate que possa quebrá-lo.
  await pullDominiosGenericos(pool)

  await pool.close()
  console.log(`[ATAK] Concluido em ${((Date.now() - t0) / 1000).toFixed(1)}s.`)
}

main().catch((e) => { console.error('[ATAK] ERRO:', e.message); process.exit(1) })
