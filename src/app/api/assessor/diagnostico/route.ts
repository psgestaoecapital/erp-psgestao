import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

async function getAssessoriaId(supabase: any, userId: string) {
  const { data } = await supabase.from('assessorias').select('id').eq('user_id', userId).single();
  return data?.id;
}

export async function GET(req: NextRequest) {
  const cookieStore = cookies();
  const supabase = createRouteHandlerClient({ cookies: () => cookieStore });
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 });
  const assessoriaId = await getAssessoriaId(supabase, session.user.id);
  if (!assessoriaId) return NextResponse.json({ error: 'Assessoria nao encontrada' }, { status: 404 });
  const { searchParams } = new URL(req.url);
  const diagId = searchParams.get('id');
  let query = supabase.from('diagnosticos')
    .select('*, clientes_assessoria(nome, cnpj), diagnostico_curvas_abc(tipo, qtd_a, qtd_b, qtd_c, total_valor)')
    .eq('assessoria_id', assessoriaId);
  if (diagId) query = query.eq('id', diagId);
  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(diagId ? data?.[0] : data);
}

export async function POST(req: NextRequest) {
  const cookieStore = cookies();
  const supabase = createRouteHandlerClient({ cookies: () => cookieStore });
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 });
  const assessoriaId = await getAssessoriaId(supabase, session.user.id);
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
  const cookieStore = cookies();
  const supabase = createRouteHandlerClient({ cookies: () => cookieStore });
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 });
  const assessoriaId = await getAssessoriaId(supabase, session.user.id);
  const body = await req.json();
  const { id, ...updates } = body;
  const { data, error } = await supabase.from('diagnosticos')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id).eq('assessoria_id', assessoriaId).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
