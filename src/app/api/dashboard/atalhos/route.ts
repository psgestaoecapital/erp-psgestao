// src/app/api/dashboard/atalhos/route.ts
// CRUD de atalhos personalizados do usuário por plano

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { withAuth } from '@/lib/withAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function getHandler(req: NextRequest, user: any) {
  const { searchParams } = new URL(req.url);
  const plano = searchParams.get('plano') || 'comercio';
  
  const supabase = supabaseAdmin;
  
  const [custom, defaults] = await Promise.all([
    supabase.from('dashboard_atalhos').select('*').eq('user_id', user.userId).eq('plano', plano).order('ordem'),
    supabase.from('dashboard_atalhos_default').select('*').eq('plano', plano).order('ordem')
  ]);
  
  return NextResponse.json({
    plano,
    custom: custom.data || [],
    defaults: defaults.data || [],
    ativos: (custom.data && custom.data.length > 0) ? custom.data : defaults.data
  });
}

async function postHandler(req: NextRequest, user: any) {
  try {
    const body = await req.json();
    const { plano, atalhos } = body;  // atalhos = [{nome, url, icone, cor, ordem}, ...]
    
    if (!plano || !Array.isArray(atalhos)) {
      return NextResponse.json({ erro: 'plano e atalhos obrigatórios' }, { status: 400 });
    }
    
    const supabase = supabaseAdmin;
    
    // Replace total: deleta custom existente e insere novo
    await supabase.from('dashboard_atalhos')
      .delete()
      .eq('user_id', user.userId)
      .eq('plano', plano);
    
    if (atalhos.length > 0) {
      await supabase.from('dashboard_atalhos').insert(
        atalhos.map((a: any, idx: number) => ({
          user_id: user.userId,
          plano,
          nome: a.nome,
          url: a.url,
          icone: a.icone || '⭐',
          cor: a.cor || '#C8941A',
          ordem: a.ordem ?? idx
        }))
      );
    }
    
    return NextResponse.json({ sucesso: true, qtd: atalhos.length });
  } catch (err: any) {
    return NextResponse.json({ erro: err.message }, { status: 500 });
  }
}

// Reseta pros defaults do plano
async function deleteHandler(req: NextRequest, user: any) {
  const { searchParams } = new URL(req.url);
  const plano = searchParams.get('plano');
  if (!plano) return NextResponse.json({ erro: 'plano obrigatório' }, { status: 400 });
  
  const supabase = supabaseAdmin;
  await supabase.from('dashboard_atalhos')
    .delete()
    .eq('user_id', user.userId)
    .eq('plano', plano);
  
  return NextResponse.json({ sucesso: true });
}

export const GET = withAuth(getHandler);
export const POST = withAuth(postHandler);
export const DELETE = withAuth(deleteHandler);
