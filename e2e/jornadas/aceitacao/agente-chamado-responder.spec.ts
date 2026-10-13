// CEO 04/10 (opção A) · função oficial "agente responde chamado" + e-mails de aviso de chamado. Migration
// 20261004130000 (@pos-migration). Nada é postado em chamado real: a mensagem de teste nunca recebe o OK do CEO (a função
// tem de recusar) e sai arquivada. O render dos e-mails é puro (sem envio).

import { test, expect } from '../../support/fixtures'
import { rpc, registrarJornada } from '../../support/api'

const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}-${Date.now().toString(36)}`
const SEM_ID = '00000000-0000-0000-0000-000000000000'

type Render = { assunto: string; html: string } | null
type Resp = { ok: boolean; erro?: string }
type Envio = { ok: boolean; id: string }

test.describe('Agente responde chamado e e-mails de chamado', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-agente-chamado-responder', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('o e-mail do chamado tem template (era "template desconhecido: chamado_resposta") e os demais continuam', { tag: '@pos-migration' }, async () => {
    const resp = await rpc<Render>('fn_email_render', { p_template: 'chamado_resposta', p_dados: { numero: 1, titulo_chamado: 't', resposta: 'a < b', link: 'https://x' } })
    expect(resp?.assunto, 'chamado_resposta renderiza').toContain('Respondemos seu chamado')
    expect(resp?.html, 'a resposta vai escapada').toContain('a &lt; b')
    expect((await rpc<Render>('fn_email_render', { p_template: 'chamado_lembrete', p_dados: { numero: 1 } }))?.assunto).toContain('Lembrete')
    for (const t of ['convite', 'reset_senha', 'boas_vindas', 'revenda_convite_contador', 'contrato_evento']) {
      expect(await rpc<Render>('fn_email_render', { p_template: t, p_dados: {} }), `${t} segue renderizando`).not.toBeNull()
    }
    expect(await rpc<Render>('fn_email_render', { p_template: 'nao_existe', p_dados: {} }), 'desconhecido continua nulo').toBeNull()
  })

  test('a função oficial só posta com OK do CEO registrado na caixa', { tag: '@pos-migration' }, async () => {
    const env = await rpc<Envio>('fn_agente_mensagem_enviar', {
      p_para: 'gilberto-chamados', p_de: 'eng_chefe', p_tipo: 'tarefa', p_assunto: `[TESTE ${RUN}] não executar`,
      p_corpo: 'Teste da aceitação: nunca recebe o OK.', p_requer_ok_ceo: true, p_enviado_por: `aceitacao-e2e ${RUN}`,
    })
    try {
      const r = await rpc<Resp>('fn_agente_chamado_responder', { p_mensagem_agente: env.id, p_sugestao_id: SEM_ID, p_texto: 'x' })
      expect(r.erro, 'sem OK do CEO a função recusa').toBe('sem_ok_do_ceo')
      const inexistente = await rpc<Resp>('fn_agente_chamado_responder', { p_mensagem_agente: SEM_ID, p_sugestao_id: SEM_ID, p_texto: 'x' })
      expect(inexistente.erro).toBe('mensagem_nao_encontrada')
    } finally {
      await rpc('fn_agente_mensagem_arquivar', { p_mensagem_id: env.id })
    }
  })
})
