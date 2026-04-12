import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const { diagnostico, cliente_nome, assessoria_nome } = await req.json()
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) return NextResponse.json({ error: 'API key missing' }, { status: 500 })

    const prompt = `Voce e um consultor empresarial senior do PS Assessor.
Analise o diagnostico abaixo e gere um parecer executivo para o assessor apresentar ao cliente.

Cliente: ${cliente_nome || 'N/I'}
Assessoria: ${assessoria_nome || 'PS Assessor'}

Dados do diagnostico:
${JSON.stringify(diagnostico, null, 2)}

Gere um parecer com:
1. RESUMO EXECUTIVO (3-4 linhas)
2. TOP 3 PONTOS CRITICOS (com numero e impacto estimado)
3. TOP 3 OPORTUNIDADES (com acao especifica e prazo sugerido)
4. RECOMENDACAO PRIORITARIA (1 acao que mais impacta o resultado)

Seja direto, use numeros, sem enrolacao. Portugues brasileiro.`

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1200, messages: [{ role: 'user', content: prompt }] }),
    })
    if (!response.ok) throw new Error('API ' + response.status)
    const data = await response.json()
    const reply = data.content?.map((c: any) => c.text || '').join('') || 'Sem resposta'
    return NextResponse.json({ parecer: reply })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro' }, { status: 500 })
  }
}