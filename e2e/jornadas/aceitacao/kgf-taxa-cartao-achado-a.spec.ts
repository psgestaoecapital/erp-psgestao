// RD-78 · Aceitação do ACHADO A (KGF, 26/09): taxa de cartão contada duas vezes. Com a taxa da adquirente já
// lançada como DESCONTO e o crédito conciliado pelo líquido, o gatilho trg_receber_taxa_cartao via "resíduo = desconto"
// e fechava o título em bruto (baixa 'taxa_cartao') + criava a despesa "Tarifa de cartão" → taxa 2x. Migration
// 20260926320000 mede o resíduo contra o LÍQUIDO e dá referência de sistema à despesa (sem bater no anti-duplicidade).
// @pos-migration: o veredito é o aceitacao-pos-migration.yml em PRODUÇÃO.
//
// Demonstração Comércio (GE). A conciliação é chamada COMO O ROBÔ (fn_conciliacao_vincular, a mesma da tela);
// o service_role só prepara títulos/extrato, confere o banco e limpa (títulos e despesas soft; extrato apagado).

import { test, expect } from '../../support/fixtures'
import { dbSelect, dbInsert, dbPatch, dbDelete, registrarJornada, obterSessionPayload } from '../../support/api'

const DEMO_COMERCIO = 'b0700000-0000-4000-a000-000000000004'
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}-${Date.now().toString(36)}`
const hoje = new Date().toISOString().slice(0, 10)

test.describe('Aceitação achado A — taxa de cartão não é contada duas vezes', () => {
  let token = ''
  let lote = ''
  const titulos: string[] = []

  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-achado-a-taxa-cartao', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_COMERCIO}&select=is_demo`)
    expect(emp?.is_demo, 'a aceitação só roda na empresa de demonstração').toBe(true)
    token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
    lote = (await dbInsert<{ id: string }>('conciliacao_lote', {
      company_id: DEMO_COMERCIO, tipo: 'bancario', origem: 'ofx', nome: `Aceitação achado A ${RUN}`,
    })).id
  })

  test.afterAll(async () => {
    if (lote) {
      const movs = (await dbSelect<{ id: string }>('conciliacao_movimento', `lote_id=eq.${lote}&select=id`)).map((m) => m.id)
      if (movs.length) await dbDelete('conciliacao_vinculo', `movimento_id=in.(${movs.join(',')})`)
      await dbDelete('conciliacao_movimento', `lote_id=eq.${lote}`)
      await dbDelete('conciliacao_lote', `id=eq.${lote}`)
    }
    const agora = new Date().toISOString()
    for (const id of titulos) {
      await dbPatch('erp_pagar', `ref_externa_sistema=eq.taxa_cartao&ref_externa_id=eq.${id}`, { deleted_at: agora })
      await dbPatch('erp_receber', `id=eq.${id}`, { deleted_at: agora })
    }
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

  async function tituloCartao(nome: string, desconto: number): Promise<string> {
    const { id } = await dbInsert<{ id: string }>('erp_receber', {
      company_id: DEMO_COMERCIO, cliente_nome: nome, descricao: `Aceitação achado A · ${nome} · ${RUN} · ${titulos.length}`,
      valor: 100, desconto, data_emissao: hoje, data_vencimento: hoje, status: 'aberto', forma_pagamento: 'cartao_debito',
    })
    titulos.push(id)
    return id
  }
  const credito = async (valor: number, descricao: string) => (await dbInsert<{ id: string }>('conciliacao_movimento', {
    lote_id: lote, company_id: DEMO_COMERCIO, data_transacao: hoje, valor, descricao, natureza: 'credito', status: 'pendente',
  })).id
  const conciliar = (m: string, t: string) => rpcRobo<{ ok: boolean }>('fn_conciliacao_vincular', {
    p_movimento_id: m, p_lancamento_tabela: 'erp_receber', p_lancamento_id: t, p_valor: null, p_operador_id: null,
  })
  const estado = async (t: string) => ({
    titulo: (await dbSelect<{ valor_pago: number; status: string }>('erp_receber', `id=eq.${t}&select=valor_pago,status`))[0],
    taxas: await dbSelect('erp_receber_baixa', `receber_id=eq.${t}&origem=eq.taxa_cartao&deleted_at=is.null&select=id`),
    despesas: await dbSelect('erp_pagar', `ref_externa_sistema=eq.taxa_cartao&ref_externa_id=eq.${t}&select=id`),
  })

  test('taxa já lançada como desconto: conciliar pelo líquido NÃO cria taxa nem despesa @pos-migration', async () => {
    const t = await tituloCartao('Cliente Achado A1', 2)
    const r = await conciliar(await credito(98, `CIELO Achado A1 ${RUN}`), t)
    expect(r.ok).toBe(true)
    const e = await estado(t)
    expect(Number(e.titulo.valor_pago), 'fica no líquido (100 − 2), não volta ao bruto').toBe(98)
    expect(e.titulo.status).toBe('pago')
    expect(e.taxas, 'nenhuma baixa de taxa (a taxa já está no desconto)').toHaveLength(0)
    expect(e.despesas, 'nenhuma despesa de tarifa (não conta 2x)').toHaveLength(0)
  })

  test('taxa NÃO lançada: fecha em bruto como antes, e o mesmo cliente 2x no dia não trava a conciliação @pos-migration', async () => {
    const a = await tituloCartao('Cliente Achado A2', 0)
    const b = await tituloCartao('Cliente Achado A2', 0)
    expect((await conciliar(await credito(98, `CIELO Achado A2a ${RUN}`), a)).ok).toBe(true)
    expect((await conciliar(await credito(98, `CIELO Achado A2b ${RUN}`), b)).ok, 'a 2ª despesa igual não bate no anti-duplicidade').toBe(true)
    for (const t of [a, b]) {
      const e = await estado(t)
      expect(Number(e.titulo.valor_pago), 'fecha em bruto: 98 do banco + 2 de taxa').toBe(100)
      expect(e.taxas).toHaveLength(1)
      expect(e.despesas, 'uma despesa de tarifa por título').toHaveLength(1)
    }
  })
})
