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

    let nfseReq: NFSeRequest
    if (body.erpReceberId) {
      nfseReq = await buildNFSeFromReceber({
        companyId: body.companyId,
        erpReceberId: body.erpReceberId,
        overrides: body.overrides,
      })
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

    // Roteamento por provider · gov.br NFSe Nacional NAO usa Focus NFe service
    const { data: providerCfg } = await supabaseAdmin
      .from('erp_fiscal_provider_config')
      .select('provider, gov_nfse_municipio_codigo')
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
              'Configuração gov.br incompleta · cadastre o código IBGE do município em /configuracoes/fiscal',
          },
          { status: 400 }
        )
      }

      const resultadoGov = await emitirNFSeViaGovServer(
        {
          companyId: body.companyId,
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
