// Chamado #120 (Tryo · CEO 01/10 · decisão): aviso no sino quando a oportunidade/orçamento muda de etapa, para o
// responsável e o vendedor. Migration 20261001150000 (@pos-migration). Prova na Demonstração Comércio GE, com uma
// oportunidade de teste em que o robô é o responsável (o aviso cai no sino do robô, nunca no de uma pessoa real):
//  1) etapa muda por outra porta (serviço, sem usuário) → o robô recebe "Orçando → Proposta Enviada", lê pela própria
//     sessão (RLS) e marca como lido;
//  2) o próprio robô muda a etapa → NÃO recebe aviso de si mesmo;
//  3) o cliente não cria aviso para ninguém (insert direto recusado).
// A oportunidade de teste fica excluída (deleted_at) no fim — RD-30.

import { test, expect } from '../../support/fixtures'
import { dbSelect, dbInsert, dbPatch, obterSessionPayload, registrarJornada } from '../../support/api'

const DEMO_GE = 'b0700000-0000-4000-a000-000000000004'
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const RUN = Date.now().toString(36).toUpperCase()
let sessao: { access_token: string; user: { id: string } }
let opId = ''

async function comoRobo(metodo: 'GET' | 'PATCH' | 'POST', caminho: string, corpo?: unknown) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${caminho}`, {
    method: metodo,
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${sessao.access_token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  })
  return { status: r.status, corpo: (await r.json().catch(() => null)) as unknown }
}
type Aviso = { id: string; titulo: string; mensagem: string; link: string; lida: boolean }
const avisosDaOp = () => comoRobo('GET', `erp_notificacao_usuario?origem_id=eq.${opId}&select=id,titulo,mensagem,link,lida&order=criado_em.asc`)

test.describe.configure({ mode: 'serial' })
test.describe('Sino: oportunidade mudou de etapa avisa responsável e vendedor (#120)', () => {
  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_GE}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    sessao = JSON.parse(await obterSessionPayload())
  })
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-tryo-sino-etapa-120', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.afterAll(async () => {
    if (opId) await dbPatch('erp_crm_oportunidade', `id=eq.${opId}`, { deleted_at: new Date().toISOString() }).catch(() => {})
  })

  test('etapa muda por outra porta: o responsável recebe, lê e marca como lido', { tag: '@pos-migration' }, async () => {
    const op = await dbInsert<{ id: string }>('erp_crm_oportunidade', {
      company_id: DEMO_GE, titulo: `E2E sino #120 ${RUN}`, etapa: 'orcando', responsavel_id: sessao.user.id, created_by: sessao.user.id,
    })
    opId = op.id
    await dbPatch('erp_crm_oportunidade', `id=eq.${opId}`, { etapa: 'proposta_enviada' })

    const r = await avisosDaOp()
    expect(r.status, JSON.stringify(r.corpo)).toBe(200)
    const avisos = r.corpo as Aviso[]
    expect(avisos, 'um aviso só (responsável e vendedor são a mesma pessoa)').toHaveLength(1)
    expect(avisos[0].titulo).toContain('Proposta Enviada')
    expect(avisos[0].mensagem).toContain('Orçando → Proposta Enviada')
    expect(avisos[0].link).toBe(`/dashboard/projetos/oportunidades/${opId}`)
    expect(avisos[0].lida).toBe(false)

    const lida = await comoRobo('PATCH', `erp_notificacao_usuario?id=eq.${avisos[0].id}`, { lida: true, lida_em: new Date().toISOString() })
    expect(lida.status, JSON.stringify(lida.corpo)).toBe(200)
    const [depois] = await dbSelect<{ lida: boolean }>('erp_notificacao_usuario', `id=eq.${avisos[0].id}&select=lida`)
    expect(depois.lida, 'marcado como lido').toBe(true)
  })

  test('quem muda a etapa não recebe aviso de si mesmo; o cliente não cria aviso', { tag: '@pos-migration' }, async () => {
    expect(opId, 'depende do teste anterior').not.toBe('')
    const mov = await comoRobo('PATCH', `erp_crm_oportunidade?id=eq.${opId}`, { etapa: 'negociacao' })
    expect(mov.status, JSON.stringify(mov.corpo)).toBe(200)
    const [op] = await dbSelect<{ etapa: string }>('erp_crm_oportunidade', `id=eq.${opId}&select=etapa`)
    expect(op.etapa, 'a etapa mudou').toBe('negociacao')
    const avisos = (await avisosDaOp()).corpo as Aviso[]
    expect(avisos, 'nenhum aviso novo para quem fez a mudança').toHaveLength(1)

    const forjado = await comoRobo('POST', 'erp_notificacao_usuario', {
      company_id: DEMO_GE, destinatario_id: sessao.user.id, tipo: 'x', titulo: `forjado ${RUN}`,
    })
    expect(forjado.status, 'insert direto pelo cliente é recusado').toBeGreaterThanOrEqual(400)
  })
})
