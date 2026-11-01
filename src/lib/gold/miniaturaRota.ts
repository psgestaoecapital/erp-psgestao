import type { Page } from 'playwright-core'
import type { SupabaseClient } from '@supabase/supabase-js'

// Miniatura da foto da tela, em base64, gravada na própria captura. O aud8 (Max) lê por SELECT
// (fn_screenshot_thumb), sem HTTPS para o storage. Sem biblioteca de imagem: o Page.captureScreenshot
// do CDP escala a saída (clip.scale) e não mexe no viewport nem no layout da página.
export const MINIATURA_LARGURA = 480
export const MINIATURA_LIMITE_B64 = 120 * 1024
const VIEWPORT_LARGURA = 1280
// Altura mínima do recorte da miniatura (em px de página) e as frações da altura de captura que
// tentamos, da maior para a menor. Uma página muito longa (ex.: /dashboard/pm/agenda) gera base64
// acima do limite mesmo na menor qualidade; antes disso fazia gerarMiniaturaBase64 devolver null e a
// thumb NUNCA era regravada (ficava velha, sem erro). Reduzir a ALTURA do recorte até caber é melhor:
// a miniatura é só prévia, e mostrar o topo fresco vence uma thumb antiga de outro dia.
export const MINIATURA_ALTURA_MIN = 400
const MINIATURA_ALTURA_FRACOES = [1, 0.6, 0.4, 0.25, 0.15]

// Devolve o JPEG em base64 da página (escalado para a largura da miniatura). Tenta a altura inteira
// primeiro e, se não couber no limite, vai reduzindo a altura do recorte (e a qualidade) até caber.
// Só devolve null se nem o menor recorte na menor qualidade couber.
export async function gerarMiniaturaBase64(page: Page, alturaCaptura: number): Promise<string | null> {
  const cdp = await page.context().newCDPSession(page)
  try {
    let ultimaAltura = -1
    for (const frac of MINIATURA_ALTURA_FRACOES) {
      const height = Math.max(MINIATURA_ALTURA_MIN, Math.round(alturaCaptura * frac))
      if (height === ultimaAltura) continue // já no piso: não repetir o mesmo recorte
      ultimaAltura = height
      for (const quality of [60, 45]) {
        const { data } = await cdp.send('Page.captureScreenshot', {
          format: 'jpeg',
          quality,
          clip: { x: 0, y: 0, width: VIEWPORT_LARGURA, height, scale: MINIATURA_LARGURA / VIEWPORT_LARGURA },
          captureBeyondViewport: true,
        })
        if (data.length <= MINIATURA_LIMITE_B64) return data
      }
    }
    return null
  } finally {
    await cdp.detach().catch(() => {})
  }
}

// Grava (upsert por rota) a miniatura. Devolve false quando não coube no limite (nada é gravado).
export async function salvarMiniaturaRota(
  supabase: SupabaseClient,
  rota: string,
  page: Page,
  alturaCaptura: number,
): Promise<boolean> {
  const b64 = await gerarMiniaturaBase64(page, alturaCaptura)
  if (!b64) return false
  const { error } = await supabase
    .from('erp_screen_thumb')
    .upsert({ rota, thumb_b64: b64, atualizado_em: new Date().toISOString() }, { onConflict: 'rota' })
  if (error) throw new Error('miniatura não gravada: ' + error.message)
  return true
}
