// Pauta P&M · P2 (SPEC "P&M · Pauta", seções 5 e 6). Migration 20261002170000 · @pos-migration.
// Na "Agência (P&M) - DEMO" (RD-69), como o robô:
//   1) contador de cada aba bate com a lista filtrada (mesma função de filtro);
//   2) edição em massa pode ser desfeita (24 h) e volta exatamente como estava;
//   3) excluir manda para a lixeira (exclusão lógica) e restaurar traz de volta;
//   4) o filtro salvo volta igual ao reabrir a pauta (preferência por pessoa);
//   5) empresa alheia → 42501;
//   6) na tela: abas com contador, lista agrupada, "?" de ajuda nos campos do filtro.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, registrarJornada, obterSessionPayload } from '../../support/api'

const DEMO_PM = 'b0700000-0000-4000-a000-000000000002'
const OUTRA = '00000000-0000-4000-a000-0000000a0e01'
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''

type Lista = { total: number; pode_ver_margem: boolean; itens: { id: string; numero: string; status: string; margem: number | null }[] }

test.describe('Pauta P2 — lista, abas, ações em massa com desfazer, lixeira, filtro salvo', () => {
  let token = ''
  const rpc = async <T,>(fn: string, args: Record<string, unknown>) => {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST',
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args) })
    return { http: r.status, corpo: (await r.json().catch(() => null)) as T }
  }
  test.beforeAll(async () => { token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token })
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-pauta-p2', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('contadores das abas batem com a lista; empresa alheia é recusada', { tag: '@pos-migration' }, async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_PM}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    const ct = (await rpc<{ total: number; por_situacao: Record<string, number> }>('fn_pauta_contadores', { p_company_id: DEMO_PM, p_filtros: {} })).corpo
    const tudo = (await rpc<Lista>('fn_pauta_listar', { p_company_id: DEMO_PM, p_filtros: {}, p_por_pagina: 500 })).corpo
    expect(tudo.total, 'total da lista = total dos contadores').toBe(ct.total)
    expect(tudo.itens.length).toBe(Math.min(ct.total, 500))
    for (const [sit, n] of Object.entries(ct.por_situacao)) {
      const aba = (await rpc<Lista>('fn_pauta_listar', { p_company_id: DEMO_PM, p_filtros: {}, p_situacao: sit, p_por_pagina: 1 })).corpo
      expect(aba.total, `aba ${sit}: contador = lista`).toBe(n)
    }
    const atr = (await rpc<{ total: number }>('fn_pauta_contadores', { p_company_id: DEMO_PM, p_filtros: { atalho: 'atrasados' } })).corpo
    const atrL = (await rpc<Lista>('fn_pauta_listar', { p_company_id: DEMO_PM, p_filtros: { atalho: 'atrasados' }, p_por_pagina: 1 })).corpo
    expect(atrL.total, 'atalho "Atrasados": contador = lista').toBe(atr.total)
    if (!tudo.pode_ver_margem) expect(tudo.itens.every((i) => i.margem === null), 'sem permissão, margem não vem').toBe(true)
    const alheia = await rpc<{ code?: string }>('fn_pauta_listar', { p_company_id: OUTRA, p_filtros: {} })
    expect(alheia.corpo?.code, 'empresa alheia → 42501').toBe('42501')
  })

  test('edição em massa desfeita volta igual; lixeira restaura', { tag: '@pos-migration' }, async () => {
    const jobs = await dbSelect<{ id: string; prioridade: string | null; data_prazo: string | null }>('agency_jobs',
      `company_id=eq.${DEMO_PM}&excluido_em=is.null&select=id,prioridade,data_prazo&order=numero&limit=2`)
    expect(jobs.length, 'a demo tem jobs').toBe(2)
    const ids = jobs.map((j) => j.id)
    const ed = (await rpc<{ ok: boolean; lote_id: string; alterados: number }>('fn_pauta_editar_em_massa',
      { p_company_id: DEMO_PM, p_ids: ids, p_campos: { prioridade: 'critica', data_prazo: '2030-01-15' } })).corpo
    expect(ed.ok).toBe(true)
    expect(ed.alterados).toBe(2)
    const depois = await dbSelect<{ prioridade: string; data_prazo: string }>('agency_jobs', `id=in.(${ids.join(',')})&select=prioridade,data_prazo`)
    expect(depois.every((d) => d.prioridade === 'critica' && String(d.data_prazo).startsWith('2030-01-15'))).toBe(true)
    const des = (await rpc<{ ok: boolean; restaurados: number }>('fn_pauta_desfazer', { p_lote_id: ed.lote_id })).corpo
    expect(des.ok, 'desfazer funciona').toBe(true)
    const volta = await dbSelect<{ id: string; prioridade: string | null; data_prazo: string | null }>('agency_jobs', `id=in.(${ids.join(',')})&select=id,prioridade,data_prazo`)
    for (const j of jobs) {
      const v = volta.find((x) => x.id === j.id)!
      expect(v.prioridade, 'prioridade voltou').toBe(j.prioridade)
      expect(v.data_prazo, 'prazo voltou').toBe(j.data_prazo)
    }
    expect((await rpc<{ ok: boolean; erro: string }>('fn_pauta_desfazer', { p_lote_id: ed.lote_id })).corpo.erro, 'não desfaz duas vezes').toBe('ja_desfeito')

    const ex = (await rpc<{ ok: boolean; lote_id: string }>('fn_pauta_excluir', { p_company_id: DEMO_PM, p_ids: [ids[0]] })).corpo
    expect(ex.ok).toBe(true)
    const lix = (await rpc<Lista>('fn_pauta_listar', { p_company_id: DEMO_PM, p_filtros: { lixeira: true }, p_por_pagina: 500 })).corpo
    expect(lix.itens.some((i) => i.id === ids[0]), 'excluído aparece na lixeira').toBe(true)
    const ativos = (await rpc<Lista>('fn_pauta_listar', { p_company_id: DEMO_PM, p_filtros: {}, p_por_pagina: 500 })).corpo
    expect(ativos.itens.some((i) => i.id === ids[0]), 'e some da pauta').toBe(false)
    expect((await rpc<{ ok: boolean }>('fn_pauta_excluir', { p_company_id: DEMO_PM, p_ids: [ids[0]], p_restaurar: true })).corpo.ok, 'restaurar').toBe(true)
    const [rest] = await dbSelect<{ excluido_em: string | null }>('agency_jobs', `id=eq.${ids[0]}&select=excluido_em`)
    expect(rest.excluido_em, 'voltou para a pauta (nada foi apagado)').toBeNull()
  })

  test('filtro salvo volta igual ao reabrir; tela com abas, lista e "?"', { tag: '@pos-migration' }, async ({ page }) => {
    const me = JSON.parse(atob(token.split('.')[1])) as { sub: string }
    const filtro = { titulo: 'a', atalho: 'atrasados' }
    const r = await fetch(`${SUPABASE_URL}/rest/v1/agency_pauta_preferencia?on_conflict=company_id,user_id`, { method: 'POST',
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ company_id: DEMO_PM, user_id: me.sub, filtros: filtro, agrupar: 'cliente', aba: 'todas' }) })
    expect(r.ok, 'grava a preferência').toBe(true)
    // reabrir: a tela lê a preferência e aplica (atalho marcado e agrupamento por cliente)
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_PM)
    await page.goto('/dashboard/pm/pauta')
    await aguardarConteudo(page)
    await expect(page.getByTestId('pauta-page')).toBeVisible({ timeout: 20000 })
    await expect(page.getByTestId('pauta-agrupar')).toHaveValue('cliente', { timeout: 15000 })
    await expect(page.getByTestId('pauta-atalho-atrasados')).toHaveClass(/font-medium/)
    // limpa a preferência pela tela: tira o atalho e volta ao agrupamento por prazo
    await page.getByTestId('pauta-atalho-atrasados').click()
    await page.getByTestId('pauta-agrupar').selectOption('prazo')
    // contador da aba "Todas" = total do banco (espera a recarga depois de tirar o atalho; antes dela o número
    // ainda é o do filtro anterior)
    const ct = (await rpc<{ total: number }>('fn_pauta_contadores', { p_company_id: DEMO_PM, p_filtros: { titulo: 'a' } })).corpo
    await expect.poll(async () => Number(await page.getByTestId('pauta-aba-n-todas').innerText()),
      { timeout: 15000, message: 'aba "Todas" mostra o mesmo número do banco' }).toBe(ct.total)
    // "?" de ajuda nos campos do filtro
    await page.getByTestId('pauta-abrir-filtro').click()
    await expect(page.getByTestId('pauta-painel')).toBeVisible()
    await expect(page.getByTestId('ajuda-pm.pauta.filtro.cliente')).toBeVisible()
    await page.getByTestId('pauta-mais-filtros').click()
    await expect(page.getByTestId('ajuda-pm.pauta.filtro.codigo')).toBeVisible()
    await page.getByTestId('ajuda-pm.pauta.filtro.codigo').click()
    await expect(page.getByTestId('ajuda-cartao-pm.pauta.filtro.codigo')).toContainText('rodada', { timeout: 15000 })
  })
})
