'use client'

// FEAT-OS-ONDA4-O41-FICHA-GENERICA-v1
// Card de Ordem de Servico GENERICA (zero referencia a vertical).
// Le erp_os por pedido_id · cria via fn_os_criar_de_pedido · edita via fn_os_salvar.
// Mobile-first · touch 44px+ · linguagem CRIOU/ALTEROU.

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import ConfirmarExclusaoOS from '@/components/comum/ConfirmarExclusaoOS'
import { orFiltroClienteBusca } from '@/lib/clienteBusca'
import { fmtData } from '@/lib/psgc-tokens'   // formata date puro em LOCAL (sem drift −1 dia de UTC)

interface OS {
  id: string
  numero: string | null
  status: string
  company_id: string
  pedido_id: string | null
  cliente_id: string | null
  cliente_nome: string | null
  cliente_cnpj: string | null
  titulos_gerados: boolean | null
  lancamento_id: string | null
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
  pedidoId?: string
  osId?: string
  onFlash?: (msg: string) => void
  onExcluida?: (acao: 'excluida' | 'cancelada', numero: string | null) => void
  // CRUD-OS · o botão excluir/cancelar só aparece onde a missão é GERIR a OS
  // (tela /dashboard/os). No fluxo OTC o contexto é venda/faturamento — um 🗑️
  // ali é perigoso (regra CEO: "uma tela, uma missão"). Default: escondido.
  podeExcluir?: boolean
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
// RD-41 · data/hora do selo pós-entrega (DD/MM/AAAA HH:MM), tolerante a valor inválido.
const fmtQuando = (iso: string) => {
  const d = new Date(iso)
  return isNaN(d.getTime()) ? String(iso) : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

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

export default function OrdemServicoCard({ pedidoId, osId, onFlash, onExcluida, podeExcluir = false }: Props) {
  const [os, setOs] = useState<OS | null>(null)
  const [loading, setLoading] = useState(true)
  const [criando, setCriando] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [msgOk, setMsgOk] = useState<string | null>(null)
  // CRUD-OS · exclusão / cancelamento
  const [excluirAberto, setExcluirAberto] = useState(false)
  const [excluindo, setExcluindo] = useState(false)
  const [erroExcluir, setErroExcluir] = useState<string | null>(null)
  // OS → GE · faturar (gera título em Contas a Receber)
  const [faturando, setFaturando] = useState(false)
  // RD-41 · edição pós-entrega restrita a Master (CLIENT_OWNER). papel na empresa da OS + selo de auditoria.
  const [papel, setPapel] = useState<string | null>(null)
  const [selo, setSelo] = useState<{ user_email?: string; quando?: string } | null>(null)
  // RD-41 · itens do diagnóstico (peças + serviços). A ficha reabria SEM eles → impresso zerado.
  const [itensDiag, setItensDiag] = useState<Array<{ id?: string | null; tipo?: string; descricao?: string; quantidade?: number | string | null; preco?: number | null; subtotal?: number | null; status_item?: string | null }>>([])

  const faturada = Boolean(os?.titulos_gerados) || os?.lancamento_id != null
  const podeFaturar = !faturada && ['pronta', 'entregue', 'concluida', 'concluída', 'finalizada'].includes(String(os?.status ?? ''))
  // RD-41 · OS entregue: só Master (CLIENT_OWNER) ajusta. Não-Master fica somente-leitura.
  const entregue = os?.status === 'entregue'
  const isMaster = papel === 'CLIENT_OWNER'
  const bloqueadoEntrega = Boolean(entregue && !isMaster)   // não-Master não edita OS entregue
  const roEntrega = bloqueadoEntrega                         // readOnly nos campos quando bloqueado
  const tipEntrega = 'OS entregue — ajustes só por usuário Master.'

  async function faturar() {
    if (!os) return
    setFaturando(true); setErro(null); setMsgOk(null)
    const { data, error } = await supabase.rpc('fn_os_faturar', { p_os_id: os.id })
    setFaturando(false)
    const r = data as { ok?: boolean; erro?: string; valor?: number } | null
    if (error || r?.ok === false) { setErro(error?.message || r?.erro || 'Falha ao faturar'); return }
    const v = r?.valor != null ? ` — R$ ${Number(r.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : ''
    flash(`Faturada ✓ título gerado na GE${v}. Veja em Financeiro → Contas a Receber.`)
    void carregar()
  }

  function flash(msg: string) {
    setMsgOk(msg)
    onFlash?.(msg)
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
  // FIX 1 · cliente editável/re-vinculável em qualquer status (KGF/Kleiton)
  const [clienteId, setClienteId] = useState<string | null>(null)
  const [clienteNome, setClienteNome] = useState('')
  const [clienteCnpj, setClienteCnpj] = useState('')
  const [trocarCli, setTrocarCli] = useState(false)          // abre a busca de re-vínculo
  const [buscaCli, setBuscaCli] = useState('')
  const [cliOpts, setCliOpts] = useState<Array<{ id: string; nome: string; doc: string | null }>>([])

  const carregar = useCallback(async () => {
    setLoading(true)
    // ONDA-OS-MECANICO-MOBILE-v1 · osId tem prioridade · permite OS avulsa
    const cols = 'id,numero,status,company_id,pedido_id,cliente_id,cliente_nome,cliente_cnpj,titulos_gerados,lancamento_id,equipamento,defeito_relatado,descricao_servico,endereco_servico,observacoes_cliente,observacoes_internas,tecnico_nome,horas_previstas,horas_executadas,valor_hora,assinatura_cliente,assinatura_data,data_abertura,data_execucao,data_conclusao'
    const q = supabase.from('erp_os').select(cols)
    const { data, error } = osId
      ? await q.eq('id', osId).maybeSingle()
      : await q.eq('pedido_id', pedidoId as string).neq('status', 'cancelada').order('created_at', { ascending: false }).limit(1).maybeSingle()
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
      setClienteId(row.cliente_id ?? null)
      setClienteNome(row.cliente_nome ?? '')
      setClienteCnpj(row.cliente_cnpj ?? '')
      setTrocarCli(false); setBuscaCli(''); setCliOpts([])
    }
    // RD-41 · carrega os itens do diagnóstico (a ficha reabria SEM eles ao editar OS entregue → impresso zerado)
    if (row?.id && row.company_id) {
      const { data: diag } = await supabase.rpc('fn_oficina_diagnostico_obter', { p_company_id: row.company_id, p_os_id: row.id })
      const dd = diag as { itens?: typeof itensDiag } | null   // o retorno traz {diagnostico,km,itens,resumo} (sem 'ok')
      setItensDiag(Array.isArray(dd?.itens) ? (dd?.itens ?? []) : [])
    } else {
      setItensDiag([])
    }
    setLoading(false)
  }, [pedidoId, osId])

  // Busca de cliente pra RE-VINCULAR (reusa o filtro compartilhado — RD-26). Escopo da empresa da OS.
  useEffect(() => {
    const termo = buscaCli.trim()
    const filtro = orFiltroClienteBusca(termo)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!trocarCli || !filtro || !os?.company_id) { setCliOpts([]); return }
    const companyId = os.company_id
    let alive = true
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('erp_clientes')
        .select('id, razao_social, nome_fantasia, cpf_cnpj')
        .eq('company_id', companyId).eq('ativo', true)
        .or(filtro).limit(8)
      if (!alive) return
      const list = (data ?? []) as Array<{ id: string; razao_social: string | null; nome_fantasia: string | null; cpf_cnpj: string | null }>
      setCliOpts(list.map((c) => ({ id: c.id, nome: c.nome_fantasia || c.razao_social || '—', doc: c.cpf_cnpj })))
    }, 250)
    return () => { alive = false; clearTimeout(t) }
  }, [buscaCli, trocarCli, os?.company_id])

  function escolherCliente(c: { id: string; nome: string; doc: string | null }) {
    setClienteId(c.id); setClienteNome(c.nome); setClienteCnpj(c.doc ?? '')
    setTrocarCli(false); setBuscaCli(''); setCliOpts([])
  }

  useEffect(() => { void carregar() }, [carregar])

  // RD-41 · papel do usuário na empresa da OS (Master = CLIENT_OWNER) + selo "editada após entrega".
  useEffect(() => {
    const cid = os?.company_id; const oid = os?.id
    if (!cid || !oid) { setPapel(null); setSelo(null); return }
    let alive = true
    void (async () => {
      const [p, s] = await Promise.all([
        supabase.rpc('fn_oficina_papel', { p_company_id: cid }),
        supabase.rpc('fn_os_editado_pos_entrega', { p_os_id: oid }),
      ])
      if (!alive) return
      setPapel(typeof p.data === 'string' ? p.data : null)
      const sel = s.data as { user_email?: string; quando?: string } | null
      setSelo(sel ?? null)
    })()
    return () => { alive = false }
  }, [os?.id, os?.company_id, os?.status])

  async function abrirOS() {
    setCriando(true)
    setErro(null)
    const { data, error } = await supabase.rpc('fn_os_criar_de_pedido', { p_pedido_id: pedidoId })
    setCriando(false)
    if (error) { setErro(error.message); return }
    const resp = data as { ok?: boolean; erro?: string; ja_existia?: boolean; numero?: string; os_id?: string }
    if (resp?.ok === false) { setErro(resp.erro ?? 'Falha ao criar OS'); return }
    // FIX-OS-ABRIR-COM-OS-ID-v1
    // Abrir ficha SEMPRE com resp.os_id (campo da RPC), independente de
    // ja_existia. Fetch direto por id e mais robusto que filtrar por
    // pedido_id + status na re-query.
    if (resp?.os_id) {
      const { data: row } = await supabase
        .from('erp_os')
        .select('id,numero,status,company_id,pedido_id,cliente_id,cliente_nome,cliente_cnpj,titulos_gerados,lancamento_id,equipamento,defeito_relatado,descricao_servico,endereco_servico,observacoes_cliente,observacoes_internas,tecnico_nome,horas_previstas,horas_executadas,valor_hora,assinatura_cliente,assinatura_data,data_abertura,data_execucao,data_conclusao')
        .eq('id', resp.os_id)
        .maybeSingle()
      if (row) {
        const r = row as OS
        setOs(r)
        setEquipamento(r.equipamento ?? '')
        setDefeito(r.defeito_relatado ?? '')
        setDescricao(r.descricao_servico ?? '')
        setEndereco(r.endereco_servico ?? '')
        setObsCliente(r.observacoes_cliente ?? '')
        setTecnicoNome(r.tecnico_nome ?? '')
        setHorasPrevistas(r.horas_previstas != null ? String(r.horas_previstas) : '')
        setHorasExecutadas(r.horas_executadas != null ? String(r.horas_executadas) : '')
        setValorHora(r.valor_hora != null ? String(r.valor_hora) : '')
        setClienteId(r.cliente_id ?? null); setClienteNome(r.cliente_nome ?? ''); setClienteCnpj(r.cliente_cnpj ?? '')
      } else {
        await carregar() // fallback
      }
    } else {
      await carregar()
    }
    flash(resp?.ja_existia ? `Ordem de serviço Nº ${resp.numero} já existia.` : `Ordem de serviço CRIADA · Nº ${resp.numero}.`)
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
        // FIX 1 · cliente (nome sempre; cliente_id só quando re-vinculado a um cadastro)
        cliente_nome: clienteNome.trim() || null,
        cliente_cnpj: clienteCnpj.trim() || null,
        ...(clienteId ? { cliente_id: clienteId } : {}),
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

  // CRUD-OS · exclusão (soft-delete) / cancelamento (se faturada) — servidor decide
  async function excluir(motivo: string) {
    if (!os) return
    setExcluindo(true)
    setErroExcluir(null)
    const { data, error } = await supabase.rpc('fn_os_excluir', {
      p_os_id: os.id,
      p_motivo: motivo || null,
    })
    setExcluindo(false)
    if (error) { setErroExcluir(error.message); return }
    const resp = data as { ok?: boolean; erro?: string; acao?: 'excluida' | 'cancelada'; numero?: string } | null
    if (!resp?.ok) { setErroExcluir(resp?.erro ?? 'Falha ao excluir OS'); return }
    setExcluirAberto(false)
    flash(resp.acao === 'cancelada' ? 'Ordem de serviço CANCELADA.' : 'Ordem de serviço EXCLUÍDA.')
    if (onExcluida) onExcluida(resp.acao ?? 'excluida', resp.numero ?? os.numero)
    else await carregar() // sem handler (ex.: OTC) — atualiza o status na própria ficha
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

      {/* RD-41 · selo de auditoria: OS ajustada após a entrega (controle pedido pela Jordana) */}
      {selo && (
        <div data-testid="os-selo-pos-entrega" style={{ fontSize: 11.5, color: C.espresso, background: C.neutralBg, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 10px' }}>
          ✏️ Editada após entrega{selo.user_email ? ` por ${selo.user_email}` : ''}{selo.quando ? ` em ${fmtQuando(selo.quando)}` : ''}
        </div>
      )}
      {/* RD-41 · avisos de edição pós-entrega */}
      {entregue && isMaster && (
        <div data-testid="os-aviso-master" style={{ fontSize: 12, color: C.espresso, background: C.amberBg, border: `1px solid ${C.amber}`, borderRadius: 8, padding: '8px 10px' }}>
          ⚠️ Você está ajustando uma OS já entregue. A alteração fica registrada.
        </div>
      )}
      {bloqueadoEntrega && (
        <div data-testid="os-bloqueio-entrega" style={{ fontSize: 12, color: C.espresso, background: C.neutralBg, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 10px' }}>
          🔒 {tipEntrega}
        </div>
      )}

      <label style={{ display: 'block' }}>
        <span style={lbl}>Status</span>
        <select
          value={os.status}
          onChange={(e) => void alterarStatus(e.target.value)}
          data-testid="os-status-select"
          disabled={bloqueadoEntrega}
          title={bloqueadoEntrega ? tipEntrega : undefined}
          style={{ ...inp, cursor: bloqueadoEntrega ? 'not-allowed' : 'pointer', opacity: bloqueadoEntrega ? 0.6 : 1 }}
        >
          {STATUS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </label>

      {/* FIX 1 · cliente editável em qualquer status + re-vínculo a outro cadastro */}
      <div style={{ display: 'block' }}>
        <span style={lbl}>Cliente</span>
        <input
          value={clienteNome}
          onChange={(e) => setClienteNome(e.target.value)}
          placeholder="Nome do cliente"
          data-testid="os-cliente-nome"
          readOnly={roEntrega}
          style={inp}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6, flexWrap: 'wrap' }}>
          {clienteCnpj && <span style={{ fontSize: 11, color: C.espressoM }}>Doc: {clienteCnpj}</span>}
          {!roEntrega && (
            <button type="button" onClick={() => { setTrocarCli((v) => !v); setBuscaCli('') }}
              style={{ background: 'none', border: 'none', color: C.gold, fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 0 }}>
              {trocarCli ? '− cancelar' : '🔍 Trocar / re-vincular cliente'}
            </button>
          )}
        </div>
        {trocarCli && (
          <div style={{ marginTop: 6, position: 'relative' }}>
            <input
              value={buscaCli}
              onChange={(e) => setBuscaCli(e.target.value)}
              placeholder="Buscar por nome ou CNPJ/CPF…"
              autoFocus
              style={inp}
            />
            {cliOpts.length > 0 && (
              <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, marginTop: 4, background: C.white, maxHeight: 220, overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,.06)' }}>
                {cliOpts.map((c) => (
                  <button key={c.id} type="button" onClick={() => escolherCliente(c)}
                    style={{ display: 'block', width: '100%', textAlign: 'left', border: 'none', background: 'none', padding: '8px 10px', fontSize: 13, cursor: 'pointer', color: C.espresso }}>
                    {c.nome}{c.doc ? <span style={{ color: C.espressoM, fontSize: 11, marginLeft: 6 }}>· {c.doc}</span> : null}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {os.pedido_id && (
          <div style={{ marginTop: 8, background: C.amberBg, border: `1px solid ${C.amber}`, borderRadius: 8, padding: '8px 10px', fontSize: 12, color: C.espresso }}>
            ⚠️ Esta OS já gerou um pedido/faturamento. Alterar o cliente aqui atualiza a OS; o pedido mantém o cliente original.
          </div>
        )}
      </div>

      <label style={{ display: 'block' }}>
        <span style={lbl}>Equipamento / Item</span>
        <input
          value={equipamento}
          onChange={(e) => setEquipamento(e.target.value)}
          placeholder="Ex: Compressor 3HP / Notebook Dell / etc"
          data-testid="os-equipamento"
          readOnly={roEntrega}
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
          readOnly={roEntrega}
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
          readOnly={roEntrega}
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
          readOnly={roEntrega}
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
          readOnly={roEntrega}
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
            readOnly={roEntrega}
            style={inp}
          />
        </label>

        {/* Horas NÃO são digitadas (regra CEO): previstas vêm do Tempário e
            executadas do Apontamento (início/fim). Aqui são só LEITURA — o tempo
            é MEDIDO, não chutado (protege tempário/eficiência/custo real). */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div>
            <span style={lbl}>Horas previstas</span>
            <div data-testid="os-horas-previstas" style={{ ...inp, background: C.neutralBg, color: C.espresso, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontWeight: 600 }}>{horasPrevistas ? `${horasPrevistas}h` : '—'}</span>
              <span style={{ fontSize: 10, color: '#9C8E80' }}>via Tempário</span>
            </div>
          </div>
          <div>
            <span style={lbl}>Horas executadas</span>
            <div data-testid="os-horas-executadas" style={{ ...inp, background: C.neutralBg, color: C.espresso, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontWeight: 600 }}>{horasExecutadas ? `${horasExecutadas}h` : '—'}</span>
              <span style={{ fontSize: 10, color: '#9C8E80' }}>via Apontamento</span>
            </div>
          </div>
        </div>

        <label style={{ display: 'block' }}>
          <span style={lbl}>Valor/hora (R$)</span>
          <input
            type="number" inputMode="decimal" step="0.01" min="0"
            value={valorHora}
            onChange={(e) => setValorHora(e.target.value)}
            data-testid="os-valor-hora"
            readOnly={roEntrega || faturada}
            title={faturada ? 'Valores travados: OS já lançada na GE.' : (roEntrega ? tipEntrega : undefined)}
            style={{ ...inp, ...(faturada ? { background: C.neutralBg, color: C.espressoM } : {}) }}
          />
          {faturada && <span style={{ fontSize: 10, color: C.espressoL, fontStyle: 'italic' }}>🔒 Valores travados: OS já lançada na GE. Dados de veículo/cliente permanecem editáveis.</span>}
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

      {/* RD-41 · a assinatura única "de recebimento da OS" saiu daqui. Agora são 2
          assinaturas operacionais tipadas: "Ciente do checklist" (na Recepção) e
          "Entrega" (no Pátio), gravadas em erp_os_assinatura via AssinaturaModal.
          O orçamento é aprovado por WhatsApp (fn_oficina_aprovacao_registrar). */}

      {erro && <p style={{ fontSize: 12, color: C.red, margin: 0 }}>❌ {erro}</p>}
      {msgOk && <p style={{ fontSize: 12, color: C.green, fontWeight: 600, margin: 0 }}>✓ {msgOk}</p>}

      {/* RD-41 · Itens da OS (peças + serviços). Vinham vazios ao reabrir OS entregue → impresso zerado. */}
      {itensDiag.length > 0 && (
        <div data-testid="os-itens" style={{ border: '1px solid rgba(61,35,20,0.12)', borderRadius: 10, padding: 12, background: C.white }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.espresso, marginBottom: 8 }}>Itens da OS ({itensDiag.length})</div>
          {itensDiag.map((it, i) => {
            const qtd = it.quantidade != null && String(it.quantidade) !== '' ? Number(it.quantidade) : 1
            const val = it.subtotal ?? it.preco
            return (
              <div key={it.id ?? i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderTop: i ? '1px solid rgba(61,35,20,0.07)' : 'none', fontSize: 12.5 }}>
                <span>{it.tipo === 'servico' ? '🔧' : '📦'}</span>
                <span style={{ flex: 1, minWidth: 0, color: C.espresso, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.descricao || (it.tipo === 'servico' ? 'Serviço' : 'Peça')}</span>
                <span style={{ color: C.espressoL, whiteSpace: 'nowrap' }}>{qtd.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}×</span>
                {it.status_item === 'recusado'
                  ? <span style={{ fontSize: 11, fontWeight: 700, color: C.espressoL }}>recusado</span>
                  : val != null
                    ? <span style={{ fontWeight: 700, color: C.espresso, whiteSpace: 'nowrap' }}>{fmtBRL(Number(val))}</span>
                    : <span style={{ fontSize: 10.5, fontWeight: 700, color: C.amber, background: C.amberBg, borderRadius: 6, padding: '2px 6px', whiteSpace: 'nowrap' }}>precificar</span>}
              </div>
            )
          })}
          {itensDiag.some((it) => (it.subtotal ?? it.preco) == null && it.status_item !== 'recusado') && (
            <div style={{ fontSize: 11.5, color: C.amber, marginTop: 8 }}>
              ⚠️ Itens sem preço. Precifique no diagnóstico da OS para o total e o impresso saírem com valores.
            </div>
          )}
          {(() => {
            const total = itensDiag.filter((it) => it.status_item !== 'recusado').reduce((a, it) => a + Number(it.subtotal ?? it.preco ?? 0), 0)
            return total > 0 ? (
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(61,35,20,0.12)', fontSize: 13, fontWeight: 800, color: C.espresso }}>
                Total: {fmtBRL(total)}
              </div>
            ) : null
          })()}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap', alignItems: 'center' }}>
        {podeExcluir && (
          <button
            type="button"
            onClick={() => { setErroExcluir(null); setExcluirAberto(true) }}
            data-testid="os-excluir"
            style={{ ...btnSec, minHeight: 44, padding: '10px 14px', fontSize: 12, fontWeight: 700, color: C.red, borderColor: C.redBg, background: C.redBg }}
          >
            {(os.titulos_gerados || os.lancamento_id) ? '🚫 Cancelar OS' : '🗑️ Excluir OS'}
          </button>
        )}
        <span style={{ fontSize: 10, color: C.espressoL, marginRight: 'auto' }}>
          {os.data_abertura && <>Aberta em {fmtData(os.data_abertura)}</>}
          {os.data_execucao && <> · em execução desde {fmtData(os.data_execucao)}</>}
          {os.data_conclusao && <> · concluída {fmtData(os.data_conclusao)}</>}
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
          title={entregue ? 'Reimprimir a OS (documento atualizado) para reenviar ao cliente/comprador' : undefined}
          style={btnSec}
        >
          🖨️ {entregue ? 'Reimprimir OS' : 'Imprimir OS'}
        </button>
        {faturada ? (
          <span data-testid="os-faturada" style={{ fontSize: 12, fontWeight: 700, color: C.green, background: C.greenBg, borderRadius: 8, padding: '10px 14px', minHeight: 44, display: 'inline-flex', alignItems: 'center' }}>
            ✓ Faturada
          </span>
        ) : podeFaturar ? (
          <button
            type="button"
            onClick={() => void faturar()}
            disabled={faturando}
            data-testid="os-faturar"
            title="Gera o título em Contas a Receber (GE)"
            style={{ ...btnPri, background: C.gold, color: '#3D2314', opacity: faturando ? 0.6 : 1 }}
          >
            {faturando ? 'Faturando…' : '💰 Faturar OS'}
          </button>
        ) : null}
        <button
          type="button"
          onClick={salvar}
          disabled={salvando || bloqueadoEntrega}
          data-testid="os-salvar"
          title={bloqueadoEntrega ? tipEntrega : undefined}
          style={{ ...btnPri, opacity: (salvando || bloqueadoEntrega) ? 0.5 : 1, cursor: bloqueadoEntrega ? 'not-allowed' : 'pointer' }}
        >
          {salvando ? 'Salvando…' : 'Salvar OS'}
        </button>
      </div>

      {excluirAberto && (
        <ConfirmarExclusaoOS
          numero={os.numero}
          faturada={Boolean(os.titulos_gerados) || os.lancamento_id != null}
          busy={excluindo}
          erro={erroExcluir}
          onConfirm={(motivo) => void excluir(motivo)}
          onClose={() => { if (!excluindo) { setExcluirAberto(false); setErroExcluir(null) } }}
        />
      )}
    </div>
  )
}
