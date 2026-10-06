// Produtividade F2: fn_prod_indicadores é só leitura e devolve "sem dado" (nunca zero inventado); meta salva e limpa.
// Depende da migration 20261006120010 → @pos-migration. Roda na DEMO Indústria (SST).

import { test, expect } from '../../support/fixtures'
import { rpc } from '../../support/api'

const DEMO_SST = 'b0700000-0000-4000-a000-000000000005'
const SETOR = 'E2E-PROD-SETOR'

type Resp = { ok: boolean; linhas: { setor: string; kg_hh: number | null; kg: number | null; motivo_sem_dado: string | null }[]; metas: Record<string, number>; setores_com_producao: string[] }
const dia = (d: number) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10)

test.describe('Produtividade · indicadores', { tag: '@pos-migration' }, () => {
  test.afterAll(async () => { await rpc('fn_prod_indicador_meta_salvar', { p_company_id: DEMO_SST, p_setor: SETOR, p_meta: null }).catch(() => {}) })

  test('correção: só Desossa tem kg; setor sem produção medida vem como "sem dado"', async () => {
    const r = await rpc<Resp>('fn_prod_indicadores', { p_company_id: DEMO_SST, p_de: dia(30), p_ate: dia(0) })
    expect(r.ok).toBe(true)
    expect(r.setores_com_producao).toEqual(['DESOSSA'])
    for (const l of r.linhas.filter(x => x.setor !== 'DESOSSA')) {
      expect(l.kg_hh).toBeNull()
      expect(l.motivo_sem_dado).toBeTruthy()
    }
  })

  test('caminho principal: meta salva aparece na leitura e some ao limpar; período inválido é recusado', async () => {
    await rpc('fn_prod_indicador_meta_salvar', { p_company_id: DEMO_SST, p_setor: SETOR, p_meta: 123.5 })
    const com = await rpc<Resp>('fn_prod_indicadores', { p_company_id: DEMO_SST, p_de: dia(7), p_ate: dia(0) })
    expect(Number(com.metas[SETOR])).toBe(123.5)
    await rpc('fn_prod_indicador_meta_salvar', { p_company_id: DEMO_SST, p_setor: SETOR, p_meta: null })
    const sem = await rpc<Resp>('fn_prod_indicadores', { p_company_id: DEMO_SST, p_de: dia(7), p_ate: dia(0) })
    expect(sem.metas[SETOR]).toBeUndefined()
    await expect(rpc('fn_prod_indicadores', { p_company_id: DEMO_SST, p_de: dia(0), p_ate: dia(10) })).rejects.toThrow()
  })
})
