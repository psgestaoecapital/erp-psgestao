'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import ContratoForm, { type Contrato as ContratoFull } from './ContratoForm'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { erroAmigavel } from '@/lib/erroAmigavel'

// RD-95: chaves ge.contratos.* cadastradas na rota canônica da tela.
const ROTA_AJUDA = '/dashboard/cadastros/contratos-recorrentes'

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
  const [aviso, setAviso] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('erp_contratos')
      .select('id, nome, numero, tipo, cliente_id, cliente_nome, valor_mensal, valor_atual, dia_vencimento, periodicidade, data_inicio, data_fim, status')
      .eq('company_id', companyId)
      // RD-98 p4: cobrança excluída (soft-delete por fn_contrato_excluir) não volta para a lista.
      .is('excluido_em', null)
      .neq('status', 'excluido')
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
        <div style={{ display: 'flex', alignItems: 'center' }}>
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
          <AjudaCampo chave="ge.contratos.nova" rota={ROTA_AJUDA} />
        </div>
      </div>

      {aviso && (
        <div role="status" style={{ background: 'rgba(59,109,17,0.08)', border: '0.5px solid rgba(59,109,17,0.35)', color: '#3B6D11', padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontSize: 13, display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
          <span>{aviso}</span>
          <button type="button" onClick={() => setAviso(null)} aria-label="Fechar aviso" style={{ background: 'transparent', border: 'none', color: '#3B6D11', cursor: 'pointer', fontSize: 16 }}>×</button>
        </div>
      )}

      <div style={{ background: '#FFFFFF', border: '0.5px solid rgba(61,35,20,0.12)', borderRadius: 12, padding: '18px 22px', marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 1, display: 'flex', alignItems: 'center' }}>
            Receita prevista por mês
            <AjudaCampo chave="ge.contratos.receita_prevista" rota={ROTA_AJUDA} />
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
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
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
          <AjudaCampo chave="ge.contratos.filtro_status" rota={ROTA_AJUDA} />
        </div>
      </div>

      {filtrados.length === 0 ? (
        <div style={{ background: '#FFFFFF', borderRadius: 12, padding: 50, textAlign: 'center', color: 'rgba(61,35,20,0.6)', fontSize: 14 }}>
          {contratos.length === 0 ? (
            <>
              <div style={{ marginBottom: 16 }}>
                Você ainda não tem cobranças cadastradas. Cadastre aluguéis, mensalidades ou contratos que se repetem e o
                sistema gera as contas a receber de cada mês.
              </div>
              <button
                type="button"
                onClick={() => { setEditing(null); setShowForm(true) }}
                style={{ background: '#C8941A', color: '#3D2314', border: 'none', padding: '12px 22px', borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
              >
                + Cadastrar a primeira cobrança
              </button>
            </>
          ) : (
            <>
              <div style={{ marginBottom: 12 }}>Nenhuma cobrança nesse filtro.</div>
              <button
                type="button"
                onClick={() => setFiltroStatus('todos')}
                style={{ background: 'transparent', color: '#3D2314', border: '0.5px solid rgba(61,35,20,0.3)', padding: '8px 16px', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}
              >
                Ver todas
              </button>
            </>
          )}
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
              onAlterado={(texto) => { setAviso(texto); load() }}
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

type AcaoCard = 'encerrar' | 'excluir'

function CardContrato({ contrato, onEditar, onAlterado }: { contrato: Contrato; onEditar: () => void; onAlterado: (texto: string) => void }) {
  // RD-98 p2: encerrar e excluir visíveis na lista (antes só havia "Editar"). As duas RPCs já existiam e exigem motivo;
  // excluir é soft-delete rastreável (excluido_em/por + erp_contratos_eventos) e só passa se o contrato permitir.
  const [acao, setAcao] = useState<AcaoCard | null>(null)
  const [motivo, setMotivo] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  function abrir(a: AcaoCard) { setAcao(a); setMotivo(''); setErro(null) }

  async function confirmar() {
    if (!acao) return
    if (!motivo.trim()) { setErro(acao === 'excluir' ? 'Conte o motivo da exclusão.' : 'Conte o motivo do encerramento.'); return }
    setSalvando(true); setErro(null)
    const { data, error } = acao === 'excluir'
      ? await supabase.rpc('fn_contrato_excluir', { p_id: contrato.id, p_motivo: motivo.trim() })
      : await supabase.rpc('fn_contrato_encerrar', { p_id: contrato.id, p_motivo: motivo.trim() })
    setSalvando(false)
    const r = data as { ok?: boolean; erro?: string } | null
    if (error || !r?.ok) {
      // A RPC devolve `erro` em linguagem do usuário (ex.: por que não pode excluir); falha de transporte vira texto amigável.
      setErro(!error && r?.erro ? r.erro : erroAmigavel(error))
      return
    }
    setAcao(null)
    onAlterado(acao === 'excluir'
      ? `Cobrança “${contrato.nome}” excluída. Ela sai da lista e o histórico fica registrado.`
      : `Cobrança “${contrato.nome}” encerrada. Não gera mais contas a receber.`)
  }

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
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center' }}>
          <button type="button" onClick={onEditar} style={btnAcao('#3D2314')}>Editar</button>
          <AjudaCampo chave="ge.contratos.editar" rota={ROTA_AJUDA} />
        </span>
        {contrato.status !== 'encerrado' && (
          <span style={{ display: 'inline-flex', alignItems: 'center' }}>
            <button type="button" onClick={() => abrir('encerrar')} style={btnAcao('#BA7517')}>Encerrar</button>
            <AjudaCampo chave="ge.contratos.encerrar" rota={ROTA_AJUDA} />
          </span>
        )}
        <span style={{ display: 'inline-flex', alignItems: 'center' }}>
          <button type="button" onClick={() => abrir('excluir')} style={btnAcao('#A32D2D')}>Excluir</button>
          <AjudaCampo chave="ge.contratos.excluir" rota={ROTA_AJUDA} />
        </span>
      </div>

      {acao && (
        <div style={{ flexBasis: '100%', background: acao === 'excluir' ? 'rgba(163,45,45,0.05)' : 'rgba(186,117,23,0.06)', border: `0.5px solid ${acao === 'excluir' ? 'rgba(163,45,45,0.3)' : 'rgba(186,117,23,0.35)'}`, borderRadius: 8, padding: '12px 14px' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#3D2314', marginBottom: 8 }}>
            {acao === 'excluir'
              ? `Excluir “${contrato.nome}”? Ela sai da lista; o que já foi cobrado continua no financeiro.`
              : `Encerrar “${contrato.nome}”? Ela para de gerar contas a receber a partir de hoje.`}
          </div>
          {erro && <div role="alert" style={{ background: '#FCEBEB', color: '#A32D2D', padding: '8px 12px', borderRadius: 6, marginBottom: 8, fontSize: 12 }}>{erro}</div>}
          <label style={{ display: 'flex', alignItems: 'center', fontSize: 11, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 }}>
            Motivo *
            <AjudaCampo chave="ge.contratos.motivo" rota={ROTA_AJUDA} />
          </label>
          <input
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder={acao === 'excluir' ? 'Ex.: cadastrada em duplicidade' : 'Ex.: cliente cancelou o serviço'}
            style={{ width: '100%', padding: '9px 12px', border: '0.5px solid rgba(61,35,20,0.25)', borderRadius: 6, fontSize: 13, color: '#3D2314', background: '#FFFFFF', boxSizing: 'border-box', marginBottom: 10 }}
          />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" onClick={confirmar} disabled={salvando} style={{ background: acao === 'excluir' ? '#A32D2D' : '#BA7517', color: '#FFFFFF', border: 'none', padding: '8px 16px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: salvando ? 'wait' : 'pointer' }}>
              {salvando ? 'Salvando…' : acao === 'excluir' ? 'Sim, excluir' : 'Sim, encerrar'}
            </button>
            <button type="button" onClick={() => setAcao(null)} disabled={salvando} style={btnAcao('#3D2314')}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  )
}

function btnAcao(cor: string): React.CSSProperties {
  return { background: 'transparent', color: cor, border: `0.5px solid ${cor === '#3D2314' ? 'rgba(61,35,20,0.25)' : cor}`, padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer' }
}
