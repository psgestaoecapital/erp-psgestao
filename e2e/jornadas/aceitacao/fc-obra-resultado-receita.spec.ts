// Resultado por obra — versão receita (CEO 30/09 · Diego/FC). Na ficha da obra no Hub, um cartão com o faturado (NFS-e
// autorizadas ligadas à obra) e o recebido (baixas dos títulos dessas notas); custo aparece como "a partir de novembro".
// Migration 20260930160000 (@pos-migration).
// 1) Banco, só leitura (RD-87): como o robô, fn_obras_receita confere com a conta independente (REST) para cada obra
//    que ele enxerga; anônimo é negado; empresa que não é do usuário não devolve nada. A demo não serve para esta prova:
//    o gatilho trg_bloqueia_emissao_demo não deixa existir NFS-e em empresa que não é de produção.
// 2) Tela, na Demonstração Comércio (GE), com uma obra de teste desta execução: o cartão aparece na ficha da obra com
//    Faturado/Recebido/A receber zerados, "Nenhuma NFS-e autorizada" e Custo "a partir de novembro". A obra de teste fica
//    cancelada no fim (RD-30: nada é apagado). Precisa da área Hub (/dashboard/projetos) ligada na demo GE.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbInsert, dbPatch, registrarJornada, obterSessionPayload } from '../../support/api'

const DEMO = 'b0700000-0000-4000-a000-000000000004'
const NADA = '00000000-0000-4000-a000-00000000e2e0'
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const RUN = Date.now().toString(36).toUpperCase()

type Receita = { obra_id: string; faturado: number; recebido: number; a_receber: number; notas: number; notas_sem_titulo: number }

async function receita(chave: string, ids: string[]) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/fn_obras_receita`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_company_ids: ids }),
  })
  return { status: r.status, corpo: (await r.json().catch(() => null)) as Receita[] | { code?: string } | null }
}
const cent = (v: number) => Math.round(Number(v) * 100)

let obraTeste = ''

test.describe('Resultado por obra — receita (FC)', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-fc-obra-resultado-receita', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.afterAll(async () => {
    if (obraTeste) await dbPatch('projetos_obras', `id=eq.${obraTeste}`, { status: 'cancelada', observacoes: 'e2e — obra de teste encerrada' }).catch(() => {})
  })

  test('banco: faturado = NFS-e autorizadas da obra; recebido = baixas dos títulos; anon negado; empresa alheia vazia', { tag: '@pos-migration' }, async () => {
    const token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
    const empresas = (await dbSelect<{ id: string }>('companies', 'select=id')).map((c) => c.id)
    const r = await receita(token, empresas)
    expect(r.status, 'robô executa fn_obras_receita').toBe(200)
    const linhas = r.corpo as Receita[]
    expect(Array.isArray(linhas)).toBe(true)

    for (const x of linhas.filter((l) => l.notas > 0)) {
      const notas = await dbSelect<{ valor_bruto: number | null; valor_servicos: number | null; erp_receber_id: string | null }>('erp_nfse_emitidas',
        `obra_id=eq.${x.obra_id}&status=eq.autorizada&select=valor_bruto,valor_servicos,erp_receber_id`)
      expect(x.notas, 'quantidade de notas autorizadas').toBe(notas.length)
      expect(cent(x.faturado), 'faturado = soma das autorizadas').toBe(notas.reduce((s, n) => s + cent(n.valor_bruto ?? n.valor_servicos ?? 0), 0))
      expect(x.notas_sem_titulo).toBe(notas.filter((n) => !n.erp_receber_id).length)
      let recebido = 0
      for (const id of [...new Set(notas.map((n) => n.erp_receber_id).filter(Boolean))]) {
        const [t] = await dbSelect<{ status: string; valor_pago: number | null; valor: number; deleted_at: string | null }>('erp_receber', `id=eq.${id}&select=status,valor_pago,valor,deleted_at`)
        if (!t || t.deleted_at || t.status === 'cancelado') continue
        const baixas = await dbSelect<{ valor: number }>('erp_receber_baixa', `receber_id=eq.${id}&deleted_at=is.null&select=valor`)
        recebido += baixas.length ? baixas.reduce((s, b) => s + cent(b.valor), 0) : cent(t.status === 'pago' ? (t.valor_pago ?? t.valor) : (t.valor_pago ?? 0))
      }
      expect(cent(x.recebido), 'recebido = baixas dos títulos das notas').toBe(recebido)
    }

    const anon = await receita(ANON_KEY, [DEMO])
    expect(anon.status, 'anônimo não executa').toBeGreaterThanOrEqual(400)
    expect((anon.corpo as { code?: string })?.code).toBe('42501')
    const alheia = await receita(token, [NADA])
    expect(alheia.corpo, 'empresa que não é do usuário: nada').toEqual([])
  })

  test('tela: cartão "Resultado da obra" na ficha da obra, com custo "a partir de novembro"', { tag: '@pos-migration' }, async ({ page }) => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    const o = await dbInsert<{ id: string }>('projetos_obras', {
      company_id: DEMO, numero: `E2E-${RUN}`, nome: `E2E obra receita ${RUN}`, status: 'em_andamento', valor_previsto: 1000, pct_conclusao: 0,
    })
    obraTeste = o.id

    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO)
    await page.goto('/dashboard/projetos/obras')
    await aguardarConteudo(page)
    await expect(page, 'a demo GE abre o Hub (sem redirecionar)').toHaveURL(/\/dashboard\/projetos\/obras/)
    const card = page.locator('div', { has: page.getByText(`E2E obra receita ${RUN}`, { exact: true }) }).filter({ has: page.getByTestId('obra-resultado') }).last()
    const res = card.getByTestId('obra-resultado')
    await expect(res).toBeVisible({ timeout: 30000 })
    await expect(res).toContainText('Resultado da obra')
    await expect(res.getByTestId('obra-faturado')).toHaveText(/^R\$\s?0,00$/)
    await expect(res.getByTestId('obra-recebido')).toHaveText(/^R\$\s?0,00$/)
    await expect(res.getByTestId('obra-a-receber')).toHaveText(/^R\$\s?0,00$/)
    await expect(res.getByTestId('obra-custo')).toHaveText('a partir de novembro')
    await expect(res.getByTestId('obra-notas')).toHaveText('Nenhuma NFS-e autorizada ligada a esta obra')
  })
})
