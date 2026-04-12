import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const { query } = await req.json();
    if (!query || !query.trim()) return NextResponse.json({ error: 'Query vazia' }, { status: 400 });

    // Security: block dangerous operations in production
    const q = query.trim().toUpperCase();
    const blocked = ['DROP DATABASE', 'DROP SCHEMA', 'TRUNCATE ALL'];
    for (const b of blocked) {
      if (q.includes(b)) return NextResponse.json({ error: 'Operacao bloqueada: ' + b }, { status: 403 });
    }

    const { data, error } = await supabase.rpc('exec_sql', { sql_query: query }).maybeSingle();
    
    // If RPC doesn't exist, try direct query via REST
    if (error && error.message?.includes('exec_sql')) {
      // Fallback: use supabase-js for SELECT queries
      if (q.startsWith('SELECT')) {
        const tableName = query.match(/FROM\s+([\w]+)/i)?.[1];
        if (tableName) {
          const { data: selectData, error: selectError } = await supabase
            .from(tableName)
            .select('*')
            .limit(100);
          if (selectError) return NextResponse.json({ error: selectError.message, type: 'select_error' }, { status: 500 });
          return NextResponse.json({ data: selectData, rows: selectData?.length || 0, type: 'select' });
        }
      }
      
      // For non-SELECT, return the error with instructions
      return NextResponse.json({ 
        error: 'Para executar DDL/DML, use o Supabase SQL Editor diretamente. Este endpoint suporta SELECT queries.',
        hint: 'Cole o SQL no Supabase SQL Editor: app.supabase.com',
        type: 'ddl_not_supported'
      }, { status: 400 });
    }

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ data, type: 'rpc' });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Erro interno' }, { status: 500 });
  }
}
