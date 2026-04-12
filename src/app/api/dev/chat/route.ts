import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { messages, system } = await req.json();
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: 'messages obrigatorio' }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY nao configurada' }, { status: 500 });

    const systemPrompt = system || `Voce e o assistente de desenvolvimento do ERP PS Gestao.
Stack: Next.js 16 + Supabase + Vercel + Anthropic Claude API.
Repo: psgestaoecapital/erp-psgestao (branch main).
Identidade visual: Espresso #3D2314, Dourado #C8941A, Off-white #FAF7F2.
Deploy: via API GitHub → Vercel auto-rebuild.

Modulos: Visao Diaria, Dados, Rateio, Orcamento, Ficha Tecnica, Viabilidade, Ajuda, Industrial, Custo, Anti-Fraude, Operacional, Importar, NOC, Wealth, Consultor IA, Contador, Admin, Dev, PS Assessor.

Responda em portugues. Seja direto e tecnico. Quando gerar codigo, use o padrao do projeto:
- APIs: import createClient from @supabase/supabase-js + SUPABASE_SERVICE_ROLE_KEY
- Pages: use client com useState/useEffect
- Sem createRouteHandlerClient (nao funciona no projeto)`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: systemPrompt,
        messages
      })
    });

    if (!response.ok) {
      const err = await response.json();
      // Fallback to Gemini
      const geminiKey = process.env.GOOGLE_AI_API_KEY;
      if (geminiKey && (response.status === 429 || response.status === 503)) {
        const geminiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: messages.map((m: any) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
              systemInstruction: { parts: [{ text: systemPrompt }] }
            })
          }
        );
        if (geminiRes.ok) {
          const geminiData = await geminiRes.json();
          const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || 'Sem resposta do Gemini';
          return NextResponse.json({ content: text, model: 'gemini-2.0-flash', fallback: true });
        }
      }
      return NextResponse.json({ error: err.error?.message || 'Erro na API Claude' }, { status: response.status });
    }

    const data = await response.json();
    const text = data.content?.map((c: any) => c.text || '').join('') || '';
    return NextResponse.json({ content: text, model: data.model, usage: data.usage });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Erro interno' }, { status: 500 });
  }
}
