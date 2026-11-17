// Consultor IA — Assistente de dados (SPEC Eng. Chefe RD-41 · CEO 17/11, RD-101).
// Prova os critérios DETERMINÍSTICOS da aceitação (sem gastar o teto de IA e sem depender da resposta do LLM):
//   (4) só texto — imagem/anexo é rejeitado; (2) multi-tenant — empresa fora do escopo é barrada no servidor;
//   guardas de entrada (sem auth, pergunta vazia); e o fallback GRÁTIS (Raio-X determinístico) na tela clara.
// Os critérios que dependem do LLM (1 resposta real, 3 bloqueio ao estourar US$2) são provados no PR por
// prova RD-38 da fn_ia_global_pode_gastar + a fiação da rota; não são exercidos aqui para não consumir o teto.
import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { registrarJornada, obterSessionPayload } from '../../support/api'

const DEMO_GE = 'b0700000-0000-4000-a000-000000000004'
const EMPRESA_FORA = '00000000-0000-0000-0000-0000000000ff' // uuid que o usuário não pode acessar

test.describe('Consultor IA · roteador seguro', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-consultor-ia-roteador', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('guardas da rota: sem auth, só texto e escopo multi-tenant', async ({ request }) => {
    const token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
    const h = { Authorization: `Bearer ${token}` }

    // Sem token → 401 (não autenticado).
    const semAuth = await request.post('/api/consultor-ia', { data: { pergunta: 'oi', company_id: DEMO_GE } })
    expect(semAuth.status(), 'sem auth é barrado').toBe(401)

    // (critério 4) imagem/anexo → 415 (a rota só aceita texto).
    const comImagem = await request.post('/api/consultor-ia', { headers: h, data: { pergunta: 'analise', company_id: DEMO_GE, imagem: 'data:image/png;base64,AAAA' } })
    expect(comImagem.status(), 'imagem/anexo é rejeitado — só texto').toBe(415)

    // Pergunta vazia → 400.
    const vazia = await request.post('/api/consultor-ia', { headers: h, data: { pergunta: '   ', company_id: DEMO_GE } })
    expect(vazia.status(), 'pergunta vazia é barrada').toBe(400)

    // (critério 2) empresa fora do escopo → 403, mesmo com pergunta válida (o LLM nem é chamado: a guarda vem antes).
    const foraEscopo = await request.post('/api/consultor-ia', { headers: h, data: { pergunta: 'quais contas vencem hoje?', company_id: EMPRESA_FORA } })
    expect(foraEscopo.status(), 'empresa fora do escopo é barrada no servidor').toBe(403)
  })

  test('fallback GRÁTIS: Raio-X determinístico na tela clara, sem custo', async ({ page }) => {
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_GE)
    await page.goto('/dashboard/consultor-ia')
    await aguardarConteudo(page)
    // título legível (tema claro — corrige o "título fantasma" da V1 escura)
    await expect(page.getByText('Consultor IA · Assistente dos seus dados')).toBeVisible({ timeout: 20000 })
    // o atalho gratuito roda a análise determinística (fn_consultor_raiox) sem chamar a IA
    await page.getByRole('button', { name: /Raio-X \(grátis\)/ }).click()
    // resultado determinístico: ou achados, ou o estado "não achei problema" — qualquer um prova que rodou de graça
    await expect(page.getByText(/Como corrigir|não achei problema/).first()).toBeVisible({ timeout: 25000 })
  })
})
