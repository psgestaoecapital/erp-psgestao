// Explorador de botões do Hub de Projetos — ferramenta do eng-chefe-auto (CHECK do PDCA do Hub, RD-97).
//
// O QUE FAZ: entra como o robô (mesmo login da tela), fixa a empresa DEMO "Construtora Modelo", e para CADA rota
// do Hub (scripts/auditoria/hub-rotas.json) nos dois viewports (computador 1440×900 e celular 390×844):
//   - abre a rota e mede tempo de carga;
//   - coleta erros de console, pageerror e respostas 4xx/5xx (sinais de QUEBRADO);
//   - enumera botões, links internos e campos, e conta os "?" de ajuda (RD-95);
//   - explora SÓ botões seguros (incluir/editar/filtrar: abrem um formulário e ele CANCELA) — NUNCA clica em
//     ação perigosa (emitir/transmitir nota, pagar, aprovar, conciliar, enviar a terceiros, integrar, cofre, excluir);
//   - grava a exploração em gold_exploracao (company_id = DEMO, rota, estado, elementos jsonb).
//
// SEGURANÇA (CEO): roda SEMPRE e SÓ na empresa DEMO; o robô nunca clica em ação perigosa; não faz merge, não decide.
// O veredito (nota visual/funcional) é passo separado; aqui é a COLETA (o "explorador de botões", gold_exploracao).
//
// Segredos (iguais aos das jornadas, só no runner): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// NEXT_PUBLIC_SUPABASE_ANON_KEY, PLAYWRIGHT_USER_EMAIL, PLAYWRIGHT_USER_PASSWORD. Base: PROD_BASE_URL.
//
// Uso:
//   npm run hub:explorar                 # explora todas as rotas do Hub (precisa dos segredos)
//   npm run hub:explorar -- --listar     # só lista as rotas (sem navegador, sem segredos) — usado pelo gate/local
//   npm run hub:explorar -- --rota /dashboard/projetos/insumos   # uma rota só

import { chromium, type Browser, type Page } from 'playwright'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BASE_URL, dbInsert, obterSessionPayload, storageKey } from '../../e2e/support/api'
import { ACOES_FECHAR, ACOES_PROIBIDAS, carregarRotas, ehAcaoProibida, ehAcaoSeguraDeAbrir, normalizar } from './hub-seguranca'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(__dirname, 'hub-output')

// ── Coleta por rota × viewport ────────────────────────────────────────────────────────────────────────
type Viewport = { nome: 'computador' | 'celular'; width: number; height: number }
const VIEWPORTS: Viewport[] = [
  { nome: 'computador', width: 1440, height: 900 },
  { nome: 'celular', width: 390, height: 844 },
]

interface ResultadoRota {
  rota: string
  viewport: string
  url_final: string
  redirecionou_fora_do_hub: boolean
  load_ms: number
  contagem: { botoes: number; links_internos: number; campos: number; ajuda_campo: number }
  botoes: string[]
  campos: string[]
  console_erros: string[]
  respostas_falha: Array<{ url: string; status: number }>
  exploracao_segura: Array<{ rotulo: string; abriu_dialog: boolean; dialog_titulo: string | null; fechou_por: string }>
  acoes_proibidas_ignoradas: string[]
  estado: string
}

async function explorarRota(page: Page, rota: string, vp: Viewport): Promise<ResultadoRota> {
  const consoleErros: string[] = []
  const respostasFalha: Array<{ url: string; status: number }> = []
  page.on('console', (m) => { if (m.type() === 'error') consoleErros.push(m.text().slice(0, 300)) })
  page.on('pageerror', (e) => consoleErros.push('pageerror: ' + (e.message || String(e)).slice(0, 300)))
  page.on('response', (r) => { const s = r.status(); if (s >= 400 && s < 600) respostasFalha.push({ url: r.url().slice(0, 200), status: s }) })

  const inicio = Date.now()
  let estado = 'explorado'
  try {
    await page.goto(BASE_URL + rota, { waitUntil: 'load', timeout: 45_000 })
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})
  } catch (e) {
    estado = 'erro-carga'
    consoleErros.push('goto: ' + (e instanceof Error ? e.message : String(e)).slice(0, 200))
  }
  const loadMs = Date.now() - inicio
  const urlFinal = page.url()
  const redirecionou = !new URL(urlFinal).pathname.startsWith('/dashboard/projetos')

  // Enumeração do DOM renderizado.
  const dom = await page.evaluate(() => {
    const textoDe = (el: Element) =>
      (el.getAttribute('aria-label') || el.textContent || (el as HTMLInputElement).value || '').replace(/\s+/g, ' ').trim().slice(0, 120)
    const botoes: string[] = []
    document.querySelectorAll('button, [role="button"], a[role="button"], input[type="submit"], input[type="button"]').forEach((el) => {
      const t = textoDe(el); if (t) botoes.push(t)
    })
    let linksInternos = 0
    document.querySelectorAll('a[href]').forEach((el) => { if ((el.getAttribute('href') || '').startsWith('/dashboard/')) linksInternos++ })
    const campos: string[] = []
    document.querySelectorAll('input:not([type="submit"]):not([type="button"]):not([type="hidden"]), select, textarea').forEach((el) => {
      const id = (el as HTMLElement).id
      const lab = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent : null
      const t = (lab || el.getAttribute('aria-label') || el.getAttribute('placeholder') || (el as HTMLInputElement).name || '').replace(/\s+/g, ' ').trim().slice(0, 120)
      campos.push(t || `(${el.tagName.toLowerCase()})`)
    })
    // RD-95: "?" do componente de ajuda (data-ajuda-campo ou botão de ajuda).
    const ajuda = document.querySelectorAll('[data-ajuda-campo], button[aria-label^="Ajuda"], [data-testid="ajuda-campo"]').length
    return { botoes, linksInternos, campos, ajuda }
  }).catch(() => ({ botoes: [] as string[], linksInternos: 0, campos: [] as string[], ajuda: 0 }))

  const acoesProibidasIgnoradas = dom.botoes.filter(ehAcaoProibida).slice(0, 40)
  const exploracaoSegura: ResultadoRota['exploracao_segura'] = []

  // Exploração SEGURA só no computador (economia): abre até 4 formulários seguros e cancela.
  if (vp.nome === 'computador' && estado === 'explorado' && !redirecionou) {
    const candidatos = dom.botoes.filter(ehAcaoSeguraDeAbrir).slice(0, 4)
    for (const rotulo of candidatos) {
      try {
        const alvo = page.getByRole('button', { name: rotulo, exact: false }).first()
        if (!(await alvo.isVisible().catch(() => false))) continue
        if (!(await alvo.isEnabled().catch(() => false))) continue
        await alvo.click({ timeout: 4000 })
        await page.waitForTimeout(700)
        const dialog = page.locator('[role="dialog"], [aria-modal="true"], .modal').first()
        const abriu = await dialog.isVisible().catch(() => false)
        let titulo: string | null = null
        if (abriu) titulo = (await dialog.locator('h1,h2,h3,[role="heading"]').first().textContent().catch(() => null))?.replace(/\s+/g, ' ').trim().slice(0, 120) ?? null
        // FECHA sem salvar: botão de fechar (nunca um salvar/confirmar), senão Escape.
        let fechouPor = 'escape'
        const btnFechar = (abriu ? dialog : page).locator('button')
        const n = await btnFechar.count().catch(() => 0)
        for (let i = 0; i < Math.min(n, 30); i++) {
          const t = normalizar((await btnFechar.nth(i).textContent().catch(() => '')) || '')
          if (ACOES_FECHAR.some((f) => t.includes(f)) && !ehAcaoProibida(t)) {
            await btnFechar.nth(i).click({ timeout: 3000 }).catch(() => {}); fechouPor = 'botao-fechar'; break
          }
        }
        if (fechouPor === 'escape') await page.keyboard.press('Escape').catch(() => {})
        await page.waitForTimeout(300)
        exploracaoSegura.push({ rotulo, abriu_dialog: abriu, dialog_titulo: titulo, fechou_por: fechouPor })
      } catch (e) {
        exploracaoSegura.push({ rotulo, abriu_dialog: false, dialog_titulo: null, fechou_por: 'erro:' + (e instanceof Error ? e.message : String(e)).slice(0, 80) })
      }
    }
  }

  // Screenshot (prova visual local; upload para storage é passo futuro).
  try {
    mkdirSync(OUT_DIR, { recursive: true })
    const slug = rota.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '')
    await page.screenshot({ path: join(OUT_DIR, `${slug}-${vp.nome}.png`), fullPage: true })
  } catch { /* screenshot é observabilidade, não derruba a coleta */ }

  if (estado === 'explorado') {
    if (redirecionou) estado = 'redirect'
    else if (consoleErros.length > 0 || respostasFalha.length > 0) estado = 'alerta'
  }

  return {
    rota, viewport: vp.nome, url_final: urlFinal, redirecionou_fora_do_hub: redirecionou, load_ms: loadMs,
    contagem: { botoes: dom.botoes.length, links_internos: dom.linksInternos, campos: dom.campos.length, ajuda_campo: dom.ajuda },
    botoes: dom.botoes.slice(0, 60), campos: dom.campos.slice(0, 60),
    console_erros: consoleErros.slice(0, 40), respostas_falha: respostasFalha.slice(0, 40),
    exploracao_segura: exploracaoSegura, acoes_proibidas_ignoradas: acoesProibidasIgnoradas, estado,
  }
}

async function gravar(companyId: string, runId: string, r: ResultadoRota): Promise<void> {
  try {
    await dbInsert('gold_exploracao', {
      company_id: companyId,
      rota: r.rota,
      estado: r.estado,
      elementos: r as unknown as Record<string, unknown>,
      run_id: runId,
      executado_em: new Date().toISOString(),
    })
  } catch (e) {
    console.error(`  ⚠ gravar gold_exploracao falhou (${r.rota}/${r.viewport}): ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`)
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const { empresa_demo: companyId, empresa_demo_nome, rotas } = carregarRotas()
  const soLista = args.includes('--listar')
  const idx = args.indexOf('--rota')
  const filtro = idx >= 0 ? args[idx + 1] : null
  const alvo = filtro ? rotas.filter((r) => r.rota === filtro) : rotas
  if (!alvo.length) { console.error(`Nenhuma rota casando com ${filtro}`); process.exit(1) }

  if (soLista) {
    console.log(`Hub · empresa DEMO ${empresa_demo_nome} (${companyId}) · ${alvo.length} rota(s):`)
    alvo.forEach((r) => console.log(`  ${r.rota}  — ${r.titulo}`))
    console.log(`\nAções PROIBIDAS de clicar (${ACOES_PROIBIDAS.length}): ${ACOES_PROIBIDAS.join(', ')}`)
    return
  }

  // storageState do robô na empresa DEMO do Hub (mesmo mecanismo das jornadas).
  const session = await obterSessionPayload()
  const origem = new URL(BASE_URL).origin
  const runId = randomUUID()
  console.log(`Hub explorador · base=${BASE_URL} · DEMO=${empresa_demo_nome} · run=${runId} · ${alvo.length} rotas × ${VIEWPORTS.length} viewports`)

  const browser: Browser = await chromium.launch({ headless: true })
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
  let erros = 0
  try {
    for (const { rota } of alvo) {
      for (const vp of VIEWPORTS) {
        const ctx = await browser.newContext({
          viewport: { width: vp.width, height: vp.height },
          ignoreHTTPSErrors: true,
          ...(bypass ? { extraHTTPHeaders: { 'x-vercel-protection-bypass': bypass, 'x-vercel-set-bypass-cookie': 'true' } } : {}),
          storageState: {
            cookies: [],
            origins: [{ origin: origem, localStorage: [
              { name: storageKey(), value: session },
              { name: 'ps_empresa_sel', value: companyId },
              { name: 'ps_allow_preview', value: '1' },
            ] }],
          },
        })
        const page = await ctx.newPage()
        try {
          const r = await explorarRota(page, rota, vp)
          await gravar(companyId, runId, r)
          const sinal = r.estado === 'explorado' ? 'OK' : r.estado.toUpperCase()
          console.log(`  [${vp.nome}] ${rota} → ${sinal} · ${r.load_ms}ms · ${r.contagem.botoes} botões · ${r.contagem.ajuda_campo} "?" · ${r.console_erros.length} erro(s) console · ${r.respostas_falha.length} 4xx/5xx`)
          if (r.estado === 'erro-carga' || r.console_erros.length) erros++
        } finally {
          await page.close(); await ctx.close()
        }
      }
    }
  } finally {
    await browser.close()
  }
  console.log(`\nConcluído · run=${runId} · ${erros > 0 ? erros + ' rota(s)/viewport com erro de carga/console' : 'sem erro de carga/console'}`)
}

// Só roda main quando executado direto (o gate importa as guardas puras sem navegar).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error('Hub explorador falhou:', err); process.exit(1) })
}
