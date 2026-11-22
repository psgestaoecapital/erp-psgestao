// PDCA GE · /dashboard/financeiro/fluxo-caixa · fn_fluxo_caixa_diario set-based (perf).
// Regressão do fix: após #5241 a RPC varria o ledger (erp_receber_baixa/erp_pagar_baixa,
// 52k+15k linhas na DEMO GE) POR DIA num FOR sobre generate_series e estourava o timeout
// (front caía no catch -> banner "Não foi possível carregar", KPIs em falso-zero).
// O fix agrega cada ledger UMA vez (GROUP BY data) e une à série de dias. Este spec prova:
//   (a) a RPC retorna sem erro dentro de tempo razoável (sem o timeout de antes);
//   (b) a agregação é coerente: total_recebimentos/pagamentos == soma de dias[] (contrato #5241).
// Só leitura, empresa de DEMONSTRAÇÃO (RD-69/LGPD). @pos-migration: depende da migration.

import { test, expect } from '../../support/fixtures'
import { registrarJornada } from '../../support/api'

const DEMO_COMERCIO_GE = 'b0700000-0000-4000-a000-000000000004'
const URL_SB = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

async function rpcFluxo(args: Record<string, unknown>) {
  return fetch(`${URL_SB}/rest/v1/rpc/fn_fluxo_caixa_diario`, {
    method: 'POST',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_company_id: DEMO_COMERCIO_GE, ...args }),
  })
}

function soma(dias: Array<Record<string, unknown>>, campo: string): number {
  return dias.reduce((acc, d) => acc + Number(d[campo] ?? 0), 0)
}

test.describe('PS GE — fluxo de caixa diário (set-based, perf)', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('fluxo-caixa-set-based-perf', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('RPC carrega sem timeout e os totais batem com a soma dos dias', { tag: '@pos-migration' }, async () => {
    // Vista "todas as contas" (p_conta_id/categoria NULL) — exatamente onde o banner aparecia.
    const t0 = Date.now()
    const resp = await rpcFluxo({})
    const ms = Date.now() - t0
    expect(resp.status, await resp.clone().text()).toBe(200)

    // (a) tempo razoável: a versão antiga estourava o statement_timeout; a nova carrega em segundos.
    expect(ms, `RPC demorou ${ms}ms (antes estourava o timeout)`).toBeLessThan(15000)

    const j = await resp.json()
    expect(Array.isArray(j.dias), 'dias[] presente').toBe(true)
    expect(j.company_id).toBe(DEMO_COMERCIO_GE)
    expect(typeof j.saldo_final).toBe('number')

    // (b) coerência (contrato #5241): o total agregado == soma linha a linha dos dias.
    const EPS = 0.01
    expect(Math.abs(Number(j.total_recebimentos) - soma(j.dias, 'recebimentos')),
      'total_recebimentos == soma(dias.recebimentos)').toBeLessThan(EPS)
    expect(Math.abs(Number(j.total_pagamentos) - soma(j.dias, 'pagamentos')),
      'total_pagamentos == soma(dias.pagamentos)').toBeLessThan(EPS)
    expect(Math.abs(Number(j.total_recebimentos_previstos) - soma(j.dias, 'recebimentos_previstos')),
      'total_recebimentos_previstos == soma(dias)').toBeLessThan(EPS)
    expect(Math.abs(Number(j.total_pagamentos_previstos) - soma(j.dias, 'pagamentos_previstos')),
      'total_pagamentos_previstos == soma(dias)').toBeLessThan(EPS)

    // duas leituras seguidas iguais (função STABLE, sem efeito colateral)
    const j2 = await (await rpcFluxo({})).json()
    expect(Number(j2.total_recebimentos), 'idempotente').toBe(Number(j.total_recebimentos))
    expect(Number(j2.total_pagamentos), 'idempotente').toBe(Number(j.total_pagamentos))

    // (c) CORRECTNESS (gap 18/11): o ramo REALIZADO não pode contar baixas de título
    // cancelado/renegociado (fn_receber_cancelar não estorna a baixa). Antes do fix, essas
    // baixas-fantasma inflavam o REALIZADO (na DEMO GE chegaram a R$ 1,26 QUADRILHÃO).
    // Guarda robusta a churn: só assere quando há fantasma grande vivo na janela; se não há,
    // a checagem é vácua e passa (nunca flaka).
    const hoje = new Date()
    const iso = (dt: Date) => dt.toISOString().slice(0, 10)
    const ini = new Date(hoje); ini.setDate(ini.getDate() - 30)
    const fim = new Date(hoje); fim.setDate(fim.getDate() + 30)
    const respFant = await fetch(
      `${URL_SB}/rest/v1/erp_receber_baixa?select=valor,er:erp_receber!inner(status)` +
      `&company_id=eq.${DEMO_COMERCIO_GE}&deleted_at=is.null` +
      `&data=gte.${iso(ini)}&data=lte.${iso(fim)}&er.status=in.(cancelado,renegociado)`,
      { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } },
    )
    expect(respFant.status, await respFant.clone().text()).toBe(200)
    const fantasmaRows: Array<{ valor: number | string }> = await respFant.json()
    const fantasma = fantasmaRows.reduce((acc, r) => acc + Number(r.valor ?? 0), 0)
    if (fantasma > 1e12) {
      // Com o fix, o REALIZADO exclui o fantasma; recebimentos legítimos da DEMO são ~R$ 3e5,
      // muito abaixo de um fantasma na casa do trilhão. Sem o fix, total_recebimentos ~>= fantasma.
      expect(Number(j.total_recebimentos),
        `REALIZADO não deve contar fantasma de título cancelado (fantasma=${fantasma})`,
      ).toBeLessThan(fantasma)
    }
  })
})
