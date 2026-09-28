// Auto-update 2.1.4 (CEO 28/09): o download da atualização roda em 2º plano, com tempo limite, e NUNCA
// bloqueia a coleta. Servidor HTTP local faz o papel do Storage (manifesto + .exe).
// Rodar: cd collectors/atak-agente && npm install && node --test test/
const { test, beforeEach, after } = require('node:test')
const assert = require('node:assert')
const http = require('node:http')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'agente-teste-'))
process.env.PS_AGENTE_TESTE = '1'
process.env.PS_AGENTE_BASE_DIR = BASE
const ag = require('../agent.js')

const EXE_OK = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200 * 1024, 7)])
const SHA_OK = crypto.createHash('sha256').update(EXE_OK).digest('hex')
let modo = 'ok'           // 'ok' | 'trava' | 'sha_errado' | 'mesma_versao'
const pendentes = []

const srv = http.createServer((req, res) => {
  if (req.url === '/agente/versao.json') {
    const versao = modo === 'mesma_versao' ? ag.VERSAO_AGENTE : '9.9.9'
    res.writeHead(200, { 'content-type': 'application/json' })
    return res.end(JSON.stringify({ versao, url: '/agente/agente-atak.exe', sha256: modo === 'sha_errado' ? 'f'.repeat(64) : SHA_OK }))
  }
  if (req.url === '/agente/agente-atak.exe') {
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(EXE_OK.length) })
    if (modo === 'trava') { res.write(EXE_OK.subarray(0, 1024)); pendentes.push(res); return }  // manda 1 KB e para
    return res.end(EXE_OK)
  }
  res.writeHead(404); res.end()
})
let C
const pronto = new Promise((r) => srv.listen(0, '127.0.0.1', r))

beforeEach(async () => {
  await pronto
  const url = `http://127.0.0.1:${srv.address().port}`
  C = { token: 't', anonKey: 'a', supabaseUrl: url, updateBase: url, updateHoras: 6, permitirUpdateSemPkg: true,
        updateDownloadTimeoutMs: 1500, updateRetryMin: 60 }
  Object.assign(ag._upd, { ultimaChecagem: 0, proximaApos: 0, emAndamento: null, pronto: null })
  for (const f of fs.readdirSync(BASE)) fs.rmSync(path.join(BASE, f), { force: true })
})
after(() => { for (const r of pendentes) r.destroy(); srv.close(); fs.rmSync(BASE, { recursive: true, force: true }) })

function deps(ordem) {
  return {
    cicloColeta: async () => { ordem.push('coleta'); return { minutos: 15, status: 'ok', enviados: 3, erros: 0 } },
    enviarHeartbeat: async () => { ordem.push('heartbeat') },
    aplicarAtualizacaoSePronta: () => { ordem.push(ag._upd.pronto ? `troca:${ag._upd.pronto.versao}` : 'sem_troca') },
  }
}

test('download que TRAVA não bloqueia a coleta; estoura o tempo, segue na versão atual e reagenda', async () => {
  modo = 'trava'
  const ordem = []
  const t0 = Date.now()
  const res = await ag.umTick(C, deps(ordem))
  assert.ok(Date.now() - t0 < 1000, `o tick não pode esperar o download (levou ${Date.now() - t0} ms)`)
  assert.deepStrictEqual(ordem, ['coleta', 'heartbeat', 'sem_troca'])
  assert.strictEqual(res.enviados, 3)
  assert.ok(ag._upd.emAndamento, 'download segue em 2º plano')

  await ag._upd.emAndamento                                  // estoura o tempo limite (1,5 s)
  assert.strictEqual(ag._upd.pronto, null, 'download que falhou não vira atualização')
  assert.ok(ag._upd.proximaApos - Date.now() > 55 * 60 * 1000, 'nova tentativa só depois do intervalo de retry')
  assert.ok(!fs.existsSync(path.join(BASE, 'agente-atak.new.exe.part')), 'arquivo parcial removido')
  assert.ok(!fs.existsSync(path.join(BASE, 'agente-atak.new.exe')))

  const ordem2 = []
  await ag.umTick(C, deps(ordem2))                           // próximo ciclo: coleta normal, sem nova tentativa
  assert.deepStrictEqual(ordem2, ['coleta', 'heartbeat', 'sem_troca'])
  assert.strictEqual(ag._upd.emAndamento, null)
})

test('download ok: coleta segue durante o download e a troca só acontece ENTRE ciclos, depois do heartbeat', async () => {
  modo = 'ok'
  const ordem = []
  await ag.umTick(C, deps(ordem))                            // dispara o download e coleta sem esperar
  assert.deepStrictEqual(ordem, ['coleta', 'heartbeat', 'sem_troca'])
  await ag._upd.emAndamento
  assert.strictEqual(ag._upd.pronto && ag._upd.pronto.versao, '9.9.9')
  assert.ok(fs.readFileSync(path.join(BASE, 'agente-atak.new.exe')).equals(EXE_OK), 'binário salvo inteiro')

  const ordem2 = []
  await ag.umTick(C, deps(ordem2))
  assert.deepStrictEqual(ordem2, ['coleta', 'heartbeat', 'troca:9.9.9'])
})

test('sha256 errado: não instala, apaga o arquivo e a coleta segue', async () => {
  modo = 'sha_errado'
  const ordem = []
  await ag.umTick(C, deps(ordem))
  await ag._upd.emAndamento
  assert.deepStrictEqual(ordem, ['coleta', 'heartbeat', 'sem_troca'])
  assert.strictEqual(ag._upd.pronto, null)
  assert.deepStrictEqual(fs.readdirSync(BASE).filter((f) => f.startsWith('agente-atak.new')), [])
})

test('sem versão nova: não baixa nada', async () => {
  modo = 'mesma_versao'
  const ordem = []
  await ag.umTick(C, deps(ordem))
  await ag._upd.emAndamento
  assert.deepStrictEqual(ordem, ['coleta', 'heartbeat', 'sem_troca'])
  assert.strictEqual(ag._upd.pronto, null)
})
