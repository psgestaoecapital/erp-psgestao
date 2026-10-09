// Jordana (BPO · Gean / ProPlay #23, OK do CEO 07/10): o saldo por conta não lia as transferências entre contas —
// o dinheiro ficava "parado" na origem e faltava no destino. Migration 20261009232520 (@pos-migration): saldo da conta =
// saldo inicial + recebido − pago + transferências recebidas − enviadas (da data do saldo inicial da conta em diante),
// e o "Como é composto?" lista as transferências. RD-83: transferência de 100 entre duas contas move o saldo das duas e
// não muda o total. Na Demonstração Comércio (GE), com duas contas de teste; a composição é lida COMO O ROBÔ (logado);
// o service_role só prepara e limpa.

import { test, expect } from '../../support/fixtures'
import { dbSelect, dbInsert, dbDelete, registrarJornada, obterSessionPayload } from '../../support/api'

const DEMO_COMERCIO = 'b0700000-0000-4000-a000-000000000004'
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}-${Date.now().toString(36)}`
const dia = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)

type Conta = { conta_id: string; saldo: number; transf_entrada: number; transf_saida: number }
type Transf = { id: string; valor: number; origem: string; destino: string; conta_na_saida: boolean; conta_na_entrada: boolean }
type Comp = { ok?: boolean; contas: Conta[]; transferencias?: Transf[]; saldo_composto: number }

test.describe('Saldo por conta com transferências (Jordana/Gean/ProPlay)', () => {
  let token = ''
  let contaA = ''
  let contaB = ''

  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-saldo-com-transferencias', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_COMERCIO}&select=is_demo`)
    expect(emp?.is_demo, 'a aceitação só roda na empresa de demonstração').toBe(true)
    token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
    contaA = (await dbInsert<{ id: string }>('erp_banco_contas', {
      company_id: DEMO_COMERCIO, nome: `ACEITE TRANSF A ${RUN}`, tipo_conta: 'corrente', saldo_inicial: 1000, data_saldo_inicial: dia(-30),
    })).id
    // B começa depois: transferência anterior à data dela já está no saldo inicial de B
    contaB = (await dbInsert<{ id: string }>('erp_banco_contas', {
      company_id: DEMO_COMERCIO, nome: `ACEITE TRANSF B ${RUN}`, tipo_conta: 'corrente', saldo_inicial: 500, data_saldo_inicial: dia(-10),
    })).id
  })

  test.afterAll(async () => {
    for (const c of [contaA, contaB].filter(Boolean)) {
      await dbDelete('erp_transferencia', `conta_origem_id=eq.${c}`)
      await dbDelete('erp_transferencia', `conta_destino_id=eq.${c}`)
      await dbDelete('erp_banco_contas', `id=eq.${c}`)
    }
  })

  async function composicao(): Promise<Comp> {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/fn_saldo_composicao`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_company_ids: [DEMO_COMERCIO] }),
    })
    if (!resp.ok) throw new Error(`rpc fn_saldo_composicao falhou: ${resp.status} ${await resp.text()}`)
    return (await resp.json()) as Comp
  }
  const conta = (c: Comp, id: string) => c.contas.find((x) => x.conta_id === id)!

  test('transferência de 100 move o saldo das duas contas e não muda o total; aparece no "Como é composto?"', { tag: '@pos-migration' }, async () => {
    const antes = await composicao()
    expect(antes.ok).toBe(true)
    expect(conta(antes, contaA).saldo).toBeCloseTo(1000, 2)
    expect(conta(antes, contaB).saldo).toBeCloseTo(500, 2)

    const t = await dbInsert<{ id: string }>('erp_transferencia', {
      company_id: DEMO_COMERCIO, conta_origem_id: contaA, conta_destino_id: contaB, valor: 100, data: dia(-2), descricao: `ACEITE TRANSF ${RUN}`,
    })
    const depois = await composicao()
    expect(conta(depois, contaA).saldo).toBeCloseTo(900, 2)
    expect(conta(depois, contaA).transf_saida).toBeCloseTo(100, 2)
    expect(conta(depois, contaB).saldo).toBeCloseTo(600, 2)
    expect(conta(depois, contaB).transf_entrada).toBeCloseTo(100, 2)
    expect(depois.saldo_composto).toBeCloseTo(antes.saldo_composto, 2)
    const linha = depois.transferencias?.find((x) => x.id === t.id)
    expect(linha, 'a transferência aparece na composição').toBeTruthy()
    expect(linha).toMatchObject({ valor: 100, conta_na_saida: true, conta_na_entrada: true })
  })

  test('transferência anterior à data do saldo inicial do destino sai da origem e não conta de novo no destino', { tag: '@pos-migration' }, async () => {
    const antes = await composicao()
    await dbInsert('erp_transferencia', {
      company_id: DEMO_COMERCIO, conta_origem_id: contaA, conta_destino_id: contaB, valor: 7, data: dia(-20), descricao: `ACEITE TRANSF ANTIGA ${RUN}`,
    })
    const depois = await composicao()
    expect(conta(depois, contaA).saldo).toBeCloseTo(conta(antes, contaA).saldo - 7, 2)
    expect(conta(depois, contaB).saldo).toBeCloseTo(conta(antes, contaB).saldo, 2)
  })
})
