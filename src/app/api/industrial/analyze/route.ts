import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const { kpis, especie, cargo } = await req.json()
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) return NextResponse.json({ error: 'API key missing' }, { status: 500 })

    const prompt = `Voce e um consultor industrial senior especializado em agroindustria (frigorificos, laticinios, processados).
Analise os KPIs abaixo e gere:
1. TOP 5 alertas criticos (emoji vermelho, titulo curto, explicacao de 1 linha, acao sugerida)
2. TOP 5 oportunidades de melhoria (emoji verde, titulo, explicacao, acao)  
3. TOP 3 cruzamentos inteligentes entre areas (ex: "Alta energia + Baixo OEE = equipamento rodando vazio")

Especie: ${especie} | Nivel: ${cargo}

KPIs:
${JSON.stringify(kpis, null, 0)}

Responda APENAS em JSON valido sem markdown:
{"alertas":[{"icone":"emoji","titulo":"...","desc":"...","acao":"..."}],"oportunidades":[{"icone":"emoji","titulo":"...","desc":"...","acao":"..."}],"cruzamentos":[{"titulo":"...","desc":"...","impacto":"..."}]}`

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1500, messages: [{ role: 'user', content: prompt }] }),
    })
    if (!response.ok) throw new Error('API ' + response.status)
    const data = await response.json()
    const text = data.content?.map((c: any) => c.text || '').join('') || '{}'
    const clean = text.replace(/\`\`\`json|\n|\`\`\`/g, '').trim()
    const parsed = JSON.parse(clean)
    return NextResponse.json(parsed)
  } catch (err: unknown) {
    return NextResponse.json({ alertas: [], oportunidades: [], cruzamentos: [], error: err instanceof Error ? err.message : 'Erro' }, { status: 200 })
  }
}