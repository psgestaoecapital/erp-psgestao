// #130 (Gean · Jordana) · "Ao editar o Contribuinte de ICMS do cliente, o sistema disse 'Já existe um cliente com este
// CNPJ… quer abrir o existente em vez de criar um duplicado?' e não deixou salvar." Dois ângulos: (1) um duplicado
// INATIVADO não pode bloquear (#1787 já ignorava inativos); (2) editar o próprio cadastro sem mudar o CNPJ não é criar
// um duplicado — com outro cadastro ATIVO do mesmo CNPJ (a Gean tem 43 CNPJs assim), o alerta aparecia e "abrir o
// existente" fechava o formulário sem salvar. Agora a edição só confere duplicidade se o documento mudou.
// Demonstração Comércio (GE), nunca empresa real. Cadastros de teste desativados no fim.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbInsert, dbPatch, registrarJornada } from '../../support/api'

const DEMO_COMERCIO = 'b0700000-0000-4000-a000-000000000004'
const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}-${Date.now().toString(36)}`
// CNPJ fictício único por execução (14 dígitos)
const cnpjDe = (sufixo: string) => (`9${Date.now()}${sufixo}`).replace(/\D/g, '').slice(0, 14).padEnd(14, '0')

type Cli = { id: string; contribuinte_icms: string | null }
const criados: string[] = []

async function cliente(nome: string, cnpj: string, ativo: boolean) {
  const c = await dbInsert<{ id: string }>('erp_clientes', {
    company_id: DEMO_COMERCIO, nome_fantasia: nome, razao_social: nome, cnpj_cpf: cnpj, tipo_pessoa: 'PJ', ativo,
  })
  criados.push(c.id)
  return c.id
}

test.describe('Cadastro de clientes — editar sem mudar o CNPJ não pergunta "criar duplicado?" (#130)', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-130-cnpj-duplicado-editar', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_COMERCIO}&select=is_demo`)
    expect(emp?.is_demo, 'a aceitação só roda na empresa de demonstração').toBe(true)
  })

  test.afterAll(async () => {
    for (const id of criados) await dbPatch('erp_clientes', `id=eq.${id}`, { ativo: false })
  })

  for (const caso of [
    { titulo: 'com o duplicado INATIVO (caso do chamado)', outroAtivo: false, sufixo: '1' },
    { titulo: 'com outro cadastro ATIVO do mesmo CNPJ', outroAtivo: true, sufixo: '2' },
  ]) {
    test(`editar o Contribuinte de ICMS salva direto ${caso.titulo}`, async ({ page }) => {
      const cnpj = cnpjDe(caso.sufixo)
      const nome = `Cliente 130 ${caso.sufixo} ${RUN}`
      const alvo = await cliente(nome, cnpj, true)
      await cliente(`Cliente 130 dup ${caso.sufixo} ${RUN}`, cnpj, caso.outroAtivo)

      const dialogos: string[] = []
      page.on('dialog', (d) => { dialogos.push(d.message()); void d.dismiss() })
      await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_COMERCIO)
      await page.goto('/dashboard/cadastros/clientes')
      await aguardarConteudo(page)

      await page.getByPlaceholder('Buscar por nome ou CNPJ/CPF…').fill(nome)
      await expect(page.getByText(nome, { exact: true })).toBeVisible({ timeout: 20000 })
      await page.getByRole('button', { name: 'Editar', exact: true }).first().click()

      await page.locator('select').filter({ has: page.locator('option[value="nao_contribuinte"]') }).first().selectOption('nao_contribuinte')
      await page.getByRole('button', { name: 'Salvar', exact: true }).click()

      await expect.poll(async () => (await dbSelect<Cli>('erp_clientes', `id=eq.${alvo}&select=id,contribuinte_icms`))[0]?.contribuinte_icms,
        { timeout: 15000, message: 'a alteração do Contribuinte de ICMS foi salva' }).toBe('nao_contribuinte')
      expect(dialogos.filter((m) => /Já existe um cliente com este CNPJ/.test(m)), 'nenhum alerta de "criar duplicado" ao editar').toEqual([])
    })
  }
})
