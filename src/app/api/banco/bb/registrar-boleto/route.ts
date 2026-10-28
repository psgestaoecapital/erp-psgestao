// Banco do Brasil · Registrar Boleto (Cobrança v2) · Node runtime. #5404 parte b.
// Credencial via fn_banco_obter_credencial (Vault); convênio/carteira/variação/modalidade da config do ambiente.
// Ambiente: produção se houver config BB ativa de produção, senão homologação (boleto de teste).
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { Buffer } from 'node:buffer'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { onlyDigitsDoc, tipoPessoaPorDocumento } from '@/lib/banco/documento'
import { faltasCredencialBb, type BbAmbiente } from '@/lib/banco/bb'
import { faltasCobrancaBb, montarCorpoRegistroBb, registrarBoletoBb, erroBb } from '@/lib/banco/bb/cobranca'
import { gerarPdfBoleto } from '@/lib/boleto/gerarPdfBoleto'
import { salvarPdfBoletoNoBucket } from '@/lib/boleto/salvarPdfBoleto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BANCO = '001'

function userSupabase(req: NextRequest) {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: req.headers.get('authorization') || '' } },
    auth: { persistSession: false },
  })
}

async function logSync(company_id: string, status: 'ok' | 'erro', mensagem: string, payload: unknown) {
  await supabaseAdmin.from('erp_banco_sync_log').insert({
    company_id, banco_codigo: BANCO, provider: 'bb', tipo: 'boleto_registrar', status, qtd: 1, mensagem, payload_resumo: payload,
  })
}

export async function POST(req: NextRequest) {
  try {
    const { receber_id } = await req.json()
    if (!receber_id) return NextResponse.json({ ok: false, erro: 'receber_id obrigatorio' }, { status: 400 })
    const sb = userSupabase(req)
    const { data: { user } } = await sb.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, erro: 'nao autenticado' }, { status: 401 })

    const { data: rec, error: recErr } = await sb.from('erp_receber')
      .select('id, company_id, cliente_id, cliente_nome, valor, data_emissao, data_vencimento, numero_documento, boleto_status, boleto_nosso_numero')
      .eq('id', receber_id).single()
    if (recErr || !rec) return NextResponse.json({ ok: false, erro: 'titulo nao encontrado' }, { status: 404 })
    if (rec.boleto_status === 'registrado' && rec.boleto_nosso_numero) {
      return NextResponse.json({ ok: false, erro: 'titulo ja possui boleto registrado', nosso_numero: rec.boleto_nosso_numero }, { status: 409 })
    }
    const companyId: string = rec.company_id

    // credencial: produção ativa vence; senão homologação
    let ambiente: BbAmbiente = 'producao'
    let credRow = (await supabaseAdmin.rpc('fn_banco_obter_credencial', { p_company_id: companyId, p_banco_codigo: BANCO, p_ambiente: 'producao' })).data as Record<string, unknown> | null
    if (!credRow || credRow.ok === false) {
      ambiente = 'homologacao'
      credRow = (await supabaseAdmin.rpc('fn_banco_obter_credencial', { p_company_id: companyId, p_banco_codigo: BANCO, p_ambiente: 'homologacao' })).data as Record<string, unknown> | null
    }
    if (!credRow || credRow.ok === false) {
      await logSync(companyId, 'erro', 'credencial bb nao cadastrada', { receber_id })
      return NextResponse.json({ ok: false, erro: 'Cadastre a conexão do Banco do Brasil antes (Financeiro › Conexões bancárias).' }, { status: 412 })
    }
    const cred = {
      client_id: String(credRow.client_id ?? ''), client_secret: String(credRow.client_secret ?? ''),
      app_key: String(credRow.api_key ?? ''), ambiente,
    }
    const faltaCred = faltasCredencialBb(cred)
    if (faltaCred.length) return NextResponse.json({ ok: false, erro: `Falta preencher na conexão do BB: ${faltaCred.join(', ')}.` }, { status: 412 })

    // dados de cobrança do AMBIENTE (função de credencial protegida não devolve variação/modalidade — SELECT leve)
    const { data: cfgRow } = await supabaseAdmin.from('erp_banco_provider_config')
      .select('convenio, carteira, variacao_carteira, modalidade')
      .eq('company_id', companyId).eq('banco_codigo', BANCO).eq('ambiente', ambiente).maybeSingle()
    const cfg = {
      convenio: (cfgRow?.convenio as string | null) ?? null, carteira: (cfgRow?.carteira as string | null) ?? null,
      variacao: (cfgRow?.variacao_carteira as string | null) ?? null, modalidade: (cfgRow?.modalidade as number | null) ?? null,
    }
    const faltaCob = faltasCobrancaBb(cfg)
    if (faltaCob.length) {
      return NextResponse.json({ ok: false, erro: `Falta preencher na conexão do BB (${ambiente}): ${faltaCob.join(', ')}.` }, { status: 412 })
    }

    const { data: empresa } = await supabaseAdmin.from('companies').select('cnpj, razao_social, nome_fantasia').eq('id', companyId).single()
    if (!empresa?.cnpj) return NextResponse.json({ ok: false, erro: 'Empresa sem CNPJ cadastrado.' }, { status: 412 })

    let pagador = { documento: '', nome: String(rec.cliente_nome ?? 'PAGADOR'), logradouro: null as string | null, numero: null as string | null,
      bairro: null as string | null, cidade: null as string | null, uf: null as string | null, cep: null as string | null }
    if (rec.cliente_id) {
      const { data: cli } = await supabaseAdmin.from('erp_clientes')
        .select('cpf_cnpj, cnpj_cpf, razao_social, nome_fantasia, cep, logradouro, numero, bairro, cidade, uf').eq('id', rec.cliente_id).single()
      pagador = {
        documento: (cli?.cpf_cnpj ?? cli?.cnpj_cpf ?? '') as string,
        nome: (cli?.razao_social ?? cli?.nome_fantasia ?? rec.cliente_nome ?? '') as string,
        logradouro: (cli?.logradouro ?? null) as string | null, numero: (cli?.numero ?? null) as string | null,
        bairro: (cli?.bairro ?? null) as string | null, cidade: (cli?.cidade ?? null) as string | null,
        uf: (cli?.uf ?? null) as string | null, cep: (cli?.cep ?? null) as string | null,
      }
    }
    const docDigitos = onlyDigitsDoc(pagador.documento)
    if (!docDigitos) return NextResponse.json({ ok: false, erro: 'Cliente sem CPF/CNPJ — necessario para registrar boleto.' }, { status: 412 })
    if (!tipoPessoaPorDocumento(docDigitos)) {
      return NextResponse.json({ ok: false, erro: `O CPF/CNPJ do cliente esta incompleto (tem ${docDigitos.length} digito(s); precisa de 11 para CPF ou 14 para CNPJ) — corrija no cadastro do cliente antes de gerar o boleto.` }, { status: 412 })
    }

    const seq = await supabaseAdmin.rpc('fn_banco_proximo_seu_numero', { p_company_id: companyId, p_banco_codigo: BANCO, p_ambiente: ambiente })
    if (seq.error || !seq.data) return NextResponse.json({ ok: false, erro: 'Falha ao gerar o numero do boleto (config do BB nao encontrada).' }, { status: 500 })
    const seuNumero = String(rec.numero_documento ?? rec.id.slice(0, 12))
    const emissaoISO = rec.data_emissao ?? new Date().toISOString().slice(0, 10)

    const corpo = montarCorpoRegistroBb({
      cfg, seuNumero, nossoNumeroSeq: String(seq.data), emissaoISO, vencimentoISO: rec.data_vencimento, valor: Number(rec.valor),
      pagador: { ...pagador, documento: docDigitos },
      jurosPct: (credRow.juros_pct as number | null) ?? null, multaPct: (credRow.multa_pct as number | null) ?? null,
    })
    const res = await registrarBoletoBb(cred, corpo)
    if (res.status < 200 || res.status >= 300 || !res.numero || !res.linhaDigitavel) {
      await logSync(companyId, 'erro', `registro falhou: status ${res.status}`, { receber_id, ambiente, raw: res.raw.slice(0, 1500) })
      return NextResponse.json({ ok: false, erro: erroBb(res.status, res.raw) }, { status: 502 })
    }

    // PDF: gerador FEBRABAN local (linha digitável + código de barras). Falha aqui não derruba o registro.
    let boletoUrl: string | null = null
    try {
      const cdBarras = (res.codigoBarras ?? '').replace(/\D/g, '')
      if (cdBarras.length !== 44) throw new Error(`código de barras inesperado (${cdBarras.length} díg., esperado 44)`)
      const bytes = await gerarPdfBoleto({
        banco: { codigo: BANCO, nome: 'Banco do Brasil' },
        linhaDigitavel: res.linhaDigitavel, codigoBarras: cdBarras, qrCodePix: null,
        beneficiario: {
          nome: (empresa.razao_social ?? empresa.nome_fantasia ?? 'BENEFICIARIO') as string, cnpj: (empresa.cnpj ?? '') as string,
          agencia: (credRow.agencia as string | null) ?? null, conta: (credRow.conta as string | null) ?? null, codigo: cfg.convenio,
        },
        pagador: { nome: pagador.nome, cpfCnpj: docDigitos,
          endereco: { logradouro: pagador.logradouro, bairro: pagador.bairro, cidade: pagador.cidade, uf: pagador.uf, cep: pagador.cep } },
        nossoNumero: res.numero, numeroDocumento: seuNumero, especieDocumento: 'DM', aceite: false,
        dataDocumento: emissaoISO, dataVencimento: rec.data_vencimento, valor: Number(rec.valor),
        instrucoes: [credRow.instrucao_linha1, credRow.instrucao_linha2, credRow.instrucao_linha3, credRow.instrucao_linha4].filter((x): x is string => !!x),
      })
      const saved = await salvarPdfBoletoNoBucket(companyId, receber_id, Buffer.from(bytes))
      if (saved.erro) throw new Error(saved.erro)
      boletoUrl = saved.url
    } catch (e) {
      await logSync(companyId, 'erro', `PDF BB (gerador local) falhou: ${e instanceof Error ? e.message : String(e)}`, { receber_id })
    }

    await supabaseAdmin.from('erp_receber').update({
      boleto_nosso_numero: res.numero, boleto_linha_digitavel: res.linhaDigitavel, boleto_codigo_barras: res.codigoBarras ?? null,
      boleto_url: boletoUrl, boleto_banco_codigo: BANCO, boleto_status: 'registrado',
      boleto_emitido_em: new Date().toISOString(), boleto_id_externo: res.numero,
    }).eq('id', receber_id)
    await logSync(companyId, 'ok', `boleto BB registrado numero=${res.numero} (${ambiente})${boletoUrl ? '' : ' (sem PDF)'}`, { receber_id, ambiente })

    return NextResponse.json({ ok: true, nosso_numero: res.numero, linha_digitavel: res.linhaDigitavel,
      codigo_barras: res.codigoBarras ?? null, boleto_url: boletoUrl, ambiente })
  } catch (e) {
    return NextResponse.json({ ok: false, erro: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
