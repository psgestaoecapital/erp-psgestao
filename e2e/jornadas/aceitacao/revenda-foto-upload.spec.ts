// RD-78 · Aceitação da PR #1806 (chamados Fábio/Alliance #21 #22 #48 #139 · #140 #141 · #138).
// A) a foto da galeria SOBE DE VERDADE pelo botão (o teste que faltou em 3 PRs);
// B) "Salvar dados" aceita formato brasileiro e mostra erro no campo (nunca HTTP 400 mudo);
// D) lançar custo atualiza "A conta deste carro" sem recarregar.
// Sempre na Demonstração Revenda; o global-teardown (fn_demo_reset) devolve a demo ao seed.

import { test, expect, exigirEmpresaDemo, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbDelete, dbPatch, veiculoIdPorModelo, registrarJornada, DEMO_REVENDA } from '../../support/api'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const BUCKET = 'revenda-veiculos'

// 1×1 PNG válido (a Storage não valida conteúdo; o accept="image/*" aceita png).
const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
const arquivo = (nome: string) => ({ name: nome, mimeType: 'image/png', buffer: PNG_1x1 })

type Foto = { id: string; storage_path: string }
const fotosDo = (veh: string) => dbSelect<Foto>('veic_veiculo_foto', `veiculo_id=eq.${veh}&select=id,storage_path&order=created_at.desc`)

async function storageExiste(path: string): Promise<boolean> {
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } })
  return r.ok
}
async function storageRemover(paths: string[]): Promise<void> {
  if (!paths.length) return
  await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}`, {
    method: 'DELETE', headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefixes: paths }),
  })
}
// limpa a galeria do veículo da demo (registros + objetos) — estado de partida "sem foto", como o do Fábio
async function limparGaleria(veh: string): Promise<void> {
  const atuais = await fotosDo(veh)
  await dbDelete('veic_veiculo_foto', `veiculo_id=eq.${veh}`)
  await storageRemover(atuais.map((f) => f.storage_path))
}

test.describe('Aceitação #1806 — foto sobe · salvar BR · custo atualiza', () => {
  let veh = ''
  let fipeOriginal: number | null = null

  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-1806', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.beforeAll(async () => {
    veh = await veiculoIdPorModelo('Ka')                       // Ford Ka da demo (a0acad13…)
    const r = await dbSelect<{ valor_fipe: number | null }>('veic_veiculo', `id=eq.${veh}&select=valor_fipe`)
    fipeOriginal = r[0]?.valor_fipe ?? null
    await limparGaleria(veh)
  })

  test.afterAll(async () => {
    await limparGaleria(veh)
    await dbPatch('veic_veiculo', `id=eq.${veh}`, { valor_fipe: fipeOriginal })
  })

  test('A · foto real sobe pelo botão, persiste no banco e no Storage, e sobrevive ao reload (#21 #22 #48 #139)', async ({ page }) => {
    await page.goto(`/dashboard/revenda/veiculo/${veh}`)
    await aguardarConteudo(page)
    await exigirEmpresaDemo(page)
    expect(await fotosDo(veh)).toHaveLength(0)                  // ponto de partida = o do Fábio: 0 fotos

    // o input da galeria: accept="image/*" exato + multiple (o CRLV aceita pdf,image/* e não tem multiple)
    const input = page.locator('input[type="file"][accept="image/*"][multiple]')
    await expect(input).toHaveCount(1)
    await input.setInputFiles(arquivo('foto-aceitacao-1.png'))

    await expect(page.getByText(/^Foto enviada\./)).toBeVisible({ timeout: 20000 })
    await expect.poll(async () => (await fotosDo(veh)).length, { timeout: 15000 }).toBe(1)
    const [f1] = await fotosDo(veh)
    expect(f1.storage_path.startsWith(`${DEMO_REVENDA}/${veh}/`)).toBe(true)
    expect(await storageExiste(f1.storage_path)).toBe(true)     // o objeto EXISTE no bucket (não só a linha)

    // recarrega → a miniatura assinada aponta para o mesmo path
    await page.reload()
    await aguardarConteudo(page)
    await expect(page.locator(`img[src*="${f1.storage_path.split('/').pop()}"]`).first()).toBeVisible({ timeout: 20000 })

    // duas de uma vez
    await input.setInputFiles([arquivo('foto-aceitacao-2.png'), arquivo('foto-aceitacao-3.png')])
    await expect(page.getByText(/^2 fotos enviadas\./)).toBeVisible({ timeout: 20000 })
    await expect.poll(async () => (await fotosDo(veh)).length, { timeout: 15000 }).toBe(3)
  })

  test('B · Salvar dados aceita "72.956,00" e mostra erro no campo para "abc" (#140 #141)', async ({ page }) => {
    await page.goto(`/dashboard/revenda/veiculo/${veh}`)
    await aguardarConteudo(page)
    await exigirEmpresaDemo(page)

    const fipe = page.locator('#campo-valor_fipe')
    await expect(fipe).toBeVisible({ timeout: 20000 })
    await fipe.fill('72.956,00')
    await page.getByRole('button', { name: /^Salvar dados$/i }).click()
    await expect.poll(async () =>
      Number((await dbSelect<{ valor_fipe: number | null }>('veic_veiculo', `id=eq.${veh}&select=valor_fipe`))[0]?.valor_fipe),
      { timeout: 15000 }).toBe(72956)

    await fipe.fill('abc')
    await page.getByRole('button', { name: /^Salvar dados$/i }).click()
    await expect(page.getByText(/Valor inválido em "valor FIPE"/)).toBeVisible({ timeout: 15000 })
    // continua 72956 no banco (o erro não apagou nada) — e a resposta veio como ok:false, não como 400
    expect(Number((await dbSelect<{ valor_fipe: number | null }>('veic_veiculo', `id=eq.${veh}&select=valor_fipe`))[0]?.valor_fipe)).toBe(72956)
  })

  test('D · lançar custo atualiza "Gastei (custos)" sem recarregar (#138)', async ({ page }) => {
    await page.goto(`/dashboard/revenda/veiculo/${veh}`)
    await aguardarConteudo(page)
    await exigirEmpresaDemo(page)

    const antes = (await dbSelect<{ valor: number }>('veic_custo', `veiculo_id=eq.${veh}&deleted_at=is.null&select=valor`))
      .reduce((s, c) => s + Number(c.valor), 0)
    await page.getByPlaceholder('valor *').fill('10')
    await page.getByPlaceholder('descrição *').fill('E2E custo aceitação #138')
    await page.getByRole('button', { name: /\+ Custo/ }).click()
    await expect(page.getByText(/Custo lançado\./)).toBeVisible({ timeout: 15000 })

    const esperado = (antes + 10).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
    // a faixa "A conta deste carro" recarrega sozinha (refreshKey) — sem page.reload()
    await expect(page.getByText('Gastei (custos)').locator('..')).toContainText(esperado, { timeout: 15000 })
  })
})
