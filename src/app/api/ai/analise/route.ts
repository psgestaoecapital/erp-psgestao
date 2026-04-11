import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/withAuth'

export const POST = withAuth(async (req: NextRequest, { userId }) => {
  const { dados, prompt } = await req.json()
  if (!dados || !prompt) return NextResponse.json({ error: 'dados e prompt obrigatórios' }, { status: 400 })

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-5',
      max_tokens: 2048,
      system: 'Você é o Consultor IA do PS Gestão, especialista em análise financeira. Responda em português, linguagem executiva e orientada a ação.',
      messages: [{ role: 'user', content: `${prompt}\n\nDados:\n${JSON.stringify(dados, null, 2)}` }]
    })
  })

  if (!res.ok) return NextResponse.json({ error: 'Erro na API de IA' }, { status: 500 })
  const json = await res.json()
  const text = json.content?.[0]?.text ?? ''
  return NextResponse.json({ analise: text })
})
