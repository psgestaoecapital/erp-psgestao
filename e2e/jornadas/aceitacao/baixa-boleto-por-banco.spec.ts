// Baixa automática de boleto ciente do BANCO (CEO 29/09 · aprovada; #297). Migration 20260930090000 (@pos-migration).
// Prova na Demonstração Comércio (GE), como o robô: o mesmo nosso número em dois bancos (Sicoob 756 e Sicredi 748) —
// baixar pelo Sicredi baixa SÓ o título do Sicredi, uma vez só (segunda chamada = já liquidado), sem banco não baixa nada,
// e o repetido (empresa+banco+nosso número) é barrado. Execuções: 2 falhas seguidas da empresa/banco viram alerta
// (fn_boleto_liquidacao_status → briefing) e somem depois de uma execução ok. A rota do botão responde com os bancos que
// consultam. Títulos de teste recebem deleted_at no fim (RD-30); registros de execução de teste são removidos.

import { test, expect } from '../../support/fixtures'
import { dbSelect, dbInsert, dbPatch, dbDelete, rpc, registrarJornada, obterSessionPayload } from '../../support/api'

const DEMO = 'b0700000-0000-4000-a000-000000000004'
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const RUN = Date.now().toString(36).toUpperCase()
const NN = `E2E${RUN}`
const titulos: string[] = []
const lotes: string[] = []
let token = ''

async function rpcRobo<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args),
  })
  if (!resp.ok) throw new Error(`rpc ${fn} falhou: ${resp.status} ${await resp.text()}`)
  return (await resp.json()) as T
}
async function boleto(banco: string): Promise<string> {
  const { id } = await dbInsert<{ id: string }>('erp_receber', {
    company_id: DEMO, cliente_nome: `E2E boleto ${banco}`, descricao: `Aceitação baixa por banco · ${banco} · ${RUN}`, valor: 100,
    data_vencimento: '2026-10-10', status: 'aberto', boleto_status: 'registrado', boleto_nosso_numero: NN, boleto_banco_codigo: banco,
  })
  titulos.push(id)
  return id
}

test.describe('Baixa de boleto por banco (empresa + banco + nosso número)', () => {
  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
  })
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-baixa-boleto-por-banco', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.afterAll(async () => {
    for (const id of titulos) await dbPatch('erp_receber', `id=eq.${id}`, { deleted_at: new Date().toISOString() }).catch(() => {})
    if (lotes.length) await dbDelete('erp_boleto_liquidacao_execucao', `lote_id=in.(${lotes.join(',')})`).catch(() => {})
  })

  test('mesmo nosso número no Sicoob e no Sicredi: baixa só o do banco certo, uma vez', { tag: '@pos-migration' }, async () => {
    const sicoob = await boleto('756')
    const sicredi = await boleto('748')

    const r1 = await rpcRobo<{ sucesso: boolean; receber_id: string }>('fn_boleto_liquidar', {
      p_company_id: DEMO, p_nosso_numero: NN, p_data_pagamento: '2026-09-30', p_valor_pago: 100, p_provider: 'sicredi', p_banco_codigo: '748',
    })
    expect(r1.sucesso, 'baixou').toBe(true)
    expect(r1.receber_id, 'baixou o título do Sicredi').toBe(sicredi)
    const [t756] = await dbSelect<{ status: string }>('erp_receber', `id=eq.${sicoob}&select=status`)
    const [t748] = await dbSelect<{ status: string }>('erp_receber', `id=eq.${sicredi}&select=status`)
    expect(t756.status, 'o título do Sicoob continua em aberto').toBe('aberto')
    expect(['pago', 'recebido']).toContain(t748.status)

    const r2 = await rpcRobo<{ ja_liquidado?: boolean }>('fn_boleto_liquidar', {
      p_company_id: DEMO, p_nosso_numero: NN, p_data_pagamento: '2026-09-30', p_valor_pago: 100, p_provider: 'sicredi', p_banco_codigo: '748',
    })
    expect(r2.ja_liquidado, 'segunda consulta não baixa de novo').toBe(true)
    const baixas = await dbSelect('erp_receber_baixa', `receber_id=eq.${sicredi}&deleted_at=is.null&select=id`)
    expect(baixas.length, 'uma baixa só').toBe(1)

    const r3 = await rpcRobo<{ sucesso: boolean; erro?: string }>('fn_boleto_liquidar', {
      p_company_id: DEMO, p_nosso_numero: NN, p_data_pagamento: '2026-09-30', p_valor_pago: 100,
    })
    expect(r3.erro, 'sem banco não baixa nada').toBe('banco_obrigatorio')

    await expect(dbInsert('erp_receber', {
      company_id: DEMO, descricao: `Aceitação dup ${RUN}`, valor: 100, data_vencimento: '2026-10-10', status: 'aberto',
      boleto_status: 'registrado', boleto_nosso_numero: NN, boleto_banco_codigo: '748',
    }), 'empresa + banco + nosso número repetido é barrado').rejects.toThrow()
  })

  test('2 falhas seguidas da empresa/banco viram alerta; uma execução ok limpa', { tag: '@pos-migration' }, async () => {
    const reg = async (status: string, msg: string) => {
      const lote = crypto.randomUUID()
      lotes.push(lote)
      await rpc('fn_boleto_liquidacao_registrar', { p_lote_id: lote, p_origem: 'manual', p_company_id: DEMO, p_banco_codigo: '748',
        p_provider: 'sicredi', p_status: status, p_mensagem: msg })
    }
    const alertaDemo = async () => {
      const st = await rpc<{ falhas_repetidas: Array<{ company_id: string; banco_codigo: string }> }>('fn_boleto_liquidacao_status', {})
      return st.falhas_repetidas.some((f) => f.company_id === DEMO && f.banco_codigo === '748')
    }
    await reg('erro', 'E2E falha 1')
    expect(await alertaDemo(), 'uma falha ainda não é alerta').toBe(false)
    await reg('erro', 'E2E falha 2')
    expect(await alertaDemo(), 'duas falhas seguidas = alerta').toBe(true)
    await reg('ok', 'E2E voltou')
    expect(await alertaDemo(), 'execução ok limpa o alerta').toBe(false)
  })

  test('botão "Sincronizar liquidação": a rota responde e lista os bancos que consultam', { tag: '@pos-migration' }, async ({ request }) => {
    const r = await request.post('/api/boleto/sync-liquidacao', {
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, data: { company_id: DEMO },
    })
    expect(r.status()).toBe(200)
    const j = await r.json() as { ok: boolean; bancos_com_consulta: string[]; lote_id: string }
    expect(j.ok).toBe(true)
    expect(j.bancos_com_consulta).toEqual(expect.arrayContaining(['sicoob', 'sicredi']))
    lotes.push(j.lote_id)
  })
})
