'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import CertificadoUploadCard from '@/components/fiscal/CertificadoUploadCard'
import FocusNFeConfigCard from '@/components/fiscal/FocusNFeConfigCard'
import TestarConexaoButton from '@/components/fiscal/TestarConexaoButton'
import WebhookConfigCard from '@/components/fiscal/WebhookConfigCard'
import { ShieldCheck, AlertCircle, Loader2, FileCheck } from 'lucide-react'

interface CertificadoRow {
  id: string
  razao_social_certificado: string | null
  cnpj_certificado: string | null
  validade_inicio: string | null
  validade_fim: string | null
  criado_em: string | null
  status: string | null
}

interface ConfigRow {
  id: string
  provider: string | null
  ambiente: string | null
  api_key_encrypted: string | null
  gov_nfse_municipio_codigo: string | null
  gov_nfse_municipio_aderido: boolean | null
  gov_nfse_endpoint_base: string | null
  serie_nfse_padrao: string | null
  proxima_numeracao_nfse: number | null
  serie_nfe_padrao: string | null
  proxima_numeracao_nfe: number | null
  cnae_padrao: string | null
  regime_tributario: string | null
}

interface FiscalState {
  loading: boolean
  companyId: string | null
  config: ConfigRow | null
  certificado: CertificadoRow | null
  erro: string | null
}

function resolveSelectedCompanyId(): { kind: 'ok'; id: string } | { kind: 'erro'; mensagem: string } {
  if (typeof window === 'undefined') return { kind: 'erro', mensagem: 'Carregando…' }
  const sel = localStorage.getItem('ps_empresa_sel')
  if (!sel || sel === 'consolidado') {
    return { kind: 'erro', mensagem: 'Selecione uma empresa específica no trocador da TopNav (consolidado / grupo não emitem nota).' }
  }
  if (sel.startsWith('group_')) {
    return { kind: 'erro', mensagem: 'Configuração fiscal é por empresa — selecione uma empresa do grupo.' }
  }
  return { kind: 'ok', id: sel }
}

const fmtCnpj = (raw: string | null) => {
  if (!raw) return '—'
  const v = raw.replace(/\D/g, '')
  if (v.length !== 14) return raw
  return v.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
}

const fmtData = (iso: string | null) => {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('pt-BR')
  } catch {
    return '—'
  }
}

function isFocusProvider(p: string | null | undefined): boolean {
  // DB usa 'focusnfe' (sem underscore) · aceitamos 'focus_nfe' por defensividade
  return p === 'focusnfe' || p === 'focus_nfe'
}

interface BannerInfo {
  tipo: 'incompleto' | 'parcial' | 'completo'
  titulo: string
  subtitulo?: string
}

function getBanner(state: FiscalState): BannerInfo {
  if (!state.certificado) {
    return {
      tipo: 'incompleto',
      titulo: 'Falta enviar o certificado digital A1 (Passo 1)',
      subtitulo: 'O certificado A1 é necessário pra qualquer emissão fiscal',
    }
  }
  if (!state.config) {
    return {
      tipo: 'parcial',
      titulo: 'Certificado OK. Falta configurar o emissor de notas (Passo 2)',
      subtitulo: 'Escolha entre NFSe Nacional gov.br (grátis) ou Focus NFe',
    }
  }
  return {
    tipo: 'completo',
    titulo: 'Configuração fiscal completa',
    subtitulo: providerSubtitulo(state.config),
  }
}

function providerSubtitulo(c: ConfigRow): string {
  if (c.provider === 'gov_nfse_nacional') {
    const muni = c.gov_nfse_municipio_codigo ?? '—'
    const aderido = c.gov_nfse_municipio_aderido
    return `Emissor: NFSe Nacional gov.br · município ${muni} ${aderido ? 'aderido ✓' : 'não aderido'}`
  }
  if (isFocusProvider(c.provider)) {
    const apiOk = !!c.api_key_encrypted
    return `Emissor: Focus NFe · API key ${apiOk ? 'cadastrada' : 'pendente'}`
  }
  return `Emissor: ${c.provider ?? 'não definido'}`
}

export default function FiscalConfigClient() {
  const [state, setState] = useState<FiscalState>({
    loading: true,
    companyId: null,
    config: null,
    certificado: null,
    erro: null,
  })

  const carregar = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }))
    const sel = resolveSelectedCompanyId()
    if (sel.kind === 'erro') {
      setState({ loading: false, companyId: null, config: null, certificado: null, erro: sel.mensagem })
      return
    }

    try {
      // Queries diretas · provider-agnostic · ignora hardcode anterior de p_provider='focusnfe'
      const [certRes, cfgRes] = await Promise.all([
        supabase
          .from('erp_certificados_a1')
          .select(
            'id, razao_social_certificado, cnpj_certificado, validade_inicio, validade_fim, criado_em, status'
          )
          .eq('company_id', sel.id)
          .eq('status', 'ativo')
          .is('removido_em', null)
          .order('criado_em', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('erp_fiscal_provider_config')
          .select(
            'id, provider, ambiente, api_key_encrypted, gov_nfse_municipio_codigo, gov_nfse_municipio_aderido, gov_nfse_endpoint_base, serie_nfse_padrao, proxima_numeracao_nfse, serie_nfe_padrao, proxima_numeracao_nfe, cnae_padrao, regime_tributario'
          )
          .eq('company_id', sel.id)
          .eq('ativo', true)
          .order('atualizado_em', { ascending: false, nullsFirst: false })
          .limit(1)
          .maybeSingle(),
      ])

      if (certRes.error) throw certRes.error
      if (cfgRes.error) throw cfgRes.error

      setState({
        loading: false,
        companyId: sel.id,
        certificado: (certRes.data as CertificadoRow | null) ?? null,
        config: (cfgRes.data as ConfigRow | null) ?? null,
        erro: null,
      })
    } catch (err) {
      const mensagem = err instanceof Error ? err.message : 'Erro ao carregar configuração'
      setState({ loading: false, companyId: sel.id, config: null, certificado: null, erro: mensagem })
    }
  }, [])

  useEffect(() => { carregar() }, [carregar])

  if (state.loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="animate-spin text-[#C8941A]" size={28} />
      </div>
    )
  }

  if (state.erro && !state.companyId) {
    return (
      <div className="bg-[#FCEBEB] border-l-4 border-[#C94544] rounded-lg p-4 flex items-start gap-3">
        <AlertCircle className="text-[#C94544] flex-shrink-0 mt-0.5" size={18} />
        <div className="text-[13px] text-[#791F1F]">{state.erro}</div>
      </div>
    )
  }

  const banner = getBanner(state)
  const provider = state.config?.provider ?? null

  return (
    <div className="space-y-5">
      <div
        className={`rounded-xl p-4 flex items-start gap-3 ${
          banner.tipo === 'completo'
            ? 'bg-[#E8F4DC] border border-[#C0DD97]'
            : banner.tipo === 'parcial'
              ? 'bg-[#FAEEDA] border border-[#E8C387]'
              : 'bg-[#FCEBEB] border border-[#E8A6A5]'
        }`}
      >
        {banner.tipo === 'completo' ? (
          <ShieldCheck className="text-[#3F7012] flex-shrink-0 mt-0.5" size={20} />
        ) : banner.tipo === 'parcial' ? (
          <FileCheck className="text-[#BA7517] flex-shrink-0 mt-0.5" size={20} />
        ) : (
          <AlertCircle className="text-[#C94544] flex-shrink-0 mt-0.5" size={20} />
        )}
        <div className="flex-1 min-w-0">
          <div
            className={`text-[13.5px] font-medium ${
              banner.tipo === 'completo'
                ? 'text-[#1B3608]'
                : banner.tipo === 'parcial'
                  ? 'text-[#633806]'
                  : 'text-[#791F1F]'
            }`}
          >
            {banner.titulo}
          </div>
          {banner.subtitulo && (
            <div
              className={`text-[12px] mt-1 ${
                banner.tipo === 'completo'
                  ? 'text-[#1B3608]/80'
                  : banner.tipo === 'parcial'
                    ? 'text-[#5C3A06]'
                    : 'text-[#791F1F]/85'
              }`}
            >
              {banner.subtitulo}
            </div>
          )}
          {provider === 'gov_nfse_nacional' && state.certificado && state.config && (
            <div className="text-[11.5px] text-[#1B3608]/75 mt-1">
              Ambiente: {state.config.ambiente ?? '—'}
              {state.config.gov_nfse_municipio_codigo && (
                <span> · IBGE {state.config.gov_nfse_municipio_codigo}</span>
              )}
            </div>
          )}
        </div>
        {banner.tipo === 'completo' && state.companyId && isFocusProvider(provider) && (
          <TestarConexaoButton companyId={state.companyId} />
        )}
      </div>

      {state.certificado && (
        <div className="bg-white border border-[#3D2314]/10 rounded-xl px-4 py-3 flex items-start gap-3">
          <FileCheck className="text-[#3F7012] flex-shrink-0 mt-0.5" size={16} />
          <div className="flex-1 min-w-0 text-[12.5px]">
            <div className="font-medium text-[#3D2314]">
              Certificado salvo · {state.certificado.razao_social_certificado ?? 'Sem razão social'}
            </div>
            <div className="text-[#3D2314]/70 mt-0.5">
              CNPJ {fmtCnpj(state.certificado.cnpj_certificado)} · válido até{' '}
              {fmtData(state.certificado.validade_fim)}
            </div>
          </div>
        </div>
      )}

      <CertificadoUploadCard
        companyId={state.companyId!}
        certificadoAtual={state.certificado as unknown as Record<string, unknown> | null}
        onAtualizado={carregar}
      />

      <FocusNFeConfigCard
        companyId={state.companyId!}
        configAtual={state.config as unknown as Record<string, unknown> | null}
        certificadoOk={!!state.certificado}
        onAtualizado={carregar}
      />

      <WebhookConfigCard
        companyId={state.companyId!}
        habilitado={!!state.config && !!state.certificado && isFocusProvider(provider)}
      />

      <div className="bg-white border border-[#3D2314]/10 rounded-xl p-4 text-[12px] text-[#3D2314]/70 leading-relaxed">
        <strong className="text-[#3D2314] font-medium">Emissores disponíveis:</strong>{' '}
        <strong>NFSe Nacional gov.br</strong> (oficial Receita Federal · grátis · obrigatório SET/2026
        pra Simples Nacional) ou{' '}
        <a href="https://focusnfe.com.br" target="_blank" rel="noopener" className="text-[#BA7517] underline">
          Focus NFe
        </a>{' '}
        (terceirizado · pago · útil pra prefeituras não aderidas ao gov.br).
      </div>
    </div>
  )
}
