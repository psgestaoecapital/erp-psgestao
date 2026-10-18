// Revenda R1b · jornadas Playwright ("clicar, salvar, conferir no banco").
// Dois viewports (celular 390×844 · computador 1440×900). Serial (a demo é compartilhada; cada jornada
// prepara seu próprio estado). Login do bot no global-setup; fn_demo_reset no global-teardown.

import { defineConfig, devices } from '@playwright/test'
import { BASE_URL } from './e2e/support/api'
import { STORAGE_STATE } from './e2e/global-setup'
import { specsEmQuarentena } from './e2e/quarentena'

export default defineConfig({
  testDir: './e2e/jornadas',
  // Quarentena (CEO 10/10): specs postos em quarentena pelo detector (scripts/merge/quarentena-detectar.ts) não rodam
  // — o arquivo continua no repo, só sai da execução enquanto o Code dono conserta. Lista viva em e2e/quarentena.ts.
  testIgnore: specsEmQuarentena(),
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  // CEO/Eng. Chefe 18/10: o [celular] falhava aleatoriamente com "Target page, context or browser has been closed"
  // (Chromium morto no runner). Na CI cada teste ganha uma 2ª retentativa; falha real continua falhando nas 3.
  retries: process.env.CI ? 2 : 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    baseURL: BASE_URL,
    storageState: STORAGE_STATE,
    ignoreHTTPSErrors: true,
    // /dev/shm de 64 MB do runner derruba o Chromium ("browser has been closed"): usa /tmp em vez de memória compartilhada.
    launchOptions: { args: ['--disable-dev-shm-usage'] },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // RD-78: preview da Vercel com Deployment Protection responde 401 ao robô; o bypass oficial é este header.
    // (o global-setup não abre navegador — loga na Supabase e grava o storageState —, então só o `use` precisa disto.)
    ...(process.env.VERCEL_AUTOMATION_BYPASS_SECRET
      ? { extraHTTPHeaders: { 'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET, 'x-vercel-set-bypass-cookie': 'true' } }
      : {}),
  },
  projects: [
    { name: 'celular', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } } },
    { name: 'computador', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
  ],
})
