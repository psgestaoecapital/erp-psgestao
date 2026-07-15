// BLOCO 6 · Orquestrador da ESCADA DE TESTE REAL da conexão bancária.
// ============================================================================
// Dirige os 5 degraus contra o banco de verdade, usando as MESMAS libs proven
// (@/lib/banco/*). NÃO chama os endpoints de produção nem toca erp_receber:
// o título de teste (R$1, pagador = própria empresa) vive em erp_banco_teste_titulo.
//
//   1. oauth   — obterToken (mTLS/OAuth). Prova só a autenticação.
//   2. boleto  — registrarBoleto R$1 pagador=própria empresa (idempotente: reusa
//                o título pendente, NUNCA gera 2º boleto de R$1).
//   3. pdf     — busca o PDF do boleto (2ª via / pdf nativo).
//   4. extrato — puxa o extrato (read-only, NÃO persiste movimento nenhum).
//   5. baixa   — pergunta ao BANCO se o R$1 foi pago (consultarBoleto por
//                nosso_numero). Nasce 'aguardando_pagamento'; vira 'ok' só quando
//                o banco confirma o crédito. Sem 5/5 mentiroso (RD-38).
//
// GUARDAS: só roda em estado recebido/testando; lê o ambiente REAL da config no
// disparo e RECUSA se for 'producao' (não registra boleto real); para no 1º degrau
// que falha; provider fora de sicoob/sicredi fica fora da escada automática.
// ============================================================================
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { Buffer } from 'node:buffer'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import * as Sicoob from '@/lib/banco/sicoob'
import * as Sicredi from '@/lib/banco/sicredi'
import { sicoobExtratoAdapter } from '@/lib/banco/extrato/sicoob'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BANCO_POR_PROVIDER: Record<string, string> = { sicoob: '756', sicredi: '748' }
const ESCADA = ['oauth', 'boleto', 'pdf', 'extrato', 'baixa'] as const
const ESTADOS_QUE_TESTAM = new Set(['recebido', 'testando'])

function userSupabase(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const auth = req.headers.get('authorization') || ''
  return createClient(url, anon, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } })
}

type Pagador = { tipo: 'PF' | 'PJ'; documento: string; nome: string; logradouro: string | null; bairro: string | null; cidade: string | null; uf: string | null; cep: string | null }

export async function POST(req: NextRequest) {
  try {
    const { company_id, provider } = await req.json()
    if (!company_id || !provider) return NextResponse.json({ ok: false, erro: 'company_id e provider obrigatórios' }, { status: 400 })

    // Auth: sessão de usuário. A leitura da config passa pela RLS do usuário.
    const sb = userSupabase(req)
    const { data: { user } } = await sb.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, erro: 'não autenticado' }, { status: 401 })

    if (!(provider in BANCO_POR_PROVIDER)) {
      return NextResponse.json({ ok: false, erro: `${provider} está fora da escada automática por ora (hipótese honesta).`, fora_escada: true }, { status: 400 })
    }
    const bancoCodigo = BANCO_POR_PROVIDER[provider]

    // Config REAL (RLS já garante que é empresa do usuário)
    const { data: cfg, error: cfgErr } = await sb.from('erp_banco_provider_config')
      .select('id, company_id, provider, ambiente, estado_conexao, ativo')
      .eq('company_id', company_id).eq('provider', provider).maybeSingle()
    if (cfgErr || !cfg) return NextResponse.json({ ok: false, erro: 'config não encontrada para esta empresa/banco' }, { status: 404 })

    // GUARDA de estado: escada só roda em homologação (recebido/testando).
    if (!ESTADOS_QUE_TESTAM.has(cfg.estado_conexao ?? '')) {
      return NextResponse.json({
        ok: false, erro: `A escada de teste só roda em homologação (estado atual: ${cfg.estado_conexao ?? 'nao_iniciado'}).`,
        estado_invalido: true,
      }, { status: 409 })
    }

    // GUARDA de ambiente (RD-38): lê o ambiente REAL da config no disparo — não
    // confia no rótulo da tela. Produção = registraria boleto REAL com dinheiro real.
    const ambiente = cfg.ambiente as string
    if (ambiente === 'producao') {
      return NextResponse.json({
        ok: false, ambiente_producao: true,
        erro: '⚠️ Esta config está em PRODUÇÃO — o teste registraria um boleto REAL com dinheiro real. Confirme o ambiente antes de testar.',
      }, { status: 409 })
    }

    // Reset dos 5 degraus p/ esta tentativa (o resultado reflete ESTE run)
    async function gravar(passo: string, status: string, detalhe: unknown) {
      await supabaseAdmin.from('erp_banco_teste_resultado').upsert({
        company_id, provider, passo, status, detalhe: detalhe ?? null, testado_em: new Date().toISOString(),
      }, { onConflict: 'company_id,provider,passo' })
    }
    for (const p of ESCADA) await gravar(p, 'nao_testado', null)

    // Credencial (Vault, service role) no ambiente REAL da config
    const credResp = await supabaseAdmin.rpc('fn_banco_obter_credencial', {
      p_company_id: company_id, p_banco_codigo: bancoCodigo, p_ambiente: ambiente,
    })
    const cred = credResp.data as Record<string, unknown> | null
    if (!cred || cred.ok === false) {
      await gravar('oauth', 'falhou', { erro: 'credencial_de_teste_ausente', ambiente })
      return NextResponse.json({ ok: false, parou_em: 'oauth', erro: 'Credencial de teste ausente. Cadastre a integração (tela Conectar) antes de rodar a escada.' }, { status: 412 })
    }

    // Pagador = a PRÓPRIA empresa (nunca cliente real)
    const { data: comp } = await supabaseAdmin.from('companies')
      .select('razao_social, nome_fantasia, cnpj, endereco, cidade_estado').eq('id', company_id).single()
    const documentoEmpresa = String((comp?.cnpj ?? '')).replace(/\D/g, '')
    if (!documentoEmpresa) {
      await gravar('oauth', 'falhou', { erro: 'empresa_sem_cnpj' })
      return NextResponse.json({ ok: false, parou_em: 'oauth', erro: 'Empresa sem CNPJ cadastrado — necessário para o pagador do boleto de teste.' }, { status: 412 })
    }
    const pagador: Pagador = {
      tipo: 'PJ', documento: documentoEmpresa,
      nome: (comp?.razao_social ?? comp?.nome_fantasia ?? 'EMPRESA TESTE') as string,
      logradouro: (comp?.endereco ?? null) as string | null,
      bairro: null, cidade: (comp?.cidade_estado ?? null) as string | null, uf: null, cep: null,
    }

    const resultados: Record<string, { status: string; detalhe?: unknown }> = {}
    const finalizar = (parouEm: string | null) => NextResponse.json({ ok: true, parou_em: parouEm, resultados })

    // Datas do boleto de teste (fuso SP)
    const hojeSP = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
    const vencSP = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(Date.now() + 3 * 86400_000))

    // ── get-or-create do título de teste (idempotência: 1 pendente por empresa+provider)
    async function getOrCreateTitulo() {
      const { data: existing } = await supabaseAdmin.from('erp_banco_teste_titulo')
        .select('*').eq('company_id', company_id).eq('provider', provider).neq('boleto_status', 'liquidado').maybeSingle()
      if (existing) return existing
      const { data: created } = await supabaseAdmin.from('erp_banco_teste_titulo').insert({
        company_id, provider, banco_codigo: bancoCodigo, ambiente, valor: 1.00,
        pagador_nome: pagador.nome, pagador_documento: pagador.documento,
        data_emissao: hojeSP, data_vencimento: vencSP, boleto_status: 'pendente',
      }).select('*').single()
      return created
    }

    // Constrói a credencial tipada por provider
    function credSicoob(): Sicoob.Credencial {
      return {
        client_id: cred!.client_id as string, ambiente: ambiente as Sicoob.SicoobAmbiente,
        pfx: Buffer.from((cred!.cert_base64 as string) ?? '', 'base64'), passphrase: (cred!.cert_senha as string) ?? '',
        cooperativa: (cred!.cooperativa as string) ?? '', conta: (cred!.conta as string) ?? '',
        codigo_beneficiario: (cred!.codigo_beneficiario as string) ?? '', convenio: (cred!.convenio as string) ?? '',
      }
    }
    function credSicredi(): Sicredi.Credencial {
      const coop = (cred!.cooperativa as string) ?? ''
      const benef = (cred!.codigo_beneficiario as string) ?? ''
      return {
        username: benef && coop ? `${benef}${coop}` : '', password: (cred!.client_secret as string) ?? '',
        api_key: (cred!.api_key as string) ?? '', ambiente: ambiente as Sicredi.SicrediAmbiente,
        cooperativa: coop, posto: (cred!.posto as string) ?? '', codigo_beneficiario: benef,
        conta: (cred!.conta as string) ?? '', agencia: (cred!.agencia as string) ?? null,
        juros_pct: (cred!.juros_pct as number) ?? null, multa_pct: (cred!.multa_pct as number) ?? null,
      }
    }

    // ───────────────────────── DEGRAU 1: OAUTH ─────────────────────────
    try {
      if (provider === 'sicoob') await Sicoob.obterToken(credSicoob())
      else await Sicredi.obterToken(credSicredi())
      resultados.oauth = { status: 'ok' }; await gravar('oauth', 'ok', { ambiente })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      resultados.oauth = { status: 'falhou', detalhe: msg }; await gravar('oauth', 'falhou', { erro: msg })
      return finalizar('oauth')
    }

    // ───────────────────────── DEGRAU 2: BOLETO ────────────────────────
    const titulo = await getOrCreateTitulo()
    if (!titulo) {
      resultados.boleto = { status: 'falhou', detalhe: 'nao_criou_titulo_teste' }; await gravar('boleto', 'falhou', { erro: 'nao_criou_titulo_teste' })
      return finalizar('boleto')
    }
    let nossoNumero: string | null = titulo.boleto_nosso_numero as string | null
    if (nossoNumero && titulo.boleto_status !== 'pendente') {
      // idempotência: boleto de teste já registrado — REUSA, não gera 2º R$1.
      resultados.boleto = { status: 'ok', detalhe: 'reusou boleto de teste pendente' }; await gravar('boleto', 'ok', { nosso_numero: nossoNumero, reusado: true })
    } else if (nossoNumero) {
      resultados.boleto = { status: 'ok', detalhe: 'reusou boleto de teste pendente' }; await gravar('boleto', 'ok', { nosso_numero: nossoNumero, reusado: true })
    } else {
      const seuNumero = (titulo.id as string).replace(/[^0-9A-Za-z]/g, '').slice(0, provider === 'sicredi' ? 10 : 25)
      try {
        let reg: { status: number; nuTituloGerado?: string; linhaDigitavel?: string; codigoBarras?: string; qrCode?: string; raw: unknown }
        if (provider === 'sicoob') {
          reg = await Sicoob.registrarBoleto({ cred: credSicoob(), seuNumero, valor: 1.00, emissaoISO: hojeSP, vencimentoISO: vencSP, pagador, hibrido: true })
        } else {
          reg = await Sicredi.registrarBoleto({ cred: credSicredi(), seuNumero, valor: 1.00, emissaoISO: hojeSP, vencimentoISO: vencSP, pagador, hibrido: false })
        }
        if (reg.status < 200 || reg.status >= 300 || !reg.nuTituloGerado || !reg.linhaDigitavel) {
          resultados.boleto = { status: 'falhou', detalhe: reg.raw }; await gravar('boleto', 'falhou', { status: reg.status, raw: reg.raw })
          return finalizar('boleto')
        }
        nossoNumero = reg.nuTituloGerado
        await supabaseAdmin.from('erp_banco_teste_titulo').update({
          boleto_status: 'registrado', boleto_nosso_numero: reg.nuTituloGerado,
          boleto_linha_digitavel: reg.linhaDigitavel, boleto_codigo_barras: reg.codigoBarras ?? null,
          boleto_qr_code: reg.qrCode ?? null, atualizado_em: new Date().toISOString(),
        }).eq('id', titulo.id)
        resultados.boleto = { status: 'ok', detalhe: { nosso_numero: nossoNumero, linha_digitavel: reg.linhaDigitavel } }
        await gravar('boleto', 'ok', { nosso_numero: nossoNumero, linha_digitavel: reg.linhaDigitavel })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        resultados.boleto = { status: 'falhou', detalhe: msg }; await gravar('boleto', 'falhou', { erro: msg })
        return finalizar('boleto')
      }
    }

    // ───────────────────────── DEGRAU 3: PDF ───────────────────────────
    try {
      let pdfOk = false
      if (provider === 'sicoob') {
        const sv = await Sicoob.segundaViaBoleto(credSicoob(), nossoNumero!)
        pdfOk = !!sv.pdfBase64
      } else {
        const pdf = await Sicredi.buscarPdf(credSicredi(), nossoNumero!)
        pdfOk = !!pdf.pdfBase64
      }
      if (pdfOk) {
        await supabaseAdmin.from('erp_banco_teste_titulo').update({ boleto_pdf_ok: true, atualizado_em: new Date().toISOString() }).eq('id', titulo.id)
        resultados.pdf = { status: 'ok' }; await gravar('pdf', 'ok', null)
      } else {
        resultados.pdf = { status: 'falhou', detalhe: 'pdf_vazio' }; await gravar('pdf', 'falhou', { erro: 'pdf_vazio' })
        return finalizar('pdf')
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      resultados.pdf = { status: 'falhou', detalhe: msg }; await gravar('pdf', 'falhou', { erro: msg })
      return finalizar('pdf')
    }

    // ───────────────────────── DEGRAU 4: EXTRATO (read-only) ───────────
    try {
      if (provider === 'sicoob') {
        // read-only: puxa o extrato do dia e NÃO persiste nada
        await sicoobExtratoAdapter.listarMovimentos({
          client_id: cred.client_id as string, base_url: '', ambiente: ambiente as 'producao' | 'homologacao',
          pfx: Buffer.from((cred.cert_base64 as string) ?? '', 'base64'), passphrase: (cred.cert_senha as string) ?? '',
          cooperativa: (cred.cooperativa as string) ?? '', conta: (cred.conta as string) ?? '',
          codigo_beneficiario: (cred.codigo_beneficiario as string) ?? '', convenio: (cred.convenio as string) ?? '',
        }, { begin: hojeSP, end: hojeSP })
        resultados.extrato = { status: 'ok' }; await gravar('extrato', 'ok', { nota: 'read-only, nada persistido' })
      } else {
        // Sicredi extrato é fase 2 — não é falha da conexão, é lacuna conhecida (honesto).
        resultados.extrato = { status: 'nao_disponivel', detalhe: 'extrato Sicredi é fase 2 (cobrança/boleto já no ar)' }
        await gravar('extrato', 'nao_disponivel', { nota: 'fase 2' })
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      resultados.extrato = { status: 'falhou', detalhe: msg }; await gravar('extrato', 'falhou', { erro: msg })
      return finalizar('extrato')
    }

    // ───────────────────────── DEGRAU 5: BAIXA (fonte = banco) ─────────
    // Pergunta ao BANCO se o R$1 foi pago. Nasce aguardando_pagamento; vira ok
    // só quando o banco confirma o crédito. Nunca força 5/5 falso (RD-38).
    try {
      let situacao: string | null = null; let dataLiq: string | null = null; let valorPago: number | null = null
      if (provider === 'sicoob') {
        const c = await Sicoob.consultarBoleto(credSicoob(), nossoNumero!)
        situacao = c.situacao; dataLiq = c.dataLiquidacao; valorPago = c.valorPago
      } else {
        const c = await Sicredi.consultarBoleto(credSicredi(), nossoNumero!)
        situacao = c.situacao; dataLiq = c.dataLiquidacao; valorPago = c.valorPago
      }
      const pago = !!situacao && /LIQUID|PAG|BAIXA_PAG/.test(situacao)
      if (pago) {
        await supabaseAdmin.from('erp_banco_teste_titulo').update({
          boleto_status: 'liquidado', liquidado_em: dataLiq ?? new Date().toISOString(), valor_pago: valorPago ?? 1.00, atualizado_em: new Date().toISOString(),
        }).eq('id', titulo.id)
        resultados.baixa = { status: 'ok', detalhe: { situacao, data: dataLiq } }; await gravar('baixa', 'ok', { situacao, dataLiquidacao: dataLiq, valorPago })
      } else {
        resultados.baixa = { status: 'aguardando_pagamento', detalhe: { situacao, linha_digitavel: titulo.boleto_linha_digitavel } }
        await gravar('baixa', 'aguardando_pagamento', { situacao, nosso_numero: nossoNumero })
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      resultados.baixa = { status: 'falhou', detalhe: msg }; await gravar('baixa', 'falhou', { erro: msg })
      return finalizar('baixa')
    }

    return finalizar(null)
  } catch (e) {
    return NextResponse.json({ ok: false, erro: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
