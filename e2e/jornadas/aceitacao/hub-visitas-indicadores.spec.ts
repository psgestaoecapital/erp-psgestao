// Hub — Visitas técnicas (PDCA 24/10): indicadores, busca, próximo passo e responsável no card batem com o banco, cada
// um com o "?" (RD-95). Só leitura na empresa de demonstração da construtora: nada é gravado.
// O texto do "?" vem da migration 20261024050000 → @pos-migration.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect } from '../../support/api'

const DEMO = 'b0700000-0000-4000-a000-000000000006'

type V = { id: string; status: string; responsavel_id: string | null; responsavel_nome: string | null }

test.describe('Hub — Visitas técnicas com indicadores do banco', () => {
  test('lista, indicadores, responsável e "?" batem com o banco', { tag: '@pos-migration' }, async ({ page }) => {
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO)
    await page.goto('/dashboard/projetos/visitas')
    await aguardarConteudo(page)
    await expect(page.getByTestId('visitas-indicadores')).toBeVisible({ timeout: 30000 })

    const visitas = await dbSelect<V>('erp_crm_visita', `select=id,status,responsavel_id,responsavel_nome&company_id=eq.${DEMO}`)
    await expect(page.getByTestId('visita-card')).toHaveCount(visitas.length, { timeout: 30000 })

    // responsável: quem tem nome livre (sem login) aparece pelo nome — antes a tela só mostrava o usuário com login
    const comNome = visitas.filter((v) => !v.responsavel_id && v.responsavel_nome?.trim())
    for (const v of comNome) {
      await expect(page.getByTestId('visita-responsavel').filter({ hasText: v.responsavel_nome!.trim() }).first()).toBeVisible()
    }

    for (const chave of ['projetos.visitas.nova', 'projetos.visitas.ind_proximas', 'projetos.visitas.ind_atrasadas',
      'projetos.visitas.ind_realizadas_mes', 'projetos.visitas.ind_sem_orcamento', 'projetos.visitas.busca', 'projetos.visitas.filtro_status']) {
      await expect(page.getByTestId(`ajuda-${chave}`)).toBeVisible()
    }
    await page.getByTestId('ajuda-projetos.visitas.ind_sem_orcamento').click()
    await expect(page.getByTestId('ajuda-cartao-projetos.visitas.ind_sem_orcamento')).toContainText('dinheiro parado')
    // no celular o fundo escuro do bottom sheet cobre o "?": fecha pelo Esc (o componente escuta), não clicando de novo
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('ajuda-cartao-projetos.visitas.ind_sem_orcamento')).toHaveCount(0)

    // clicar no indicador filtra a lista pelo mesmo número
    const n = Number(await page.getByTestId('visitas-kpi-sem_orcamento').innerText())
    await page.getByTestId('visitas-kpi-sem_orcamento').click()
    await expect(page.getByTestId('visita-card')).toHaveCount(n)

    // busca sem resultado mostra o aviso do recorte, sem quebrar a tela
    await page.getByTestId('visitas-busca').fill('zzz-nenhuma-visita-zzz')
    await expect(page.getByTestId('visita-card')).toHaveCount(0)
  })
})
