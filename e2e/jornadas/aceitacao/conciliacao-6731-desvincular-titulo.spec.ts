// #6731 (Pdois/Prigol) · Na conciliação de fatura agrupada, o usuário precisava desfazer a fatura INTEIRA só para
// corrigir UM título vinculado por engano. fn_conciliacao_desvincular_titulo remove só aquele vínculo: o título volta
// a Aberto, a baixa que a conciliação criou é estornada, e os DEMAIS títulos continuam vinculados. Quando é o último
// vínculo, o movimento volta a Pendentes (igual ao desvincular completo). Aqui as RPCs rodam COMO O ROBÔ (as mesmas
// da tela); o service_role só prepara títulos/extrato e confere o banco. Demonstração Comércio (GE); dados de teste removidos.
// Depende da migration 20261118143045 → tag @pos-migration.

import { test, expect } from '../../support/fixtures'
import { dbSelect, dbInsert, dbPatch, dbDelete, registrarJornada, obterSessionPayload } from '../../support/api'

const DEMO_COMERCIO = 'b0700000-0000-4000-a000-000000000004'
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}-${Date.now().toString(36)}`
const dia = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)

type Titulo = { status: string; conciliado: boolean | null }
type Mov = { status: string; lancamento_id: string | null }

test.describe('#6731 · desvincular um título da fatura agrupada sem desfazer os demais', () => {
  let token = ''
  let lote = ''
  let mov = ''
  const titulos: string[] = []

  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-6731-desvincular-titulo', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_COMERCIO}&select=is_demo`)
    expect(emp?.is_demo, 'a aceitação só roda na empresa de demonstração').toBe(true)
    token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
    lote = (await dbInsert<{ id: string }>('conciliacao_lote', {
      company_id: DEMO_COMERCIO, tipo: 'bancario', origem: 'ofx', nome: `Aceitação #6731 desvincular título ${RUN}`,
    })).id
  })
  test.afterAll(async () => {
    if (lote) {
      const movs = (await dbSelect<{ id: string }>('conciliacao_movimento', `lote_id=eq.${lote}&select=id`)).map((m) => m.id)
      if (movs.length) await dbDelete('conciliacao_vinculo', `movimento_id=in.(${movs.join(',')})`)
      await dbDelete('conciliacao_movimento', `lote_id=eq.${lote}`)
      await dbDelete('conciliacao_lote', `id=eq.${lote}`)
    }
    for (const id of titulos) await dbPatch('erp_pagar', `id=eq.${id}`, { deleted_at: new Date().toISOString() })
  })

  async function rpcRobo<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    })
    if (!resp.ok) throw new Error(`rpc ${fn} falhou: ${resp.status} ${await resp.text()}`)
    return (await resp.json()) as T
  }
  async function novoTitulo(valor: number, nome: string): Promise<string> {
    const { id } = await dbInsert<{ id: string }>('erp_pagar', {
      company_id: DEMO_COMERCIO, fornecedor_nome: nome, descricao: `Aceitação #6731 · ${nome} · ${RUN}`, valor,
      data_emissao: dia(-5), data_vencimento: dia(-1), status: 'aberto', forma_pagamento: 'boleto',
    })
    titulos.push(id)
    return id
  }
  const vincular = (t: string) => rpcRobo<{ ok: boolean; erro?: string }>('fn_conciliacao_vincular', {
    p_movimento_id: mov, p_lancamento_tabela: 'erp_pagar', p_lancamento_id: t, p_valor: null, p_operador_id: null,
  })
  const titulo = async (id: string) => (await dbSelect<Titulo>('erp_pagar', `id=eq.${id}&select=status,conciliado`))[0]
  const movimento = async () => (await dbSelect<Mov>('conciliacao_movimento', `id=eq.${mov}&select=status,lancamento_id`))[0]
  const nVinculos = async (t?: string) => (await dbSelect<{ id: string }>('conciliacao_vinculo',
    `movimento_id=eq.${mov}${t ? `&lancamento_id=eq.${t}` : ''}&select=id`)).length
  const desvincularTitulo = (t: string) => rpcRobo<{ sucesso: boolean; vinculos_restantes: number; movimento_liberado: boolean; erro?: string }>(
    'fn_conciliacao_desvincular_titulo', { p_movimento_id: mov, p_lancamento_tabela: 'erp_pagar', p_lancamento_id: t, p_operador_id: null })

  test('remove só o título errado: os outros 2 seguem vinculados e o movimento continua conciliado', { tag: '@pos-migration' }, async () => {
    const tA = await novoTitulo(1000, 'Fornecedor A #6731')
    const tB = await novoTitulo(800, 'Fornecedor B #6731')
    const tC = await novoTitulo(1200, 'Fornecedor C #6731')
    mov = (await dbInsert<{ id: string }>('conciliacao_movimento', {
      lote_id: lote, company_id: DEMO_COMERCIO, data_transacao: dia(0), valor: 3000,
      descricao: `PAGAMENTO LOTE #6731 ${RUN}`, natureza: 'debito', status: 'pendente',
    })).id

    await vincular(tA); await vincular(tB); await vincular(tC)
    await rpcRobo('fn_conciliacao_fechar_agrupado', { p_movimento_id: mov, p_operador_id: null })
    expect((await movimento()).status, 'fatura fechada = movimento conciliado').toBe('conciliado')
    expect(await nVinculos(), '3 títulos vinculados').toBe(3)

    // desvincula SÓ o título B (o errado)
    const r = await desvincularTitulo(tB)
    expect(r.sucesso, 'desvinculou o título').toBe(true)
    expect(r.movimento_liberado, 'ainda restam vínculos → movimento não liberado').toBe(false)
    expect(r.vinculos_restantes).toBe(2)

    expect(await nVinculos(tB), 'o vínculo de B sumiu').toBe(0)
    expect(await nVinculos(tA), 'A continua vinculado').toBe(1)
    expect(await nVinculos(tC), 'C continua vinculado').toBe(1)
    expect((await titulo(tB)).status, 'B voltou a Aberto').toBe('aberto')
    expect((await titulo(tB)).conciliado ?? false, 'B não está mais conciliado').toBe(false)
    expect((await titulo(tA)).status, 'A segue conciliado').not.toBe('aberto')
    expect((await movimento()).status, 'o movimento continua conciliado (os demais títulos seguem)').toBe('conciliado')
  })

  test('ao tirar o último título, o movimento volta a Pendentes', { tag: '@pos-migration' }, async () => {
    const tA = await novoTitulo(500, 'Único A #6731')
    const tB = await novoTitulo(500, 'Único B #6731')
    mov = (await dbInsert<{ id: string }>('conciliacao_movimento', {
      lote_id: lote, company_id: DEMO_COMERCIO, data_transacao: dia(0), valor: 1000,
      descricao: `PAGAMENTO PAR #6731 ${RUN}`, natureza: 'debito', status: 'pendente',
    })).id
    await vincular(tA); await vincular(tB)
    await rpcRobo('fn_conciliacao_fechar_agrupado', { p_movimento_id: mov, p_operador_id: null })
    expect((await movimento()).status).toBe('conciliado')

    const r1 = await desvincularTitulo(tA)
    expect(r1.movimento_liberado, 'ainda resta B').toBe(false)
    expect((await movimento()).status, 'segue conciliado com B').toBe('conciliado')

    const r2 = await desvincularTitulo(tB)
    expect(r2.movimento_liberado, 'era o último → movimento liberado').toBe(true)
    expect(await nVinculos(), 'sem vínculos').toBe(0)
    const m = await movimento()
    expect(m.status, 'movimento volta a Pendentes').toBe('pendente')
    expect(m.lancamento_id, 'sem lançamento 1:1').toBeNull()
  })

  test('recusa título que não está na fatura', { tag: '@pos-migration' }, async () => {
    const tA = await novoTitulo(700, 'Fatura A #6731')
    const tForaId = await novoTitulo(700, 'Fora da fatura #6731')
    mov = (await dbInsert<{ id: string }>('conciliacao_movimento', {
      lote_id: lote, company_id: DEMO_COMERCIO, data_transacao: dia(0), valor: 700,
      descricao: `FATURA SOLO #6731 ${RUN}`, natureza: 'debito', status: 'pendente',
    })).id
    await vincular(tA)
    await rpcRobo('fn_conciliacao_fechar_agrupado', { p_movimento_id: mov, p_operador_id: null })
    const r = await desvincularTitulo(tForaId)
    expect(r.sucesso, 'título fora da fatura é recusado').toBe(false)
    expect(r.erro).toBe('vinculo_nao_encontrado')
  })
})
