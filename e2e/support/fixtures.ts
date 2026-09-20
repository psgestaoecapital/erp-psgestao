// Revenda R1b · fixtures das jornadas.
// LISTA DE BLOQUEIO (decisão do CEO): a jornada FALHA se a tela tentar uma ação REAL —
// emitir NF-e real, boleto real, e-mail/WhatsApp real, ou qualquer chamada a provedor externo.
// Só a empresa de DEMONSTRAÇÃO pode ser tocada. Tudo o mais (Supabase, Vercel, storage) segue normal.

import { test as base, expect, type Page } from '@playwright/test'
import { DEMO_REVENDA, storageKey } from './api'

// Provedores externos + endpoints de ação real do próprio app. Conservador: só o que É ação externa.
const BLOQUEIO = /(focusnfe|sefaz\.|api\.resend\.com|graph\.facebook\.com|api\.twilio\.com|z-api\.io)|\/api\/(fiscal\/nfe|fiscal\/nfse|boleto|cnab|remessa|whatsapp|email)(\/|$|\?)/i

type Fixtures = { guardaAcoesReais: void }

export const test = base.extend<Fixtures>({
  // auto: roda em toda jornada. Aborta e registra qualquer tentativa de ação real; falha no fim.
  guardaAcoesReais: [async ({ page }, use) => {
    const violacoes: string[] = []
    await page.route('**/*', (route) => {
      const url = route.request().url()
      if (BLOQUEIO.test(url)) { violacoes.push(url); return route.abort() }
      return route.continue()
    })
    await use()
    expect(violacoes, `A jornada tentou ação REAL (proibido fora de demo): ${violacoes.join(' , ')}`).toEqual([])
  }, { auto: true }],
})

export { expect }

// Confere que a empresa selecionada é a DEMONSTRAÇÃO (nunca uma empresa real).
export async function exigirEmpresaDemo(page: Page): Promise<void> {
  const sel = await page.evaluate(() => {
    try { return window.localStorage.getItem('ps_empresa_sel') } catch { return null }
  })
  expect(sel, 'a jornada só pode rodar na empresa de demonstração').toBe(DEMO_REVENDA)
}

// Espera a app-shell assentar (mesma heurística do screen-watcher) — evita medir no meio do load.
export async function aguardarConteudo(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle').catch(() => {})
  await expect
    .poll(async () => page.evaluate(() => {
      const t = document.body?.innerText || ''
      const txtLen = t.replace(/\s+/g, '').length
      const shellTravado = /verificando permiss|carregando menu|carregando empresas|carregando dados do/i.test(t)
      return txtLen > 180 && !shellTravado
    }), { timeout: 20000, message: 'a página não assentou (ficou em loading)' })
    .toBe(true)
}

export { storageKey }
