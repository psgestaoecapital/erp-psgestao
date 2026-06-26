// Coletor ATAK Frioeste -> Supabase (Edge Function atak-ingest).
// Roda DENTRO da rede Frioeste (acesso ao SQL Server). Idempotente:
// UNIQUE(company,filial,chave_fato,seq_cabeca) garante upsert sem duplicar.
const sql = require('mssql')

const {
  ATAK_SQL_SERVER, ATAK_SQL_PORT, ATAK_SQL_DATABASE,
  ATAK_SQL_USER, ATAK_SQL_PASSWORD, ATAK_FILIAL = '100',
  ATAK_JANELA_DIAS = '5', INGEST_URL, INGEST_SECRET, BATCH_SIZE = '500',
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

const QUERY = `
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

async function postBatch(registros) {
  const res = await fetch(INGEST_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-ingest-secret': INGEST_SECRET },
    body: JSON.stringify({ registros }),
  })
  const txt = await res.text()
  if (!res.ok) throw new Error(`Ingest ${res.status}: ${txt}`)
  return txt
}

async function main() {
  const t0 = Date.now()
  console.log(`[ATAK] Conectando ${ATAK_SQL_SERVER}:${ATAK_SQL_PORT}/${ATAK_SQL_DATABASE} ...`)
  const pool = await sql.connect(config)
  const req = pool.request()
  req.input('filial', sql.Char(3), String(ATAK_FILIAL))
  req.input('janela', sql.Int, Number(ATAK_JANELA_DIAS))

  const result = await req.query(QUERY)
  const rows = clean(result.recordset)
  console.log(`[ATAK] ${rows.length} cabecas na janela de ${ATAK_JANELA_DIAS} dia(s) (filial ${ATAK_FILIAL}).`)

  const size = Number(BATCH_SIZE)
  let enviados = 0
  for (let i = 0; i < rows.length; i += size) {
    const lote = rows.slice(i, i + size)
    const r = await postBatch(lote)
    enviados += lote.length
    console.log(`[ATAK] Lote ${Math.floor(i / size) + 1}: +${lote.length} (${enviados}/${rows.length}) -> ${r}`)
  }

  await pool.close()
  console.log(`[ATAK] Concluido: ${enviados} cabecas em ${((Date.now() - t0) / 1000).toFixed(1)}s.`)
}

main().catch((e) => { console.error('[ATAK] ERRO:', e.message); process.exit(1) })
