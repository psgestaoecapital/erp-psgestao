// Chamados · APROVAR = O CLIENTE RECEBE E O CHAMADO ANDA (CEO 27/09). Antes, aprovar a resposta gravava a mensagem e
// avisava o cliente, mas o status ficava "nova"/"em desenvolvimento" — para o cliente, parado. Agora: aprovar leva
// a "aguardando_confirmacao"; o cliente respondendo no chamado devolve para a fila da PS.
// Fila da PS = "nova" ou "em_desenvolvimento": o gatilho trg_sugestao_guard_pr_numero (já existente) só deixa
// "em_desenvolvimento" em chamado com PR vinculado; sem PR, o status fica "nova". O teste de 27/09 exigia
// "em_desenvolvimento" num chamado sem PR e caiu em produção (run 36320952508) — a regra do produto estava certa.
// Migration 20260927170000 · @pos-migration. RPCs chamadas COMO O ROBÔ (PS_ADMIN e autor do chamado de teste).
// Chamado de teste na Demonstração Comércio (GE), arquivado no fim.

import { test, expect } from '../../support/fixtures'
import { dbSelect, dbInsert, dbPatch, registrarJornada, obterSessionPayload } from '../../support/api'

const DEMO_COMERCIO = 'b0700000-0000-4000-a000-000000000004'
const ROBO = '74cf7dfa-4af5-4ef5-bd58-6a2166ea4cfa'
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}-${Date.now().toString(36)}`

test.describe('Chamado — aprovar a resposta muda o status', () => {
  let id = ''
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-chamado-aprovar-anda', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.afterAll(async () => { if (id) await dbPatch('sugestoes', `id=eq.${id}`, { status: 'arquivada' }) })

  test('aprovar → aguardando confirmação; cliente responde → volta para a PS @pos-migration', async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_COMERCIO}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    id = (await dbInsert<{ id: string }>('sugestoes', { company_id: DEMO_COMERCIO, user_id: ROBO, user_email: 'screenshot@psgestao.com',
      user_name: 'robô aceitação', titulo: `Aceitação aprovar-anda ${RUN}`, descricao: 'chamado de teste (aceitação)', status: 'nova', categoria: 'bug', tipo: 'bug' })).id

    const token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
    const chamar = async (fn: string, args: Record<string, unknown>) => {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST',
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args) })
      if (!r.ok) throw new Error(`${fn}: ${r.status} ${await r.text()}`)
      return (await r.json()) as { ok: boolean; status?: string }
    }
    const status = async () => (await dbSelect<{ status: string }>('sugestoes', `id=eq.${id}&select=status`))[0]?.status
    // chamado de teste sem PR vinculado → a fila da PS aparece como "nova" (gatilho do pr_numero)
    const FILA_PS = ['nova', 'em_desenvolvimento']

    expect((await chamar('fn_sugestao_responder', { p_id: id, p_texto: 'Resolvido — teste de aceitação.', p_user: ROBO, p_redigida_por: null, p_origem: 'assistente' })).ok).toBe(true)
    expect(FILA_PS, 'rascunho não muda para o cliente (continua na fila da PS)').toContain(await status())

    const ap = await chamar('fn_sugestao_aprovar_resposta', { p_id: id, p_user: ROBO })
    expect(ap.ok).toBe(true)
    expect(await status(), 'aprovou → o chamado anda').toBe('aguardando_confirmacao')
    const msgs = await dbSelect<{ papel: string }>('sugestao_mensagem', `sugestao_id=eq.${id}&papel=eq.ps&select=papel`)
    expect(msgs.length, 'a resposta entrou na conversa').toBeGreaterThan(0)

    expect((await chamar('fn_sugestao_mensagem_enviar', { p_sugestao_id: id, p_user: ROBO, p_texto: 'ainda não funcionou', p_anexos: [] })).ok).toBe(true)
    const depois = await status()
    expect(depois, 'o cliente respondeu → sai de "aguardando confirmação"').not.toBe('aguardando_confirmacao')
    expect(FILA_PS, 'o cliente respondeu → volta para a fila da PS').toContain(depois)
  })
})
