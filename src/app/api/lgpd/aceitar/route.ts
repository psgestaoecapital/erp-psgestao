import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// LGPD · gate de consentimento — server action do aceite (rota /aceite, NÃO modal).
// Por que no servidor: o IP tem que ser capturado do request (o cliente não sabe/não pode
// provar o próprio IP) e o user-agent vem do header. O SPEC exige IP + user_agent obrigatórios.
// Grava OS DOIS lados que a construção RD-26 previa e que o modal órfão nunca cumpriu:
//   · consolidado (lgpd_consentimentos) — o modal antigo gravava só este, com versão '1.1'
//     hardcoded (foi assim que a base ficou meio-preenchida);
//   · granular (lgpd_consentimentos_granulares) via fn_lgpd_registrar_consentimento — o modal
//     NUNCA chamou, por isso a tabela tinha 0 linhas.
// A versão vem SEMPRE do parâmetro (fn_lgpd_versao_vigente), nunca hardcoded.
// Enquadramento (decisão CEO): IA = condição de uso = execução de contrato → não é checkbox
// opcional; a tela informa (Art. 9º) e o aceite dos Termos cobre. Marketing é o único
// consentimento opcional de verdade.

export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const auth = req.headers.get('authorization') || ''
  if (!url || !anon || !auth.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'não autenticado' }, { status: 401 })
  }

  let body: { aceite_marketing?: boolean }
  try { body = await req.json() } catch { body = {} }
  const aceiteMarketing = body?.aceite_marketing === true

  // IP real do request (o cliente não sabe o próprio IP). x-forwarded-for = 1º da lista.
  const ip =
    (req.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    null
  const userAgent = req.headers.get('user-agent') || null

  // client com o JWT do usuário → RLS/own-row e as RPCs resolvem por auth.uid() (Pilar 2).
  const sb = createClient(url, anon, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  })

  // usuário verificado pelo token (não confiamos em id vindo do corpo).
  const { data: userData, error: userErr } = await sb.auth.getUser()
  const user = userData?.user
  if (userErr || !user) {
    return NextResponse.json({ error: 'sessão inválida' }, { status: 401 })
  }
  const userId = user.id
  const userEmail = user.email || ''

  // versão vigente SEMPRE do parâmetro — nunca hardcoded (foi assim que morreu).
  const { data: vigenteRows, error: vigErr } = await sb.rpc('fn_lgpd_versao_vigente')
  const vigente = Array.isArray(vigenteRows) ? vigenteRows[0] : vigenteRows
  const termosVersao: string | undefined = vigente?.termos_versao
  const privVersao: string | undefined = vigente?.privacidade_versao
  if (vigErr || !termosVersao || !privVersao) {
    return NextResponse.json({ error: 'versão vigente não configurada' }, { status: 500 })
  }

  // 1) consolidado. aceite_ia_dados = true: a IA é condição de uso (execução de contrato) e a
  //    tela informa; o aceite dos Termos a cobre. Registramos a ciência aqui e no granular.
  const { error: consErr } = await sb.from('lgpd_consentimentos').insert({
    user_id: userId,
    user_email: userEmail,
    termos_versao: termosVersao,
    privacidade_versao: privVersao,
    ip,
    user_agent: userAgent,
    aceite_termos: true,
    aceite_privacidade: true,
    aceite_ia_dados: true,
  })
  if (consErr) {
    return NextResponse.json({ error: 'falha ao gravar consentimento', detalhe: consErr.message }, { status: 500 })
  }

  // 2) granular (por finalidade) via RPC — com IP + UA + versão do parâmetro.
  //    analise_ia_dre: ciência do tratamento por IA (base agora execução de contrato).
  //    comunicacao_marketing: ÚNICO consentimento opcional de verdade (Art. 8º — livre).
  const finalidades: Array<{ id: string; consentido: boolean }> = [
    { id: 'analise_ia_dre', consentido: true },
    { id: 'comunicacao_marketing', consentido: aceiteMarketing },
  ]
  for (const f of finalidades) {
    const { error: gErr } = await sb.rpc('fn_lgpd_registrar_consentimento', {
      p_user_id: userId,
      p_user_email: userEmail,
      p_finalidade_id: f.id,
      p_consentido: f.consentido,
      p_versao_termos: termosVersao,
      p_ip: ip,
      p_user_agent: userAgent,
    })
    // granular é auditoria; se uma finalidade falhar, não desfaz o consolidado, mas reporta.
    if (gErr) {
      return NextResponse.json(
        { error: 'consentimento gravado, mas houve falha no registro granular', finalidade: f.id, detalhe: gErr.message },
        { status: 207 },
      )
    }
  }

  return NextResponse.json({ ok: true, versao: termosVersao })
}
