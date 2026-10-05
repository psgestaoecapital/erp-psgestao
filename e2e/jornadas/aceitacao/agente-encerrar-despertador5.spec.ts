// CEO 05/10 · sessão libera a trava ao terminar (fn_agente_sessao_encerrar) + despertador com limiar de 5 min + agente
// gilberto-produto. Migration 20261005150000 (@pos-migration). Usa gilberto-chamados só com lease de TESTE e devolve o
// estado ao final. Nunca aciona rotina de verdade: o despertador roda com p_somente + p_simular.

import { test, expect } from '../../support/fixtures'
import { rpc, dbInsert, dbPatch, dbSelect, registrarJornada } from '../../support/api'
import { liberarLease } from '../../support/lease'

const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}-${Date.now().toString(36)}`
const MIN = 60_000
const ha = (min: number) => new Date(Date.now() - min * MIN).toISOString()
const AG = 'gilberto-chamados'

type Sessao = { ok: boolean; resultado?: string }
type Desp = { disparos: { mensagem_id: string }[] }

test.describe('Encerrar sessão e despertador de 5 min', () => {
  const criadas: string[] = []
  let devolverLease: () => Promise<void> = async () => {}

  test.beforeAll(async () => { devolverLease = await liberarLease(AG) })
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-agente-encerrar-despertador5', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.afterAll(async () => {
    for (const id of criadas) await dbPatch('erp_agente_mensagem', `id=eq.${id}`, { arquivada: true })
    await dbPatch('erp_agente_sessao_lease', `agente=eq.${AG}`, { sessao_ref: `teste-${RUN}`, renovada_em: ha(60) })
    await devolverLease()
  })

  const iniciar = (ref: string) => rpc<Sessao>('fn_agente_sessao_iniciar', { p_agente: AG, p_sessao_ref: ref })
  const encerrar = (ref: string) => rpc<{ ok: boolean; liberada: boolean }>('fn_agente_sessao_encerrar', { p_agente: AG, p_sessao_ref: ref })
  const parada = async (min: number, arquivada = false) => {
    const m = await dbInsert<{ id: string }>('erp_agente_mensagem', {
      para: AG, de: 'eng_chefe', tipo: 'tarefa', assunto: `[TESTE ${RUN}] encerrar, não executar`, corpo: 'Teste da aceitação. Não executar.',
      requer_ok_ceo: false, status: 'recebida', enviado_por: `aceitacao-e2e ${RUN}`, arquivada: true,
    })
    criadas.push(m.id)
    await dbPatch('erp_agente_mensagem', `id=eq.${m.id}`, { arquivada, atualizado_em: ha(min) })
    return m.id
  }

  test('encerrar libera a vez na hora, só da própria sessão, e o despertador volta a disparar', { tag: '@pos-migration' }, async () => {
    const a = `teste-A-${RUN}`, b = `teste-B-${RUN}`
    await dbPatch('erp_agente_sessao_lease', `agente=eq.${AG}`, { renovada_em: ha(60) })
    expect((await iniciar(a)).resultado).toBe('ok')
    expect((await encerrar(b)).liberada, 'outra sessão não derruba a vez').toBe(false)
    expect((await iniciar(b)).resultado).toBe('ocupado')
    const id = await parada(6)
    await dbPatch('erp_agente_mensagem', `id=eq.${id}`, { arquivada: false, atualizado_em: ha(6) })
    expect((await rpc<Desp>('fn_agente_despertador', { p_somente: id, p_simular: true })).disparos, 'sessão ativa: não dispara').toEqual([])
    expect((await encerrar(a)).liberada, 'a própria sessão libera').toBe(true)
    expect((await iniciar(b)).resultado, 'livre na hora, sem esperar 12 min').toBe('ok')
    expect((await encerrar(b)).liberada).toBe(true)
    const ds = await rpc<Desp>('fn_agente_despertador', { p_somente: id, p_simular: true })
    expect(ds.disparos.map((d) => d.mensagem_id), 'lease livre: dispara').toEqual([id])
  })

  test('limiar do despertador é 5 min: parada há 4 não dispara, há 6 dispara', { tag: '@pos-migration' }, async () => {
    await dbPatch('erp_agente_sessao_lease', `agente=eq.${AG}`, { renovada_em: ha(60) })
    const nova = await parada(4)
    await dbPatch('erp_agente_mensagem', `id=eq.${nova}`, { arquivada: false, atualizado_em: ha(4) })
    expect((await rpc<Desp>('fn_agente_despertador', { p_somente: nova, p_simular: true })).disparos).toEqual([])
    await dbPatch('erp_agente_mensagem', `id=eq.${nova}`, { atualizado_em: ha(6) })
    expect((await rpc<Desp>('fn_agente_despertador', { p_somente: nova, p_simular: true })).disparos.map((d) => d.mensagem_id)).toEqual([nova])
  })

  test('gilberto-produto existe na rotina com acionamento ligado', { tag: '@pos-migration' }, async () => {
    const l = await dbSelect<{ aciona: boolean }>('erp_agente_rotina', 'agente=eq.gilberto-produto&select=aciona')
    expect(l[0]?.aciona).toBe(true)
  })
})
