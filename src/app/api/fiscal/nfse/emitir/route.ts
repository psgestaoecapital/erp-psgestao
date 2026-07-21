import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/withAuth'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { createFiscalService } from '@/lib/fiscal/service'
import { buildNFSeFromReceber } from '@/lib/fiscal/nfse-builder'
import { validateNFSeRequest } from '@/lib/fiscal/nfse-validator'
import { isFiscalError } from '@/lib/fiscal/errors'
import { emitirNFSeViaGovServer } from '@/lib/fiscal/gov-nfse-provider'
import type { NFSeRequest } from '@/lib/fiscal/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface EmitirNFSeBody {
  companyId: string
  erpReceberId?: string
  // receber-nfse-seletor-servico-v1
  servicoId?: string
  manual?: {
    descricaoServico: string
    valorServicos: number
    cnae?: string
    codigoServico?: string
    aliquotaIss?: number
    retemIss?: boolean
    tomador: {
      razaoSocial: string
      cnpj?: string
      cpf?: string
      email?: string
    }
  }
  overrides?: {
    descricaoServico?: string
    cnae?: string
    codigoServico?: string
    aliquotaIss?: number
    retemIss?: boolean
  }
}

interface DadosNFSeRPC {
  ok?: boolean
  erro?: string
  receber_id?: string
  company_id?: string
  valor?: number
  tomador?: {
    documento: string
    tipo: 'cpf' | 'cnpj' | 'indefinido'
    nome: string
    email: string | null
  }
  servico?: {
    codigo_servico_municipio: string
    codigo_lc116: string
    aliquota_iss: number
    iss_retido: boolean
    descricao: string
  }
}

export const POST = withAuth(async (req: NextRequest) => {
  try {
    const body = (await req.json()) as EmitirNFSeBody

    if (!body.companyId || typeof body.companyId !== 'string') {
      return NextResponse.json({ ok: false, mensagem: 'companyId obrigatorio' }, { status: 400 })
    }
    if (body.companyId === 'consolidado' || body.companyId.startsWith('group_')) {
      return NextResponse.json(
        { ok: false, mensagem: 'NFSe exige selecao de 1 empresa especifica' },
        { status: 400 }
      )
    }

    // receber-nfse-seletor-servico-v1: quando servicoId vem junto, busca os
    // dados via RPC (servico + tomador) e injeta como overrides confiaveis,
    // alem de devolver mensagens claras (sem "cadastre em /configuracoes/fiscal").
    let servicoOverride: NonNullable<EmitirNFSeBody['overrides']> | undefined
    let dadosRpc: DadosNFSeRPC | null = null
    if (body.erpReceberId && body.servicoId) {
      const { data, error } = await supabaseAdmin.rpc('fn_receber_nfse_dados', {
        p_receber_id: body.erpReceberId,
        p_servico_id: body.servicoId,
      })
      if (error) {
        return NextResponse.json({ ok: false, mensagem: error.message }, { status: 400 })
      }
      dadosRpc = (data as DadosNFSeRPC | null) ?? null
      if (dadosRpc?.erro) {
        return NextResponse.json({ ok: false, mensagem: dadosRpc.erro }, { status: 400 })
      }
      if (dadosRpc?.servico) {
        servicoOverride = {
          ...(body.overrides ?? {}),
          codigoServico: dadosRpc.servico.codigo_servico_municipio,
          aliquotaIss: body.overrides?.aliquotaIss ?? dadosRpc.servico.aliquota_iss,
          retemIss: body.overrides?.retemIss ?? dadosRpc.servico.iss_retido,
          descricaoServico: body.overrides?.descricaoServico ?? dadosRpc.servico.descricao,
        }
      }
    }

    let nfseReq: NFSeRequest
    if (body.erpReceberId) {
      nfseReq = await buildNFSeFromReceber({
        companyId: body.companyId,
        erpReceberId: body.erpReceberId,
        overrides: servicoOverride ?? body.overrides,
      })
      // Sobrescreve tomador pelo cadastro consolidado da RPC (doc/email/nome)
      if (dadosRpc?.tomador && dadosRpc.tomador.documento) {
        const tomDoc = dadosRpc.tomador.documento
        nfseReq.tomador = {
          ...nfseReq.tomador,
          razaoSocial: dadosRpc.tomador.nome ?? nfseReq.tomador.razaoSocial,
          cnpj: dadosRpc.tomador.tipo === 'cnpj' ? tomDoc : undefined,
          cpf: dadosRpc.tomador.tipo === 'cpf' ? tomDoc : undefined,
          email: dadosRpc.tomador.email ?? nfseReq.tomador.email,
        }
      }
    } else if (body.manual) {
      const { data: emp } = await supabaseAdmin
        .from('companies')
        .select('cnpj, razao_social, inscricao_municipal')
        .eq('id', body.companyId)
        .maybeSingle()
      if (!emp) {
        return NextResponse.json({ ok: false, mensagem: 'Empresa nao encontrada' }, { status: 400 })
      }
      nfseReq = {
        serie: '1',
        dataEmissao: new Date().toISOString(),
        descricaoServico: body.manual.descricaoServico,
        valorServicos: body.manual.valorServicos,
        cnaeServico: body.manual.cnae ?? '',
        codigoServico: body.manual.codigoServico ?? '',
        aliquotaIss: body.manual.aliquotaIss,
        retemIss: body.manual.retemIss ?? false,
        prestador: {
          cnpj: String(emp.cnpj ?? '').replace(/\D/g, ''),
          razaoSocial: emp.razao_social,
          inscricaoMunicipal: emp.inscricao_municipal ?? undefined,
        },
        tomador: body.manual.tomador,
      }
    } else {
      return NextResponse.json(
        { ok: false, mensagem: 'Forneca erpReceberId OU manual com dados completos' },
        { status: 400 }
      )
    }

    validateNFSeRequest(nfseReq)

    // (a) IDEMPOTÊNCIA FISCAL — nunca emitir 2ª nota p/ o MESMO tomador+valor+competência
    // enquanto já houver uma AUTORIZADA ou EM PROCESSAMENTO. Foi assim que 1 serviço da PS
    // (Cleiton · R$1.923,99) virou 4 NFS-e autorizadas em 35min: a emissão é assíncrona e cada
    // clique gerava um RPS novo. Guard no SERVIDOR (a UI pode ser burlada). Rejeição NÃO bloqueia
    // reenvio — só autorizada/processando. (RD-51: o desconhecido não vira nem sucesso nem falha.)
    {
      const tomDoc = String(nfseReq.tomador.cnpj || nfseReq.tomador.cpf || '').replace(/\D/g, '')
      if (tomDoc) {
        const compIni = new Date()
        compIni.setDate(1)
        compIni.setHours(0, 0, 0, 0)
        const { data: jaExiste } = await supabaseAdmin
          .from('erp_nfse_emitidas')
          .select('id, numero, status')
          .eq('company_id', body.companyId)
          .in('status', ['autorizada', 'processando'])
          .gte('valor_servicos', nfseReq.valorServicos - 0.005)
          .lte('valor_servicos', nfseReq.valorServicos + 0.005)
          .gte('data_emissao', compIni.toISOString())
          .or(`tomador_cnpj.eq.${tomDoc},tomador_cpf.eq.${tomDoc}`)
          .limit(1)
        if (jaExiste && jaExiste.length > 0) {
          const ex = jaExiste[0]
          return NextResponse.json(
            {
              ok: false,
              duplicada: true,
              nfseExistenteId: ex.id,
              mensagem:
                ex.status === 'autorizada'
                  ? `Já existe NFS-e AUTORIZADA (nº ${ex.numero}) para este tomador, valor e competência. NÃO reemita — veja em Notas Fiscais. Se for um serviço realmente diferente, mude a descrição ou o valor.`
                  : `Já existe uma NFS-e EM PROCESSAMENTO para este tomador, valor e competência. ⏳ Aguarde a prefeitura autorizar — NÃO reemita. Isso pode levar alguns minutos.`,
            },
            { status: 409 }
          )
        }
      }
    }

    // Roteamento por provider · gov.br NFSe Nacional NAO usa Focus NFe service
    const { data: providerCfg } = await supabaseAdmin
      .from('erp_fiscal_provider_config')
      .select('id, provider, gov_nfse_municipio_codigo, ambiente')
      .eq('company_id', body.companyId)
      .eq('ativo', true)
      .maybeSingle()

    if (providerCfg?.provider === 'gov_nfse_nacional') {
      const authHeader = req.headers.get('authorization') ?? ''
      const municipioPrestador = String(providerCfg.gov_nfse_municipio_codigo ?? '').replace(/\D/g, '')
      if (municipioPrestador.length !== 7) {
        return NextResponse.json(
          {
            ok: false,
            mensagem:
              'Configuração gov.br incompleta · cadastre o código IBGE do município do prestador em Configurações › Fiscal',
          },
          { status: 400 }
        )
      }

      const ambienteGov = providerCfg?.ambiente === 'producao' ? 'producao' : 'homologacao'
      const resultadoGov = await emitirNFSeViaGovServer(
        {
          companyId: body.companyId,
          ambiente: ambienteGov,
          erpReceberId: body.erpReceberId ?? null,
          prestador: {
            cnpj: nfseReq.prestador.cnpj,
            razaoSocial: nfseReq.prestador.razaoSocial,
            inscricaoMunicipal: nfseReq.prestador.inscricaoMunicipal ?? null,
            municipioIbge: municipioPrestador,
          },
          tomador: {
            cnpj: nfseReq.tomador.cnpj,
            cpf: nfseReq.tomador.cpf,
            razaoSocial: nfseReq.tomador.razaoSocial,
            email: nfseReq.tomador.email,
            municipioIbge: nfseReq.tomador.endereco?.codigoMunicipio,
            uf: nfseReq.tomador.endereco?.uf,
          },
          servico: {
            codigoTributacaoNacional: nfseReq.codigoServico ?? null,
            descricao: nfseReq.descricaoServico,
            valorServico: nfseReq.valorServicos,
            aliquotaIss: nfseReq.aliquotaIss ?? null,
            issRetido: !!nfseReq.retemIss,
          },
        },
        authHeader
      )

      return NextResponse.json({
        ok: !!resultadoGov.ok,
        provider: 'gov_nfse_nacional',
        dpsId: resultadoGov.dpsId,
        numeroDps: resultadoGov.numeroDps,
        status: resultadoGov.status ?? 'processando',
        mensagem: resultadoGov.mensagem ?? resultadoGov.erro,
      }, { status: resultadoGov.ok ? 200 : 502 })
    }

    // Default · Focus NFe (provider='focusnfe' ou nao configurado)
    // NFSe NACIONAL VIA FOCUS: se o município do prestador aderiu (erp_gov_nfse_municipios.aderido),
    // emite no layout nacional pelo endpoint /v2/nfsen (não migra pro gov.br direto). Carrega opção/regime
    // do Simples Nacional e a numeração atômica da DPS.
    {
      const muni = String(nfseReq.prestador.codigoMunicipio ?? '').replace(/\D/g, '')
      if (muni.length === 7) {
        const { data: m } = await supabaseAdmin
          .from('erp_gov_nfse_municipios')
          .select('aderido')
          .eq('codigo_ibge', muni)
          .maybeSingle()
        if (m?.aderido) {
          nfseReq.padraoNacional = true
          const { data: snCfg } = await supabaseAdmin
            .from('erp_fiscal_provider_config')
            .select('opcao_simples_nacional, percentual_total_tributos_sn, regime_apuracao_sn')
            .eq('company_id', body.companyId)
            .eq('provider', 'focusnfe')
            .eq('ativo', true)
            .maybeSingle()
          nfseReq.opcaoSimplesNacional = (snCfg?.opcao_simples_nacional as number | null) ?? 3
          if (snCfg?.percentual_total_tributos_sn != null) nfseReq.percentualTribSN = Number(snCfg.percentual_total_tributos_sn)
          if (snCfg?.regime_apuracao_sn != null) nfseReq.regimeApuracaoSN = Number(snCfg.regime_apuracao_sn)
          const { data: numRows } = await supabaseAdmin.rpc('fn_proximo_numero_nfse', { p_company_id: body.companyId })
          const numRow = Array.isArray(numRows) ? numRows[0] : numRows
          if (numRow?.serie != null) nfseReq.serieRps = String(numRow.serie)
          if (numRow?.numero != null) nfseReq.numeroRps = Number(numRow.numero)
        }
      }
    }

    const svc = await createFiscalService(body.companyId)
    const resposta = await svc.emitirNFSe(nfseReq)

    const dadosRegistro = {
      valor_servicos: nfseReq.valorServicos,
      aliquota_iss: nfseReq.aliquotaIss,
      retem_iss: nfseReq.retemIss,
      cnae: nfseReq.cnaeServico,
      codigo_servico: nfseReq.codigoServico,
      descricao_servico: nfseReq.descricaoServico,
      prestador_cnpj: nfseReq.prestador.cnpj,
      prestador_razao_social: nfseReq.prestador.razaoSocial,
      prestador_im: nfseReq.prestador.inscricaoMunicipal,
      tomador_cnpj: nfseReq.tomador.cnpj,
      tomador_cpf: nfseReq.tomador.cpf,
      tomador_razao_social: nfseReq.tomador.razaoSocial,
      tomador_email: nfseReq.tomador.email,
      tomador_endereco: nfseReq.tomador.endereco,
      status: resposta.status,
      numero: resposta.numero,
      serie: nfseReq.serie,
      codigo_verificacao: resposta.codigoVerificacao,
      xml_url: resposta.xmlUrl,
      pdf_url: resposta.pdfUrl,
      motivo_rejeicao: resposta.motivoRejeicao,
    }

    const { data: registroId, error: rpcErr } = await supabaseAdmin.rpc(
      'fn_registrar_nfse_emitida',
      {
        p_company_id: body.companyId,
        p_erp_receber_id: body.erpReceberId ?? null,
        p_provider_reference: resposta.providerReference,
        p_ambiente: svc.ambiente,
        p_dados: dadosRegistro,
        p_provider_raw: resposta.providerRaw ?? null,
      }
    )

    if (rpcErr) {
      return NextResponse.json(
        {
          ok: false,
          mensagem:
            'NFSe emitida no Focus mas erro ao registrar no banco · contate suporte. Ref: ' +
            resposta.providerReference,
          providerReference: resposta.providerReference,
          rpcError: rpcErr.message,
        },
        { status: 500 }
      )
    }

    return NextResponse.json({
      ok: resposta.ok,
      nfseId: registroId,
      status: resposta.status,
      numero: resposta.numero,
      codigoVerificacao: resposta.codigoVerificacao,
      xmlUrl: resposta.xmlUrl,
      pdfUrl: resposta.pdfUrl,
      motivoRejeicao: resposta.motivoRejeicao,
      providerReference: resposta.providerReference,
      ambiente: svc.ambiente,
    })
  } catch (err) {
    if (isFiscalError(err)) {
      return NextResponse.json(err.toJSON(), { status: 502 })
    }
    return NextResponse.json(
      { ok: false, mensagem: (err as Error)?.message ?? 'Erro interno' },
      { status: 500 }
    )
  }
})
