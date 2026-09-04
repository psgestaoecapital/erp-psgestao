'use client'

// Chamado #20 · Fase 2 · Emitir NFS-e (serviços) a partir da OS.
//
// Fluxo:
//   1) fn_os_nfse_preparar(os) resolve, no banco (RD-38): valor de SERVIÇOS (só mão de obra/serviços
//      aprovados), valor de PEÇAS (só pra mostrar o que NÃO entra), o SERVIÇO FISCAL da empresa
//      (erp_servicos com LC116 — nunca o serviço de oficina/tempário) e o tomador (cliente da OS).
//   2) Um painel de conferência mostra os dois números (lock #1: a tela diz que peça fica de fora)
//      e deixa escolher o serviço fiscal quando há mais de um.
//   3) "Continuar" abre o NFSeEmitirGovModal — o MESMO modal que já emitiu as notas via gov-nfse-emitir
//      (RD-26: reusa o caminho provado, sem tocá-lo), pré-preenchido com o valor de serviços.
//
// Se a OS não tem serviço aprovado (ou sem preço, ou a empresa não tem serviço fiscal), a preparação
// devolve ok:false com o motivo — e a tela explica por quê a nota não sai (lock #2).

import { useState, type CSSProperties } from 'react'
import { supabase } from '@/lib/supabase'
import { carregarProducaoDisponivel } from '@/lib/fiscal/producaoDisponivel'
import NFSeEmitirGovModal from '@/components/fiscal/NFSeEmitirGovModal'

type ServicoFiscal = {
  id: string
  descricao: string | null
  codigo_servico_municipio: string | null
  codigo_lc116: string | null
  aliquota_iss: number | null
}
type Prep = {
  ok: boolean
  motivo?: string
  erro?: string
  os_numero?: string | null
  valor_servicos?: number
  valor_pecas?: number
  qtd_servicos?: number
  descricao_sugerida?: string
  tomador?: { documento: string; tipo: 'cpf' | 'cnpj' | 'indefinido'; nome: string | null; email: string | null }
  servico_fiscal_id_default?: string | null
  servicos_fiscais?: ServicoFiscal[]
}

const C = { espresso: '#3D2314', espressoM: '#6B5D4F', gold: '#C8941A', line: '#E7DECF',
  green: '#166534', greenBg: '#EAF3DE', amber: '#B45309', amberBg: '#FAEEDA', red: '#A32D2D' }

const brl = (v: number | null | undefined) =>
  v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export default function EmitirNFSeOSButton({
  osId,
  companyId,
  buttonStyle,
  onEmitida,
}: {
  osId: string
  companyId: string
  buttonStyle?: CSSProperties
  onEmitida?: () => void
}) {
  const [prep, setPrep] = useState<Prep | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [confirmAberto, setConfirmAberto] = useState(false)
  const [modalAberto, setModalAberto] = useState(false)
  const [producao, setProducao] = useState(false)
  const [servSel, setServSel] = useState('')

  async function preparar() {
    setErro(null)
    setCarregando(true)
    try {
      const [rpc, prod] = await Promise.all([
        supabase.rpc('fn_os_nfse_preparar', { p_os_id: osId }),
        carregarProducaoDisponivel(companyId),
      ])
      if (rpc.error) { setErro(rpc.error.message); return }
      const p = rpc.data as Prep | null
      if (!p?.ok) { setErro(p?.erro ?? 'Não foi possível preparar a NFS-e.'); return }
      setPrep(p)
      setProducao(prod)
      setServSel(p.servico_fiscal_id_default ?? p.servicos_fiscais?.[0]?.id ?? '')
      setConfirmAberto(true)
    } finally {
      setCarregando(false)
    }
  }

  const servico = prep?.servicos_fiscais?.find((s) => s.id === servSel) ?? prep?.servicos_fiscais?.[0]
  const varios = (prep?.servicos_fiscais?.length ?? 0) > 1

  const defBtn: CSSProperties = {
    fontSize: 12, fontWeight: 600, color: C.espresso, background: '#FFFFFF',
    border: `1px solid ${C.line}`, borderRadius: 8, padding: '10px 14px', minHeight: 44, cursor: 'pointer',
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void preparar()}
        disabled={carregando}
        data-testid="os-nfse-emitir"
        title="Emite a NFS-e (nota de SERVIÇO) da OS. Só o valor de serviços entra — peças saem na NF-e de produto."
        style={{ ...defBtn, ...buttonStyle, opacity: carregando ? 0.6 : 1 }}
      >
        {carregando ? 'Preparando…' : '🧾 Emitir NFS-e'}
      </button>

      {/* motivo pra nota NÃO sair (sem serviço / sem preço / sem serviço fiscal) — lock #2 */}
      {erro && !confirmAberto && (
        <div
          role="alert"
          style={{ flexBasis: '100%', marginTop: 8, fontSize: 12, color: '#791F1F',
            background: '#FCEBEB', borderLeft: `4px solid ${C.red}`, borderRadius: 6, padding: '8px 12px' }}
        >
          {erro}
          <button type="button" onClick={() => setErro(null)}
            style={{ marginLeft: 8, textDecoration: 'underline', background: 'none', border: 'none', color: '#791F1F', cursor: 'pointer' }}>
            ok
          </button>
        </div>
      )}

      {/* painel de conferência: serviços × peças + serviço fiscal + tomador (lock #1) */}
      {confirmAberto && prep && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={(e) => { if (e.target === e.currentTarget) setConfirmAberto(false) }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.5)', zIndex: 1000,
            display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '32px 16px', overflowY: 'auto' }}
        >
          <div onClick={(e) => e.stopPropagation()}
            style={{ background: '#FFFFFF', borderRadius: 12, maxWidth: 460, width: '100%', padding: 20 }}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: C.espresso }}>
              Emitir NFS-e · OS {prep.os_numero}
            </h3>
            <p style={{ margin: '4px 0 14px', fontSize: 12, color: C.espressoM }}>
              Nota de <b>serviço</b>. Confira antes de emitir.
            </p>

            <div style={{ background: C.greenBg, borderRadius: 8, padding: '10px 12px', marginBottom: 8 }}>
              <div style={{ fontSize: 11, color: C.green, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3 }}>
                Vai na nota (serviços · {prep.qtd_servicos})
              </div>
              <div style={{ fontSize: 20, fontWeight: 700, color: C.green }}>{brl(prep.valor_servicos)}</div>
            </div>

            <div style={{ background: C.amberBg, borderRadius: 8, padding: '10px 12px', marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: C.amber, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3 }}>
                Fica de fora (peças)
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.amber }}>{brl(prep.valor_pecas)}</div>
              <div style={{ fontSize: 11, color: C.amber, marginTop: 2 }}>
                Peça não entra em nota de serviço — sai na NF-e de produto.
              </div>
            </div>

            <label style={{ display: 'block', marginBottom: 14 }}>
              <span style={{ display: 'block', fontSize: 11, color: C.espressoM, marginBottom: 4 }}>Serviço fiscal (LC116)</span>
              {varios ? (
                <select value={servSel} onChange={(e) => setServSel(e.target.value)}
                  style={{ width: '100%', border: `1px solid ${C.line}`, borderRadius: 6, padding: '8px 10px', fontSize: 13, color: C.espresso, background: '#FFFFFF' }}>
                  {prep.servicos_fiscais?.map((s) => (
                    <option key={s.id} value={s.id}>{s.descricao} · LC {s.codigo_lc116}</option>
                  ))}
                </select>
              ) : (
                <div style={{ fontSize: 13, color: C.espresso }}>
                  {servico?.descricao} · <span style={{ color: C.espressoM }}>LC {servico?.codigo_lc116} · mun. {servico?.codigo_servico_municipio}</span>
                </div>
              )}
            </label>

            <div style={{ fontSize: 12, color: C.espressoM, marginBottom: 16 }}>
              Tomador: <b style={{ color: C.espresso }}>{prep.tomador?.nome ?? '—'}</b>
              {prep.tomador?.documento ? ` · ${prep.tomador.tipo.toUpperCase()} ${prep.tomador.documento}` : ' · sem documento (informe no cadastro do cliente)'}
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" onClick={() => setConfirmAberto(false)}
                style={{ flex: 1, padding: '10px 14px', borderRadius: 8, border: `1px solid ${C.line}`, background: '#FFFFFF', color: C.espresso, fontSize: 13, cursor: 'pointer' }}>
                Cancelar
              </button>
              <button type="button" onClick={() => { setConfirmAberto(false); setModalAberto(true) }}
                data-testid="os-nfse-continuar"
                style={{ flex: 1, padding: '10px 14px', borderRadius: 8, border: 'none', background: C.gold, color: C.espresso, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
                Continuar →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* reusa o modal que já emite via gov-nfse-emitir, pré-preenchido com o valor de SERVIÇOS */}
      <NFSeEmitirGovModal
        companyId={companyId}
        aberto={modalAberto}
        onFechar={() => setModalAberto(false)}
        onEmitida={() => { setModalAberto(false); setPrep(null); onEmitida?.() }}
        producaoDisponivel={producao}
        tomadorDocumento={prep?.tomador?.documento}
        tomadorTipo={prep?.tomador?.tipo}
        tomadorNome={prep?.tomador?.nome ?? undefined}
        tomadorEmail={prep?.tomador?.email ?? undefined}
        descricaoServico={prep?.descricao_sugerida}
        codigoServicoMunicipio={servico?.codigo_servico_municipio ?? undefined}
        codigoLC116={servico?.codigo_lc116 ?? undefined}
        aliquotaIss={servico?.aliquota_iss ?? undefined}
        valorServicos={prep?.valor_servicos}
      />
    </>
  )
}
