// Canal PS · PR B (CEO 07/10 16:20) — conector MCP do ERP (/api/mcp) para a Claude do sócio. Migration 20261008000160.
//   1) chamada sem login: recusada (401 com o endereço dos metadados OAuth) — roda em qualquer ambiente;
//   2) ferramenta inexistente: recusada (-32602) — como usuário logado;
//   3) "Rodrigo" lista só a carteira dele (e não lê chamado de fora);
//   4) enviar_tarefa_ao_meu_code cria a mensagem na caixa do rodrigo-code e aciona a rotina; a chamada fica registrada.
// 3 e 4 só no BANCO DE TESTES: o robô (único login de teste) vira por alguns segundos o dono do rodrigo-code, com a
// demonstração GE na carteira; um chamado de teste é aberto na GE e outro na Revenda (fora da carteira) e tudo volta no fim.
import { test, expect } from '../../support/fixtures'
import { dbDelete, dbInsert, dbPatch, dbSelect, obterSessionPayload, registrarJornada } from '../../support/api'

const ROBO = '74cf7dfa-4af5-4ef5-bd58-6a2166ea4cfa'
const DEMO_GE = 'b0700000-0000-4000-a000-000000000004'
const DEMO_REVENDA = 'b0700000-0000-4000-a000-000000000003'
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const PRODUCAO = SUPABASE_URL.includes('horsymhsinqcimflrtjo')
const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}-${Date.now().toString(36)}`

type Rpc = { jsonrpc: string; id: number; result?: { isError?: boolean; structuredContent?: Record<string, unknown>; content?: { text: string }[] }; error?: { code: number; message: string } }
const token = async () => (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token

test.describe('Canal PS — conector MCP', () => {
  test.describe.configure({ mode: 'serial' })
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-canal-ps-conector', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('chamada sem login é recusada com o endereço do login OAuth', async ({ request }) => {
    const r = await request.post('/api/mcp', { data: { jsonrpc: '2.0', id: 1, method: 'tools/list' } })
    expect(r.status(), 'sem token → 401').toBe(401)
    expect(r.headers()['www-authenticate'] ?? '', 'aponta os metadados do recurso').toContain('/.well-known/oauth-protected-resource/api/mcp')
    const meta = await request.get('/.well-known/oauth-protected-resource/api/mcp')
    expect(meta.ok()).toBe(true)
    const m = (await meta.json()) as { resource: string; authorization_servers: string[] }
    expect(m.resource.endsWith('/api/mcp')).toBe(true)
    expect(m.authorization_servers[0], 'servidor de autorização = Supabase Auth do ERP').toMatch(/\/auth\/v1$/)
  })

  test('ferramenta inexistente é recusada', { tag: '@pos-migration' }, async ({ request }) => {
    const r = await request.post('/api/mcp', { headers: { Authorization: `Bearer ${await token()}` },
      data: { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'apagar_tudo', arguments: {} } } })
    expect(r.status()).toBe(200)
    const b = (await r.json()) as Rpc
    expect(b.error?.code, 'ferramenta fora da lista').toBe(-32602)
    const lista = (await (await request.post('/api/mcp', { headers: { Authorization: `Bearer ${await token()}` },
      data: { jsonrpc: '2.0', id: 3, method: 'tools/list' } })).json()) as { result: { tools: { name: string }[] } }
    expect(lista.result.tools.map((t) => t.name).sort()).toEqual(
      ['enviar_tarefa_ao_meu_code', 'ler_chamado', 'meus_chamados', 'minhas_prs', 'pedir_ok_ceo', 'respostas_do_meu_code'])
  })

  test.describe('como dono do rodrigo-code (só no banco de testes)', () => {
    const salvo: { dono: { user_id: string; ativo: boolean } | null; carteira: { id: string; responsavel_id: string | null } | null; carteiraCriada: string | null; chamados: string[] } =
      { dono: null, carteira: null, carteiraCriada: null, chamados: [] }
    let numDaCarteira = 0
    let numDeFora = 0

    test.beforeAll(async () => {
      if (PRODUCAO) return
      const [d] = await dbSelect<{ user_id: string; ativo: boolean }>('erp_agente_dono', 'agente=eq.rodrigo-code&select=user_id,ativo')
      salvo.dono = d ?? null
      if (d) await dbPatch('erp_agente_dono', 'agente=eq.rodrigo-code', { user_id: ROBO, ativo: true })
      else await dbInsert('erp_agente_dono', { agente: 'rodrigo-code', user_id: ROBO, remetente_chat: 'rodrigo-chat', ativo: true })
      const [vig] = await dbSelect<{ id: string; responsavel_id: string | null }>('erp_carteira_responsavel', `company_id=eq.${DEMO_GE}&vigencia_fim=is.null&select=id,responsavel_id`)
      if (vig) { salvo.carteira = vig; await dbPatch('erp_carteira_responsavel', `id=eq.${vig.id}`, { responsavel_id: ROBO }) }
      else salvo.carteiraCriada = (await dbInsert<{ id: string }>('erp_carteira_responsavel', { company_id: DEMO_GE, responsavel_id: ROBO, motivo: `aceitação conector ${RUN}` })).id
      for (const [emp, t] of [[DEMO_GE, 'carteira'], [DEMO_REVENDA, 'fora']] as const) {
        const c = await dbInsert<{ id: string }>('sugestoes', { company_id: emp, user_id: null, user_email: 'cliente-demo@psgestao.com', user_name: 'cliente demo',
          titulo: `Aceitação conector ${t} ${RUN}`, descricao: 'chamado de teste (Canal PS)', status: 'nova', categoria: 'bug', tipo: 'bug' })
        salvo.chamados.push(c.id)
        const [n] = await dbSelect<{ numero: number }>('sugestoes', `id=eq.${c.id}&select=numero`)
        if (t === 'carteira') numDaCarteira = n.numero; else numDeFora = n.numero
      }
    })

    test.afterAll(async () => {
      if (PRODUCAO) return
      await dbDelete('erp_agente_mensagem', `de=eq.rodrigo-chat&assunto=like.${encodeURIComponent('Aceitação conector*')}`)
      for (const id of salvo.chamados) await dbPatch('sugestoes', `id=eq.${id}`, { status: 'arquivada', atendente_id: null })
      if (salvo.dono) await dbPatch('erp_agente_dono', 'agente=eq.rodrigo-code', { user_id: salvo.dono.user_id, ativo: salvo.dono.ativo })
      else await dbDelete('erp_agente_dono', 'agente=eq.rodrigo-code')
      if (salvo.carteira) await dbPatch('erp_carteira_responsavel', `id=eq.${salvo.carteira.id}`, { responsavel_id: salvo.carteira.responsavel_id })
      if (salvo.carteiraCriada) await dbDelete('erp_carteira_responsavel', `id=eq.${salvo.carteiraCriada}`)
    })

    const chamar = async (request: import('@playwright/test').APIRequestContext, name: string, args: Record<string, unknown>) => {
      const r = await request.post('/api/mcp', { headers: { Authorization: `Bearer ${await token()}` },
        data: { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name, arguments: args } } })
      expect(r.status()).toBe(200)
      return (await r.json()) as Rpc
    }

    test('lista só a carteira dele e não lê chamado de fora', { tag: '@pos-migration' }, async ({ request }) => {
      test.skip(PRODUCAO, 'na produção o robô não vira dono de Code — prova no banco de testes')
      const r = await chamar(request, 'meus_chamados', { status: 'abertos', limite: 100 })
      expect(r.result?.isError, r.result?.content?.[0]?.text).toBe(false)
      const lista = (r.result?.structuredContent?.chamados ?? []) as { numero: number; empresa_id: string }[]
      expect(lista.some((c) => c.numero === numDaCarteira), 'o chamado da carteira aparece').toBe(true)
      expect(lista.every((c) => c.empresa_id === DEMO_GE), 'só empresas da carteira dele').toBe(true)
      expect(lista.some((c) => c.numero === numDeFora), 'o de fora não aparece').toBe(false)
      const fora = await chamar(request, 'ler_chamado', { numero: numDeFora })
      expect(fora.result?.isError, 'ler chamado de fora da carteira: recusado').toBe(true)
      expect(fora.result?.content?.[0]?.text).toContain('fora_da_carteira')
      const dentro = await chamar(request, 'ler_chamado', { numero: numDaCarteira })
      expect(dentro.result?.isError).toBe(false)
    })

    test('enviar_tarefa cria a mensagem na caixa do rodrigo-code e aciona', { tag: '@pos-migration' }, async ({ request }) => {
      test.skip(PRODUCAO, 'prova no banco de testes')
      const desde = new Date(Date.now() - 5_000).toISOString()
      const r = await chamar(request, 'enviar_tarefa_ao_meu_code', { assunto: `Aceitação conector ${RUN}`, texto: 'tarefa pelo Canal PS', chamado_numero: numDaCarteira })
      expect(r.result?.isError, r.result?.content?.[0]?.text).toBe(false)
      const id = r.result?.structuredContent?.id as string
      const [m] = await dbSelect<{ para: string; de: string; tipo: string; acionamento: { motivo?: string } | null; chamado_numero: number }>(
        'erp_agente_mensagem', `id=eq.${id}&select=para,de,tipo,acionamento,chamado_numero`)
      expect([m.para, m.de, m.tipo, m.chamado_numero]).toEqual(['rodrigo-code', 'rodrigo-chat', 'tarefa', numDaCarteira])
      expect(m.acionamento, 'a rotina do rodrigo-code foi acionada').not.toBeNull()
      expect(m.acionamento?.motivo).not.toBe('aguarda_ok_ceo')
      const reg = await dbSelect<{ ferramenta: string; ok: boolean }>('erp_canal_ps_chamada',
        `user_id=eq.${ROBO}&ferramenta=eq.enviar_tarefa_ao_meu_code&criado_em=gte.${desde}&select=ferramenta,ok`)
      expect(reg.some((x) => x.ok), 'a chamada ficou registrada (usuário, ferramenta, quando, resultado)').toBe(true)
    })
  })
})
