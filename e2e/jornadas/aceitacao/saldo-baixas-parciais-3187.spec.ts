// Jordana (BPO · Gean, chamado #3187 ligado ao #2751): o saldo por conta ignorava título PARCIAL — só somava receber
// 'recebido'/'pago' e pagar 'pago', pelo valor_pago do título inteiro. Migration saldo_pelas_baixas_parciais
// (@pos-migration): o saldo soma CADA baixa (erp_receber_baixa / erp_pagar_baixa) pela data e conta do título; o título
// quitado sem baixa (legado) segue como antes; nada é contado duas vezes. A baixa manual é a escrita de valor_pago que a
// tela faz (o trigger-guarda grava a linha de baixa). Na Demonstração Comércio (GE), com uma conta de teste; o saldo é lido
// COMO O ROBÔ (logado, fn_saldo_composicao); o service_role só prepara e limpa.

import { test, expect } from '../../support/fixtures'
import { dbSelect, dbInsert, dbPatch, dbDelete, registrarJornada, obterSessionPayload } from '../../support/api'

const DEMO_COMERCIO = 'b0700000-0000-4000-a000-000000000004'
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}-${Date.now().toString(36)}`
const dia = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)

type Conta = { conta_id: string; saldo: number }
type Comp = { ok?: boolean; contas: Conta[] }

test.describe('Saldo por conta pelas baixas — parcial entra com o já pago (Jordana/Gean #3187)', () => {
  let token = ''
  let conta = ''
  const nomeConta = `ACEITE PARCIAL 3187 ${RUN}`
  let receber = ''
  let pagar = ''

  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-saldo-baixas-parciais-3187', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_COMERCIO}&select=is_demo`)
    expect(emp?.is_demo, 'a aceitação só roda na empresa de demonstração').toBe(true)
    token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
    conta = (await dbInsert<{ id: string }>('erp_banco_contas', {
      company_id: DEMO_COMERCIO, nome: nomeConta, tipo_conta: 'corrente', saldo_inicial: 1000, data_saldo_inicial: dia(-30),
    })).id
    receber = (await dbInsert<{ id: string }>('erp_receber', {
      company_id: DEMO_COMERCIO, cliente_nome: 'Cliente Aceitação 3187', descricao: `Aceitação #3187 receita ${RUN}`,
      valor: 1000, data_emissao: dia(-10), data_vencimento: dia(-5), status: 'aberto', forma_pagamento: 'pix', conta_bancaria_id: conta,
    })).id
    pagar = (await dbInsert<{ id: string }>('erp_pagar', {
      company_id: DEMO_COMERCIO, fornecedor_nome: 'Fornecedor Aceitação 3187', descricao: `Aceitação #3187 despesa ${RUN}`,
      valor: 500, data_emissao: dia(-10), data_vencimento: dia(-5), status: 'aberto', forma_pagamento: 'pix', conta_bancaria: nomeConta,
    })).id
  })

  test.afterAll(async () => {
    if (receber) await dbDelete('erp_receber_baixa', `receber_id=eq.${receber}`).catch(() => {})
    if (pagar) await dbDelete('erp_pagar_baixa', `pagar_id=eq.${pagar}`).catch(() => {})
    const agora = new Date().toISOString()
    if (receber) await dbPatch('erp_receber', `id=eq.${receber}`, { deleted_at: agora }).catch(() => {})
    if (pagar) await dbPatch('erp_pagar', `id=eq.${pagar}`, { deleted_at: agora }).catch(() => {})
    if (conta) {
      await dbDelete('erp_banco_contas', `id=eq.${conta}`).catch(async () => {
        await dbPatch('erp_banco_contas', `id=eq.${conta}`, { ativo: false })
      })
    }
  })

  async function saldo(): Promise<number> {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/fn_saldo_composicao`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_company_ids: [DEMO_COMERCIO] }),
    })
    if (!resp.ok) throw new Error(`rpc fn_saldo_composicao falhou: ${resp.status} ${await resp.text()}`)
    const c = (await resp.json()) as Comp
    expect(c.ok).toBe(true)
    const linha = c.contas.find((x) => x.conta_id === conta)
    expect(linha, 'a conta de teste aparece na composição').toBeTruthy()
    return linha!.saldo
  }
  const baixasReceber = async () => dbSelect<{ valor: number; data: string }>('erp_receber_baixa', `receber_id=eq.${receber}&deleted_at=is.null&select=valor,data&order=data`)

  test('baixa parcial manual (sem conciliar) muda o saldo na hora; quitar não conta duas vezes', { tag: '@pos-migration' }, async () => {
    expect(await saldo()).toBeCloseTo(1000, 2)

    // 1ª parcial: 400 em D-3 → a linha de baixa nasce e o saldo sobe 400
    await dbPatch('erp_receber', `id=eq.${receber}`, { valor_pago: 400, status: 'parcial', data_pagamento: dia(-3) })
    expect((await baixasReceber()).map((b) => Number(b.valor))).toEqual([400])
    expect(await saldo()).toBeCloseTo(1400, 2)

    // 2ª parcial: +300 em D-2 → duas baixas, cada uma com a sua data
    await dbPatch('erp_receber', `id=eq.${receber}`, { valor_pago: 700, status: 'parcial', data_pagamento: dia(-2) })
    const duas = await baixasReceber()
    expect(duas.map((b) => Number(b.valor))).toEqual([400, 300])
    expect(duas.map((b) => b.data)).toEqual([dia(-3), dia(-2)])
    expect(await saldo()).toBeCloseTo(1700, 2)

    // despesa parcial de 200 → sai da conta na hora
    await dbPatch('erp_pagar', `id=eq.${pagar}`, { valor_pago: 200, status: 'parcial', data_pagamento: dia(-1) })
    expect(await saldo()).toBeCloseTo(1500, 2)

    // quita a receita (+300): entra só o que faltava — o título não é contado de novo pelo valor_pago
    await dbPatch('erp_receber', `id=eq.${receber}`, { valor_pago: 1000, status: 'pago', data_pagamento: dia(0) })
    expect(await saldo()).toBeCloseTo(1800, 2)
  })
})
