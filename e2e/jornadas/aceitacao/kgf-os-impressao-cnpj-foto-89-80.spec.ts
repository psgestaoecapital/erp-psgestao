// #89 / #80 (Gean) · impressão da OS.
// #89: "Cliente foi cadastrado e atualizado a OS. Nome puxa certo, CNPJ não aparece." A impressão lia só a cópia
//      do documento gravada na OS/pedido; OS aberta com nome provisório e cliente vinculado depois saía sem CNPJ
//      (13 OS reais). Agora puxa o CPF/CNPJ do CADASTRO atual do cliente. Migration 20260927150000 · @pos-migration.
// #80: "Foto fica cortada, não aparece por inteira." A foto no histórico fotográfico tinha altura fixa + recorte
//      (object-fit: cover). Agora sai inteira (contain, altura automática). Só CSS: roda no preview.
// Demonstração "Mecânica Modelo" (OS com cliente vinculado e sem CNPJ copiado na OS).

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, registrarJornada } from '../../support/api'

const DEMO_MECANICA = 'ded00000-0000-4000-a000-000000000001'

test.describe('Impressão da OS — CNPJ do cadastro (#89) e foto inteira (#80)', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-os-impressao-89-80', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('CPF/CNPJ sai do cadastro do cliente mesmo sem estar copiado na OS @pos-migration', async ({ page }) => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_MECANICA}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    const [os] = await dbSelect<{ id: string; cliente_id: string; cliente_cnpj: string | null }>('erp_os',
      `company_id=eq.${DEMO_MECANICA}&cliente_id=not.is.null&cliente_cnpj=is.null&select=id,cliente_id,cliente_cnpj&order=numero&limit=1`)
    expect(os, 'a demo tem OS com cliente vinculado e sem CNPJ copiado').toBeTruthy()
    const [cli] = await dbSelect<{ cpf_cnpj: string | null; cnpj_cpf: string | null }>('erp_clientes', `id=eq.${os.cliente_id}&select=cpf_cnpj,cnpj_cpf`)
    const doc = String(cli.cpf_cnpj ?? cli.cnpj_cpf ?? '').replace(/\D/g, '')
    expect(doc.length, 'o cadastro tem o documento').toBeGreaterThanOrEqual(11)

    await page.goto(`/dashboard/commerce/otc/imprimir/${os.id}`)
    await aguardarConteudo(page)
    await expect.poll(async () => ((await page.getByTestId('os-print-cliente-doc').first().textContent().catch(() => '')) ?? '').replace(/\D/g, ''),
      { timeout: 20000 }).toBe(doc)
  })

  test('foto do histórico fotográfico sai inteira, sem recorte', async ({ page }) => {
    const [os] = await dbSelect<{ id: string }>('erp_os', `company_id=eq.${DEMO_MECANICA}&select=id&order=numero&limit=1`)
    await page.goto(`/dashboard/commerce/otc/imprimir/${os.id}`)
    await aguardarConteudo(page)
    // A demo não tem foto de OS: mede a regra de impressão aplicada a uma foto no mesmo quadro da página.
    const estilo = await page.evaluate(() => {
      const box = document.createElement('div'); box.className = 'pp-fotos'
      const cel = document.createElement('div'); cel.className = 'pp-foto'
      const img = document.createElement('img'); img.width = 300; img.height = 400
      cel.appendChild(img); box.appendChild(cel); document.body.appendChild(box)
      const cs = getComputedStyle(img)
      const r = { objectFit: cs.objectFit, height: cs.height }
      box.remove()
      return r
    })
    expect(estilo.objectFit, 'foto inteira (contain), não recortada (cover)').toBe('contain')
    expect(estilo.height, 'sem a altura fixa de 120px que cortava').not.toBe('120px')
  })
})
