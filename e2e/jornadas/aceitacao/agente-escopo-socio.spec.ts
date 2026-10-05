// CEO 05/10 · escopo de agente de sócio (rodrigo-code). Migration 20261005160000 (@pos-migration).
// Só leitura/recusas: não liga rotina, não enfileira nada, não escreve em chamado de cliente.

import { test, expect } from '../../support/fixtures'
import { rpc, dbInsert, dbSelect, registrarJornada } from '../../support/api'

const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}-${Date.now().toString(36)}`

test.describe('Escopo de agente de sócio', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-agente-escopo-socio', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('escopo: chamado do Rodrigo é dele; o de outro dono não; só o sócio logado decide', { tag: '@pos-migration' }, async () => {
    const eq = await dbSelect<{ socio_user_id: string }>('erp_agente_escopo', 'agente=eq.rodrigo-code&select=socio_user_id')
    expect(eq.length, 'rodrigo-code tem linha no escopo').toBe(1)
    const socio = eq[0].socio_user_id
    const dele = await dbSelect<{ id: string }>('sugestoes', `user_id=eq.${socio}&select=id&limit=1`)
    const alheio = await dbSelect<{ id: string }>('sugestoes', `user_id=neq.${socio}&responsavel_id=neq.${socio}&company_id=not.is.null&select=id&limit=40`)
    expect(dele.length).toBeGreaterThan(0)
    expect(await rpc<boolean>('fn_agente_escopo_chamado', { p_agente: 'rodrigo-code', p_chamado: dele[0].id })).toBe(true)
    let fora = 0
    for (const a of alheio) {
      if (!(await rpc<boolean>('fn_agente_escopo_chamado', { p_agente: 'rodrigo-code', p_chamado: a.id }))) { fora++; break }
    }
    expect(fora, 'existe chamado fora do escopo e ele é recusado').toBe(1)
    // conexão de serviço não é usuário: não consegue dar o OK do sócio
    const r = await rpc<{ ok: boolean; erro?: string }>('fn_agente_ok_socio', { p_mensagem_id: '00000000-0000-0000-0000-000000000000', p_decisao: 'aprovado' })
    expect(r.ok).toBe(false)
  })

  test('caixa: tarefa para agente de sócio sem origem de chamado é recusada pelo banco; rodrigo-code segue desligado até o Eng. Chefe ligar', { tag: '@pos-migration' }, async () => {
    await expect(dbInsert('erp_agente_mensagem', {
      para: 'rodrigo-code', de: 'eng_chefe', tipo: 'tarefa', assunto: `[TESTE ${RUN}] não deve entrar`, corpo: 'Teste da aceitação.',
      requer_ok_ceo: false, status: 'recebida', enviado_por: `aceitacao-e2e ${RUN}`, arquivada: true,
    })).rejects.toThrow()
    const fila = await dbSelect('erp_agente_chamado_fila', 'select=id&limit=1')
    expect(Array.isArray(fila), 'fila acessível pelo serviço').toBe(true)
  })
})
