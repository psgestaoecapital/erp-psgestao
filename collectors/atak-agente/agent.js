// Agente PS · coletor ATAK CONFIG-DRIVEN (F3).
// Um agente, N frigoríficos. A ÚNICA config local é o token (PS_AGENTE_TOKEN).
// Tudo o mais (host, banco, credencial via Vault, de-paras, janela) vem da nuvem PS
// pela RPC fn_atak_agente_config(token). Assim, trocar de servidor = editar 1 campo
// na tela (RD-52), sem tocar na máquina; e o mesmo binário serve todos os clientes.
//
// Ciclo:
//   1) puxa config por token;
//   2) se há teste pendente (a tela pediu), faz SELECT 1 e responde em português;
//   3) coleta cada domínio ativo (SELECT com a chave_fato_sql do de-para + janela);
//   4) empurra pro atak-ingest (idempotente) — que já grava o heartbeat em
//      erp_sync_log (alimenta o monitor / semáforo). Um domínio que falha não
//      derruba os outros (try/catch). Retry com backoff na conexão.
const sql = require('mssql')
const os = require('os')

const AGENT_VERSION = 'atak-agente-1.1'

// Constantes de PLATAFORMA (não são segredo do cliente; vêm do instalador/.env do agente).
// A identidade do cliente é SÓ o token.
const {
  PS_AGENTE_TOKEN,
  PS_SUPABASE_URL,
  PS_SUPABASE_ANON_KEY,
  PS_INGEST_URL,
  PS_INGEST_SECRET,                 // opcional: se a nuvem devolver, ela vence
  PS_JANELA_DIAS = '7',
  PS_BATCH_SIZE = '500',
} = process.env

const HOSTNAME = os.hostname()
const split = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean)

function req(name, val) { if (!val) { console.error(`[agente] Falta ${name} no ambiente do agente.`); process.exit(2) } }
req('PS_AGENTE_TOKEN', PS_AGENTE_TOKEN)
req('PS_SUPABASE_URL', PS_SUPABASE_URL)
req('PS_SUPABASE_ANON_KEY', PS_SUPABASE_ANON_KEY)
req('PS_INGEST_URL', PS_INGEST_URL)

// Chamada de RPC Supabase (REST). O agente é anônimo + token — a RPC valida o token.
async function rpc(fn, args) {
  const res = await fetch(`${PS_SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: PS_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${PS_SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify(args),
  })
  const txt = await res.text()
  if (!res.ok) throw new Error(`RPC ${fn} ${res.status}: ${txt}`)
  return txt ? JSON.parse(txt) : null
}

function clean(rows) {
  return rows.map((r) => {
    const o = {}
    for (const k of Object.keys(r)) { let v = r[k]; if (typeof v === 'string') v = v.trim(); o[k] = v === '' ? null : v }
    return o
  })
}

async function postBatch(registros, dominio, ingestSecret) {
  const res = await fetch(PS_INGEST_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-ingest-secret': ingestSecret },
    body: JSON.stringify({ registros, collector_version: AGENT_VERSION, hostname: HOSTNAME, dominio }),
  })
  const txt = await res.text()
  if (!res.ok) throw new Error(`Ingest ${res.status}: ${txt}`)
  return txt
}

async function enviarLotes(registros, dominio, ingestSecret) {
  const size = Number(PS_BATCH_SIZE)
  let enviados = 0
  for (let i = 0; i < registros.length; i += size) {
    const lote = registros.slice(i, i + size)
    const r = await postBatch(lote, dominio, ingestSecret)
    enviados += lote.length
    console.log(`[agente][${dominio}] lote ${Math.floor(i / size) + 1}: +${lote.length} (${enviados}/${registros.length}) -> ${r}`)
  }
  return enviados
}

// Traduz o erro do mssql em português (o que teria evitado o perrengue de rede).
function traduzErro(e) {
  const m = String(e && e.message || e)
  if (/ELOGIN|Login failed/i.test(m)) return 'credencial inválida (usuário/senha)'
  if (/ESOCKET|ETIMEOUT|ECONNREFUSED|failed to connect|getaddrinfo|EAI_AGAIN/i.test(m)) return 'não alcança o host (rede/porta?)'
  if (/Cannot open database|database .* does not exist/i.test(m)) return 'banco não existe / sem acesso'
  return m.slice(0, 180)
}

function sqlConfig(cfg) {
  return {
    server: cfg.host, port: Number(cfg.porta), database: cfg.banco,
    user: cfg.usuario, password: cfg.senha,
    options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true },
    requestTimeout: 120000, connectionTimeout: 15000,
  }
}

async function conectarComRetry(cfg, tentativas = 3) {
  let ultimo
  for (let i = 1; i <= tentativas; i++) {
    try { return await sql.connect(sqlConfig(cfg)) }
    catch (e) { ultimo = e; const espera = 2000 * i; console.warn(`[agente] conexão falhou (${i}/${tentativas}): ${e.message}. Retry em ${espera}ms`); await new Promise((r) => setTimeout(r, espera)) }
  }
  throw ultimo
}

async function coletarDominio(pool, cfg, dom) {
  const janela = Number(PS_JANELA_DIAS)
  const where = dom.coluna_watermark
    ? ` WHERE ${dom.coluna_watermark} >= DATEADD(day, -${janela}, CAST(GETDATE() AS date))`
    : ''
  // A chave_fato_sql do de-para é uma EXPRESSÃO SQL — deixamos o próprio banco
  // computá-la (robusto a casing/estrutura), sem adivinhar colunas no JS.
  const query = `SELECT *, (${dom.chave_fato_sql}) AS __chave_fato FROM ${dom.tabela_origem}${where}`
  const rows = clean((await pool.request().query(query)).recordset)
  const registros = []
  let semChave = 0
  for (const row of rows) {
    const chave = row.__chave_fato
    if (chave == null || String(chave).trim() === '') { semChave++; continue }
    delete row.__chave_fato
    registros.push({ cod_filial: String(cfg.cod_filial), chave_fato: String(chave).trim(), raw: row })
  }
  console.log(`[agente][${dom.dominio}] ${registros.length} registros${semChave ? ` (${semChave} sem chave)` : ''}.`)
  if (registros.length) await enviarLotes(registros, dom.dominio, cfg.__ingestSecret)
  return registros.length
}

async function responderTeste(cfg) {
  let ok = false, msg
  let pool
  try {
    pool = await sql.connect(sqlConfig(cfg))
    await pool.request().query('SELECT 1 AS ok')
    ok = true; msg = 'conectou'
  } catch (e) {
    msg = traduzErro(e)
  } finally { if (pool) { try { await pool.close() } catch { /* noop */ } } }
  await rpc('fn_atak_teste_responder', { p_token: PS_AGENTE_TOKEN, p_ok: ok, p_mensagem: msg })
  console.log(`[agente] teste de conexão respondido: ${ok ? 'OK' : 'FALHA'} (${msg})`)
}

async function main() {
  const t0 = Date.now()
  console.log(`[agente] ${AGENT_VERSION} @ ${HOSTNAME} — puxando config…`)
  const cfg = await rpc('fn_atak_agente_config', { p_token: PS_AGENTE_TOKEN })
  if (!cfg || cfg.erro) { console.error(`[agente] config indisponível: ${cfg && cfg.erro || 'sem resposta'}`); process.exit(1) }
  cfg.__ingestSecret = PS_INGEST_SECRET || cfg.ingest_secret
  if (!cfg.__ingestSecret) { console.error('[agente] sem ingest_secret (configure atak_ingest_secret no Vault ou PS_INGEST_SECRET).'); process.exit(2) }

  // Teste pendente pedido pela tela → responde antes de coletar.
  if (cfg.teste_pendente) { try { await responderTeste(cfg) } catch (e) { console.error('[agente] falha ao responder teste:', e.message) } }

  const dominios = Array.isArray(cfg.dominios) ? cfg.dominios : []
  if (!dominios.length) { console.warn('[agente] nenhum domínio ativo pra coletar.'); return }

  const pool = await conectarComRetry(cfg)
  let enviados = 0, erros = 0
  for (const dom of dominios) {
    try { enviados += await coletarDominio(pool, cfg, dom) }
    catch (e) { erros++; console.error(`[agente][${dom.dominio}] ERRO: ${e.message}`) } // um domínio não derruba os outros
  }
  await pool.close()

  // Heartbeat de VIVACIDADE (RD-58): conectou no banco do cliente e varreu todos os
  // domínios, mas a janela veio vazia (0 linhas novas). Sem isto o agente saudável
  // ficaria mudo e o monitor o mostraria "Parado" — mentindo. Bate um lote vazio
  // (o atak-ingest já registra `sucesso · gravados=0 · máquina viva`). Só bate quando
  // NÃO houve erro de domínio — assim não mascara uma falha real (aí o silêncio é honesto).
  if (enviados === 0 && erros === 0 && dominios.length) {
    try {
      await postBatch([], dominios[0].dominio, cfg.__ingestSecret)
      console.log('[agente] ciclo sem novidades — heartbeat de vivacidade enviado.')
    } catch (e) { console.error('[agente] falha ao enviar heartbeat de vivacidade:', e.message) }
  }
  console.log(`[agente] ciclo concluído em ${((Date.now() - t0) / 1000).toFixed(1)}s — ${enviados} enviado(s), ${erros} domínio(s) com erro.`)
}

main().catch((e) => { console.error('[agente] ERRO:', e.message); process.exit(1) })
