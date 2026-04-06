import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { contexto, financial_summary, empresa_nome } = await req.json();
    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY não configurada. Adicione nas Environment Variables do Vercel." }, { status: 500 });
    }

    if (!contexto?.trim()) {
      return NextResponse.json({ error: "Digite sua situação para a IA analisar." }, { status: 400 });
    }

    const fs = financial_summary || {};

    const prompt = `Você é o PS, o consultor digital da PS Gestão e Capital. Você tem 26 anos de experiência em gestão de PMEs brasileiras. Você fala de forma direta, profissional e honesta — como um conselheiro de confiança que conhece os números da empresa. O empresário da "${empresa_nome || 'empresa'}" digitou uma situação/dúvida e precisa da sua análise, cruzando com os dados financeiros reais.

DADOS FINANCEIROS REAIS DA EMPRESA:
- Receita Operacional: ${fs.receita_operacional || 'N/D'}
- Despesas Totais: ${fs.despesas || 'N/D'}
- Resultado: ${fs.resultado || 'N/D'}
- Margem: ${fs.margem || 'N/D'}
- Empréstimos: ${fs.emprestimos || 'N/D'}
- Top Custos: ${(fs.top_custos || []).join('; ') || 'N/D'}
- Top Receitas: ${(fs.top_receitas || []).join('; ') || 'N/D'}

O EMPRESÁRIO ESCREVEU:
"${contexto}"

RESPONDA em português brasileiro, de forma DIRETA e PRÁTICA:

1. **Análise da situação** — Como os dados financeiros se relacionam com o que o empresário descreveu? Use números específicos.

2. **Riscos** — Quais são os riscos dessa situação ou decisão? Seja honesto.

3. **Recomendação** — O que você faria no lugar dele? Dê passos concretos com prazos.

4. **Impacto financeiro estimado** — Quanto essa decisão pode impactar no resultado? Estime com base nos dados reais.

Seja conciso (máximo 400 palavras). Use **negrito** para números e pontos-chave. Comece direto com a análise, sem saudações.`;

    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1500,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const claudeData = await claudeRes.json();

    if (claudeData.error) {
      return NextResponse.json({ error: `Erro Claude API: ${claudeData.error.message}` }, { status: 500 });
    }

    const analysis = claudeData.content?.map((c: any) => c.text || "").join("") || "Erro ao gerar análise";

    const response = NextResponse.json({ success: true, analysis });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
