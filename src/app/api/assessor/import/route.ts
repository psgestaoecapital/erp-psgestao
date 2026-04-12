import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function getAssessoriaId() {
  const { data } = await supabase.from('assessorias').select('id').limit(1).single();
  return data?.id;
}

function parseCSV(text: string): any[] {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const sep = lines[0].includes(';') ? ';' : ',';
  const headers = lines[0].split(sep).map(h => h.trim().replace(/"/g, ''));
  const rows: any[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(sep).map(v => v.trim().replace(/"/g, ''));
    const row: any = {};
    headers.forEach((h, idx) => { row[h] = values[idx] || ''; });
    rows.push(row);
  }
  return rows;
}

function generateABC(items: { nome: string; valor: number }[]) {
  const sorted = [...items].sort((a, b) => b.valor - a.valor);
  const total = sorted.reduce((s, i) => s + i.valor, 0);
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
  const assessoriaId = await getAssessoriaId();
  if (!assessoriaId) return NextResponse.json({ error: 'Assessoria nao encontrada' }, { status: 404 });
  
  const body = await req.json();
  const { diagnostico_id, dados_csv, tipo_abc } = body;
  if (!diagnostico_id) return NextResponse.json({ error: 'diagnostico_id obrigatorio' }, { status: 400 });
  
  const { data: diag } = await supabase.from('diagnosticos').select('id').eq('id', diagnostico_id).eq('assessoria_id', assessoriaId).single();
  if (!diag) return NextResponse.json({ error: 'Diagnostico nao encontrado' }, { status: 404 });
  
  if (dados_csv && tipo_abc) {
    const rows = parseCSV(dados_csv);
    const keys = Object.keys(rows[0] || {});
    const nomeCol = keys.find(k => /nome|cliente|produto|fornec|descri/i.test(k)) || keys[0];
    const valorCol = keys.find(k => /valor|total|fatur|receita/i.test(k)) || keys[1];
    const items = rows.map(r => ({
      nome: r[nomeCol] || 'Sem nome',
      valor: parseFloat((r[valorCol] || '0').replace(/\./g, '').replace(',', '.')) || 0
    })).filter(i => i.valor > 0);
    
    if (items.length === 0) return NextResponse.json({ error: 'Nenhum dado valido encontrado' }, { status: 400 });
    
    const abc = generateABC(items);
    
    await supabase.from('diagnostico_imports').insert({
      diagnostico_id, tipo_arquivo: 'csv', nome_arquivo: tipo_abc + '_import.csv',
      dados_raw: rows, dados_parseados: abc.dados, status: 'processado'
    });
    
    const { error: abcErr } = await supabase.from('diagnostico_curvas_abc').insert({
      diagnostico_id, tipo: tipo_abc, dados: abc.dados,
      total_itens: abc.total_itens, total_valor: abc.total_valor,
      qtd_a: abc.qtd_a, qtd_b: abc.qtd_b, qtd_c: abc.qtd_c
    });
    if (abcErr) return NextResponse.json({ error: abcErr.message }, { status: 500 });
    
    await supabase.from('diagnosticos').update({ status: 'em_andamento', updated_at: new Date().toISOString() }).eq('id', diagnostico_id);
    
    return NextResponse.json({
      message: 'Curva ABC gerada',
      abc: { total_itens: abc.total_itens, qtd_a: abc.qtd_a, qtd_b: abc.qtd_b, qtd_c: abc.qtd_c, total_valor: abc.total_valor }
    });
  }
  return NextResponse.json({ error: 'Envie dados_csv + tipo_abc' }, { status: 400 });
}
