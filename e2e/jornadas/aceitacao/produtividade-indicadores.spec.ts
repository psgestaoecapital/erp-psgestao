// Produtividade F2: fn_prod_indicadores é só leitura e devolve "sem dado" (nunca zero inventado); meta salva e limpa;
// base do kg selecionável (padrão PCP0302). Depende da migration 20261006120010 → @pos-migration. Roda na DEMO Indústria (SST).
// Chama como o ROBÔ (JWT real): a guarda fn_compliance_assert recusa service_role. Sem vínculo do robô com a demo
// industrial, o teste fica NEUTRO com motivo (RD-64), nunca vermelho — e nunca contorna a guarda.

import { test, expect } from '../../support/fixtures'
import { rpcComoRobo } from '../../support/api'

const DEMO_SST = 'b0700000-0000-4000-a000-000000000005'

type Setor = { setor: string; meta_kg_hh: number | null; kg_hh: number | null; dias: { kg_hh: number | null; kg: number | null; motivo_sem_dado: string | null }[] }
type Resp = { ok: boolean; base: string; setores: Setor[]; lacunas: string[] }
const dia = (d: number) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10)
const chamar = <T,>(fn: string, args: Record<string, unknown>) => rpcComoRobo<T>(fn, args)
const ler = async (extra: Record<string, unknown> = {}, ini = 30, fim = 0) => {
  const r = await chamar<Resp>('fn_prod_indicadores', { p_company_id: DEMO_SST, p_de: dia(ini), p_ate: dia(fim), ...extra })
  if (r.status !== 200) throw new Error(`fn_prod_indicadores ${r.status}: ${r.texto}`)
  return r.corpo as Resp
}
let semAcesso = false
const salvarMeta = (p_meta: number | null) => chamar('fn_prod_indicador_meta_salvar', { p_company_id: DEMO_SST, p_setor: 'DESOSSA', p_meta })

test.describe('Produtividade · indicadores', { tag: '@pos-migration' }, () => {
  test.beforeAll(async () => {
    const r = await chamar('fn_prod_indicadores', { p_company_id: DEMO_SST, p_de: dia(7), p_ate: dia(0) })
    semAcesso = r.status === 403 && /sem_acesso/.test(r.texto)
    if (!semAcesso) expect(r.status, r.texto).toBe(200)
  })
  test.beforeEach(() => { test.skip(semAcesso, 'não testado: robô sem acesso à demo industrial') })
  test.afterAll(async () => { if (!semAcesso) await salvarMeta(null).catch(() => {}) })

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
    expect((await salvarMeta(123.5)).status).toBe(200)
    expect(Number((await ler({ p_setor: 'DESOSSA' }, 7)).setores[0].meta_kg_hh)).toBe(123.5)
    expect((await salvarMeta(null)).status).toBe(200)
    expect((await ler({ p_setor: 'DESOSSA' }, 7)).setores[0].meta_kg_hh).toBeNull()
  })
})
