import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/withAuth'
import { callAI } from '@/lib/aiProvider'

export const POST = withAuth(async (req: NextRequest, { userId }) => {
  const { dados, prompt, empresaId } = await req.json()

  if (!dados || !prompt) {
    return NextResponse.json({ error: 'dados e prompt são obrigatórios' }, { status: 400 })
  }

  try {
    const result = await callAI({
      system: 'Você é o Consultor IA do PS Gestão, especialista em análise financeira e gestão empresarial. Responda sempre em português, com linguagem executiva, objetiva e orientada a ação.',
      prompt: prompt + '\n\nDados financeiros:\n' + JSON.stringify(dados, null, 2),
      maxTokens: 2048,
    })

    return NextResponse.json({
      analise: result.text,
      provider: result.provider,
      fallback: result.fallback,
    })
  } catch (err: any) {
    console.error('[AI Analise]', err.message)
    return NextResponse.json(
      { error: err.message ?? 'Erro na análise de IA' },
      { status: 503 }
    )
  }
})
