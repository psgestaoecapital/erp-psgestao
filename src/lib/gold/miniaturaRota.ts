import type { Page } from 'playwright-core'
import type { SupabaseClient } from '@supabase/supabase-js'

// Miniatura da foto da tela, em base64, gravada na própria captura. O aud8 (Max) lê por SELECT
// (fn_screenshot_thumb), sem HTTPS para o storage. Sem biblioteca de imagem: o Page.captureScreenshot
// do CDP escala a saída (clip.scale) e não mexe no viewport nem no layout da página.
export const MINIATURA_LARGURA = 480
export const MINIATURA_LIMITE_B64 = 120 * 1024
const VIEWPORT_LARGURA = 1280

// Devolve o JPEG em base64 da página inteira (a mesma faixa da captura cheia, já escalada para a largura
// da miniatura), ou null se nem a qualidade mais baixa cabe no limite.
export async function gerarMiniaturaBase64(page: Page, alturaCaptura: number): Promise<string | null> {
  const cdp = await page.context().newCDPSession(page)
  try {
    for (const quality of [60, 45]) {
      const { data } = await cdp.send('Page.captureScreenshot', {
        format: 'jpeg',
        quality,
        clip: { x: 0, y: 0, width: VIEWPORT_LARGURA, height: alturaCaptura, scale: MINIATURA_LARGURA / VIEWPORT_LARGURA },
        captureBeyondViewport: true,
      })
      if (data.length <= MINIATURA_LIMITE_B64) return data
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
