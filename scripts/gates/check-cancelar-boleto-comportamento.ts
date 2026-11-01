// Gate de COMPORTAMENTO (Rodrigo, pedido do revisor na #2947) — roda a rota "Cancelar boleto" de verdade, com o Supabase
// (fetch) e o Sicoob (https.request) simulados: 403 sem permissão (inclusive papel nulo), só boleto `registrado`
// é cancelado, e o erro do UPDATE local depois da baixa no banco é tratado. Sem rede, banco ou variável de ambiente.
import https from 'node:https'
import { EventEmitter } from 'node:events'
import { NextRequest } from 'next/server'

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://sb.test'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

type Cenario = {
  papel: string | null
  titulo: Record<string, unknown>
  statusBaixa: number
  updateErro: boolean
}
let cen: Cenario
let chamadasBanco: string[] = []
let updates: Record<string, unknown>[] = []
let logs: Record<string, unknown>[] = []

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
  const method = (init?.method ?? 'GET').toUpperCase()
  const body = init?.body ? JSON.parse(String(init.body)) : null
  if (url.pathname === '/auth/v1/user') return json({ id: 'user-1', aud: 'authenticated', email: 'g@test' })
  if (url.pathname === '/rest/v1/rpc/fn_acesso_efetivo') return json({ papel_gestao: cen.papel })
  if (url.pathname === '/rest/v1/rpc/fn_banco_obter_credencial') {
    return json({ ok: true, client_id: 'cid', cert_base64: Buffer.from('x').toString('base64'), cert_senha: 's', codigo_beneficiario: '123', cooperativa: '1', conta: '2', convenio: '3' })
  }
  if (url.pathname === '/rest/v1/erp_receber' && method === 'GET') return json(cen.titulo)
  if (url.pathname === '/rest/v1/erp_receber' && method === 'PATCH') {
    updates.push(body)
    return cen.updateErro ? json({ message: 'falha simulada', code: 'XX000' }, 500) : new Response(null, { status: 204 })
  }
  if (url.pathname === '/rest/v1/erp_banco_sync_log' && method === 'POST') { logs.push(body); return new Response(null, { status: 201 }) }
  return json({ message: `fetch inesperado ${method} ${url.pathname}` }, 500)
}) as typeof fetch

;(https as unknown as { request: unknown }).request = (opts: { path: string; method: string }, cb: (res: EventEmitter & { statusCode: number }) => void) => {
  const req = new EventEmitter() as EventEmitter & { write: () => void; end: () => void }
  req.write = () => {}
  req.end = () => {
    chamadasBanco.push(`${opts.method} ${opts.path}`)
    const res = new EventEmitter() as EventEmitter & { statusCode: number }
    const eToken = opts.path.includes('token')
    res.statusCode = eToken ? 200 : cen.statusBaixa
    cb(res)
    res.emit('data', Buffer.from(eToken ? JSON.stringify({ access_token: 't', expires_in: 3600 }) : ''))
    res.emit('end')
  }
  return req
}

const TITULO_OK = { id: 'r1', company_id: 'c1', boleto_status: 'registrado', boleto_nosso_numero: '777', boleto_banco_codigo: '756', status: 'aberto' }

async function chamar(c: Partial<Cenario>) {
  cen = { papel: 'CLIENT_ADMIN', titulo: TITULO_OK, statusBaixa: 204, updateErro: false, ...c }
  chamadasBanco = []; updates = []; logs = []
  const { POST } = await import('../../src/app/api/banco/sicoob/cancelar-boleto/route')
  const req = new NextRequest('http://localhost/api/banco/sicoob/cancelar-boleto', {
    method: 'POST', headers: { authorization: 'Bearer jwt', 'content-type': 'application/json' },
    body: JSON.stringify({ receber_id: 'r1' }),
  })
  const res = await POST(req)
  return { status: res.status, body: await res.json() as Record<string, unknown> }
}
const baixouNoBanco = () => chamadasBanco.some((c) => c.includes('/baixar'))

async function main() {
  for (const papel of [null, 'CLIENT_VIEWER', 'CLIENT_OPERATOR', 'OFICINA_MECANICO']) {
    const r = await chamar({ papel })
    ok(r.status === 403 && !baixouNoBanco() && updates.length === 0, `papel ${papel ?? 'nulo'}: 403, sem baixa no banco e sem UPDATE`)
  }

  for (const boleto_status of ['cancelado', 'pago', 'pendente', null]) {
    const r = await chamar({ titulo: { ...TITULO_OK, boleto_status } })
    ok(r.status === 409 && !baixouNoBanco() && updates.length === 0, `boleto_status ${boleto_status}: só "registrado" cancela (409, banco intocado)`)
  }
  const quitado = await chamar({ titulo: { ...TITULO_OK, status: 'pago' } })
  ok(quitado.status === 409 && !baixouNoBanco(), 'título quitado: 409, banco intocado')

  const feliz = await chamar({})
  ok(feliz.status === 200 && feliz.body.ok === true && baixouNoBanco(), 'boleto registrado: baixa enviada ao banco e resposta 200')
  const upd = updates[0] ?? {}
  ok(updates.length === 1 && upd.boleto_status === 'cancelado' && Object.keys(upd).every((k) => k.startsWith('boleto_')), 'UPDATE local toca só colunas boleto_* (o título permanece)')
  ok(logs.some((l) => l.tipo === 'boleto_cancelar' && l.status === 'ok'), 'auditoria: log "boleto_cancelar" ok gravado')

  const recusado = await chamar({ statusBaixa: 422 })
  ok(recusado.status === 502 && updates.length === 0 && logs.some((l) => l.status === 'erro'), 'banco recusa: 502, título/boleto locais intocados e erro auditado')

  const falhaUpd = await chamar({ updateErro: true })
  ok(falhaUpd.status === 500 && baixouNoBanco() && /banco cancelou o boleto/.test(String(falhaUpd.body.erro)), 'UPDATE local falha após a baixa: 500 com aviso claro')
  ok(logs.some((l) => l.status === 'erro' && /não atualizou/.test(String(l.mensagem))), 'UPDATE local falha: erro auditado para conciliar à mão')

  if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
}
main().catch((e) => { console.error(e); process.exit(1) })
