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

export async function GET(req: NextRequest) {
  const assessoriaId = await getAssessoriaId();
  if (!assessoriaId) return NextResponse.json({ error: 'Assessoria nao encontrada' }, { status: 404 });
  const { searchParams } = new URL(req.url);
  const diagId = searchParams.get('id');
  let query = supabase.from('diagnosticos')
    .select('*, clientes_assessoria(nome, cnpj), diagnostico_curvas_abc(tipo, qtd_a, qtd_b, qtd_c, total_valor)')
    .eq('assessoria_id', assessoriaId);
  if (diagId) query = query.eq('id', diagId);
  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(diagId ? data?.[0] : (data || []));
}

export async function POST(req: NextRequest) {
  const assessoriaId = await getAssessoriaId();
  if (!assessoriaId) return NextResponse.json({ error: 'Assessoria nao encontrada' }, { status: 404 });
  const body = await req.json();
  const { cliente_id, titulo, tipo, data_base_inicio, data_base_fim } = body;
  if (!cliente_id || !titulo) return NextResponse.json({ error: 'cliente_id e titulo obrigatorios' }, { status: 400 });
  const { data, error } = await supabase.from('diagnosticos')
    .insert({ assessoria_id: assessoriaId, cliente_id, titulo, tipo: tipo || 'completo', data_base_inicio, data_base_fim, status: 'rascunho' })
    .select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const { id, ...updates } = body;
  const { data, error } = await supabase.from('diagnosticos')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
