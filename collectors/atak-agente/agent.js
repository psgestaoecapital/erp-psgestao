// Agente PS · coletor ATAK CONFIG-DRIVEN (F3) — empacotável como .exe de 2 cliques.
// RD-26: reusa a coleta que já rodava (166 registros). Muda só: (1) senha do SQL fica LOCAL,
// criptografada por DPAPI, nunca vai pra nuvem (Pilar 2); (2) config vem de config.json (token
// embutido pelo instalador) ou do ambiente; (3) auto-instala como Serviço do Windows com loop
// interno (sem Task Scheduler). O binário é buildado com pkg numa máquina Windows (fora do Code Web).
//
// Comandos:
//   agente-atak.exe --instalar-servico     registra "PS Agente ATAK" (auto-start) + pede a senha 1x
//   agente-atak.exe --desinstalar-servico
//   agente-atak.exe --set-senha            (re)grava a senha local criptografada
//   agente-atak.exe --testar               SELECT 1 -> reporta no heartbeat, imprime PT-BR
//   agente-atak.exe                        roda o loop (a cada sync_minuto) — é o que o serviço executa
//
// PILAR 2 (inviolável): a senha do SQL NUNCA é enviada pra PS. fn_atak_agente_config devolve só
// config não-secreta (host/porta/banco/filial/usuário/domínios/janela). Durante a transição, se
// ainda não houver senha local, o agente cai na senha da nuvem (compat) — assim não quebra quem já
// coleta; quando a senha local é gravada, a da nuvem é ignorada e depois removida da RPC.
const sql = require('mssql')
const os = require('os')
const fs = require('fs')
const path = require('path')
const readline = require('readline')
const crypto = require('crypto')

const VERSAO_AGENTE = '2.1.5'            // semver — comparado com o manifesto /agente/versao.json (auto-update)
// ↑ FONTE DA VERDADE da versão do binário. O CI (build-agente-atak.yml) valida que a tag agente-vX.Y.Z
//   e o package.json batem com isto e gera o versao.json a partir DAQUI — nunca anuncia versão sem binário.
const AGENT_VERSION = `atak-agente-${VERSAO_AGENTE}`
const SERVICE_NAME = 'PS Agente ATAK'

// Diretório do binário (pkg) ou do script — cred.dat/config.json/agente.log ficam ao lado do .exe.
const BASE_DIR = process.env.PS_AGENTE_BASE_DIR || (process.pkg ? path.dirname(process.execPath) : __dirname)   // override só p/ teste
const CRED_FILE = path.join(BASE_DIR, 'cred.dat')
const CONFIG_FILE = path.join(BASE_DIR, 'config.json')
const LOG_FILE = path.join(BASE_DIR, 'agente.log')
// Circuit-breaker do auto-update (RD-57): estado PERSISTIDO em disco (sobrevive ao restart do serviço,
// diferente do throttle em memória) — sem isso, um update que não "vinga" reinicia o processo e volta a
// tentar de 4 em 4s pra sempre, zerando a coleta. Depois de MAX tentativas na MESMA versão-alvo, para.
const UPDATE_STATE_FILE = path.join(BASE_DIR, 'update-state.json')
const MAX_TENTATIVAS_UPDATE = 3
const HOSTNAME = os.hostname()

// ── log em arquivo + console (resiliência RD-58: fica rastro mesmo rodando como serviço) ──────────
function log(...args) {
  const linha = `[${new Date().toISOString()}] ${args.join(' ')}`
  try { console.log(linha) } catch { /* serviço sem console */ }
  try { fs.appendFileSync(LOG_FILE, linha + '\n') } catch { /* disco cheio/permite seguir */ }
}
function logErr(...args) { log('ERRO:', ...args) }

// ── Config: config.json (token embutido pelo instalador) sobreposto pelo ambiente (dev) ───────────
function carregarConfig() {
  let doArquivo = {}
  try { if (fs.existsSync(CONFIG_FILE)) doArquivo = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) }
  catch (e) { logErr('config.json inválido:', e.message) }
  const C = { ...doArquivo, ...process.env }
  const psUrl = (C.PS_URL || C.PS_SUPABASE_URL || '').replace(/\/+$/, '')
  return {
    token: C.PS_TOKEN || C.PS_AGENTE_TOKEN || '',
    supabaseUrl: psUrl,
    anonKey: C.PS_ANON_KEY || C.PS_SUPABASE_ANON_KEY || '',
    ingestUrl: C.PS_INGEST_URL || (psUrl ? `${psUrl}/functions/v1/atak-ingest` : ''),
    ingestSecret: C.PS_INGEST_SECRET || '',
    janelaDias: Number(C.PS_JANELA_DIAS || 7),
    batchSize: Number(C.PS_BATCH_SIZE || 500),
    syncMinutoPadrao: Number(C.PS_SYNC_MINUTO || 15),
    // Auto-update: base HTTPS onde ficam /agente/versao.json e o .exe (o app PS). Sem isso, o
    // auto-update fica desligado (o agente segue coletando normalmente). O instalador embute PS_UPDATE_BASE.
    updateBase: (C.PS_UPDATE_BASE || C.PS_APP_URL || '').replace(/\/+$/, ''),
    updateHoras: Number(C.PS_UPDATE_HORAS || 6),   // throttle da checagem de versão
  }
}
function exigir(C) {
  const faltando = []
  if (!C.token) faltando.push('PS_TOKEN')
  if (!C.supabaseUrl) faltando.push('PS_URL')
  if (!C.anonKey) faltando.push('PS_ANON_KEY')
  if (!C.ingestUrl) faltando.push('PS_INGEST_URL')
  if (faltando.length) { logErr(`falta ${faltando.join(', ')} no config.json (ou ambiente).`); process.exit(2) }
}

// ── Senha LOCAL criptografada (Windows DPAPI · atrelada ao usuário/máquina) — Pilar 2 ─────────────
// DPAPI via PowerShell (cripto.js) — sem módulo nativo, sem compilação. cred.dat guarda o base64
// do blob DPAPI (texto). require lazy pra o arquivo carregar em dev/CI (Linux) nas rotas que não
// mexem em senha (o PowerShell só existe/roda no Windows do cliente).
function cripto() { return require('./cripto') }
function salvarSenha(s) {
  const b64 = cripto().protegerSenha(String(s))
  fs.writeFileSync(CRED_FILE, b64, 'utf8')
}
function lerSenhaLocal() {
  try {
    if (!fs.existsSync(CRED_FILE)) return null
    const b64 = fs.readFileSync(CRED_FILE, 'utf8').trim()
    if (!b64) return null
    return cripto().lerSenha(b64)
  } catch (e) { logErr('não consegui ler a senha local (cred.dat):', e.message); return null }
}
function perguntarSenha(msg) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question(msg, (resp) => { rl.close(); resolve((resp || '').trim()) })
  })
}
async function garantirSenhaInterativa() {
  const atual = lerSenhaLocal()
  if (atual) return atual
  const s = await perguntarSenha('Digite a senha do usuário de LEITURA do SQL Server (fica só nesta máquina): ')
  if (!s) { logErr('senha vazia — abortando.'); process.exit(2) }
  salvarSenha(s)
  log('senha gravada localmente (criptografada · DPAPI). Nunca é enviada pra PS.')
  return s
}

// ── RPC Supabase (REST) — o agente é anônimo + token; a RPC valida o token ────────────────────────
async function rpc(C, fn, args) {
  const res = await fetch(`${C.supabaseUrl}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: C.anonKey, Authorization: `Bearer ${C.anonKey}` },
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

async function postBatch(C, registros, dominio, ingestSecret) {
  const res = await fetch(C.ingestUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-ingest-secret': ingestSecret },
    body: JSON.stringify({ registros, collector_version: AGENT_VERSION, hostname: HOSTNAME, dominio }),
  })
  const txt = await res.text()
  if (!res.ok) throw new Error(`Ingest ${res.status}: ${txt}`)
  return txt
}

async function enviarLotes(C, registros, dominio, ingestSecret) {
  let enviados = 0
  for (let i = 0; i < registros.length; i += C.batchSize) {
    const lote = registros.slice(i, i + C.batchSize)
    const r = await postBatch(C, lote, dominio, ingestSecret)
    enviados += lote.length
    log(`[${dominio}] lote ${Math.floor(i / C.batchSize) + 1}: +${lote.length} (${enviados}/${registros.length}) -> ${r}`)
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

// A senha vem SEMPRE do local (DPAPI). Só cai na senha da nuvem se ainda não houver local (transição).
function resolverSenha(cfg) {
  const local = lerSenhaLocal()
  if (local) return { senha: local, origem: 'local' }
  if (cfg.senha) return { senha: cfg.senha, origem: 'nuvem_compat' } // transição — remover da RPC depois
  return { senha: null, origem: 'ausente' }
}

function sqlConfig(cfg, senha) {
  return {
    server: cfg.host, port: Number(cfg.porta), database: cfg.banco,
    user: cfg.usuario, password: senha,
    options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true },
    requestTimeout: 120000, connectionTimeout: 15000,
  }
}

async function conectarComRetry(cfg, senha, tentativas = 3) {
  let ultimo
  for (let i = 1; i <= tentativas; i++) {
    try { return await sql.connect(sqlConfig(cfg, senha)) }
    catch (e) { ultimo = e; const espera = 2000 * i; log(`conexão falhou (${i}/${tentativas}): ${e.message}. Retry em ${espera}ms`); await new Promise((r) => setTimeout(r, espera)) }
  }
  throw ultimo
}

async function coletarDominio(C, pool, cfg, dom) {
  // FIX 3 — colchete SEMPRE o nome da coluna do watermark: ele pode vir "sujo" (espaco/ponto/maiuscula,
  // ex.: TITULO.DATA VENCTO). Sem os colchetes, `WHERE TITULO.DATA VENCTO >= ...` vira `TITULO.DATA` +
  // `VENCTO` solto → "non-boolean near 'VENCTO'". `[TITULO.DATA VENCTO]` trata o nome inteiro como 1 coluna.
  // 2.1.5 — recarga_completa (pedida pela PS, entregue uma vez): busca a view INTEIRA, sem a janela de dias
  const where = dom.coluna_watermark && !dom.recarga_completa
    ? ` WHERE [${dom.coluna_watermark}] >= DATEADD(day, -${C.janelaDias}, CAST(GETDATE() AS date))`
    : ''
  if (dom.recarga_completa) log(`[${dom.dominio}] RECARGA COMPLETA pedida pela PS — sem a janela de ${C.janelaDias} dias.`)
  // FIX 2 — HASH_ROW (ou chave vazia): view de evento/snapshot SEM chave natural → o hash sha256 da linha
  // e computado AQUI (nao no SQL; `HASH_ROW` nao e coluna). Idempotente e IDENTICO ao que os coletores
  // irmaos (atak-frioeste / downloads) ja gravaram — mesma expressao exata: JSON.stringify(row, keys.sort()).
  // Assim reprocessar NAO duplica os fatos ja no banco. Chave natural → EXPRESSAO SQL computada no servidor.
  const hashRow = !dom.chave_fato_sql || String(dom.chave_fato_sql).trim().toUpperCase() === 'HASH_ROW'
  const query = hashRow
    ? `SELECT * FROM ${dom.tabela_origem}${where}`
    : `SELECT *, (${dom.chave_fato_sql}) AS __chave_fato FROM ${dom.tabela_origem}${where}`
  const rows = clean((await pool.request().query(query)).recordset)
  const registros = []
  let semChave = 0
  for (const row of rows) {
    let chave
    if (hashRow) {
      // ordem estavel das colunas (keys.sort()) → mesmo hash pra mesma linha; upsert vira no-op se repetir.
      chave = crypto.createHash('sha256').update(JSON.stringify(row, Object.keys(row).sort())).digest('hex')
    } else {
      chave = row.__chave_fato
      delete row.__chave_fato
    }
    if (chave == null || String(chave).trim() === '') { semChave++; continue }
    registros.push({ cod_filial: String(cfg.cod_filial), chave_fato: String(chave).trim(), raw: row })
  }
  log(`[${dom.dominio}] ${registros.length} registros${semChave ? ` (${semChave} sem chave)` : ''}.`)
  if (registros.length) await enviarLotes(C, registros, dom.dominio, cfg.__ingestSecret)
  return registros.length
}

// ── Diagnóstico 2.1.5 (CEO 02/10): só LEITURA no ATAK — conta linhas e chaves distintas por domínio ────────────
// Prova, sem gravar nenhum fato, se a chave de cada domínio identifica a LINHA (contabil_dre perdia dado porque
// Num_lancto se repete). Para cada domínio: total da view, total na janela de dias, chaves distintas da chave atual
// e de cada candidata (chaves_teste). HASH_ROW → linhas distintas (SELECT DISTINCT *). Erro de um domínio não para os outros.
function montarSqlDiagnostico(dom, janelaDias) {
  const hashRow = !dom.chave_fato_sql || String(dom.chave_fato_sql).trim().toUpperCase() === 'HASH_ROW'
  const cands = Array.isArray(dom.chaves_teste) ? dom.chaves_teste.filter((x) => typeof x === 'string' && x.trim()) : []
  const cols = ['COUNT_BIG(*) AS total']
  if (!hashRow) cols.push(`COUNT_BIG(DISTINCT (${dom.chave_fato_sql})) AS chave_atual`)
  cands.forEach((c, i) => cols.push(`COUNT_BIG(DISTINCT (${c})) AS cand_${i}`))
  const principal = `SELECT ${cols.join(', ')} FROM ${dom.tabela_origem}`
  const janela = dom.coluna_watermark
    ? `SELECT COUNT_BIG(*) AS janela FROM ${dom.tabela_origem} WHERE [${dom.coluna_watermark}] >= DATEADD(day, -${Number(janelaDias) || 7}, CAST(GETDATE() AS date))`
    : null
  const distintasLinha = hashRow ? `SELECT COUNT_BIG(*) AS linhas_distintas FROM (SELECT DISTINCT * FROM ${dom.tabela_origem}) x` : null
  return { principal, janela, distintasLinha, hashRow, cands }
}

async function rodarDiagnostico(C, pool, cfg) {
  const dominios = Array.isArray(cfg.dominios) ? cfg.dominios : []
  const resultado = { versao_agente: VERSAO_AGENTE, host: HOSTNAME, em: new Date().toISOString(), janela_dias: C.janelaDias, dominios: {} }
  for (const dom of dominios) {
    const q = montarSqlDiagnostico(dom, C.janelaDias)
    const r = { tabela: dom.tabela_origem, chave_atual_sql: dom.chave_fato_sql || 'HASH_ROW' }
    try {
      const p = (await pool.request().query(q.principal)).recordset[0] || {}
      r.total = Number(p.total)
      if (!q.hashRow) r.chave_atual_distintas = Number(p.chave_atual)
      r.candidatas = q.cands.map((sqlExpr, i) => ({ sql: sqlExpr, distintas: Number(p[`cand_${i}`]) }))
      if (q.janela) r.janela = Number((await pool.request().query(q.janela)).recordset[0].janela)
      if (q.distintasLinha) {
        try { r.linhas_distintas = Number((await pool.request().query(q.distintasLinha)).recordset[0].linhas_distintas) }
        catch (e) { r.linhas_distintas_erro = traduzErro(e) }
      }
    } catch (e) { r.erro = traduzErro(e) }
    resultado.dominios[dom.dominio] = r
    log(`[diagnóstico] ${dom.dominio}: ${r.erro ? 'ERRO ' + r.erro : `total=${r.total} chave=${r.chave_atual_distintas ?? r.linhas_distintas ?? '-'}`}`)
  }
  try { await rpc(C, 'fn_atak_diagnostico_responder', { p_token: C.token, p_resultado: resultado }); log('diagnóstico entregue à PS.') }
  catch (e) { logErr('não entreguei o diagnóstico:', e.message) }
  return resultado
}

async function responderTeste(C, cfg, senha) {
  let ok = false, msg
  let pool
  try {
    pool = await sql.connect(sqlConfig(cfg, senha))
    await pool.request().query('SELECT 1 AS ok')
    ok = true; msg = 'conectou'
  } catch (e) { msg = traduzErro(e) }
  finally { if (pool) { try { await pool.close() } catch { /* noop */ } } }
  try { await rpc(C, 'fn_atak_teste_responder', { p_token: C.token, p_ok: ok, p_mensagem: msg }) } catch (e) { logErr('não respondeu o teste na nuvem:', e.message) }
  log(`teste de conexão: ${ok ? 'OK' : 'FALHA'} (${msg})`)
  return { ok, msg }
}

// ── Um ciclo de coleta (config da nuvem + senha local) ────────────────────────────────────────────
async function cicloColeta(C) {
  const t0 = Date.now()
  log(`${AGENT_VERSION} @ ${HOSTNAME} — puxando config…`)
  const cfg = await rpc(C, 'fn_atak_agente_config', { p_token: C.token })
  if (!cfg || cfg.erro) { logErr(`config indisponível: ${cfg && cfg.erro || 'sem resposta'}`); return }
  cfg.__ingestSecret = C.ingestSecret || cfg.ingest_secret
  if (!cfg.__ingestSecret) { logErr('sem ingest_secret (Vault atak_ingest_secret ou PS_INGEST_SECRET).'); return }

  const { senha, origem } = resolverSenha(cfg)
  if (!senha) { logErr('sem senha local — rode "agente-atak.exe --set-senha" (Pilar 2).'); return }
  if (origem === 'nuvem_compat') log('AVISO: usando senha da nuvem (compat de transição). Rode --set-senha p/ senha só-local.')

  if (cfg.teste_pendente) { try { await responderTeste(C, cfg, senha) } catch (e) { logErr('falha no teste:', e.message) } }

  const dominios = Array.isArray(cfg.dominios) ? cfg.dominios : []
  if (!dominios.length) { log('nenhum domínio ativo pra coletar.'); return }

  const pool = await conectarComRetry(cfg, senha)
  if (cfg.diagnostico_pendente) { try { await rodarDiagnostico(C, pool, cfg) } catch (e) { logErr('falha no diagnóstico:', e.message) } }
  let enviados = 0, erros = 0
  for (const dom of dominios) {
    try { enviados += await coletarDominio(C, pool, cfg, dom) }
    catch (e) { erros++; logErr(`[${dom.dominio}]`, e.message) } // um domínio não derruba os outros
  }
  await pool.close()

  // Heartbeat de vivacidade (RD-58): sem novidades e sem erro → bate lote vazio pra não parecer "Parado".
  if (enviados === 0 && erros === 0 && dominios.length) {
    try { await postBatch(C, [], dominios[0].dominio, cfg.__ingestSecret); log('ciclo sem novidades — heartbeat enviado.') }
    catch (e) { logErr('falha no heartbeat:', e.message) }
  }
  log(`ciclo em ${((Date.now() - t0) / 1000).toFixed(1)}s — ${enviados} enviado(s), ${erros} domínio(s) com erro.`)
  return { minutos: cfg.sync_minuto || C.syncMinutoPadrao, status: erros > 0 ? 'erro' : 'ok', enviados, erros }
}

// ── Heartbeat de versão (observabilidade · RD-58) — a tela Conectores lê disso ────────────────────
async function enviarHeartbeat(C, res) {
  try {
    await rpc(C, 'fn_agente_heartbeat', {
      p_token: C.token, p_versao: VERSAO_AGENTE, p_hostname: HOSTNAME,
      p_ultima_carga: (res && res.enviados > 0) ? new Date().toISOString() : null,
      p_status: res ? res.status : 'sem_config',
    })
  } catch (e) { logErr('heartbeat não enviado:', e.message) }
}

// ── Auto-update (o que faz o connector ESCALAR): 1 publicação → todos os agentes ──────────────────
// Outbound-only (HTTPS de saída). Nunca instala arquivo com sha256 errado. Falha graciosa: erro de
// rede/verificação só pula o update dessa vez — a coleta segue. cred.dat/config.json não são tocados.
function semverGt(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0)
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) > (pb[i] || 0)) return true; if ((pa[i] || 0) < (pb[i] || 0)) return false }
  return false
}
// Estado do circuit-breaker (RD-57): { alvo, tentativas, alertado } — persistido ao lado do .exe.
function lerUpdateState() {
  try { if (fs.existsSync(UPDATE_STATE_FILE)) return JSON.parse(fs.readFileSync(UPDATE_STATE_FILE, 'utf8')) }
  catch (e) { logErr('update-state.json ilegível (recomeço limpo):', e.message) }
  return { alvo: null, tentativas: 0, alertado: false }
}
function salvarUpdateState(s) {
  try { fs.writeFileSync(UPDATE_STATE_FILE, JSON.stringify(s)) } catch (e) { logErr('não gravei update-state.json:', e.message) }
}
// ── Auto-update 2.1.4 (CEO 28/09): o download roda em SEGUNDO PLANO, com tempo limite, e NUNCA bloqueia a
// coleta. Até a 2.1.3 o tick esperava (await) o download do .exe (86 MB, fetch sem timeout) ANTES de coletar:
// em 28/09 a Frioeste ficou sem coleta enquanto o download corria. Agora:
//   1. o tick só DISPARA a checagem (sem await) e coleta normalmente;
//   2. manifesto e download têm tempo limite; o .exe vai para disco em stream, com sha256 e cabeçalho MZ
//      conferidos antes de ser aceito;
//   3. download que falha/estoura o tempo → a coleta segue na versão atual e tenta de novo em
//      UPDATE_RETRY_MIN (não espera as 6h);
//   4. download pronto → o restart (nssm stop/troca/start, ~20 s) só acontece ENTRE ciclos, depois do heartbeat.
const UPDATE_MANIFESTO_TIMEOUT_MS = 60 * 1000
const UPDATE_DOWNLOAD_TIMEOUT_MS = 45 * 60 * 1000       // teto do download em 2º plano (a coleta não espera)
const UPDATE_RETRY_MIN = 60                              // falhou → nova tentativa em 1 h
const EXE_NOVO = () => path.join(BASE_DIR, 'agente-atak.new.exe')

const _upd = { ultimaChecagem: 0, proximaApos: 0, emAndamento: null, pronto: null }

// Dispara a checagem/download SEM bloquear. Devolve na hora; a promessa em curso fica em _upd.emAndamento.
function iniciarAtualizacaoEmSegundoPlano(C, agora = Date.now()) {
  if (!C.permitirUpdateSemPkg && !process.pkg) return null     // só faz sentido no .exe instalado (Windows)
  if (!C.supabaseUrl && !C.updateBase) return null             // sem hosting configurado → auto-update off
  if (_upd.emAndamento || _upd.pronto) return _upd.emAndamento // já baixando, ou já baixado esperando o fim do ciclo
  if (agora < _upd.proximaApos) return null
  _upd.ultimaChecagem = agora
  _upd.proximaApos = agora + Math.max(1, C.updateHoras) * 3600 * 1000
  _upd.emAndamento = baixarAtualizacao(C)
    .then((pronto) => { if (pronto) _upd.pronto = pronto })
    .catch((e) => {
      logErr(`auto-update: ${e && e.message || e} — sigo coletando na ${VERSAO_AGENTE}; nova tentativa em ${UPDATE_RETRY_MIN} min.`)
      _upd.proximaApos = Date.now() + (C.updateRetryMin || UPDATE_RETRY_MIN) * 60 * 1000
    })
    .finally(() => { _upd.emAndamento = null })
  return _upd.emAndamento
}

// Baixa e confere. Devolve { versao, arquivo } quando o .exe novo está pronto em disco; null quando não há
// o que fazer (sem versão nova, breaker travado). Lança erro em falha — quem chama registra e reagenda.
async function baixarAtualizacao(C) {
  // Hosting: Supabase Storage (bucket 'agente', PRIVADO desde a 2.1.3 · PR C 28/09). O manifesto vem da edge
  // function agente-download, que valida o token DESTE agente e devolve o versao.json com `url` = URL ASSINADA
  // do .exe (15 min). PS_UPDATE_BASE sobrepõe (compat/dev).
  const storageBase = `${C.supabaseUrl}/storage/v1/object/public/agente`
  const manifestoUrl = C.updateBase
    ? `${C.updateBase}/agente/versao.json`
    : `${C.supabaseUrl}/functions/v1/agente-download?arquivo=versao.json`
  const headersManifesto = C.updateBase ? {} : {
    apikey: C.anonKey, Authorization: `Bearer ${C.anonKey}`, 'x-agente-token': C.token,
  }
  const res = await fetch(manifestoUrl, {
    cache: 'no-store', headers: headersManifesto,
    signal: AbortSignal.timeout(C.updateManifestoTimeoutMs || UPDATE_MANIFESTO_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`manifesto indisponível (${res.status})`)
  const man = await res.json()
  if (!man || !man.versao || !semverGt(man.versao, VERSAO_AGENTE)) return null

  // ── Circuit-breaker (RD-57) ──────────────────────────────────────────────────────────────────
  let st = lerUpdateState()
  // Se já rodamos a versão-alvo (ou além), o update anterior "vingou": zera o histórico e segue.
  if (st.alvo && !semverGt(st.alvo, VERSAO_AGENTE)) { st = { alvo: null, tentativas: 0, alertado: false }; salvarUpdateState(st) }
  // Mesma versão-alvo já falhou MAX vezes (baixou/reiniciou e o binário NÃO virou man.versao) → PARA.
  if (st.alvo === man.versao && st.tentativas >= MAX_TENTATIVAS_UPDATE) {
    if (!st.alertado) {
      logErr(`circuit-breaker: update ${man.versao} falhou ${st.tentativas}x (binário segue ${VERSAO_AGENTE}). ` +
             `PARANDO de tentar — fico na versão estável que coleta. Publique um binário que se auto-reporte ${man.versao}.`)
      try {
        await rpc(C, 'fn_agente_heartbeat', {
          p_token: C.token, p_versao: VERSAO_AGENTE, p_hostname: HOSTNAME,
          p_ultima_carga: null, p_status: `update_travado:${man.versao}`,
        })
      } catch (e) { logErr('alerta de update travado não enviado:', e.message) }
      st.alertado = true; salvarUpdateState(st)
    }
    return null
  }

  log(`nova versão ${man.versao} disponível (rodando ${VERSAO_AGENTE})${man.obrigatorio ? ' [OBRIGATÓRIA]' : ''} — ` +
      `baixando em segundo plano (a coleta continua)… (tentativa ${(st.alvo === man.versao ? st.tentativas : 0) + 1}/${MAX_TENTATIVAS_UPDATE})`)
  // o versao.json do CI leva o url ABSOLUTO do Storage; fallback resolve contra a base do manifesto.
  const relBase = C.updateBase || storageBase.replace(/\/agente$/, '')
  const exeUrl = String(man.url || '/agente/agente-atak.exe').startsWith('http') ? man.url : `${relBase}${man.url}`
  const t0 = Date.now()
  const dl = await fetch(exeUrl, { signal: AbortSignal.timeout(C.updateDownloadTimeoutMs || UPDATE_DOWNLOAD_TIMEOUT_MS) })
  if (!dl.ok || !dl.body) throw new Error(`download do .exe falhou (${dl.status})`)

  // stream para disco (não segura 86 MB em memória) calculando o sha256 no caminho
  const { Readable, Transform } = require('stream')
  const { pipeline } = require('stream/promises')
  const parcial = EXE_NOVO() + '.part'
  const hash = crypto.createHash('sha256')
  let bytes = 0, cabeca = Buffer.alloc(0)
  try {
    await pipeline(
      Readable.fromWeb(dl.body),
      new Transform({
        transform(chunk, _enc, cb) {
          hash.update(chunk); bytes += chunk.length
          if (cabeca.length < 2) cabeca = Buffer.concat([cabeca, chunk.subarray(0, 2 - cabeca.length)])
          cb(null, chunk)
        },
      }),
      fs.createWriteStream(parcial),
    )
  } catch (e) {
    try { fs.unlinkSync(parcial) } catch { /* noop */ }
    throw new Error(`download interrompido após ${(bytes / 1048576).toFixed(1)} MB: ${e && e.name === 'TimeoutError' ? 'tempo limite' : (e && e.message || e)}`)
  }
  const sha = hash.digest('hex')
  const invalido = man.sha256 && sha.toLowerCase() !== String(man.sha256).toLowerCase()
    ? 'sha256 NÃO confere (arquivo corrompido/errado)'
    : (bytes < 100000 || cabeca[0] !== 0x4D || cabeca[1] !== 0x5A) ? 'arquivo baixado não é um .exe válido' : null
  if (invalido) { try { fs.unlinkSync(parcial) } catch { /* noop */ } throw new Error(invalido) }
  fs.renameSync(parcial, EXE_NOVO())
  log(`download da ${man.versao} concluído em ${((Date.now() - t0) / 1000).toFixed(0)}s (${(bytes / 1048576).toFixed(1)} MB, sha256 ok) — ` +
      'troca no fim do ciclo em curso.')
  return { versao: man.versao, arquivo: EXE_NOVO() }
}

// Troca o binário — chamado SÓ entre ciclos (depois do heartbeat), nunca no meio de uma coleta.
function aplicarAtualizacaoSePronta() {
  const pronto = _upd.pronto
  if (!pronto || !fs.existsSync(pronto.arquivo)) { _upd.pronto = null; return false }
  const st = lerUpdateState()
  try { fs.copyFileSync(process.execPath, path.join(BASE_DIR, 'agente-atak.bak.exe')) } catch (e) { logErr('backup do .exe falhou:', e.message) }
  // Updater destacado (um .exe em execução não se sobrescreve) — nssm para/troca/sobe, com rollback.
  const bat = [
    '@echo off',
    `"%~dp0nssm.exe" stop "${SERVICE_NAME}"`,
    'timeout /t 3 /nobreak >nul',
    'move /Y "%~dp0agente-atak.new.exe" "%~dp0agente-atak.exe"',
    `"%~dp0nssm.exe" start "${SERVICE_NAME}"`,
    'timeout /t 15 /nobreak >nul',
    `"%~dp0nssm.exe" status "${SERVICE_NAME}" | find "SERVICE_RUNNING" >nul || (move /Y "%~dp0agente-atak.bak.exe" "%~dp0agente-atak.exe" & "%~dp0nssm.exe" start "${SERVICE_NAME}")`,
    '',
  ].join('\r\n')
  fs.writeFileSync(path.join(BASE_DIR, 'atualizar.bat'), bat)
  // Conta a tentativa ANTES de disparar/encerrar (RD-57): se o binário não virar pronto.versao, na volta
  // o contador já subiu; após MAX o breaker trava. Persistido em disco → sobrevive ao restart.
  salvarUpdateState({
    alvo: pronto.versao,
    tentativas: (st.alvo === pronto.versao ? st.tentativas : 0) + 1,
    alertado: st.alvo === pronto.versao ? st.alertado : false,
  })
  const { spawn } = require('child_process')
  spawn('cmd.exe', ['/c', 'atualizar.bat'], { cwd: BASE_DIR, detached: true, stdio: 'ignore' }).unref()
  log(`updater disparado — o serviço reinicia na ${pronto.versao} (rollback automático se não subir em 15s).`)
  process.exit(0)                                            // encerra: o serviço volta com o novo .exe
  return true
}

// ── Loop do serviço: o próprio agente agenda (sem Task Scheduler) ──────────────────────────────────
// Um tick = dispara o update em 2º plano (sem esperar) → coleta → heartbeat → (se o .exe novo ficou
// pronto) troca entre ciclos. Nenhum passo do update fica no caminho da coleta.
async function umTick(C, dep = {}) {
  const coletar = dep.cicloColeta || cicloColeta
  const heartbeat = dep.enviarHeartbeat || enviarHeartbeat
  const aplicar = dep.aplicarAtualizacaoSePronta || aplicarAtualizacaoSePronta
  try { iniciarAtualizacaoEmSegundoPlano(C) } catch (e) { logErr('auto-update:', e.message) }
  let res
  try { res = await coletar(C) } catch (e) { logErr('ciclo:', e.message) }
  await heartbeat(C, res)
  try { aplicar() } catch (e) { logErr('auto-update (troca):', e.message) }
  return res
}

async function rodarLoop(C) {
  exigir(C)
  let minutos = C.syncMinutoPadrao
  const tick = async () => {
    const res = await umTick(C)
    if (res && res.minutos) minutos = res.minutos
    setTimeout(tick, Math.max(1, minutos) * 60 * 1000)
  }
  log(`serviço ${VERSAO_AGENTE} iniciado — coleta a cada ~${minutos} min; auto-update ${(C.supabaseUrl || C.updateBase) ? 'ligado (2º plano, não bloqueia a coleta)' : 'desligado'}.`)
  tick()
}

// ── Serviço do Windows (nssm/winsw finalizado no build Windows · Part F) ───────────────────────────
// pkg gera um .exe sem node.js embutido pra "node script", então o serviço roda o PRÓPRIO .exe.
// Usamos o gerenciador de serviços do Windows via nssm.exe (bundlado ao lado do binário) — robusto
// pra exe pkg (envolve o Service Control Protocol). O dev valida/instala nssm no build (Part F).
function nssmPath() { return path.join(BASE_DIR, 'nssm.exe') }
function execWin(cmd, args) {
  const { spawnSync } = require('child_process')
  const r = spawnSync(cmd, args, { stdio: 'inherit' })
  return r.status === 0
}
async function instalarServico(C) {
  exigir(C)
  await garantirSenhaInterativa() // pede a senha 1x antes de subir o serviço
  const exe = process.pkg ? process.execPath : process.argv0
  log(`instalando serviço "${SERVICE_NAME}"…`)
  const nssm = nssmPath()
  if (!fs.existsSync(nssm)) { logErr(`nssm.exe não encontrado ao lado do binário (${nssm}). O build (Part F) deve empacotá-lo.`); process.exit(3) }
  execWin(nssm, ['install', SERVICE_NAME, exe])
  execWin(nssm, ['set', SERVICE_NAME, 'AppDirectory', BASE_DIR])
  execWin(nssm, ['set', SERVICE_NAME, 'Start', 'SERVICE_AUTO_START'])
  execWin(nssm, ['set', SERVICE_NAME, 'AppStdout', LOG_FILE])
  execWin(nssm, ['set', SERVICE_NAME, 'AppStderr', LOG_FILE])
  execWin(nssm, ['start', SERVICE_NAME])
  log(`serviço "${SERVICE_NAME}" instalado e iniciado (auto-start).`)
  // teste imediato pra tela acender rápido
  try { await cicloColetaTeste(C) } catch { /* o loop do serviço segue */ }
}
async function cicloColetaTeste(C) {
  const cfg = await rpc(C, 'fn_atak_agente_config', { p_token: C.token })
  if (cfg && !cfg.erro) { const { senha } = resolverSenha(cfg); if (senha) await responderTeste(C, cfg, senha) }
}
function desinstalarServico() {
  const nssm = nssmPath()
  if (!fs.existsSync(nssm)) { logErr('nssm.exe não encontrado — remova o serviço manualmente.'); process.exit(3) }
  execWin(nssm, ['stop', SERVICE_NAME])
  execWin(nssm, ['remove', SERVICE_NAME, 'confirm'])
  log(`serviço "${SERVICE_NAME}" removido.`)
}

// ── Dispatch ──────────────────────────────────────────────────────────────────────────────────────
async function principal() {
  const C = carregarConfig()
  const cmd = (process.argv[2] || '').toLowerCase()
  switch (cmd) {
    case '--instalar-servico': return instalarServico(C)
    case '--desinstalar-servico': return desinstalarServico()
    case '--set-senha': { await garantirSenhaInterativa(); return }
    case '--testar': {
      exigir(C)
      const cfg = await rpc(C, 'fn_atak_agente_config', { p_token: C.token })
      if (!cfg || cfg.erro) { logErr('config indisponível:', cfg && cfg.erro); process.exit(1) }
      const { senha } = resolverSenha(cfg)
      if (!senha) { logErr('sem senha local — rode --set-senha.'); process.exit(2) }
      const r = await responderTeste(C, cfg, senha)
      process.exit(r.ok ? 0 : 1); return
    }
    case '--once': { exigir(C); await cicloColeta(C); return }
    default: return rodarLoop(C) // é o que o serviço executa
  }
}

// Testes (node --test) carregam o módulo sem subir o serviço.
if (process.env.PS_AGENTE_TESTE !== '1') {
  principal().catch((e) => { logErr(e && e.message || e); process.exit(1) })
} else {
  module.exports = { umTick, iniciarAtualizacaoEmSegundoPlano, baixarAtualizacao, _upd, VERSAO_AGENTE, semverGt, montarSqlDiagnostico }
}
