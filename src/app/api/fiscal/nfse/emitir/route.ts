import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/withAuth'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { createFiscalService } from '@/lib/fiscal/service'
import { buildNFSeFromReceber } from '@/lib/fiscal/nfse-builder'
import { validateNFSeRequest } from '@/lib/fiscal/nfse-validator'
import { isFiscalError } from '@/lib/fiscal/errors'
import { emitirNFSeViaGovServer } from '@/lib/fiscal/gov-nfse-provider'
import { guardaEmpresaFiscal } from '@/lib/auth/assertAcessoEmpresa'
import { registrarTentativaFiscal } from '@/lib/fiscal/tentativaLog'
import { resolverOpcaoSimplesNacional, type NFSeRequest } from '@/lib/fiscal/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface EmitirNFSeBody {
  companyId: string
  erpReceberId?: string
  // receber-nfse-seletor-servico-v1
  servicoId?: string
  // chamado #18 · E0370: serviço de construção aponta para a obra (endereço/CNO vêm dela). Fase A:
  // trava (bloqueia sem obra/CNO) + Fase B: leva o grupo de obra ao payload nacional.
  obraId?: string
  // código de tributação (subitem 07.02.01/07.02.02) escolhido POR NOTA — varia por tipo de obra.
  codigoServicoTributacao?: string
  // endereço/CNO da obra informados na emissão (E0370). O endereço basta (Rodrigo: não é CNO).
  obra?: {
    cno?: string; inscricaoImobiliaria?: string
    logradouro?: string; numero?: string; complemento?: string; bairro?: string
    codigoMunicipio?: string; uf?: string; cep?: string
  }
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
  // Observação livre do usuário para as informações complementares da nota (o bloco da Lei
  // 12.741 é acrescentado automaticamente ao lado desta, não a substitui).
  observacoes?: string
  // #90 · retenção do ISS escolhida no modal: 1=Não retido · 2=Retido pelo tomador · 3=Retido pelo intermediário.
  tipoRetencaoIss?: number
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

// #90: o erro cru do schema ("... [facet 'pattern'] The value '...' is not accepted by the pattern
// ...") é ilegível pro atendente. Traduz para uma ação; mantém o detalhe técnico no fim.
function humanizarErroFiscal(msg: string | null | undefined): string | null | undefined {
  if (!msg) return msg
  const m = String(msg)
  if (/facet '?pattern'?|is not accepted by the pattern|xInfComp|xDiscrim|caractere n[aã]o/i.test(m)) {
    return 'A prefeitura recusou a nota por um símbolo não permitido no texto (ex.: •, — ou aspas curvas). ' +
      'Revise a descrição do serviço e as observações, remova símbolos especiais, e emita de novo. ' +
      '(Detalhe técnico: ' + m.slice(0, 200) + ')'
  }
  return m
}

export const POST = withAuth(async (req: NextRequest, { userId }) => {
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

    const negado = await guardaEmpresaFiscal({ userId, companyId: body.companyId, papelMinimo: 'membro', log: { notaTipo: 'nfse', operacao: 'emissao', endpoint: 'nfse/emitir' } })
    if (negado) return negado

    // receber-nfse-seletor-servico-v1: quando servicoId vem junto, busca os
    // dados via RPC (servico + tomador) e injeta como overrides confiaveis,
    // alem de devolver mensagens claras (sem "cadastre em /configuracoes/fiscal").
    let servicoOverride: NonNullable<EmitirNFSeBody['overrides']> | undefined
    let dadosRpc: DadosNFSeRPC | null = null
    if (body.erpReceberId && body.servicoId) {
      const { data, error } = await supabaseAdmin.rpc('fn_receber_nfse_dados', {
        p_receber_id: body.erpReceberId,
        p_servico_id: body.servicoId,
        p_obra_id: body.obraId ?? null,
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
          // #18: o subitem escolhido na emissão (07.02.01/07.02.02) manda; senão, o do cadastro.
          codigoServico: body.codigoServicoTributacao || dadosRpc.servico.codigo_servico_municipio,
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

    // Observação livre do usuário (opcional) → informações complementares. O bloco da Lei 12.741
    // é acrescentado depois, sem sobrescrever esta.
    if (typeof body.observacoes === 'string' && body.observacoes.trim()) {
      nfseReq.observacoes = body.observacoes.trim()
    }
    // #90 · retenção 1/2/3 vinda do modal (default 1 no builder). Aplica-se aos dois caminhos (gov/focus).
    if (typeof body.tipoRetencaoIss === 'number' && [1, 2, 3].includes(body.tipoRetencaoIss)) {
      nfseReq.tipoRetencaoISS = body.tipoRetencaoIss
      nfseReq.retemIss = body.tipoRetencaoIss !== 1  // mantém o boolean coerente p/ o caminho gov
    }

    // #82① · LIGA a emissão à OBRA. Prioridade: obra apontada na emissão (body.obraId); senão resolve a
    // cadeia receber→pedido→orçamento→obra no servidor. Os campos digitados na emissão têm prioridade;
    // o que faltar vem da obra vinculada (Hub). Sem isso a trava E0370 nunca enxerga o que foi salvo lá.
    let obraIdFinal: string | null = body.obraId ?? null
    if (body.erpReceberId || body.obraId) {
      const { data: obraRes } = await supabaseAdmin.rpc('fn_nfse_obra_resolver', {
        p_company_id: body.companyId,
        p_erp_receber_id: body.erpReceberId ?? null,
        p_obra_id: body.obraId ?? null,
      })
      const o = obraRes as {
        encontrada?: boolean; obra_id?: string; cno?: string | null; logradouro?: string | null
        numero_endereco?: string | null; bairro?: string | null; cidade?: string | null
        uf?: string | null; cep?: string | null; codigo_ibge?: string | null
      } | null
      if (o?.encontrada) {
        obraIdFinal = o.obra_id ?? obraIdFinal
        const t = body.obra ?? {}
        const pick = (a?: string, b?: string | null) => (a && a.trim() ? a : (b ?? undefined))
        nfseReq.obra = {
          cno: pick(t.cno, o.cno),
          inscricaoImobiliaria: t.inscricaoImobiliaria,
          logradouro: pick(t.logradouro, o.logradouro),
          numero: pick(t.numero, o.numero_endereco),
          complemento: t.complemento,
          bairro: pick(t.bairro, o.bairro),
          cep: pick(t.cep, o.cep),
          uf: pick(t.uf, o.uf),
          codigoMunicipio: pick(t.codigoMunicipio, o.codigo_ibge),
        }
      } else if (body.obra) {
        nfseReq.obra = body.obra
      }
    } else if (body.obra) {
      nfseReq.obra = body.obra
    }

    // #18/#82① · TRAVA PROATIVA (servidor): se o código exige obra e não há CNO nem endereço (nem
    // digitado, nem na obra vinculada via obra_id), bloqueia com a mensagem E0370 ANTES de enviar.
    {
      const { data: pend } = await supabaseAdmin.rpc('fn_nfse_obra_pendente', {
        p_company_id: body.companyId,
        p_codigo_servico: nfseReq.codigoServico,
        p_obra_id: obraIdFinal,
        p_cno: nfseReq.obra?.cno ?? null,
        p_endereco: nfseReq.obra?.logradouro ?? null,
      })
      const r = (Array.isArray(pend) ? pend[0] : pend) as { pendente?: boolean; mensagem?: string } | null
      if (r?.pendente) {
        return NextResponse.json({ ok: false, mensagem: r.mensagem ?? 'Serviço de construção exige o CNO ou o endereço da obra (regra E0370).', obra_pendente: true }, { status: 400 })
      }
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
      .select('id, provider, gov_nfse_municipio_codigo, ambiente, percentual_total_tributos_sn, lei12741_observacao_template, lei12741_ativo')
      .eq('company_id', body.companyId)
      .eq('ativo', true)
      .maybeSingle()

    // DECISÃO DO CEO (23/09): emissão fiscal é EXCLUSIVAMENTE via Focus. ETAPA 1 (reversível, sem
    // remoção): o caminho gov.br (edge gov-nfse-emitir) deixa de ser chamado — sem exceção nem
    // bifurcação por município. O bloco abaixo fica INTACTO (nada apagado); só se torna inalcançável
    // por este flag. Reverter = flag true. ETAPA 2 (aprovação separada) remove código/rota/colunas gov.
    // Prova (RD-38): 0 NFS-e já saíram pelo gov (todas as 117 via focusnfe); a config de TODAS as
    // empresas já é focusnfe (inclusive FC Pisos/Iporã) — este branch já era código morto em runtime.
    const GOV_NFSE_HABILITADO = false
    if (GOV_NFSE_HABILITADO && providerCfg?.provider === 'gov_nfse_nacional') {
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
    // Guard prestador (#90): sem o código do município do prestador, o Focus rejeita com a mensagem
    // crua "parametro prestador.codigo_municipio nao informado". Bloqueia ANTES com texto acionável.
    // Normalmente o campo é auto-preenchido do endereço da empresa (trigger cidade_estado->IBGE); só
    // cai aqui se a cidade não bate no cadastro de municípios (fica pro humano confirmar).
    {
      const muniPrestador = String(nfseReq.prestador.codigoMunicipio ?? '').replace(/\D/g, '')
      if (muniPrestador.length !== 7) {
        return NextResponse.json({
          ok: false,
          mensagem:
            'Configuração fiscal incompleta: falta o código do município (IBGE) da empresa emitente. ' +
            'Ele costuma ser preenchido sozinho pelo endereço da empresa — confirme a cidade/UF da empresa ' +
            'e o campo em Configurações › Fiscal › Município IBGE, e emita de novo.',
        }, { status: 400 })
      }
    }
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
            .select('opcao_simples_nacional, regime_tributario, regime_apuracao_sn, percentual_total_tributos_sn, reforma_finalidade_emissao, reforma_consumidor_final, reforma_indicador_destinatario, reforma_ibs_cbs_cst, reforma_ibs_cbs_classif_trib, serie_nfse_padrao')
            .eq('company_id', body.companyId)
            .eq('provider', 'focusnfe')
            .eq('ativo', true)
            .maybeSingle()
          // Série por TIPO DE EMISSOR (correção CEO 24/09): a emissão por INTEGRAÇÃO (nossa, via Focus) usa a
          // faixa 00001–49999; a faixa 50000+ é do PORTAL NACIONAL (outro tipo de emissor). Uma série de portal
          // na integração reprova E0010 ("série fora da faixa"). Bloqueia ANTES de enviar, com a faixa explicada
          // — impede repetir o engano de configurar série de portal aqui.
          {
            const serieCfg = Number(String((snCfg as { serie_nfse_padrao?: string } | null)?.serie_nfse_padrao ?? '').replace(/\D/g, ''))
            if (Number.isFinite(serieCfg) && serieCfg > 49999) {
              return NextResponse.json({ ok: false, mensagem: `Série da NFS-e (${serieCfg}) fora da faixa da emissão por INTEGRAÇÃO (00001–49999). A faixa 50000+ é do Portal Nacional (outro tipo de emissor) e reprova na integração (E0010). Ajuste a série da empresa em Configurações › Fiscal.` }, { status: 400 })
            }
          }
          // Opção do Simples RESOLVIDA sem adivinhar: usa a cadastrada; se nula, deriva do regime tributário;
          // regime desconhecido → BLOQUEIA (assumir optante OU não-optante emite nota errada — ex.: VIANZ,
          // opção nula + regime simples_nacional, não pode virar não-optante).
          const _opcaoSN = resolverOpcaoSimplesNacional(
            snCfg?.opcao_simples_nacional as number | null,
            snCfg?.regime_tributario as string | null,
          )
          if (_opcaoSN == null) {
            return NextResponse.json({ ok: false, mensagem: 'Configuração fiscal incompleta: defina a opção do Simples Nacional (ou o regime tributário) da empresa em Configurações › Fiscal antes de emitir. O sistema não adivinha o regime.' }, { status: 400 })
          }
          nfseReq.opcaoSimplesNacional = _opcaoSN
          nfseReq.regimeTributario = (snCfg?.regime_tributario as string | null) ?? null
          nfseReq.regimeApuracaoSN = (snCfg?.regime_apuracao_sn as number | null) ?? 1
          if (snCfg?.percentual_total_tributos_sn != null) nfseReq.percentualTribSN = Number(snCfg.percentual_total_tributos_sn)
          // DUAS FONTES DISTINTAS (não confundir): percentual_total_tributos_sn = TOTAL de tributos da
          // Lei 12.741 (pTotTribSN, ex.: 4,02 na nota 57 autorizada da R.R) ≠ alíquota de ISS do Simples
          // (pAliq, ex.: 4,19), que vem de erp_fiscal_aliquota_sn por competência. Para ME/EPP (opção 3) o
          // grupo trib exige o totTrib (E0712 proíbe indicador_total_tributacao); sem o total configurado,
          // não chutar — avisar para o contador preencher (evita cair numa rejeição obscura no provedor).
          if ((nfseReq.opcaoSimplesNacional === 2 || nfseReq.opcaoSimplesNacional === 3) && nfseReq.percentualTribSN == null) {
            return NextResponse.json({ ok: false, mensagem: 'Informe o percentual TOTAL de tributos do Simples (Lei 12.741) na Configuração Fiscal — é diferente da alíquota de ISS do Simples. Sem ele a nota não pode ser emitida.' }, { status: 400 })
          }
          // ISS POR MUNICÍPIO + TRAVA (decisão CEO 25/09, "opção i"). A tabela fiscal_iss_municipio estava
          // ÓRFÃ da emissão: Lages 3% cadastrada e nunca lida; o serviço tinha aliquota_iss=0, e o modal
          // mostrava 0. Para NÃO OPTANTE (regime normal, opc=1) o ISS é devido e precisa de alíquota > 0:
          // resolve a vigente da tabela (por município da PRESTAÇÃO + LC116) e, se não houver, TRAVA a
          // emissão (cadastro que funciona). Optante (Simples) NÃO entra aqui — ISS vai no DAS, alíquota 0 é
          // correta (E0625). retido_na_fonte NÃO é sugerido (CEO): a retenção fica com o operador (modal).
          if (nfseReq.opcaoSimplesNacional === 1) {
            const muniPrest = String(nfseReq.obra?.codigoMunicipio || nfseReq.prestador.codigoMunicipio || '').replace(/\D/g, '')
            let lc116: string | null = null
            if (body.servicoId) {
              const { data: sv } = await supabaseAdmin.from('erp_servicos').select('codigo_lc116').eq('id', body.servicoId).maybeSingle()
              lc116 = (sv?.codigo_lc116 as string | null) ?? null
            }
            if (!lc116) {
              const cs = String(nfseReq.codigoServico ?? '').replace(/\D/g, '')
              if (cs.length >= 4) lc116 = cs.slice(0, 2) + '.' + cs.slice(2, 4) // 070501 -> 07.05
            }
            let aliqMunic: number | null = null
            if (muniPrest.length === 7 && lc116) {
              const hoje = new Date().toISOString().slice(0, 10)
              const { data: issRows } = await supabaseAdmin
                .from('fiscal_iss_municipio')
                .select('aliquota, vigencia_inicio, vigencia_fim')
                .eq('company_id', body.companyId).eq('codigo_ibge', muniPrest).eq('codigo_lc116', lc116)
                .lte('vigencia_inicio', hoje)
                .order('vigencia_inicio', { ascending: false })
                .limit(10)
              const vig = ((issRows ?? []) as Array<{ aliquota: number | string; vigencia_fim: string | null }>)
                .find((r) => !r.vigencia_fim || String(r.vigencia_fim) >= hoje)
              if (vig?.aliquota != null) aliqMunic = Number(vig.aliquota)
            }
            if (aliqMunic != null && aliqMunic > 0) nfseReq.aliquotaIss = aliqMunic
            if (!(Number(nfseReq.aliquotaIss ?? 0) > 0)) {
              return NextResponse.json({
                ok: false,
                iss_municipio_pendente: true,
                mensagem: `Alíquota de ISS não configurada para o município da prestação${muniPrest ? ` (IBGE ${muniPrest})` : ''}${lc116 ? ` / LC ${lc116}` : ''}. Empresa de REGIME NORMAL não pode emitir NFS-e com ISS zerado. Cadastre a alíquota em Configurações › Fiscal › ISS por município e emita de novo.`,
              }, { status: 400 })
            }
          }
          // #90 / Focus #242149 · campos da Reforma (IBS/CBS) por empresa — OPCIONAIS e desligados por
          // padrão. Só entram no JSON quando a empresa preencheu na config (o builder ignora null/vazio).
          const rf = {
            finalidadeEmissao: (snCfg?.reforma_finalidade_emissao as number | null) ?? null,
            consumidorFinal: (snCfg?.reforma_consumidor_final as number | null) ?? null,
            indicadorDestinatario: (snCfg?.reforma_indicador_destinatario as number | null) ?? null,
            ibsCbsCst: (snCfg?.reforma_ibs_cbs_cst as string | null) ?? null,
            ibsCbsClassifTrib: (snCfg?.reforma_ibs_cbs_classif_trib as string | null) ?? null,
          }
          if (rf.finalidadeEmissao != null || rf.consumidorFinal != null || rf.indicadorDestinatario != null || rf.ibsCbsCst || rf.ibsCbsClassifTrib) {
            nfseReq.reforma = rf
          }
          // pAliq no regime SN com regApTribSN=1: a alíquota efetiva do MÊS (config por competência) só
          // vai na DPS quando o ISS é RETIDO pelo tomador/intermediário (tpRetISSQN=2/3). Sem retenção
          // (tpRetISSQN=1) a DPS NÃO leva pAliq — a alíquota do SN vai no DAS (E0625) — então NÃO bloqueia
          // a emissão por falta da alíquota da competência. Se estiver cadastrada, ainda carregamos o valor
          // (usado em cálculo interno/registro); o builder decide o envio pela retenção.
          // A alíquota do Simples por competência (erp_fiscal_aliquota_sn) só existe/importa para OPTANTE
          // (MEI=2 / ME/EPP=3). Empresa NÃO-optante (regime normal, ex.: FC Pisos) usa a alíquota municipal
          // do resolver e NUNCA pode ser bloqueada por falta da alíquota do Simples — por isso o gate exige
          // opção 2/3 (antes só olhava regApTribSN, que caía em 1 por default e pegava o não-optante).
          const _optanteSN = nfseReq.opcaoSimplesNacional === 2 || nfseReq.opcaoSimplesNacional === 3
          if (_optanteSN && (nfseReq.regimeApuracaoSN ?? 1) === 1) {
            const tpRet = nfseReq.tipoRetencaoISS ?? (nfseReq.retemIss ? 2 : 1)
            const issRetido = tpRet === 2 || tpRet === 3
            const bsb = new Date(Date.now() - 3 * 60 * 60 * 1000)  // competência = mês de Brasília (igual ao data_competencia da nota)
            const compIso = `${bsb.getUTCFullYear()}-${String(bsb.getUTCMonth() + 1).padStart(2, '0')}-01`
            const { data: aliq } = await supabaseAdmin
              .from('erp_fiscal_aliquota_sn')
              .select('aliquota')
              .eq('company_id', body.companyId)
              .eq('competencia', compIso)
              .maybeSingle()
            if (aliq?.aliquota == null) {
              if (issRetido) {
                // ISS retido: a alíquota é obrigatória na nota (o tomador retém sobre ela) → bloqueia sem chutar.
                const mm = `${String(bsb.getUTCMonth() + 1).padStart(2, '0')}/${bsb.getUTCFullYear()}`
                return NextResponse.json({ ok: false, mensagem: `Informe a alíquota de ISS do Simples de ${mm} na Configuração Fiscal antes de emitir (ISS retido pelo tomador).` }, { status: 400 })
              }
              // ISS não retido: segue sem pAliq (E0625) — nota autorizada normalmente.
            } else {
              nfseReq.aliquotaISSSN = Number(aliq.aliquota)
            }
          }
          // codigo_nbs do serviço (opcional — só enviado se preenchido)
          if (body.servicoId) {
            const { data: sv } = await supabaseAdmin
              .from('erp_servicos')
              .select('codigo_nbs')
              .eq('id', body.servicoId)
              .maybeSingle()
            if (sv?.codigo_nbs) nfseReq.codigoNbs = String(sv.codigo_nbs)
          }
          // Guard XSD (RD-51): o layout nacional EXIGE cMun (IBGE) e nro do tomador. Sem eles o Focus rejeita
          // no XSD. Bloqueia ANTES de enviar, com mensagem clara — não deixa virar erro fiscal obscuro.
          const endTom = nfseReq.tomador.endereco
          const faltando: string[] = []
          if (!endTom?.codigoMunicipio || !String(endTom.codigoMunicipio).replace(/\D/g, '')) faltando.push('código IBGE do município (preenche sozinho pelo CEP)')
          if (!endTom?.numero || !String(endTom.numero).trim()) faltando.push('número do endereço')
          if (faltando.length > 0) {
            return NextResponse.json({
              ok: false,
              mensagem: 'Complete o cadastro fiscal do tomador antes de emitir a NFS-e nacional: ' +
                faltando.join(' e ') + '. Edite o cliente em Clientes, informe o CEP (traz o IBGE) e o número, e emita de novo.',
            }, { status: 400 })
          }
        }
      }
    }

    // Lei 12.741/2012 (Transparência Fiscal) — o valor aproximado dos tributos vai nas INFORMAÇÕES
    // COMPLEMENTARES da nota (Focus: informacoes_complementares no nacional, outras_informacoes no
    // municipal), não em campo estruturado por esfera. Para Simples Nacional a lei aceita um único
    // percentual aproximado (percentual_total_tributos_sn, por empresa). valor = % × valor do serviço;
    // mostra R$ e %. A redação é PARÂMETRO (lei12741_observacao_template) — o contador muda por UPDATE.
    // Sem percentual (empresa fora do Simples) não compõe o bloco (aí depende da tabela IBPT — adiado).
    // Anexa a uma observação livre já existente na requisição, sem sobrescrever nem poluir a descrição.
    // SALVAGUARDA (CEO): só compõe se lei12741_ativo=true na config da empresa — liga/desliga por
    // empresa SEM PR. Default false: o merge não muda nada até ligar por empresa (rollout controlado;
    // e rollback instantâneo se a Focus recusar o campo ou a redação vier errada).
    {
      const pctTrib = Number(providerCfg?.percentual_total_tributos_sn ?? 0)
      if (providerCfg?.lei12741_ativo === true && Number.isFinite(pctTrib) && pctTrib > 0 && Number(nfseReq.valorServicos) > 0) {
        const valorAprox = Math.round((pctTrib / 100) * Number(nfseReq.valorServicos) * 100) / 100
        const fmt = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        const template = (typeof providerCfg?.lei12741_observacao_template === 'string' && providerCfg.lei12741_observacao_template.trim())
          ? providerCfg.lei12741_observacao_template.trim()
          : 'Valor aproximado dos tributos: R$ {valor} ({percentual}%) — Fonte: Simples Nacional, Lei 12.741/2012'
        const blocoLei12741 = template.replace(/\{valor\}/g, fmt(valorAprox)).replace(/\{percentual\}/g, fmt(pctTrib))
        nfseReq.observacoes = [blocoLei12741, nfseReq.observacoes]
          .map((s) => (s ?? '').trim())
          .filter(Boolean)
          .join(' | ')
      }
    }

    const svc = await createFiscalService(body.companyId)
    let resposta
    try {
      resposta = await svc.emitirNFSe(nfseReq)
    } catch (err) {
      // PONTO CEGO CORRIGIDO: rejeição de schema/validação do Focus chega como THROW (ex.: 422
      // "Element 'valores': not expected"), antes de virar nota. Antes disso NADA era gravado — nem
      // a tentativa, nem o payload — e ficávamos investigando às cegas. Aqui, para uma REJEIÇÃO de
      // conteúdo (não erro de infra como timeout), persistimos o payload enviado + o motivo como uma
      // NFS-e 'rejeitada' (aparece na lista, com o payload para depurar) e registramos a tentativa.
      if (isFiscalError(err)) {
        const ehRejeicao = err.code === 'PAYLOAD_INVALIDO' || err.code === 'NFSE_REJEITADA'
          || [400, 422].includes(Number((err.details as { status?: number } | undefined)?.status))
        const payloadEnviado = (err.details as { payloadEnviado?: unknown } | undefined)?.payloadEnviado ?? null
        const providerRef = (err.details as { providerReference?: string } | undefined)?.providerReference ?? `nfse-rej-${Date.now()}`
        try {
          if (ehRejeicao) {
            await supabaseAdmin.rpc('fn_registrar_nfse_emitida', {
              p_company_id: body.companyId,
              p_erp_receber_id: body.erpReceberId ?? null,
              p_provider_reference: providerRef,
              p_ambiente: svc.ambiente,
              p_dados: {
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
                status: 'rejeitada',
                serie: nfseReq.serie,
                motivo_rejeicao: err.message,
                payload_enviado: payloadEnviado,
              },
              p_provider_raw: (err.details as { body?: unknown } | undefined)?.body ?? null,
            })
          }
        } catch { /* nunca deixar a persistência do log derrubar a resposta de erro */ }
        await registrarTentativaFiscal({
          companyId: body.companyId,
          notaTipo: 'nfse',
          operacao: 'emissao',
          provider: 'focusnfe',
          endpoint: 'nfse/emitir',
          referencia: providerRef,
          providerMensagem: err.message,
          resultado: ehRejeicao ? 'rejeitada' : 'erro',
          usuarioId: userId,
        })
      }
      throw err
    }

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
      // #90/#64: guarda o payload enviado (sem cert/token) p/ depurar rejeição sem emitir no escuro.
      payload_enviado: resposta.payloadEnviado ?? null,
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

    // #82① · liga a nota emitida à obra (para rastreio e para a próxima nota já achar a obra)
    if (registroId && obraIdFinal) {
      await supabaseAdmin.from('erp_nfse_emitidas').update({ obra_id: obraIdFinal }).eq('id', registroId)
    }

    // Registra a EMISSÃO (nada de falha silenciosa) — antes só cancelamento/consulta gravavam tentativa.
    await registrarTentativaFiscal({
      companyId: body.companyId,
      notaTipo: 'nfse',
      notaId: (registroId as string | null) ?? null,
      operacao: 'emissao',
      provider: 'focusnfe',
      endpoint: 'nfse/emitir',
      referencia: resposta.providerReference,
      providerMensagem: resposta.motivoRejeicao ?? null,
      resultado: resposta.status === 'autorizada' ? 'ok'
        : resposta.status === 'rejeitada' ? 'rejeitada'
        : resposta.status === 'processando' ? 'processando' : 'ok',
      usuarioId: userId,
    })

    return NextResponse.json({
      ok: resposta.ok,
      nfseId: registroId,
      status: resposta.status,
      numero: resposta.numero,
      codigoVerificacao: resposta.codigoVerificacao,
      xmlUrl: resposta.xmlUrl,
      pdfUrl: resposta.pdfUrl,
      motivoRejeicao: humanizarErroFiscal(resposta.motivoRejeicao),
      providerReference: resposta.providerReference,
      ambiente: svc.ambiente,
    })
  } catch (err) {
    if (isFiscalError(err)) {
      const j = err.toJSON() as Record<string, unknown>
      if (typeof j.mensagem === 'string') j.mensagem = humanizarErroFiscal(j.mensagem)
      if (typeof j.motivoRejeicao === 'string') j.motivoRejeicao = humanizarErroFiscal(j.motivoRejeicao)
      return NextResponse.json(j, { status: 502 })
    }
    return NextResponse.json(
      { ok: false, mensagem: humanizarErroFiscal((err as Error)?.message) ?? 'Erro interno' },
      { status: 500 }
    )
  }
})
