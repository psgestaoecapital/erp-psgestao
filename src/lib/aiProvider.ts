/**
 * aiProvider.ts — PS Gestão v1.0
 * Multi-provider IA com fallback automático.
 * Primário: Anthropic Claude
 * Fallback: Google Gemini 2.0 Flash
 */

export interface AIRequest {
  system: string
  prompt: string
  maxTokens?: number
}

export interface AIResponse {
  text: string
  provider: 'anthropic' | 'gemini'
  fallback: boolean
  tokens?: number
}

// ── Anthropic ────────────────────────────────────────────────
async function callAnthropic(req: AIRequest): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: req.maxTokens ?? 2048,
      system: req.system,
      messages: [{ role: 'user', content: req.prompt }],
    }),
    signal: AbortSignal.timeout(30000),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error('Anthropic ' + res.status + ': ' + (err.error?.message ?? res.statusText))
  }

  const data = await res.json()
  return data.content?.[0]?.text ?? ''
}

// ── Gemini ───────────────────────────────────────────────────
async function callGemini(req: AIRequest): Promise<string> {
  const apiKey = process.env.GOOGLE_AI_API_KEY
  if (!apiKey) throw new Error('GOOGLE_AI_API_KEY não configurada')

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + apiKey

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: req.system }] },
      contents: [{ parts: [{ text: req.prompt }] }],
      generationConfig: { maxOutputTokens: req.maxTokens ?? 2048 },
    }),
    signal: AbortSignal.timeout(30000),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error('Gemini ' + res.status + ': ' + (err.error?.message ?? res.statusText))
  }

  const data = await res.json()
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
}

// ── Circuit breaker principal ─────────────────────────────────
export async function callAI(req: AIRequest): Promise<AIResponse> {
  // Tenta Anthropic primeiro
  try {
    const text = await callAnthropic(req)
    return { text, provider: 'anthropic', fallback: false }
  } catch (err: any) {
    const msg = err.message ?? ''
    const shouldFallback =
      msg.includes('429') ||
      msg.includes('503') ||
      msg.includes('timeout') ||
      msg.includes('overloaded') ||
      msg.includes('AbortError')

    if (!shouldFallback) throw err

    console.warn('[aiProvider] Anthropic indisponível, ativando Gemini:', msg)
  }

  // Aguarda 2s e tenta Gemini
  await new Promise(r => setTimeout(r, 2000))
  try {
    const text = await callGemini(req)
    return { text, provider: 'gemini', fallback: true }
  } catch (err: any) {
    throw new Error('Ambos os providers falharam. Anthropic e Gemini indisponíveis. Tente novamente em instantes.')
  }
}
