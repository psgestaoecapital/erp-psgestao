import type { Page } from 'playwright-core'

// INCIDENTE LGPD 20/09 (0e8add26): a trava do #1594 conferia a empresa PEDIDA, não a RENDERIZADA.
// Aqui o auditor lê, no navegador, a empresa EFETIVAMENTE renderizada (marcador __psEmpresaEfetiva,
// setado por useCompanyIds) ANTES de fotografar. Bloqueia se a tela estiver em modo grupo/consolidado
// ("Todas as Empresas") ou se a empresa renderizada divergir da pedida (robô não-membro → fallback).
// Fail-closed só quando o marcador EXISTE e acusa problema; página que não escopa por empresa passa.

export type CheckRender = { ok: boolean; motivo?: string; efetiva?: string | null; isGroup?: boolean }

type Marcador = { pedida?: string; efetiva?: string; isGroup?: boolean; divergiu?: boolean; nome?: string }

export async function conferirEmpresaRenderizada(page: Page, empresaPedida?: string | null): Promise<CheckRender> {
  const marca = await page.evaluate(() => {
    const m = (window as unknown as { __psEmpresaEfetiva?: Marcador }).__psEmpresaEfetiva
    return m ?? null
  }) as Marcador | null

  // Página que não usa useCompanyIds não escopa dados por empresa → não há vazamento cross-empresa aqui.
  if (!marca) return { ok: true }

  if (marca.isGroup) {
    return { ok: false, isGroup: true, efetiva: marca.efetiva ?? null,
      motivo: `render em modo grupo/consolidado ("${marca.nome || 'Todas as Empresas'}") — fotografaria várias empresas` }
  }
  if (marca.divergiu) {
    return { ok: false, efetiva: marca.efetiva ?? null,
      motivo: `empresa renderizada diverge da pedida (robô não é membro → fallback consolidado)` }
  }
  if (empresaPedida && marca.efetiva && marca.efetiva !== empresaPedida) {
    return { ok: false, efetiva: marca.efetiva,
      motivo: `empresa renderizada (${marca.efetiva}) ≠ pedida (${empresaPedida})` }
  }
  return { ok: true, efetiva: marca.efetiva ?? null }
}
