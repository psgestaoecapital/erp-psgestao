// #587 (Frioeste · SST · CEO 04/10) · a apuração térmica_253 dava "conforme" em dia com pausa faltando: o almoço
// contava como exposição (16/09 do Leonel: 5 devidas, 3 feitas, "conforme"). Migration 20261005000000:
// (a) devido desconta a janela de almoço quando almoco_interrompe_exposicao=true; (b) realizadas < devidas sem pausa
// abaixo do mínimo → pendente_confirmacao / pausas_faltantes. Empresa SEM o parâmetro: resultado idêntico ao de antes.
// Fixtures: os horários reais do Leonel (16/09 e 30/09), SEM CPF — a colaboradora é a Ana Paula Demo. Dia único por
// execução em 2022 (um ano por teste de pausas: #256=2020, #272=2021, #587=2022); tudo é removido no fim.

import { test, expect } from '../../support/fixtures'
import { dbSelect, dbInsert, dbDelete, dbPatch, obterSessionPayload, registrarJornada } from '../../support/api'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const DEMO_SST = 'b0700000-0000-4000-a000-000000000005'
const MATRICULA = 'E2E587' // matrícula exclusiva do spec: toda linha criada aqui leva essa marca
// Dia único por worker (projetos desktop e celular rodam em paralelo com o mesmo CPF): 2022 inteiro é do #587.
let DIA = ''
let COMP = ''
const diaDoWorker = (idx: number) => new Date(Date.UTC(2022, 0, 1) + ((Math.floor(Date.now() / 60000) + idx * 37) % 330) * 86400000).toISOString().slice(0, 10)

let cpf = ''
let colaboradorId = ''
let criouRegra = false
let eraElegivel = false
let uploadId = ''
let regraOriginal: Record<string, unknown> | null = null

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

type Ap = { status: string; detalhe: { pausas_devidas: number; pausas_realizadas: number; sem_dado_motivo: string | null; almoco_min?: number } }
const apurado = async () => (await dbSelect<Ap>('nr36_pausa_apurada', `company_id=eq.${DEMO_SST}&cpf=eq.${cpf}&data=eq.${DIA}&tipo=eq.termica_253&select=status,detalhe`))[0]

async function importar(batidas: string[], pausas: Array<[string, string, number]>, shift: string) {
  await dbDelete('nr36_pausa_apurada', `company_id=eq.${DEMO_SST}&cpf=eq.${cpf}&data=eq.${DIA}`).catch(() => {})
  await dbDelete('ind_ponto_pausa', `company_id=eq.${DEMO_SST}&cpf=eq.${cpf}&data=eq.${DIA}`).catch(() => {})
  await dbDelete('ind_ponto_dia', `company_id=eq.${DEMO_SST}&cpf=eq.${cpf}&data=eq.${DIA}`).catch(() => {})
  await dbInsert('ind_ponto_dia', {
    company_id: DEMO_SST, cpf, registration_number: MATRICULA, data: DIA, shift, worked_seconds: 30000, total_pontos: batidas.length, tem_ajuste: false,
    raw: { points: batidas.map(h => ({ datetime: `${DIA}T${h}:00` })), origem: 'e2e-587' },
  })
  const hash = `e2e-587-${Date.now()}`
  const reg = await comoRobo<{ ok: boolean; upload_id?: string; mensagem?: string }>('fn_nr36_upload_registrar', {
    p_company_id: DEMO_SST, p_arquivo_nome: 'e2e-587.xlsx', p_arquivo_path: `e2e/${hash}.xlsx`, p_arquivo_hash: hash,
    p_bytes: 1, p_mime: null, p_periodo_ini: DIA, p_periodo_fim: DIA,
  })
  expect(reg.ok, reg.mensagem).toBe(true)
  if (uploadId) await dbDelete('nr36_upload', `id=eq.${uploadId}`).catch(() => {})
  uploadId = reg.upload_id!
  const linhas = pausas.map(([ini, fim, dur]) => ({ cpf, data: DIA, inicio: `${DIA}T${ini}:00-03:00`, fim: `${DIA}T${fim}:00-03:00`, duracao_seg: dur, tipo: 'termica_253' }))
  const proc = await comoRobo<{ ok: boolean; aceitas: number; mensagem?: string }>('fn_nr36_upload_processar', { p_upload_id: uploadId, p_linhas: linhas })
  expect(proc.ok, proc.mensagem).toBe(true)
  expect(proc.aceitas).toBe(pausas.length)
}

// 16/09 do Leonel: batidas 05:28 10:58 12:12 15:27 · pausas 07:07–07:29 (22), 09:09–09:29 (20), 13:50–14:13 (23)
const D16 = { batidas: ['05:28', '10:58', '12:12', '15:27'], shift: '05:30-11:00 12:10-15:28',
  pausas: [['07:07', '07:29', 1320], ['09:09', '09:29', 1200], ['13:50', '14:13', 1380]] as Array<[string, string, number]> }
// 30/09: batidas 07:19 12:00 12:59 17:23 · pausas 08:47–09:13 (26), 11:39–11:59 (20), 14:49–15:11 (22), 16:40–17:00 (20)
const D30 = { batidas: ['07:19', '12:00', '12:59', '17:23'], shift: '07:30-12:00 13:10-17:28',
  pausas: [['08:47', '09:13', 1560], ['11:39', '11:59', 1200], ['14:49', '15:11', 1320], ['16:40', '17:00', 1200]] as Array<[string, string, number]> }

test.describe('NR-36: almoço desconta da exposição e pausa faltante é pendente (#587)', () => {
  // limpeza do próprio fixture (só 2022, só a colaboradora da demo, só a matrícula do spec)
  async function limparFixture() {
    const janela = `company_id=eq.${DEMO_SST}&cpf=eq.${cpf}&data=gte.2022-01-01&data=lte.2022-12-31`
    const cien = await dbSelect<{ id: string }>('nr36_ciencia_mensal', `company_id=eq.${DEMO_SST}&cpf=eq.${cpf}&competencia=gte.2022-01-01&competencia=lte.2022-12-31&select=id`).catch(() => [])
    for (const c of cien) await dbDelete('nr36_ciencia_mensal_historico', `ciencia_id=eq.${c.id}`).catch(() => {})
    await dbDelete('nr36_ciencia_mensal', `company_id=eq.${DEMO_SST}&cpf=eq.${cpf}&competencia=gte.2022-01-01&competencia=lte.2022-12-31`).catch(() => {})
    await dbDelete('nr36_pausa_apurada', janela).catch(() => {})
    await dbDelete('ind_ponto_pausa', janela).catch(() => {})
    await dbDelete('ind_ponto_dia', `${janela}&registration_number=eq.${MATRICULA}`).catch(() => {})
    await dbDelete('ind_ponto_dia', `${janela}&registration_number=is.null`).catch(() => {})
  }

  test.beforeAll(async ({}, testInfo) => {
    DIA = diaDoWorker(testInfo.parallelIndex)
    COMP = DIA.slice(0, 7) + '-01'
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_SST}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    const [c] = await dbSelect<{ id: string; cpf: string }>('ind_ponto_colaborador',
      `company_id=eq.${DEMO_SST}&nome=eq.${encodeURIComponent('Ana Paula Demo')}&select=id,cpf`)
    expect(c, 'a demo tem a colaboradora Ana Paula Demo').toBeTruthy()
    cpf = c.cpf; colaboradorId = c.id
    await limparFixture() // sobra de execução interrompida
    const regras = await dbSelect<{ parametros: Record<string, unknown> }>('nr36_pausa_regra', `company_id=eq.${DEMO_SST}&tipo=eq.termica_253&select=parametros`)
    if (regras.length === 0) { await comoRobo('fn_nr36_regra_seed_padrao', { p_company_id: DEMO_SST }); criouRegra = true }
    const [r] = await dbSelect<{ parametros: Record<string, unknown> }>('nr36_pausa_regra', `company_id=eq.${DEMO_SST}&tipo=eq.termica_253&select=parametros`)
    regraOriginal = r.parametros
    const eleg = await dbSelect<{ ativo: boolean }>('nr36_funcionario_elegivel', `company_id=eq.${DEMO_SST}&colaborador_id=eq.${c.id}&tipo=eq.termica_253&select=ativo`)
    eraElegivel = !!eleg[0]?.ativo
    await comoRobo('fn_nr36_elegivel_set', { p_company_id: DEMO_SST, p_colaborador_id: c.id, p_tipo: 'termica_253', p_ativo: true })
  })

  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-587-almoco-pausas-faltantes', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.afterAll(async () => {
    if (!cpf) return
    await limparFixture()
    if (uploadId) await dbDelete('nr36_upload', `id=eq.${uploadId}`).catch(() => {})
    if (regraOriginal && !criouRegra) await dbPatch('nr36_pausa_regra', `company_id=eq.${DEMO_SST}&tipo=eq.termica_253`, { parametros: regraOriginal }).catch(() => {})
    if (!eraElegivel) await comoRobo('fn_nr36_elegivel_set', { p_company_id: DEMO_SST, p_colaborador_id: colaboradorId, p_tipo: 'termica_253', p_ativo: false }).catch(() => {})
    if (criouRegra) await dbDelete('nr36_pausa_regra', `company_id=eq.${DEMO_SST}`).catch(() => {})
  })

  test('com almoco_interrompe_exposicao: 16/09 do Leonel (3 de 4 pausas) vira PENDENTE · pausas_faltantes', { tag: '@pos-migration' }, async () => {
    await dbPatch('nr36_pausa_regra', `company_id=eq.${DEMO_SST}&tipo=eq.termica_253`, { parametros: { ...(regraOriginal ?? {}), almoco_interrompe_exposicao: true } })
    await importar(D16.batidas, D16.pausas, D16.shift)
    const ap = await apurado()
    expect(ap.detalhe.almoco_min, 'almoço de 74 min descontado').toBe(74)
    expect(ap.detalhe.pausas_devidas).toBe(4)
    expect(ap.detalhe.pausas_realizadas).toBe(3)
    expect(ap.status, 'nunca conforme (RD-51) nem desvio por estimativa (RD-38)').toBe('pendente_confirmacao')
    expect(ap.detalhe.sem_dado_motivo).toBe('pausas_faltantes')

    // Supervisão: o pendente chega com o motivo e os números que a tela explica
    const sup = await comoRobo<{ pendentes: Array<{ cpf: string; data: string; motivo: string; pausas_devidas: number; pausas_realizadas: number }> }>(
      'fn_nr36_supervisao_pendentes', { p_company_id: DEMO_SST, p_dt_ini: DIA, p_dt_fim: DIA })
    const p = sup.pendentes.find(x => x.cpf === cpf && x.data === DIA)
    expect(p?.motivo).toBe('pausas_faltantes')
    expect([p?.pausas_devidas, p?.pausas_realizadas]).toEqual([4, 3])
  })

  test('com o parâmetro: 30/09 do Leonel (4 de 4 pausas) é CONFORME', { tag: '@pos-migration' }, async () => {
    await dbPatch('nr36_pausa_regra', `company_id=eq.${DEMO_SST}&tipo=eq.termica_253`, { parametros: { ...(regraOriginal ?? {}), almoco_interrompe_exposicao: true } })
    await importar(D30.batidas, D30.pausas, D30.shift)
    const ap = await apurado()
    expect(ap.detalhe.almoco_min, 'batidas 12:00 → 12:59 do Leonel: 59 min de fato').toBe(59)
    expect([ap.detalhe.pausas_devidas, ap.detalhe.pausas_realizadas]).toEqual([4, 4])
    expect(ap.status).toBe('conforme')
  })

  test('SEM o parâmetro de almoço: resultado idêntico ao de antes (16/09 segue 5 devidas × 3, conforme)', { tag: '@pos-migration' }, async () => {
    const { almoco_interrompe_exposicao: _, ...semParam } = (regraOriginal ?? {}) as Record<string, unknown>
    void _
    await dbPatch('nr36_pausa_regra', `company_id=eq.${DEMO_SST}&tipo=eq.termica_253`, { parametros: semParam })
    await importar(D16.batidas, D16.pausas, D16.shift)
    const ap = await apurado()
    expect(ap.detalhe.almoco_min, 'sem parâmetro nada é descontado').toBeUndefined()
    expect([ap.detalhe.pausas_devidas, ap.detalhe.pausas_realizadas]).toEqual([5, 3])
    expect(ap.status).toBe('conforme')
  })

  test('ciência mensal: assinada não muda; pendente muda de versão e a anterior vai ao histórico', { tag: '@pos-migration' }, async () => {
    await dbPatch('nr36_pausa_regra', `company_id=eq.${DEMO_SST}&tipo=eq.termica_253`, { parametros: { ...(regraOriginal ?? {}), almoco_interrompe_exposicao: true } })
    await importar(D16.batidas, D16.pausas, D16.shift)
    await comoRobo('fn_nr36_ciencia_gerar', { p_company_id: DEMO_SST, p_competencia: COMP, p_cpf: cpf })
    const q = `company_id=eq.${DEMO_SST}&cpf=eq.${cpf}&competencia=eq.${COMP}&select=id,versao,status,documento_hash`
    const [v1] = await dbSelect<{ id: string; versao: number; status: string; documento_hash: string }>('nr36_ciencia_mensal', q)
    expect(v1.status).toBe('pendente')
    expect(v1.versao).toBe(1)

    // pendente com conteúdo diferente → regenera como versão 2, a 1 fica no histórico
    await dbPatch('nr36_ciencia_mensal', `id=eq.${v1.id}`, { documento_hash: 'conteudo-antigo' })
    await comoRobo('fn_nr36_ciencia_gerar', { p_company_id: DEMO_SST, p_competencia: COMP, p_cpf: cpf })
    const [v2] = await dbSelect<{ versao: number; documento_hash: string }>('nr36_ciencia_mensal', q)
    expect(v2.versao).toBe(2)
    expect(v2.documento_hash).toBe(v1.documento_hash)
    const hist = await dbSelect<{ versao: number }>('nr36_ciencia_mensal_historico', `ciencia_id=eq.${v1.id}&select=versao`)
    expect(hist.map(h => h.versao)).toEqual([1])

    // assinada ou recusada: nada muda
    for (const st of ['assinado', 'recusado']) {
      await dbPatch('nr36_ciencia_mensal', `id=eq.${v1.id}`, { status: st, documento_hash: `trava-${st}`, ...(st === 'recusado' ? { recusa_assinar: true } : {}) })
      await comoRobo('fn_nr36_ciencia_gerar', { p_company_id: DEMO_SST, p_competencia: COMP, p_cpf: cpf })
      const [x] = await dbSelect<{ versao: number; status: string; documento_hash: string }>('nr36_ciencia_mensal', q)
      expect(x.status).toBe(st)
      expect(x.documento_hash, `ciência ${st} não é alterada`).toBe(`trava-${st}`)
      expect(x.versao).toBe(2)
    }
  })
})
