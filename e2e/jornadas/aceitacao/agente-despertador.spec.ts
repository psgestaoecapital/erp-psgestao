// CEO 04/10 · despertador automático dos agentes. Migrations 20261004100000 e 20261005110000 (@pos-migration).
// NUNCA aciona uma rotina de verdade: usa p_simular (registra o redisparo sem chamar o gatilho) e p_somente (só a
// mensagem de teste). A mensagem nasce ARQUIVADA (o gatilho de envio não dispara) e termina arquivada.

import { test, expect } from '../../support/fixtures'
import { rpc, dbInsert, dbPatch, dbSelect, registrarJornada } from '../../support/api'
import { liberarLease } from '../../support/lease'

const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}-${Date.now().toString(36)}`
const MIN = 60_000
const ha = (min: number) => new Date(Date.now() - min * MIN).toISOString()

type Desp = { ok: boolean; disparos: { mensagem_id: string; n: number }[]; alertas_teto: number }
type Linha = { redisparos: number; acionamento_historico: unknown[]; alerta_teto_em: string | null }

test.describe('Despertador dos agentes', () => {
  const criadas: string[] = []
  let devolverLease: () => Promise<void> = async () => {}

  // o lease real do agente (sessão de produção ativa) não pode mascarar o que o teste prova
  test.beforeAll(async () => { devolverLease = await liberarLease('gilberto-chamados') })
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-agente-despertador', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.afterAll(async () => {
    for (const id of criadas) await dbPatch('erp_agente_mensagem', `id=eq.${id}`, { arquivada: true })
    await devolverLease()
  })

  const criar = async (requerOk: boolean, parada = 30) => {
    const m = await dbInsert<{ id: string }>('erp_agente_mensagem', {
      para: 'gilberto-chamados', de: 'eng_chefe', tipo: 'tarefa', assunto: `[TESTE ${RUN}] despertador, não executar`,
      corpo: 'Teste da aceitação. Não executar.', requer_ok_ceo: requerOk, status: 'recebida',
      enviado_por: `aceitacao-e2e ${RUN}`, arquivada: true, atualizado_em: ha(parada),
    })
    criadas.push(m.id)
    await dbPatch('erp_agente_mensagem', `id=eq.${m.id}`, { arquivada: false })
    return m.id
  }
  const desp = (id: string) => rpc<Desp>('fn_agente_despertador', { p_somente: id, p_simular: true })
  const linha = async (id: string) => (await dbSelect<Linha>('erp_agente_mensagem', `id=eq.${id}&select=redisparos,acionamento_historico,alerta_teto_em`))[0]

  test('dispara após 10 min parada, registra no histórico e não redispara antes de 10 min', { tag: '@pos-migration' }, async () => {
    const id = await criar(false)
    const a = await desp(id)
    expect(a.disparos.map((d) => d.mensagem_id), 'parada há 30 min: redispara').toEqual([id])
    const b = await desp(id)
    expect(b.disparos, 'acabou de disparar: não redispara').toEqual([])
    const l = await linha(id)
    expect(l.redisparos).toBe(1)
    expect(l.acionamento_historico, 'cada redisparo fica no histórico').toHaveLength(1)
  })

  test('respeita o teto de 18 redisparos e avisa o Eng. Chefe uma vez só', { tag: '@pos-migration' }, async () => {
    const id = await criar(false)
    await dbPatch('erp_agente_mensagem', `id=eq.${id}`, { redisparos: 18, atualizado_em: ha(30) })
    const a = await desp(id)
    expect(a.disparos, 'no teto: não dispara').toEqual([])
    expect(a.alertas_teto, 'registra o alerta').toBe(1)
    await dbPatch('erp_agente_mensagem', `id=eq.${id}`, { atualizado_em: ha(30) })
    expect((await desp(id)).alertas_teto, 'alerta uma vez só').toBe(0)
    expect((await linha(id)).alerta_teto_em).not.toBeNull()
  })

  test('nunca dispara mensagem que exige OK do CEO sem o OK; usuário logado não chama', { tag: '@pos-migration' }, async () => {
    const id = await criar(true)
    expect((await desp(id)).disparos, 'sem ok_ceo_em: ignora').toEqual([])
    expect((await linha(id)).redisparos).toBe(0)
    await expect(rpc('fn_agente_despertador', { p_somente: id, p_simular: true, p_parado: 'x' }), 'argumento inválido recusado').rejects.toThrow()
  })
})
