// PDCA GE · /dashboard/financeiro/inadimplentes · o KPI/breakdown de inadimplência somava valor BRUTO,
// ignorando valor_pago em títulos PARCIAIS (mesmo defeito de /receber #5286 e /saude #5294).
// Migration 20261119060040: fn_inadimplentes_por_status passa a somar SALDO (valor - valor_pago) nas "atrasadas".
//
// Esta jornada prova (RD-38, contra o DADO) que o total de atrasadas devolvido pela RPC bate com o SALDO
// calculado direto da view v_receber_efetivo — e, quando há título parcial, é MENOR que o bruto.
// Demonstração Comércio (GE). Só leitura: não cria nem altera dado. @pos-migration (depende da função migrada).

import { test, expect } from '../../support/fixtures'
import { dbSelect, obterSessionPayload, registrarJornada } from '../../support/api'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const DEMO = 'b0700000-0000-4000-a000-000000000004'
const cent = (n: number) => Math.round(n * 100)

interface LinhaReceber {
  valor: number | null
  valor_pago: number | null
  data_vencimento: string | null
  status: string | null
  em_renegociacao: boolean | null
}

test.describe('Inadimplentes · total de atrasadas usa SALDO (não bruto) em títulos parciais', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('financeiro-inadimplentes-saldo-parcial', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('fn_inadimplentes_por_status.atrasadas.total_valor == SUM(valor - valor_pago) da view', { tag: '@pos-migration' }, async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)

    // 1) conjunto "atrasadas" direto da view, com o MESMO filtro da função (COALESCE em_renegociacao -> false)
    const hoje = new Date().toISOString().slice(0, 10)
    const linhas = await dbSelect<LinhaReceber>(
      'v_receber_efetivo',
      `company_id=eq.${DEMO}&deleted_at=is.null&select=valor,valor_pago,data_vencimento,status,em_renegociacao`,
    )
    const foraStatus = new Set(['pago', 'recebido', 'cancelado', 'renegociado'])
    const atrasadas = linhas.filter((l) =>
      l.data_vencimento != null && l.data_vencimento < hoje &&
      !foraStatus.has(String(l.status)) &&
      l.em_renegociacao !== true)

    const bruto = atrasadas.reduce((s, l) => s + Number(l.valor ?? 0), 0)
    const saldo = atrasadas.reduce((s, l) => s + (Number(l.valor ?? 0) - Number(l.valor_pago ?? 0)), 0)

    // 2) RPC como o usuário logado (passa pela guarda de empresa)
    const token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/fn_inadimplentes_por_status`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_company_id: DEMO }),
    })
    expect(resp.status, 'RPC responde 200').toBe(200)
    const json = (await resp.json()) as { atrasadas: { count: number; total_valor: number } }

    // 3) o total da RPC bate com o SALDO calculado da view (em centavos, sem erro de ponto flutuante)
    expect(json.atrasadas.count, 'contagem de atrasadas bate com a view').toBe(atrasadas.length)
    expect(cent(json.atrasadas.total_valor), 'total da RPC == SALDO da view').toBe(cent(saldo))

    // 4) e, havendo título parcial, o saldo é ESTRITAMENTE menor que o bruto (prova que não voltou ao bruto)
    if (cent(bruto) !== cent(saldo)) {
      expect(cent(json.atrasadas.total_valor), 'total da RPC NÃO é o bruto').toBeLessThan(cent(bruto))
    }
  })
})
