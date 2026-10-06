// #587 · regenerar ciências NR-36 pendentes após a reapuração (Eng. Chefe 06/10, mensagem bcebc26f).
// fn_nr36_ciencia_regenerar_servico (só serviço): pendente ganha nova versão (anterior no histórico); assinada fica intocada;
// fechada a usuário logado. Só na demo SST, 2023
// inteiro é deste spec, matrícula exclusiva, colaboradora Ana Paula Demo (SEM CPF no código); tudo removido no fim.

import { test, expect } from '../../support/fixtures'
import { dbSelect, dbInsert, dbDelete, dbPatch, rpc, obterSessionPayload, registrarJornada } from '../../support/api'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const DEMO_SST = 'b0700000-0000-4000-a000-000000000005'
const MATRICULA = 'E2E587C'
const diaDoWorker = (idx: number) => new Date(Date.UTC(2023, 0, 1) + ((Math.floor(Date.now() / 60000) + idx * 37) % 330) * 86400000).toISOString().slice(0, 10)
// 16/09 do Leonel (horários reais, sem CPF)
const BATIDAS = ['05:28', '10:58', '12:12', '15:27']
const PAUSAS: Array<[string, string, number]> = [['07:07', '07:29', 1320], ['09:09', '09:29', 1200], ['13:50', '14:13', 1380]]

let DIA = ''
let cpf = ''
let colaboradorId = ''
let criouRegra = false
let eraElegivel = false
let uploadId = ''
let regraOriginal: Record<string, unknown> | null = null

async function comoRobo(fn: string, args: Record<string, unknown>): Promise<{ status: number; corpo: unknown }> {
  const token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args),
  })
  const txt = await r.text()
  return { status: r.status, corpo: txt ? JSON.parse(txt) : null }
}
const robo = async <T>(fn: string, args: Record<string, unknown>) => { const r = await comoRobo(fn, args); expect(r.status, `${fn} responde`).toBe(200); return r.corpo as T }

type Ap = { status: string; devido_min: number; realizado_min: number; diferenca_min: number; detalhe: unknown }
const apurado = async () => (await dbSelect<Ap>('nr36_pausa_apurada', `company_id=eq.${DEMO_SST}&cpf=eq.${cpf}&data=eq.${DIA}&tipo=eq.termica_253&select=status,devido_min,realizado_min,diferenca_min,detalhe`))[0]

async function limpar() {
  await dbDelete('nr36_ciencia_mensal_historico', `company_id=eq.${DEMO_SST}&ciencia_id=in.(${(await dbSelect<{ id: string }>('nr36_ciencia_mensal', `company_id=eq.${DEMO_SST}&cpf=eq.${cpf}&competencia=gte.2023-01-01&competencia=lte.2023-12-31&select=id`)).map(x => x.id).join(',') || '00000000-0000-0000-0000-000000000000'})`).catch(() => {})
  await dbDelete('nr36_ciencia_mensal', `company_id=eq.${DEMO_SST}&cpf=eq.${cpf}&competencia=gte.2023-01-01&competencia=lte.2023-12-31`).catch(() => {})
  const janela = `company_id=eq.${DEMO_SST}&cpf=eq.${cpf}&data=gte.2023-01-01&data=lte.2023-12-31`
  await dbDelete('nr36_pausa_apurada_backup', `company_id=eq.${DEMO_SST}&cpf=eq.${cpf}&data=gte.2023-01-01&data=lte.2023-12-31`).catch(() => {})
  await dbDelete('nr36_pausa_apurada', janela).catch(() => {})
  await dbDelete('ind_ponto_pausa', janela).catch(() => {})
  // ind_ponto_dia não aceita DELETE físico (RD-30): o dia de teste é reaproveitado por upsert
}

async function importar() {
  await limpar()
  const row = { company_id: DEMO_SST, cpf, registration_number: MATRICULA, data: DIA, shift: '05:30-11:00 12:10-15:28', worked_seconds: 30000, total_pontos: BATIDAS.length, tem_ajuste: false,
    raw: { points: BATIDAS.map(h => ({ datetime: `${DIA}T${h}:00` })), origem: 'e2e-587c' } }
  const ja = await dbSelect<{ id: string }>('ind_ponto_dia', `company_id=eq.${DEMO_SST}&cpf=eq.${cpf}&data=eq.${DIA}&select=id`)
  if (ja.length > 0) await dbPatch('ind_ponto_dia', `id=eq.${ja[0].id}`, row); else await dbInsert('ind_ponto_dia', row)
  const hash = `e2e-587c-${Date.now()}`
  const reg = await robo<{ ok: boolean; upload_id?: string; mensagem?: string }>('fn_nr36_upload_registrar', {
    p_company_id: DEMO_SST, p_arquivo_nome: 'e2e-587c.xlsx', p_arquivo_path: `e2e/${hash}.xlsx`, p_arquivo_hash: hash, p_bytes: 1, p_mime: null, p_periodo_ini: DIA, p_periodo_fim: DIA })
  expect(reg.ok, reg.mensagem).toBe(true)
  if (uploadId) await dbDelete('nr36_upload', `id=eq.${uploadId}`).catch(() => {})
  uploadId = reg.upload_id!
  const linhas = PAUSAS.map(([i, f, d]) => ({ cpf, data: DIA, inicio: `${DIA}T${i}:00-03:00`, fim: `${DIA}T${f}:00-03:00`, duracao_seg: d, tipo: 'termica_253' }))
  const proc = await robo<{ ok: boolean; aceitas: number; mensagem?: string }>('fn_nr36_upload_processar', { p_upload_id: uploadId, p_linhas: linhas })
  expect(proc.ok, proc.mensagem).toBe(true)
}

test.describe('NR-36: regenerar ciências pendentes (#587)', () => {
  const competencia = () => `${DIA.slice(0, 7)}-01`
  const ciencia = async () => (await dbSelect<{ id: string; versao: number; status: string; resumo: Record<string, number>; versao_motivo: string | null }>(
    'nr36_ciencia_mensal', `company_id=eq.${DEMO_SST}&cpf=eq.${cpf}&competencia=eq.${competencia()}&tipo=eq.termica_253&select=id,versao,status,resumo,versao_motivo`))[0]
  const regenerar = () => rpc<{ ok: boolean; pendentes_no_periodo: number; regeneradas_nova_versao: number; sem_mudanca: number; assinadas_intocadas: number }>(
    'fn_nr36_ciencia_regenerar_servico', { p_company: DEMO_SST, p_inicio: DIA, p_fim: DIA, p_motivo: 'Reapuração com desconto do almoço e pausas faltantes' })

  test.beforeAll(async ({}, testInfo) => {
    DIA = diaDoWorker(testInfo.parallelIndex)
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_SST}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    const [c] = await dbSelect<{ id: string; cpf: string }>('ind_ponto_colaborador', `company_id=eq.${DEMO_SST}&nome=eq.${encodeURIComponent('Ana Paula Demo')}&select=id,cpf`)
    expect(c, 'a demo tem a colaboradora Ana Paula Demo').toBeTruthy()
    cpf = c.cpf; colaboradorId = c.id
    await limpar()
    const regras = await dbSelect<{ parametros: Record<string, unknown> }>('nr36_pausa_regra', `company_id=eq.${DEMO_SST}&tipo=eq.termica_253&select=parametros`)
    if (regras.length === 0) { await robo('fn_nr36_regra_seed_padrao', { p_company_id: DEMO_SST }); criouRegra = true }
    const [r] = await dbSelect<{ parametros: Record<string, unknown> }>('nr36_pausa_regra', `company_id=eq.${DEMO_SST}&tipo=eq.termica_253&select=parametros`)
    regraOriginal = r.parametros
    const eleg = await dbSelect<{ ativo: boolean }>('nr36_funcionario_elegivel', `company_id=eq.${DEMO_SST}&colaborador_id=eq.${c.id}&tipo=eq.termica_253&select=ativo`)
    eraElegivel = !!eleg[0]?.ativo
    await robo('fn_nr36_elegivel_set', { p_company_id: DEMO_SST, p_colaborador_id: c.id, p_tipo: 'termica_253', p_ativo: true })
    await dbPatch('nr36_pausa_regra', `company_id=eq.${DEMO_SST}&tipo=eq.termica_253`, { parametros: { ...(regraOriginal ?? {}), almoco_interrompe_exposicao: true } })
  })

  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-587-ciencia-regenerar', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.afterAll(async () => {
    if (!cpf) return
    await limpar()
    if (uploadId) await dbDelete('nr36_upload', `id=eq.${uploadId}`).catch(() => {})
    if (regraOriginal && !criouRegra) await dbPatch('nr36_pausa_regra', `company_id=eq.${DEMO_SST}&tipo=eq.termica_253`, { parametros: regraOriginal }).catch(() => {})
    if (!eraElegivel) await robo('fn_nr36_elegivel_set', { p_company_id: DEMO_SST, p_colaborador_id: colaboradorId, p_tipo: 'termica_253', p_ativo: false }).catch(() => {})
    if (criouRegra) await dbDelete('nr36_pausa_regra', `company_id=eq.${DEMO_SST}`).catch(() => {})
  })

  test('pendente ganha nova versão com motivo; fechado a usuário logado; segunda rodada não muda nada', { tag: '@pos-migration' }, async () => {
    await importar()
    await robo('fn_nr36_apurar', { p_company_id: DEMO_SST, p_dt_ini: DIA, p_dt_fim: DIA, p_cpf: cpf })
    const g = await robo<{ ok: boolean }>('fn_nr36_ciencia_gerar', { p_company_id: DEMO_SST, p_competencia: competencia(), p_cpf: cpf })
    expect(g.ok).toBe(true)
    const v1 = await ciencia()
    expect(v1.status).toBe('pendente')
    // apuração "antiga" por baixo da ciência pendente: o dia volta a conforme
    await dbPatch('nr36_pausa_apurada', `company_id=eq.${DEMO_SST}&cpf=eq.${cpf}&data=eq.${DIA}`, { status: 'conforme' })
    const rel = await regenerar()
    expect(rel.ok).toBe(true)
    expect(rel.regeneradas_nova_versao).toBeGreaterThanOrEqual(1)
    const v2 = await ciencia()
    expect(v2.versao, 'nova versão da pendente').toBe(v1.versao + 1)
    expect(v2.versao_motivo).toContain('Reapuração')
    const hist = await dbSelect<{ versao: number }>('nr36_ciencia_mensal_historico', `ciencia_id=eq.${v1.id}&select=versao`)
    expect(hist.map(h => h.versao), 'a versão anterior fica no histórico').toContain(v1.versao)
    const rel2 = await regenerar()
    expect(rel2.regeneradas_nova_versao, 'idempotente: sem mudança, sem versão nova').toBe(0)
    expect((await ciencia()).versao).toBe(v2.versao)
    const fechado = await comoRobo('fn_nr36_ciencia_regenerar_servico', { p_company: DEMO_SST, p_inicio: DIA, p_fim: DIA, p_motivo: 'tentativa de usuário logado' })
    expect(fechado.status, 'não é chamável por usuário logado').toBeGreaterThanOrEqual(401)
    const fechado2 = await comoRobo('fn_nr36_ciencia_gerar_nucleo', { p_company_id: DEMO_SST, p_competencia: competencia(), p_cpf: cpf })
    expect(fechado2.status, 'núcleo não é chamável por usuário logado').toBeGreaterThanOrEqual(401)
  })

  test('ciência assinada fica intocada (versão, resumo e status)', { tag: '@pos-migration' }, async () => {
    await importar()
    await robo('fn_nr36_apurar', { p_company_id: DEMO_SST, p_dt_ini: DIA, p_dt_fim: DIA, p_cpf: cpf })
    await robo('fn_nr36_ciencia_gerar', { p_company_id: DEMO_SST, p_competencia: competencia(), p_cpf: cpf })
    const antes = await ciencia()
    await dbPatch('nr36_ciencia_mensal', `id=eq.${antes.id}`, { status: 'assinado' })
    await dbPatch('nr36_pausa_apurada', `company_id=eq.${DEMO_SST}&cpf=eq.${cpf}&data=eq.${DIA}`, { status: 'conforme' })
    const rel = await regenerar()
    expect(rel.ok).toBe(true)
    expect(rel.assinadas_intocadas).toBeGreaterThanOrEqual(1)
    const depois = await ciencia()
    expect(depois.status).toBe('assinado')
    expect(depois.versao).toBe(antes.versao)
    expect(depois.resumo).toEqual(antes.resumo)
  })
})
