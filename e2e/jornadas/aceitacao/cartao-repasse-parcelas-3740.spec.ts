// Jordana (BPO · piloto Gean, chamado #3740 — vale para todas as empresas): a baixa por cartão quitava o cliente e
// não gerava os títulos da operadora; o crédito "CIELO CRÉDITO" do extrato ficava pendente na conciliação.
// Migration cartao_repasse_por_parcela (@pos-migration): fn_cartao_registrar_recebimento exige bandeira/modalidade/
// parcelas e gera UM título da operadora por parcela (bruto, taxa, líquido, data de repasse) com a taxa como despesa;
// a conciliação reconhece o LÍQUIDO do repasse e, ao conciliar, fecha o título em bruto e quita a taxa no mesmo crédito.
//
// Demonstração Comércio (GE), com uma operadora de teste. O registro, a sugestão e a conciliação são chamados COMO O
// ROBÔ (as mesmas RPCs da tela); o service_role só prepara, confere o banco e limpa (títulos soft; extrato apagado).

import { test, expect } from '../../support/fixtures'
import { dbSelect, dbInsert, dbPatch, dbDelete, registrarJornada, obterSessionPayload } from '../../support/api'

const DEMO_COMERCIO = 'b0700000-0000-4000-a000-000000000004'
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}-${Date.now().toString(36)}`
const dia = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)

type Repasse = { id: string; valor: number; valor_taxa: number; valor_liquido: number; data_vencimento: string; status: string; taxa_pagar_id: string | null; valor_pago: number }

test.describe('Recebimento em cartão → títulos da operadora por parcela (Jordana/Gean #3740)', () => {
  let token = ''
  let adq = ''
  let lote = ''
  const clientes: string[] = []

  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-cartao-repasse-parcelas-3740', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_COMERCIO}&select=is_demo`)
    expect(emp?.is_demo, 'a aceitação só roda na empresa de demonstração').toBe(true)
    token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
    adq = (await dbInsert<{ id: string }>('erp_cartao_adquirente', { company_id: DEMO_COMERCIO, nome: `CIELO ACEITE ${RUN}` })).id
    await dbInsert('erp_cartao_taxa', {
      company_id: DEMO_COMERCIO, adquirente_id: adq, bandeira: 'Master', modalidade: 'credito',
      parcelas_de: 2, parcelas_ate: 6, taxa_percentual: 2.25, prazo_repasse_dias: 30,
    })
    lote = (await dbInsert<{ id: string }>('conciliacao_lote', {
      company_id: DEMO_COMERCIO, tipo: 'bancario', origem: 'ofx', nome: `Aceitação #3740 cartão ${RUN}`,
    })).id
  })

  test.afterAll(async () => {
    if (lote) {
      const movs = (await dbSelect<{ id: string }>('conciliacao_movimento', `lote_id=eq.${lote}&select=id`)).map((m) => m.id)
      if (movs.length) await dbDelete('conciliacao_vinculo', `movimento_id=in.(${movs.join(',')})`).catch(() => {})
      await dbDelete('conciliacao_movimento', `lote_id=eq.${lote}`).catch(() => {})
      await dbDelete('conciliacao_lote', `id=eq.${lote}`).catch(() => {})
    }
    const agora = new Date().toISOString()
    for (const c of clientes) {
      const reps = await dbSelect<{ id: string }>('erp_receber', `origem_recebivel_id=eq.${c}&select=id`)
      for (const r of reps) await dbPatch('erp_pagar', `ref_externa_sistema=eq.taxa_cartao&ref_externa_id=eq.${r.id}`, { deleted_at: agora }).catch(() => {})
      await dbPatch('erp_receber', `origem_recebivel_id=eq.${c}`, { deleted_at: agora }).catch(() => {})
      await dbPatch('erp_receber', `id=eq.${c}`, { deleted_at: agora }).catch(() => {})
    }
    if (adq) {
      await dbPatch('erp_cartao_taxa', `adquirente_id=eq.${adq}`, { ativo: false }).catch(() => {})
      await dbPatch('erp_cartao_adquirente', `id=eq.${adq}`, { ativo: false }).catch(() => {})
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
  async function tituloCliente(valor: number): Promise<string> {
    const { id } = await dbInsert<{ id: string }>('erp_receber', {
      company_id: DEMO_COMERCIO, cliente_nome: 'Cliente Aceitação 3740', descricao: `Aceitação #3740 OS ${RUN} · ${clientes.length}`,
      valor, data_emissao: dia(-30), data_vencimento: dia(-30), status: 'aberto',
    })
    clientes.push(id)
    return id
  }
  const registrar = (receber: string, bandeira: string, modalidade: string, parcelas: number) =>
    rpcRobo<{ ok: boolean; erro?: string; parcelas?: unknown[] }>('fn_cartao_registrar_recebimento', {
      p_company_id: DEMO_COMERCIO, p_receber_id: receber, p_adquirente_id: adq,
      p_bandeira: bandeira, p_modalidade: modalidade, p_parcelas: parcelas, p_data_venda: dia(-30),
    })
  const repasses = (cliente: string) => dbSelect<Repasse>('erp_receber',
    `origem_recebivel_id=eq.${cliente}&eh_repasse_cartao=is.true&deleted_at=is.null&select=id,valor,valor_taxa,valor_liquido,data_vencimento,status,taxa_pagar_id,valor_pago&order=data_vencimento`)

  test('crédito 3x gera 3 títulos da operadora; o crédito CIELO do extrato concilia com a parcela certa', { tag: '@pos-migration' }, async () => {
    const cliente = await tituloCliente(900)

    // obrigatórios: sem bandeira e débito parcelado são recusados, nada é gerado
    expect((await registrar(cliente, '', 'credito', 3)).erro).toBe('bandeira_obrigatoria')
    expect((await registrar(cliente, 'Master', 'debito', 3)).erro).toBe('parcelas_invalidas')
    expect(await repasses(cliente)).toHaveLength(0)

    const r = await registrar(cliente, 'Master', 'credito', 3)
    expect(r.ok, JSON.stringify(r)).toBe(true)

    const [cli] = await dbSelect<{ status: string; valor_pago: number; forma_pagamento: string; conta_bancaria_id: string | null }>('erp_receber', `id=eq.${cliente}&select=status,valor_pago,forma_pagamento,conta_bancaria_id`)
    expect(cli.status, 'cliente quitado na venda').toBe('pago')
    expect(Number(cli.valor_pago)).toBe(900)
    expect(cli.forma_pagamento).toBe('cartao_credito')
    expect(cli.conta_bancaria_id, 'o dinheiro não entra na conta no dia da venda').toBeNull()

    const reps = await repasses(cliente)
    expect(reps, 'um título da operadora por parcela').toHaveLength(3)
    expect(reps.map((x) => Number(x.valor))).toEqual([300, 300, 300])
    expect(reps.map((x) => Number(x.valor_taxa))).toEqual([6.75, 6.75, 6.75])
    expect(reps.map((x) => Number(x.valor_liquido))).toEqual([293.25, 293.25, 293.25])
    expect(reps.map((x) => x.data_vencimento), 'repasse D+30 por parcela').toEqual([dia(0), dia(30), dia(60)])
    for (const x of reps) {
      expect(x.taxa_pagar_id, 'a taxa da parcela é despesa ligada ao repasse').toBeTruthy()
      const [tx] = await dbSelect<{ valor: number; status: string }>('erp_pagar', `id=eq.${x.taxa_pagar_id}&select=valor,status`)
      expect(Number(tx.valor)).toBe(6.75)
      expect(tx.status).toBe('aberto')
    }

    // registrar de novo não duplica
    expect((await registrar(cliente, 'Master', 'credito', 3)).erro).toBe('titulo_ja_baixado')
    expect(await repasses(cliente)).toHaveLength(3)

    // extrato: "CIELO CREDITO" de 293,25 no dia do 1º repasse → a sugestão traz a parcela 1. A venda é de 30 dias
    // atrás para o 1º repasse cair HOJE: movimento com data futura entra como "ignorado" (lançamento futuro) e não concilia
    const p1 = reps[0]
    const mov = (await dbInsert<{ id: string }>('conciliacao_movimento', {
      lote_id: lote, company_id: DEMO_COMERCIO, data_transacao: dia(0), valor: 293.25,
      descricao: `CIELO CREDITO ${RUN}`, natureza: 'credito', status: 'pendente',
    })).id
    const sug = await rpcRobo<{ lancamento_id: string; match_score: number }[]>('fn_conciliacao_sugerir_match', { p_movimento_id: mov, p_max_sugestoes: 5 })
    const achada = sug.find((s) => s.lancamento_id === p1.id)
    expect(achada, `a parcela 1 é sugerida para o crédito líquido: ${JSON.stringify(sug)}`).toBeTruthy()
    expect(Number(achada!.match_score)).toBeGreaterThanOrEqual(80)

    // concilia como a tela → fecha em bruto (293,25 do banco + 6,75 de taxa) e quita a taxa no mesmo crédito
    const v = await rpcRobo<{ ok: boolean }>('fn_conciliacao_vincular', {
      p_movimento_id: mov, p_lancamento_tabela: 'erp_receber', p_lancamento_id: p1.id, p_valor: null, p_operador_id: null,
    })
    expect(v.ok, JSON.stringify(v)).toBe(true)
    const [fech] = await dbSelect<Repasse>('erp_receber', `id=eq.${p1.id}&select=id,valor,valor_taxa,valor_liquido,data_vencimento,status,taxa_pagar_id,valor_pago`)
    expect(fech.status).toBe('pago')
    expect(Number(fech.valor_pago), 'fecha em bruto').toBe(300)
    const baixaTaxa = await dbSelect<{ valor: number; movimento_banco_id: string }>('erp_receber_baixa', `receber_id=eq.${p1.id}&origem=eq.taxa_cartao&deleted_at=is.null&select=valor,movimento_banco_id`)
    expect(baixaTaxa.map((b) => Number(b.valor))).toEqual([6.75])
    expect(baixaTaxa[0].movimento_banco_id).toBe(mov)
    const [tx1] = await dbSelect<{ status: string; valor_pago: number; movimento_banco_id: string }>('erp_pagar', `id=eq.${p1.taxa_pagar_id}&select=status,valor_pago,movimento_banco_id`)
    expect(tx1.status, 'taxa da parcela paga no mesmo crédito').toBe('pago')
    expect(Number(tx1.valor_pago)).toBe(6.75)
    expect(tx1.movimento_banco_id).toBe(mov)

    // as outras parcelas seguem em aberto, esperando os próximos repasses
    const resto = (await repasses(cliente)).slice(1)
    expect(resto.map((x) => x.status)).toEqual(['aberto', 'aberto'])
  })
})
