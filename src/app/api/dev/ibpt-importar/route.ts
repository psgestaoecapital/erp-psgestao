// POST /api/dev/ibpt-importar — IBPT PR 2/4: carga da tabela IBPT (Lei 12.741) em LOTES.
// Body JSON: { versao, vigencia_inicio, vigencia_fim, fonte?, uf?, reset?, rows: [...] }
//   rows[]: { ncm, uf?, nacional_federal, importado_federal, estadual, municipal, ex_tipi?, tipo?, descricao?, chave? }
// Header: Authorization: Bearer <access_token>. SÓ PS_ADMIN (a Central é da PS).
//
// Por que em lotes: a tabela IBPT completa é ~400k linhas (dezenas de MB). Função serverless da Vercel
// tem limite de ~4,5MB por request — então o navegador parseia o arquivo e envia em lotes pequenos
// (cada lote é um POST). O primeiro lote manda reset=true para limpar a versão antes de recarregar
// (idempotência: reimportar a mesma versão não duplica). Escrita via service_role (RLS: só núcleo PS).

import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const PS_ADMIN_SYSTEM_ROLES = ['PS_ADMIN', 'PS_ADMIN_CVM'];

interface LinhaIbpt {
  ncm?: string; uf?: string;
  nacional_federal?: number | string; importado_federal?: number | string;
  estadual?: number | string; municipal?: number | string;
  ex_tipi?: string | null; tipo?: string | null; descricao?: string | null; chave?: string | null;
}
interface Body {
  versao?: string; vigencia_inicio?: string; vigencia_fim?: string;
  fonte?: string; uf?: string; reset?: boolean; confirmar_reset?: boolean; rows?: LinhaIbpt[];
}

function num(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = parseFloat(String(v ?? '').replace(',', '.').replace(/[^\d.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

export async function POST(req: NextRequest) {
  const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!URL || !SERVICE) return NextResponse.json({ error: 'env faltando' }, { status: 500 });
  const admin = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });

  // 1) quem chama — PS_ADMIN, nunca o robô
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return NextResponse.json({ error: 'Sem sessão.' }, { status: 401 });
  const { data: userData } = await admin.auth.getUser(token);
  const user = userData?.user;
  if (!user) return NextResponse.json({ error: 'Sessão inválida.' }, { status: 401 });
  const { data: u } = await admin.from('users').select('system_role, is_robo, email').eq('id', user.id).single();
  if (!u || !PS_ADMIN_SYSTEM_ROLES.includes(u.system_role as string) || u.is_robo === true) {
    return NextResponse.json({ error: 'Apenas a equipe PS (PS_ADMIN) pode importar a tabela IBPT.' }, { status: 403 });
  }

  // 2) valida cabeçalho do lote (a carga não entra no escuro — RD-38)
  let body: Body;
  try { body = (await req.json()) as Body; } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }); }
  const versao = (body.versao ?? '').toString().trim();
  const vigIni = (body.vigencia_inicio ?? '').toString().trim();
  const vigFim = (body.vigencia_fim ?? '').toString().trim();
  const ufBody = (body.uf ?? '').toString().trim().toUpperCase() || null;
  const fonte = (body.fonte ?? 'IBPT').toString().trim() || 'IBPT';
  if (!versao) return NextResponse.json({ error: 'versao obrigatória' }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(vigIni) || !/^\d{4}-\d{2}-\d{2}$/.test(vigFim)) {
    return NextResponse.json({ error: 'vigencia_inicio e vigencia_fim são obrigatórias (YYYY-MM-DD)' }, { status: 400 });
  }
  if (!Array.isArray(body.rows)) return NextResponse.json({ error: 'rows ausente' }, { status: 400 });

  // 3) reset da versão no primeiro lote (idempotência: reimportar não duplica).
  //    GUARDA ANTI-DATA-LOSS: se a versão JÁ tem dados, o reset apagaria tudo (cenário real: subir as
  //    27 UFs hoje e, semana que vem, "acrescentar" 1 UF com reset apagaria as 27). BLOQUEIA (409) e
  //    só apaga com confirmação explícita do operador (confirmar_reset=true). Recuperação legítima
  //    (re-rodar a mesma carga) passa pela confirmação — perda de dados nunca é silenciosa.
  if (body.reset === true) {
    if (body.confirmar_reset !== true) {
      const { count } = await admin
        .from('fiscal_ibpt_aliquota')
        .select('*', { count: 'exact', head: true })
        .eq('versao', versao);
      if ((count ?? 0) > 0) {
        return NextResponse.json({
          error: `A versão ${versao} já tem ${count} linha(s) carregada(s). Recarregar VAI APAGAR tudo dessa versão e substituir. Confirme para substituir.`,
          needs_confirm: true, existentes: count,
        }, { status: 409 });
      }
    }
    const { error: delErr } = await admin.from('fiscal_ibpt_aliquota').delete().eq('versao', versao);
    if (delErr) return NextResponse.json({ error: `Falha ao limpar versão ${versao}: ${delErr.message}` }, { status: 500 });
  }

  // 4) mapeia as linhas → colunas da tabela; UF vem da linha OU do formulário (arquivo por UF)
  const agora = new Date().toISOString();
  const registros: Record<string, unknown>[] = [];
  const invalidas: string[] = [];
  for (let i = 0; i < body.rows.length; i++) {
    const r = body.rows[i];
    const ncm = String(r.ncm ?? '').replace(/\D/g, '');
    const uf = (String(r.uf ?? '').trim().toUpperCase() || ufBody || '');
    if (!ncm) { invalidas.push(`linha ${i + 1}: NCM vazio`); continue; }
    if (!uf) { invalidas.push(`linha ${i + 1}: UF ausente (informe a UF no formulário ou no arquivo)`); continue; }
    registros.push({
      ncm, uf,
      aliquota_nacional_federal: num(r.nacional_federal),
      aliquota_importado_federal: num(r.importado_federal),
      aliquota_estadual: num(r.estadual),
      aliquota_municipal: num(r.municipal),
      // EX faz parte da IDENTIDADE (PK ncm,ex_tipi,uf,versao). Vazio → '0' (chave não aceita NULL).
      ex_tipi: (String(r.ex_tipi ?? '').trim() || '0'),
      tipo: r.tipo ?? null,
      descricao: r.descricao ?? null,
      versao, vigencia_inicio: vigIni, vigencia_fim: vigFim, fonte,
      chave_ibpt: r.chave ?? null,
      importado_em: agora,
      importado_por: (u.email as string) ?? user.id,
    });
  }
  if (registros.length === 0) {
    return NextResponse.json({ error: 'Nenhuma linha válida no lote', invalidas: invalidas.slice(0, 20) }, { status: 400 });
  }

  const { error: upErr } = await admin
    .from('fiscal_ibpt_aliquota')
    .upsert(registros, { onConflict: 'ncm,ex_tipi,uf,versao' });
  if (upErr) return NextResponse.json({ error: `Falha ao gravar lote: ${upErr.message}` }, { status: 500 });

  return NextResponse.json({ ok: true, inseridos: registros.length, invalidas: invalidas.length, invalidas_amostra: invalidas.slice(0, 10) });
}
