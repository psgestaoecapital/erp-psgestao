'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import ContasBancariasForm, { type Conta } from './ContasBancariasForm'

const TIPOS_LABELS: Record<string, { label: string; icone: string }> = {
  corrente: { label: 'Conta Corrente', icone: '🏦' },
  poupanca: { label: 'Poupança', icone: '🐷' },
  caixinha: { label: 'Caixinha / Cofre', icone: '💰' },
  permuta: { label: 'Permuta', icone: '🔄' },
  cartao: { label: 'Cartão de Crédito', icone: '💳' },
  investimento: { label: 'Investimento', icone: '📈' },
}

function fmt(n: number | null | undefined): string {
  return Number(n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function ContasBancariasList({ companyId }: { companyId: string }) {
  const router = useRouter()
  const [contas, setContas] = useState<Conta[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Conta | null>(null)

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('erp_banco_contas')
      .select('id, nome, banco, agencia, conta, tipo_conta, saldo_inicial, data_saldo_inicial, soma_no_saldo, incluir_no_resumo, incluir_no_fluxo, incluir_no_orcamento, cor, ativo')
      .eq('company_id', companyId)
      .eq('ativo', true)
      .order('nome')
    if (data) setContas(data as Conta[])
    setLoading(false)
  }

  useEffect(() => {
    if (companyId) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId])

  async function handleInativar(id: string) {
    if (!confirm('Inativar essa conta? Você pode reativá-la depois nas configurações.')) return
    await supabase.from('erp_banco_contas').update({ ativo: false }).eq('id', id)
    load()
  }

  const saldoTotal = contas
    .filter((c) => c.soma_no_saldo)
    .reduce((s, c) => s + Number(c.saldo_inicial ?? 0), 0)

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'rgba(61,35,20,0.5)' }}>Carregando contas…</div>
  }

  return (
    <div style={{ background: '#FAF7F2', minHeight: '100vh', padding: '32px 28px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
            Cadastros · Gestão Empresarial
          </div>
          <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 26, color: '#3D2314', margin: 0, fontWeight: 400 }}>
            Contas Bancárias
          </h1>
          <div style={{ fontSize: 13, color: 'rgba(61,35,20,0.65)', marginTop: 4, maxWidth: 560 }}>
            Cadastre seus bancos, caixinhas e cartões de crédito. O saldo total alimenta o dashboard.
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            setEditing(null)
            setShowForm(true)
          }}
          style={{ background: '#C8941A', color: '#3D2314', border: 'none', padding: '10px 20px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
        >
          + Nova conta
        </button>
      </div>

      {contas.length > 0 && (
        <div style={{ background: '#3D2314', color: '#FAF7F2', borderRadius: 12, padding: '20px 24px', marginBottom: 20 }}>
          <div style={{ fontSize: 11, opacity: 0.7, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 }}>
            Saldo consolidado (contas com "Soma no saldo")
          </div>
          <div style={{ fontSize: 28, fontWeight: 600, color: '#C8941A', fontVariantNumeric: 'tabular-nums' }}>
            R$ {fmt(saldoTotal)}
          </div>
          <div style={{ fontSize: 11, opacity: 0.7, marginTop: 4 }}>
            {contas.filter((c) => c.soma_no_saldo).length} de {contas.length} conta(s)
          </div>
        </div>
      )}

      {contas.length === 0 ? (
        <div style={{ background: '#FFFFFF', border: '0.5px solid rgba(61,35,20,0.12)', borderRadius: 12, padding: 60, textAlign: 'center' }}>
          <div style={{ fontSize: 36, marginBottom: 12 }} aria-hidden>🏦</div>
          <div style={{ fontSize: 14, color: 'rgba(61,35,20,0.65)', marginBottom: 16 }}>
            Você ainda não tem nenhuma conta cadastrada.
            <br />
            Cadastre o primeiro banco para começar a usar o dashboard.
          </div>
          <button
            type="button"
            onClick={() => {
              setEditing(null)
              setShowForm(true)
            }}
            style={{ background: '#C8941A', color: '#3D2314', border: 'none', padding: '10px 24px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >
            + Cadastrar primeira conta
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {contas.map((c) => (
            <CardConta
              key={c.id}
              conta={c}
              onEditar={() => {
                setEditing(c)
                setShowForm(true)
              }}
              onInativar={() => handleInativar(c.id)}
            />
          ))}
        </div>
      )}

      <div style={{ marginTop: 32, textAlign: 'center' }}>
        <button
          type="button"
          onClick={() => router.push('/dashboard/gestao-empresarial')}
          style={{ background: 'transparent', color: '#C8941A', border: '0.5px solid #C8941A', padding: '10px 24px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
        >
          ← Voltar ao Dashboard
        </button>
      </div>

      {showForm && (
        <ContasBancariasForm
          companyId={companyId}
          conta={editing}
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

function CardConta({ conta, onEditar, onInativar }: { conta: Conta; onEditar: () => void; onInativar: () => void }) {
  const tipoInfo = TIPOS_LABELS[conta.tipo_conta ?? 'corrente'] ?? TIPOS_LABELS.corrente
  const corBarra = conta.cor || '#3D2314'

  return (
    <div
      style={{
        background: '#FFFFFF',
        border: '0.5px solid rgba(61,35,20,0.12)',
        borderLeft: `4px solid ${corBarra}`,
        borderRadius: 8,
        padding: '14px 18px',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        flexWrap: 'wrap',
      }}
    >
      <div style={{ fontSize: 22 }} aria-hidden>{tipoInfo.icone}</div>
      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#3D2314', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
          {conta.nome}
          {!conta.soma_no_saldo && (
            <span style={{ fontSize: 10, background: 'rgba(186,117,23,0.15)', color: '#854F0B', padding: '2px 6px', borderRadius: 3, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>
              Não soma
            </span>
          )}
          {conta.incluir_no_resumo === false && (
            <span title="Não incluída no Resumo" style={{ fontSize: 10, background: 'rgba(163,45,45,0.12)', color: '#A32D2D', padding: '2px 6px', borderRadius: 3, fontWeight: 600 }}>
              ⚠ Resumo
            </span>
          )}
          {conta.incluir_no_fluxo === false && (
            <span title="Não incluída no Fluxo de Caixa" style={{ fontSize: 10, background: 'rgba(163,45,45,0.12)', color: '#A32D2D', padding: '2px 6px', borderRadius: 3, fontWeight: 600 }}>
              ⚠ Fluxo
            </span>
          )}
          {conta.incluir_no_orcamento === false && (
            <span title="Não incluída no Orçamento" style={{ fontSize: 10, background: 'rgba(163,45,45,0.12)', color: '#A32D2D', padding: '2px 6px', borderRadius: 3, fontWeight: 600 }}>
              ⚠ Orçamento
            </span>
          )}
        </div>
        <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', marginTop: 2 }}>
          {tipoInfo.label}
          {conta.banco ? ` · ${conta.banco}` : ''}
          {conta.agencia ? ` · Ag. ${conta.agencia}` : ''}
          {conta.conta ? ` · CC ${conta.conta}` : ''}
        </div>
      </div>
      <div style={{ textAlign: 'right', minWidth: 140 }}>
        <div style={{ fontSize: 10, color: 'rgba(61,35,20,0.5)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Saldo inicial</div>
        <div style={{ fontSize: 15, fontWeight: 600, color: '#3D2314', fontVariantNumeric: 'tabular-nums' }}>
          R$ {fmt(conta.saldo_inicial)}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button type="button" onClick={onEditar} style={{ background: 'transparent', color: '#3D2314', border: '0.5px solid rgba(61,35,20,0.25)', padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
          Editar
        </button>
        <button type="button" onClick={onInativar} style={{ background: 'transparent', color: '#A32D2D', border: '0.5px solid rgba(163,45,45,0.3)', padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
          Inativar
        </button>
      </div>
    </div>
  )
}
