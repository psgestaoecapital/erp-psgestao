// src/app/api/dashboard/universal/route.ts
// Dashboard universal — serve todos os planos (Comércio, Industrial, Agro, BPO, P&M)
// Aceita: company_id único, múltiplos company_ids, ou grupo_id
// Período configurável via query param

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { withAuth } from '@/lib/withAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

async function handler(req: NextRequest, user: any) {
  try {
    const { searchParams } = new URL(req.url);
    const plano = searchParams.get('plano') || 'comercio';
    const grupoId = searchParams.get('grupo_id');
    const companyIdsParam = searchParams.get('company_ids'); // "uuid1,uuid2,uuid3"
    const companyIdParam = searchParams.get('company_id');
    const periodo = searchParams.get('periodo') || 'mes'; // hoje | sem | mes | tri | 6m | ano
    const anoParam = searchParams.get('ano');
    const mesParam = searchParams.get('mes');
    const regime = (searchParams.get('regime') || 'competencia') as 'competencia' | 'caixa';
    
    const supabase = supabaseAdmin;
    
    // Resolve company_ids a partir do input (grupo_id, company_ids, ou company_id único)
    let companyIds: string[] = [];
    let nomeContexto = '';
    
    if (grupoId) {
      const { data: empresas } = await supabase
        .from('dashboard_grupos_empresas')
        .select('company_id, companies:companies(nome_fantasia)')
        .eq('grupo_id', grupoId);
      companyIds = (empresas || []).map((e: any) => e.company_id);
      const { data: grupo } = await supabase
        .from('dashboard_grupos')
        .select('nome')
        .eq('id', grupoId)
        .maybeSingle();
      nomeContexto = grupo?.nome || 'Grupo';
    } else if (companyIdsParam) {
      companyIds = companyIdsParam.split(',').map(s => s.trim()).filter(Boolean);
      nomeContexto = `${companyIds.length} empresas`;
    } else if (companyIdParam) {
      companyIds = [companyIdParam];
      const { data: c } = await supabase
        .from('companies').select('nome_fantasia').eq('id', companyIdParam).maybeSingle();
      nomeContexto = c?.nome_fantasia || '';
    } else {
      // Busca grupo padrão do usuário
      const { data: grupoPadrao } = await supabase
        .from('dashboard_grupos')
        .select('id, nome, dashboard_grupos_empresas(company_id)')
        .eq('user_id', user.userId)
        .eq('is_padrao', true)
        .maybeSingle();
      if (grupoPadrao) {
        companyIds = (grupoPadrao.dashboard_grupos_empresas || []).map((e: any) => e.company_id);
        nomeContexto = grupoPadrao.nome;
      }
    }
    
    if (companyIds.length === 0) {
      return NextResponse.json({ 
        erro: 'Nenhuma empresa selecionada',
        requer_config: true 
      }, { status: 200 });
    }
    
    // Resolve período
    const { ano, mes, dataInicio, dataFim } = resolverPeriodo(periodo, anoParam, mesParam);
    
    // Fetch paralelo
    const [
      saudeRes,
      dreRes,
      topClientesRes,
      topFornRes,
      atalhosRes,
      fluxoRes,
      consultorRes,
      painelExecutivoRes
    ] = await Promise.all([
      supabase.rpc('fn_psgc_saude_consolidada', {
        p_company_ids: companyIds, p_ano: ano, p_mes: mes
      }),
      supabase.rpc('fn_psgc_dre_consolidada', {
        p_company_ids: companyIds, p_ano: ano, p_mes: mes
      }),
      supabase.rpc('fn_psgc_abc_consolidado', {
        p_company_ids: companyIds, p_ano: ano, p_tipo: 'cliente', p_limit: 5
      }),
      supabase.rpc('fn_psgc_abc_consolidado', {
        p_company_ids: companyIds, p_ano: ano, p_tipo: 'fornecedor', p_limit: 5
      }),
      buscarAtalhos(supabase, user.userId, plano),
      supabase.from('psgc_fluxo_realizado')
        .select('data, entradas, saidas, saldo_dia')
        .in('company_id', companyIds)
        .gte('data', dataInicio)
        .lte('data', dataFim)
        .order('data'),
      supabase.rpc('fn_consultor_insights_grupo', {
        p_company_ids: companyIds, p_ano: ano, p_mes: mes
      }),
      supabase.rpc('fn_psgc_painel_executivo', {
        p_company_ids: companyIds, p_ano: ano, p_mes: mes, p_regime: regime
      })
    ]);

    // Ações (BPO + boletos + recebíveis + compliance) consolidadas
    const acoes = await buscarAcoes(supabase, companyIds);

    // Saúde → frase humana
    const s = (saudeRes.data || [])[0];
    const fraseSaude = montarFraseSaude(s, companyIds.length);

    // Consultor IA — falha silenciosa pra não quebrar dashboard
    const consultorIA = consultorRes?.error ? null : (consultorRes?.data || null);

    // Painel Executivo — falha silenciosa
    const painelExecutivo = painelExecutivoRes?.error ? null : (painelExecutivoRes?.data || null);
    
    return NextResponse.json({
      contexto: {
        plano,
        nome: nomeContexto,
        company_ids: companyIds,
        qtd_empresas: companyIds.length,
        periodo,
        ano,
        mes,
        regime
      },
      camada1: {
        saude: {
          status: s?.saude_status || 'desconhecido',
          titulo: fraseSaude.titulo,
          frase: fraseSaude.frase,
          indicadores: {
            margem_bruta_pct: Number(s?.margem_bruta_pct) || 0,
            margem_contribuicao_pct: Number(s?.margem_contribuicao_pct) || 0,
            ebitda_pct: Number(s?.ebitda_pct) || 0,
            receita: Number(s?.receita) || 0,
            ebitda: Number(s?.ebitda) || 0
          }
        },
        acoes,
        futuro: {
          fluxo: fluxoRes.data || [],
          saldo_projetado_60d: calcularSaldo(fluxoRes.data || [])
        },
        consultor_ia: consultorIA,
        painel_executivo: painelExecutivo
      },
      camada2: {
        dre_nivel2: dreRes.data || [],
        top_clientes: topClientesRes.data || [],
        top_fornecedores: topFornRes.data || []
      },
      atalhos: atalhosRes
    });
  } catch (error: any) {
    console.error('[dashboard/universal] erro:', error);
    return NextResponse.json({ erro: error.message }, { status: 500 });
  }
}

function resolverPeriodo(periodo: string, anoParam: string | null, mesParam: string | null) {
  const hoje = new Date();
  let ano = anoParam ? parseInt(anoParam) : hoje.getFullYear();
  let mes = mesParam ? parseInt(mesParam) : hoje.getMonth() + 1;
  
  let dataInicio: string, dataFim: string;
  
  switch (periodo) {
    case 'hoje':
      dataInicio = dataFim = hoje.toISOString().split('T')[0];
      break;
    case 'sem':
      const diasDaSemana = hoje.getDay();
      const inicioSem = new Date(hoje.getTime() - diasDaSemana * 86400000);
      dataInicio = inicioSem.toISOString().split('T')[0];
      dataFim = hoje.toISOString().split('T')[0];
      break;
    case 'tri':
      const trimestre = Math.floor(hoje.getMonth() / 3);
      dataInicio = new Date(ano, trimestre * 3, 1).toISOString().split('T')[0];
      dataFim = new Date(ano, trimestre * 3 + 3, 0).toISOString().split('T')[0];
      break;
    case '6m':
      dataInicio = new Date(hoje.getTime() - 180 * 86400000).toISOString().split('T')[0];
      dataFim = hoje.toISOString().split('T')[0];
      break;
    case 'ano':
      dataInicio = `${ano}-01-01`;
      dataFim = `${ano}-12-31`;
      break;
    case 'mes':
    default:
      dataInicio = new Date(ano, mes - 1, 1).toISOString().split('T')[0];
      dataFim = new Date(ano, mes, 0).toISOString().split('T')[0];
      break;
  }
  
  return { ano, mes, dataInicio, dataFim };
}

async function buscarAtalhos(supabase: any, userId: string, plano: string) {
  // Custom do usuário tem prioridade; se não tem, herda default
  const { data: custom } = await supabase
    .from('dashboard_atalhos')
    .select('*')
    .eq('user_id', userId)
    .eq('plano', plano)
    .order('ordem');
  
  if (custom && custom.length > 0) return custom;
  
  const { data: defaults } = await supabase
    .from('dashboard_atalhos_default')
    .select('*')
    .eq('plano', plano)
    .order('ordem');
  
  return defaults || [];
}

async function buscarAcoes(supabase: any, companyIds: string[]) {
  const hoje = new Date().toISOString().split('T')[0];
  const em3Dias = new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0];
  
  const [boletos, recebiveis] = await Promise.all([
    supabase.from('erp_pagar')
      .select('id, fornecedor_nome, valor, data_vencimento, company_id')
      .in('company_id', companyIds)
      .gte('data_vencimento', hoje)
      .lte('data_vencimento', em3Dias)
      .neq('status', 'pago')
      .order('data_vencimento')
      .limit(20),
    supabase.from('erp_receber')
      .select('id, cliente_nome, valor, data_vencimento, company_id')
      .in('company_id', companyIds)
      .lt('data_vencimento', hoje)
      .neq('status', 'pago')
      .order('data_vencimento')
      .limit(20)
  ]);
  
  const acoes = [];
  if (boletos.data?.length) {
    const total = boletos.data.reduce((s: number, b: any) => s + Number(b.valor || 0), 0);
    acoes.push({
      id: 'boletos', severidade: 'critica', icone: 'calendar',
      titulo: `${boletos.data.length} boleto${boletos.data.length > 1 ? 's' : ''} vence${boletos.data.length === 1 ? '' : 'm'} em até 3 dias`,
      detalhe: `Total R$ ${fmt(total)} — ${boletos.data.slice(0,2).map((b: any) => b.fornecedor_nome).filter(Boolean).join(', ')}`,
      acao_url: '/financeiro/pagar?filter=vencendo', acao_label: 'Conferir'
    });
  }
  if (recebiveis.data?.length) {
    const total = recebiveis.data.reduce((s: number, r: any) => s + Number(r.valor || 0), 0);
    acoes.push({
      id: 'recebiveis', severidade: 'alta', icone: 'alert',
      titulo: `${recebiveis.data.length} recebíve${recebiveis.data.length > 1 ? 'is vencidos' : 'l vencido'}`,
      detalhe: `Total R$ ${fmt(total)} — ${recebiveis.data[0]?.cliente_nome || ''}${recebiveis.data.length > 1 ? ` +${recebiveis.data.length - 1}` : ''}`,
      acao_url: '/financeiro/receber?filter=vencido', acao_label: 'Cobrar'
    });
  }
  return acoes;
}

function montarFraseSaude(s: any, qtdEmpresas: number) {
  const prefixo = qtdEmpresas > 1 ? `Grupo com ${qtdEmpresas} empresas. ` : '';
  if (!s || !s.receita || Number(s.receita) === 0) {
    return { titulo: 'Sem dados no período', frase: prefixo + 'Nenhuma movimentação encontrada.' };
  }
  if (s.saude_status === 'critico') {
    return {
      titulo: 'Ação urgente',
      frase: `${prefixo}EBITDA negativo em R$ ${fmt(Math.abs(Number(s.ebitda)))} (${s.ebitda_pct}%). Margem de contribuição de ${s.margem_contribuicao_pct}% não cobre as despesas fixas de R$ ${fmt(Number(s.desp_fixa))}.`
    };
  }
  if (s.saude_status === 'atencao') {
    return {
      titulo: 'Atenção ao caixa',
      frase: `${prefixo}Margem operacional em ${s.ebitda_pct}%, abaixo do ideal. EBITDA de R$ ${fmt(Number(s.ebitda))} no período.`
    };
  }
  return {
    titulo: 'Sua empresa está saudável',
    frase: `${prefixo}Margem operacional em ${s.ebitda_pct}%. EBITDA de R$ ${fmt(Number(s.ebitda))} no período.`
  };
}

function fmt(v: number) {
  return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);
}

function calcularSaldo(fluxo: any[]) {
  return fluxo.reduce((sum, d) => sum + Number(d.saldo_dia || 0), 0);
}

export const GET = withAuth(handler);
