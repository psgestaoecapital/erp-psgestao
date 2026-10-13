// Chamados em equipe · T1+T2 (SPEC rev. 9, seções 1 e 2 — CEO 02/10): um atendente por vez.
// Migration 20261002150000 · @pos-migration. Na Demonstração Comércio (GE) — o robô (fora da equipe) só atua em
// empresa DEMO (RD-69) e chamado de DEMO não avisa ninguém no sino. O chamado de teste é arquivado no fim.
//   1) assumir livre → a trava fica com quem assumiu;
//   2) com a trava de outra pessoa (Jordana), gravar resposta é RECUSADO com o nome dela;
//   3) puxar sem motivo é recusado; com motivo e mexido há < 2 h pede confirmação; confirmado, passa e fica no histórico;
//   4) direcionar exige motivo e só para alguém da equipe;
//   5) na tela: o card mostra a trava e o botão Liberar devolve o chamado à fila (Livre).

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbInsert, dbPatch, registrarJornada, obterSessionPayload } from '../../support/api'

const DEMO_COMERCIO = 'b0700000-0000-4000-a000-000000000004'
const ROBO = '74cf7dfa-4af5-4ef5-bd58-6a2166ea4cfa'
const JORDANA = '43ef8386-3262-4e56-b31a-6f0e41d1e21c'
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}-${Date.now().toString(36)}`

test.describe('Chamados em equipe — trava de atendimento', () => {
  let id = ''
  let numero = 0
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-chamados-equipe-trava', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.afterAll(async () => { if (id) await dbPatch('sugestoes', `id=eq.${id}`, { status: 'arquivada', atendente_id: null }) })

  test('um atendente por vez: assumir, recusa de quem perdeu a trava, puxar com motivo e confirmação, histórico, tela', { tag: '@pos-migration' }, async ({ page }) => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_COMERCIO}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    // autor nulo: o robô age como EQUIPE (não como autor do chamado), então passa pela trava
    id = (await dbInsert<{ id: string }>('sugestoes', { company_id: DEMO_COMERCIO, user_id: null, user_email: 'cliente-demo@psgestao.com',
      user_name: 'cliente demo', titulo: `Aceitação trava ${RUN}`, descricao: 'chamado de teste (aceitação · chamados em equipe)', status: 'nova', categoria: 'bug', tipo: 'bug' })).id
    numero = (await dbSelect<{ numero: number }>('sugestoes', `id=eq.${id}&select=numero`))[0].numero

    const token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
    const rpc = async (fn: string, args: Record<string, unknown>) => {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST',
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args) })
      return { http: r.status, corpo: await r.text() }
    }
    const json = (x: { corpo: string }) => JSON.parse(x.corpo) as { ok?: boolean; erro?: string; mensagem?: string; precisa_confirmar?: boolean }
    const linha = async () => (await dbSelect<{ atendente_id: string | null; status: string }>('sugestoes', `id=eq.${id}&select=atendente_id,status`))[0]

    // 1) assumir livre
    expect(json(await rpc('fn_chamado_assumir', { p_id: id })).ok).toBe(true)
    expect((await linha()).atendente_id, 'a trava ficou com quem assumiu').toBe(ROBO)

    // 2) a Jordana está com o chamado (simulado pelo banco) → o robô não grava resposta
    await dbPatch('sugestoes', `id=eq.${id}`, { atendente_id: JORDANA, ultimo_movimento: new Date().toISOString(), em_atendimento_desde: new Date().toISOString() })
    const recusa = await rpc('fn_sugestao_responder', { p_id: id, p_texto: 'não pode', p_user: ROBO })
    expect(recusa.http, 'quem perdeu a trava não grava').toBeGreaterThanOrEqual(400)
    expect(recusa.corpo).toContain('em atendimento por Jordana')
    expect(json(await rpc('fn_chamado_assumir', { p_id: id })).erro, 'assumir não passa por cima').toBe('em_atendimento')

    // 3) puxar: motivo obrigatório; mexido há < 2 h → confirmação; confirmado → passa
    expect(json(await rpc('fn_chamado_puxar', { p_id: id, p_motivo: '' })).erro).toBe('motivo_obrigatorio')
    const pede = json(await rpc('fn_chamado_puxar', { p_id: id, p_motivo: `aceitação ${RUN}` }))
    expect(pede.precisa_confirmar, 'pede confirmação a mais').toBe(true)
    expect(pede.mensagem).toContain('Jordana mexeu neste chamado')
    expect((await linha()).atendente_id, 'sem confirmar, nada muda').toBe(JORDANA)
    expect(json(await rpc('fn_chamado_puxar', { p_id: id, p_motivo: `aceitação ${RUN}`, p_confirmar: true })).ok).toBe(true)
    expect((await linha()).atendente_id, 'a trava passou para quem puxou').toBe(ROBO)
    const hist = await dbSelect<{ acao: string; de_user: string | null; para_user: string | null; confirmacao_extra: boolean; motivo: string | null }>(
      'sugestao_atendimento_hist', `sugestao_id=eq.${id}&select=acao,de_user,para_user,confirmacao_extra,motivo&order=id`)
    const puxou = hist.find((h) => h.acao === 'puxar')
    expect(puxou?.de_user, 'histórico: de quem').toBe(JORDANA)
    expect(puxou?.para_user, 'histórico: para quem').toBe(ROBO)
    expect(puxou?.confirmacao_extra, 'histórico: confirmou a mais').toBe(true)
    expect(puxou?.motivo).toBe(`aceitação ${RUN}`)
    const avisos = await dbSelect<{ id: string }>('sugestao_notificacao', `sugestao_id=eq.${id}&tipo=eq.atendimento&select=id`)
    expect(avisos.length, 'chamado de DEMO não avisa ninguém da equipe (RD-69)').toBe(0)
    // agora o robô é o atendente: grava
    expect(json(await rpc('fn_sugestao_responder', { p_id: id, p_texto: `resposta ${RUN}`, p_user: ROBO })).ok).toBe(true)

    // 4) direcionar
    expect(json(await rpc('fn_chamado_direcionar', { p_id: id, p_para: JORDANA, p_motivo: '' })).erro).toBe('motivo_obrigatorio')
    expect(json(await rpc('fn_chamado_direcionar', { p_id: id, p_para: ROBO, p_motivo: 'teste' })).erro, 'só para alguém da equipe').toBe('destino_fora_da_equipe')

    // 5) tela: trava visível e Liberar devolve para a fila
    await page.goto(`/dashboard/atendimento?id=${id}`)
    await aguardarConteudo(page)
    const estado = page.getByTestId(`trava-estado-${numero}`)
    await expect(estado, 'o card mostra que está com você').toContainText('Com você', { timeout: 20000 })
    page.once('dialog', (d) => void d.accept('fim do teste de aceitação'))
    await page.getByTestId(`btn-liberar-${numero}`).click()
    await expect(estado, 'liberado: volta a ficar livre na fila').toContainText('Livre', { timeout: 15000 })
    expect((await linha()).atendente_id).toBeNull()
    await page.getByTestId(`btn-historico-${numero}`).click().catch(() => { /* botão fica no detalhe aberto pelo link */ })
    await expect(page.getByTestId(`historico-${numero}`)).toContainText('liberou', { timeout: 15000 })
  })
})
