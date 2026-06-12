'use client'

// FEAT-NFE-PRODUTO-2-CARD-PEDIDO-v1
// Card "NF-E DO PRODUTO" no pedido · espelha o card NFS-e (#287).
// 4 estados (sem nota · processando · autorizada · rejeitada) ·
// emissao via POST /api/fiscal/nfe/emitir com ambiente='homologacao' ·
// vincula pedido<->NF-e via fn_pedido_nfe_marcar_emitida apos sucesso.

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { authFetch } from '@/lib/authFetch'

interface Props {
  companyId: string
  pedidoId: string
  // FEAT-NFE-PRODUTO-3-PRODUCAO-v1
  // forcarHomologacao=true mantem comportamento NFe-2 (banner amarelo + override)
  // por default = false → usa ambiente da config (producao em KGF) com confirmacao explicita
  forcarHomologacao?: boolean
}

interface NFeDados {
  tem_produto?: boolean
  valor_produtos?: number
  ja_emitida?: boolean
  nfe_existente?: { id: string; numero: string | null; status: string; danfe_url: string | null } | null
  erro?: string
}

interface NFeUltima {
  id: string
  numero: string | null
  status: string
  danfe_url: string | null
  motivo_rejeicao: string | null
  provider_reference: string | null
}

const C = {
  espresso: '#3D2314',
  espressoM: '#6B5D4F',
  espressoL: '#9C8E80',
  white: '#FFFFFF',
  cream: '#F0ECE3',
  border: '#E0D8CC',
  borderL: '#EDE7DA',
  gold: '#C8941A',
  goldD: '#A57A15',
  goldBg: '#FDF7E8',
  green: '#10B981',
  greenBg: '#ECFDF5',
  amber: '#C88A1A',
  amberBg: '#FFF8E1',
  red: '#EF4444',
  redBg: '#FEE2E2',
}

const fmtBRL = (v: number | null | undefined) =>
  v == null ? '—' : 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function NFeCard({ companyId, pedidoId, forcarHomologacao = false }: Props) {
  const [dados, setDados] = useState<NFeDados | null>(null)
  const [ultima, setUltima] = useState<NFeUltima | null>(null)
  const [emitindo, setEmitindo] = useState(false)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setCarregando(true)
    setErro(null)
    const [dadosRes, ultRes] = await Promise.all([
      supabase.rpc('fn_pedido_nfe_dados', { p_pedido_id: pedidoId }),
      supabase
        .from('erp_nfe_emitidas')
        .select('id,numero,status,danfe_url,motivo_rejeicao,provider_reference')
        .eq('pedido_id', pedidoId)
        .order('criado_em', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])
    setDados(dadosRes.data as NFeDados | null)
    setUltima(ultRes.data as NFeUltima | null)
    setCarregando(false)
  }, [pedidoId])

  useEffect(() => { void carregar() }, [carregar])

  async function emitir() {
    // FEAT-NFE-PRODUTO-3-PRODUCAO-v1
    // Trava de confirmacao (Pilar 1) quando NAO e homologacao · evita
    // emissao acidental com valor fiscal real
    if (!forcarHomologacao) {
      const ok = window.confirm(
        'Esta NF-e tem VALOR FISCAL REAL e será enviada à SEFAZ em nome da empresa.\n\n' +
        'Confirmar emissão?'
      )
      if (!ok) return
    }
    setEmitindo(true)
    setErro(null)
    try {
      // body so envia ambiente quando forcarHomologacao=true · NF-3 default:
      // sem campo ambiente → motor usa config (producao em KGF)
      const payload: { companyId: string; pedidoId: string; ambiente?: 'homologacao' } = {
        companyId, pedidoId,
      }
      if (forcarHomologacao) payload.ambiente = 'homologacao'
      const res = await authFetch('/api/fiscal/nfe/emitir', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok || json?.ok === false) {
        const msg = json?.mensagem ?? json?.message ?? json?.error ?? `HTTP ${res.status}`
        setErro(msg)
        setEmitindo(false)
        return
      }
      if (json?.providerReference) {
        await supabase.rpc('fn_pedido_nfe_marcar_emitida', {
          p_pedido_id: pedidoId,
          p_provider_reference: json.providerReference,
        })
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha na emissao')
      setEmitindo(false)
      return
    }
    setEmitindo(false)
    await carregar()
  }

  if (!dados || !dados.tem_produto) return null

  const status = ultima?.status
  const eAutorizada = status === 'autorizada'
  const eProcessando = status === 'processando'
  const eRejeitada = status === 'rejeitada' || status === 'erro' || status === 'cancelada' || status === 'denegada'
  const semNota = !ultima
  const eTeste = forcarHomologacao

  const btnAtualizar = (
    <button
      type="button"
      onClick={() => void carregar()}
      disabled={carregando}
      data-testid="nfe-pedido-atualizar"
      style={{
        fontSize: 11, padding: '4px 10px', borderRadius: 6,
        border: `1px solid ${C.border}`, background: 'transparent',
        color: C.espressoM, cursor: carregando ? 'not-allowed' : 'pointer',
        alignSelf: 'flex-start',
      }}
    >
      {carregando ? 'Atualizando…' : '↻ Atualizar status'}
    </button>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {eTeste ? (
        <div style={{
          padding: '8px 10px', borderRadius: 6, background: C.amberBg,
          color: C.amber, fontSize: 11, fontWeight: 600, display: 'flex', gap: 6,
        }}>
          ⚠️ Ambiente de TESTE (homologação) — sem valor fiscal
        </div>
      ) : semNota && (
        <div style={{
          padding: '8px 10px', borderRadius: 6, background: C.goldBg,
          color: C.goldD, fontSize: 11, fontWeight: 600, display: 'flex', gap: 6,
        }}>
          🧾 NF-e com <strong>valor fiscal</strong> — será transmitida à SEFAZ.
        </div>
      )}

      {erro && (
        <div style={{
          padding: 10, borderRadius: 6, background: C.redBg, color: C.red,
          fontSize: 12, whiteSpace: 'pre-wrap',
        }}>
          ❌ {erro}
        </div>
      )}

      {eAutorizada && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p style={{ fontSize: 12, color: C.green, fontWeight: 600, margin: 0 }}>
            ✅ NF-e nº {ultima?.numero ?? '—'} autorizada
          </p>
          {ultima?.danfe_url && (
            <a
              href={ultima.danfe_url}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="nfe-pedido-ver-danfe"
              style={{
                alignSelf: 'flex-start',
                padding: '8px 14px', borderRadius: 8,
                border: `1px solid ${C.gold}`, background: C.goldBg, color: C.goldD,
                fontSize: 12, fontWeight: 600, textDecoration: 'none',
              }}
            >
              Ver DANFE
            </a>
          )}
          {btnAtualizar}
        </div>
      )}

      {eProcessando && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p style={{ fontSize: 12, color: C.amber, fontWeight: 600, margin: 0 }}>
            ⏳ NF-e processando na SEFAZ
          </p>
          <p style={{ fontSize: 11, color: C.espressoM, margin: 0 }}>
            O número/chave saem assim que a SEFAZ autorizar.
          </p>
          {btnAtualizar}
        </div>
      )}

      {eRejeitada && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <p style={{ fontSize: 12, color: C.red, fontWeight: 600, margin: 0 }}>
            ❌ NF-e rejeitada
          </p>
          {ultima?.motivo_rejeicao && (
            <p style={{ fontSize: 11, color: C.espressoM, margin: 0, padding: 8, background: C.redBg, borderRadius: 6 }}>
              {ultima.motivo_rejeicao}
            </p>
          )}
          <button
            type="button"
            onClick={emitir}
            disabled={emitindo}
            data-testid="nfe-pedido-reemitir"
            style={{
              minHeight: 44, padding: '10px 16px', borderRadius: 8,
              border: 'none', background: C.gold, color: '#fff',
              fontSize: 13, fontWeight: 700, cursor: 'pointer', alignSelf: 'flex-start',
            }}
          >
            {emitindo ? 'Emitindo…' : '📄 Reemitir NF-e'}
          </button>
          {btnAtualizar}
        </div>
      )}

      {semNota && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <p style={{ fontSize: 12, color: C.espressoM, margin: 0 }}>
            Valor: <strong style={{ color: C.gold }}>{fmtBRL(dados.valor_produtos)}</strong>
          </p>
          <button
            type="button"
            onClick={emitir}
            disabled={emitindo}
            data-testid="nfe-pedido-emitir"
            style={{
              minHeight: 44, padding: '10px 16px', borderRadius: 8,
              border: 'none', background: C.gold, color: '#fff',
              fontSize: 13, fontWeight: 700, cursor: 'pointer', alignSelf: 'flex-start',
            }}
          >
            {emitindo ? 'Emitindo…' : '📄 Emitir NF-e'}
          </button>
        </div>
      )}
    </div>
  )
}
