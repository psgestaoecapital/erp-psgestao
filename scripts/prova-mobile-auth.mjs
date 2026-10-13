// Prova mobile P0 — "app perde login em 2º plano e vira visitante" (contexto 16bc8561 / 147694b7).
// Reproduz o cenário do celular do CEO (Android 10 / Chrome). Roda em STAGING/CI com uma sessão
// semeada (do robô/demo), sem depender de selectors do /login.
//
// Como rodar:
//   BASE_URL=https://erp-psgestao.vercel.app \
//   PS_PROJECT_REF=horsymhsinqcimflrtjo \
//   PS_E2E_SESSION='<valor JSON do localStorage sb-<ref>-auth-token de uma sessão válida>' \
//   PS_EMPRESA=918c3ea4-... \
//   node scripts/prova-mobile-auth.mjs
//
// O que prova:
//   A) Retomada (visibilitychange→visible) com sessão vencendo → aparece POST /auth/v1/token (refresh)
//      e fn_empresa_areas_status volta 200 (com JWT). Sem enxurrada de fn_listar_areas_visiveis.
//   B) Com /auth/v1/token BLOQUEADO → a tela "Sua sessão expirou" aparece (NUNCA dashboard vazio).
import { chromium, devices } from 'playwright'

const BASE_URL = process.env.BASE_URL || 'https://erp-psgestao.vercel.app'
const REF = process.env.PS_PROJECT_REF || 'horsymhsinqcimflrtjo'
const SESSION = process.env.PS_E2E_SESSION
const EMPRESA = process.env.PS_EMPRESA || ''
const STORAGE_KEY = `sb-${REF}-auth-token`

if (!SESSION) { console.error('Falta PS_E2E_SESSION (valor do localStorage da sessão semeada).'); process.exit(2) }

// UA de Android/Chrome como o do CEO, viewport de celular.
const MOBILE = {
  ...devices['Pixel 5'],
  userAgent: 'Mozilla/5.0 (Linux; Android 10; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36',
}

// Rebaixa expires_at da sessão para o passado (simula token vencido em 2º plano).
function expirar(sessionJson) {
  const s = JSON.parse(sessionJson)
  const passado = Math.floor(Date.now() / 1000) - 10
  if (s.expires_at) s.expires_at = passado
  if (s.expires_in) s.expires_in = -10
  return JSON.stringify(s)
}

async function novaAba(browser, { bloquearRefresh }) {
  const ctx = await browser.newContext({ ...MOBILE, ignoreHTTPSErrors: true })
  const tokenReqs = []
  const areasStatus = []
  const listarChamadas = []
  await ctx.addInitScript(({ k, v, ek, ev }) => {
    try { localStorage.setItem(k, v); if (ev) localStorage.setItem(ek, ev) } catch {}
  }, { k: STORAGE_KEY, v: expirar(SESSION), ek: 'ps_empresa_sel', ev: EMPRESA })
  const page = await ctx.newPage()
  if (bloquearRefresh) await page.route('**/auth/v1/token**', (r) => r.abort())
  page.on('request', (r) => { if (r.url().includes('/auth/v1/token')) tokenReqs.push(r.url()) })
  page.on('response', (r) => {
    if (r.url().includes('fn_empresa_areas_status')) areasStatus.push(r.status())
    if (r.url().includes('fn_listar_areas_visiveis')) listarChamadas.push(r.status())
  })
  return { ctx, page, tokenReqs, areasStatus, listarChamadas }
}

async function main() {
  const browser = await chromium.launch({ headless: true })
  let falhas = 0
  try {
    // ── Cenário A ──────────────────────────────────────────────────────────
    {
      const { ctx, page, tokenReqs, areasStatus, listarChamadas } = await novaAba(browser, { bloquearRefresh: false })
      await page.goto(`${BASE_URL}/dashboard`, { waitUntil: 'commit', timeout: 30000 }).catch(() => {})
      await page.waitForTimeout(1500)
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
      await page.evaluate(() => window.dispatchEvent(new Event('focus')))
      await page.waitForTimeout(6000)
      const refreshOk = tokenReqs.length > 0
      const statusOk = areasStatus.length === 0 || areasStatus.every((s) => s === 200)
      const semEnxurrada = listarChamadas.length <= 1
      console.log(`A) refresh(/auth/v1/token)=${tokenReqs.length} · areas_status=${JSON.stringify(areasStatus)} · listar=${listarChamadas.length}`)
      if (!refreshOk) { falhas++; console.error('   ✗ esperava POST /auth/v1/token na retomada') }
      if (!statusOk) { falhas++; console.error('   ✗ fn_empresa_areas_status não voltou 200') }
      if (!semEnxurrada) { falhas++; console.error('   ✗ mais de 1 fn_listar_areas_visiveis por retomada') }
      if (refreshOk && statusOk && semEnxurrada) console.log('   ✓ retomada renova o token e não vira visitante')
      await ctx.close()
    }
    // ── Cenário B ──────────────────────────────────────────────────────────
    {
      const { ctx, page } = await novaAba(browser, { bloquearRefresh: true })
      await page.goto(`${BASE_URL}/dashboard`, { waitUntil: 'commit', timeout: 30000 }).catch(() => {})
      await page.waitForTimeout(1500)
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
      await page.waitForTimeout(6000)
      const txt = await page.textContent('body').catch(() => '')
      const mostrouExpirou = /sess[aã]o expirou/i.test(txt || '')
      console.log(`B) refresh bloqueado → "Sua sessão expirou" visível=${mostrouExpirou}`)
      if (!mostrouExpirou) { falhas++; console.error('   ✗ esperava a tela "Sua sessão expirou" (nunca dashboard vazio)') }
      else console.log('   ✓ refresh falho → login, nunca visitante')
      await ctx.close()
    }
  } finally {
    await browser.close()
  }
  console.log(falhas === 0 ? '\nPROVA MOBILE AUTH: OK' : `\nPROVA MOBILE AUTH: ${falhas} falha(s)`)
  process.exit(falhas === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
