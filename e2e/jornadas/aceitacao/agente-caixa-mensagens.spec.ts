// CEO 03/10 · fim do copia e cola: caixa de mensagens dos agentes (erp_agente_mensagem). Migration 20261003105000
// (@pos-migration). O Eng. Chefe escreve pela conexão de serviço (aqui, o service_role); o usuário logado (o robô) não
// lê nem grava. NUNCA dispara uma rotina de verdade: só manda AVISO a Code de sócio (sem acionamento) e uma TAREFA com
// requer_ok_ceo que nunca recebe o OK. Tudo de teste sai arquivado (nada é apagado).

import { test, expect } from '../../support/fixtures'
import { rpc, registrarJornada, obterSessionPayload } from '../../support/api'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}-${Date.now().toString(36)}`

type Envio = { ok: boolean; id: string; acionamento: { acionou: boolean; motivo?: string } | null }
type Caixa = { ok: boolean; mensagens: { id: string; status: string; pode_executar: boolean; assunto: string; enviado_por: string }[] }
type Resp = { ok: boolean; erro?: string; status?: string }

test.describe('Caixa de mensagens dos agentes', () => {
  const criadas: string[] = []

  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-agente-caixa', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.afterAll(async () => {
    for (const id of criadas) await rpc('fn_agente_mensagem_arquivar', { p_mensagem_id: id })
  })

  const enviar = async (para: string, tipo: 'tarefa' | 'aviso', requerOk = false) => {
    const r = await rpc<Envio>('fn_agente_mensagem_enviar', {
      p_para: para, p_de: 'eng_chefe', p_tipo: tipo, p_assunto: `[TESTE ${RUN}] não executar`,
      p_corpo: 'Mensagem de teste da aceitação. Não executar.', p_requer_ok_ceo: requerOk,
      p_enviado_por: `aceitacao-e2e ${RUN}`,
    })
    if (r.id) criadas.push(r.id)
    return r
  }

  test('aviso a Code de sócio entra sem acionar rotina; tarefa a Code de sócio é recusada pelo banco', { tag: '@pos-migration' }, async () => {
    const a = await enviar('andre-code', 'aviso')
    expect(a.ok).toBe(true)
    expect(a.acionamento?.acionou, 'Code de sócio não tem rotina acionada').toBe(false)
    expect(a.acionamento?.motivo).toBe('agente_sem_acionamento')
    await expect(enviar('andre-code', 'tarefa'), 'aos sócios só aviso de coordenação').rejects.toThrow(/socio_so_aviso|check/i)
  })

  test('o Code lê a própria caixa, responde na mensagem e não mexe na de outro', { tag: '@pos-migration' }, async () => {
    const { id } = await enviar('stephany-code', 'aviso')
    const caixa = await rpc<Caixa>('fn_agente_caixa', { p_agente: 'stephany-code' })
    const m = caixa.mensagens.find((x) => x.id === id)
    expect(m?.status, 'ao ler, a nova vira recebida').toBe('recebida')
    expect(m?.pode_executar).toBe(true)
    expect(m?.enviado_por, 'fica gravado quem enviou (declarado + sessão)').toContain(`aceitacao-e2e ${RUN}`)
    expect((await rpc<Resp>('fn_agente_mensagem_responder', { p_mensagem_id: id, p_agente: 'jordana-code', p_status: 'concluida', p_resposta: 'x' })).erro)
      .toBe('mensagem_de_outro_agente')
    expect((await rpc<Resp>('fn_agente_mensagem_responder', { p_mensagem_id: id, p_agente: 'stephany-code', p_status: 'concluida' })).erro,
      'concluir exige o BOX').toBe('resposta_obrigatoria')
    expect((await rpc<Resp>('fn_agente_mensagem_responder', { p_mensagem_id: id, p_agente: 'stephany-code', p_status: 'em_andamento' })).status).toBe('em_andamento')
    expect((await rpc<Resp>('fn_agente_mensagem_responder', { p_mensagem_id: id, p_agente: 'stephany-code', p_status: 'concluida', p_resposta: `BOX teste ${RUN}` })).status).toBe('concluida')
    expect((await rpc<Resp>('fn_agente_mensagem_responder', { p_mensagem_id: id, p_agente: 'stephany-code', p_status: 'em_andamento' })).erro,
      'encerrada não reabre').toBe('mensagem_encerrada')
  })

  test('tarefa com OK do CEO pendente não aciona a rotina nem pode ser executada', { tag: '@pos-migration' }, async () => {
    const t = await enviar('gilberto-chamados', 'tarefa', true)
    expect(t.acionamento?.acionou, 'sem o OK registrado, nada é disparado').toBe(false)
    expect(t.acionamento?.motivo).toBe('aguarda_ok_ceo')
    expect((await rpc<Resp>('fn_agente_mensagem_responder', { p_mensagem_id: t.id, p_agente: 'gilberto-chamados', p_status: 'em_andamento' })).erro)
      .toBe('aguarda_ok_ceo')
    // arquiva já: a mensagem de teste não fica na caixa real do gilberto-chamados
    await rpc('fn_agente_mensagem_arquivar', { p_mensagem_id: t.id })
  })

  test('usuário logado do ERP não lê nem grava a caixa (canal protegido)', { tag: '@pos-migration' }, async () => {
    const token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
    const h = { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    const tabela = await fetch(`${SUPABASE_URL}/rest/v1/erp_agente_mensagem?select=id&limit=1`, { headers: h })
    expect(tabela.ok, 'tabela fechada ao usuário logado').toBe(false)
    const fn = await fetch(`${SUPABASE_URL}/rest/v1/rpc/fn_agente_caixa`, { method: 'POST', headers: h, body: JSON.stringify({ p_agente: 'gilberto-desenv' }) })
    expect(fn.ok, 'função fechada ao usuário logado').toBe(false)
    const envio = await fetch(`${SUPABASE_URL}/rest/v1/rpc/fn_agente_mensagem_enviar`, {
      method: 'POST', headers: h,
      body: JSON.stringify({ p_para: 'gilberto-desenv', p_de: 'ceo', p_tipo: 'tarefa', p_assunto: 'x', p_corpo: 'y', p_requer_ok_ceo: true }),
    })
    expect(envio.ok, 'logado não envia tarefa').toBe(false)
  })
})
