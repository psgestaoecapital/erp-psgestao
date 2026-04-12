import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

export async function GET() {
  try {
    // Load all system context in parallel
    const [empresasRes, modulosRes, planosRes, assessoriasRes, usersRes] = await Promise.all([
      supabase.from('empresas').select('id, nome, cnpj, regime_tributario').order('nome'),
      supabase.from('modulos_sistema').select('*').order('nome'),
      supabase.from('planos_licenca').select('*'),
      supabase.from('assessorias').select('id, nome, plano').order('nome'),
      supabase.from('users').select('id, email, role').limit(50),
    ])

    // Count lancamentos
    const { count: lancCount } = await supabase.from('lancamentos').select('*', { count: 'exact', head: true })

    const context = {
      versao: 'v8.1.0',
      stack: 'Next.js 16.2.2 + Supabase + Anthropic Claude + Vercel',
      empresas: empresasRes.data || [],
      total_empresas: (empresasRes.data || []).length,
      total_lancamentos: lancCount || 0,
      modulos_sistema: (modulosRes.data || []).map((m: any) => m.nome),
      planos: (planosRes.data || []).map((p: any) => ({ nome: p.nome, preco: p.preco_mensal })),
      assessorias: (assessoriasRes.data || []).length,
      usuarios: (usersRes.data || []).length,
      modulos_menu: [
        { id: 'dashboard', nome: 'Visao Diaria', desc: 'Dashboard executivo com resumo de receitas, despesas, saldo e indicadores principais' },
        { id: 'dados', nome: 'Dados', desc: 'Listagem completa de lancamentos financeiros com filtros por empresa, periodo, tipo e busca. Cards de resumo com receitas, despesas e saldo' },
        { id: 'rateio', nome: 'Rateio', desc: 'Distribuicao de custos indiretos entre linhas de negocio ou centros de custo usando criterios como faturamento, area ou headcount' },
        { id: 'orcamento', nome: 'Orcamento', desc: 'Previsoes mensais por categoria com comparacao automatica realizado vs orcado, variacao percentual e semaforos' },
        { id: 'ficha-tecnica', nome: 'Ficha Tecnica', desc: 'Composicao de custo de cada produto ou servico: materiais, mao de obra, overhead. Para precificacao e analise de margem' },
        { id: 'viabilidade', nome: 'Viabilidade', desc: 'Analise de viabilidade economica de projetos, produtos ou investimentos com TIR, VPL e payback' },
        { id: 'ajuda', nome: 'PS Ajuda', desc: 'Central de ajuda inteligente com IA, FAQ, guias interativos e explorador de modulos' },
        { id: 'industrial', nome: 'Industrial', desc: 'Modulo para frigorificos e industrias: OEE, rendimento e perdas, UEP, KPIs industriais por setor (abate, desossa, embalagem, expedicao)' },
        { id: 'custo', nome: 'Custo', desc: 'Analise de custos em 13 grupos padrao com comparacao realizado vs orcado e semaforos verde/amarelo/vermelho' },
        { id: 'anti-fraude', nome: 'Anti-Fraude', desc: 'Deteccao de anomalias: duplicatas, valores redondos suspeitos, lancamentos em fds, sem descricao, outliers' },
        { id: 'operacional', nome: 'Operacional', desc: 'Gestao operacional do dia a dia com indicadores de produtividade e eficiencia' },
        { id: 'importar', nome: 'Importar', desc: 'Upload de CSV e OFX em 3 passos: selecao do arquivo, mapeamento de colunas (auto-detect) e importacao com resultado' },
        { id: 'noc', nome: 'NOC', desc: 'Centro de operacoes e monitoramento do sistema, status dos modulos e integridade dos dados' },
        { id: 'wealth', nome: 'PS Wealth', desc: 'Plataforma Multi Family Office: gestao de portfolios, AUM, alocacao por classe de ativo, clientes e performance' },
        { id: 'consultor-ia', nome: 'Consultor IA', desc: 'Assistente inteligente que analisa dados financeiros e gera insights: alertas criticos, atencao e oportunidades' },
        { id: 'contador', nome: 'Contador', desc: 'Portal para contadores parceiros com acesso aos dados fiscais e contabeis dos clientes' },
        { id: 'assessor', nome: 'PS Assessor', desc: 'SaaS white-label para assessorias: diagnostico inteligente, plano de acao monitorado, dashboard CEO. Planos: Starter R$497, Pro R$1.497, Enterprise R$3.497' },
      ],
      timestamp: new Date().toISOString(),
    }

    return NextResponse.json(context)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}