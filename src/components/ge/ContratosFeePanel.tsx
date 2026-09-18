'use client'

// #59 PDOIS parte 2 · Painel de solicitações e elaboração de contratos de fee, dentro de
// /dashboard/contratos (aba própria — não é tela paralela). Filas por status:
//  - "Minhas solicitações" (comercial): solicitante = usuário logado;
//  - "Para elaborar" (financeiro): status do ciclo solicitado→aguardando_aprovacao;
//  - "Ativos": contratos de fee já ativados.
// Abre SolicitarContratoModal (nova solicitação) e ContratoFeeModal (elaborar). Aceita ?c=<id>
// para abrir direto um contrato (usado pelo atalho de /dashboard/pm/contratos).

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import SolicitarContratoModal from './SolicitarContratoModal'
import ContratoFeeModal from './ContratoFeeModal'

const C = { espresso: '#3D2314', espressoM: '#6B5D4F', cream: '#FAF7F2', border: '#E0D8CC', gold: '#C8941A', white: '#FFFFFF' }
const CICLO = ['solicitado', 'em_elaboracao', 'aguardando_info', 'em_revisao', 'aguardando_aprovacao']
const STATUS_LABEL: Record<string, string> = {
  solicitado: 'Solicitado', em_elaboracao: 'Em elaboração', aguardando_info: 'Aguardando info',
  em_revisao: 'Em revisão', aguardando_aprovacao: 'Aguardando aprovação', ativo: 'Ativo',
  cancelado: 'Cancelado', suspenso: 'Suspenso', encerrado: 'Encerrado',
}
const STATUS_COR: Record<string, string> = {
  solicitado: '#C8941A', em_elaboracao: '#3B82F6', aguardando_info: '#C88A1A',
  em_revisao: '#8B5CF6', aguardando_aprovacao: '#0EA5E9', ativo: '#10B981',
  cancelado: '#EF4444', suspenso: '#9C8E80', encerrado: '#6B5D4F',
}
const fmtBRL = (v: number | null) => 'R$ ' + (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

interface Row {
  id: string; numero: string | null; nome: string | null; cliente_nome: string | null
  status: string | null; valor_mensal: number | null; solicitante_id: string | null
  responsavel_id: string | null; created_at: string | null; prazo_desejado: string | null
}
type Aba = 'minhas' | 'elaborar' | 'ativos'

export default function ContratosFeePanel({ companyId }: { companyId: string | null }) {
  const [rows, setRows] = useState<Row[]>([])
  const [uid, setUid] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [aba, setAba] = useState<Aba>('elaborar')
  const [solicitarAberto, setSolicitarAberto] = useState(false)
  const [feeId, setFeeId] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    if (!companyId) { setRows([]); setLoading(false); return }
    setLoading(true)
    const { data: u } = await supabase.auth.getUser()
    setUid(u.user?.id ?? null)
    const { data } = await supabase
      .from('erp_contratos')
      .select('id,numero,nome,cliente_nome,status,valor_mensal,solicitante_id,responsavel_id,created_at,prazo_desejado')
      .eq('company_id', companyId)
      .or('solicitante_id.not.is.null,status.in.(solicitado,em_elaboracao,aguardando_info,em_revisao,aguardando_aprovacao)')
      .order('created_at', { ascending: false })
      .limit(300)
    setRows((data ?? []) as Row[])
    setLoading(false)
  }, [companyId])

  useEffect(() => { void carregar() }, [carregar])

  // ?c=<id> abre o contrato direto (atalho do pm/contratos)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const c = new URLSearchParams(window.location.search).get('c')
    if (c) setFeeId(c)
  }, [])

  const minhas = rows.filter((r) => r.solicitante_id && r.solicitante_id === uid)
  const elaborar = rows.filter((r) => r.status && CICLO.includes(r.status))
  const ativos = rows.filter((r) => r.status === 'ativo' && r.solicitante_id)
  const lista = aba === 'minhas' ? minhas : aba === 'ativos' ? ativos : elaborar

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 6, background: '#F0ECE3', borderRadius: 8, padding: 4, flexWrap: 'wrap' }}>
          <TabBtn active={aba === 'elaborar'} onClick={() => setAba('elaborar')} label="Contratos para elaborar" count={elaborar.length} />
          <TabBtn active={aba === 'minhas'} onClick={() => setAba('minhas')} label="Minhas solicitações" count={minhas.length} />
          <TabBtn active={aba === 'ativos'} onClick={() => setAba('ativos')} label="Ativos" count={ativos.length} />
        </div>
        <button type="button" onClick={() => setSolicitarAberto(true)} disabled={!companyId} style={{ background: C.gold, color: C.white, border: 'none', padding: '10px 18px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: companyId ? 'pointer' : 'not-allowed', opacity: companyId ? 1 : 0.5 }}>
          + Solicitar elaboração
        </button>
      </div>

      {!companyId ? (
        <p style={{ fontSize: 13, color: C.espressoM }}>Selecione uma empresa específica para ver os contratos.</p>
      ) : loading ? (
        <p style={{ fontSize: 13, color: C.espressoM, fontStyle: 'italic' }}>Carregando…</p>
      ) : lista.length === 0 ? (
        <p style={{ fontSize: 13, color: C.espressoM, fontStyle: 'italic' }}>
          {aba === 'minhas' ? 'Você ainda não solicitou contratos.' : aba === 'ativos' ? 'Nenhum contrato de fee ativo ainda.' : 'Nenhum contrato aguardando elaboração.'}
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {lista.map((r) => (
            <button key={r.id} type="button" onClick={() => setFeeId(r.id)} style={{ textAlign: 'left', background: C.white, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: C.espresso }}>
                  {r.nome || 'Contrato sem título'}
                  {r.numero ? <span style={{ color: C.espressoM, fontWeight: 400, fontSize: 12, marginLeft: 8 }}>nº {r.numero}</span> : null}
                </div>
                <div style={{ fontSize: 12, color: C.espressoM, marginTop: 2 }}>
                  {r.cliente_nome || 'Sem cliente'} · {fmtBRL(r.valor_mensal)}/mês
                  {r.prazo_desejado ? ` · prazo ${r.prazo_desejado.split('-').reverse().join('/')}` : ''}
                </div>
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, color: C.white, background: STATUS_COR[r.status ?? ''] ?? C.espressoM, padding: '3px 10px', borderRadius: 12, whiteSpace: 'nowrap' }}>
                {STATUS_LABEL[r.status ?? ''] ?? r.status}
              </span>
            </button>
          ))}
        </div>
      )}

      {solicitarAberto && companyId && (
        <SolicitarContratoModal companyId={companyId} onClose={() => setSolicitarAberto(false)}
          onSolicitado={(res) => { setSolicitarAberto(false); void carregar(); setFeeId(res.contrato_id) }} />
      )}
      {feeId && companyId && (
        <ContratoFeeModal companyId={companyId} contratoId={feeId} onClose={() => setFeeId(null)} onSaved={() => void carregar()} />
      )}
    </div>
  )
}

function TabBtn({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button type="button" onClick={onClick} style={{ minHeight: 34, padding: '0 12px', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', background: active ? '#FFFFFF' : 'transparent', color: active ? '#3D2314' : '#6B5D4F', boxShadow: active ? '0 1px 3px rgba(0,0,0,.08)' : 'none' }}>
      {label} <span style={{ opacity: 0.7 }}>({count})</span>
    </button>
  )
}
