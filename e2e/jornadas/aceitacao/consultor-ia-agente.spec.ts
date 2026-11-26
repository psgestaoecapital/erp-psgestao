// Consultor IA · PR B — AGENTE (loop de ferramentas, streaming, trava de número, custo, feedback).
// Convenção (igual ao roteador): a suíte NÃO chama o LLM (não gasta o teto; o LLM é flaky). Prova o que é
// DETERMINÍSTICO: guardas da rota do agente, os ATALHOS grátis (/atalho), o writer de feedback guardado, a trava
// de número (unidade) e a tela (LGPD "?", feedback). As 20 perguntas (e2e/fixtures/consultor-ia-perguntas.json)
// são a PROVA DE PILOTO (manual/auditor), com os critérios do LLM (>=18/20, 0 inventado) medidos lá.
import { readFileSync } from 'node:fs'
import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { registrarJornada, obterSessionPayload, rpcComoRobo } from '../../support/api'
import { conferirNumeros } from '../../../src/lib/consultor/numberLock'

const DEMO_GE = 'b0700000-0000-4000-a000-000000000004'
const EMPRESA_FORA = '00000000-0000-0000-0000-0000000000ff'

test.describe('Consultor IA · agente (PR B)', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-consultor-ia-agente', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('guardas da rota do agente: sem auth, só texto, escopo e um CNPJ por vez', async ({ request }) => {
    const token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
    const h = { Authorization: `Bearer ${token}` }
    expect((await request.post('/api/consultor-ia', { data: { pergunta: 'oi', company_id: DEMO_GE } })).status(), 'sem auth').toBe(401)
    expect((await request.post('/api/consultor-ia', { headers: h, data: { pergunta: 'x', company_id: DEMO_GE, imagem: 'data:image/png;base64,AAAA' } })).status(), 'imagem rejeitada').toBe(415)
    expect((await request.post('/api/consultor-ia', { headers: h, data: { pergunta: '   ', company_id: DEMO_GE } })).status(), 'vazia').toBe(400)
    expect((await request.post('/api/consultor-ia', { headers: h, data: { pergunta: 'quais contas vencem hoje?', company_id: EMPRESA_FORA } })).status(), 'empresa fora do escopo').toBe(403)
    expect((await request.post('/api/consultor-ia', { headers: h, data: { pergunta: 'quais contas vencem hoje?', company_id: 'consolidado' } })).status(), 'consolidado barrado').toBe(400)
  })

  test('ATALHOS determinísticos (grátis, sem LLM): saldo e divergência respondem, e respeitam o escopo', async ({ request }) => {
    const token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
    const h = { Authorization: `Bearer ${token}` }
    const saldo = await request.post('/api/consultor-ia/atalho', { headers: h, data: { tool: 'saldo_contas', company_id: DEMO_GE } })
    expect(saldo.status(), 'saldo ok').toBe(200)
    expect((await saldo.json()).tipo, 'atalho saldo → tipo valor').toBe('valor')
    const div = await request.post('/api/consultor-ia/atalho', { headers: h, data: { tool: 'divergencia_saldo', company_id: DEMO_GE } })
    expect(div.status(), 'divergência ok').toBe(200)
    expect((await div.json()).tipo, 'atalho divergência → tipo divergencia').toBe('divergencia')
    // escopo: atalho de outra empresa é barrado no servidor (sem LLM, só guarda)
    const fora = await request.post('/api/consultor-ia/atalho', { headers: h, data: { tool: 'saldo_contas', company_id: EMPRESA_FORA } })
    expect(fora.status(), 'atalho fora do escopo barrado').toBe(403)
  })

  test('trava de número (unidade): valor inventado é pego; valores reais casam', () => {
    const res = { titulos: [{ valor_pago: 143.52, juros_multa: 5.52, saldo: 0 }], totais: { vencido: 3386.52 } }
    expect(conferirNumeros('pago R$ 143,52 com R$ 5,52 de juros; grupo R$ 3.386,52', res).ok, 'reais casam').toBe(true)
    const inv = conferirNumeros('o saldo é R$ 999,99', res)
    expect(inv.ok, 'inventado não casa').toBe(false)
    expect(inv.naoCasados, 'aponta o valor suspeito').toContain('R$ 999,99')
  })

  test('writer de feedback guardado grava e devolve id (@pos-migration)', { tag: '@pos-migration' }, async () => {
    const run = `${process.env.GITHUB_RUN_ID ?? 'local'}-${Date.now().toString(36)}`
    const r = await rpcComoRobo<string>('fn_consultor_feedback_registrar', {
      p_company_id: DEMO_GE, p_sessao_id: `aceite-${run}`, p_pergunta: 'pergunta de aceite', p_resposta_resumo: 'resumo de aceite', p_util: true, p_o_que_faltou: null,
    })
    expect(r.status, r.texto).toBe(200)
    expect(String(r.corpo), 'feedback devolve um id uuid').toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/i)
  })

  test('banco das 20 perguntas do piloto existe e traz a flagship com o fato exato', () => {
    const fx = JSON.parse(readFileSync('e2e/fixtures/consultor-ia-perguntas.json', 'utf8')) as { perguntas: { id: string; deve_conter?: string[] }[] }
    expect(fx.perguntas.length, '20 perguntas do aceite').toBe(20)
    const flag = fx.perguntas.find((p) => p.id === 'igp-boleto-juros')
    expect(flag, 'tem a pergunta flagship do IGP').toBeTruthy()
    expect(flag!.deve_conter, 'flagship exige 143,52 e "erro do sistema"').toEqual(expect.arrayContaining(['143,52', 'erro do sistema']))
  })

  test('tela do agente: aviso LGPD com "?" e pergunta de feedback', async ({ page }) => {
    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_GE)
    await page.goto('/dashboard/consultor-ia')
    await aguardarConteudo(page)
    await expect(page.getByText('Consultor IA · seu analista financeiro')).toBeVisible({ timeout: 20000 })
    await expect(page.getByText(/não os usa para treinar modelos/)).toBeVisible()
    await expect(page.getByRole('button', { name: /Raio-X \(grátis\)/ })).toBeVisible()
  })
})
