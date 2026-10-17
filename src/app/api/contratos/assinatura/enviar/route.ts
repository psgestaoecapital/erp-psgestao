// #2936 etapa 2 · "Enviar para assinatura" (usuário logado da empresa).
// 1) lê o arquivo do contrato COM O JWT do usuário (a RLS da empresa decide se ele pode); 2) baixa o arquivo e calcula
// o SHA-256 no servidor (o hash assinado é o do arquivo guardado, não um valor vindo da tela); 3) cria o envio pela
// fn_contrato_assinatura_enviar também como o usuário (fn__guarda_empresa); 4) manda o link por e-mail a quem tem
// e-mail (fn_enviar_email, só service_role) e devolve os links para a tela abrir o WhatsApp de quem tem telefone.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { exigirLogin } from '@/lib/auth/guardaApi'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { BUCKET_CONTRATOS, escaparHtml, linkAssinatura, sha256Hex, soDigitos, telefoneWhatsApp, textoWhatsApp } from '@/lib/contratos/assinatura'

type SignatarioIn = { nome?: string; documento?: string; email?: string; telefone?: string; papel?: string }
type LinkOut = { signatario_id: string; nome: string; token: string }

const PAPEIS = new Set(['cliente', 'empresa', 'testemunha'])

export const POST = exigirLogin(async (req: NextRequest, u) => {
  let body: { contrato_id?: string; arquivo_id?: string; signatarios?: SignatarioIn[]; validade_dias?: number }
  try { body = await req.json() } catch { return NextResponse.json({ ok: false, erro: 'Pedido inválido' }, { status: 400 }) }
  const { contrato_id, arquivo_id } = body
  const sigs = Array.isArray(body.signatarios) ? body.signatarios : []
  if (!contrato_id || !arquivo_id) return NextResponse.json({ ok: false, erro: 'Escolha o contrato e o arquivo' }, { status: 400 })
  if (sigs.length === 0 || sigs.length > 10) return NextResponse.json({ ok: false, erro: 'Informe de 1 a 10 signatários' }, { status: 400 })
  for (const [i, s] of sigs.entries()) {
    // o código de confirmação vai por e-mail (não há provedor de WhatsApp): sem e-mail o signatário não consegue assinar
    if (!s.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.email.trim())) {
      return NextResponse.json({ ok: false, erro: `Signatário ${i + 1}: informe um e-mail válido (o código de confirmação vai por e-mail)` }, { status: 400 })
    }
    if (s.papel && !PAPEIS.has(s.papel)) return NextResponse.json({ ok: false, erro: `Signatário ${i + 1}: papel inválido` }, { status: 400 })
  }

  const doUsuario = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${u.token}` } },
  })

  // o arquivo precisa ser deste contrato e visível ao usuário (RLS da empresa)
  const { data: arq, error: eArq } = await doUsuario.from('erp_contratos_arquivos')
    .select('id, contrato_id, company_id, storage_path, mime_type, nome_arquivo')
    .eq('id', arquivo_id).eq('contrato_id', contrato_id).maybeSingle()
  if (eArq || !arq) return NextResponse.json({ ok: false, erro: 'Arquivo do contrato não encontrado' }, { status: 404 })
  if (arq.mime_type !== 'application/pdf') return NextResponse.json({ ok: false, erro: 'Para assinatura, anexe o contrato em PDF' }, { status: 400 })

  const { data: blob, error: eDown } = await supabaseAdmin.storage.from(BUCKET_CONTRATOS).download(arq.storage_path)
  if (eDown || !blob) return NextResponse.json({ ok: false, erro: 'Não consegui ler o arquivo do contrato' }, { status: 500 })
  const hash = await sha256Hex(await blob.arrayBuffer())

  const { data: env, error: eEnv } = await doUsuario.rpc('fn_contrato_assinatura_enviar', {
    p_contrato_id: contrato_id, p_documento_hash: hash, p_documento_path: arq.storage_path,
    p_signatarios: sigs.map((s) => ({
      nome: (s.nome ?? '').trim(), documento: soDigitos(s.documento), email: s.email!.trim(),
      telefone: soDigitos(s.telefone) || null, papel: s.papel || 'cliente',
    })),
    p_validade_dias: Number(body.validade_dias) || 15,
  })
  if (eEnv) return NextResponse.json({ ok: false, erro: eEnv.message }, { status: 400 })
  const r = env as { ok: boolean; erro?: string; envio_id: string; versao: number; codigo_verificacao: string; links: LinkOut[] }
  if (!r?.ok) return NextResponse.json({ ok: false, erro: r?.erro ?? 'Não consegui enviar' }, { status: 400 })

  const { data: ctr } = await doUsuario.from('erp_contratos').select('nome, numero').eq('id', contrato_id).maybeSingle()
  const { data: emp } = await doUsuario.from('companies').select('nome_fantasia, razao_social').eq('id', arq.company_id).maybeSingle()
  const empresa = (emp?.nome_fantasia || emp?.razao_social || null) as string | null
  const nomeContrato = (ctr?.nome || ctr?.numero || arq.nome_arquivo) as string
  const origem = new URL(req.url).origin

  const saida = []
  for (const [i, l] of r.links.entries()) {
    const s = sigs[i]
    const link = linkAssinatura(origem, l.token)
    let email_enviado = false
    try {
      const { data: m } = await supabaseAdmin.rpc('fn_enviar_email', {
        p_destino: s.email!.trim(), p_template: 'contrato_evento', p_dados: {
          assunto: `Contrato para assinar${empresa ? ' · ' + empresa : ''}`,
          titulo_email: 'Você tem um contrato para assinar',
          corpo: `Olá, ${escaparHtml(l.nome.split(' ')[0])}. ${empresa ? escaparHtml(empresa) + ' enviou' : 'Foi enviado'} o contrato `
            + `<b>${escaparHtml(nomeContrato)}</b> para você assinar eletronicamente. Toque no botão, confira o documento e confirme `
            + `com o código que enviaremos para este e-mail. O link vale até ${new Date(Date.now() + (Number(body.validade_dias) || 15) * 86400000).toLocaleDateString('pt-BR')}.`,
          cta: 'Ver e assinar', link,
          idempotency_key: `contrato-assin-link-${l.signatario_id}`, company_id: arq.company_id,
        },
      })
      email_enviado = !!(m as { ok?: boolean } | null)?.ok
    } catch { email_enviado = false }
    const tel = telefoneWhatsApp(s.telefone)
    saida.push({
      signatario_id: l.signatario_id, nome: l.nome, link, email_enviado,
      whatsapp: tel ? `https://wa.me/${tel}?text=${encodeURIComponent(textoWhatsApp(l.nome, empresa, nomeContrato, link))}` : null,
    })
  }
  return NextResponse.json({ ok: true, envio_id: r.envio_id, versao: r.versao, codigo_verificacao: r.codigo_verificacao, signatarios: saida })
})
