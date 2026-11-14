// Hub P&M · Simulador de Obra — trava de regressão do MOTOR fn_simular_montagem (DoD O.3.9).
// Não existia spec de simulador (find e2e -iname '*simulador* = 0). Esta prova, COMO O ROBÔ
// (a mesma RPC que a tela chama), o invariante do motor na "Construtora Modelo - DEMO":
//   1) o quantitativo e o total escalam LINEARMENTE com a metragem (área 100 → 200 dobra tudo);
//   2) o preço por m² é independente da metragem (muda a obra, não o unitário);
//   3) a fórmula publicada na tela bate: qtd_total = coef × (1 + perda%) × área (arredondada a 3 casas),
//      custo_total = coef × (1 + perda%) × custo_unit × área (2 casas), total_obra = total_m² × área.
// Só leitura (RPC STABLE) — não cria/edita dado, sem migration (roda no preview da PR).
import { test, expect } from '../../support/fixtures'
import { dbSelect, rpcComoRobo, registrarJornada } from '../../support/api'

const DEMO_HUB = 'b0700000-0000-4000-a000-000000000006' // Construtora Modelo - DEMO (demo do Hub, #2265)

type QuantItem = { insumo: string; unidade: string | null; qtd_m2: number; perda_pct?: number; custo_unitario?: number; qtd_total: number; custo_total: number }
type Sim = { ok: boolean; erro?: string; montagem?: string; unidade?: string; area?: number; preco_m2?: { total_m2?: number }; total_obra?: number; quantitativo?: QuantItem[] }

test.describe('Hub — motor do Simulador de Obra', () => {
  let servicoId = ''
  let businessLineId: string | null = null

  const simular = async (area: number): Promise<Sim> => {
    const r = await rpcComoRobo<Sim>('fn_simular_montagem', {
      p_servico_id: servicoId, p_company_id: DEMO_HUB, p_business_line_id: businessLineId, p_area: area,
    })
    expect(r.status, `fn_simular_montagem: ${r.texto}`).toBe(200)
    return r.corpo as Sim
  }

  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_HUB}&select=is_demo`)
    expect(emp?.is_demo, 'a aceitação só roda na empresa de demonstração').toBe(true)
    // Escolhe, no dado real, a 1ª montagem da Construtora DEMO que simula ok COM quantitativo
    // (precisa de BOM de insumos + precificação configurada). Nada é chumbado.
    const servicos = await dbSelect<{ id: string; business_line_id: string | null }>(
      'projetos_servicos', `company_id=eq.${DEMO_HUB}&select=id,business_line_id&limit=100`,
    )
    expect(servicos.length, 'a Construtora DEMO tem serviços/montagens').toBeGreaterThan(0)
    for (const s of servicos) {
      const r = await rpcComoRobo<Sim>('fn_simular_montagem', {
        p_servico_id: s.id, p_company_id: DEMO_HUB, p_business_line_id: s.business_line_id, p_area: 100,
      })
      const j = r.corpo
      if (r.status === 200 && j?.ok && (j.quantitativo?.length ?? 0) > 0) {
        servicoId = s.id; businessLineId = s.business_line_id; break
      }
    }
    expect(servicoId, 'há ao menos uma montagem com quantitativo + preço na Construtora DEMO').not.toBe('')
  })

  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-hub-simulador-motor', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('quantitativo + total escalam linearmente com a metragem e batem a fórmula', async () => {
    const a100 = await simular(100)
    const a200 = await simular(200)
    expect(a100.ok, a100.erro).toBe(true)
    expect(a200.ok, a200.erro).toBe(true)

    // 1) preço por m² é independente da metragem
    const pm100 = Number(a100.preco_m2?.total_m2 ?? 0)
    const pm200 = Number(a200.preco_m2?.total_m2 ?? 0)
    expect(pm100, 'a montagem escolhida tem preço por m²').toBeGreaterThan(0)
    expect(pm200, 'preço por m² não muda com a metragem').toBeCloseTo(pm100, 2)

    // 2) total da obra = total_m² × área (dentro de 1 centavo de arredondamento) e dobra de 100 → 200
    expect(Number(a100.total_obra)).toBeCloseTo(Math.round(pm100 * 100 * 100) / 100, 1)
    expect(Number(a200.total_obra)).toBeCloseTo(Math.round(pm200 * 200 * 100) / 100, 1)
    expect(Number(a200.total_obra), 'dobrar a metragem dobra a obra').toBeCloseTo(Number(a100.total_obra) * 2, 0)

    // 3) cada insumo do quantitativo escala linearmente e bate a fórmula publicada na tela
    const q100 = a100.quantitativo ?? []
    const q200 = a200.quantitativo ?? []
    expect(q200.length, 'o mesmo conjunto de insumos nas duas metragens').toBe(q100.length)
    for (let i = 0; i < q100.length; i++) {
      const it = q100[i]
      const fator = 1 + (Number(it.perda_pct ?? 0)) / 100
      const qtdEsperada = Math.round(Number(it.qtd_m2) * fator * 100 * 1000) / 1000
      const custoEsperado = Math.round(Number(it.qtd_m2) * fator * Number(it.custo_unitario ?? 0) * 100 * 100) / 100
      expect(Number(it.qtd_total), `qtd_total de "${it.insumo}" = coef×(1+perda)×área`).toBeCloseTo(qtdEsperada, 2)
      expect(Number(it.custo_total), `custo_total de "${it.insumo}" = coef×(1+perda)×custo_unit×área`).toBeCloseTo(custoEsperado, 1)
      // 100 → 200: dobra qtd e custo
      expect(Number(q200[i].qtd_total), `qtd_total de "${it.insumo}" dobra`).toBeCloseTo(Number(it.qtd_total) * 2, 2)
      expect(Number(q200[i].custo_total), `custo_total de "${it.insumo}" dobra`).toBeCloseTo(Number(it.custo_total) * 2, 1)
    }
  })

  test('área zero não gera obra (guarda de metragem)', async () => {
    const a0 = await simular(0)
    // ok=true (montagem válida), mas a obra e o quantitativo zeram — nunca cobra por 0 m².
    if (a0.ok) {
      expect(Number(a0.total_obra), 'metragem 0 → obra R$ 0').toBe(0)
      for (const it of a0.quantitativo ?? []) expect(Number(it.qtd_total), '0 m² → quantitativo zerado').toBe(0)
    }
  })
})
