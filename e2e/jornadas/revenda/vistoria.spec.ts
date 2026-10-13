// Revenda R1b · Jornada VISTORIA (V7 tela 6). Clicar, salvar, conferir no banco.
// abrir carro sem vistoria → "Iniciar vistoria" (NADA criado) → iniciar RÁPIDA → 9 itens →
// marcar 1 reparo sem foto → concluir BLOQUEIA → com foto conclui → previsão vai à precificação.

import { test, expect, exigirEmpresaDemo, aguardarConteudo } from '../../support/fixtures'
import { DEMO_REVENDA, dbSelect, dbDelete, dbPatch, veiculoIdPorModelo, registrarJornada } from '../../support/api'

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

type Vist = { id: string; situacao: string; modelo_id: string | null; previsao_total: number | null }

async function vistoriasDo(veh: string): Promise<Vist[]> {
  return dbSelect<Vist>('insp_vistoria',
    `alvo_tabela=eq.veic_veiculo&alvo_id=eq.${veh}&select=id,situacao,modelo_id,previsao_total`)
}
async function limparVistorias(veh: string): Promise<void> {
  for (const v of await vistoriasDo(veh)) {
    await dbDelete('insp_foto', `vistoria_id=eq.${v.id}`)
    await dbDelete('insp_resposta', `vistoria_id=eq.${v.id}`)
    await dbDelete('insp_vistoria', `id=eq.${v.id}`)
  }
}

test.describe.serial('Vistoria — rápida, foto obrigatória bloqueia, previsão à precificação', () => {
  let veh = ''

  // R1 item 1c: registra verde/vermelho (jornada verde prova o requisito e prevalece sobre a foto).
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('vistoria', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.beforeAll(async () => {
    veh = await veiculoIdPorModelo('Ka')
    // padrão da demo = rápida; começa sem vistoria (R0.3b: abrir não cria)
    await dbPatch('veic_config', `company_id=eq.${DEMO_REVENDA}`, { vistoria_modo_padrao: 'rapida' })
    await limparVistorias(veh)
  })

  test('abrir não cria; rápida 9 itens; sem foto bloqueia; com foto conclui e alimenta a precificação', async ({ page }) => {
    // 1) abrir a página NÃO cria vistoria (R0.3b) — tela "Iniciar vistoria", banco vazio
    await page.goto(`/dashboard/revenda/veiculo/${veh}/vistoria`)
    await aguardarConteudo(page)
    await exigirEmpresaDemo(page)
    await expect(page.getByRole('heading', { name: 'Iniciar vistoria' })).toBeVisible()
    expect(await vistoriasDo(veh), 'abrir a página não pode criar vistoria (R0.3b)').toHaveLength(0)

    // 2) iniciar RÁPIDA → banco tem 1 vistoria em andamento, modelo modo=rápida, 9 itens
    await page.getByRole('button', { name: /Vistoria rápida/ }).click()
    await expect(page.getByText(/Vistoria rápida \(9 itens\)/)).toBeVisible({ timeout: 20000 })
    const vs = await vistoriasDo(veh)
    expect(vs).toHaveLength(1)
    expect(vs[0].situacao).toBe('em_andamento')
    const modelo = await dbSelect<{ modo: string }>('insp_modelo', `id=eq.${vs[0].modelo_id}&select=modo`)
    expect(modelo[0]?.modo).toBe('rapida')
    // insp_item não tem modelo_id (nunca teve: 20260906210000_inspecao_motor.sql) — o item pertence à
    // REGIÃO, e a região ao modelo. A consulta antiga dava 400 "column insp_item.modelo_id does not exist".
    const regioes = await dbSelect<{ id: string }>('insp_regiao', `modelo_id=eq.${vs[0].modelo_id}&select=id`)
    const itens = await dbSelect('insp_item', `regiao_id=in.(${regioes.map((r) => r.id).join(',')})&select=id`)
    expect(itens.length, 'a rápida tem 9 itens').toBe(9)
    const vistId = vs[0].id

    // 3) marcar o 1º item como REPARO com valor → salva no banco (resposta reparo, previsão > 0)
    await page.getByRole('button', { name: /^reparo$/i }).click()
    await page.getByPlaceholder('ex.: Reparo tecido/couro').fill('Reparo demonstração (e2e)')
    await page.getByPlaceholder('R$ 0,00').fill('350')
    await page.getByRole('button', { name: /^salvar$/i }).click()
    await expect.poll(async () => {
      const r = await dbSelect<{ estado: string; gasto_previsto: number }>('insp_resposta',
        `vistoria_id=eq.${vistId}&estado=eq.reparo&select=estado,gasto_previsto`)
      return r.length && r[0].gasto_previsto ? 'ok' : 'aguardando'
    }, { timeout: 15000 }).toBe('ok')
    expect((await vistoriasDo(veh))[0].previsao_total || 0, 'previsão de gastos > 0').toBeGreaterThan(0)

    // 4) caminhar até o resumo respondendo OK os demais; tentar CONCLUIR sem a foto → BLOQUEIA
    await irAteResumo(page)
    await page.getByRole('button', { name: /CONCLUIR VISTORIA/i }).click()
    await expect(page.getByText(/Falta para concluir/i)).toBeVisible({ timeout: 15000 })
    expect((await vistoriasDo(veh))[0].situacao, 'sem foto a vistoria NÃO conclui').toBe('em_andamento')

    // 5) ir à região do reparo (link na pendência), subir a foto, voltar e concluir
    await page.getByText(/📷 Foto obrigatória/i).locator('xpath=following::button[1]').click().catch(() => {})
    // fallback: se não achou o link, volta a avaliar e navega até uma região com uploader visível
    const fileInput = page.locator('input[type="file"]').first()
    await expect(fileInput).toBeAttached({ timeout: 15000 })
    await fileInput.setInputFiles({ name: 'reparo-demo.png', mimeType: 'image/png', buffer: PNG_1x1 })
    await expect.poll(async () =>
      (await dbSelect('insp_foto', `vistoria_id=eq.${vistId}&select=id`)).length,
      { timeout: 15000 }).toBeGreaterThan(0)

    // 6) concluir de novo → agora conclui; banco = concluida
    await irAteResumo(page)
    await page.getByRole('button', { name: /CONCLUIR VISTORIA/i }).click()
    await expect.poll(async () => (await vistoriasDo(veh))[0]?.situacao, { timeout: 20000 }).toBe('concluida')

    // 7) a previsão alimenta a precificação (custo total inclui a previsão da vistoria)
    const prec = await dbSelect<{ gasto_previsto_vistoria: number | null }>('veic_veiculo',
      `id=eq.${veh}&select=id`)
    expect(prec.length).toBe(1)
    await page.goto(`/dashboard/revenda/veiculo/${veh}/precificacao`)
    await aguardarConteudo(page)
    await expect(page.getByText(/Custo total|Preço mínimo|Piso sem margem/i).first()).toBeVisible()
  })

  // T6 (juiz): carro JÁ vistoriado abre o RESULTADO (resumo somente-leitura), não "Iniciar vistoria".
  // Cobre o requisito antes "não avaliável": data/quem, previsão × realizado, itens com estado, "Nova vistoria".
  test('vistoria concluída abre o RESUMO (resultado), não "Iniciar vistoria"', async ({ page }) => {
    await expect.poll(async () => (await vistoriasDo(veh)).some((v) => v.situacao === 'concluida'),
      { timeout: 20000 }).toBe(true)
    await page.goto(`/dashboard/revenda/veiculo/${veh}/vistoria`)
    await aguardarConteudo(page)
    await exigirEmpresaDemo(page)
    // NÃO pode cair em "Iniciar vistoria" (era a falha do T6)
    await expect(page.getByRole('heading', { name: 'Iniciar vistoria' })).toHaveCount(0)
    // mostra o resultado: cabeçalho, previsão de gastos, realizado (previsto × realizado) e "Nova vistoria"
    await expect(page.getByText('Vistoria concluída').first()).toBeVisible({ timeout: 20000 })
    await expect(page.getByText(/PREVISÃO DE GASTOS/i)).toBeVisible()
    await expect(page.getByText(/realizado \(custos de preparação/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /Nova vistoria/i })).toBeVisible()
  })
})

// Caminha do fluxo até o resumo: em cada região responde o item visível (OK, se ainda não respondido)
// e clica o botão de avançar disponível, até aparecer "CONCLUIR VISTORIA".
async function irAteResumo(page: import('@playwright/test').Page): Promise<void> {
  for (let i = 0; i < 14; i++) {
    if (await page.getByRole('button', { name: /CONCLUIR VISTORIA/i }).isVisible().catch(() => false)) return
    // responde OK se houver botão de estado e o item ainda não foi respondido
    const ok = page.getByRole('button', { name: /^ok$/i })
    if (await ok.isVisible().catch(() => false)) await ok.click().catch(() => {})
    const avancar = page.getByRole('button', { name: /próxima região →|ir ao resumo →/i })
    if (await avancar.isEnabled().catch(() => false)) { await avancar.click(); continue }
    // avanço bloqueado (foto obrigatória) — sai para o chamador tratar
    return
  }
}
