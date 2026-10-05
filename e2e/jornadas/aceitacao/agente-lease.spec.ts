// CEO 04/10 · trava de uma sessão por agente (lease) + despertador que respeita a trava. Migration 20261005110000 (@pos-migration).
// Usa o agente gilberto-chamados só com lease de TESTE e devolve o estado ao final (apaga só a linha de lease do teste).
// Nunca aciona rotina de verdade: o despertador roda com p_somente + p_simular.

import { test, expect } from '../../support/fixtures'
import { rpc, dbInsert, dbPatch, dbSelect, registrarJornada } from '../../support/api'
import { liberarLease } from '../../support/lease'

const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}-${Date.now().toString(36)}`
const MIN = 60_000
const ha = (min: number) => new Date(Date.now() - min * MIN).toISOString()
const AG = 'gilberto-chamados'

type Sessao = { ok: boolean; resultado?: string }
type Desp = { disparos: { mensagem_id: string }[] }

test.describe('Lease de sessão dos agentes', () => {
  const criadas: string[] = []
  let devolverLease: () => Promise<void> = async () => {}
  let leaseAnterior = false

  test.beforeAll(async () => {
    leaseAnterior = (await dbSelect('erp_agente_sessao_lease', `agente=eq.${AG}&select=sessao_ref`)).length > 0
    devolverLease = await liberarLease(AG)
  })
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-agente-lease', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.afterAll(async () => {
    for (const id of criadas) await dbPatch('erp_agente_mensagem', `id=eq.${id}`, { arquivada: true })
    // devolve o lease do agente como estava (sessão real renovada agora; sem lease prévio, deixa expirado)
    await dbPatch('erp_agente_sessao_lease', `agente=eq.${AG}`, { sessao_ref: `teste-${RUN}`, renovada_em: ha(60) })
    await devolverLease()
  })

  const iniciar = (ref: string) => rpc<Sessao>('fn_agente_sessao_iniciar', { p_agente: AG, p_sessao_ref: ref })
  const expirar = () => dbPatch('erp_agente_sessao_lease', `agente=eq.${AG}`, { renovada_em: ha(13) })

  test('duas sessões: só uma pega a vez; a mesma renova; expirada, a outra assume', { tag: '@pos-migration' }, async () => {
    const a = `teste-A-${RUN}`, b = `teste-B-${RUN}`
    if (leaseAnterior) await expirar()
    expect((await iniciar(a)).resultado).toBe('ok')
    expect((await iniciar(b)).resultado, 'outra sessão com lease ativa').toBe('ocupado')
    expect((await iniciar(a)).resultado, 'a mesma sessão renova').toBe('ok')
    await expirar()
    expect((await iniciar(b)).resultado, 'lease expirou sozinha').toBe('ok')
  })

  test('despertador e acionar não disparam com lease ativa; voltam a disparar quando expira', { tag: '@pos-migration' }, async () => {
    const m = await dbInsert<{ id: string }>('erp_agente_mensagem', {
      para: AG, de: 'eng_chefe', tipo: 'tarefa', assunto: `[TESTE ${RUN}] lease, não executar`, corpo: 'Teste da aceitação. Não executar.',
      requer_ok_ceo: false, status: 'recebida', enviado_por: `aceitacao-e2e ${RUN}`, arquivada: true, atualizado_em: ha(30),
    })
    criadas.push(m.id)
    await dbPatch('erp_agente_mensagem', `id=eq.${m.id}`, { arquivada: false, atualizado_em: ha(30) })
    await expirar()
    expect((await iniciar(`teste-C-${RUN}`)).resultado).toBe('ok')
    const com = await rpc<Desp>('fn_agente_despertador', { p_somente: m.id, p_simular: true })
    expect(com.disparos, 'lease ativa: não dispara').toEqual([])
    const ac = await rpc<{ acionou: boolean; motivo: string }>('fn_agente_acionar', { p_mensagem_id: m.id })
    expect(ac.motivo).toBe('sessao_ativa')
    await expirar()
    const sem = await rpc<Desp>('fn_agente_despertador', { p_somente: m.id, p_simular: true })
    expect(sem.disparos.map((d) => d.mensagem_id), 'lease expirou: dispara').toEqual([m.id])
  })

  test('o teto conta só redisparos sem progresso: resposta nova zera', { tag: '@pos-migration' }, async () => {
    const m = await dbInsert<{ id: string }>('erp_agente_mensagem', {
      para: AG, de: 'eng_chefe', tipo: 'tarefa', assunto: `[TESTE ${RUN}] teto, não executar`, corpo: 'Teste da aceitação. Não executar.',
      requer_ok_ceo: false, status: 'em_andamento', enviado_por: `aceitacao-e2e ${RUN}`, arquivada: true, redisparos: 17,
    })
    criadas.push(m.id)
    await rpc('fn_agente_mensagem_responder', { p_mensagem_id: m.id, p_agente: AG, p_status: 'em_andamento', p_resposta: `progresso ${RUN}` })
    const l = (await dbSelect<{ redisparos: number }>('erp_agente_mensagem', `id=eq.${m.id}&select=redisparos`))[0]
    expect(l.redisparos, 'progresso zera o contador').toBe(0)
  })
})
