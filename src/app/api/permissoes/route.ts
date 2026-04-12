import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const nivel = searchParams.get('nivel');
  const modulo = searchParams.get('modulo');
  const plano = searchParams.get('plano');
  const action = searchParams.get('action') || 'check';

  // Lista todos os módulos
  if (action === 'modulos') {
    const { data, error } = await supabase
      .from('modulos_sistema')
      .select('*')
      .eq('ativo', true)
      .order('ordem');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  }

  // Lista todos os planos
  if (action === 'planos') {
    const { data, error } = await supabase
      .from('planos_licenca')
      .select('*, planos_modulos(modulo_id, modulos_sistema(nome))')
      .eq('ativo', true);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  }

  // Mapa completo de permissões por nível
  if (action === 'mapa' && nivel) {
    const { data, error } = await supabase
      .from('permissoes_nivel')
      .select('modulo_id, pode_ver, pode_editar, pode_excluir, pode_exportar, modulos_sistema(nome, grupo, icone, ordem)')
      .eq('nivel', nivel);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  }

  // Mapa completo de todos os níveis para um módulo
  if (action === 'mapa_modulo' && modulo) {
    const { data, error } = await supabase
      .from('permissoes_nivel')
      .select('nivel, pode_ver, pode_editar, pode_excluir, pode_exportar')
      .eq('modulo_id', modulo);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  }

  // Módulos de um plano
  if (action === 'plano_modulos' && plano) {
    const { data, error } = await supabase
      .from('planos_modulos')
      .select('modulo_id, modulos_sistema(nome, icone)')
      .eq('plano_id', plano);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  }

  // Check permissão específica
  if (nivel && modulo) {
    const { data, error } = await supabase
      .from('permissoes_nivel')
      .select('pode_ver, pode_editar, pode_excluir, pode_exportar')
      .eq('nivel', nivel)
      .eq('modulo_id', modulo)
      .single();
    if (error) return NextResponse.json({ allowed: false, error: error.message });
    return NextResponse.json({ allowed: data?.pode_ver || false, ...data });
  }

  return NextResponse.json({ error: 'Informe action, nivel ou modulo' }, { status: 400 });
}

// Update permission
export async function PUT(req: NextRequest) {
  const body = await req.json();
  const { nivel, modulo_id, pode_ver, pode_editar, pode_excluir, pode_exportar } = body;

  if (!nivel || !modulo_id) return NextResponse.json({ error: 'nivel e modulo_id obrigatorios' }, { status: 400 });

  const { data, error } = await supabase
    .from('permissoes_nivel')
    .upsert({
      modulo_id,
      nivel,
      pode_ver: pode_ver ?? false,
      pode_editar: pode_editar ?? false,
      pode_excluir: pode_excluir ?? false,
      pode_exportar: pode_exportar ?? false,
    }, { onConflict: 'modulo_id,nivel' })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
