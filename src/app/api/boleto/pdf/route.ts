// GET /api/boleto/pdf?receber_id=...
// Renderiza o PDF do boleto NO BACKEND (layout FEBRABAN), independente do
// banco. Le os dados de erp_receber + companies + erp_clientes +
// erp_banco_provider_config, monta o objeto padronizado e delega pro
// gerador (src/lib/boleto/gerarPdfBoleto.ts).
//
// Cache: se erp_receber.boleto_url ja existe, serve o salvo. Senao, gera,
// sobe no bucket 'boletos' e grava signed URL (1 ano).
//
// Auth: aceita sessao de usuario OU x-ping-secret (mesmo padrao das rotas
// Sicoob — permite testar via curl). Sem auth: 401.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { Buffer } from 'node:buffer'
import { timingSafeEqual } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { gerarPdfBoleto, type BoletoDados } from '@/lib/boleto/gerarPdfBoleto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Vercel: subir o teto de execucao (default 10s) — pdf-lib + bwip-js +
// qrcode + upload no bucket pode passar dos 10s na 1a geracao.
export const maxDuration = 60

async function logGen(company_id: string, status: 'ok' | 'erro', mensagem: string, payload: unknown) {
  try {
    await supabaseAdmin.from('erp_banco_sync_log').insert({
      company_id, banco_codigo: '000', provider: 'pdf-boleto', tipo: 'boleto_pdf_gen',
      status, qtd: 1, mensagem: mensagem.slice(0, 1000), payload_resumo: payload,
    })
  } catch { /* nao deixar log derrubar a rota */ }
}

function userSupabase(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const auth = req.headers.get('authorization') || ''
  return createClient(url, anon, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  })
}

function temSegredoValido(req: NextRequest): boolean {
  const expected = process.env.PING_SICOOB_SECRET
  const provided = req.headers.get('x-ping-secret') || ''
  if (!expected || !provided) return false
  const A = Buffer.from(provided)
  const B = Buffer.from(expected)
  if (A.length !== B.length) return false
  return timingSafeEqual(A, B)
}

const BANCOS: Record<string, string> = {
  '756': 'SICOOB',
  '237': 'BRADESCO',
  '748': 'SICREDI',
  '341': 'ITAU',
  '001': 'BB',
  '033': 'SANTANDER',
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const receberId = url.searchParams.get('receber_id')
    if (!receberId) {
      return NextResponse.json({ ok: false, erro: 'receber_id obrigatorio' }, { status: 400 })
    }

    const segredoOk = temSegredoValido(req)
    let sb: ReturnType<typeof userSupabase>
    if (segredoOk) {
      sb = supabaseAdmin as unknown as ReturnType<typeof userSupabase>
    } else {
      sb = userSupabase(req)
      const { data: { user } } = await sb.auth.getUser()
      if (!user) return NextResponse.json({ ok: false, erro: 'nao autenticado' }, { status: 401 })
    }

    const { data: rec, error: recErr } = await sb.from('erp_receber')
      .select('id, company_id, cliente_id, cliente_nome, valor, data_emissao, data_vencimento, numero_documento, boleto_status, boleto_nosso_numero, boleto_linha_digitavel, boleto_codigo_barras, boleto_qr_code, boleto_url, boleto_banco_codigo')
      .eq('id', receberId).single()
    if (recErr || !rec) return NextResponse.json({ ok: false, erro: 'titulo nao encontrado' }, { status: 404 })
    if (rec.boleto_status !== 'registrado' || !rec.boleto_codigo_barras || !rec.boleto_linha_digitavel) {
      return NextResponse.json({ ok: false, erro: 'titulo sem boleto registrado ou sem codigo de barras' }, { status: 412 })
    }

    // Cache: se ja temos PDF salvo, redireciona pra signed URL existente.
    // Forca regeracao com ?force=1 ou ?regenerar=true (alias mais legivel
    // — util quando o template muda e queremos invalidar caches).
    // Modo as=json devolve { ok, boleto_url } sem servir o binario — pro
    // botao WhatsApp materializar o link sem abrir aba intermediaria.
    const force = url.searchParams.get('force') === '1'
      || url.searchParams.get('regenerar') === 'true'
    const asJson = url.searchParams.get('as') === 'json'
    if (rec.boleto_url && !force) {
      if (asJson) return NextResponse.json({ ok: true, boleto_url: rec.boleto_url })
      return NextResponse.redirect(rec.boleto_url, 302)
    }

    const companyId: string = rec.company_id

    // companies (beneficiario)
    const { data: comp } = await supabaseAdmin.from('companies')
      .select('cnpj, razao_social, nome_fantasia')
      .eq('id', companyId).maybeSingle()
    const empresa = (comp ?? { cnpj: '', razao_social: '', nome_fantasia: '' }) as { cnpj: string | null; razao_social: string | null; nome_fantasia: string | null }

    // banco config (agencia / conta / codigo_beneficiario / cooperativa)
    const bancoCodigo = rec.boleto_banco_codigo ?? '756'
    const { data: cfg } = await supabaseAdmin.from('erp_banco_provider_config')
      .select('agencia, conta, cooperativa, codigo_beneficiario, convenio')
      .eq('company_id', companyId)
      .eq('banco_codigo', bancoCodigo)
      .eq('ativo', true)
      .limit(1)
    const cfgRow = (cfg?.[0] ?? {}) as { agencia?: string | null; conta?: string | null; cooperativa?: string | null; codigo_beneficiario?: string | null; convenio?: string | null }

    // pagador
    let pagador: BoletoDados['pagador'] = {
      nome: rec.cliente_nome ?? 'PAGADOR',
      cpfCnpj: '',
      endereco: { logradouro: null, bairro: null, cidade: null, uf: null, cep: null },
    }
    if (rec.cliente_id) {
      const { data: cli } = await supabaseAdmin.from('erp_clientes')
        .select('cpf_cnpj, cnpj_cpf, razao_social, nome_fantasia, cep, logradouro, bairro, cidade, uf')
        .eq('id', rec.cliente_id).maybeSingle()
      if (cli) {
        pagador = {
          nome: (cli.razao_social ?? cli.nome_fantasia ?? rec.cliente_nome ?? 'PAGADOR') as string,
          cpfCnpj: (cli.cpf_cnpj ?? cli.cnpj_cpf ?? '') as string,
          endereco: {
            logradouro: cli.logradouro as string | null,
            bairro: cli.bairro as string | null,
            cidade: cli.cidade as string | null,
            uf: cli.uf as string | null,
            cep: cli.cep as string | null,
          },
        }
      }
    }

    const dados: BoletoDados = {
      banco: { codigo: bancoCodigo, nome: BANCOS[bancoCodigo] ?? 'BANCO' },
      linhaDigitavel: rec.boleto_linha_digitavel,
      codigoBarras: rec.boleto_codigo_barras,
      qrCodePix: rec.boleto_qr_code ?? null,
      beneficiario: {
        nome: (empresa.razao_social ?? empresa.nome_fantasia ?? 'BENEFICIARIO') as string,
        cnpj: (empresa.cnpj ?? '') as string,
        agencia: cfgRow.cooperativa ?? cfgRow.agencia ?? null,
        conta: cfgRow.conta ?? null,
        codigo: cfgRow.codigo_beneficiario ?? null,
      },
      pagador,
      nossoNumero: rec.boleto_nosso_numero ?? '',
      numeroDocumento: rec.numero_documento ?? rec.id.slice(0, 8),
      especieDocumento: 'DM',
      aceite: true,
      dataDocumento: rec.data_emissao ?? rec.data_vencimento,
      dataVencimento: rec.data_vencimento,
      valor: Number(rec.valor),
      instrucoes: [],
    }

    // Gera + upload em try/catch dedicado pra capturar erro real do
    // template (em vez de "Failed to fetch" no front).
    let pdfBytes: Uint8Array
    try {
      pdfBytes = await gerarPdfBoleto(dados)
    } catch (genErr) {
      const stack = genErr instanceof Error ? `${genErr.message}\n${genErr.stack ?? ''}` : String(genErr)
      await logGen(companyId, 'erro', `gerarPdfBoleto falhou: ${stack}`, { receber_id: receberId })
      return NextResponse.json({ ok: false, erro: 'Falha ao gerar o PDF do boleto.', detalhe: stack.slice(0, 500) }, { status: 500 })
    }

    // Upload no bucket e atualiza boleto_url. upsert pra sobrescrever em
    // regeracoes (?force=1 / ?regenerar=true).
    const objectPath = `${companyId}/${receberId}.pdf`
    let boletoUrl: string | null = null
    try {
      const up = await supabaseAdmin.storage.from('boletos')
        .upload(objectPath, Buffer.from(pdfBytes), { contentType: 'application/pdf', upsert: true })
      if (up.error) throw up.error
      const signed = await supabaseAdmin.storage.from('boletos')
        .createSignedUrl(objectPath, 60 * 60 * 24 * 365)
      boletoUrl = signed.data?.signedUrl ?? null
      if (boletoUrl) {
        await supabaseAdmin.from('erp_receber').update({ boleto_url: boletoUrl }).eq('id', receberId)
        await logGen(companyId, 'ok', `pdf gerado e salvo (${pdfBytes.byteLength} bytes)`, { receber_id: receberId })
      }
    } catch (upErr) {
      const msg = upErr instanceof Error ? upErr.message : String(upErr)
      await logGen(companyId, 'erro', `upload/sign falhou: ${msg}`, { receber_id: receberId })
      // segue servindo o PDF inline mesmo sem cache no bucket
    }

    if (asJson) {
      return NextResponse.json({ ok: true, boleto_url: boletoUrl })
    }
    // Serve o PDF inline (browser abre).
    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `inline; filename="boleto-${rec.boleto_nosso_numero ?? receberId}.pdf"`,
        'cache-control': 'private, max-age=60',
      },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, erro: msg }, { status: 500 })
  }
}
