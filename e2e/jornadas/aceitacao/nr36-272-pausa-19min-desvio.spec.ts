// #272 (Frioeste · SST) · "pausas com tempo menor de 20 min não aparecem como desvio no Painel nem na Supervisão — ex.:
// Anderson, 16/09, 19:25". Causa: o relatório traz a duração com segundos (1165 s) e os horários só com minutos
// (07:42→08:02); a apuração recalculava pelos horários (20 min exatos) e o dia saía "conforme". Migration
// 20260929030000: fn_nr36_duracao_seg (mesma regra da classificação) dentro de fn_nr36_apurar.
// Prova na demo Indústria (SST), pelo caminho oficial (importar → apurar), num dia único por execução; tudo o que o
// teste cria é removido no fim (régua e elegibilidade voltam ao que eram).

import { test, expect } from '../../support/fixtures'
import { dbSelect, dbInsert, dbDelete, obterSessionPayload, registrarJornada } from '../../support/api'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const DEMO_SST = 'b0700000-0000-4000-a000-000000000005'
// dia único por execução, SEMPRE em 2021 (sem horário de verão no Brasil desde 2019). A 1ª versão sorteava 2005–2015:
// em 01/11/2010 (horário de verão) o 07:42-03:00 virou 08:42 em São Paulo e o veredito de produção deu vermelho
// (29/09) — defeito do teste, não da correção. Um ano por teste de pausas: #256 = 2020, #272 = 2021.
const base = new Date(Date.UTC(2021, 0, 1) + (Math.floor(Date.now() / 60000) % 360) * 86400000)
const DIA = base.toISOString().slice(0, 10)
const ts = (h: string) => `${DIA}T${h}:00-03:00`

let cpf = ''
let colaboradorId = ''
let criouRegra = false
let eraElegivel = false
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

test.describe('Pausa de 19:25 é desvio (#272)', () => {
  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_SST}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    const [c] = await dbSelect<{ id: string; cpf: string }>('ind_ponto_colaborador',
      `company_id=eq.${DEMO_SST}&nome=eq.${encodeURIComponent('Ana Paula Demo')}&select=id,cpf`)
    expect(c, 'a demo tem a colaboradora Ana Paula Demo').toBeTruthy()
    cpf = c.cpf; colaboradorId = c.id
    const regras = await dbSelect<{ id: string }>('nr36_pausa_regra', `company_id=eq.${DEMO_SST}&tipo=eq.termica_253&select=id`)
    if (regras.length === 0) { await comoRobo('fn_nr36_regra_seed_padrao', { p_company_id: DEMO_SST }); criouRegra = true }
    const eleg = await dbSelect<{ ativo: boolean }>('nr36_funcionario_elegivel', `company_id=eq.${DEMO_SST}&colaborador_id=eq.${c.id}&tipo=eq.termica_253&select=ativo`)
    eraElegivel = !!eleg[0]?.ativo
    await comoRobo('fn_nr36_elegivel_set', { p_company_id: DEMO_SST, p_colaborador_id: c.id, p_tipo: 'termica_253', p_ativo: true })
    // jornada do dia no ponto (04:00–13:47, como a do Anderson) — a apuração mede a exposição por ela
    await dbInsert('ind_ponto_dia', {
      company_id: DEMO_SST, cpf, data: DIA, shift: '04:00-09:00 10:10-13:50', worked_seconds: 31200, total_pontos: 4, tem_ajuste: false,
      raw: { points: ['04:00', '09:00', '10:10', '13:47'].map(h => ({ datetime: `${DIA}T${h}:00` })), origem: 'e2e-272' },
    })
  })

  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-272-pausa-19min-desvio', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.afterAll(async () => {
    if (!cpf) return
    await dbDelete('nr36_pausa_apurada', `company_id=eq.${DEMO_SST}&cpf=eq.${cpf}&data=eq.${DIA}`).catch(() => {})
    await dbDelete('ind_ponto_pausa', `company_id=eq.${DEMO_SST}&cpf=eq.${cpf}&data=eq.${DIA}`).catch(() => {})
    await dbDelete('ind_ponto_dia', `company_id=eq.${DEMO_SST}&cpf=eq.${cpf}&data=eq.${DIA}`).catch(() => {})
    if (uploadId) await dbDelete('nr36_upload', `id=eq.${uploadId}`).catch(() => {})
    if (!eraElegivel) await comoRobo('fn_nr36_elegivel_set', { p_company_id: DEMO_SST, p_colaborador_id: colaboradorId, p_tipo: 'termica_253', p_ativo: false }).catch(() => {})
    if (criouRegra) await dbDelete('nr36_pausa_regra', `company_id=eq.${DEMO_SST}`).catch(() => {})
  })

  test('importar o dia com a pausa de 19:25 → apuração dá DESVIO (pausa insuficiente de 19 min)', { tag: '@pos-migration' }, async () => {
    const hash = `e2e-272-${Date.now()}`
    const reg = await comoRobo<{ ok: boolean; upload_id?: string; mensagem?: string }>('fn_nr36_upload_registrar', {
      p_company_id: DEMO_SST, p_arquivo_nome: 'e2e-272.xlsx', p_arquivo_path: `e2e/${hash}.xlsx`, p_arquivo_hash: hash,
      p_bytes: 1, p_mime: null, p_periodo_ini: DIA, p_periodo_fim: DIA,
    })
    expect(reg.ok, reg.mensagem).toBe(true)
    uploadId = reg.upload_id!
    // as 3 pausas do Anderson em 16/09, com a duração do relatório (segundos)
    const linhas = [['05:36', '05:56', 1245], ['07:42', '08:02', 1165], ['11:37', '11:59', 1353]]
      .map(([ini, fim, dur]) => ({ cpf, data: DIA, inicio: ts(String(ini)), fim: ts(String(fim)), duracao_seg: dur, tipo: 'termica_253' }))
    const proc = await comoRobo<{ ok: boolean; aceitas: number; mensagem?: string }>('fn_nr36_upload_processar', { p_upload_id: uploadId, p_linhas: linhas })
    expect(proc.ok, proc.mensagem).toBe(true)
    expect(proc.aceitas).toBe(3)

    const [ap] = await dbSelect<{ status: string; detalhe: { desvios: Array<{ tipo: string }>; pausas: Array<{ de: string; min: number; classe: string }> } }>(
      'nr36_pausa_apurada', `company_id=eq.${DEMO_SST}&cpf=eq.${cpf}&data=eq.${DIA}&tipo=eq.termica_253&select=status,detalhe`)
    expect(ap, 'o dia foi apurado').toBeTruthy()
    const p0742 = ap.detalhe.pausas.find(p => p.de === '07:42')
    expect(p0742?.classe, 'a pausa das 07:42 é insuficiente').toBe('pausa_insuficiente')
    expect(p0742?.min, 'a duração mostrada é a do relatório (19 min), não 20').toBe(19)
    expect(ap.status, 'o dia é DESVIO (antes saía conforme)').toBe('desvio')
    expect(ap.detalhe.desvios.map(d => d.tipo)).toContain('pausa_insuficiente')
  })
})
