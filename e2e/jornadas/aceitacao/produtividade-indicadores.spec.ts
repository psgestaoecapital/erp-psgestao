// Produtividade F2: fn_prod_indicadores é só leitura e devolve "sem dado" (nunca zero inventado); meta salva e limpa;
// base do kg selecionável (padrão PCP0302). Depende da migration 20261006120010 → @pos-migration. Roda na DEMO Indústria (SST).

import { test, expect } from '../../support/fixtures'
import { rpc } from '../../support/api'

const DEMO_SST = 'b0700000-0000-4000-a000-000000000005'

type Setor = { setor: string; meta_kg_hh: number | null; kg_hh: number | null; dias: { kg_hh: number | null; kg: number | null; motivo_sem_dado: string | null }[] }
type Resp = { ok: boolean; base: string; setores: Setor[]; lacunas: string[] }
const dia = (d: number) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10)
const ler = (extra: Record<string, unknown> = {}, ini = 30, fim = 0) =>
  rpc<Resp>('fn_prod_indicadores', { p_company_id: DEMO_SST, p_de: dia(ini), p_ate: dia(fim), ...extra })

test.describe('Produtividade · indicadores', { tag: '@pos-migration' }, () => {
  test.afterAll(async () => { await rpc('fn_prod_indicador_meta_salvar', { p_company_id: DEMO_SST, p_setor: 'DESOSSA', p_meta: null }).catch(() => {}) })

  test('correção: dia sem produção/ponto confiável vem como "sem dado" com motivo, nunca zero', async () => {
    const r = await ler()
    expect(r.ok).toBe(true)
    expect(r.base).toBe('PCP0302')
    for (const d of r.setores.flatMap(s => s.dias).filter(x => x.kg_hh == null)) expect(d.motivo_sem_dado).toBeTruthy()
  })

  test('caminho principal: as 3 bases de kg são aceitas, base inválida e período inválido são recusados, meta salva e limpa', async () => {
    for (const p_base of ['PCP0302', 'PCP0301+PCP0302', 'PCP0301_F630']) expect((await ler({ p_base, p_setor: 'DESOSSA' }, 7)).base).toBe(p_base)
    await expect(ler({ p_base: 'XYZ' }, 7)).rejects.toThrow()
    await expect(ler({}, 0, 10)).rejects.toThrow()
    await rpc('fn_prod_indicador_meta_salvar', { p_company_id: DEMO_SST, p_setor: 'DESOSSA', p_meta: 123.5 })
    expect(Number((await ler({ p_setor: 'DESOSSA' }, 7)).setores[0].meta_kg_hh)).toBe(123.5)
    await rpc('fn_prod_indicador_meta_salvar', { p_company_id: DEMO_SST, p_setor: 'DESOSSA', p_meta: null })
    expect((await ler({ p_setor: 'DESOSSA' }, 7)).setores[0].meta_kg_hh).toBeNull()
  })
})
