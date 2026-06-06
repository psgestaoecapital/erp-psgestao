'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import CertificadoUploadCard from '@/components/fiscal/CertificadoUploadCard'
import FocusNFeConfigCard from '@/components/fiscal/FocusNFeConfigCard'
import TestarConexaoButton from '@/components/fiscal/TestarConexaoButton'
import WebhookConfigCard from '@/components/fiscal/WebhookConfigCard'
import { ShieldCheck, AlertCircle, Loader2, FileCheck, CheckCircle2, XCircle } from 'lucide-react'

// FIX-FISCAL-UX-v1 · Saneamento V1 Fase 1
// Bugs corrigidos:
//   1. Banner sempre "incompleta" mesmo com tudo configurado · agora reflete
//      checklist explicito (cert / cfg / IM / municipio / numeracao / SN fields).
//   2. Apos salvar cert, refetch acontecia mas dependia da query direta ·
//      mantemos onAtualizado={carregar} e adicionamos refetch tambem da
//      empresa (IM).
//   3. Checklist mostra OK/Falta em linguagem do usuario.

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
  opcao_simples_nacional: number | null
  percentual_total_tributos_sn: number | string | null
  regime_apuracao_sn: number | null
}

interface EmpresaRow {
  cnpj: string | null
  razao_social: string | null
  inscricao_municipal: string | null
}

interface FiscalState {
  loading: boolean
  companyId: string | null
  config: ConfigRow | null
  certificado: CertificadoRow | null
  empresa: EmpresaRow | null
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
  return p === 'focusnfe' || p === 'focus_nfe'
}

function isGovProvider(p: string | null | undefined): boolean {
  return p === 'gov_nfse_nacional'
}

interface ChecklistItem {
  label: string
  ok: boolean
  detalhe?: string
  critico: boolean // se false, eh recomendado mas nao quebra emissao
}

function buildChecklist(state: FiscalState): ChecklistItem[] {
  const cfg = state.config
  const cert = state.certificado
  const emp = state.empresa
  const isSnOptante = cfg?.opcao_simples_nacional === 2 || cfg?.opcao_simples_nacional === 3
  const items: ChecklistItem[] = [
    {
      label: 'Certificado digital A1',
      ok: !!cert,
      detalhe: cert
        ? `${cert.razao_social_certificado ?? 'Cert salvo'} · válido até ${fmtData(cert.validade_fim)}`
        : 'Envie o arquivo .pfx/.p12 + senha',
      critico: true,
    },
    {
      label: 'Emissor configurado',
      ok: !!cfg,
      detalhe: cfg
        ? (isGovProvider(cfg.provider)
            ? `NFSe Nacional gov.br · ambiente ${cfg.ambiente ?? '—'}`
            : isFocusProvider(cfg.provider)
              ? 'Focus NFe'
              : `${cfg.provider ?? 'desconhecido'}`)
        : 'Escolha entre NFSe Nacional gov.br ou Focus NFe',
      critico: true,
    },
    {
      label: 'Município (IBGE)',
      ok: !!cfg?.gov_nfse_municipio_codigo,
      detalhe: cfg?.gov_nfse_municipio_codigo
        ? `${cfg.gov_nfse_municipio_codigo}${cfg.gov_nfse_municipio_aderido ? ' · aderido ao NFSe Nacional' : ''}`
        : 'Defina o código IBGE da prestação',
      critico: true,
    },
    {
      label: 'Inscrição municipal',
      ok: !!(emp?.inscricao_municipal && String(emp.inscricao_municipal).trim()),
      detalhe: emp?.inscricao_municipal && String(emp.inscricao_municipal).trim()
        ? `IM ${emp.inscricao_municipal}`
        : 'Preencha a IM da empresa (necessária pra NFS-e)',
      critico: true,
    },
    {
      label: 'Numeração da série',
      ok: !!(cfg?.serie_nfse_padrao && cfg.proxima_numeracao_nfse != null),
      detalhe: cfg?.serie_nfse_padrao
        ? `Série ${cfg.serie_nfse_padrao} · próximo número ${cfg.proxima_numeracao_nfse ?? '—'}`
        : 'Configure série + próximo número da DPS',
      critico: true,
    },
  ]
  if (isSnOptante) {
    items.push(
      {
        label: 'Opção Simples Nacional',
        ok: cfg?.opcao_simples_nacional != null,
        detalhe: cfg?.opcao_simples_nacional === 2
          ? 'MEI'
          : cfg?.opcao_simples_nacional === 3
            ? 'ME/EPP optante'
            : 'Defina MEI ou ME/EPP',
        critico: true,
      },
      {
        label: 'Regime de apuração SN',
        ok: cfg?.regime_apuracao_sn != null,
        detalhe: cfg?.regime_apuracao_sn === 1
          ? 'Federais + municipal pelo SN'
          : cfg?.regime_apuracao_sn === 2
            ? 'Federais SN + ISS fora'
            : cfg?.regime_apuracao_sn === 3
              ? 'Federais e municipal fora'
              : 'Defina regApTribSN (1/2/3)',
        critico: true,
      },
      {
        label: 'Percentual total tributos SN',
        ok: cfg?.percentual_total_tributos_sn != null,
        detalhe: cfg?.percentual_total_tributos_sn != null
          ? `${Number(cfg.percentual_total_tributos_sn).toFixed(2)}%`
          : 'Defina o percentual aproximado da alíquota Simples (Lei 12.741)',
        critico: true,
      },
    )
  }
  return items
}

export default function FiscalConfigClient() {
  const [state, setState] = useState<FiscalState>({
    loading: true,
    companyId: null,
    config: null,
    certificado: null,
    empresa: null,
    erro: null,
  })

  const carregar = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }))
    const sel = resolveSelectedCompanyId()
    if (sel.kind === 'erro') {
      setState({ loading: false, companyId: null, config: null, certificado: null, empresa: null, erro: sel.mensagem })
      return
    }

    try {
      const [certRes, cfgRes, empRes] = await Promise.all([
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
            'id, provider, ambiente, api_key_encrypted, gov_nfse_municipio_codigo, gov_nfse_municipio_aderido, gov_nfse_endpoint_base, serie_nfse_padrao, proxima_numeracao_nfse, serie_nfe_padrao, proxima_numeracao_nfe, cnae_padrao, regime_tributario, opcao_simples_nacional, percentual_total_tributos_sn, regime_apuracao_sn'
          )
          .eq('company_id', sel.id)
          .eq('ativo', true)
          .order('atualizado_em', { ascending: false, nullsFirst: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('companies')
          .select('cnpj, razao_social, inscricao_municipal')
          .eq('id', sel.id)
          .maybeSingle(),
      ])

      if (certRes.error) throw certRes.error
      if (cfgRes.error) throw cfgRes.error
      if (empRes.error) throw empRes.error

      setState({
        loading: false,
        companyId: sel.id,
        certificado: (certRes.data as CertificadoRow | null) ?? null,
        config: (cfgRes.data as ConfigRow | null) ?? null,
        empresa: (empRes.data as EmpresaRow | null) ?? null,
        erro: null,
      })
    } catch (err) {
      const mensagem = err instanceof Error ? err.message : 'Erro ao carregar configuração'
      setState({ loading: false, companyId: sel.id, config: null, certificado: null, empresa: null, erro: mensagem })
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

  const checklist = buildChecklist(state)
  const itensCriticos = checklist.filter((i) => i.critico)
  const okCriticos = itensCriticos.filter((i) => i.ok).length
  const totalCriticos = itensCriticos.length
  const completo = okCriticos === totalCriticos
  const provider = state.config?.provider ?? null

  return (
    <div className="space-y-5">
      {/* Banner */}
      <div
        className={`rounded-xl p-4 flex items-start gap-3 ${
          completo
            ? 'bg-[#E8F4DC] border border-[#C0DD97]'
            : okCriticos > 0
              ? 'bg-[#FAEEDA] border border-[#E8C387]'
              : 'bg-[#FCEBEB] border border-[#E8A6A5]'
        }`}
      >
        {completo ? (
          <ShieldCheck className="text-[#3F7012] flex-shrink-0 mt-0.5" size={20} />
        ) : okCriticos > 0 ? (
          <FileCheck className="text-[#BA7517] flex-shrink-0 mt-0.5" size={20} />
        ) : (
          <AlertCircle className="text-[#C94544] flex-shrink-0 mt-0.5" size={20} />
        )}
        <div className="flex-1 min-w-0">
          <div
            className={`text-[13.5px] font-medium ${
              completo ? 'text-[#1B3608]' : okCriticos > 0 ? 'text-[#633806]' : 'text-[#791F1F]'
            }`}
          >
            {completo
              ? 'Configuração fiscal completa'
              : okCriticos > 0
                ? `Configuração parcial · ${okCriticos} de ${totalCriticos} OK`
                : 'Configuração fiscal incompleta'}
          </div>
          <div
            className={`text-[12px] mt-1 ${
              completo ? 'text-[#1B3608]/80' : okCriticos > 0 ? 'text-[#5C3A06]' : 'text-[#791F1F]/85'
            }`}
          >
            {completo
              ? 'Empresa pronta pra emitir NFS-e em produção.'
              : 'Veja o checklist abaixo · cada item explica o que falta.'}
          </div>
        </div>
        {completo && state.companyId && isFocusProvider(provider) && (
          <TestarConexaoButton companyId={state.companyId} />
        )}
      </div>

      {/* Checklist explicito */}
      <div className="bg-white border border-[#3D2314]/10 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-[#3D2314]/10">
          <div className="text-[11px] text-[#3D2314]/55 tracking-[0.8px] uppercase font-medium">Checklist</div>
          <h2 className="text-[14px] font-medium text-[#3D2314]">O que está pronto</h2>
        </div>
        <ul className="divide-y divide-[#3D2314]/8">
          {checklist.map((item, i) => (
            <li key={i} className="px-5 py-3 flex items-start gap-3" data-testid={`checklist-item-${i}`}>
              {item.ok ? (
                <CheckCircle2 className="text-[#3F7012] flex-shrink-0 mt-0.5" size={16} />
              ) : (
                <XCircle className="text-[#C94544] flex-shrink-0 mt-0.5" size={16} />
              )}
              <div className="flex-1 min-w-0">
                <div className={`text-[13px] font-medium ${item.ok ? 'text-[#1B3608]' : 'text-[#3D2314]'}`}>
                  {item.label}
                </div>
                {item.detalhe && (
                  <div className={`text-[11.5px] mt-0.5 ${item.ok ? 'text-[#1B3608]/70' : 'text-[#3D2314]/65'}`}>
                    {item.detalhe}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* Detalhe certificado salvo */}
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
