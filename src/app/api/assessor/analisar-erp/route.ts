import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function generateABC(items: { nome: string; valor: number }[]) {
  const sorted = [...items].sort((a, b) => b.valor - a.valor);
  const total = sorted.reduce((s, i) => s + i.valor, 0);
  if (total === 0) return null;
  let acum = 0;
  const result = sorted.map((item, idx) => {
    acum += item.valor;
    const pctAcum = (acum / total) * 100;
    const classificacao = pctAcum <= 80 ? 'A' : pctAcum <= 95 ? 'B' : 'C';
    return { posicao: idx + 1, nome: item.nome, valor: item.valor, pct: ((item.valor / total) * 100).toFixed(2), pct_acum: pctAcum.toFixed(2), classificacao };
  });
  return {
    dados: result, total_itens: result.length, total_valor: total,
    qtd_a: result.filter(r => r.classificacao === 'A').length,
    qtd_b: result.filter(r => r.classificacao === 'B').length,
    qtd_c: result.filter(r => r.classificacao === 'C').length,
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { diagnostico_id, empresa_id } = body;
    
    if (!diagnostico_id || !empresa_id) {
      return NextResponse.json({ error: 'diagnostico_id e empresa_id obrigatorios' }, { status: 400 });
    }

    // Verify diagnostico exists
    const { data: diag } = await supabase.from('diagnosticos').select('id, assessoria_id').eq('id', diagnostico_id).single();
    if (!diag) return NextResponse.json({ error: 'Diagnostico nao encontrado' }, { status: 404 });

    // Verify empresa exists
    const { data: empresa } = await supabase.from('empresas').select('id, nome, cnpj').eq('id', empresa_id).single();
    if (!empresa) return NextResponse.json({ error: 'Empresa nao encontrada no ERP' }, { status: 404 });

    const results: any = { empresa: empresa.nome, analises: [] };

    // =============================================
    // 1. FATURAMENTO — lancamentos tipo receita
    // =============================================
    const { data: lancamentos } = await supabase
      .from('lancamentos')
      .select('id, descricao, valor, data_competencia, data_vencimento, tipo, categoria, subcategoria, cliente_fornecedor, status, empresa_id')
      .eq('empresa_id', empresa_id)
      .neq('status', 'cancelado');

    if (lancamentos && lancamentos.length > 0) {
      // Separate receitas and despesas
      const receitas = lancamentos.filter(l => l.tipo === 'receita' || l.tipo === 'entrada');
      const despesas = lancamentos.filter(l => l.tipo === 'despesa' || l.tipo === 'saida');

      // ABC by cliente_fornecedor (receitas)
      if (receitas.length > 0) {
        const clienteMap: Record<string, number> = {};
        receitas.forEach(l => {
          const nome = l.cliente_fornecedor || l.descricao || 'Sem identificacao';
          clienteMap[nome] = (clienteMap[nome] || 0) + Math.abs(l.valor || 0);
        });
        const abcClientes = generateABC(Object.entries(clienteMap).map(([nome, valor]) => ({ nome, valor })));
        if (abcClientes) {
          await supabase.from('diagnostico_curvas_abc').insert({
            diagnostico_id, tipo: 'clientes', dados: abcClientes.dados,
            total_itens: abcClientes.total_itens, total_valor: abcClientes.total_valor,
            qtd_a: abcClientes.qtd_a, qtd_b: abcClientes.qtd_b, qtd_c: abcClientes.qtd_c
          });
          results.analises.push({ tipo: 'ABC Clientes', itens: abcClientes.total_itens, valor: abcClientes.total_valor, a: abcClientes.qtd_a, b: abcClientes.qtd_b, c: abcClientes.qtd_c });
        }
      }

      // ABC by fornecedor (despesas)
      if (despesas.length > 0) {
        const fornMap: Record<string, number> = {};
        despesas.forEach(l => {
          const nome = l.cliente_fornecedor || l.descricao || 'Sem identificacao';
          fornMap[nome] = (fornMap[nome] || 0) + Math.abs(l.valor || 0);
        });
        const abcForn = generateABC(Object.entries(fornMap).map(([nome, valor]) => ({ nome, valor })));
        if (abcForn) {
          await supabase.from('diagnostico_curvas_abc').insert({
            diagnostico_id, tipo: 'fornecedores', dados: abcForn.dados,
            total_itens: abcForn.total_itens, total_valor: abcForn.total_valor,
            qtd_a: abcForn.qtd_a, qtd_b: abcForn.qtd_b, qtd_c: abcForn.qtd_c
          });
          results.analises.push({ tipo: 'ABC Fornecedores', itens: abcForn.total_itens, valor: abcForn.total_valor, a: abcForn.qtd_a, b: abcForn.qtd_b, c: abcForn.qtd_c });
        }
      }

      // ABC by categoria (produtos/servicos)
      const catMap: Record<string, number> = {};
      receitas.forEach(l => {
        const nome = l.categoria || l.subcategoria || l.descricao || 'Sem categoria';
        catMap[nome] = (catMap[nome] || 0) + Math.abs(l.valor || 0);
      });
      const abcProd = generateABC(Object.entries(catMap).map(([nome, valor]) => ({ nome, valor })));
      if (abcProd) {
        await supabase.from('diagnostico_curvas_abc').insert({
          diagnostico_id, tipo: 'produtos', dados: abcProd.dados,
          total_itens: abcProd.total_itens, total_valor: abcProd.total_valor,
          qtd_a: abcProd.qtd_a, qtd_b: abcProd.qtd_b, qtd_c: abcProd.qtd_c
        });
        results.analises.push({ tipo: 'ABC Produtos/Categorias', itens: abcProd.total_itens, valor: abcProd.total_valor, a: abcProd.qtd_a, b: abcProd.qtd_b, c: abcProd.qtd_c });
      }

      // =============================================
      // 2. FATURAMENTO MENSAL
      // =============================================
      const faturamentoMensal: Record<string, { receita: number; despesa: number }> = {};
      lancamentos.forEach(l => {
        const data = l.data_competencia || l.data_vencimento;
        if (!data) return;
        const mes = data.substring(0, 7); // YYYY-MM
        if (!faturamentoMensal[mes]) faturamentoMensal[mes] = { receita: 0, despesa: 0 };
        if (l.tipo === 'receita' || l.tipo === 'entrada') {
          faturamentoMensal[mes].receita += Math.abs(l.valor || 0);
        } else {
          faturamentoMensal[mes].despesa += Math.abs(l.valor || 0);
        }
      });

      const meses = Object.keys(faturamentoMensal).sort();
      const dfclData = meses.map(mes => ({
        mes,
        receita: faturamentoMensal[mes].receita,
        despesa: faturamentoMensal[mes].despesa,
        resultado: faturamentoMensal[mes].receita - faturamentoMensal[mes].despesa,
        margem: faturamentoMensal[mes].receita > 0
          ? (((faturamentoMensal[mes].receita - faturamentoMensal[mes].despesa) / faturamentoMensal[mes].receita) * 100).toFixed(1)
          : '0.0'
      }));

      const totalReceita = receitas.reduce((s, l) => s + Math.abs(l.valor || 0), 0);
      const totalDespesa = despesas.reduce((s, l) => s + Math.abs(l.valor || 0), 0);

      results.faturamento = {
        total_receita: totalReceita,
        total_despesa: totalDespesa,
        resultado: totalReceita - totalDespesa,
        margem: totalReceita > 0 ? (((totalReceita - totalDespesa) / totalReceita) * 100).toFixed(1) : '0.0',
        media_mensal_receita: meses.length > 0 ? totalReceita / meses.length : 0,
        media_mensal_despesa: meses.length > 0 ? totalDespesa / meses.length : 0,
        meses: dfclData,
        total_lancamentos: lancamentos.length
      };

      results.analises.push({ tipo: 'DFCL', meses: meses.length, receita_total: totalReceita, despesa_total: totalDespesa, resultado: totalReceita - totalDespesa });
    }

    // =============================================
    // 3. SAVE FULL ANALYSIS TO DIAGNOSTICO
    // =============================================
    await supabase.from('diagnosticos').update({
      status: 'em_andamento',
      dados_importados: {
        fonte: 'erp_interno',
        empresa_id,
        empresa_nome: empresa.nome,
        empresa_cnpj: empresa.cnpj,
        data_analise: new Date().toISOString(),
        faturamento: results.faturamento || null,
        total_lancamentos: lancamentos?.length || 0
      },
      updated_at: new Date().toISOString()
    }).eq('id', diagnostico_id);

    // Save as import record
    await supabase.from('diagnostico_imports').insert({
      diagnostico_id,
      tipo_arquivo: 'erp_interno' as any,
      nome_arquivo: 'ERP_' + empresa.nome + '_' + new Date().toISOString().split('T')[0],
      dados_raw: { empresa, total_lancamentos: lancamentos?.length || 0 },
      dados_parseados: results,
      status: 'processado'
    });

    return NextResponse.json({
      message: 'Analise ERP concluida com sucesso',
      empresa: empresa.nome,
      total_lancamentos: lancamentos?.length || 0,
      analises: results.analises,
      faturamento: results.faturamento ? {
        receita: results.faturamento.total_receita,
        despesa: results.faturamento.total_despesa,
        resultado: results.faturamento.resultado,
        margem: results.faturamento.margem + '%',
        meses_analisados: results.faturamento.meses?.length || 0
      } : null
    });

  } catch (err: any) {
    console.error('Erro analisar-erp:', err);
    return NextResponse.json({ error: err.message || 'Erro interno' }, { status: 500 });
  }
}
