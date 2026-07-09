// Sicredi · Registrar Boleto · Node runtime (REST, sem mTLS).
// Espelha a rota do Sicoob, mas: auth por x-api-key (Vault), banco 748, e o PDF é
// GERADO LOCALMENTE via gerarPdfBoleto (FEBRABAN, agnóstico) — não puxa 2ª via do banco.
// ⚠️ Teste real só após credenciais no Vault (client_id/secret + api_key + beneficiário).
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { Buffer } from 'node:buffer'
import { timingSafeEqual } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { registrarBoleto, type SicrediAmbiente } from '@/lib/banco/sicredi'
import { gerarPdfBoleto } from '@/lib/boleto/gerarPdfBoleto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BANCO = '748'
const PROVIDER = 'sicredi'

function userSupabase(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const auth = req.headers.get('authorization') || ''
  return createClient(url, anon, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } })
}

function temSegredoValido(req: NextRequest): boolean {
  const expected = process.env.PING_SICREDI_SECRET
  const provided = req.headers.get('x-ping-secret') || ''
  if (!expected || !provided) return false
  const A = Buffer.from(provided); const B = Buffer.from(expected)
  if (A.length !== B.length) return false
  return timingSafeEqual(A, B)
}

async function logSync(company_id: string, status: 'ok' | 'erro', mensagem: string, payload: unknown) {
  await supabaseAdmin.from('erp_banco_sync_log').insert({
    company_id, banco_codigo: BANCO, provider: PROVIDER, tipo: 'boleto_registrar',
    status, qtd: 1, mensagem, payload_resumo: payload,
  })
}

export async function POST(req: NextRequest) {
  try {
    const { receber_id, hibrido } = await req.json()
    if (!receber_id) return NextResponse.json({ ok: false, erro: 'receber_id obrigatorio' }, { status: 400 })

    const segredoOk = temSegredoValido(req)
    let sb: ReturnType<typeof userSupabase>
    if (segredoOk) {
      sb = supabaseAdmin as unknown as ReturnType<typeof userSupabase>
    } else {
      sb = userSupabase(req)
      const { data: { user } } = await sb.auth.getUser()
      if (!user) return NextResponse.json({ ok: false, erro: 'nao autenticado' }, { status: 401 })
    }

    // 1) título
    const { data: rec, error: recErr } = await sb.from('erp_receber')
      .select('id, company_id, cliente_id, cliente_nome, valor, data_emissao, data_vencimento, numero_documento, boleto_status, boleto_nosso_numero')
      .eq('id', receber_id).single()
    if (recErr || !rec) return NextResponse.json({ ok: false, erro: 'titulo nao encontrado' }, { status: 404 })
    if (rec.boleto_status === 'registrado' && rec.boleto_nosso_numero) {
      return NextResponse.json({ ok: false, erro: 'titulo ja possui boleto registrado', nosso_numero: rec.boleto_nosso_numero }, { status: 409 })
    }
    const companyId: string = rec.company_id

    // 2) credenciais (Vault)
    let ambiente: SicrediAmbiente = 'producao'
    let credResp = await supabaseAdmin.rpc('fn_banco_obter_credencial', { p_company_id: companyId, p_banco_codigo: BANCO, p_ambiente: 'producao' })
    let credRow = credResp.data as Record<string, unknown> | null
    if (!credRow || credRow.ok === false) {
      credResp = await supabaseAdmin.rpc('fn_banco_obter_credencial', { p_company_id: companyId, p_banco_codigo: BANCO, p_ambiente: 'homologacao' })
      credRow = credResp.data as Record<string, unknown> | null
      ambiente = 'homologacao'
    }
    if (!credRow || credRow.ok === false) {
      await logSync(companyId, 'erro', 'credencial sicredi nao cadastrada', { receber_id })
      return NextResponse.json({ ok: false, erro: 'Cadastre a Integracao bancaria Sicredi antes (Cadastros -> Contas bancarias).' }, { status: 412 })
    }

    const clientId = credRow.client_id as string | null
    const clientSecret = credRow.client_secret as string | null
    const apiKey = credRow.api_key as string | null
    const cooperativa = (credRow.cooperativa as string | null) ?? ''
    const conta = (credRow.conta as string | null) ?? ''
    const agencia = (credRow.agencia as string | null) ?? null
    const codigoBeneficiario = (credRow.codigo_beneficiario as string | null) ?? ''
    const convenio = (credRow.convenio as string | null) ?? null
    const carteira = (credRow.carteira as string | null) ?? null
    const jurosPct = (credRow.juros_pct as number | null) ?? null
    const multaPct = (credRow.multa_pct as number | null) ?? null

    if (!clientId || !clientSecret || !apiKey) {
      await logSync(companyId, 'erro', 'client_id/secret ou api_key ausentes', { receber_id })
      return NextResponse.json({ ok: false, erro: 'client_id / client_secret / x-api-key faltando na Integracao Sicredi.' }, { status: 412 })
    }
    if (!codigoBeneficiario) {
      await logSync(companyId, 'erro', 'codigo_beneficiario ausente', { receber_id })
      return NextResponse.json({ ok: false, erro: 'Codigo do beneficiario faltando na config Sicredi.' }, { status: 412 })
    }

    // 3) pagador (cliente)
    let pagador: { tipo: 'PF' | 'PJ'; documento: string; nome: string; logradouro: string | null; bairro: string | null; cidade: string | null; uf: string | null; cep: string | null }
    if (rec.cliente_id) {
      const { data: cli } = await supabaseAdmin.from('erp_clientes')
        .select('tipo_pessoa, cpf_cnpj, cnpj_cpf, razao_social, nome_fantasia, cep, logradouro, bairro, cidade, uf')
        .eq('id', rec.cliente_id).single()
      const tipoPessoa = (cli?.tipo_pessoa ?? '').toUpperCase().startsWith('F') ? 'PF' : 'PJ'
      pagador = {
        tipo: tipoPessoa,
        documento: (cli?.cpf_cnpj ?? cli?.cnpj_cpf ?? '') as string,
        nome: (cli?.razao_social ?? cli?.nome_fantasia ?? rec.cliente_nome ?? '') as string,
        logradouro: (cli?.logradouro ?? null) as string | null,
        bairro: (cli?.bairro ?? null) as string | null,
        cidade: (cli?.cidade ?? null) as string | null,
        uf: (cli?.uf ?? null) as string | null,
        cep: (cli?.cep ?? null) as string | null,
      }
    } else {
      pagador = { tipo: 'PJ', documento: '', nome: rec.cliente_nome ?? 'PAGADOR', logradouro: null, bairro: null, cidade: null, uf: null, cep: null }
    }
    if (!pagador.documento) {
      await logSync(companyId, 'erro', 'cliente sem CPF/CNPJ', { receber_id })
      return NextResponse.json({ ok: false, erro: 'Cliente sem CPF/CNPJ — necessario para registrar boleto.' }, { status: 412 })
    }

    // 4) datas (fuso SP; emissao <= hoje, vencimento >= emissao)
    const hojeSP = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
    const emissaoPretendida = rec.data_emissao ?? hojeSP
    const emissaoISO = emissaoPretendida > hojeSP ? hojeSP : emissaoPretendida
    const vencimentoISO = rec.data_vencimento < emissaoISO ? emissaoISO : rec.data_vencimento
    const seuNumero = (rec.numero_documento ?? rec.id.slice(0, 12)).toString()

    // 5) registrar no Sicredi
    const cred = {
      client_id: clientId, client_secret: clientSecret, api_key: apiKey, ambiente,
      codigo_beneficiario: codigoBeneficiario, cooperativa, conta, agencia, convenio, carteira,
      juros_pct: jurosPct, multa_pct: multaPct,
    }
    const result = await registrarBoleto({
      cred, seuNumero, valor: Number(rec.valor), emissaoISO, vencimentoISO, pagador,
      hibrido: hibrido ?? true,
    })
    if (result.status < 200 || result.status >= 300 || !result.nuTituloGerado || !result.linhaDigitavel || !result.codigoBarras) {
      await logSync(companyId, 'erro', `registro falhou: status ${result.status}`, { receber_id, raw: result.raw, payload_enviado: result.payload_resumo })
      return NextResponse.json({ ok: false, erro: 'Sicredi recusou o registro do boleto.', detalhes: result.raw }, { status: 502 })
    }

    // 6) gerar PDF localmente (FEBRABAN) + subir no storage
    let boletoUrl: string | null = null
    try {
      const { data: comp } = await supabaseAdmin.from('companies').select('razao_social, nome_fantasia, cnpj').eq('id', companyId).single()
      const pdfBytes = await gerarPdfBoleto({
        banco: { codigo: BANCO, nome: 'Sicredi' },
        linhaDigitavel: result.linhaDigitavel,
        codigoBarras: result.codigoBarras,
        qrCodePix: result.qrCode ?? null,
        beneficiario: {
          nome: (comp?.razao_social ?? comp?.nome_fantasia ?? 'BENEFICIARIO') as string,
          cnpj: (comp?.cnpj ?? '') as string,
          agencia, conta, codigo: codigoBeneficiario,
        },
        pagador: {
          nome: pagador.nome, cpfCnpj: pagador.documento,
          endereco: { logradouro: pagador.logradouro, bairro: pagador.bairro, cidade: pagador.cidade, uf: pagador.uf, cep: pagador.cep },
        },
        nossoNumero: result.nuTituloGerado,
        numeroDocumento: seuNumero,
        especieDocumento: 'DM',
        aceite: false,
        dataDocumento: emissaoISO,
        dataVencimento: vencimentoISO,
        valor: Number(rec.valor),
        instrucoes: [credRow.instrucao_linha1, credRow.instrucao_linha2, credRow.instrucao_linha3, credRow.instrucao_linha4].filter((x): x is string => !!x),
      })
      const objectPath = `${companyId}/${receber_id}.pdf`
      const up = await supabaseAdmin.storage.from('boletos').upload(objectPath, Buffer.from(pdfBytes), { contentType: 'application/pdf', upsert: true })
      if (!up.error) {
        const signed = await supabaseAdmin.storage.from('boletos').createSignedUrl(objectPath, 60 * 60 * 24 * 365)
        if (signed.data?.signedUrl) boletoUrl = signed.data.signedUrl
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      await logSync(companyId, 'erro', `geracao/upload PDF Sicredi falhou: ${msg}`, { receber_id })
    }

    // 7) persistir no título
    await supabaseAdmin.from('erp_receber').update({
      boleto_nosso_numero: result.nuTituloGerado,
      boleto_linha_digitavel: result.linhaDigitavel,
      boleto_codigo_barras: result.codigoBarras ?? null,
      boleto_qr_code: result.qrCode ?? null,
      boleto_url: boletoUrl,
      boleto_banco_codigo: BANCO,
      boleto_status: 'registrado',
      boleto_emitido_em: new Date().toISOString(),
      boleto_id_externo: result.txid ?? result.nuTituloGerado,
    }).eq('id', receber_id)

    await logSync(companyId, 'ok', `boleto registrado nu=${result.nuTituloGerado}${result.qrCode ? ' (hibrido Pix)' : ''}${boletoUrl ? ' (PDF salvo)' : ' (sem PDF)'}`, { receber_id, ambiente })

    return NextResponse.json({
      ok: true, nosso_numero: result.nuTituloGerado, linha_digitavel: result.linhaDigitavel,
      codigo_barras: result.codigoBarras ?? null, qr_code: result.qrCode ?? null, boleto_url: boletoUrl, ambiente,
    })
  } catch (e) {
    const erro = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, erro }, { status: 500 })
  }
}
