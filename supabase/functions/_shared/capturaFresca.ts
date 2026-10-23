// Auditor PDCA (Eng. Chefe 23/10, msg 6fd7cc9d item 1) — o insight-auditor julgava FOTO VELHA.
// Prova no dado (RD-38): a análise de /dashboard/projetos/mao-obra das 23/10 19:30:18 usou o print de 19/10 14:11
// ("Carregando menu…"), enquanto o print novo (19:30:09, empresa DEMO selecionada) já existia segundos depois.
// Causa: fn_auditor_disparar dispara o Playwright E o insight-auditor AO MESMO TEMPO; o insight lia
// system_screens.screenshot_url antes da captura nova terminar → falso-negativo ("Selecione empresa").
// Regra única (sem APIs do Deno — o gate do build importa e testa este arquivo): para uma rota pedida, a foto só
// vale se foi capturada a partir de (início do pedido − folga). A folga cobre quem captura ANTES e analisa depois.

export const FOLGA_CAPTURA_MS = 120_000 // captura de até 2 min antes do pedido conta como da mesma rodada
export const ESPERA_CAPTURA_MS = 80_000 // o Playwright do disparo tem 90 s; a análise roda depois disso
export const INTERVALO_CAPTURA_MS = 3_000

export function capturaFresca(
  atualizadoEm: string | null | undefined,
  inicioPedidoMs: number,
  folgaMs: number = FOLGA_CAPTURA_MS,
): boolean {
  if (!atualizadoEm) return false
  const t = Date.parse(atualizadoEm)
  if (!Number.isFinite(t)) return false
  return t >= inicioPedidoMs - folgaMs
}
