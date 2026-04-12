import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

async function withAuth(req: NextRequest) {
  const cookieStore = cookies();
  const supabase = createRouteHandlerClient({ cookies: () => cookieStore });
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { supabase: null, session: null, error: NextResponse.json({ error: 'Token de autenticacao ausente' }, { status: 401 }) };
  return { supabase, session, error: null };
}

export async function GET(req: NextRequest) {
  const { supabase, session, error } = await withAuth(req);
  if (error || !supabase || !session) return error!;
  const { data, error: dbError } = await supabase
    .from('assessorias')
    .select('*, clientes_assessoria(count), diagnosticos(count)')
    .eq('user_id', session.user.id);
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const { supabase, session, error } = await withAuth(req);
  if (error || !supabase || !session) return error!;
  const body = await req.json();
  const { nome, cnpj, nome_fantasia, email_contato, telefone, cor_primaria, cor_secundaria, cor_fundo, logo_url } = body;
  if (!nome) return NextResponse.json({ error: 'Nome e obrigatorio' }, { status: 400 });
  const { data, error: dbError } = await supabase
    .from('assessorias')
    .insert({
      user_id: session.user.id, nome, cnpj: cnpj || null,
      nome_fantasia: nome_fantasia || nome, email_contato: email_contato || session.user.email,
      telefone: telefone || null, cor_primaria: cor_primaria || '#3D2314',
      cor_secundaria: cor_secundaria || '#C8941A', cor_fundo: cor_fundo || '#FAF7F2',
      logo_url: logo_url || null, plano: 'starter', max_clientes: 5, status: 'trial'
    }).select().single();
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  await supabase.from('assessoria_usuarios').insert({
    assessoria_id: data.id, user_id: session.user.id, role: 'admin',
    nome: session.user.email, email: session.user.email
  });
  return NextResponse.json(data, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const { supabase, session, error } = await withAuth(req);
  if (error || !supabase || !session) return error!;
  const body = await req.json();
  const { id, ...updates } = body;
  if (!id) return NextResponse.json({ error: 'ID obrigatorio' }, { status: 400 });
  const { data, error: dbError } = await supabase
    .from('assessorias').update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id).eq('user_id', session.user.id).select().single();
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json(data);
}
