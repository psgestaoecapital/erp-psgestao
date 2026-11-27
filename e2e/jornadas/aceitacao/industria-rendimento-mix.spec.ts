// Indústria · Rendimento pelo MIX de entrada (CEO 25/11, tela 60). Prova COMO USUÁRIO (RD-82), pelas RPCs da tela,
// que um corte vindo de DUAS origens com padrões diferentes tem o esperado = soma ponderada e o real contado UMA vez
// (nunca em dobro), que a sugestão pelo histórico recupera o padrão, e que a fn_prod_rendimento_comparativo (telas
// antigas) também reparte o real sem dobrar. Migration 20261127120010 → @pos-migration. Roda na DEMO Indústria; nada
// fica para trás (limpa produtos, estrutura e fatos do sistema vinculado no afterAll).
import { test, expect } from '../../support/fixtures'
import { rpcComoRobo, dbSelect, dbInsert, dbInsertMany, dbDelete } from '../../support/api'

const DEMO = 'b0700000-0000-4000-a000-000000000005'
const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}${Date.now().toString(36)}`.replace(/[^a-z0-9]/gi, '').slice(-8)
const OPREF = `R${RUN}` // prefixo dos códigos/chaves externas deste run

async function rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
  const r = await rpcComoRobo<T>(fn, args)
  if (r.status < 200 || r.status >= 300) throw new Error(`rpc ${fn} falhou: ${r.status} ${r.texto}`)
  return r.corpo as T
}
// dia ISO (texto, como o conector grava): hoje - n
function diaISO(n: number): string { const d = new Date(); d.setUTCDate(d.getUTCDate() - n); return `${d.toISOString().slice(0, 10)}T00:00:00.000Z` }
function diaData(n: number): string { const d = new Date(); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10) }

type OrigemCell = { origem_produto_id: string; origem_codigo: string; padrao_pct: number | null; esperado_kg: number | null; kg_entrada: number | null; estrutura_id: string }
type Corte = { codigo: string; esperado_kg: number | null; real_kg: number | null; eficiencia_pct: number | null; dif_kg: number | null; fonte: string | null; status: string; origens: OrigemCell[] }
type MixResp = { ok: boolean; cortes: Corte[]; origens: { codigo: string; soma_padrao_pct: number; soma_fora: boolean; real_total_saida: number | null }[]; serie: { dia: string; esperado_kg: number; real_kg: number }[] }
type SugResp = { ok: boolean; cortes: { corte_codigo: string; n_origens: number; status: string; origens: { origem_codigo: string; pct_sugerido: number | null; r2: number | null; resultado: string; dias: number }[] }[] }

test.describe('Indústria · rendimento pelo mix de entrada', { tag: '@pos-migration' }, () => {
  let plant = ''
  const ids: Record<string, string> = {}
  const cod = (k: string) => `${OPREF}${k}`

  test.beforeAll(async () => {
    const [pl] = await dbSelect<{ id: string }>('industrial_plants', `company_id=eq.${DEMO}&select=id&limit=1`)
    expect(pl, 'a DEMO Indústria tem planta').toBeTruthy()
    plant = pl.id
    // 3 produtos: 2 origens (intermediário) + 1 corte (acabado, com preço de referência)
    for (const [k, papel, preco] of [['O1', 'intermediario', null], ['O2', 'intermediario', null], ['C', 'acabado', 10]] as const) {
      const row = await dbInsert<{ id: string }>('prod_produto', {
        company_id: DEMO, plant_id: plant, codigo: cod(k), nome: `Mix ${k} ${RUN}`, papel, chave_externa: cod(k), preco_venda_ref: preco, ativo: true,
      })
      ids[k] = row.id
    }
    // estrutura: O1 → C 30%, O2 → C 20% (padrões DIFERENTES)
    await dbInsertMany('prod_estrutura', [
      { company_id: DEMO, plant_id: plant, origem_produto_id: ids.O1, produto_id: ids.C, tipo_saida: 'principal', rendimento_padrao_pct: 30, fonte_padrao: 'manual', status: 'validado', ativo: true },
      { company_id: DEMO, plant_id: plant, origem_produto_id: ids.O2, produto_id: ids.C, tipo_saida: 'principal', rendimento_padrao_pct: 20, fonte_padrao: 'manual', status: 'validado', ativo: true },
    ])
    // fatos do sistema vinculado (3 dias). Entrada O1: 100/50/80; O2: 200/—/100. Saída C: 70/15/44 (= 0,3·x1+0,2·x2).
    const ent = (c: string, kg: number, n: number) => ({ company_id: DEMO, dominio: 'producao_frigorifico', chave_fato: `E2E${RUN}e${c}${n}`, raw: { PERFIL_TMV: 'PCP0301', COD_TIPO_MV: 'F630', COD_PRODUTO: c, QTDE_KG: kg, DATA_ESTOQUE: diaISO(n) } })
    const sai = (kg: number, n: number) => ({ company_id: DEMO, dominio: 'producao_frigorifico', chave_fato: `E2E${RUN}s${n}`, raw: { PERFIL_TMV: 'PCP0302', COD_TIPO_MV: 'F621', COD_PRODUTO: cod('C'), QTDE_KG: kg, DATA_ESTOQUE: diaISO(n) } })
    await dbInsertMany('ind_atak_fato', [
      ent(cod('O1'), 100, 5), ent(cod('O1'), 50, 4), ent(cod('O1'), 80, 3),
      ent(cod('O2'), 200, 5), ent(cod('O2'), 100, 3),
      sai(70, 5), sai(15, 4), sai(44, 3),
      // tipo ignorado (F697): não pode entrar na conta
      { company_id: DEMO, dominio: 'producao_frigorifico', chave_fato: `E2E${RUN}x`, raw: { PERFIL_TMV: 'PCP0301', COD_TIPO_MV: 'F697', COD_PRODUTO: cod('O1'), QTDE_KG: 9999, DATA_ESTOQUE: diaISO(5) } },
    ])
  })

  test.afterAll(async () => {
    await dbDelete('ind_atak_fato', `company_id=eq.${DEMO}&chave_fato=like.E2E${RUN}*`).catch(() => {})
    await dbDelete('prod_estrutura', `company_id=eq.${DEMO}&produto_id=eq.${ids.C}`).catch(() => {})
    for (const id of Object.values(ids)) await dbDelete('prod_produto', `company_id=eq.${DEMO}&id=eq.${id}`).catch(() => {})
  })

  test('mix: esperado = soma ponderada das origens e o real NÃO é contado em dobro', async () => {
    const r = await rpc<MixResp>('fn_prod_rendimento_mix', { p_company_id: DEMO, p_plant_id: plant, p_data_ini: diaData(10), p_data_fim: diaData(0), p_por_dia: true })
    expect(r.ok).toBe(true)
    const c = r.cortes.find((x) => x.codigo === cod('C'))!
    expect(c, 'o corte de teste aparece').toBeTruthy()
    // entrada O1 = 100+50+80 = 230; O2 = 200+100 = 300 (o F697 de 9999 kg foi ignorado)
    const o1 = c.origens.find((o) => o.origem_codigo === cod('O1'))!
    const o2 = c.origens.find((o) => o.origem_codigo === cod('O2'))!
    expect(o1.kg_entrada).toBe(230)
    expect(o2.kg_entrada).toBe(300)
    expect(Number(o1.esperado_kg)).toBeCloseTo(69, 2)   // 230 × 30%
    expect(Number(o2.esperado_kg)).toBeCloseTo(60, 2)   // 300 × 20%
    expect(Number(c.esperado_kg)).toBeCloseTo(129, 2)   // soma ponderada
    expect(Number(c.real_kg)).toBeCloseTo(129, 2)       // UM número só (70+15+44) — não 258
    expect(Number(c.real_kg)).toBeLessThan(200)         // guarda explícita contra a dobra
    expect(Number(c.eficiencia_pct)).toBeCloseTo(100, 1)
    expect(c.fonte).toBe('sistema_vinculado')
    // a visão por origem reparte o real proporcional ao esperado e soma ao real total (uma vez)
    const ro1 = r.origens.find((o) => o.codigo === cod('O1'))!.real_total_saida ?? 0
    const ro2 = r.origens.find((o) => o.codigo === cod('O2'))!.real_total_saida ?? 0
    expect(Number(ro1) + Number(ro2)).toBeCloseTo(129, 1)
    // série por dia presente
    expect(r.serie.length).toBeGreaterThanOrEqual(3)
  })

  test('sugerir: a regressão recupera ~30% e ~20% com confiança alta', async () => {
    const r = await rpc<SugResp>('fn_prod_rendimento_sugerir', { p_company_id: DEMO, p_plant_id: plant, p_dias: 60 })
    expect(r.ok).toBe(true)
    const c = r.cortes.find((x) => x.corte_codigo === cod('C'))!
    expect(c.n_origens).toBe(2)
    expect(c.status).toBe('ok')
    const s1 = c.origens.find((o) => o.origem_codigo === cod('O1'))!
    const s2 = c.origens.find((o) => o.origem_codigo === cod('O2'))!
    expect(s1.resultado).toBe('ok')
    expect(Number(s1.pct_sugerido)).toBeCloseTo(30, 0)
    expect(Number(s2.pct_sugerido)).toBeCloseTo(20, 0)
    expect(Number(s1.r2)).toBeGreaterThan(0.9)
    expect(s1.dias).toBe(3)
  })

  test('comparativo (telas antigas): real repartido por origem soma ao real do corte, sem dobrar', async () => {
    const r = await rpc<{ ok: boolean; origens: { origem_codigo: string; saidas: { codigo: string; real_kg: number | null; diff_kg: number | null }[] }[] }>(
      'fn_prod_rendimento_comparativo', { p_company_id: DEMO, p_plant_id: plant, p_data_ini: diaData(10), p_data_fim: diaData(0) })
    expect(r.ok).toBe(true)
    const so1 = r.origens.find((o) => o.origem_codigo === cod('O1'))!.saidas.find((s) => s.codigo === cod('C'))!
    const so2 = r.origens.find((o) => o.origem_codigo === cod('O2'))!.saidas.find((s) => s.codigo === cod('C'))!
    expect(Number(so1.real_kg)).toBeCloseTo(69, 1)
    expect(Number(so2.real_kg)).toBeCloseTo(60, 1)
    expect(Number(so1.real_kg) + Number(so2.real_kg)).toBeCloseTo(129, 1) // o corte real, uma vez
  })
})
