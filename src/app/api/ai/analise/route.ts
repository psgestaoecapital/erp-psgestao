import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/withAuth'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

export const POST = withAuth(async (req: NextRequest, { user }) => {
  const { dados, prompt, empresaId } = await req.json()

  if (!dados || !prompt) {
    return NextResponse.json({ error: 'dados e prompt são obrigatórios' }, { status: 400 })
  }

  try {
    const response = await anthropic.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 2048,
      system: 'Você é o Consultor IA do PS Gestão, especialista em análise financeira e gestão empresarial. Responda sempre em português, com linguagem executiva, objetiva e orientada a ação.',
      messages: [
        {
          role: 'user',
          content: `${prompt}\n\nDados financeiros:\n${JSON.stringify(dados, null, 2)}`
        }
      ]
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    return NextResponse.json({ analise: text, tokens: response.usage })
  } catch (err: any) {
    console.error('[AI Analise] Erro:', err.message)
    return NextResponse.json({ error: 'Erro na análise de IA' }, { status: 500 })
  }
})
