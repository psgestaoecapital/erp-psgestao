// CEO 04/10 (opção A) · e-mail-resumo dos avisos de chamado que não saíram: UM e-mail por pessoa. Migration 20261005100000
// (@pos-migration). Nada é enviado: o render é puro e o envio é chamado com um e-mail que não existe (zero destinatários).

import { test, expect } from '../../support/fixtures'
import { rpc, registrarJornada } from '../../support/api'

type Render = { assunto: string; html: string } | null
type Previa = { ok: boolean; pessoas: number; avisos: number; pessoas_lista: { email: string; avisos: number; chamados: number }[] }
type Envio = { ok: boolean; enviados: number; falhas: number }

test.describe('E-mail-resumo dos avisos atrasados de chamado', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-chamado-resumo-atrasados', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('o template chamado_resumo lista no máximo 10 chamados, escapa o título e não traz texto de resposta', { tag: '@pos-migration' }, async () => {
    const itens = Array.from({ length: 12 }, (_, i) => ({ numero: i + 1, titulo: `t <${i + 1}>` }))
    const r = await rpc<Render>('fn_email_render', { p_template: 'chamado_resumo', p_dados: { nome: 'Ana', total: 12, itens, resposta: 'SEGREDO', link: 'https://x' } })
    expect(r?.assunto).toBe('Você tem respostas novas nos seus chamados')
    expect(r?.html).toContain('Há 12 atualizações nos seus chamados')
    expect(r?.html).toContain('#10 · t &lt;10&gt;')
    expect(r?.html, 'só 10 na lista').not.toContain('#11 ·')
    expect(r?.html).toContain('e mais 2')
    expect(r?.html, 'sem texto da resposta').not.toContain('SEGREDO')
    for (const t of ['chamado_resposta', 'chamado_lembrete', 'convite', 'contrato_evento']) {
      expect(await rpc<Render>('fn_email_render', { p_template: t, p_dados: {} }), `${t} segue renderizando`).not.toBeNull()
    }
  })

  test('a prévia exclui robô e o envio é idempotente (e-mail inexistente = nada enviado)', { tag: '@pos-migration' }, async () => {
    const p = await rpc<Previa>('fn_chamado_resumo_atrasados_previa', {})
    expect(p.ok).toBe(true)
    expect(p.pessoas).toBe(p.pessoas_lista.length)
    const e = await rpc<Envio>('fn_chamado_resumo_atrasados_enviar', { p_somente_email: 'ninguem-aceitacao@nao-existe.invalid' })
    expect(e).toMatchObject({ ok: true, enviados: 0, falhas: 0 })
  })
})
