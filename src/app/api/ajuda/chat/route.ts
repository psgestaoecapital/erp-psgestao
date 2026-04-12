import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const { message, history, context } = await req.json()
    if (!message) return NextResponse.json({ error: 'message obrigatoria' }, { status: 400 })

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY nao configurada' }, { status: 500 })

    const systemPrompt = `Voce e o PS Ajuda, assistente inteligente do ERP PS Gestao v8.1.0.
Conhece TODOS os modulos em detalhes. Responda em portugues, de forma pratica e direta.

ESTADO DO SISTEMA: ${JSON.stringify(context || {}, null, 0)}

MODULOS DO ERP:

VISAO DIARIA (/dashboard) - Dashboard executivo: receitas, despesas, saldo, KPIs.

DADOS (/dashboard/dados) - Lancamentos financeiros. Filtros: empresa, periodo, tipo, busca. Cards resumo no topo.

RATEIO (/dashboard/rateio) - Distribui custos indiretos entre linhas de negocio por criterios (faturamento, area, headcount).

ORCAMENTO (/dashboard/orcamento) - Previsoes mensais por categoria. Compara previsto vs realizado com semaforos.

FICHA TECNICA (/dashboard/ficha-tecnica) - Composicao de custo unitario: materiais, mao de obra, overhead.

VIABILIDADE (/dashboard/viabilidade) - Analise de investimentos: TIR, VPL, payback.

INDUSTRIAL (/dashboard/industrial) - Para frigorificos: OEE, rendimento/perdas, UEP, KPIs por setor. Suinos, bovinos, aves.

CUSTO (/dashboard/custo) - 13 grupos de custo. Realizado vs orcado com semaforos. % do total.

ANTI-FRAUDE (/dashboard/anti-fraude) - Detecta: duplicatas, valores redondos >R$10K, lancamentos em fds, sem descricao, outliers (>3x media).

OPERACIONAL (/dashboard/operacional) - Gestao operacional, produtividade e eficiencia.

IMPORTAR (/dashboard/importar) - Upload CSV/OFX em 3 passos: selecao, mapeamento automatico de colunas, importacao.

NOC (/dashboard/noc) - Monitoramento do sistema e integridade dos dados.

WEALTH (/dashboard/wealth) - Multi Family Office: AUM, portfolios, alocacao por classe, clientes. 3 abas.

CONSULTOR IA (/dashboard/consultor-ia) - IA que analisa dados e gera alertas criticos, atencao e oportunidades.

CONTADOR (/dashboard/contador) - Portal para contadores parceiros.

PS ASSESSOR (/dashboard/assessor) - SaaS white-label para assessorias. Diagnostico inteligente, plano de acao. Starter R$497, Pro R$1.497, Enterprise R$3.497.

ADMIN (/dashboard/admin) - Gestao de empresas, usuarios, permissoes. So admin.

DEV (/dashboard/dev) - Chat Dev, Deploy, SQL Editor. So admin/dev.

REGRAS:
- Respostas curtas e praticas (max 200 palavras)
- Use passos numerados quando explicar processos
- Nunca invente funcionalidades
- Sugira modulos relacionados quando relevante
- Se nao souber, diga que vai verificar`

    const messages = [
      ...(history || []).slice(-8).map((h: any) => ({ role: h.role, content: h.content })),
      { role: 'user' as const, content: message }
    ]

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 800,
        system: systemPrompt,
        messages,
      }),
    })

    if (!response.ok) throw new Error('API: ' + (await response.text()).substring(0, 100))
    const data = await response.json()
    const reply = data.content?.map((c: any) => c.text || '').join('') || 'Sem resposta'
    return NextResponse.json({ reply })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erro'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}