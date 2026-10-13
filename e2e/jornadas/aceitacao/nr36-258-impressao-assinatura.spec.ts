// #258 (Frioeste · SST) · "na visualização aparece certo, porém na impressão imprime duas vezes a primeira folha e a
// parte onde coletamos a assinatura do colaborador não imprime" (caso Dari, 01–15/09). Causa: o documento era impresso
// de dentro do modal — fundo position:fixed (repete em toda folha) e cartão com max-height 86vh + rolagem (corta o resto,
// inclusive a assinatura). Correção: portal no <body> + CSS de impressão (src/lib/ponto/impressaoDocumento.ts).
// Prova na demo Indústria (SST): um documento de 15 dias, impressão emulada (media print), sem fundo fixo, sem corte,
// com o bloco de assinatura e sem o resto da página. O documento de teste é removido no fim.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbInsert, dbDelete, registrarJornada } from '../../support/api'

const DEMO_SST = 'b0700000-0000-4000-a000-000000000005'
// competência única por execução (2000–2019), para não colidir com outra rodada
const n = Math.floor(Date.now() / 60000) % 240
const COMP = `${2000 + Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, '0')}`
let docId = ''

test.describe('Documento de pausas para assinatura — impressão (#258)', () => {
  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_SST}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    const [c] = await dbSelect<{ id: string; nome: string; cpf: string }>('ind_ponto_colaborador',
      `company_id=eq.${DEMO_SST}&nome=eq.${encodeURIComponent('Ana Paula Demo')}&select=id,nome,cpf`)
    expect(c, 'a demo tem a colaboradora Ana Paula Demo').toBeTruthy()
    // 15 dias com 4 pausas cada — igual ao documento do Dari (01 a 15/09), que passa de uma folha
    const detalhe = Array.from({ length: 15 }, (_, i) => ({
      data: `${COMP}-${String(i + 1).padStart(2, '0')}`, status: 'conforme', jornada: { inicio: '05:30', fim: '15:48' },
      pausas: ['07:10', '09:05', '11:40', '13:30'].map(de => ({ de, ate: `${de.slice(0, 3)}${String(Number(de.slice(3)) + 21).padStart(2, '0')}`, min: 21, fim_origem: null })),
    }))
    docId = (await dbInsert<{ id: string }>('nr36_ciencia_mensal', {
      company_id: DEMO_SST, colaborador_id: c.id, cpf: c.cpf, competencia: `${COMP}-01`, tipo: 'termica_253',
      periodo_inicio: `${COMP}-01`, periodo_fim: `${COMP}-15`,
      colaborador_snapshot: { nome: c.nome, cpf: c.cpf, funcao: 'Operadora de câmara fria', setor: 'Câmara fria' },
      resumo: { conforme: 15, dias_total: 15 }, detalhe, documento_hash: `e2e-258-${Date.now()}`, status: 'pendente',
    })).id
  })

  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-258-impressao-assinatura', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.afterAll(async () => {
    if (docId) await dbDelete('nr36_ciencia_mensal', `id=eq.${docId}`).catch(() => {})
  })

  test('impressão: sem fundo fixo, sem corte, com a assinatura e só o documento', async ({ page }) => {
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_SST)
    await page.goto('/dashboard/compliance/pausas-tecnicas')
    await aguardarConteudo(page)
    await page.getByRole('button', { name: 'Ciência' }).click()
    await page.locator('input[type="month"]').fill(COMP)
    await page.locator('tr').filter({ hasText: 'Ana Paula Demo' }).getByRole('button', { name: /Ver\/PDF/ }).click({ timeout: 20000 })
    const modal = page.getByTestId('ciencia-doc-modal')
    await expect(modal).toBeVisible({ timeout: 20000 })
    await expect(modal).toContainText('Relatório Mensal de Pausas Térmicas')
    await expect(page.getByTestId('ciencia-assinatura')).toContainText('Assinatura do colaborador')

    await page.emulateMedia({ media: 'print' })
    const r = await page.evaluate(() => {
      const doc = document.getElementById('ciencia-doc-print')!
      const portal = doc.closest('.ps-print-portal') as HTMLElement
      let fixo = false
      for (let el: HTMLElement | null = doc; el; el = el.parentElement) if (getComputedStyle(el).position === 'fixed') fixo = true
      const cs = getComputedStyle(doc)
      const outros = Array.from(document.body.children).filter(e => e !== portal && getComputedStyle(e).display !== 'none' && e.tagName !== 'SCRIPT' && e.tagName !== 'STYLE')
      const ass = document.querySelector('[data-testid="ciencia-assinatura"]') as HTMLElement
      return {
        noBody: portal?.parentElement === document.body, fixo, maxHeight: cs.maxHeight, overflowY: cs.overflowY,
        cortado: doc.scrollHeight > doc.clientHeight + 1, outrosVisiveis: outros.length,
        assinaturaVisivel: !!ass && getComputedStyle(ass).display !== 'none' && ass.getBoundingClientRect().height > 0,
        dias: doc.innerText.split('\n').filter(l => /^\d{2}\/\d{2}\/\d{4}/.test(l.trim())).length,
      }
    })
    expect(r.noBody, 'o documento sai por portal direto no <body>').toBe(true)
    expect(r.fixo, 'nada fixo na impressão (fixo repete a 1ª folha)').toBe(false)
    expect(r.maxHeight, 'sem altura máxima na impressão').toBe('none')
    expect(r.overflowY, 'sem rolagem na impressão').toBe('visible')
    expect(r.cortado, 'nenhum conteúdo cortado').toBe(false)
    expect(r.outrosVisiveis, 'só o documento aparece na impressão').toBe(0)
    expect(r.assinaturaVisivel, 'o bloco de assinatura aparece').toBe(true)
    expect(r.dias, 'os 15 dias estão no documento, uma vez cada').toBe(15)
  })
})
