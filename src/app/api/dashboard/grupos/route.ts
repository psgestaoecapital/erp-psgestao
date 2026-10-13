// src/app/api/dashboard/grupos/route.ts
// CRUD de grupos de empresas do usuário

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { exigirLogin, exigirEmpresas } from '@/lib/auth/guardaApi';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function getHandler(req: NextRequest, user: any) {
  const supabase = supabaseAdmin;
  
  // Empresas que o usuário tem acesso
  const { data: userCompanies } = await supabase
    .from('user_companies')
    .select('company_id, companies:companies(id, nome_fantasia, cnpj)')
    .eq('user_id', user.userId);
  
  // Grupos do usuário
  const { data: grupos } = await supabase
    .from('dashboard_grupos')
    .select(`
      id, nome, descricao, cor, icone, ordem, is_padrao,
      dashboard_grupos_empresas(
        id, company_id, ordem,
        companies:companies(id, nome_fantasia, cnpj)
      )
    `)
    .eq('user_id', user.userId)
    .order('ordem');
  
  return NextResponse.json({
    grupos: grupos || [],
    empresas_disponiveis: (userCompanies || []).map((uc: any) => uc.companies)
  });
}

async function postHandler(req: NextRequest, user: any) {
  try {
    const body = await req.json();
    const { nome, descricao, icone, cor, company_ids, is_padrao } = body;
    
    if (!nome || !Array.isArray(company_ids) || company_ids.length === 0) {
      return NextResponse.json({ erro: 'nome e pelo menos 1 empresa obrigatórios' }, { status: 400 });
    }
    // Grupo só pode conter empresas do próprio usuário (senão os dashboards por grupo_id abririam as dos outros).
    const negado = await exigirEmpresas(user, company_ids);
    if (negado) return negado;
    
    const supabase = supabaseAdmin;
    
    // Se vier is_padrao=true, zera is_padrao dos outros
    if (is_padrao) {
      await supabase.from('dashboard_grupos')
        .update({ is_padrao: false })
        .eq('user_id', user.userId);
    }
    
    const { data: grupo, error } = await supabase
      .from('dashboard_grupos')
      .insert({
        user_id: user.userId,
        nome,
        descricao: descricao || null,
        icone: icone || '🏢',
        cor: cor || '#C8941A',
        is_padrao: !!is_padrao
      })
      .select()
      .single();
    
    if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
    
    // Adiciona empresas
    await supabase.from('dashboard_grupos_empresas').insert(
      company_ids.map((cid: string, idx: number) => ({
        grupo_id: grupo.id,
        company_id: cid,
        ordem: idx
      }))
    );
    
    return NextResponse.json({ sucesso: true, grupo });
  } catch (err: any) {
    return NextResponse.json({ erro: err.message }, { status: 500 });
  }
}

async function deleteHandler(req: NextRequest, user: any) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ erro: 'id obrigatório' }, { status: 400 });
  
  const supabase = supabaseAdmin;
  const { error } = await supabase
    .from('dashboard_grupos')
    .delete()
    .eq('id', id)
    .eq('user_id', user.userId);
  
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({ sucesso: true });
}

export const GET = exigirLogin(getHandler);
export const POST = exigirLogin(postHandler);
export const DELETE = exigirLogin(deleteHandler);
