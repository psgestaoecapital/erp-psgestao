// #77 / #53 · LTCAT passo 2 — por setor → função: descrição, riscos, EPIs e treinamentos (fn_ltcat_funcao_salvar).
// Migration 20260927100000 · @pos-migration: o veredito é o aceitacao-pos-migration.yml em PRODUÇÃO.
// RD-82: as RPCs são chamadas COMO O ROBÔ (as mesmas da tela). Demonstração Indústria (SST); reset da demo no fim.

import { test, expect } from '../../support/fixtures'
import { dbSelect, rpc, registrarJornada, obterSessionPayload } from '../../support/api'

const DEMO_SST = 'b0700000-0000-4000-a000-000000000005'
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''

type Salvo = { ok: boolean; erro?: string; id?: string; riscos?: number; epis?: number; treinamentos?: number }

test.describe('LTCAT — função com riscos, EPIs e treinamentos (#77/#53)', () => {
  let token = ''
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-ltcat-funcoes-77', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.beforeAll(async () => {
    token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
  })
  test.afterAll(async () => { await rpc('fn_demo_reset', { p_company_id: DEMO_SST }) })

  async function rpcRobo<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST', headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    })
    if (!resp.ok) throw new Error(`rpc ${fn}: ${resp.status} ${await resp.text()}`)
    return (await resp.json()) as T
  }

  test('criar, editar (substitui os conjuntos) e ler no painel, como o robô @pos-migration', async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_SST}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    const [setor] = await dbSelect<{ id: string }>('prod_setor', `company_id=eq.${DEMO_SST}&nome=eq.Abate&select=id`)
    const epis = await dbSelect<{ id: string; ca_numero: string }>('epi_catalogo', `company_id=eq.${DEMO_SST}&ca_numero=in.(90001,90003)&select=id,ca_numero`)
    const trein = await dbSelect<{ id: string; nr_codigo: string }>('nr_treinamento_tipo', `company_id=eq.${DEMO_SST}&nr_codigo=in.(NR-36,NR-06)&select=id,nr_codigo`)
    const luva = epis.find((e) => e.ca_numero === '90001')!.id
    const bota = epis.find((e) => e.ca_numero === '90003')!.id
    const nr36 = trein.find((t) => t.nr_codigo === 'NR-36')!.id
    const nr06 = trein.find((t) => t.nr_codigo === 'NR-06')!.id

    const r1 = await rpcRobo<Salvo>('fn_ltcat_funcao_salvar', { p_dados: {
      company_id: DEMO_SST, setor_id: setor.id, nome: 'Operador de sangria', descricao: 'Sangria na nória, faca e chaira',
      riscos: [{ tipo: 'acidente', descricao: 'Corte por faca' }, { tipo: 'fisico', descricao: 'Umidade', grau: '20' }],
      epis: [luva, bota], treinamentos: [nr36],
    } })
    expect(r1).toMatchObject({ ok: true, riscos: 2, epis: 2, treinamentos: 1 })

    const r2 = await rpcRobo<Salvo>('fn_ltcat_funcao_salvar', { p_dados: {
      id: r1.id, nome: 'Operador de sangria', descricao: 'editado',
      riscos: [{ tipo: 'acidente', descricao: 'Corte por faca' }], epis: [luva], treinamentos: [nr36, nr06],
    } })
    expect(r2, 'editar substitui riscos/EPIs/treinamentos pelo que a tela mandou').toMatchObject({ ok: true, riscos: 1, epis: 1, treinamentos: 2 })

    const ruim = await rpcRobo<Salvo>('fn_ltcat_funcao_salvar', { p_dados: {
      company_id: DEMO_SST, setor_id: setor.id, nome: 'X', riscos: [{ tipo: 'radioativo', descricao: 'x' }] } })
    expect(ruim).toMatchObject({ ok: false, erro: 'risco_tipo_invalido' })

    const painel = await rpcRobo<{ ok: boolean; setores: { nome: string; funcoes: { id: string; numero: string; descricao: string; epis: unknown[]; treinamentos: unknown[] }[] }[] }>(
      'fn_ltcat_painel', { p_company_id: DEMO_SST })
    const f = painel.setores.find((s) => s.nome === 'Abate')!.funcoes.find((x) => x.id === r1.id)!
    expect(f).toMatchObject({ numero: 'F01', descricao: 'editado' })
    expect(f.epis).toHaveLength(1)
    expect(f.treinamentos).toHaveLength(2)

    const ex = await rpcRobo<{ ok: boolean }>('fn_ltcat_funcao_excluir', { p_id: r1.id })
    expect(ex.ok).toBe(true)
    const [posto] = await dbSelect<{ ativo: boolean }>('prod_posto', `id=eq.${r1.id}&select=ativo`)
    expect(posto.ativo, 'remover inativa, não apaga').toBe(false)
  })
})
