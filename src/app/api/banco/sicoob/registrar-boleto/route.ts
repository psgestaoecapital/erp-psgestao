// Sicoob · Registrar Boleto · Node runtime (mTLS).
// Le credencial via fn_banco_obter_credencial (Vault) — diferente do Bradesco
// que usa erp_certificados_a1 fiscal. Aqui o A1 bancario vive no Vault.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { Buffer } from 'node:buffer'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { registrarBoleto, type SicoobAmbiente } from '@/lib/banco/sicoob'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BANCO = '756'

function userSupabase(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const auth = req.headers.get('authorization') || ''
  return createClient(url, anon, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  })
}

async function logSync(company_id: string, status: 'ok' | 'erro', mensagem: string, payload: unknown) {
  await supabaseAdmin.from('erp_banco_sync_log').insert({
    company_id, banco_codigo: BANCO, provider: 'sicoob', tipo: 'boleto_registrar',
    status, qtd: 1, mensagem, payload_resumo: payload,
  })
}

export async function POST(req: NextRequest) {
  try {
    const { receber_id, hibrido } = await req.json()
    if (!receber_id) return NextResponse.json({ ok: false, erro: 'receber_id obrigatorio' }, { status: 400 })

    const sb = userSupabase(req)
    const { data: { user } } = await sb.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, erro: 'nao autenticado' }, { status: 401 })

    // 1) titulo (RLS via token do usuario)
    const { data: rec, error: recErr } = await sb.from('erp_receber')
      .select('id, company_id, cliente_id, cliente_nome, valor, data_emissao, data_vencimento, numero_documento, boleto_status, boleto_nosso_numero')
      .eq('id', receber_id).single()
    if (recErr || !rec) return NextResponse.json({ ok: false, erro: 'titulo nao encontrado' }, { status: 404 })
    if (rec.boleto_status === 'registrado' && rec.boleto_nosso_numero) {
      return NextResponse.json({
        ok: false, erro: 'titulo ja possui boleto registrado',
        nosso_numero: rec.boleto_nosso_numero,
      }, { status: 409 })
    }
    const companyId: string = rec.company_id

    // 2) credenciais (Vault, via service role)
    let ambiente: SicoobAmbiente = 'producao'
    let credResp = await supabaseAdmin.rpc('fn_banco_obter_credencial', {
      p_company_id: companyId, p_banco_codigo: BANCO, p_ambiente: 'producao',
    })
    let credRow = credResp.data as Record<string, unknown> | null
    if (!credRow || credRow.ok === false) {
      credResp = await supabaseAdmin.rpc('fn_banco_obter_credencial', {
        p_company_id: companyId, p_banco_codigo: BANCO, p_ambiente: 'homologacao',
      })
      credRow = credResp.data as Record<string, unknown> | null
      ambiente = 'homologacao'
    }
    if (!credRow || credRow.ok === false) {
      await logSync(companyId, 'erro', 'credencial sicoob nao cadastrada', { receber_id })
      return NextResponse.json({ ok: false, erro: 'Cadastre a Integracao bancaria Sicoob antes (Cadastros -> Contas bancarias).' }, { status: 412 })
    }

    const clientId = credRow.client_id as string | null
    const certBase64 = credRow.cert_base64 as string | null
    const certSenha = credRow.cert_senha as string | null
    const cooperativa = (credRow.cooperativa as string | null) ?? ''
    const conta = (credRow.conta as string | null) ?? ''
    const codigoBeneficiario = (credRow.codigo_beneficiario as string | null) ?? ''
    const convenio = (credRow.convenio as string | null) ?? ''

    if (!clientId || !certBase64 || !certSenha) {
      await logSync(companyId, 'erro', 'client_id ou certificado ausentes', { receber_id })
      return NextResponse.json({ ok: false, erro: 'client_id / certificado / senha faltando na Integracao Sicoob.' }, { status: 412 })
    }
    if (!cooperativa || !conta || !codigoBeneficiario) {
      await logSync(companyId, 'erro', 'cooperativa/conta/beneficiario ausentes na config', { receber_id })
      return NextResponse.json({ ok: false, erro: 'Cooperativa, conta ou codigo do beneficiario faltando.' }, { status: 412 })
    }

    const pfx = Buffer.from(certBase64, 'base64')

    // 3) pagador (cliente)
    let pagador: {
      tipo: 'PF' | 'PJ'; documento: string; nome: string
      logradouro: string | null; bairro: string | null; cidade: string | null
      uf: string | null; cep: string | null
    }
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
      pagador = {
        tipo: 'PJ', documento: '', nome: rec.cliente_nome ?? 'PAGADOR',
        logradouro: null, bairro: null, cidade: null, uf: null, cep: null,
      }
    }
    if (!pagador.documento) {
      await logSync(companyId, 'erro', 'cliente sem CPF/CNPJ', { receber_id })
      return NextResponse.json({ ok: false, erro: 'Cliente sem CPF/CNPJ — necessario para registrar boleto.' }, { status: 412 })
    }

    // 4) registrar
    const result = await registrarBoleto({
      cred: {
        client_id: clientId, ambiente,
        pfx, passphrase: certSenha,
        cooperativa, conta, codigo_beneficiario: codigoBeneficiario, convenio,
      },
      seuNumero: (rec.numero_documento ?? rec.id.slice(0, 12)).toString(),
      valor: Number(rec.valor),
      emissaoISO: rec.data_emissao ?? new Date().toISOString().slice(0, 10),
      vencimentoISO: rec.data_vencimento,
      pagador,
      hibrido: hibrido ?? true, // default: boleto + Pix QR
    })

    if (result.status < 200 || result.status >= 300 || !result.nuTituloGerado || !result.linhaDigitavel) {
      await logSync(companyId, 'erro', `registro falhou: status ${result.status}`, {
        receber_id, raw: result.raw, payload_enviado: result.payload_resumo,
      })
      return NextResponse.json({
        ok: false, erro: 'Sicoob recusou o registro do boleto.', detalhes: result.raw,
      }, { status: 502 })
    }

    // 5) persistir no titulo
    await supabaseAdmin.from('erp_receber').update({
      boleto_nosso_numero: result.nuTituloGerado,
      boleto_linha_digitavel: result.linhaDigitavel,
      boleto_codigo_barras: result.codigoBarras ?? null,
      boleto_qr_code: result.qrCode ?? null,
      boleto_banco_codigo: BANCO,
      boleto_status: 'registrado',
      boleto_emitido_em: new Date().toISOString(),
      boleto_id_externo: result.nuTituloGerado,
    }).eq('id', receber_id)

    await logSync(companyId, 'ok',
      `boleto registrado nu=${result.nuTituloGerado}${result.qrCode ? ' (hibrido com Pix)' : ''}`,
      { receber_id, ambiente })

    return NextResponse.json({
      ok: true,
      nosso_numero: result.nuTituloGerado,
      linha_digitavel: result.linhaDigitavel,
      codigo_barras: result.codigoBarras ?? null,
      qr_code: result.qrCode ?? null,
      ambiente,
    })
  } catch (e) {
    const erro = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, erro }, { status: 500 })
  }
}
