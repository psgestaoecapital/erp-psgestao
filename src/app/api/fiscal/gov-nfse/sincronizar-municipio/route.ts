import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/withAuth'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { guardaEmpresaFiscal } from '@/lib/auth/assertAcessoEmpresa'
import { adnEndpointBase } from '@/lib/fiscal/govNfseNacional'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// NFS-e Nacional · item 2 (spec 26/11): sincroniza a ADESÃO do município (tabela GLOBAL erp_gov_nfse_municipios,
// alimentada pela Receita/Focus) para a CONFIG da empresa (erp_fiscal_provider_config). O município pode ter
// aderido e a empresa nunca ter sincronizado — aqui a empresa "puxa" esse estado, sem SQL manual.
//
// IDEMPOTENTE: pode rodar quantas vezes quiser; cada execução regrava o estado atual + o carimbo de consulta.
// Grava: gov_nfse_municipio_aderido, gov_nfse_endpoint_base (ADN nacional do ambiente — referência) e
// gov_nfse_ultima_consulta_municipio = now(). Não transmite nada, não toca numeração, não toca dado de cliente.
// Guarda de empresa (gerente), igual ao resto da configuração fiscal.
export const POST = withAuth(async (req: NextRequest, { userId }) => {
  try {
    const body = (await req.json().catch(() => ({}))) as { companyId?: string }
    const companyId = typeof body.companyId === 'string' ? body.companyId : ''
    if (!companyId || companyId === 'consolidado' || companyId.startsWith('group_')) {
      return NextResponse.json({ ok: false, erro: 'Selecione 1 empresa específica para sincronizar o município.' }, { status: 400 })
    }

    const negado = await guardaEmpresaFiscal({
      userId, companyId, papelMinimo: 'gerente',
      log: { notaTipo: 'nfse', operacao: 'gov_nfse_sync_municipio', endpoint: 'gov-nfse/sincronizar-municipio' },
    })
    if (negado) return negado

    const { data: cfg } = await supabaseAdmin
      .from('erp_fiscal_provider_config')
      .select('id, ambiente, gov_nfse_municipio_codigo')
      .eq('company_id', companyId)
      .eq('ativo', true)
      .maybeSingle()
    if (!cfg) {
      return NextResponse.json({ ok: false, erro: 'Nenhuma configuração fiscal ativa para esta empresa. Configure o emissor fiscal antes de sincronizar o município.' }, { status: 400 })
    }

    const codigo = String(cfg.gov_nfse_municipio_codigo ?? '').replace(/\D/g, '')
    if (codigo.length !== 7) {
      return NextResponse.json({ ok: false, erro: 'Código do município (IBGE, 7 dígitos) não configurado. Preencha o município em Configurações › Fiscal e salve antes de sincronizar.' }, { status: 400 })
    }

    // Tabela GLOBAL de adesão (sem dono) — a fonte de verdade da adesão do município ao NFS-e Nacional.
    const { data: muni } = await supabaseAdmin
      .from('erp_gov_nfse_municipios')
      .select('codigo_ibge, nome_municipio, uf, aderido, data_adesao')
      .eq('codigo_ibge', codigo)
      .maybeSingle()

    const aderido = muni?.aderido === true
    // Endpoint só faz sentido quando aderido; se não aderiu (ou não está na lista), zera para não enganar.
    const endpointBase = aderido ? adnEndpointBase(cfg.ambiente) : null
    const agora = new Date().toISOString()

    const { error } = await supabaseAdmin
      .from('erp_fiscal_provider_config')
      .update({
        gov_nfse_municipio_aderido: aderido,
        gov_nfse_endpoint_base: endpointBase,
        gov_nfse_ultima_consulta_municipio: agora,
        atualizado_por: userId,
        atualizado_em: agora,
      })
      .eq('id', cfg.id)
    if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })

    return NextResponse.json({
      ok: true,
      codigo,
      nome: muni?.nome_municipio ?? null,
      uf: muni?.uf ?? null,
      conhecido: !!muni,
      aderido,
      dataAdesao: muni?.data_adesao ?? null,
      endpointBase,
      consultadoEm: agora,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro'
    return NextResponse.json({ ok: false, erro: msg }, { status: 500 })
  }
})
