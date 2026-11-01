// #2936 etapa 2 · Rota PÚBLICA do signatário (sem login): o token do link identifica o signatário.
// As funções do banco do signatário só aceitam service_role (REVOKE de anon/authenticated na etapa 1), então esta rota
// é a única porta. O que ela garante:
//  - o código de confirmação (2º fator) NUNCA volta na resposta: vai por e-mail ao signatário;
//  - o documento é mostrado por link assinado de 5 min, e o hash conferido na assinatura é recalculado aqui a partir do
//    arquivo guardado (assina-se o arquivo que foi enviado, não um valor vindo do navegador);
//  - geolocalização só vai ao banco com o consentimento marcado (o banco também recusa sem ele).
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { BUCKET_CONTRATOS, TOKEN_RE, ipDaRequisicao, mascararEmail, sha256Hex } from '@/lib/contratos/assinatura'
import { gerarEArquivarPdfAssinado } from '@/lib/contratos/pdfAssinadoServidor'

type Abrir = { ok: boolean; erro?: string; documento_path?: string | null; documento_hash?: string; nome?: string; [k: string]: unknown }

const erro = (msg: string, status = 400) => NextResponse.json({ ok: false, erro: msg }, { status })

export async function POST(req: NextRequest) {
  let body: { acao?: string; token?: string; codigo?: string; documento?: string; aceite?: boolean; geo_consentido?: boolean; geo?: unknown }
  try { body = await req.json() } catch { return erro('Pedido inválido') }
  const token = (body.token ?? '').trim().toLowerCase()
  if (!TOKEN_RE.test(token)) return erro('Link inválido', 404)
  const ip = ipDaRequisicao(req)
  const ua = (req.headers.get('user-agent') || '').slice(0, 500) || null

  if (body.acao === 'abrir') {
    const { data, error } = await supabaseAdmin.rpc('fn_contrato_assinatura_abrir', { p_token: token, p_ip: ip, p_user_agent: ua })
    if (error) return erro('Não consegui abrir o documento', 500)
    const r = data as Abrir
    if (!r?.ok) return erro(r?.erro ?? 'Link inválido', 404)
    let documento_url: string | null = null
    if (r.documento_path) {
      const { data: s } = await supabaseAdmin.storage.from(BUCKET_CONTRATOS).createSignedUrl(r.documento_path, 300)
      documento_url = s?.signedUrl ?? null
    }
    const { documento_path: _p, ...resto } = r
    void _p
    return NextResponse.json({ ...resto, documento_url })
  }

  if (body.acao === 'codigo') {
    const { data, error } = await supabaseAdmin.rpc('fn_contrato_assinatura_codigo', { p_token: token })
    if (error) return erro('Não consegui gerar o código', 500)
    const r = data as { ok: boolean; erro?: string; codigo?: string; email?: string | null; nome?: string }
    if (!r?.ok) return erro(r?.erro ?? 'Não consegui gerar o código')
    if (!r.email) return erro('Este signatário não tem e-mail cadastrado; peça à empresa um novo envio com e-mail')
    const { data: m } = await supabaseAdmin.rpc('fn_enviar_email', {
      p_destino: r.email, p_template: 'contrato_evento', p_dados: {
        assunto: `Seu código para assinar: ${r.codigo}`,
        titulo_email: 'Código de confirmação da assinatura',
        corpo: `Use o código <b style="font-size:20px;letter-spacing:4px">${r.codigo}</b> para confirmar a sua assinatura. `
          + 'Ele vale por 10 minutos. Se não foi você quem pediu, ignore este e-mail: sem o código ninguém assina no seu nome.',
        cta: 'Voltar para a assinatura', link: `${new URL(req.url).origin}/sign/contrato/${token}`,
      },
    })
    if (!(m as { ok?: boolean } | null)?.ok) return erro('Não consegui enviar o código por e-mail agora; tente de novo em instantes', 502)
    return NextResponse.json({ ok: true, enviado_para: mascararEmail(r.email) })
  }

  if (body.acao === 'assinar') {
    const { data: ab, error: eAb } = await supabaseAdmin.rpc('fn_contrato_assinatura_abrir', { p_token: token, p_ip: ip, p_user_agent: ua })
    const a = ab as Abrir
    if (eAb || !a?.ok) return erro(a?.erro ?? 'Link inválido', 404)
    if (!a.documento_path) return erro('Documento indisponível; fale com a empresa', 409)
    const { data: blob, error: eDown } = await supabaseAdmin.storage.from(BUCKET_CONTRATOS).download(a.documento_path)
    if (eDown || !blob) return erro('Não consegui conferir o documento agora; tente de novo', 500)
    const hash = await sha256Hex(await blob.arrayBuffer())
    const geoOk = body.geo_consentido === true && body.geo && typeof body.geo === 'object'
    const { data, error } = await supabaseAdmin.rpc('fn_contrato_assinatura_assinar', {
      p_token: token, p_codigo: (body.codigo ?? '').replace(/\D/g, ''), p_documento: body.documento ?? '',
      p_aceite: body.aceite === true, p_documento_hash: hash, p_metodo: 'aceite', p_assinatura_imagem_path: null,
      p_ip: ip, p_user_agent: ua, p_geo_consentido: !!geoOk, p_geolocalizacao: geoOk ? body.geo : null,
    })
    if (error) return erro('Não consegui registrar a assinatura', 500)
    const r = data as { ok: boolean; erro?: string; todos_assinaram?: boolean; codigo_verificacao?: string }
    if (!r?.ok) return erro(r?.erro ?? 'Não consegui registrar a assinatura')
    // etapa 3: o último a assinar gera o PDF assinado com a página de evidências; se falhar, a assinatura vale do mesmo
    // jeito e a empresa gera de novo pelo botão da ficha do contrato
    if (r.todos_assinaram && typeof a.signatario_id === 'string') {
      const { data: envio } = await supabaseAdmin.from('erp_contrato_assinatura_signatario').select('envio_id').eq('id', a.signatario_id).maybeSingle()
      if (envio?.envio_id) { try { await gerarEArquivarPdfAssinado(envio.envio_id as string, new URL(req.url).origin) } catch { /* botão da ficha refaz */ } }
    }
    return NextResponse.json({ ok: true, todos_assinaram: !!r.todos_assinaram, codigo_verificacao: r.codigo_verificacao, documento_hash: hash })
  }

  return erro('Ação inválida')
}
