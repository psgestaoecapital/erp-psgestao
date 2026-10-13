'use client'

// #35 (FC Pisos · Jordana) · FATURAR POR MEDIÇÃO — escolher parcelas do pedido e emitir UMA NFS-e pela soma.
// Cada parcela mostra onde está: prevista (livre para faturar), em nota (processando/autorizada) ou faturada.
// A emissão em si é o NFSeEmitirGovModal (mesma porta fiscal), recebendo as parcelas marcadas; o banco valida
// de novo antes de falar com a prefeitura (fn_nfse_medicao_validar) e liga a nota às parcelas depois.

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'

type ParcelaRow = { id: string; numero: number; valor: number; vencimento: string }
type ReceberRow = { pedido_parcela_id: string | null; status: string }
type NotaRow = { id: string; numero: string | null; status: string; parcela_ids: string[] | null; efetivacao_status: string | null }

export type MedicaoEscolhida = { parcelaIds: string[]; valor: number; rotulo: string }

const C = {
  espresso: '#3D2314', espressoM: '#6B5D4F', espressoL: '#9C8E80', gold: '#C8941A', goldD: '#8A6410',
  goldBg: '#FBF3E0', green: '#2E7D32', amber: '#B26A00', border: '#E5DDD0',
}
const fmtBRL = (n: number) => (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const fmtData = (d: string) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—')

export default function MedicoesNFSeCard({ pedidoId, versao = 0, onEmitir }: {
  pedidoId: string
  versao?: number
  onEmitir: (m: MedicaoEscolhida) => void
}) {
  const [parcelas, setParcelas] = useState<ParcelaRow[]>([])
  const [receber, setReceber] = useState<ReceberRow[]>([])
  const [notas, setNotas] = useState<NotaRow[]>([])
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set())
  const [carregado, setCarregado] = useState(false)

  useEffect(() => {
    let vivo = true
    void (async () => {
      const [p, r, n] = await Promise.all([
        supabase.from('erp_pedidos_parcelas').select('id,numero,valor,vencimento').eq('pedido_id', pedidoId).order('numero'),
        supabase.from('erp_receber').select('pedido_parcela_id,status').eq('pedido_id', pedidoId).is('deleted_at', null),
        supabase.from('erp_nfse_emitidas').select('id,numero,status,parcela_ids,efetivacao_status')
          .eq('pedido_id', pedidoId).not('parcela_ids', 'is', null),
      ])
      if (!vivo) return
      setParcelas((p.data ?? []) as ParcelaRow[])
      setReceber((r.data ?? []) as ReceberRow[])
      setNotas((n.data ?? []) as NotaRow[])
      setMarcadas(new Set())
      setCarregado(true)
    })()
    return () => { vivo = false }
  }, [pedidoId, versao])

  // estado de cada parcela: nota ativa que a cobre > título efetivado > prevista (livre)
  const linhas = useMemo(() => parcelas.map((p) => {
    const nota = notas.find((n) => (n.status === 'autorizada' || n.status === 'processando') && (n.parcela_ids ?? []).includes(p.id))
    const tit = receber.find((r) => r.pedido_parcela_id === p.id)
    const faturada = !!tit && tit.status !== 'previsto'
    const livre = !nota && !faturada
    const situacao = nota
      ? (nota.status === 'autorizada' ? `NFS-e nº ${nota.numero ?? '—'}${nota.efetivacao_status === 'nao_gerar' ? ' · financeiro não gerado' : ''}` : 'NFS-e em processamento')
      : faturada ? 'faturada' : 'prevista'
    return { ...p, livre, situacao }
  }), [parcelas, notas, receber])

  const soma = useMemo(() => linhas.filter((l) => marcadas.has(l.id)).reduce((s, l) => s + Number(l.valor || 0), 0), [linhas, marcadas])

  // medição só faz sentido com o pedido dividido em 2+ parcelas
  if (!carregado || parcelas.length < 2) return null

  const alternar = (id: string) => setMarcadas((prev) => {
    const nx = new Set(prev)
    if (nx.has(id)) nx.delete(id); else nx.add(id)
    return nx
  })
  const escolhidas = linhas.filter((l) => marcadas.has(l.id))

  return (
    <div data-testid="medicoes-card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <p style={{ fontSize: 12, color: C.espressoM, margin: 0 }}>
        Marque as parcelas desta medição — sai <b>uma</b> NFS-e pela soma. As outras ficam para as próximas notas.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {linhas.map((l) => (
          <label key={l.id} data-testid="medicao-parcela" style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 6,
            border: `1px solid ${C.border}`, background: marcadas.has(l.id) ? C.goldBg : '#fff',
            opacity: l.livre ? 1 : 0.65, cursor: l.livre ? 'pointer' : 'default', fontSize: 12, color: C.espresso,
          }}>
            <input type="checkbox" disabled={!l.livre} checked={marcadas.has(l.id)} onChange={() => alternar(l.id)} />
            <span style={{ fontWeight: 600, minWidth: 64 }}>Parcela {l.numero}</span>
            <span style={{ color: C.espressoM }}>{fmtData(l.vencimento)}</span>
            <span style={{ marginLeft: 'auto', fontWeight: 600 }}>{fmtBRL(l.valor)}</span>
            <span style={{ minWidth: 120, textAlign: 'right', fontSize: 11, color: l.livre ? C.espressoL : l.situacao.startsWith('NFS-e nº') || l.situacao === 'faturada' ? C.green : C.amber }}>
              {l.situacao}
            </span>
          </label>
        ))}
      </div>
      <button
        type="button"
        data-testid="medicao-emitir"
        disabled={escolhidas.length === 0}
        onClick={() => onEmitir({
          parcelaIds: escolhidas.map((l) => l.id),
          valor: Math.round(soma * 100) / 100,
          rotulo: `parcela${escolhidas.length > 1 ? 's' : ''} ${escolhidas.map((l) => l.numero).join(', ')}`,
        })}
        style={{
          minHeight: 44, padding: '10px 16px', borderRadius: 8, border: 'none', alignSelf: 'flex-start',
          background: escolhidas.length ? C.gold : C.border, color: '#fff', fontSize: 13, fontWeight: 700,
          cursor: escolhidas.length ? 'pointer' : 'not-allowed',
        }}
      >
        📄 Emitir NFS-e da medição{escolhidas.length ? ` · ${fmtBRL(soma)}` : ''}
      </button>
    </div>
  )
}
