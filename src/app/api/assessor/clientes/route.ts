import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function getAssessoriaId() {
  const { data } = await supabase.from('assessorias').select('id, max_clientes').limit(1).single();
  return data;
}

export async function GET(req: NextRequest) {
  const assessoria = await getAssessoriaId();
  if (!assessoria) return NextResponse.json({ error: 'Assessoria nao encontrada' }, { status: 404 });
  const { data, error } = await supabase.from('clientes_assessoria')
    .select('*, diagnosticos(count)').eq('assessoria_id', assessoria.id).order('nome');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data || []);
}

export async function POST(req: NextRequest) {
  const assessoria = await getAssessoriaId();
  if (!assessoria) return NextResponse.json({ error: 'Assessoria nao encontrada' }, { status: 404 });
  
  const { count } = await supabase.from('clientes_assessoria')
    .select('*', { count: 'exact', head: true }).eq('assessoria_id', assessoria.id);
  if (count !== null && count >= assessoria.max_clientes) {
    return NextResponse.json({ error: 'Limite de clientes do plano atingido.' }, { status: 403 });
  }
  
  const body = await req.json();
  const { data, error } = await supabase.from('clientes_assessoria')
    .insert({ ...body, assessoria_id: assessoria.id }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const { id, ...updates } = body;
  const { data, error } = await supabase.from('clientes_assessoria')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'ID obrigatorio' }, { status: 400 });
  const { error } = await supabase.from('clientes_assessoria').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
