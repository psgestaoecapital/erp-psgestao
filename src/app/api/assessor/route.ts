import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function getUser(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (token) {
    const { data } = await supabase.auth.getUser(token);
    return data?.user;
  }
  return null;
}

export async function GET(req: NextRequest) {
  const user = await getUser(req);
  if (!user) {
    // Fallback: try listing all for now (will be filtered by RLS if enabled)
    const { data, error } = await supabase.from('assessorias').select('*, clientes_assessoria(count), diagnosticos(count)');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data || []);
  }
  const { data, error } = await supabase.from('assessorias').select('*, clientes_assessoria(count), diagnosticos(count)').eq('user_id', user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data || []);
}

export async function POST(req: NextRequest) {
  const user = await getUser(req);
  const body = await req.json();
  const { nome, cnpj, nome_fantasia, email_contato, telefone, cor_primaria, cor_secundaria, cor_fundo, logo_url } = body;
  if (!nome) return NextResponse.json({ error: 'Nome e obrigatorio' }, { status: 400 });
  
  const insertData: any = {
    nome, cnpj: cnpj || null,
    nome_fantasia: nome_fantasia || nome,
    email_contato: email_contato || null,
    telefone: telefone || null,
    cor_primaria: cor_primaria || '#3D2314',
    cor_secundaria: cor_secundaria || '#C8941A',
    cor_fundo: cor_fundo || '#FAF7F2',
    logo_url: logo_url || null,
    plano: 'starter', max_clientes: 5, status: 'trial'
  };
  if (user) insertData.user_id = user.id;

  const { data, error } = await supabase.from('assessorias').insert(insertData).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  
  if (user) {
    await supabase.from('assessoria_usuarios').insert({
      assessoria_id: data.id, user_id: user.id, role: 'admin',
      nome: user.email, email: user.email
    });
  }
  return NextResponse.json(data, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const { id, ...updates } = body;
  if (!id) return NextResponse.json({ error: 'ID obrigatorio' }, { status: 400 });
  const { data, error } = await supabase.from('assessorias')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
