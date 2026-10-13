// Pdois #97 + #98 (CEO 01/10): TAREFAS no lead, no lugar do registro de reunião. Migration 20261001190000 → @pos-migration
// (no preview informativo; o veredito é em produção logo após o deploy).
// Na Agência (P&M) - DEMO:
//  1) tarefa atribuída por OUTRA pessoa (aqui, o serviço) → o responsável (robô) recebe o aviso no sino e a tarefa entra
//     na agenda DELE (erp_agendamento com responsavel_id) e em "Minhas tarefas" (tela de leads);
//  2) o robô marca "feita" com resultado → a agenda acompanha (concluído);
//  3) empresa que não é do usuário → 42501;
//  4) reunião já registrada vira tarefa "reunião" sem perder nada: prévia antes; o evento da agenda continua; idempotente.
// Limpeza sem apagar (RD-30): tarefas de teste ficam "cancelada", eventos de teste excluídos pela função oficial (soft).

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbPatch, dbSelect, obterSessionPayload, registrarJornada, rpc } from '../../support/api'

const DEMO_AG = 'b0700000-0000-4000-a000-000000000002'
const OUTRA = '00000000-0000-4000-a000-0000000a9798'
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const RUN = Date.now().toString(36).toUpperCase()
let token = ''
let robo = ''
let leadId = ''
let leadResp: string | null = null
const criadas: string[] = []
const eventosTeste: string[] = []

async function comoRobo(fn: string, args: Record<string, unknown>) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args),
  })
  return { status: r.status, corpo: (await r.json().catch(() => ({}))) as Record<string, unknown> }
}

test.describe('Pdois #97/#98 · tarefas no lead: atribuir, sino, agenda, feita, conversão de reuniões', () => {
  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_AG}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    const sess = JSON.parse(await obterSessionPayload()) as { access_token: string; user: { id: string } }
    token = sess.access_token; robo = sess.user.id
    const [lead] = await dbSelect<{ id: string; responsavel_id: string | null }>('agency_leads', `company_id=eq.${DEMO_AG}&deleted_at=is.null&select=id,responsavel_id&order=criado_em.asc&limit=1`)
    expect(lead, 'a demo tem lead').toBeTruthy()
    leadId = lead.id; leadResp = lead.responsavel_id
  })
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-pdois-tarefas-97-98', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.afterAll(async () => {
    for (const id of criadas) await rpc('fn_lead_tarefa_situacao', { p_id: id, p_situacao: 'cancelada', p_resultado: `E2E ${RUN}` }).catch(() => {})
    for (const id of eventosTeste) await dbPatch('erp_agendamento', `id=eq.${id}`, { excluido_em: new Date().toISOString(), excluido_motivo: `E2E ${RUN}` }).catch(() => {})
  })

  test('atribuída por outra pessoa: sino + agenda do responsável + Minhas tarefas; feita com resultado', { tag: '@pos-migration' }, async ({ page }) => {
    const titulo = `E2E ligar ${RUN}`
    const r = await rpc<{ ok: boolean; id: string; agendamento_id: string }>('fn_lead_tarefa_salvar', {
      p_company_id: DEMO_AG, p_id: null,
      p_dados: { tipo: 'ligar', titulo, data: '2026-10-20', hora: '10:00', lead_id: leadId, responsavel_id: robo },
    })
    expect(r.ok, JSON.stringify(r)).toBe(true)
    criadas.push(r.id)

    const avisos = await dbSelect<{ destinatario_id: string; tipo: string }>('erp_notificacao_usuario', `origem_id=eq.${r.id}&select=destinatario_id,tipo`)
    expect(avisos, 'o responsável recebe 1 aviso no sino').toHaveLength(1)
    expect(avisos[0].destinatario_id).toBe(robo)
    expect(avisos[0].tipo).toBe('tarefa_atribuida')

    const [ev] = await dbSelect<{ responsavel_id: string; status: string; dados: { tarefa_id?: string } }>('erp_agendamento', `id=eq.${r.agendamento_id}&select=responsavel_id,status,dados`)
    expect(ev.responsavel_id, 'a tarefa entra na agenda DO responsável').toBe(robo)
    expect(ev.dados.tarefa_id).toBe(r.id)

    // tela: "Minhas tarefas" mostra a tarefa (o link do aviso abre direto)
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_AG)
    await page.goto('/dashboard/pm/leads?tarefas=minhas')
    await aguardarConteudo(page)
    await expect(page.getByTestId('minhas-tarefas')).toBeVisible()
    await expect(page.getByTestId(`minha-tarefa-${r.id}`)).toContainText(titulo)

    // feita com resultado → a agenda acompanha
    const f = await comoRobo('fn_lead_tarefa_situacao', { p_id: r.id, p_situacao: 'feita', p_resultado: 'Pediu proposta até sexta' })
    expect(f.status, JSON.stringify(f.corpo)).toBe(200)
    const [t] = await dbSelect<{ situacao: string; resultado: string }>('agency_lead_tarefa', `id=eq.${r.id}&select=situacao,resultado`)
    expect(t.situacao).toBe('feita')
    expect(t.resultado).toBe('Pediu proposta até sexta')
    const [ev2] = await dbSelect<{ status: string }>('erp_agendamento', `id=eq.${r.agendamento_id}&select=status`)
    expect(ev2.status).toBe('concluido')
  })

  test('quem cria a própria tarefa não se avisa; empresa de outro → 42501', { tag: '@pos-migration' }, async () => {
    const r = await comoRobo('fn_lead_tarefa_salvar', { p_company_id: DEMO_AG, p_id: null, p_dados: { tipo: 'whatsapp', titulo: `E2E zap ${RUN}`, data: '2026-10-21', lead_id: leadId } })
    expect(r.status, JSON.stringify(r.corpo)).toBe(200)
    expect(r.corpo.ok).toBe(true)
    criadas.push(String(r.corpo.id))
    expect(await dbSelect('erp_notificacao_usuario', `origem_id=eq.${r.corpo.id}&select=id`), 'sem aviso para quem criou').toHaveLength(0)

    const negado = await comoRobo('fn_lead_tarefa_salvar', { p_company_id: OUTRA, p_id: null, p_dados: { tipo: 'ligar', titulo: 'x', data: '2026-10-21', lead_id: leadId } })
    expect(negado.status).toBeGreaterThanOrEqual(400)
    expect(negado.corpo.code).toBe('42501')
  })

  test('reunião já registrada vira tarefa "reunião": prévia, evento preservado, idempotente', { tag: '@pos-migration' }, async () => {
    const ag = await comoRobo('fn_agendamento_criar', {
      p_company_id: DEMO_AG, p_origem: 'comercial', p_titulo: `E2E reunião antiga ${RUN}`, p_cliente_id: null, p_cliente_nome: null,
      p_responsavel_id: null, p_responsavel_nome: null, p_data: '2026-09-15', p_hora_inicio: '14:00', p_hora_fim: '15:00',
      p_dados: { lead_id: leadId }, p_observacao: null,
    })
    expect(ag.status, JSON.stringify(ag.corpo)).toBe(200)
    const agId = String(ag.corpo.id)
    eventosTeste.push(agId)

    const previa = await comoRobo('fn_lead_tarefa_converter_reunioes', { p_company_id: DEMO_AG, p_aplicar: false })
    expect(previa.status, JSON.stringify(previa.corpo)).toBe(200)
    const itens = previa.corpo.itens as Array<{ agendamento_id: string; situacao: string }>
    const meu = itens.find((i) => i.agendamento_id === agId)
    expect(meu, 'a prévia lista a reunião').toBeTruthy()
    expect(meu!.situacao, 'reunião passada entra como feita').toBe('feita')
    expect(await dbSelect('agency_lead_tarefa', `agendamento_id=eq.${agId}&select=id`), 'a prévia não grava').toHaveLength(0)

    const ap = await comoRobo('fn_lead_tarefa_converter_reunioes', { p_company_id: DEMO_AG, p_aplicar: true })
    expect(ap.status, JSON.stringify(ap.corpo)).toBe(200)
    const [t] = await dbSelect<{ id: string; tipo: string; origem: string; situacao: string; responsavel_id: string | null }>('agency_lead_tarefa',
      `agendamento_id=eq.${agId}&select=id,tipo,origem,situacao,responsavel_id`)
    expect(t.tipo).toBe('reuniao')
    expect(t.origem).toBe('reuniao_convertida')
    expect(t.situacao).toBe('feita')
    expect(t.responsavel_id, 'sem responsável no evento → o do lead; sem ele, quem criou o evento').toBe(leadResp ?? robo)
    criadas.push(t.id)
    const [ev] = await dbSelect<{ excluido_em: string | null; titulo: string }>('erp_agendamento', `id=eq.${agId}&select=excluido_em,titulo`)
    expect(ev.excluido_em, 'o evento da agenda continua (nada se perde)').toBeNull()
    expect(ev.titulo).toContain('reunião antiga')

    const de_novo = await comoRobo('fn_lead_tarefa_converter_reunioes', { p_company_id: DEMO_AG, p_aplicar: false })
    expect((de_novo.corpo.itens as Array<{ agendamento_id: string }>).some((i) => i.agendamento_id === agId), 'não converte duas vezes').toBe(false)
  })
})
