import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin'
import { NextRequest, NextResponse } from 'next/server';
import { exigirUsuario } from '@/lib/auth/guardaApi'

// Console SQL interno: só admin PS logado.
export async function POST(req: NextRequest) {
  const u = await exigirUsuario(req, { admin: true })
  if (u instanceof NextResponse) return u
  try {
    const { query } = await req.json();
    if (!query || !query.trim()) return NextResponse.json({ error: 'Query vazia' }, { status: 400 });

    // Security: block dangerous operations in production
    const q = query.trim().toUpperCase();
    const blocked = ['DROP DATABASE', 'DROP SCHEMA', 'TRUNCATE ALL'];
    for (const b of blocked) {
      if (q.includes(b)) return NextResponse.json({ error: 'Operacao bloqueada: ' + b }, { status: 403 });
    }

    // Só o RPC exec_sql. O fallback `.from(<tabela>).select('*')` foi REMOVIDO: com a service key
    // ele despejava qualquer tabela (ignora RLS) para quem chamasse.
    const { data, error } = await supabase.rpc('exec_sql', { sql_query: query }).maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ data, type: 'rpc' });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Erro interno' }, { status: 500 });
  }
}
