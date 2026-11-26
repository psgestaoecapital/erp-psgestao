// Consultor IA — Assistente de dados (SPEC Eng. Chefe RD-41 · CEO 17/11, RD-101).
// Prova os critérios DETERMINÍSTICOS da aceitação (sem gastar o teto de IA e sem depender da resposta do LLM):
//   (4) só texto — imagem/anexo é rejeitado; (2) multi-tenant — empresa fora do escopo é barrada no servidor;
//   guardas de entrada (sem auth, pergunta vazia); e o fallback GRÁTIS (Raio-X determinístico) na tela clara.
// Os critérios que dependem do LLM (1 resposta real, 3 bloqueio ao estourar US$2) são provados no PR por
// prova RD-38 da fn_ia_global_pode_gastar + a fiação da rota; não são exercidos aqui para não consumir o teto.
import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { registrarJornada, obterSessionPayload, dbInsert, dbPatch, rpcComoRobo } from '../../support/api'

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

    // Isolamento por CNPJ (CEO 18/11): "consolidado"/grupo não é uma empresa — o consultor responde por UM CNPJ.
    const consolidado = await request.post('/api/consultor-ia', { headers: h, data: { pergunta: 'quais contas vencem hoje?', company_id: 'consolidado' } })
    expect(consolidado.status(), 'consolidado/grupo é barrado: um CNPJ por vez').toBe(400)
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

  // Situação de UM cliente/fornecedor (CEO 25/11 · piloto P&M): a RPC determinística responde "por que o saldo está
  // assim" com título + diagnóstico + link — NUNCA "Não entendi". Prova sem gastar o teto de IA (chama a RPC direto,
  // como o usuário logado). @pos-migration: depende da fn_consultor_situacao_parceiro (migration aplicada em produção).
  test('situação do parceiro: título pago com juros → diagnóstico + link (sem "Não entendi")', { tag: '@pos-migration' }, async () => {
    const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}-${Date.now().toString(36)}`
    const nome = `IGP ACEITE ${RUN}`
    const dIso = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10)
    const cliente = (await dbInsert<{ id: string }>('erp_clientes', { company_id: DEMO_GE, tipo_pessoa: 'PJ', ativo: true, nome_fantasia: nome })).id
    // título pago com juros e SEM conciliar: o trigger mantém 'pago' (pagou o valor original), sobra o juro como saldo.
    const titulo = (await dbInsert<{ id: string }>('erp_receber', {
      company_id: DEMO_GE, cliente_id: cliente, cliente_nome: nome, descricao: `Aceite situação ${RUN}`,
      valor: 100, juros: 3, data_emissao: dIso(10), data_vencimento: dIso(5), forma_pagamento: 'pix',
      valor_pago: 100, data_pagamento: dIso(3), status: 'pago',
    })).id
    try {
      const r = await rpcComoRobo<{ ok?: boolean; encontrou?: boolean; parceiro?: { nome?: string }; titulos?: unknown[]; diagnosticos?: { codigo: string; link?: string; frase?: string }[] }>(
        'fn_consultor_situacao_parceiro', { p_company_id: DEMO_GE, p_termo: nome, p_tipo: 'cliente' })
      expect(r.status, r.texto).toBe(200)
      const c = r.corpo!
      expect(c.ok, 'RPC respondeu ok').toBe(true)
      expect(c.encontrou, 'encontrou o parceiro — não é "Não entendi"').toBe(true)
      expect(c.parceiro?.nome, 'trouxe o parceiro certo').toContain('IGP ACEITE')
      expect((c.titulos ?? []).length, 'trouxe os títulos do parceiro').toBeGreaterThan(0)
      const comLink = (c.diagnosticos ?? []).some((x) => typeof x.link === 'string' && x.link.includes('/dashboard/financeiro/'))
      expect(comLink, 'há diagnóstico determinístico com link para abrir e corrigir o título').toBe(true)
    } finally {
      await dbPatch('erp_receber', `id=eq.${titulo}`, { deleted_at: new Date().toISOString() })
      await dbPatch('erp_clientes', `id=eq.${cliente}`, { ativo: false })
    }
  })

  test('tela: atalho "Situação de um cliente ou fornecedor" com "?" (RD-95), sem IA', async ({ page }) => {
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_GE)
    await page.goto('/dashboard/consultor-ia')
    await aguardarConteudo(page)
    await expect(page.getByText('Situação de um cliente ou fornecedor')).toBeVisible({ timeout: 20000 })
    await expect(page.getByPlaceholder(/Nome ou CNPJ/)).toBeVisible()
  })
})
