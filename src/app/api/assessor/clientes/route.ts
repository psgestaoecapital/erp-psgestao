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
  const { data, error } = await supabase.from('clientes_assessoria')
    .select('*, diagnosticos(count)').eq('assessoria_id', assessoriaId).order('nome');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const cookieStore = cookies();
  const supabase = createRouteHandlerClient({ cookies: () => cookieStore });
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 });
  const assessoriaId = await getAssessoriaId(supabase, session.user.id);
  if (!assessoriaId) return NextResponse.json({ error: 'Assessoria nao encontrada' }, { status: 404 });
  const { data: assessoria } = await supabase.from('assessorias').select('max_clientes').eq('id', assessoriaId).single();
  const { count } = await supabase.from('clientes_assessoria').select('*', { count: 'exact', head: true }).eq('assessoria_id', assessoriaId);
  if (count && assessoria && count >= assessoria.max_clientes) {
    return NextResponse.json({ error: 'Limite de clientes do plano atingido.' }, { status: 403 });
  }
  const body = await req.json();
  const { data, error } = await supabase.from('clientes_assessoria')
    .insert({ ...body, assessoria_id: assessoriaId }).select().single();
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
  const { data, error } = await supabase.from('clientes_assessoria')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id).eq('assessoria_id', assessoriaId).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest) {
  const cookieStore = cookies();
  const supabase = createRouteHandlerClient({ cookies: () => cookieStore });
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 });
  const assessoriaId = await getAssessoriaId(supabase, session.user.id);
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'ID obrigatorio' }, { status: 400 });
  const { error } = await supabase.from('clientes_assessoria').delete().eq('id', id).eq('assessoria_id', assessoriaId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
