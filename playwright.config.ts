// Revenda R1b · jornadas Playwright ("clicar, salvar, conferir no banco").
// Dois viewports (celular 390×844 · computador 1440×900). Serial (a demo é compartilhada; cada jornada
// prepara seu próprio estado). Login do bot no global-setup; fn_demo_reset no global-teardown.

import { defineConfig, devices } from '@playwright/test'
import { BASE_URL } from './e2e/support/api'
import { STORAGE_STATE } from './e2e/global-setup'

export default defineConfig({
  testDir: './e2e/jornadas',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    baseURL: BASE_URL,
    storageState: STORAGE_STATE,
    ignoreHTTPSErrors: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'celular', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } } },
    { name: 'computador', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
  ],
})
