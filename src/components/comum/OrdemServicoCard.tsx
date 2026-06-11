'use client'

// FEAT-OS-ONDA4-O41-FICHA-GENERICA-v1
// Card de Ordem de Servico GENERICA (zero referencia a vertical).
// Le erp_os por pedido_id · cria via fn_os_criar_de_pedido · edita via fn_os_salvar.
// Mobile-first · touch 44px+ · linguagem CRIOU/ALTEROU.

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import AssinaturaCanvas, { type AssinaturaCanvasHandle } from '@/components/comum/AssinaturaCanvas'

interface OS {
  id: string
  numero: string | null
  status: string
  equipamento: string | null
  defeito_relatado: string | null
  descricao_servico: string | null
  endereco_servico: string | null
  observacoes_cliente: string | null
  observacoes_internas: string | null
  // O4.2 · execucao
  tecnico_nome: string | null
  horas_previstas: number | null
  horas_executadas: number | null
  valor_hora: number | null
  // O4.3 · assinatura
  assinatura_cliente: string | null
  assinatura_data: string | null
  data_abertura: string | null
  data_execucao: string | null
  data_conclusao: string | null
}

interface Props {
  pedidoId: string
  onFlash?: (msg: string) => void
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
  greenD: '#047857',
  amber: '#C88A1A',
  amberBg: '#FFF8E1',
  red: '#EF4444',
  redBg: '#FEE2E2',
  neutralBg: '#F5F2EB',
}

const fmtBRL = (v: number) => 'R$ ' + (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const STATUS: Array<{ value: string; label: string; cor: string; bg: string }> = [
  { value: 'aberta',                 label: 'Aberta',                  cor: C.espresso, bg: C.neutralBg },
  { value: 'em_execucao',            label: 'Em execução',             cor: C.goldD,    bg: C.goldBg },
  { value: 'aguardando_peca',        label: 'Aguardando peça/material', cor: C.amber,    bg: C.amberBg },
  { value: 'aguardando_aprovacao',   label: 'Aguardando aprovação',     cor: C.amber,    bg: C.amberBg },
  { value: 'pronta',                 label: 'Pronta',                  cor: C.green,    bg: C.greenBg },
  { value: 'entregue',               label: 'Entregue',                cor: C.greenD,   bg: C.greenBg },
  { value: 'cancelada',              label: 'Cancelada',               cor: C.red,      bg: C.redBg },
]

const inp: React.CSSProperties = {
  width: '100%', minHeight: 44, padding: '10px 12px',
  border: `1px solid ${C.border}`, borderRadius: 8,
  fontSize: 13, color: C.espresso, background: C.white, outline: 'none',
}
const ta: React.CSSProperties = { ...inp, minHeight: 64, resize: 'vertical' }
const lbl: React.CSSProperties = { display: 'block', fontSize: 11, color: C.espressoM, fontWeight: 600, marginBottom: 4 }
const btnPri: React.CSSProperties = {
  minHeight: 44, padding: '10px 18px', borderRadius: 8,
  border: 'none', background: C.gold, color: C.white,
  fontSize: 13, fontWeight: 700, cursor: 'pointer',
}
const btnSec: React.CSSProperties = {
  minHeight: 36, padding: '6px 12px', borderRadius: 6,
  border: `1px solid ${C.border}`, background: 'transparent',
  color: C.espressoM, fontSize: 11, cursor: 'pointer',
}

function StatusBadge({ status }: { status: string }) {
  const s = STATUS.find((x) => x.value === status) ?? STATUS[0]
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '4px 10px', borderRadius: 999,
      background: s.bg, color: s.cor,
      fontSize: 11, fontWeight: 700, letterSpacing: 0.2,
    }}>
      {s.label}
    </span>
  )
}

export default function OrdemServicoCard({ pedidoId, onFlash }: Props) {
  const [os, setOs] = useState<OS | null>(null)
  const [loading, setLoading] = useState(true)
  const [criando, setCriando] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [msgOk, setMsgOk] = useState<string | null>(null)
  // O4.3 · assinatura
  const [assinando, setAssinando] = useState(false)
  const canvasRef = useRef<AssinaturaCanvasHandle | null>(null)

  function flash(msg: string) {
    setMsgOk(msg)
    flash(msg)
    window.setTimeout(() => setMsgOk((m) => (m === msg ? null : m)), 3500)
  }

  // Form state
  const [equipamento, setEquipamento] = useState('')
  const [defeito, setDefeito] = useState('')
  const [descricao, setDescricao] = useState('')
  const [endereco, setEndereco] = useState('')
  const [obsCliente, setObsCliente] = useState('')
  // O4.2 · execucao (strings pra preservar input vazio sem sobrescrever DB)
  const [tecnicoNome, setTecnicoNome] = useState('')
  const [horasPrevistas, setHorasPrevistas] = useState('')
  const [horasExecutadas, setHorasExecutadas] = useState('')
  const [valorHora, setValorHora] = useState('')

  const carregar = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('erp_os')
      .select('id,numero,status,equipamento,defeito_relatado,descricao_servico,endereco_servico,observacoes_cliente,observacoes_internas,tecnico_nome,horas_previstas,horas_executadas,valor_hora,assinatura_cliente,assinatura_data,data_abertura,data_execucao,data_conclusao')
      .eq('pedido_id', pedidoId)
      .neq('status', 'cancelada')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) setErro(error.message)
    const row = (data ?? null) as OS | null
    setOs(row)
    if (row) {
      setEquipamento(row.equipamento ?? '')
      setDefeito(row.defeito_relatado ?? '')
      setDescricao(row.descricao_servico ?? '')
      setEndereco(row.endereco_servico ?? '')
      setObsCliente(row.observacoes_cliente ?? '')
      setTecnicoNome(row.tecnico_nome ?? '')
      setHorasPrevistas(row.horas_previstas != null ? String(row.horas_previstas) : '')
      setHorasExecutadas(row.horas_executadas != null ? String(row.horas_executadas) : '')
      setValorHora(row.valor_hora != null ? String(row.valor_hora) : '')
    }
    setLoading(false)
  }, [pedidoId])

  useEffect(() => { void carregar() }, [carregar])

  async function abrirOS() {
    setCriando(true)
    setErro(null)
    const { data, error } = await supabase.rpc('fn_os_criar_de_pedido', { p_pedido_id: pedidoId })
    setCriando(false)
    if (error) { setErro(error.message); return }
    const resp = data as { ok?: boolean; erro?: string; ja_existia?: boolean; numero?: string }
    if (resp?.ok === false) { setErro(resp.erro ?? 'Falha ao criar OS'); return }
    flash(resp?.ja_existia ? `Ordem de serviço Nº ${resp.numero} já existia.` : `Ordem de serviço CRIADA · Nº ${resp.numero}.`)
    await carregar()
  }

  async function alterarStatus(novoStatus: string) {
    if (!os) return
    setErro(null)
    const { data, error } = await supabase.rpc('fn_os_salvar', {
      p_os_id: os.id,
      p_dados: { status: novoStatus },
    })
    if (error) { setErro(error.message); return }
    const resp = data as { ok?: boolean; erro?: string }
    if (resp?.ok === false) { setErro(resp.erro ?? 'Falha ao alterar status'); return }
    flash('Status ALTERADO.')
    await carregar()
  }

  async function salvar() {
    if (!os) return
    setSalvando(true)
    setErro(null)
    const { data, error } = await supabase.rpc('fn_os_salvar', {
      p_os_id: os.id,
      p_dados: {
        equipamento: equipamento.trim() || null,
        defeito_relatado: defeito.trim() || null,
        descricao_servico: descricao.trim() || null,
        endereco_servico: endereco.trim() || null,
        observacoes_cliente: obsCliente.trim() || null,
        // O4.2 · execucao · NULLIF no server descarta '' sem sobrescrever
        tecnico_nome: tecnicoNome.trim() || null,
        horas_previstas: horasPrevistas.replace(',', '.'),
        horas_executadas: horasExecutadas.replace(',', '.'),
        valor_hora: valorHora.replace(',', '.'),
      },
    })
    setSalvando(false)
    if (error) { setErro(error.message); return }
    const resp = data as { ok?: boolean; erro?: string }
    if (resp?.ok === false) { setErro(resp.erro ?? 'Falha ao salvar OS'); return }
    flash('Ordem de serviço ALTERADA.')
    await carregar()
  }

  // O4.3 · assinatura
  async function confirmarAssinatura() {
    if (!os) return
    const c = canvasRef.current
    if (!c || c.isEmpty()) { setErro('Assine no quadro antes de confirmar.'); return }
    const dataURL = c.toDataURL()
    setAssinando(true)
    setErro(null)
    const { data, error } = await supabase.rpc('fn_os_assinar', {
      p_os_id: os.id,
      p_assinatura_base64: dataURL,
    })
    setAssinando(false)
    if (error) { setErro(error.message); return }
    const resp = data as { ok?: boolean; erro?: string }
    if (resp?.ok === false) { setErro(resp.erro ?? 'Falha ao registrar assinatura'); return }
    flash('Assinatura registrada.')
    await carregar()
  }

  async function refazerAssinatura() {
    if (!os) return
    if (!confirm('Apagar a assinatura atual e refazer?')) return
    setAssinando(true)
    setErro(null)
    const { data, error } = await supabase.rpc('fn_os_remover_assinatura', { p_os_id: os.id })
    setAssinando(false)
    if (error) { setErro(error.message); return }
    const resp = data as { ok?: boolean; erro?: string }
    if (resp?.ok === false) { setErro(resp.erro ?? 'Falha ao limpar assinatura'); return }
    await carregar()
  }

  if (loading) {
    return <p style={{ fontSize: 12, color: C.espressoM, fontStyle: 'italic', margin: 0 }}>Carregando…</p>
  }

  if (!os) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <p style={{ fontSize: 12, color: C.espressoM, margin: 0 }}>
          Nenhuma ordem de serviço aberta para este pedido.
        </p>
        <button
          type="button"
          onClick={abrirOS}
          disabled={criando}
          data-testid="os-abrir"
          style={{ ...btnPri, alignSelf: 'flex-start', opacity: criando ? 0.6 : 1 }}
        >
          {criando ? 'Abrindo…' : 'Abrir Ordem de Serviço'}
        </button>
        {erro && <p style={{ fontSize: 12, color: C.red, margin: 0 }}>❌ {erro}</p>}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 13, color: C.espresso, fontFamily: 'monospace' }}>OS Nº {os.numero ?? '—'}</strong>
        <StatusBadge status={os.status} />
      </div>

      <label style={{ display: 'block' }}>
        <span style={lbl}>Status</span>
        <select
          value={os.status}
          onChange={(e) => void alterarStatus(e.target.value)}
          data-testid="os-status-select"
          style={{ ...inp, cursor: 'pointer' }}
        >
          {STATUS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </label>

      <label style={{ display: 'block' }}>
        <span style={lbl}>Equipamento / Item</span>
        <input
          value={equipamento}
          onChange={(e) => setEquipamento(e.target.value)}
          placeholder="Ex: Compressor 3HP / Notebook Dell / etc"
          data-testid="os-equipamento"
          style={inp}
        />
      </label>

      <label style={{ display: 'block' }}>
        <span style={lbl}>Problema ou solicitação relatada</span>
        <textarea
          value={defeito}
          onChange={(e) => setDefeito(e.target.value)}
          rows={2}
          placeholder="O que o cliente relatou?"
          data-testid="os-defeito"
          style={ta}
        />
      </label>

      <label style={{ display: 'block' }}>
        <span style={lbl}>Descrição do serviço</span>
        <textarea
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
          rows={2}
          placeholder="O que foi/será feito"
          data-testid="os-descricao"
          style={ta}
        />
      </label>

      <label style={{ display: 'block' }}>
        <span style={lbl}>Local de execução</span>
        <input
          value={endereco}
          onChange={(e) => setEndereco(e.target.value)}
          placeholder="Ex: no cliente / endereço de execução"
          data-testid="os-endereco"
          style={inp}
        />
      </label>

      <label style={{ display: 'block' }}>
        <span style={lbl}>Observações ao cliente</span>
        <textarea
          value={obsCliente}
          onChange={(e) => setObsCliente(e.target.value)}
          rows={2}
          data-testid="os-obs-cliente"
          style={ta}
        />
      </label>

      {/* FEAT-OS-ONDA4-O42-EXECUCAO-v1 · bloco Execução */}
      <div style={{
        marginTop: 4, padding: '12px 0 0',
        borderTop: `1px solid ${C.border}`,
        display: 'flex', flexDirection: 'column', gap: 12,
      }}>
        <div style={{
          fontSize: 10, fontWeight: 700, color: C.espressoM,
          textTransform: 'uppercase', letterSpacing: 1,
        }}>Execução</div>

        <label style={{ display: 'block' }}>
          <span style={lbl}>Responsável</span>
          <input
            value={tecnicoNome}
            onChange={(e) => setTecnicoNome(e.target.value)}
            placeholder="Nome do responsável pela execução"
            data-testid="os-tecnico"
            style={inp}
          />
        </label>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <label style={{ display: 'block' }}>
            <span style={lbl}>Horas previstas</span>
            <input
              type="number" inputMode="decimal" step="0.5" min="0"
              value={horasPrevistas}
              onChange={(e) => setHorasPrevistas(e.target.value)}
              data-testid="os-horas-previstas"
              style={inp}
            />
          </label>
          <label style={{ display: 'block' }}>
            <span style={lbl}>Horas executadas</span>
            <input
              type="number" inputMode="decimal" step="0.5" min="0"
              value={horasExecutadas}
              onChange={(e) => setHorasExecutadas(e.target.value)}
              data-testid="os-horas-executadas"
              style={inp}
            />
          </label>
        </div>

        <label style={{ display: 'block' }}>
          <span style={lbl}>Valor/hora (R$)</span>
          <input
            type="number" inputMode="decimal" step="0.01" min="0"
            value={valorHora}
            onChange={(e) => setValorHora(e.target.value)}
            data-testid="os-valor-hora"
            style={inp}
          />
        </label>

        <div style={{
          padding: '10px 12px', borderRadius: 8, background: C.neutralBg,
          fontSize: 12, color: C.espresso, display: 'flex', flexDirection: 'column', gap: 4,
        }}>
          <span>
            Mão de obra estimada: <strong style={{ color: C.gold }}>
              {fmtBRL((Number((horasExecutadas || '0').replace(',', '.')) || 0) * (Number((valorHora || '0').replace(',', '.')) || 0))}
            </strong>
          </span>
          <span style={{ fontSize: 10, color: C.espressoL, fontStyle: 'italic' }}>
            valor informativo — o faturamento é pelo pedido.
          </span>
        </div>
      </div>

      {/* FEAT-OS-ONDA4-O43-ASSINATURA-v1 · bloco Assinatura */}
      <div style={{
        marginTop: 4, padding: '12px 0 0',
        borderTop: `1px solid ${C.border}`,
        display: 'flex', flexDirection: 'column', gap: 10,
      }}>
        <div style={{
          fontSize: 10, fontWeight: 700, color: C.espressoM,
          textTransform: 'uppercase', letterSpacing: 1,
        }}>Assinatura de recebimento do cliente</div>

        {os.assinatura_cliente ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, background: '#fff', padding: 6 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={os.assinatura_cliente}
                alt="Assinatura do cliente"
                style={{ display: 'block', width: '100%', maxHeight: 180, objectFit: 'contain' }}
              />
            </div>
            <p style={{ fontSize: 11, color: C.espressoM, margin: 0 }}>
              Assinado em <strong style={{ color: C.espresso }}>
                {os.assinatura_data ? new Date(os.assinatura_data).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
              </strong>
            </p>
            <button
              type="button"
              onClick={refazerAssinatura}
              disabled={assinando}
              data-testid="os-assinar-refazer"
              style={{ ...btnSec, alignSelf: 'flex-start', minHeight: 44, padding: '10px 14px', fontSize: 12 }}
            >
              Refazer assinatura
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <p style={{ fontSize: 11, color: C.espressoM, margin: 0 }}>
              Peça ao cliente para assinar no quadro abaixo e clique em "Confirmar".
            </p>
            <AssinaturaCanvas ref={canvasRef} />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => canvasRef.current?.clear()}
                disabled={assinando}
                data-testid="os-assinar-limpar"
                style={{ ...btnSec, minHeight: 44, padding: '10px 14px', fontSize: 12 }}
              >
                Limpar
              </button>
              <button
                type="button"
                onClick={confirmarAssinatura}
                disabled={assinando}
                data-testid="os-assinar-confirmar"
                style={{ ...btnPri, opacity: assinando ? 0.6 : 1 }}
              >
                {assinando ? 'Salvando…' : 'Confirmar assinatura'}
              </button>
            </div>
          </div>
        )}
      </div>

      {erro && <p style={{ fontSize: 12, color: C.red, margin: 0 }}>❌ {erro}</p>}
      {msgOk && <p style={{ fontSize: 12, color: C.green, fontWeight: 600, margin: 0 }}>✓ {msgOk}</p>}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 10, color: C.espressoL, marginRight: 'auto' }}>
          {os.data_abertura && <>Aberta {os.data_abertura}</>}
          {os.data_execucao && <> · em execução desde {os.data_execucao}</>}
          {os.data_conclusao && <> · concluída {os.data_conclusao}</>}
        </span>
        <button
          type="button"
          onClick={() => void carregar()}
          style={btnSec}
        >
          Recarregar
        </button>
        {/* FEAT-OS-ONDA4-O44-IMPRESSAO-v1 */}
        <button
          type="button"
          onClick={() => window.open(`/dashboard/commerce/otc/imprimir/${os.id}`, '_blank', 'noopener,noreferrer')}
          data-testid="os-imprimir"
          style={btnSec}
        >
          🖨️ Imprimir OS
        </button>
        <button
          type="button"
          onClick={salvar}
          disabled={salvando}
          data-testid="os-salvar"
          style={{ ...btnPri, opacity: salvando ? 0.6 : 1 }}
        >
          {salvando ? 'Salvando…' : 'Salvar OS'}
        </button>
      </div>
    </div>
  )
}
