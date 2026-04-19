import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getSupabase(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const auth = req.headers.get('authorization') || '';
  return createClient(url, anon, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
}

// Parser OFX simples (regex-based) — suporta OFX 1.x (SGML) e 2.x (XML)
function parseOFX(content: string) {
  const transacoes: any[] = [];
  
  // Extrair blocos STMTTRN (uma transação cada)
  const trnRegex = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/g;
  let match;
  
  while ((match = trnRegex.exec(content)) !== null) {
    const bloco = match[1];
    const getTag = (tag: string): string => {
      const m = bloco.match(new RegExp(`<${tag}>([^<\n\r]+)`, 'i'));
      return m ? m[1].trim() : '';
    };
    
    const tipo = getTag('TRNTYPE');
    const dataStr = getTag('DTPOSTED');
    const valorStr = getTag('TRNAMT');
    const idExterno = getTag('FITID');
    const checkNum = getTag('CHECKNUM');
    const memo = getTag('MEMO') || getTag('NAME') || '';
    
    if (!dataStr || !valorStr) continue;
    
    // YYYYMMDD ou YYYYMMDDHHMMSS
    const y = dataStr.slice(0, 4);
    const m = dataStr.slice(4, 6);
    const d = dataStr.slice(6, 8);
    const dataISO = `${y}-${m}-${d}`;
    const valor = parseFloat(valorStr.replace(',', '.'));
    if (isNaN(valor)) continue;
    
    transacoes.push({
      data_transacao: dataISO,
      valor,
      tipo: tipo || (valor > 0 ? 'CREDIT' : 'DEBIT'),
      descricao: memo.slice(0, 300),
      descricao_limpa: memo.toUpperCase().replace(/\s+/g, ' ').replace(/[^A-Z0-9\s]/g, '').trim().slice(0, 300),
      id_externo: idExterno || `${dataISO}-${valor}-${Math.random().toString(36).substring(2, 8)}`,
      check_num: checkNum || null,
    });
  }
  
  return transacoes;
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    const companyId = formData.get('company_id') as string;
    const bancoContaId = formData.get('banco_conta_id') as string;
    
    if (!file) return NextResponse.json({ error: 'Arquivo não enviado' }, { status: 400 });
    if (!companyId) return NextResponse.json({ error: 'Empresa não informada' }, { status: 400 });
    if (!bancoContaId) return NextResponse.json({ error: 'Conta bancária não informada' }, { status: 400 });
    
    const content = await file.text();
    const transacoes = parseOFX(content);
    
    if (transacoes.length === 0) {
      return NextResponse.json({ error: 'Nenhuma transação encontrada no arquivo OFX' }, { status: 400 });
    }
    
    const supabase = getSupabase(req);
    
    const registros = transacoes.map(t => ({
      ...t,
      company_id: companyId,
      banco_conta_id: bancoContaId,
      status: 'pendente',
      arquivo_origem: file.name,
    }));
    
    // Insert com ignore de duplicados (via UNIQUE constraint em id_externo)
    const { data, error } = await supabase
      .from('erp_extrato')
      .upsert(registros, { onConflict: 'company_id,banco_conta_id,id_externo', ignoreDuplicates: true })
      .select('id');
    
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    
    return NextResponse.json({
      success: true,
      total: transacoes.length,
      novos: data?.length || 0,
      duplicados: transacoes.length - (data?.length || 0),
      mensagem: `${data?.length || 0} transações importadas, ${transacoes.length - (data?.length || 0)} duplicadas ignoradas`,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Erro ao processar OFX' }, { status: 500 });
  }
}
