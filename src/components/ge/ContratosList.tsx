'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import ContratoForm, { type Contrato as ContratoFull } from './ContratoForm'

interface Contrato {
  id: string
  nome: string
  numero: string
  tipo: string
  cliente_id: string | null
  cliente_nome: string | null
  valor_mensal: number
  valor_atual: number | null
  dia_vencimento: number
  periodicidade: string
  data_inicio: string
  data_fim: string | null
  status: string
}

function fmt(n: number): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const STATUS_OPCOES: Array<'ativo' | 'suspenso' | 'encerrado' | 'todos'> = ['ativo', 'suspenso', 'encerrado', 'todos']

function labelStatus(s: string): string {
  switch (s) {
    case 'ativo': return 'Ativas'
    case 'suspenso': return 'Pausadas'
    case 'encerrado': return 'Encerradas'
    default: return 'Todas'
  }
}

export default function ContratosList({ companyId }: { companyId: string }) {
  const router = useRouter()
  const [contratos, setContratos] = useState<Contrato[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Contrato | null>(null)
  const [filtroStatus, setFiltroStatus] = useState<'ativo' | 'suspenso' | 'encerrado' | 'todos'>('ativo')

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('erp_contratos')
      .select('id, nome, numero, tipo, cliente_id, cliente_nome, valor_mensal, valor_atual, dia_vencimento, periodicidade, data_inicio, data_fim, status')
      .eq('company_id', companyId)
      .order('data_inicio', { ascending: false })
    if (data) setContratos(data as Contrato[])
    setLoading(false)
  }

  useEffect(() => {
    if (companyId) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId])

  const filtrados = useMemo(
    () => contratos.filter((c) => filtroStatus === 'todos' || c.status === filtroStatus),
    [contratos, filtroStatus],
  )

  // Receita prevista por mês — exclui aluguel (geralmente é despesa do locatário).
  const receitaMensal = useMemo(
    () => contratos
      .filter((c) => c.status === 'ativo' && c.tipo !== 'aluguel')
      .reduce((s, c) => s + Number(c.valor_atual ?? c.valor_mensal ?? 0), 0),
    [contratos],
  )

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'rgba(61,35,20,0.65)' }}>Carregando cobranças…</div>
  }

  return (
    <div style={{ background: '#FAF7F2', minHeight: '100vh', padding: '24px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
            Cadastros · Gestão Empresarial
          </div>
          <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 26, color: '#3D2314', margin: 0, fontWeight: 400 }}>
            Cobranças recorrentes
          </h1>
          <div style={{ fontSize: 13, color: 'rgba(61,35,20,0.65)', marginTop: 4, maxWidth: 520 }}>
            Aluguéis · mensalidades · assinaturas · contratos. Tudo que se repete todo mês.
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            setEditing(null)
            setShowForm(true)
          }}
          style={{ background: '#C8941A', color: '#3D2314', border: 'none', padding: '12px 22px', borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
        >
          + Nova cobrança
        </button>
      </div>

      <div style={{ background: '#FFFFFF', border: '0.5px solid rgba(61,35,20,0.12)', borderRadius: 12, padding: '18px 22px', marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 1 }}>
            Receita prevista por mês
          </div>
          <div style={{ fontSize: 26, fontWeight: 600, color: '#3B6D11', fontVariantNumeric: 'tabular-nums', marginTop: 4 }}>
            R$ {fmt(receitaMensal)}
          </div>
          {receitaMensal > 0 && (
            <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', marginTop: 2 }}>
              soma das cobranças ativas (exceto aluguéis)
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {STATUS_OPCOES.map((s) => {
            const ativo = filtroStatus === s
            const qtd = contratos.filter((c) => s === 'todos' || c.status === s).length
            return (
              <button
                key={s}
                type="button"
                onClick={() => setFiltroStatus(s)}
                style={{ background: ativo ? '#3D2314' : 'transparent', color: ativo ? '#FAF7F2' : '#3D2314', border: '0.5px solid rgba(61,35,20,0.25)', padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
              >
                {labelStatus(s)} ({qtd})
              </button>
            )
          })}
        </div>
      </div>

      {filtrados.length === 0 ? (
        <div style={{ background: '#FFFFFF', borderRadius: 12, padding: 50, textAlign: 'center', color: 'rgba(61,35,20,0.6)', fontSize: 14 }}>
          {contratos.length === 0
            ? 'Você ainda não tem cobranças cadastradas. Clique em “+ Nova cobrança” para começar.'
            : 'Nenhuma cobrança nesse filtro.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtrados.map((c) => (
            <CardContrato
              key={c.id}
              contrato={c}
              onEditar={() => {
                setEditing(c)
                setShowForm(true)
              }}
            />
          ))}
        </div>
      )}

      <div style={{ marginTop: 28, textAlign: 'center' }}>
        <button
          type="button"
          onClick={() => router.push('/dashboard/gestao-empresarial')}
          style={{ background: 'transparent', color: '#C8941A', border: '0.5px solid #C8941A', padding: '10px 22px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
        >
          ← Voltar ao painel
        </button>
      </div>

      {showForm && (
        <ContratoForm
          companyId={companyId}
          contrato={editing as ContratoFull | null}
          onClose={() => {
            setShowForm(false)
            setEditing(null)
          }}
          onSaved={() => {
            setShowForm(false)
            setEditing(null)
            load()
          }}
        />
      )}
    </div>
  )
}

function CardContrato({ contrato, onEditar }: { contrato: Contrato; onEditar: () => void }) {
  const corStatus =
    contrato.status === 'ativo' ? '#3B6D11'
    : contrato.status === 'suspenso' ? '#BA7517'
    : '#A32D2D'

  // Diferencial PS — alerta pró-ativo
  const hoje = new Date()
  const diaHoje = hoje.getDate()
  const diasAteVencer = contrato.dia_vencimento - diaHoje
  const alertaProximo = contrato.status === 'ativo' && diasAteVencer > 0 && diasAteVencer <= 5

  return (
    <div
      style={{
        background: '#FFFFFF',
        border: '0.5px solid rgba(61,35,20,0.12)',
        borderRadius: 12,
        padding: '16px 20px',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        opacity: contrato.status === 'encerrado' ? 0.5 : 1,
        flexWrap: 'wrap',
      }}
    >
      <div style={{ width: 4, height: 48, borderRadius: 4, background: corStatus, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#3D2314' }}>{contrato.nome}</span>
          <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 3, background: 'rgba(200,148,26,0.15)', color: '#854F0B', textTransform: 'uppercase', fontWeight: 700, letterSpacing: 0.3 }}>
            {contrato.tipo}
          </span>
          {alertaProximo && (
            <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 3, background: 'rgba(186,117,23,0.15)', color: '#BA7517', fontWeight: 700 }}>
              ⏰ Vence em {diasAteVencer} dia{diasAteVencer > 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div style={{ fontSize: 12, color: 'rgba(61,35,20,0.6)', marginTop: 2 }}>
          {contrato.cliente_nome || 'Sem cliente vinculado'} · vence dia {contrato.dia_vencimento} · {contrato.periodicidade}
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: 10, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 0.6 }}>
          {contrato.periodicidade}
        </div>
        <div style={{ fontSize: 16, fontWeight: 600, color: '#3D2314', fontVariantNumeric: 'tabular-nums' }}>
          R$ {fmt(Number(contrato.valor_atual ?? contrato.valor_mensal))}
        </div>
      </div>
      <button
        type="button"
        onClick={onEditar}
        style={{ background: 'transparent', color: '#3D2314', border: '0.5px solid rgba(61,35,20,0.25)', padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
      >
        Editar
      </button>
    </div>
  )
}
