// Banco do Brasil · Registrar Boleto (Cobrança v2) · Node runtime, sem mTLS. Chamado #5404 (FC Pisos).
// Mesmo contrato das rotas Sicredi/Sicoob: { receber_id } → grava o boleto no título. Ambiente = o da config ativa
// (homologação enquanto a FC Pisos testa: o boleto é de TESTE e a resposta devolve o ambiente).
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { Buffer } from 'node:buffer'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { faltasCredencialBb } from '@/lib/banco/bb'
import { faltasCobrancaBb, nossoNumeroBb, registrarBoletoBb } from '@/lib/banco/bb/cobranca'
import { BB_BANCO, carregarCredBb, logSyncBb } from '@/lib/banco/bb/servidor'
import { gerarPdfBoleto } from '@/lib/boleto/gerarPdfBoleto'
import { salvarPdfBoletoNoBucket } from '@/lib/boleto/salvarPdfBoleto'
import { onlyDigitsDoc, tipoPessoaPorDocumento } from '@/lib/banco/documento'
import { extractBankMessage } from '@/lib/banco/bankError'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  let companyIdLog: string | null = null
  let receberIdLog: unknown = null
  try {
    const { receber_id } = await req.json()
    receberIdLog = receber_id
    if (!receber_id) return NextResponse.json({ ok: false, erro: 'receber_id obrigatorio' }, { status: 400 })
    try {
      const { data: recCo } = await supabaseAdmin.from('erp_receber').select('company_id').eq('id', receber_id).maybeSingle()
      if (recCo?.company_id) companyIdLog = recCo.company_id as string
    } catch { /* só para log */ }

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      global: { headers: { Authorization: req.headers.get('authorization') || '' } }, auth: { persistSession: false },
    })
    const { data: { user } } = await sb.auth.getUser()
    if (!user) {
      if (companyIdLog) await logSyncBb(companyIdLog, 'boleto_registrar', 'erro', 'nao autenticado (sessao ausente/expirada)', { receber_id })
      return NextResponse.json({ ok: false, erro: 'nao autenticado' }, { status: 401 })
    }

    // título lido com o token do usuário: a RLS garante que só registra boleto da própria empresa
    const { data: rec, error: recErr } = await sb.from('erp_receber')
      .select('id, company_id, cliente_id, cliente_nome, valor, data_emissao, data_vencimento, numero_documento, boleto_status, boleto_nosso_numero')
      .eq('id', receber_id).single()
    if (recErr || !rec) {
      if (companyIdLog) await logSyncBb(companyIdLog, 'boleto_registrar', 'erro', `titulo nao encontrado / RLS bloqueou leitura${recErr?.message ? ': ' + recErr.message : ''}`, { receber_id })
      return NextResponse.json({ ok: false, erro: 'titulo nao encontrado' }, { status: 404 })
    }
    if (rec.boleto_status === 'registrado' && rec.boleto_nosso_numero) {
      return NextResponse.json({ ok: false, erro: 'titulo ja possui boleto registrado', nosso_numero: rec.boleto_nosso_numero }, { status: 409 })
    }
    const companyId: string = rec.company_id
    companyIdLog = companyId

    const c = await carregarCredBb(companyId)
    if (!c) {
      await logSyncBb(companyId, 'boleto_registrar', 'erro', 'config do Banco do Brasil nao cadastrada/ativa', { receber_id })
      return NextResponse.json({ ok: false, erro: 'Cadastre a Integração bancária do Banco do Brasil antes (Conexões bancárias).' }, { status: 412 })
    }
    const faltas = [...faltasCredencialBb(c.cred), ...faltasCobrancaBb(c.faltantes)]
    if (faltas.length) {
      await logSyncBb(companyId, 'boleto_registrar', 'erro', `config BB incompleta: falta ${faltas.join(', ')}`, { receber_id, ambiente: c.cred.ambiente })
      return NextResponse.json({ ok: false, erro: `Falta na configuração do Banco do Brasil: ${faltas.join(', ')}.` }, { status: 412 })
    }

    let pagador: { documento: string; nome: string; logradouro: string | null; bairro: string | null; cidade: string | null; uf: string | null; cep: string | null }
    if (rec.cliente_id) {
      const { data: cli } = await supabaseAdmin.from('erp_clientes')
        .select('cpf_cnpj, cnpj_cpf, razao_social, nome_fantasia, cep, logradouro, bairro, cidade, uf').eq('id', rec.cliente_id).single()
      pagador = {
        documento: (cli?.cpf_cnpj ?? cli?.cnpj_cpf ?? '') as string,
        nome: (cli?.razao_social ?? cli?.nome_fantasia ?? rec.cliente_nome ?? '') as string,
        logradouro: (cli?.logradouro ?? null) as string | null, bairro: (cli?.bairro ?? null) as string | null,
        cidade: (cli?.cidade ?? null) as string | null, uf: (cli?.uf ?? null) as string | null, cep: (cli?.cep ?? null) as string | null,
      }
    } else {
      pagador = { documento: '', nome: rec.cliente_nome ?? 'PAGADOR', logradouro: null, bairro: null, cidade: null, uf: null, cep: null }
    }
    if (!pagador.documento) {
      await logSyncBb(companyId, 'boleto_registrar', 'erro', 'cliente sem CPF/CNPJ', { receber_id })
      return NextResponse.json({ ok: false, erro: 'Cliente sem CPF/CNPJ — necessario para registrar boleto.' }, { status: 412 })
    }
    const docDigitos = onlyDigitsDoc(pagador.documento)
    if (!tipoPessoaPorDocumento(docDigitos)) {
      await logSyncBb(companyId, 'boleto_registrar', 'erro', `documento do cliente incompleto (${docDigitos.length} digitos)`, { receber_id })
      return NextResponse.json({ ok: false, erro: `O CPF/CNPJ do cliente esta incompleto (tem ${docDigitos.length} digito(s); precisa de 11 para CPF ou 14 para CNPJ) — corrija no cadastro do cliente antes de gerar o boleto.` }, { status: 412 })
    }

    const hojeSP = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
    const emissaoPretendida = rec.data_emissao ?? hojeSP
    const emissaoISO = emissaoPretendida > hojeSP ? hojeSP : emissaoPretendida
    const vencimentoISO = rec.data_vencimento < emissaoISO ? emissaoISO : rec.data_vencimento
    const seuNumero = (rec.numero_documento ?? rec.id).toString().replace(/[^0-9A-Za-z]/g, '').slice(0, 15)

    // sequencial atômico por config (o mesmo contador do seu número dos demais bancos); só os 10 últimos dígitos entram no nosso número
    const { data: seq, error: seqErr } = await supabaseAdmin.rpc('fn_banco_proximo_seu_numero', {
      p_company_id: companyId, p_banco_codigo: BB_BANCO, p_ambiente: c.cred.ambiente,
    })
    if (seqErr || !seq) {
      await logSyncBb(companyId, 'boleto_registrar', 'erro', `sequencial do nosso numero falhou: ${seqErr?.message ?? 'vazio'}`, { receber_id })
      return NextResponse.json({ ok: false, erro: 'Não foi possível reservar o nosso número do boleto. Tente de novo.' }, { status: 500 })
    }
    const nossoNumero = nossoNumeroBb(c.cfg.convenio, String(seq))

    const result = await registrarBoletoBb(c.cred, {
      cfg: c.cfg, nossoNumero, seuNumero, valor: Number(rec.valor), emissaoISO, vencimentoISO, pagador,
      juros_pct: c.juros_pct, multa_pct: c.multa_pct, mensagem: c.instrucao,
    })
    if (result.status < 200 || result.status >= 300 || !result.nossoNumero || !result.linhaDigitavel || !result.codigoBarras) {
      await logSyncBb(companyId, 'boleto_registrar', 'erro', `registro falhou: status ${result.status}`, { receber_id, ambiente: c.cred.ambiente, raw: result.raw, payload_enviado: result.corpo_enviado })
      const msgBanco = extractBankMessage(result.raw)
      // sem escopo da Cobrança na aplicação (Portal Developers): diz exatamente o que fazer
      const semEscopo = result.status === 401 || result.status === 403
      const erro = semEscopo
        ? `O Banco do Brasil negou o acesso à Cobrança${msgBanco ? ` (${msgBanco})` : ''}. Confira no Portal Developers se a aplicação tem os escopos cobrancas.boletos-info, cobrancas.boletos-requisicao e cobrancas.convenio-requisicao.`
        : msgBanco ? `Banco do Brasil nao registrou o boleto: ${msgBanco}` : 'Banco do Brasil recusou o registro do boleto.'
      return NextResponse.json({ ok: false, erro, ambiente: c.cred.ambiente, detalhes: result.raw }, { status: 502 })
    }

    // PDF: o BB não entrega PDF na Cobrança v2 → gerador FEBRABAN local (banco 001), como nos demais fallbacks
    let boletoUrl: string | null = null
    try {
      const { data: comp } = await supabaseAdmin.from('companies').select('razao_social, nome_fantasia, cnpj').eq('id', companyId).single()
      const { data: cfgBanco } = await supabaseAdmin.from('erp_banco_provider_config').select('agencia, conta').eq('company_id', companyId).eq('banco_codigo', BB_BANCO).eq('ambiente', c.cred.ambiente).maybeSingle()
      const bytes = await gerarPdfBoleto({
        banco: { codigo: BB_BANCO, nome: 'Banco do Brasil' },
        linhaDigitavel: result.linhaDigitavel, codigoBarras: result.codigoBarras, qrCodePix: result.qrCode ?? null,
        beneficiario: { nome: (comp?.razao_social ?? comp?.nome_fantasia ?? 'BENEFICIARIO') as string, cnpj: (comp?.cnpj ?? '') as string, agencia: (cfgBanco?.agencia ?? null) as string | null, conta: (cfgBanco?.conta ?? null) as string | null, codigo: c.cfg.convenio },
        pagador: { nome: pagador.nome, cpfCnpj: pagador.documento, endereco: { logradouro: pagador.logradouro, bairro: pagador.bairro, cidade: pagador.cidade, uf: pagador.uf, cep: pagador.cep } },
        nossoNumero: result.nossoNumero, numeroDocumento: seuNumero, especieDocumento: 'DM', aceite: false,
        dataDocumento: emissaoISO, dataVencimento: vencimentoISO, valor: Number(rec.valor),
        instrucoes: [c.cred.ambiente === 'homologacao' ? 'BOLETO DE TESTE (HOMOLOGACAO) - NAO PAGAR' : null, c.instrucao].filter((x): x is string => !!x),
      })
      const saved = await salvarPdfBoletoNoBucket(companyId, receber_id, Buffer.from(bytes))
      boletoUrl = saved.url
    } catch (e) {
      await logSyncBb(companyId, 'boleto_registrar', 'erro', `PDF BB falhou: ${e instanceof Error ? e.message : String(e)}`, { receber_id })
    }

    await supabaseAdmin.from('erp_receber').update({
      boleto_nosso_numero: result.nossoNumero, boleto_linha_digitavel: result.linhaDigitavel, boleto_codigo_barras: result.codigoBarras,
      boleto_qr_code: result.qrCode ?? null, boleto_url: boletoUrl, boleto_banco_codigo: BB_BANCO,
      boleto_status: 'registrado', boleto_emitido_em: new Date().toISOString(), boleto_id_externo: result.txid ?? result.nossoNumero,
    }).eq('id', receber_id)

    await logSyncBb(companyId, 'boleto_registrar', 'ok', `boleto BB registrado nu=${result.nossoNumero} (${c.cred.ambiente})${boletoUrl ? ' (PDF salvo)' : ' (sem PDF)'}`, { receber_id, ambiente: c.cred.ambiente, por: user.id })
    return NextResponse.json({
      ok: true, nosso_numero: result.nossoNumero, linha_digitavel: result.linhaDigitavel, codigo_barras: result.codigoBarras,
      qr_code: result.qrCode ?? null, boleto_url: boletoUrl, ambiente: c.cred.ambiente,
    })
  } catch (e) {
    const erro = e instanceof Error ? e.message : String(e)
    if (companyIdLog) {
      try { await logSyncBb(companyIdLog, 'boleto_registrar', 'erro', `excecao nao tratada: ${erro}`, { receber_id: receberIdLog }) } catch { /* nunca mascarar */ }
    }
    return NextResponse.json({ ok: false, erro }, { status: 500 })
  }
}
