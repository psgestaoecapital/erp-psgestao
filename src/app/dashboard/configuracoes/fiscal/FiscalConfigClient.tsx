'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import CertificadoUploadCard from '@/components/fiscal/CertificadoUploadCard'
import FocusNFeConfigCard from '@/components/fiscal/FocusNFeConfigCard'
import TestarConexaoButton from '@/components/fiscal/TestarConexaoButton'
import WebhookConfigCard from '@/components/fiscal/WebhookConfigCard'
import { ShieldCheck, AlertCircle, Loader2 } from 'lucide-react'

interface FiscalState {
  loading: boolean
  companyId: string | null
  config: Record<string, unknown> | null
  certificado: Record<string, unknown> | null
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

export default function FiscalConfigClient() {
  const [state, setState] = useState<FiscalState>({
    loading: true,
    companyId: null,
    config: null,
    certificado: null,
    erro: null,
  })

  const carregar = useCallback(async () => {
    setState(s => ({ ...s, loading: true }))
    const sel = resolveSelectedCompanyId()
    if (sel.kind === 'erro') {
      setState({ loading: false, companyId: null, config: null, certificado: null, erro: sel.mensagem })
      return
    }

    try {
      const { data, error } = await supabase.rpc('fn_buscar_provider_config_ativa', {
        p_company_id: sel.id,
        p_provider: 'focusnfe',
      })
      if (error) throw error

      const payload = (data ?? {}) as {
        encontrou?: boolean
        tem_certificado?: boolean
        config?: Record<string, unknown>
        certificado?: Record<string, unknown>
      }

      setState({
        loading: false,
        companyId: sel.id,
        config: payload.encontrou ? payload.config ?? null : null,
        certificado: payload.tem_certificado ? payload.certificado ?? null : null,
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

  const temConfigCompleta = !!state.config && !!state.certificado

  return (
    <div className="space-y-5">
      <div className={`rounded-xl p-4 flex items-start gap-3 ${
        temConfigCompleta
          ? 'bg-[#E8F4DC] border border-[#C0DD97]'
          : 'bg-[#FAEEDA] border border-[#E8C387]'
      }`}>
        {temConfigCompleta ? (
          <ShieldCheck className="text-[#3F7012] flex-shrink-0 mt-0.5" size={20} />
        ) : (
          <AlertCircle className="text-[#BA7517] flex-shrink-0 mt-0.5" size={20} />
        )}
        <div className="flex-1">
          <div className={`text-[13.5px] font-medium ${
            temConfigCompleta ? 'text-[#1B3608]' : 'text-[#633806]'
          }`}>
            {temConfigCompleta
              ? 'Configuração completa — pronto para emitir notas'
              : 'Configuração incompleta — siga os passos abaixo'}
          </div>
          {!temConfigCompleta && (
            <div className="text-[12px] text-[#5C3A06] mt-1">
              Você precisa: {!state.certificado && '1) subir certificado A1'}
              {!state.certificado && !state.config && ' · '}
              {!state.config && '2) cadastrar API key Focus NFe'}
            </div>
          )}
        </div>
        {temConfigCompleta && state.companyId && (
          <TestarConexaoButton companyId={state.companyId} />
        )}
      </div>

      <CertificadoUploadCard
        companyId={state.companyId!}
        certificadoAtual={state.certificado}
        onAtualizado={carregar}
      />

      <FocusNFeConfigCard
        companyId={state.companyId!}
        configAtual={state.config}
        certificadoOk={!!state.certificado}
        onAtualizado={carregar}
      />

      <WebhookConfigCard
        companyId={state.companyId!}
        habilitado={!!state.config && !!state.certificado}
      />

      <div className="bg-white border border-[#3D2314]/10 rounded-xl p-4 text-[12px] text-[#3D2314]/70 leading-relaxed">
        <strong className="text-[#3D2314] font-medium">Sobre o Focus NFe:</strong> emite NFSe em mais
        de 1.200 prefeituras brasileiras · NFe nacional · Manifestação do Destinatário automática.{' '}
        <a href="https://focusnfe.com.br" target="_blank" rel="noopener" className="text-[#BA7517] underline">
          focusnfe.com.br
        </a>
      </div>
    </div>
  )
}
