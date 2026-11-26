// Indústria · RH · Folha › Encargos (CEO 25/11). Prova a entrega:
//  (1) a tela /dashboard/industrial/rh/folha abre na DEMO Indústria, na aba Encargos, e mostra o editor;
//  (2) o par de RPCs da tela (fn_mao_obra_encargos_vigentes / fn_mao_obra_encargos_salvar) persiste uma mudança de
//      encargo E PRESERVA os padrões da ficha no mesmo salvar (round-trip) — a propriedade RD-97 do editor.
// Roda na DEMO Indústria (RD-69/LGPD: dado fictício). Idempotente: restaura o valor original ao fim.
import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { rpc, registrarJornada } from '../../support/api'

const DEMO_INDUSTRIA = 'b0700000-0000-4000-a000-000000000005'

type Padroes = { horas_produtivas_mes?: number; dsr_fator?: number; salario_minimo?: number; vinculo?: string }
type Enc = {
  regime: string; simples_anexo: string | null; inss_patronal_pct: number; rat_pct: number; fap: number
  terceiros_pct: number; fgts_pct: number; prov_13_pct: number; prov_ferias_pct: number; prov_rescisao_pct: number
  desoneracao: boolean; desoneracao_fator_folha: number; cprb_pct: number | null; padroes?: Padroes
}

// Monta o p_dados como a tela faz: encargos do formulário + padrões da ficha reenviados INTACTOS (round-trip).
function payload(e: Enc, ratPct: number): Record<string, unknown> {
  const p = e.padroes ?? {}
  return {
    regime: e.regime, simples_anexo: e.simples_anexo, vigencia_inicio: new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10),
    inss_patronal_pct: e.inss_patronal_pct, rat_pct: ratPct, fap: e.fap, terceiros_pct: e.terceiros_pct, fgts_pct: e.fgts_pct,
    prov_13_pct: e.prov_13_pct, prov_ferias_pct: e.prov_ferias_pct, prov_rescisao_pct: e.prov_rescisao_pct,
    desoneracao: e.desoneracao, desoneracao_fator_folha: e.desoneracao ? e.desoneracao_fator_folha : 1,
    cprb_pct: e.desoneracao ? e.cprb_pct : null,
    horas_produtivas_padrao: p.horas_produtivas_mes ?? 176, vinculo_padrao: p.vinculo ?? 'clt', forma_padrao: 'mensal',
    dsr_fator: p.dsr_fator ?? 0.16667, salario_minimo_ref: p.salario_minimo ?? 1518, incidencia_padrao: {},
  }
}

test.describe('Indústria · RH · Folha › Encargos', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-industria-rh-folha-encargos', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('a tela Folha abre na aba Encargos e mostra o editor (DEMO Indústria)', async ({ page }) => {
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_INDUSTRIA)
    await page.goto('/dashboard/industrial/rh/folha?aba=encargos')
    await aguardarConteudo(page)
    await expect(page.getByRole('heading', { name: 'Folha' })).toBeVisible({ timeout: 30000 })
    await expect(page.getByTestId('folha-encargos')).toBeVisible({ timeout: 30000 })
    await expect(page.getByTestId('folha-inss')).toBeVisible()
    await expect(page.getByTestId('folha-encargos-salvar')).toBeVisible()
  })

  test('salvar um encargo persiste e PRESERVA os padrões da ficha no mesmo salvar (RD-97)', async () => {
    const r0 = await rpc<Enc>('fn_mao_obra_encargos_vigentes', { p_company_id: DEMO_INDUSTRIA })
    const ratOriginal = Number(r0.rat_pct)
    const horas0 = Number(r0.padroes?.horas_produtivas_mes ?? 176)
    const dsr0 = Number(r0.padroes?.dsr_fator ?? 0.16667)
    const sal0 = Number(r0.padroes?.salario_minimo ?? 1518)
    const ratTeste = ratOriginal === 2.5 ? 3.5 : 2.5
    try {
      // muda só o RAT, reenviando os padrões da ficha intactos
      const s1 = await rpc<{ ok: boolean; encargos: Enc }>('fn_mao_obra_encargos_salvar', { p_company_id: DEMO_INDUSTRIA, p_dados: payload(r0, ratTeste), p_confirmar: false })
      expect(s1.ok).toBe(true)
      expect(Number(s1.encargos.rat_pct), 'o RAT novo persistiu').toBe(ratTeste)
      // os padrões da ficha continuam os mesmos (não foram zerados pelos defaults do INSERT…ON CONFLICT)
      expect(Number(s1.encargos.padroes?.horas_produtivas_mes), 'horas produtivas preservadas').toBe(horas0)
      expect(Number(s1.encargos.padroes?.dsr_fator), 'DSR preservado').toBeCloseTo(dsr0, 5)
      expect(Number(s1.encargos.padroes?.salario_minimo), 'salário mínimo preservado').toBe(sal0)
      // confere por leitura independente
      const r1 = await rpc<Enc>('fn_mao_obra_encargos_vigentes', { p_company_id: DEMO_INDUSTRIA })
      expect(Number(r1.rat_pct)).toBe(ratTeste)
    } finally {
      // restaura o RAT original (idempotência)
      await rpc('fn_mao_obra_encargos_salvar', { p_company_id: DEMO_INDUSTRIA, p_dados: payload(r0, ratOriginal), p_confirmar: false })
      const rf = await rpc<Enc>('fn_mao_obra_encargos_vigentes', { p_company_id: DEMO_INDUSTRIA })
      expect(Number(rf.rat_pct)).toBe(ratOriginal)
    }
  })
})
