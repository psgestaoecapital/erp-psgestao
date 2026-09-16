// POST /api/dev/atualizar-vertical  — ④ botão "atualizar a vertical" (Central de Desenvolvimento)
// Body: { vertical: string }   Header: Authorization: Bearer <access_token do usuário>
//
// Guarda-corpos (decisão do CEO / RD-41):
//  • SÓ o CEO/admin por enquanto (checa users.role);
//  • orçamento + teto (US$ 1/dia, US$ 5/mês) via fn_dev_vertical_orcamento — recusa se estourar;
//  • dispara o auditor Gold (Camada 2) por rota da vertical (roda em minutos, assíncrono);
//  • a análise cruzada com o blueprint NÃO roda aqui — sai na próxima conversa com a Claude (a tela avisa).

import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// SEGURANÇA: a Central é da PS. Gate por system_role (não por role, que qualquer 'adm' de cliente tem),
// e nunca o robô. Hoje: Gilberto, André, Jordana, Rodrigo.
const PS_ADMIN_SYSTEM_ROLES = ['PS_ADMIN', 'PS_ADMIN_CVM'];

// system_screens.area usa 'hub_construcao'/'revenda'; a Central usa 'hub'/'revenda_veiculos'
function areasDoVertical(vertical: string): string[] {
  if (vertical === 'hub') return ['hub_construcao', 'hub'];
  if (vertical === 'revenda_veiculos') return ['revenda', 'revenda_veiculos'];
  return [vertical];
}

export async function POST(req: NextRequest) {
  const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const WATCHER_SECRET = process.env.WATCHER_SECRET;
  if (!URL || !SERVICE) return NextResponse.json({ error: 'env faltando' }, { status: 500 });

  const admin = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });

  // 1) quem está chamando — precisa ser admin (CEO)
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return NextResponse.json({ error: 'Sem sessão.' }, { status: 401 });
  const { data: userData } = await admin.auth.getUser(token);
  const user = userData?.user;
  if (!user) return NextResponse.json({ error: 'Sessão inválida.' }, { status: 401 });
  const { data: u } = await admin.from('users').select('system_role, is_robo').eq('id', user.id).single();
  if (!u || !PS_ADMIN_SYSTEM_ROLES.includes(u.system_role) || u.is_robo === true) {
    return NextResponse.json({ error: 'Apenas a equipe PS (PS_ADMIN) pode atualizar a vertical.' }, { status: 403 });
  }

  // 2) orçamento + teto
  let vertical = '';
  try { vertical = (await req.json())?.vertical?.toString().trim() || ''; } catch { /* */ }
  if (!vertical) return NextResponse.json({ error: 'vertical obrigatória' }, { status: 400 });

  const { data: orc, error: orcErr } = await admin.rpc('fn_dev_vertical_orcamento', { p_vertical: vertical });
  if (orcErr) return NextResponse.json({ error: orcErr.message }, { status: 500 });
  if (!orc?.pode) return NextResponse.json({ error: orc?.motivo || 'Não permitido agora.', orcamento: orc }, { status: 400 });

  // 3) rotas auditáveis da vertical (têm gold_screen_buttons)
  const { data: telas } = await admin
    .from('system_screens')
    .select('id, rota, area')
    .in('area', areasDoVertical(vertical));
  const screenIds = (telas || []).map((t) => t.id);
  let rotas: { rota: string; screen_id: string }[] = [];
  if (screenIds.length) {
    const { data: btns } = await admin.from('gold_screen_buttons').select('rota, screen_id').in('screen_id', screenIds);
    const vistos = new Set<string>();
    for (const b of btns || []) {
      if (!vistos.has(b.screen_id)) { vistos.add(b.screen_id); rotas.push({ rota: b.rota, screen_id: b.screen_id }); }
    }
  }

  // 4) registra o pedido (fonte da verdade do gasto do dia/mês)
  const { data: pedido } = await admin.from('erp_dev_vertical_pedido').insert({
    vertical, telas: orc.telas, rotas_auditadas: rotas.length,
    custo_estimado: orc.custo_estimado, tempo_min: orc.tempo_min, solicitado_por: user.id,
  }).select('id').single();

  // 5) dispara o auditor por rota — assíncrono (o edge function roda independente do retorno daqui)
  let disparadas = 0;
  if (WATCHER_SECRET && rotas.length) {
    const alvo = `${URL}/functions/v1/auditoria-gold-jornada`;
    await Promise.allSettled(rotas.map(async (r) => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 3000); // só garante o hand-off; o auditor segue rodando
      try {
        await fetch(alvo, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-watcher-secret': WATCHER_SECRET, Authorization: `Bearer ${SERVICE}` },
          body: JSON.stringify({ rota: r.rota, screen_id: r.screen_id }),
          signal: ctrl.signal,
        });
        disparadas++;
      } catch { disparadas++; /* abort = hand-off feito; o auditor continua no servidor */ }
      finally { clearTimeout(t); }
    }));
  }

  return NextResponse.json({
    ok: true,
    pedido_id: pedido?.id ?? null,
    vertical,
    telas: orc.telas,
    custo_estimado: orc.custo_estimado,
    tempo_min: orc.tempo_min,
    rotas_auditaveis: rotas.length,
    rotas_disparadas: disparadas,
    dispatch: WATCHER_SECRET ? 'ok' : 'sem_watcher_secret',
    aviso: 'O diagnóstico do auditor sai em minutos. A análise cruzada com o blueprint sai na próxima conversa com a Claude.',
  });
}
