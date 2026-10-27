// CEO 05/10 · escopo de agente de sócio (rodrigo-code) + OK do sócio. Migration 20261005170000 (@pos-migration).
// Só leitura de chamados reais + mensagens de TESTE arquivadas (nunca recebem OK; nada é postado em chamado, nada é acionado).

import { test, expect } from '../../support/fixtures'
import { rpc, dbInsert, dbPatch, dbSelect, registrarJornada } from '../../support/api'

const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}-${Date.now().toString(36)}`
type Resp = { ok?: boolean; erro?: string; dono?: string }
type Chamado = { id: string }

test.describe('Escopo de agente de sócio e OK do sócio', () => {
  const criadas: string[] = []
  let rodrigo = ''
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-agente-socio-escopo', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.afterAll(async () => { for (const id of criadas) await dbPatch('erp_agente_mensagem', `id=eq.${id}`, { arquivada: true }) })
  test.beforeAll(async () => {
    const e = await dbSelect<{ socio_user_id: string; ativo: boolean }>('erp_agente_escopo', 'agente=eq.rodrigo-code&select=socio_user_id,ativo')
    expect(e.length, 'rodrigo-code tem escopo').toBe(1)
    rodrigo = e[0].socio_user_id
  })

  const msg = async (para: string, extra: Record<string, unknown> = {}) => {
    const m = await dbInsert<{ id: string }>('erp_agente_mensagem', {
      para, de: 'eng_chefe', tipo: 'tarefa', assunto: `[TESTE ${RUN}] escopo, não executar`, corpo: 'Teste da aceitação. Não executar.',
      status: 'recebida', enviado_por: `aceitacao-e2e ${RUN}`, arquivada: true, ...extra,
    })
    criadas.push(m.id)
    return m.id
  }

  test('escopo: aberto pelo sócio ou com ele de responsável; de outro, não', { tag: '@pos-migration' }, async () => {
    const meu = await dbSelect<Chamado>('sugestoes', `user_id=eq.${rodrigo}&select=id&limit=1`)
    const resp = await dbSelect<Chamado>('sugestoes', `responsavel_id=eq.${rodrigo}&user_id=neq.${rodrigo}&select=id&limit=1`)
    const outro = await dbSelect<Chamado>('sugestoes', `responsavel_id=neq.${rodrigo}&user_id=neq.${rodrigo}&select=id&limit=1`)
    for (const c of [meu[0], resp[0]]) {
      expect(await rpc<boolean>('fn_agente_escopo_chamado', { p_agente: 'rodrigo-code', p_chamado: c.id })).toBe(true)
      expect(await rpc<string>('fn_chamado_agente_dono', { p_chamado: c.id })).toBe('rodrigo-code')
    }
    expect(await rpc<boolean>('fn_agente_escopo_chamado', { p_agente: 'rodrigo-code', p_chamado: outro[0].id })).toBe(false)
    expect(await rpc<string | null>('fn_chamado_agente_dono', { p_chamado: outro[0].id })).toBeNull()
  })

  test('guarda: outro agente não age em chamado de sócio; agente de sócio só com OK do sócio', { tag: '@pos-migration' }, async () => {
    const meu = (await dbSelect<Chamado>('sugestoes', `user_id=eq.${rodrigo}&select=id&limit=1`))[0]
    const outro = (await dbSelect<Chamado>('sugestoes', `responsavel_id=neq.${rodrigo}&user_id=neq.${rodrigo}&select=id&limit=1`))[0]
    const chm = await msg('gilberto-chamados', { requer_ok_ceo: true, ok_ceo_em: new Date().toISOString(), ok_ceo_origem: 'teste' })
    const r1 = await rpc<Resp>('fn_agente_chamado_responder', { p_mensagem_agente: chm, p_sugestao_id: meu.id, p_texto: 'x' })
    expect(r1.erro, 'gilberto-chamados barrado').toBe('chamado_de_agente_socio')
    const rod = await msg('rodrigo-code')
    const r2 = await rpc<Resp>('fn_agente_chamado_responder', { p_mensagem_agente: rod, p_sugestao_id: meu.id, p_texto: 'x' })
    expect(r2.erro, 'sem OK do sócio').toBe('sem_ok_do_socio')
    // com pedido mas sem decisão, continua barrado; fora do escopo também
    expect((await rpc<Resp>('fn_agente_pedir_ok_socio', { p_mensagem_id: rod, p_agente: 'rodrigo-code', p_texto: 'x' })).ok).toBe(true)
    expect((await rpc<Resp>('fn_agente_chamado_responder', { p_mensagem_agente: rod, p_sugestao_id: meu.id, p_texto: 'x' })).erro).toBe('sem_ok_do_socio')
    await dbPatch('erp_agente_mensagem', `id=eq.${rod}`, { ok_socio_decisao: 'aprovado', ok_socio_em: new Date().toISOString(), ok_socio_por: rodrigo })
    expect((await rpc<Resp>('fn_agente_chamado_responder', { p_mensagem_agente: rod, p_sugestao_id: outro.id, p_texto: 'x' })).erro).toBe('chamado_fora_do_escopo')
  })

  test('OK só pelo sócio logado: a conexão de serviço não aprova', { tag: '@pos-migration' }, async () => {
    const rod = await msg('rodrigo-code')
    await rpc('fn_agente_pedir_ok_socio', { p_mensagem_id: rod, p_agente: 'rodrigo-code', p_texto: 'x' })
    expect((await rpc<Resp>('fn_agente_ok_socio', { p_mensagem_id: rod, p_decisao: 'aprovado' })).erro).toBe('nao_autenticado')
    expect((await rpc<Resp>('fn_agente_pedir_ok_socio', { p_mensagem_id: rod, p_agente: 'andre-code', p_texto: 'x' })).erro).toBe('mensagem_de_outro_agente')
  })
})
