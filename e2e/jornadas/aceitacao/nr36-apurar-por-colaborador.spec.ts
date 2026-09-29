// Frioeste · decisões do CEO de 29/09: reapurar UM colaborador (os 22 dias do #272; a releitura da Conferência do #256)
// não pode reapurar a data inteira de todos — a reapuração geral fica para o fechamento de outubro. Migration
// 20260929050000: fn_nr36_apurar(empresa, de, até, p_cpf) e a releitura passa o cpf.
// Demo Indústria (SST): dois colaboradores no mesmo dia único; reapurar um não toca o outro. Tudo o que o teste cria é
// removido no fim (régua e elegibilidade voltam ao que eram).

import { test, expect } from '../../support/fixtures'
import { dbSelect, dbInsert, dbDelete, obterSessionPayload, registrarJornada } from '../../support/api'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const DEMO_SST = 'b0700000-0000-4000-a000-000000000005'
const base = new Date(Date.UTC(1985, 0, 7) + (Math.floor(Date.now() / 60000) % 3650) * 86400000)
const DIA = base.toISOString().slice(0, 10)
const ts = (h: string) => `${DIA}T${h}:00-03:00`
type Colab = { id: string; cpf: string; nome: string; eraElegivel: boolean }
const colabs: Colab[] = []
let criouRegra = false
let uploadId = ''

async function comoRobo<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  expect(r.status, `${fn} responde`).toBe(200)
  const txt = await r.text()
  return (txt ? JSON.parse(txt) : null) as T
}
const apurada = (cpf: string) => dbSelect<{ status: string; apurado_em: string }>('nr36_pausa_apurada',
  `company_id=eq.${DEMO_SST}&cpf=eq.${cpf}&data=eq.${DIA}&tipo=eq.termica_253&select=status,apurado_em`)

test.describe('Apuração por colaborador — reapurar um não reapura os outros do dia', () => {
  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_SST}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    for (const nome of ['Ana Paula Demo', 'Bruno Carvalho Demo']) {
      const [c] = await dbSelect<{ id: string; cpf: string }>('ind_ponto_colaborador', `company_id=eq.${DEMO_SST}&nome=eq.${encodeURIComponent(nome)}&select=id,cpf`)
      expect(c, `a demo tem ${nome}`).toBeTruthy()
      const eleg = await dbSelect<{ ativo: boolean }>('nr36_funcionario_elegivel', `company_id=eq.${DEMO_SST}&colaborador_id=eq.${c.id}&tipo=eq.termica_253&select=ativo`)
      colabs.push({ id: c.id, cpf: c.cpf, nome, eraElegivel: !!eleg[0]?.ativo })
    }
    const regras = await dbSelect<{ id: string }>('nr36_pausa_regra', `company_id=eq.${DEMO_SST}&tipo=eq.termica_253&select=id`)
    if (regras.length === 0) { await comoRobo('fn_nr36_regra_seed_padrao', { p_company_id: DEMO_SST }); criouRegra = true }
    for (const c of colabs) {
      await comoRobo('fn_nr36_elegivel_set', { p_company_id: DEMO_SST, p_colaborador_id: c.id, p_tipo: 'termica_253', p_ativo: true })
      await dbInsert('ind_ponto_dia', {
        company_id: DEMO_SST, cpf: c.cpf, data: DIA, shift: '04:00-09:00 10:10-13:50', worked_seconds: 31200, total_pontos: 4, tem_ajuste: false,
        raw: { points: ['04:00', '09:00', '10:10', '13:47'].map(h => ({ datetime: `${DIA}T${h}:00` })), origem: 'e2e-apurar-cpf' },
      })
    }
  })

  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-nr36-apurar-por-colaborador', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.afterAll(async () => {
    for (const c of colabs) {
      await dbDelete('nr36_pausa_apurada', `company_id=eq.${DEMO_SST}&cpf=eq.${c.cpf}&data=eq.${DIA}`).catch(() => {})
      await dbDelete('ind_ponto_pausa', `company_id=eq.${DEMO_SST}&cpf=eq.${c.cpf}&data=eq.${DIA}`).catch(() => {})
      await dbDelete('ind_ponto_dia', `company_id=eq.${DEMO_SST}&cpf=eq.${c.cpf}&data=eq.${DIA}`).catch(() => {})
      if (!c.eraElegivel) await comoRobo('fn_nr36_elegivel_set', { p_company_id: DEMO_SST, p_colaborador_id: c.id, p_tipo: 'termica_253', p_ativo: false }).catch(() => {})
    }
    if (uploadId) await dbDelete('nr36_upload', `id=eq.${uploadId}`).catch(() => {})
    if (criouRegra) await dbDelete('nr36_pausa_regra', `company_id=eq.${DEMO_SST}`).catch(() => {})
  })

  test('com o cpf, só aquele colaborador é reapurado; sem o cpf, o período inteiro (como antes)', { tag: '@pos-migration' }, async () => {
    const hash = `e2e-apurar-cpf-${Date.now()}`
    const reg = await comoRobo<{ ok: boolean; upload_id?: string; mensagem?: string }>('fn_nr36_upload_registrar', {
      p_company_id: DEMO_SST, p_arquivo_nome: 'e2e-apurar-cpf.xlsx', p_arquivo_path: `e2e/${hash}.xlsx`, p_arquivo_hash: hash,
      p_bytes: 1, p_mime: null, p_periodo_ini: DIA, p_periodo_fim: DIA,
    })
    expect(reg.ok, reg.mensagem).toBe(true)
    uploadId = reg.upload_id!
    const linhas = colabs.flatMap(c => [['05:36', '05:56', 1245], ['07:42', '08:02', 1300], ['11:37', '11:59', 1353]]
      .map(([ini, fim, dur]) => ({ cpf: c.cpf, data: DIA, inicio: ts(String(ini)), fim: ts(String(fim)), duracao_seg: dur, tipo: 'termica_253' })))
    const proc = await comoRobo<{ ok: boolean; mensagem?: string }>('fn_nr36_upload_processar', { p_upload_id: uploadId, p_linhas: linhas })
    expect(proc.ok, proc.mensagem).toBe(true)
    const [a0] = await apurada(colabs[0].cpf); const [b0] = await apurada(colabs[1].cpf)
    expect(a0 && b0, 'os dois colaboradores apurados pela importação').toBeTruthy()

    await new Promise(r => setTimeout(r, 1100))
    await comoRobo('fn_nr36_apurar', { p_company_id: DEMO_SST, p_dt_ini: DIA, p_dt_fim: DIA, p_cpf: colabs[0].cpf })
    const [a1] = await apurada(colabs[0].cpf); const [b1] = await apurada(colabs[1].cpf)
    expect(new Date(a1.apurado_em).getTime(), `${colabs[0].nome} reapurado`).toBeGreaterThan(new Date(a0.apurado_em).getTime())
    expect(b1.apurado_em, `${colabs[1].nome} NÃO foi reapurado`).toBe(b0.apurado_em)

    await new Promise(r => setTimeout(r, 1100))
    await comoRobo('fn_nr36_apurar', { p_company_id: DEMO_SST, p_dt_ini: DIA, p_dt_fim: DIA })
    const [b2] = await apurada(colabs[1].cpf)
    expect(new Date(b2.apurado_em).getTime(), 'sem cpf, o período inteiro é reapurado (como antes)').toBeGreaterThan(new Date(b1.apurado_em).getTime())
  })
})
