// Roteiro de teste da Pdois (CEO 01/10, "a Pdois testa amanhã"): o MESMO caminho que a Pdois vai fazer, pela tela, na
// Agência (P&M) - DEMO, como o robô. Cobre o que não tinha teste de tela: botão do WhatsApp, "Meus leads",
// "Minhas tarefas" aberta pelo botão, agenda "Minha agenda × Equipe" (#119) e o lead criado pela tela com origem nova
// (#552). Sem migration: roda no preview (veredito da PR) contra o banco de produção, só na demo.
// Limpeza sem apagar (RD-30): lead de teste vai para a lixeira (deleted_at); tarefa fica "feita" (é o próprio roteiro).

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbPatch, dbSelect, obterSessionPayload, registrarJornada } from '../../support/api'

const DEMO_AG = 'b0700000-0000-4000-a000-000000000002'
const RUN = Date.now().toString(36).toUpperCase()
const EMPRESA = `E2E Roteiro ${RUN}`
const TAREFA = `E2E mandar proposta ${RUN}`
const hojeSP = () => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10)
let robo = ''
let leadId = ''

test.describe.configure({ mode: 'serial' })

test.describe('Roteiro da Pdois: lead com WhatsApp → tarefa → Minhas tarefas → agenda → job', () => {
  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_AG}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    robo = (JSON.parse(await obterSessionPayload()) as { user: { id: string } }).user.id
  })
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_AG)
  })
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-pdois-roteiro-teste', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.afterAll(async () => {
    if (leadId) await dbPatch('agency_leads', `id=eq.${leadId}`, { deleted_at: new Date().toISOString() }).catch(() => {})
  })

  test('1-2 · novo lead pela tela com origem WhatsApp; "Meus leads" no filtro', async ({ page }) => {
    await page.goto('/dashboard/pm/leads')
    await aguardarConteudo(page)
    await expect(page.getByLabel('Responsável', { exact: true }).locator('option', { hasText: 'Meus leads' })).toHaveCount(1)

    await page.getByTestId('lead-novo').click()
    await page.getByTestId('lead-cliente-busca').fill(EMPRESA)
    await page.getByLabel('Contato (nome)', { exact: true }).fill('Maria Teste')
    await page.getByLabel('Telefone', { exact: true }).fill('(45) 99999-0000')
    await page.getByLabel('Origem do Lead').selectOption('whatsapp')
    await page.getByTestId('lead-salvar').click()

    await expect.poll(async () => {
      const [l] = await dbSelect<{ id: string; origem: string; responsavel_id: string }>('agency_leads',
        `company_id=eq.${DEMO_AG}&empresa=eq.${encodeURIComponent(EMPRESA)}&deleted_at=is.null&select=id,origem,responsavel_id`)
      if (l) leadId = l.id
      return l ? `${l.origem}/${l.responsavel_id === robo}` : null
    }, { timeout: 15000, message: 'o lead gravou com a origem WhatsApp e é de quem criou' }).toBe('whatsapp/true')

    // "Meus leads" mostra o lead recém-criado
    await page.getByLabel('Responsável', { exact: true }).selectOption({ label: 'Meus leads' })
    await page.getByPlaceholder('Buscar contato/empresa/email…').fill(RUN)
    await expect(page.getByText(EMPRESA).first()).toBeVisible()
  })

  test('3-4 · Tarefas do lead: botão do WhatsApp, criar tarefa; aparece em "Minhas tarefas" e marca como feita', async ({ page }) => {
    expect(leadId, 'o passo anterior criou o lead').toBeTruthy()
    await page.goto('/dashboard/pm/leads')
    await aguardarConteudo(page)
    await page.getByPlaceholder('Buscar contato/empresa/email…').fill(RUN)
    await page.getByTestId('lead-tarefas').first().click()

    const modal = page.getByTestId('tarefas-lead')
    await expect(modal).toBeVisible()
    await expect(modal.getByTestId('tarefas-whatsapp')).toHaveAttribute('href', 'https://wa.me/5545999990000')

    await modal.getByTestId('tarefa-tipo-whatsapp').click()
    await modal.getByTestId('tarefa-titulo').fill(TAREFA)
    await modal.getByTestId('tarefa-data').fill(hojeSP())
    await modal.getByTestId('tarefa-hora').fill('15:00')
    await expect(modal.getByTestId('tarefa-responsavel')).toHaveValue(robo)
    await modal.getByTestId('tarefa-salvar').click()

    let tarefaId = ''
    await expect.poll(async () => {
      const [t] = await dbSelect<{ id: string; situacao: string }>('agency_lead_tarefa', `lead_id=eq.${leadId}&titulo=eq.${encodeURIComponent(TAREFA)}&select=id,situacao`)
      tarefaId = t?.id ?? ''
      return t?.situacao ?? null
    }, { timeout: 15000, message: 'a tarefa foi criada' }).toBe('a_fazer')
    await expect(modal.getByTestId(`tarefa-${tarefaId}`)).toContainText(TAREFA)

    // fecha e abre "Minhas tarefas" pelo botão do topo
    await page.mouse.click(5, 5)   // clique fora fecha a janela (overlay)
    await expect(modal).toBeHidden()
    await page.getByTestId('minhas-tarefas-abrir').click()
    const minhas = page.getByTestId('minhas-tarefas')
    await expect(minhas.getByTestId(`minha-tarefa-${tarefaId}`)).toContainText(TAREFA)

    // abre as tarefas do lead a partir de "Minhas tarefas" e marca como feita, com resultado
    await minhas.getByTestId(`minha-tarefa-${tarefaId}`).getByRole('button', { name: 'Abrir tarefas do lead' }).click()
    await page.getByTestId(`tarefa-feita-${tarefaId}`).click()
    await page.getByTestId('tarefa-resultado').fill('Cliente pediu a proposta por e-mail')
    await page.getByTestId('tarefa-confirmar').click()
    await expect.poll(async () => (await dbSelect<{ situacao: string; resultado: string }>('agency_lead_tarefa',
      `id=eq.${tarefaId}&select=situacao,resultado`))[0]?.situacao ?? null, { timeout: 15000 }).toBe('feita')
  })

  test('5 · Agenda: abre em "Minha agenda" com a tarefa do dia; "Equipe" mostra a de todos', async ({ page }) => {
    const [ag] = await dbSelect<{ titulo: string }>('erp_agendamento',
      `company_id=eq.${DEMO_AG}&dados->>lead_id=eq.${leadId}&excluido_em=is.null&select=titulo&order=created_at.desc&limit=1`)
    expect(ag, 'a tarefa entrou na agenda').toBeTruthy()
    await page.goto(`/dashboard/pm/agenda?data=${hojeSP()}`)
    await aguardarConteudo(page)
    await expect(page.getByTestId('agenda-minha')).toBeVisible()
    await expect(page.getByTestId('agenda-equipe')).toBeVisible()
    await expect(page.getByText(ag.titulo).first(), 'Minha agenda mostra a tarefa de quem está logado').toBeVisible()
    await page.getByTestId('agenda-equipe').click()
    await expect(page.getByText(ag.titulo).first(), 'Equipe também mostra').toBeVisible()
  })

  test('6 · Jobs: "+ Novo job" abre na ordem do SIGA (Cliente → Peça → Título → Prazo → Responsável → Briefing)', async ({ page }) => {
    await page.goto('/dashboard/producao')
    await aguardarConteudo(page)
    await page.getByRole('button', { name: '+ Novo job' }).first().click()
    const ordem = ['job-cliente', 'job-tipo', 'job-titulo', 'job-prazo']
    let yAnt = -1
    for (const id of ordem) {
      const el = page.getByTestId(id)
      await expect(el).toBeVisible()
      const y = (await el.boundingBox())!.y
      expect(y, `${id} vem depois do campo anterior`).toBeGreaterThan(yAnt)
      yAnt = y
    }
    await expect(page.getByTestId('job-responsavel')).toBeVisible()
    const yBriefing = (await page.getByPlaceholder('Descreva o job para quem vai executar', { exact: false }).boundingBox())!.y
    expect(yBriefing, 'Briefing por último').toBeGreaterThan((await page.getByTestId('job-responsavel').boundingBox())!.y)
  })
})
