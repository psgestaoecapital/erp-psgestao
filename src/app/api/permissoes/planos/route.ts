import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const planoId = searchParams.get('id');

  if (planoId) {
    const { data, error } = await supabase
      .from('planos_licenca')
      .select('*, planos_modulos(modulo_id, modulos_sistema(nome, icone, grupo))')
      .eq('id', planoId)
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  }

  const { data, error } = await supabase
    .from('planos_licenca')
    .select('*, planos_modulos(modulo_id, modulos_sistema(nome, icone))')
    .eq('ativo', true)
    .order('preco_min');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data || []);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { id, nome, preco_min, preco_max, max_usuarios, max_empresas, descricao, modulos } = body;

  if (!id || !nome) return NextResponse.json({ error: 'id e nome obrigatorios' }, { status: 400 });

  // Create plan
  const { data: plano, error: planoErr } = await supabase
    .from('planos_licenca')
    .upsert({ id, nome, preco_min, preco_max, max_usuarios, max_empresas, descricao, ativo: true })
    .select()
    .single();

  if (planoErr) return NextResponse.json({ error: planoErr.message }, { status: 500 });

  // Update modules if provided
  if (modulos && Array.isArray(modulos)) {
    // Remove existing
    await supabase.from('planos_modulos').delete().eq('plano_id', id);
    // Insert new
    const inserts = modulos.map((m: string) => ({ plano_id: id, modulo_id: m }));
    if (inserts.length > 0) {
      await supabase.from('planos_modulos').insert(inserts);
    }
  }

  return NextResponse.json(plano);
}
