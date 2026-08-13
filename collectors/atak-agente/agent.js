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

const VERSAO_AGENTE = '2.1.0'            // semver — comparado com o manifesto /agente/versao.json (auto-update)
const AGENT_VERSION = `atak-agente-${VERSAO_AGENTE}`
const SERVICE_NAME = 'PS Agente ATAK'

// Diretório do binário (pkg) ou do script — cred.dat/config.json/agente.log ficam ao lado do .exe.
const BASE_DIR = process.pkg ? path.dirname(process.execPath) : __dirname
const CRED_FILE = path.join(BASE_DIR, 'cred.dat')
const CONFIG_FILE = path.join(BASE_DIR, 'config.json')
const LOG_FILE = path.join(BASE_DIR, 'agente.log')
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
  const where = dom.coluna_watermark
    ? ` WHERE ${dom.coluna_watermark} >= DATEADD(day, -${C.janelaDias}, CAST(GETDATE() AS date))`
    : ''
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
  log(`[${dom.dominio}] ${registros.length} registros${semChave ? ` (${semChave} sem chave)` : ''}.`)
  if (registros.length) await enviarLotes(C, registros, dom.dominio, cfg.__ingestSecret)
  return registros.length
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
let _ultimaChecagemUpdate = 0
async function verificarAtualizacao(C) {
  if (!process.pkg) return                                     // só faz sentido no .exe instalado (Windows)
  if (!C.supabaseUrl && !C.updateBase) return                  // sem hosting configurado → auto-update off
  const agora = Date.now()
  if (agora - _ultimaChecagemUpdate < Math.max(1, C.updateHoras) * 3600 * 1000) return
  _ultimaChecagemUpdate = agora
  // Hosting: Supabase Storage (bucket público 'agente'). PS_UPDATE_BASE sobrepõe (compat/dev).
  const storageBase = `${C.supabaseUrl}/storage/v1/object/public/agente`
  const manifestoUrl = C.updateBase ? `${C.updateBase}/agente/versao.json` : `${storageBase}/versao.json`
  try {
    const res = await fetch(manifestoUrl, { cache: 'no-store' })
    if (!res.ok) return
    const man = await res.json()
    if (!man || !man.versao || !semverGt(man.versao, VERSAO_AGENTE)) return
    log(`nova versão ${man.versao} disponível (rodando ${VERSAO_AGENTE})${man.obrigatorio ? ' [OBRIGATÓRIA]' : ''} — baixando…`)
    // o versao.json do CI leva o url ABSOLUTO do Storage; fallback resolve contra a base do manifesto.
    const relBase = C.updateBase || storageBase.replace(/\/agente$/, '')
    const exeUrl = String(man.url || '/agente/agente-atak.exe').startsWith('http') ? man.url : `${relBase}${man.url}`
    const dl = await fetch(exeUrl)
    if (!dl.ok) { logErr(`download do .exe falhou (${dl.status}) — segue na versão atual.`); return }
    const buf = Buffer.from(await dl.arrayBuffer())
    const sha = require('crypto').createHash('sha256').update(buf).digest('hex')
    if (man.sha256 && sha.toLowerCase() !== String(man.sha256).toLowerCase()) {
      logErr('sha256 NÃO confere — abortando update (arquivo corrompido/errado). Segue na versão atual.'); return
    }
    const mz = buf.subarray(0, 2)
    if (buf.length < 100000 || mz[0] !== 0x4D || mz[1] !== 0x5A) { logErr('arquivo baixado não é um .exe válido — abortando.'); return }
    fs.writeFileSync(path.join(BASE_DIR, 'agente-atak.new.exe'), buf)
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
    const { spawn } = require('child_process')
    spawn('cmd.exe', ['/c', 'atualizar.bat'], { cwd: BASE_DIR, detached: true, stdio: 'ignore' }).unref()
    log(`updater disparado — o serviço reinicia na ${man.versao} (rollback automático se não subir em 15s).`)
    process.exit(0)                                            // encerra: o serviço volta com o novo .exe
  } catch (e) { logErr('auto-update: falha (segue na versão atual):', e.message) }
}

// ── Loop do serviço: o próprio agente agenda (sem Task Scheduler) ──────────────────────────────────
async function rodarLoop(C) {
  exigir(C)
  let minutos = C.syncMinutoPadrao
  const tick = async () => {
    await verificarAtualizacao(C).catch((e) => logErr('auto-update:', e.message))   // pode encerrar o processo p/ atualizar
    let res
    try { res = await cicloColeta(C); if (res && res.minutos) minutos = res.minutos } catch (e) { logErr('ciclo:', e.message) }
    await enviarHeartbeat(C, res)
    setTimeout(tick, Math.max(1, minutos) * 60 * 1000)
  }
  log(`serviço ${VERSAO_AGENTE} iniciado — coleta a cada ~${minutos} min; auto-update ${(C.supabaseUrl || C.updateBase) ? 'ligado (Storage)' : 'desligado'}.`)
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

principal().catch((e) => { logErr(e && e.message || e); process.exit(1) })
