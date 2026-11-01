// Empresa de DEMONSTRAÇÃO que o robô Gold (/api/gold/auditar-rota) abre para cada rota — regra pura, testada no gate
// scripts/gates/check-gold-auditar-rota-grava.ts. INCIDENTE LGPD 20/09 (0e8add26): o default NUNCA é empresa real;
// cada vertical aponta para a sua demo (is_demo) e quem libera de fato é empresaPermitidaParaRobo (fail-closed).
// P0 Gold 24/10: o Hub (/dashboard/projetos) caía no default (Comércio GE) e o robô via custo R$ 0 e listas vazias;
// agora abre a Construtora Modelo DEMO, onde está a semente do Hub (fn_demo_seed_construtora).

export const EMPRESA_BOT_OFICINA = 'b0700000-0000-4000-a000-000000000001' // Demonstração · Oficina
export const EMPRESA_BOT_PM = 'b0700000-0000-4000-a000-000000000002' // Demonstração · Agência (P&M)
export const EMPRESA_BOT_REVENDA = 'b0700000-0000-4000-a000-000000000003' // Demonstração · Revenda
export const EMPRESA_BOT_GE = 'b0700000-0000-4000-a000-000000000004' // Demonstração · Comércio (GE) — default geral
export const EMPRESA_BOT_CONSTRUTORA = 'b0700000-0000-4000-a000-000000000006' // Construtora Modelo - DEMO (Hub)

export type VerticalBot = 'oficina' | 'pm' | 'revenda' | 'hub' | 'geral'

const ehRotaOuFilha = (rota: string, base: string) => rota === base || rota.startsWith(`${base}/`) || rota.startsWith(`${base}?`)

export function verticalDaRota(rota: string): VerticalBot {
  if (ehRotaOuFilha(rota, '/dashboard/oficina')) return 'oficina'
  if (ehRotaOuFilha(rota, '/dashboard/pm') || rota === '/dashboard/producao') return 'pm'
  if (ehRotaOuFilha(rota, '/dashboard/revenda')) return 'revenda'
  if (ehRotaOuFilha(rota, '/dashboard/projetos')) return 'hub'
  return 'geral'
}

export function empresaBotDaRota(rota: string): string {
  switch (verticalDaRota(rota)) {
    case 'oficina': return EMPRESA_BOT_OFICINA
    case 'pm': return EMPRESA_BOT_PM
    case 'revenda': return EMPRESA_BOT_REVENDA
    case 'hub': return EMPRESA_BOT_CONSTRUTORA
    default: return EMPRESA_BOT_GE
  }
}
