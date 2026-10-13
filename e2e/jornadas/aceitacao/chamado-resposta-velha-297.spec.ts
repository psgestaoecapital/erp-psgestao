// Chamados · defeito do #297 (CEO 01/10): mensagem do autor NUNCA leva a "aguardando confirmação" sem resposta NOVA.
// Antes: depois do cliente escrever, a resposta já enviada ficava no campo de rascunho; a fila mostrava "esperando você"
// e "Aprovar e enviar" reenviava a mesma resposta, devolvendo o chamado ao cliente sem resposta (#297, #116, #339, #587).
// Migration 20261002110000 · @pos-migration. RPCs COMO O ROBÔ (PS_ADMIN e autor do chamado de teste), na Demonstração
// Comércio (GE); o chamado de teste é arquivado no fim.

import { test, expect } from '../../support/fixtures'
import { dbSelect, dbInsert, dbPatch, registrarJornada, obterSessionPayload } from '../../support/api'

const DEMO_COMERCIO = 'b0700000-0000-4000-a000-000000000004'
const ROBO = '74cf7dfa-4af5-4ef5-bd58-6a2166ea4cfa'
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}-${Date.now().toString(36)}`

test.describe('Chamado — resposta velha não volta nem é reenviada', () => {
  let id = ''
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-chamado-resposta-velha', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.afterAll(async () => { if (id) await dbPatch('sugestoes', `id=eq.${id}`, { status: 'arquivada' }) })

  test('cliente escreve depois da resposta → rascunho limpo; reaprovar a velha é recusado; resposta nova anda', { tag: '@pos-migration' }, async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_COMERCIO}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    id = (await dbInsert<{ id: string }>('sugestoes', { company_id: DEMO_COMERCIO, user_id: ROBO, user_email: 'screenshot@psgestao.com',
      user_name: 'robô aceitação', titulo: `Aceitação resposta velha ${RUN}`, descricao: 'chamado de teste (aceitação)', status: 'nova', categoria: 'bug', tipo: 'bug' })).id

    const token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
    const chamar = async (fn: string, args: Record<string, unknown>) => {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST',
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args) })
      if (!r.ok) throw new Error(`${fn}: ${r.status} ${await r.text()}`)
      return (await r.json()) as { ok: boolean; erro?: string; status?: string }
    }
    const linha = async () => (await dbSelect<{ status: string; resposta: string | null; resposta_aprovada: boolean }>('sugestoes',
      `id=eq.${id}&select=status,resposta,resposta_aprovada`))[0]
    const VELHA = `Resposta antiga ${RUN}`

    expect((await chamar('fn_sugestao_responder', { p_id: id, p_texto: VELHA, p_user: ROBO, p_redigida_por: null, p_origem: 'assistente' })).ok).toBe(true)
    expect((await chamar('fn_sugestao_aprovar_resposta', { p_id: id, p_user: ROBO })).ok).toBe(true)
    expect((await linha()).status).toBe('aguardando_confirmacao')

    // o cliente escreve na conversa
    expect((await chamar('fn_sugestao_mensagem_enviar', { p_sugestao_id: id, p_user: ROBO, p_texto: 'Atualização: achamos a documentação', p_anexos: [] })).ok).toBe(true)
    const depois = await linha()
    expect(depois.status, 'saiu de "aguardando confirmação"').not.toBe('aguardando_confirmacao')
    expect(depois.resposta, 'a resposta já enviada saiu do rascunho (continua na conversa)').toBeNull()
    expect(depois.resposta_aprovada, 'não fica como "esperando o autor"').toBe(false)
    const naConversa = await dbSelect<{ texto: string }>('sugestao_mensagem', `sugestao_id=eq.${id}&papel=eq.ps&select=texto`)
    expect(naConversa.some((m) => m.texto === VELHA), 'nada se perde: a resposta antiga continua na conversa').toBe(true)

    // tentar reaprovar a MESMA resposta → recusado, status não muda
    expect((await chamar('fn_sugestao_responder', { p_id: id, p_texto: VELHA, p_user: ROBO, p_redigida_por: null, p_origem: 'assistente' })).ok).toBe(true)
    const re = await chamar('fn_sugestao_aprovar_resposta', { p_id: id, p_user: ROBO })
    expect(re.ok).toBe(false)
    expect(re.erro).toBe('resposta_ja_enviada')
    expect((await linha()).status, 'continua com a PS').not.toBe('aguardando_confirmacao')

    // resposta NOVA → anda normalmente
    expect((await chamar('fn_sugestao_responder', { p_id: id, p_texto: `Resposta nova ${RUN}`, p_user: ROBO, p_redigida_por: null, p_origem: 'assistente' })).ok).toBe(true)
    expect((await chamar('fn_sugestao_aprovar_resposta', { p_id: id, p_user: ROBO })).ok).toBe(true)
    expect((await linha()).status).toBe('aguardando_confirmacao')
  })
})
