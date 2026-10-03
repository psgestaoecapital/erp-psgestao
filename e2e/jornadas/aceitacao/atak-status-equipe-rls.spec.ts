// CEO 03/10 · migration 20261003107000 (@pos-migration).
// (1) fn_atak_status lê o resumo ind_atak_status_resumo (gatilhos em ind_atak_fato/erp_sync_log): responde rápido e com
//     as mesmas chaves — antes levava ~10 s e empurrava o briefing de sessão para perto do corte de 8 s da API.
// (2) agency_equipe: o robô (logado, empresa de DEMONSTRAÇÃO P&M) lê a equipe da empresa, NÃO lê custo_hora direto,
//     recebe o custo/hora pela função fn_pm_equipe_custos (é "adm" na demo: vê salário) e o acesso fica registrado;
//     inclui e altera um membro de teste pelas mesmas chamadas da tela Equipe; o anônimo não recebe nada.
// O service_role só confere e limpa o membro de teste.

import { test, expect } from '../../support/fixtures'
import { dbSelect, dbDelete, rpc, registrarJornada, obterSessionPayload } from '../../support/api'

const DEMO_PM = 'b0700000-0000-4000-a000-000000000002'
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}-${Date.now().toString(36)}`
const NOME_TESTE = `[ACEITE RLS] ${RUN}`

type Status = {
  momento: string; veredito: string; coletor_ultimo_ciclo_min: number | null; leia_tambem: string
  abate_por_cabeca: Record<string, unknown>; carcaca_detalhada: Record<string, unknown>
  dominios: { dominio: string; status: string; linhas: number; origem: string; dado_ate?: string; ressalva?: string }[]
}

test.describe('fn_atak_status pelo resumo · agency_equipe com RLS e custo/hora protegido', () => {
  let token = ''
  let roboId = ''

  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-atak-status-equipe-rls', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_PM}&select=is_demo`)
    expect(emp?.is_demo, 'a aceitação só roda na empresa de demonstração').toBe(true)
    const s = JSON.parse(await obterSessionPayload()) as { access_token: string; user: { id: string } }
    token = s.access_token
    roboId = s.user.id
  })

  test.afterAll(async () => {
    await dbDelete('agency_equipe', `company_id=eq.${DEMO_PM}&nome=eq.${encodeURIComponent(NOME_TESTE)}`)
  })

  const comoRobo = (path: string, init: RequestInit = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
  const comoAnon = (path: string, init: RequestInit = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })

  test('fn_atak_status responde rápido, com as mesmas chaves', { tag: '@pos-migration' }, async () => {
    const t0 = Date.now()
    const st = await rpc<Status>('fn_atak_status', {})
    const ms = Date.now() - t0
    expect(Object.keys(st).sort(), 'chaves de topo de sempre').toEqual(
      ['abate_por_cabeca', 'carcaca_detalhada', 'coletor_ultimo_ciclo_min', 'dominios', 'leia_tambem', 'momento', 'veredito'])
    expect(st.dominios.length, 'um item por domínio ativo do mapa').toBeGreaterThan(0)
    for (const d of st.dominios) {
      expect(typeof d.dominio).toBe('string')
      expect(['OK', 'SUSPEITO', 'PARADO', 'VAZIO']).toContain(d.status)
      expect(Number.isInteger(d.linhas), `${d.dominio}: linhas inteiras`).toBe(true)
      expect(d.status === 'VAZIO', `${d.dominio}: VAZIO só com 0 linhas`).toBe(d.linhas === 0)
      if (d.dado_ate !== undefined) expect(d.dado_ate, `${d.dominio}: dado_ate no formato de antes`).toMatch(/^\d{4}-\d{2}-\d{2}/)
    }
    expect(st.veredito).toMatch(/^COLETOR (VIVO|PARADO|NUNCA)/)
    expect(Object.keys(st.abate_por_cabeca).sort()).toEqual(['cabecas_no_dia', 'onde', 'ultimo_dia'])
    // RPC + rede do CI; no banco a função leva ~0,06 s (antes ~10 s)
    expect(ms, `fn_atak_status respondeu em ${ms} ms`).toBeLessThan(4000)
  })

  test('robô lê a equipe da empresa, mas não o custo/hora direto', { tag: '@pos-migration' }, async () => {
    const servico = await dbSelect<{ id: string }>('agency_equipe', `company_id=eq.${DEMO_PM}&select=id`)
    expect(servico.length, 'a demo P&M tem equipe cadastrada').toBeGreaterThan(0)

    const le = await comoRobo(`agency_equipe?company_id=eq.${DEMO_PM}&select=id,nome,cargo,ativo`)
    expect(le.ok, `leitura da equipe: ${le.status}`).toBe(true)
    const linhas = (await le.json()) as { id: string }[]
    expect(linhas.map((l) => l.id).sort(), 'o robô vê a equipe inteira da empresa').toEqual(servico.map((l) => l.id).sort())

    for (const sel of ['custo_hora', 'id,custo_hora', '*']) {
      const r = await comoRobo(`agency_equipe?company_id=eq.${DEMO_PM}&select=${sel}`)
      expect(r.ok, `select=${sel} tem de ser negado (veio ${r.status})`).toBe(false)
      expect(await r.text(), 'negado por direito de coluna').toContain('42501')
    }
  })

  test('custo/hora pela função (quem vê salário), com registro do acesso', { tag: '@pos-migration' }, async () => {
    const antes = await dbSelect<{ id: number }>('pm_equipe_custo_acesso_log', `company_id=eq.${DEMO_PM}&user_id=eq.${roboId}&select=id`)
    const r = await comoRobo('rpc/fn_pm_equipe_custos', { method: 'POST', body: JSON.stringify({ p_company_id: DEMO_PM }) })
    expect(r.ok, `fn_pm_equipe_custos: ${r.status}`).toBe(true)
    const custos = (await r.json()) as { id: string; custo_hora: number | null }[]
    const servico = await dbSelect<{ id: string }>('agency_equipe', `company_id=eq.${DEMO_PM}&select=id`)
    expect(custos.map((c) => c.id).sort(), 'um custo por pessoa da equipe').toEqual(servico.map((s) => s.id).sort())
    expect(custos.every((c) => 'custo_hora' in c)).toBe(true)
    const depois = await dbSelect<{ id: number }>('pm_equipe_custo_acesso_log', `company_id=eq.${DEMO_PM}&user_id=eq.${roboId}&select=id`)
    expect(depois.length, 'o acesso ao custo por pessoa ficou registrado').toBeGreaterThanOrEqual(antes.length + 1)
  })

  test('tela Equipe: o robô (adm) inclui e altera o custo/hora de um membro', { tag: '@pos-migration' }, async () => {
    const inc = await comoRobo('agency_equipe', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ company_id: DEMO_PM, nome: NOME_TESTE, cargo: 'teste', custo_hora: 11, jornada_horas_dia: 8, ativo: false }),
    })
    expect(inc.ok, `inclusão: ${inc.status} ${inc.ok ? '' : await inc.text()}`).toBe(true)
    const [m] = await dbSelect<{ id: string; custo_hora: number }>('agency_equipe', `company_id=eq.${DEMO_PM}&nome=eq.${encodeURIComponent(NOME_TESTE)}&select=id,custo_hora`)
    expect(Number(m?.custo_hora)).toBe(11)
    const alt = await comoRobo(`agency_equipe?id=eq.${m.id}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ company_id: DEMO_PM, nome: NOME_TESTE, cargo: 'teste', custo_hora: 12, jornada_horas_dia: 8, ativo: false }),
    })
    expect(alt.ok, `alteração: ${alt.status} ${alt.ok ? '' : await alt.text()}`).toBe(true)
    const [m2] = await dbSelect<{ custo_hora: number }>('agency_equipe', `id=eq.${m.id}&select=custo_hora`)
    expect(Number(m2?.custo_hora), 'custo/hora alterado').toBe(12)
  })

  test('anônimo não lê a equipe nem o custo', { tag: '@pos-migration' }, async () => {
    const le = await comoAnon(`agency_equipe?company_id=eq.${DEMO_PM}&select=id,nome`)
    const corpo = le.ok ? ((await le.json()) as unknown[]) : []
    expect(corpo.length, `anônimo recebeu ${corpo.length} linha(s) (status ${le.status})`).toBe(0)
    expect(le.ok, 'anon sem direito na tabela').toBe(false)
    const fn = await comoAnon('rpc/fn_pm_equipe_custos', { method: 'POST', body: JSON.stringify({ p_company_id: DEMO_PM }) })
    expect(fn.ok, `fn_pm_equipe_custos para anônimo: ${fn.status}`).toBe(false)
  })
})
