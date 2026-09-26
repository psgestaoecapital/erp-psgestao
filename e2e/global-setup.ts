// Revenda R1b · global setup: login do bot UMA vez (mesmo caminho da tela) e grava o storageState
// (localStorage sb-<ref>-auth-token + ps_empresa_sel = Demonstração Revenda). Todas as jornadas herdam.
//
// RD-78 (26/09): ps_allow_preview = '1' também vai no storageState. O PwaBootstrap tem uma guarda de host
// (#1240): em qualquer *.vercel.app que não seja o canônico ele faz window.location.replace para
// erp-psgestao.vercel.app. No PREVIEW isso jogava o robô para PRODUÇÃO sem sessão (o storageState é da
// origem do preview) → o app rodava como anônimo e a página nunca assentava ("Execution context was
// destroyed … navigation"). A flag é o bypass que a própria guarda prevê; em produção não tem efeito.

import { mkdirSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { chromium, devices } from '@playwright/test'
import { BASE_URL, DEMO_REVENDA, exigirEnv, obterSessionPayload, storageKey } from './support/api'

export const STORAGE_STATE = 'e2e/.auth/state.json'
const DIAG_DIR = 'e2e/.diagnostico'   // fora de test-results/ (o Playwright limpa essa pasta ao iniciar)
const HOST_CANONICO = 'erp-psgestao.vercel.app'

type LocalStorageItem = { name: string; value: string }

// Prova (RD-38) no próprio log do CI: abre a mesma rota com e sem a flag e registra para onde o app foi.
// Nunca derruba o setup — é diagnóstico; a jornada é quem julga.
async function diagnosticarHost(origem: string, base: LocalStorageItem[]): Promise<void> {
  const host = new URL(origem).host
  const ehPreview = host.endsWith('.vercel.app') && host !== HOST_CANONICO
  mkdirSync(DIAG_DIR, { recursive: true })
  const browser = await chromium.launch()
  try {
    const casos: Array<{ nome: string; itens: LocalStorageItem[] }> = [
      ...(ehPreview ? [{ nome: 'sem-flag', itens: base.filter((i) => i.name !== 'ps_allow_preview') }] : []),
      { nome: 'com-flag', itens: base },
    ]
    for (const caso of casos) {
      const ctx = await browser.newContext({
        ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 },
        storageState: { cookies: [], origins: [{ origin: origem, localStorage: caso.itens }] },
      })
      const page = await ctx.newPage()
      const alvo = `${origem}/dashboard`
      try {
        await page.goto(alvo, { waitUntil: 'load', timeout: 45_000 })
        // a guarda roda num useEffect: dá tempo de ela agir (ou não) e de o shell assentar
        await page.waitForURL((u) => new URL(u.toString()).host !== host, { timeout: 10_000 }).catch(() => {})
        await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})
        const final = page.url()
        const trocouHost = new URL(final).host !== host
        const texto = ((await page.evaluate(() => document.body?.innerText || '').catch(() => '')) || '')
          .replace(/\s+/g, ' ').trim().slice(0, 160)
        await page.screenshot({ path: join(DIAG_DIR, `${caso.nome}.png`), fullPage: false }).catch(() => {})
        console.log(`[diagnostico-host] ${caso.nome}: abriu ${alvo} → ficou em ${final}` +
          `${trocouHost ? '  ⚠️ REDIRECIONADO PARA OUTRO HOST' : '  ✓ mesmo host'} · texto: "${texto}"`)
      } catch (e) {
        console.log(`[diagnostico-host] ${caso.nome}: falhou ao abrir ${alvo}: ${e instanceof Error ? e.message : String(e)}`)
      } finally {
        await ctx.close()
      }
    }
  } finally {
    await browser.close()
  }
}

export default async function globalSetup(): Promise<void> {
  exigirEnv()
  const session = await obterSessionPayload()
  const origem = new URL(BASE_URL).origin
  console.log(`[jornadas-revenda] BASE_URL = ${BASE_URL}`)
  const localStorage: LocalStorageItem[] = [
    { name: storageKey(), value: session },
    { name: 'ps_empresa_sel', value: DEMO_REVENDA },
    { name: 'ps_allow_preview', value: '1' },
  ]
  const state = { cookies: [], origins: [{ origin: origem, localStorage }] }
  mkdirSync(dirname(STORAGE_STATE), { recursive: true })
  writeFileSync(STORAGE_STATE, JSON.stringify(state, null, 2))
  console.log(`[jornadas-revenda] storageState gravado (empresa demo ${DEMO_REVENDA}) para ${origem}`)

  try { await diagnosticarHost(origem, localStorage) }
  catch (e) { console.log(`[diagnostico-host] não rodou: ${e instanceof Error ? e.message : String(e)}`) }
}
