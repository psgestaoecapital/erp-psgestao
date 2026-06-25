// Bradesco · Registrar Boleto · Node runtime (mTLS).
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { Buffer } from 'node:buffer'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { registrarBoleto, type BradescoAmbiente } from '@/lib/banco/bradesco'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BANCO = '237'

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
    company_id, banco_codigo: BANCO, provider: 'bradesco', tipo: 'boleto_registrar',
    status, qtd: 1, mensagem, payload_resumo: payload,
  })
}

export async function POST(req: NextRequest) {
  try {
    const { receber_id } = await req.json()
    if (!receber_id) return NextResponse.json({ ok: false, erro: 'receber_id obrigatorio' }, { status: 400 })

    const sb = userSupabase(req)
    const { data: { user } } = await sb.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, erro: 'nao autenticado' }, { status: 401 })

    // 1) tituto (RLS aplica via token do usuario)
    const { data: rec, error: recErr } = await sb.from('erp_receber')
      .select('id, company_id, cliente_id, cliente_nome, valor, data_emissao, data_vencimento, numero_documento, boleto_status, boleto_nosso_numero')
      .eq('id', receber_id).single()
    if (recErr || !rec) return NextResponse.json({ ok: false, erro: 'titulo nao encontrado' }, { status: 404 })
    if (rec.boleto_status === 'registrado' && rec.boleto_nosso_numero) {
      return NextResponse.json({ ok: false, erro: 'titulo ja possui boleto registrado',
        nosso_numero: rec.boleto_nosso_numero }, { status: 409 })
    }

    const companyId: string = rec.company_id

    // 2) credenciais (Vault, via service role)
    const credResp = await supabaseAdmin.rpc('fn_banco_obter_credencial', {
      p_company_id: companyId, p_banco_codigo: BANCO, p_ambiente: 'producao',
    })
    let credRow = credResp.data as Record<string, unknown> | null
    let ambiente: BradescoAmbiente = 'producao'
    if (!credRow || credRow.ok === false) {
      const sb2 = await supabaseAdmin.rpc('fn_banco_obter_credencial', {
        p_company_id: companyId, p_banco_codigo: BANCO, p_ambiente: 'sandbox',
      })
      credRow = sb2.data as Record<string, unknown> | null
      ambiente = 'sandbox'
    }
    if (!credRow || credRow.ok === false) {
      await logSync(companyId, 'erro', 'credencial bradesco nao cadastrada', { receber_id })
      return NextResponse.json({ ok: false, erro: 'Cadastre a Integracao bancaria Bradesco antes (Cadastros -> Contas bancarias).' }, { status: 412 })
    }
    const clientId = credRow.client_id as string | null
    const clientSecret = credRow.client_secret as string | null
    const certSenha = credRow.cert_senha as string | null
    if (!clientId || !clientSecret) {
      await logSync(companyId, 'erro', 'client_id/secret ausentes', { receber_id })
      return NextResponse.json({ ok: false, erro: 'client_id/client_secret faltando na Integracao API.' }, { status: 412 })
    }
    if (!certSenha) {
      await logSync(companyId, 'erro', 'senha do certificado A1 para uso bancario nao cadastrada', { receber_id })
      return NextResponse.json({ ok: false, erro: 'Cadastre a senha do certificado A1 (campo "Senha do A1 para uso bancario" em Integracao API).' }, { status: 412 })
    }

    // 3) cert A1 fiscal (bucket -> Buffer .pfx)
    const { data: cert, error: certErr } = await supabaseAdmin.from('erp_certificados_a1')
      .select('storage_bucket, storage_path, validade_fim, status')
      .eq('company_id', companyId).eq('status', 'ativo').gte('validade_fim', new Date().toISOString().slice(0, 10))
      .order('validade_fim', { ascending: false }).limit(1).single()
    if (certErr || !cert) {
      await logSync(companyId, 'erro', 'certificado A1 ativo nao encontrado', { receber_id })
      return NextResponse.json({ ok: false, erro: 'Certificado A1 ativo nao encontrado para esta empresa.' }, { status: 412 })
    }
    const dl = await supabaseAdmin.storage.from(cert.storage_bucket).download(cert.storage_path)
    if (dl.error || !dl.data) {
      await logSync(companyId, 'erro', `download cert falhou: ${dl.error?.message ?? 'sem dados'}`, { receber_id })
      return NextResponse.json({ ok: false, erro: 'Falha ao baixar certificado A1.' }, { status: 500 })
    }
    const pfx = Buffer.from(await dl.data.arrayBuffer())

    // 4) empresa (CNPJ)
    const { data: empresa } = await supabaseAdmin.from('companies').select('cnpj').eq('id', companyId).single()
    if (!empresa?.cnpj) {
      await logSync(companyId, 'erro', 'empresa sem CNPJ', { receber_id })
      return NextResponse.json({ ok: false, erro: 'Empresa sem CNPJ cadastrado.' }, { status: 412 })
    }

    // 5) pagador (cliente)
    let pagador: {
      tipo: 'PF' | 'PJ'; documento: string; nome: string;
      logradouro: string | null; numero: string | null; bairro: string | null;
      cidade: string | null; uf: string | null; cep: string | null;
    }
    if (rec.cliente_id) {
      const { data: cli } = await supabaseAdmin.from('erp_clientes')
        .select('tipo_pessoa, cpf_cnpj, cnpj_cpf, razao_social, nome_fantasia, cep, logradouro, numero, bairro, cidade, uf')
        .eq('id', rec.cliente_id).single()
      const tipoPessoa = (cli?.tipo_pessoa ?? '').toUpperCase().startsWith('F') ? 'PF' : 'PJ'
      pagador = {
        tipo: tipoPessoa,
        documento: (cli?.cpf_cnpj ?? cli?.cnpj_cpf ?? '') as string,
        nome: (cli?.razao_social ?? cli?.nome_fantasia ?? rec.cliente_nome ?? '') as string,
        logradouro: (cli?.logradouro ?? null) as string | null,
        numero: (cli?.numero ?? null) as string | null,
        bairro: (cli?.bairro ?? null) as string | null,
        cidade: (cli?.cidade ?? null) as string | null,
        uf: (cli?.uf ?? null) as string | null,
        cep: (cli?.cep ?? null) as string | null,
      }
    } else {
      pagador = {
        tipo: 'PJ', documento: '', nome: rec.cliente_nome ?? 'PAGADOR',
        logradouro: null, numero: null, bairro: null, cidade: null, uf: null, cep: null,
      }
    }
    if (!pagador.documento) {
      await logSync(companyId, 'erro', 'cliente sem CPF/CNPJ', { receber_id })
      return NextResponse.json({ ok: false, erro: 'Cliente sem CPF/CNPJ — necessario para registrar boleto.' }, { status: 412 })
    }

    // 6) registrar
    const result = await registrarBoleto({
      cred: {
        client_id: clientId, client_secret: clientSecret, ambiente,
        pfx, passphrase: certSenha,
      },
      cnpjBeneficiario: empresa.cnpj,
      agencia: (credRow.agencia ?? '') as string,
      conta: (credRow.conta ?? '') as string,
      carteira: ((credRow.carteira ?? '09') as string),
      convenio: (credRow.convenio as string | null) ?? null,
      codigoBeneficiario: (credRow.codigo_beneficiario as string | null) ?? null,
      nuCliente: (rec.numero_documento ?? rec.id.slice(0, 12)).toString(),
      emissaoISO: rec.data_emissao ?? new Date().toISOString().slice(0, 10),
      vencimentoISO: rec.data_vencimento,
      valor: Number(rec.valor),
      pagador,
      jurosPct: (credRow.juros_pct as number | null) ?? null,
      multaPct: (credRow.multa_pct as number | null) ?? null,
      instrucoes: [
        credRow.instrucao_linha1 as string | null,
        credRow.instrucao_linha2 as string | null,
        credRow.instrucao_linha3 as string | null,
        credRow.instrucao_linha4 as string | null,
      ],
    })

    if (result.status < 200 || result.status >= 300 || !result.nuTituloGerado || !result.linhaDigitavel) {
      // Log diagnostico: payload enviado (mascarado) + raw da resposta
      await logSync(companyId, 'erro', `registro falhou: status ${result.status}`, {
        receber_id, raw: result.raw, payload_enviado: result.payload_resumo,
      })
      return NextResponse.json({ ok: false, erro: 'Bradesco recusou o registro do boleto.', detalhes: result.raw }, { status: 502 })
    }

    // 7) persistir
    await supabaseAdmin.from('erp_receber').update({
      boleto_nosso_numero: result.nuTituloGerado,
      boleto_linha_digitavel: result.linhaDigitavel,
      boleto_codigo_barras: result.cdBarras ?? null,
      boleto_banco_codigo: BANCO,
      boleto_status: 'registrado',
      boleto_emitido_em: new Date().toISOString(),
      boleto_id_externo: result.nuTituloGerado,
    }).eq('id', receber_id)

    await logSync(companyId, 'ok', `boleto registrado nu=${result.nuTituloGerado}`, { receber_id, ambiente })

    return NextResponse.json({
      ok: true,
      nosso_numero: result.nuTituloGerado,
      linha_digitavel: result.linhaDigitavel,
      codigo_barras: result.cdBarras ?? null,
      ambiente,
    })
  } catch (e) {
    const erro = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, erro }, { status: 500 })
  }
}
