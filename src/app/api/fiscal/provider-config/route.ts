import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/withAuth'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { guardaEmpresaFiscal } from '@/lib/auth/assertAcessoEmpresa'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const POST = withAuth(async (req: NextRequest, { userId }) => {
  try {
    const body = await req.json()
    const {
      companyId, apiKey, ambiente,
      serieNfsePadrao, proximaNumeracaoNfse,
      serieNfePadrao, proximaNumeracaoNfe,
      cnaePadrao, regimeTributario,
      provider,
      govNfseMunicipioCodigo,
      govNfseMunicipioAderido,
    } = body as Record<string, unknown>

    if (typeof companyId !== 'string' || typeof ambiente !== 'string') {
      return NextResponse.json({ ok: false, erro: 'companyId e ambiente são obrigatórios' }, { status: 400 })
    }

    const negado = await guardaEmpresaFiscal({ userId, companyId, papelMinimo: 'gerente', log: { notaTipo: 'nfe', operacao: 'provider_config', endpoint: 'provider-config' } })
    if (negado) return negado

    const providerFinal =
      typeof provider === 'string' && provider.length > 0 ? provider : 'focusnfe'

    // Só pode existir 1 config ATIVA por empresa (índice uq_fiscal_uma_config_ativa =
    // UNIQUE(company_id) WHERE ativo). Ao trocar de provider/ambiente (ex.: gov homologação →
    // Focus produção) o certo é ATUALIZAR a config ativa da empresa na mesma linha — nunca inserir
    // uma segunda ativa (era o que estourava "duplicate key uq_fiscal_uma_config_ativa").
    const { data: existente } = await supabaseAdmin
      .from('erp_fiscal_provider_config')
      .select('id, provider, api_key_encrypted, focus_token_vault_id')
      .eq('company_id', companyId)
      .eq('ativo', true)
      .maybeSingle()

    const payload: Record<string, unknown> = {
      company_id: companyId,
      provider: providerFinal,
      ambiente,
      serie_nfse_padrao: typeof serieNfsePadrao === 'string' ? serieNfsePadrao : '1',
      proxima_numeracao_nfse: typeof proximaNumeracaoNfse === 'number' ? proximaNumeracaoNfse : 1,
      serie_nfe_padrao: typeof serieNfePadrao === 'string' ? serieNfePadrao : '1',
      proxima_numeracao_nfe: typeof proximaNumeracaoNfe === 'number' ? proximaNumeracaoNfe : 1,
      cnae_padrao: typeof cnaePadrao === 'string' ? cnaePadrao : null,
      regime_tributario: typeof regimeTributario === 'string' ? regimeTributario : null,
      ativo: true,
      atualizado_por: userId,
    }

    if (providerFinal === 'gov_nfse_nacional') {
      const codigo =
        typeof govNfseMunicipioCodigo === 'string' ? govNfseMunicipioCodigo.replace(/\D/g, '') : null
      if (!codigo || codigo.length !== 7) {
        return NextResponse.json(
          { ok: false, erro: 'Código IBGE do município (7 dígitos) obrigatório pra gov.br NFSe' },
          { status: 400 }
        )
      }
      payload.gov_nfse_municipio_codigo = codigo
      payload.gov_nfse_municipio_aderido =
        typeof govNfseMunicipioAderido === 'boolean' ? govNfseMunicipioAderido : false
      // gov.br NÃO precisa api_key · ignora campo
    } else {
      // Trocando gov → Focus na mesma linha: zera os campos do gov (a linha vira Focus).
      payload.gov_nfse_municipio_codigo = null
      payload.gov_nfse_municipio_aderido = false
      // #1944 · o token da Focus vai SÓ para o cofre (fn_fiscal_salvar_token, chamada pela tela como o próprio
      // usuário) — nunca mais em texto nesta tabela (api_key_encrypted era só base64). Token no corpo = recusa.
      if (typeof apiKey === 'string' && apiKey.trim()) {
        return NextResponse.json(
          { ok: false, erro: 'O token do Focus é gravado no cofre pela tela (Passo 2 › Token). Atualize a página e salve de novo.' },
          { status: 400 }
        )
      }
      const temToken = !!existente && (!!existente.focus_token_vault_id || !!existente.api_key_encrypted)
      if (!temToken) {
        return NextResponse.json(
          { ok: false, erro: 'Token do Focus obrigatório: informe o token da conta para ativar a emissão.' },
          { status: 400 }
        )
      }
    }

    if (existente) {
      const { data, error } = await supabaseAdmin
        .from('erp_fiscal_provider_config')
        .update(payload)
        .eq('id', existente.id)
        .select('id')
        .single()
      if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })
      return NextResponse.json({ ok: true, configId: data.id })
    }

    payload.criado_por = userId
    const { data, error } = await supabaseAdmin
      .from('erp_fiscal_provider_config')
      .insert(payload)
      .select('id')
      .single()
    if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, configId: data.id })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro'
    return NextResponse.json({ ok: false, erro: msg }, { status: 500 })
  }
})
