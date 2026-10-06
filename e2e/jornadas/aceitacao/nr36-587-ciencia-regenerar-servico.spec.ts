// #587 · porta de serviço das ciências NR-36 (Eng. Chefe 06/10, mensagem bcebc26f).
// fn_nr36_ciencia_regenerar_servico: só service_role; regenera SÓ a ciência PENDENTE afetada (nova versão com motivo,
// anterior no histórico); assinada e recusada ficam intocadas; fechada a usuário logado. Só na demo SST, competências
// 03 e 04/2023 deste spec, colaboradora Ana Paula Demo (SEM CPF no código); tudo removido no fim.

import { test, expect } from '../../support/fixtures'
import { dbSelect, dbInsert, dbDelete, rpc, obterSessionPayload, registrarJornada } from '../../support/api'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const DEMO_SST = 'b0700000-0000-4000-a000-000000000005'
const MOTIVO = 'Reapuração NR-36: almoço e pausas faltantes (teste)'
const MARCO = '2023-03-01'
const ABRIL = '2023-04-01'

let cpf = ''
let colaboradorId = ''

type Ciencia = { id: string; status: string; versao: number; versao_motivo: string | null; documento_hash: string }
const ciencia = async (comp: string) =>
  (await dbSelect<Ciencia>('nr36_ciencia_mensal', `company_id=eq.${DEMO_SST}&cpf=eq.${cpf}&competencia=eq.${comp}&tipo=eq.termica_253&select=id,status,versao,versao_motivo,documento_hash`))[0]

async function limpar() {
  const ids = (await dbSelect<{ id: string }>('nr36_ciencia_mensal', `company_id=eq.${DEMO_SST}&cpf=eq.${cpf}&competencia=in.(${MARCO},${ABRIL})&select=id`)).map(x => x.id)
  if (ids.length > 0) {
    await dbDelete('nr36_ciencia_mensal_historico', `ciencia_id=in.(${ids.join(',')})`).catch(() => {})
    await dbDelete('nr36_ciencia_mensal', `id=in.(${ids.join(',')})`).catch(() => {})
  }
  await dbDelete('nr36_pausa_apurada', `company_id=eq.${DEMO_SST}&cpf=eq.${cpf}&data=in.(2023-03-15,2023-04-15)`).catch(() => {})
}

async function semear(comp: string, dia: string, status: 'pendente' | 'assinado' | 'recusado') {
  await dbInsert('nr36_pausa_apurada', { company_id: DEMO_SST, cpf, data: dia, tipo: 'termica_253', status: 'pendente_confirmacao', detalhe: { pausas: [] } })
  await dbInsert('nr36_ciencia_mensal', {
    company_id: DEMO_SST, colaborador_id: colaboradorId, cpf, competencia: comp, tipo: 'termica_253', periodo_inicio: comp, periodo_fim: dia,
    colaborador_snapshot: { nome: 'Ana Paula Demo' }, resumo: { conforme: 1, dias_total: 1 }, detalhe: [], documento_hash: 'hash-antigo-e2e', status,
  })
}

test.describe('NR-36: regenerar ciências por serviço (#587)', () => {
  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_SST}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    const [c] = await dbSelect<{ id: string; cpf: string }>('ind_ponto_colaborador', `company_id=eq.${DEMO_SST}&nome=eq.${encodeURIComponent('Ana Paula Demo')}&select=id,cpf`)
    expect(c, 'a demo tem a colaboradora Ana Paula Demo').toBeTruthy()
    cpf = c.cpf; colaboradorId = c.id
    await limpar()
  })
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-587-ciencia-regenerar', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.afterAll(async () => { if (cpf) await limpar() })

  test('pendente ganha nova versão com motivo; assinada fica intocada; segunda chamada não muda nada', { tag: '@pos-migration' }, async () => {
    await limpar()
    await semear(MARCO, '2023-03-15', 'pendente')
    await semear(ABRIL, '2023-04-15', 'assinado')
    const assinadaAntes = await ciencia(ABRIL)
    const r = await rpc<{ ok: boolean; regeneradas: number; assinadas_intocadas: number }>('fn_nr36_ciencia_regenerar_servico',
      { p_company: DEMO_SST, p_inicio: MARCO, p_fim: '2023-03-31', p_motivo: MOTIVO })
    expect(r.ok).toBe(true)
    expect(r.regeneradas).toBe(1)
    const pend = await ciencia(MARCO)
    expect(pend.status).toBe('pendente')
    expect(pend.versao).toBe(2)
    expect(pend.versao_motivo).toBe(MOTIVO)
    expect(pend.documento_hash).not.toBe('hash-antigo-e2e')
    const hist = await dbSelect<{ versao: number }>('nr36_ciencia_mensal_historico', `ciencia_id=eq.${pend.id}&select=versao`)
    expect(hist.map(h => h.versao), 'a versão anterior fica no histórico').toContain(1)
    const r2 = await rpc<{ regeneradas: number }>('fn_nr36_ciencia_regenerar_servico', { p_company: DEMO_SST, p_inicio: MARCO, p_fim: '2023-03-31', p_motivo: MOTIVO })
    expect(r2.regeneradas, 'idempotente').toBe(0)
    // a assinada, mesmo dentro do período, não é tocada
    const r3 = await rpc<{ assinadas_intocadas: number; regeneradas: number }>('fn_nr36_ciencia_regenerar_servico', { p_company: DEMO_SST, p_inicio: ABRIL, p_fim: '2023-04-30', p_motivo: MOTIVO })
    expect(r3.regeneradas).toBe(0)
    expect(r3.assinadas_intocadas).toBe(1)
    expect(await ciencia(ABRIL)).toEqual(assinadaAntes)
  })

  test('fechada a usuário logado, exige motivo e respeita o máximo de 31 dias', { tag: '@pos-migration' }, async () => {
    const token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
    for (const [fn, args] of [
      ['fn_nr36_ciencia_regenerar_servico', { p_company: DEMO_SST, p_inicio: MARCO, p_fim: MARCO, p_motivo: MOTIVO }],
      ['fn_nr36_ciencia_gerar_nucleo', { p_company_id: DEMO_SST, p_competencia: MARCO, p_cpf: null, p_gerado_por: null }],
    ] as const) {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args) })
      expect(r.status, `${fn} não é chamável por usuário logado`).toBeGreaterThanOrEqual(401)
    }
    const svc = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
    const chamar = (args: Record<string, unknown>) => fetch(`${SUPABASE_URL}/rest/v1/rpc/fn_nr36_ciencia_regenerar_servico`, {
      method: 'POST', headers: { apikey: svc, Authorization: `Bearer ${svc}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args) })
    const longo = await chamar({ p_company: DEMO_SST, p_inicio: '2023-01-01', p_fim: '2023-03-01', p_motivo: MOTIVO })
    expect(longo.status).toBeGreaterThanOrEqual(400)
    expect(await longo.text()).toContain('periodo_maximo_31_dias')
    const semMotivo = await chamar({ p_company: DEMO_SST, p_inicio: MARCO, p_fim: MARCO, p_motivo: 'curto' })
    expect(semMotivo.status).toBeGreaterThanOrEqual(400)
    expect(await semMotivo.text()).toContain('sem_motivo')
  })
})
