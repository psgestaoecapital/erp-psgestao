'use client'

// ONDA-OS-MECANICO-MOBILE-v1
// /dashboard/os · ponto de entrada do mecanico no celular.
// Lista OS da empresa ativa + Nova OS avulsa via fn_os_criar.
// Mobile-first · touch 44px+ · linguagem CRIOU/ABRIU.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { orFiltroClienteBusca } from '@/lib/clienteBusca'
import { useCompanyIds } from '@/lib/useCompanyIds'
import OrdemServicoCard from '@/components/comum/OrdemServicoCard'
import ConfirmarExclusaoOS from '@/components/comum/ConfirmarExclusaoOS'

export const dynamic = 'force-dynamic'

const C = {
  espresso: '#3D2314', espressoM: '#6B5D4F', espressoL: '#9C8E80',
  bg: '#FAF7F2', white: '#FFFFFF', cream: '#F0ECE3', border: '#E0D8CC',
  gold: '#C8941A', goldBg: '#FDF7E8',
  green: '#10B981', greenBg: '#ECFDF5', greenD: '#047857',
  amber: '#C88A1A', amberBg: '#FFF8E1',
  red: '#EF4444', redBg: '#FEE2E2',
  blue: '#3B82F6',
}

const STATUS_CFG: Record<string, { label: string; cor: string; bg: string }> = {
  aberta:                { label: 'Aberta',                  cor: C.espresso, bg: C.cream },
  em_execucao:           { label: 'Em execução',             cor: C.gold,     bg: C.goldBg },
  aguardando_peca:       { label: 'Aguardando peça',         cor: C.amber,    bg: C.amberBg },
  aguardando_aprovacao:  { label: 'Aguardando aprovação',    cor: C.amber,    bg: C.amberBg },
  pronta:                { label: 'Pronta',                  cor: C.green,    bg: C.greenBg },
  entregue:              { label: 'Entregue',                cor: C.greenD,   bg: C.greenBg },
  cancelada:             { label: 'Cancelada',               cor: C.red,      bg: C.redBg },
}
const STATUS_ORDER = ['aberta','em_execucao','aguardando_peca','aguardando_aprovacao','pronta','entregue','cancelada'] as const

interface OSRow {
  id: string
  company_id: string
  numero: string | null
  cliente_nome: string | null
  equipamento: string | null
  placa: string | null
  modelo: string | null
  status: string
  data_abertura: string | null
  total: number | null
  titulos_gerados: boolean | null
  lancamento_id: string | null
}

interface Cliente {
  id: string
  razao_social: string | null
  nome_fantasia: string | null
  cpf_cnpj: string | null
  company_id: string
}

const fmtBRL = (v: number | null | undefined) =>
  v == null ? '—' : 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtD = (s: string | null | undefined) =>
  s ? new Date(s + (s.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('pt-BR') : '—'

const inp: React.CSSProperties = {
  width: '100%', minHeight: 44, padding: '10px 12px',
  border: `1px solid ${C.border}`, borderRadius: 8,
  fontSize: 14, color: C.espresso, background: C.white, outline: 'none',
}
const lbl: React.CSSProperties = { display: 'block', fontSize: 11, color: C.espressoM, fontWeight: 600, marginBottom: 4 }

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_CFG[status] ?? STATUS_CFG.aberta
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '3px 9px', borderRadius: 999,
      background: s.bg, color: s.cor,
      fontSize: 10, fontWeight: 700, letterSpacing: 0.2,
      whiteSpace: 'nowrap',
    }}>{s.label}</span>
  )
}

export default function OSMecanicoPage() {
  const { companyIds, sel, companies } = useCompanyIds()
  const [oss, setOss] = useState<OSRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filtroStatus, setFiltroStatus] = useState<string>('todas')
  const [busca, setBusca] = useState('')
  const [novoAberto, setNovoAberto] = useState(false)
  const [osAberta, setOsAberta] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)

  // FIX-VAZAMENTO-JORDANA (07/07): tela operacional — nunca .in(companyIds).
  // Antes: fallback pra companyIds[0] quando consolidado — mostrava dados
  // aleatorios da 1a empresa da lista.
  // Agora: sem empresa unica valida -> tela vazia + prompt.
  const companyIdAtiva = useMemo<string | null>(() => {
    if (!sel || sel === 'consolidado' || sel.startsWith('group_')) return null
    return sel
  }, [sel])

  const [verExcluidas, setVerExcluidas] = useState(false)
  const [restaurandoId, setRestaurandoId] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    if (!companyIdAtiva) { setOss([]); setLoading(false); return }
    setLoading(true)
    const { data, error } = await supabase
      .from('erp_os')
      .select('id, company_id, numero, cliente_nome, equipamento, placa, modelo, status, data_abertura, total, titulos_gerados, lancamento_id')
      .eq('company_id', companyIdAtiva)
      .eq('excluida', verExcluidas)
      .order('created_at', { ascending: false })
      .limit(200)
    if (error) setErro(error.message)
    // Runtime guard defense-in-depth: dropa qualquer linha divergente
    const safe = ((data ?? []) as OSRow[]).filter((o) => o.company_id === companyIdAtiva)
    setOss(safe)
    setLoading(false)
  }, [companyIdAtiva, verExcluidas])

  const restaurarOS = useCallback(async (o: OSRow) => {
    setRestaurandoId(o.id)
    const { data, error } = await supabase.rpc('fn_os_restaurar', { p_os_id: o.id, p_motivo: null })
    setRestaurandoId(null)
    const r = data as { ok?: boolean; erro?: string } | null
    if (error || r?.ok === false) { setErro(error?.message || r?.erro || 'Falha ao restaurar'); return }
    setOkMsg(`OS ${o.numero ?? ''} RESTAURADA`.trim()); window.setTimeout(() => setOkMsg(null), 3500)
    void carregar()
  }, [carregar])

  useEffect(() => { void carregar() }, [carregar])

  const filtradas = useMemo(() => {
    let r = oss
    if (filtroStatus !== 'todas') r = r.filter((o) => o.status === filtroStatus)
    if (busca.trim()) {
      const b = busca.toLowerCase()
      const bPlaca = b.replace(/[^a-z0-9]/g, '')
      r = r.filter((o) =>
        (o.numero ?? '').toLowerCase().includes(b) ||
        (o.cliente_nome ?? '').toLowerCase().includes(b) ||
        (o.equipamento ?? '').toLowerCase().includes(b) ||
        (o.modelo ?? '').toLowerCase().includes(b) ||
        (bPlaca.length >= 3 && (o.placa ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').includes(bPlaca))
      )
    }
    return r
  }, [oss, filtroStatus, busca])

  const contagens = useMemo(() => {
    const c: Record<string, number> = {}
    STATUS_ORDER.forEach((s) => { c[s] = 0 })
    oss.forEach((o) => { c[o.status] = (c[o.status] ?? 0) + 1 })
    return c
  }, [oss])

  const [osExcluir, setOsExcluir] = useState<OSRow | null>(null)
  const [excluindo, setExcluindo] = useState(false)
  const [erroExcluir, setErroExcluir] = useState<string | null>(null)

  function abrirFichaOS(id: string) {
    setOsAberta(id)
  }

  const faturadaDe = (o: OSRow) => Boolean(o.titulos_gerados) || o.lancamento_id != null

  async function excluirOS(motivo: string) {
    if (!osExcluir) return
    setExcluindo(true)
    setErroExcluir(null)
    const { data, error } = await supabase.rpc('fn_os_excluir', {
      p_os_id: osExcluir.id,
      p_motivo: motivo || null,
    })
    setExcluindo(false)
    if (error) { setErroExcluir(error.message); return }
    const r = data as { ok?: boolean; erro?: string; acao?: string; numero?: string } | null
    if (!r?.ok) { setErroExcluir(r?.erro ?? 'Falha ao excluir OS'); return }
    const num = r.numero ?? osExcluir.numero ?? 'OS'
    setOsExcluir(null)
    setOkMsg(r.acao === 'cancelada' ? `OS ${num} CANCELADA` : `OS ${num} EXCLUÍDA`)
    window.setTimeout(() => setOkMsg(null), 3500)
    void carregar()
  }

  return (
    <div style={{ minHeight: '100vh', background: C.bg, padding: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: C.espresso, display: 'flex', alignItems: 'center', gap: 8 }}>
            🛠 Ordens de Serviço
            <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: C.goldBg, color: C.gold, fontWeight: 700, letterSpacing: 0.5 }}>os-mec-v1</span>
          </div>
          <div style={{ fontSize: 11, color: C.espressoL }}>Abra, preencha e assine a OS direto no celular.</div>
        </div>
        <button
          onClick={() => { setErro(null); setOkMsg(null); setNovoAberto(true) }}
          style={{
            minHeight: 44, padding: '10px 18px', borderRadius: 8,
            background: C.gold, color: C.white, border: 'none',
            fontSize: 13, fontWeight: 700, cursor: 'pointer',
          }}
          data-testid="os-nova"
        >
          + Nova OS
        </button>
      </div>

      {erro && <div className="no-print" style={{ background: C.redBg, color: C.red, padding: '10px 12px', borderRadius: 8, marginBottom: 10, fontSize: 12, fontWeight: 600 }} onClick={() => setErro(null)}>❌ {erro}</div>}
      {okMsg && <div className="no-print" style={{ background: C.greenBg, color: C.green, padding: '10px 12px', borderRadius: 8, marginBottom: 10, fontSize: 12, fontWeight: 600 }} onClick={() => setOkMsg(null)}>✓ {okMsg}</div>}

      {/* Toggle: ativas × excluídas (restaurar) */}
      <div className="no-print" style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <button
          onClick={() => setVerExcluidas((v) => !v)}
          data-testid="os-ver-excluidas"
          style={{ minHeight: 34, padding: '6px 12px', borderRadius: 999, border: `1px solid ${verExcluidas ? C.gold : C.border}`, background: verExcluidas ? C.goldBg : C.white, color: verExcluidas ? C.gold : C.espressoM, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
        >
          {verExcluidas ? '← Voltar às ativas' : '🗑️ Ver excluídas'}
        </button>
      </div>
      {verExcluidas && <div className="no-print" style={{ fontSize: 12, color: C.espressoM, marginBottom: 8 }}>Estas OS foram excluídas (não somem do banco). Toque em <b>Restaurar</b> para trazer de volta.</div>}

      {/* Filtros */}
      <div className="no-print" style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por placa, número, cliente ou veículo…"
          style={inp}
        />
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
          <button
            onClick={() => setFiltroStatus('todas')}
            style={{
              minHeight: 36, padding: '6px 12px', borderRadius: 999,
              border: `1px solid ${filtroStatus === 'todas' ? C.gold : C.border}`,
              background: filtroStatus === 'todas' ? C.goldBg : C.white,
              color: filtroStatus === 'todas' ? C.gold : C.espressoM,
              fontSize: 11, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >Todas ({oss.length})</button>
          {STATUS_ORDER.map((s) => (
            <button
              key={s}
              onClick={() => setFiltroStatus(s)}
              style={{
                minHeight: 36, padding: '6px 12px', borderRadius: 999,
                border: `1px solid ${filtroStatus === s ? STATUS_CFG[s].cor : C.border}`,
                background: filtroStatus === s ? STATUS_CFG[s].bg : C.white,
                color: filtroStatus === s ? STATUS_CFG[s].cor : C.espressoM,
                fontSize: 11, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >{STATUS_CFG[s].label} ({contagens[s] ?? 0})</button>
          ))}
        </div>
      </div>

      {/* Lista */}
      {!companyIdAtiva ? (
        <div style={{ textAlign: 'center', padding: 40, color: C.espressoL, fontSize: 13, background: C.white, borderRadius: 10, border: `1px solid ${C.border}` }}>
          Selecione uma empresa específica no menu superior. Ordens de Serviço são operacionais por empresa — não exibe consolidados.
        </div>
      ) : loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: C.espressoL, fontSize: 13 }}>Carregando…</div>
      ) : filtradas.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: C.espressoL, fontSize: 13, background: C.white, borderRadius: 10, border: `1px solid ${C.border}` }}>
          {oss.length === 0 ? 'Nenhuma OS ainda. Clique em + Nova OS pra começar.' : 'Nenhuma OS com esses filtros.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtradas.map((o) => {
            const modeloTxt = o.modelo || o.equipamento
            return (
            <div
              key={o.id}
              style={{
                position: 'relative', background: C.white, border: `1px solid ${C.border}`,
                borderRadius: 14, boxShadow: '0 1px 2px rgba(61,35,20,0.04)',
              }}
              data-testid="os-row"
            >
              {/* corpo clicável — abre a ficha (editar). paddingRight reserva o canto das ações */}
              <button
                onClick={() => abrirFichaOS(o.id)}
                style={{
                  width: '100%', textAlign: 'left', background: 'transparent', border: 'none',
                  borderRadius: 14, padding: '16px 88px 16px 16px', cursor: 'pointer',
                  display: 'flex', flexDirection: 'column', gap: 7,
                }}
                data-testid="os-abrir-ficha"
              >
                {/* ESTRELA: a placa manda. mono, grande, primeiro. */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  {o.placa ? (
                    <span style={{
                      fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 20, fontWeight: 800,
                      letterSpacing: 1.5, color: C.espresso, background: C.cream,
                      borderRadius: 7, padding: '4px 11px', lineHeight: 1.1,
                    }}>{o.placa}</span>
                  ) : (
                    <span style={{ fontSize: 16, fontWeight: 700, color: C.espresso }}>
                      {modeloTxt ? `🚗 ${modeloTxt}` : (o.numero ?? '—')}
                    </span>
                  )}
                  {o.placa && modeloTxt && (
                    <span style={{ fontSize: 13, color: C.espressoM, fontWeight: 600 }}>🚗 {modeloTxt}</span>
                  )}
                  <StatusBadge status={o.status} />
                </div>

                {/* cliente — coadjuvante, cinza */}
                <div style={{ fontSize: 12.5, color: C.espressoM }}>{o.cliente_nome ?? 'Sem cliente'}</div>

                {/* metadado discreto: nº OS · data · valor */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10.5, color: C.espressoL, flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>{o.numero ?? '—'}</span>
                  <span>·</span>
                  <span>{fmtD(o.data_abertura)}</span>
                  {Number(o.total ?? 0) > 0 && <><span>·</span><span style={{ color: C.green, fontWeight: 600 }}>{fmtBRL(Number(o.total))}</span></>}
                </div>
              </button>

              {/* AÇÕES · canto direito, discretas (nada escondido em menu 3-pontos) */}
              <div style={{ position: 'absolute', top: 12, right: 12, display: 'flex', gap: 6 }}>
                {verExcluidas ? (
                  <button
                    onClick={() => void restaurarOS(o)}
                    disabled={restaurandoId === o.id}
                    style={{ height: 30, padding: '0 11px', borderRadius: 8, border: `1px solid ${C.green}`, background: C.white, color: C.green, fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                    title="Restaurar OS"
                    data-testid="os-restaurar"
                  >
                    ♻️ <span>{restaurandoId === o.id ? 'Restaurando…' : 'Restaurar'}</span>
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() => abrirFichaOS(o.id)}
                      style={{ height: 30, padding: '0 9px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.white, color: C.espressoM, fontSize: 11, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                      title="Editar OS"
                      data-testid="os-editar"
                    >
                      ✏️ <span>Editar</span>
                    </button>
                    <button
                      onClick={() => { setErroExcluir(null); setOsExcluir(o) }}
                      style={{ width: 32, height: 30, borderRadius: 8, border: `1px solid ${C.border}`, background: C.white, color: C.red, fontSize: 13, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                      title={faturadaDe(o) ? 'Cancelar OS (faturada)' : 'Excluir OS'}
                      data-testid="os-excluir"
                    >
                      {faturadaDe(o) ? '🚫' : '🗑️'}
                    </button>
                  </>
                )}
              </div>
            </div>
            )
          })}
        </div>
      )}

      {/* Modal: Nova OS · so abre com empresa unica valida */}
      {novoAberto && companyIdAtiva && (
        <ModalNovaOS
          companyIdAtiva={companyIdAtiva}
          companies={companies}
          onClose={() => setNovoAberto(false)}
          onCriada={(_osId, numero) => {
            // Criar OS = 1 modal, 1 botão, ACABOU (regra de fluxo CEO): fecha o
            // modal, volta pra lista + toast. NÃO abre a ficha completa em
            // sequência (isso dava a sensação de "precisa salvar de novo"). A
            // ficha (orçar/executar/entregar) só abre ao clicar na OS depois.
            setNovoAberto(false)
            setOkMsg(`OS ${numero} criada ✓`)
            window.setTimeout(() => setOkMsg(null), 3500)
            void carregar()
          }}
          onErro={(m) => setErro(m)}
        />
      )}

      {/* Modal: Ficha de OS (reusa OrdemServicoCard) */}
      {osAberta && (
        <div onClick={() => { setOsAberta(null); void carregar() }} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 200, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 12, overflowY: 'auto' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: C.white, borderRadius: 12, width: '100%', maxWidth: 720, padding: 16, marginTop: 12, marginBottom: 12, border: `1px solid ${C.border}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.espresso }}>Ficha de OS</div>
              <button onClick={() => { setOsAberta(null); void carregar() }} style={{ background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 10px', cursor: 'pointer', color: C.espressoM, minHeight: 36 }}>Fechar ✕</button>
            </div>
            <OrdemServicoCard
              osId={osAberta}
              podeExcluir
              onExcluida={(acao, numero) => {
                setOsAberta(null)
                setOkMsg(`OS ${numero ?? ''} ${acao === 'cancelada' ? 'CANCELADA' : 'EXCLUÍDA'}`.trim())
                window.setTimeout(() => setOkMsg(null), 3500)
                void carregar()
              }}
            />
          </div>
        </div>
      )}

      {/* Modal: confirmar exclusão / cancelamento (paleta PS, não confirm()) */}
      {osExcluir && (
        <ConfirmarExclusaoOS
          numero={osExcluir.numero}
          faturada={faturadaDe(osExcluir)}
          busy={excluindo}
          erro={erroExcluir}
          onConfirm={(motivo) => void excluirOS(motivo)}
          onClose={() => { if (!excluindo) { setOsExcluir(null); setErroExcluir(null) } }}
        />
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════
// Modal Nova OS · mobile-first
// ════════════════════════════════════════════════════════════

function ModalNovaOS({
  companyIdAtiva, companies, onClose, onCriada, onErro,
}: {
  companyIdAtiva: string
  companies: { id: string; nome_fantasia?: string | null; razao_social?: string | null }[]
  onClose: () => void
  onCriada: (osId: string, numero: string) => void
  onErro: (m: string) => void
}) {
  const [descricao, setDescricao] = useState('')
  const [veiculo, setVeiculo] = useState('')
  const [placa, setPlaca] = useState('')
  const [defeito, setDefeito] = useState('')
  const [tecnicoNome, setTecnicoNome] = useState('')
  const [prioridade, setPrioridade] = useState('normal')
  const [salvando, setSalvando] = useState(false)
  const [erroLocal, setErroLocal] = useState<string | null>(null)
  // cliente
  const [busca, setBusca] = useState('')
  const [resultados, setResultados] = useState<Cliente[]>([])
  const [cliente, setCliente] = useState<Cliente | null>(null)

  // Pre-fill tecnicoNome com o email do usuario
  useEffect(() => {
    void (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      const nome = user?.user_metadata?.full_name || user?.email || ''
      setTecnicoNome(nome)
    })()
  }, [])

  // Search clientes (debounced)
  useEffect(() => {
    if (cliente) return
    if (busca.trim().length < 2) { setResultados([]); return }
    if (!companyIdAtiva) return
    const orFiltro = orFiltroClienteBusca(busca)
    if (!orFiltro) { setResultados([]); return }
    const t = window.setTimeout(async () => {
      const { data } = await supabase
        .from('erp_clientes')
        .select('id, razao_social, nome_fantasia, cpf_cnpj, company_id')
        .eq('company_id', companyIdAtiva)
        .eq('ativo', true)
        .or(orFiltro)
        .limit(8)
      setResultados((data ?? []) as Cliente[])
    }, 250)
    return () => window.clearTimeout(t)
  }, [busca, companyIdAtiva, cliente])

  async function salvar() {
    setErroLocal(null)
    if (!descricao.trim()) { setErroLocal('Descrição do serviço é obrigatória.'); return }
    if (!companyIdAtiva) { setErroLocal('Selecione uma empresa antes de criar a OS.'); return }
    setSalvando(true)
    const { data: { user } } = await supabase.auth.getUser()
    const { data, error } = await supabase.rpc('fn_os_criar', {
      p_company_id: companyIdAtiva,
      p_descricao_servico: descricao.trim(),
      p_cliente_id: cliente?.id ?? null,
      p_cliente_nome: cliente ? (cliente.nome_fantasia || cliente.razao_social) : null,
      p_cliente_cnpj: cliente?.cpf_cnpj ?? null,
      p_equipamento: veiculo.trim() || null,
      p_defeito_relatado: defeito.trim() || null,
      p_tecnico_id: user?.id ?? null,
      p_tecnico_nome: tecnicoNome.trim() || null,
      p_prioridade: prioridade,
      p_placa: placa.trim() || null,
      p_modelo: veiculo.trim() || null,
    })
    setSalvando(false)
    if (error) { setErroLocal('Erro: ' + error.message); return }
    const r = data as { ok?: boolean; erro?: string; os_id?: string; numero?: string } | null
    if (!r?.ok) {
      const msg = r?.erro ?? 'Falha ao criar OS'
      setErroLocal(msg)
      onErro(msg)
      return
    }
    // placa/modelo já foram gravados atomicamente pelo fn_os_criar (p_placa/p_modelo).
    onCriada(r.os_id as string, r.numero as string)
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 210, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 12, overflowY: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.white, borderRadius: 12, width: '100%', maxWidth: 540, padding: 16, marginTop: 12, marginBottom: 12, border: `1px solid ${C.border}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.espresso }}>Nova OS</div>
          <button onClick={onClose} style={{ background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 10px', cursor: 'pointer', color: C.espressoM, minHeight: 36 }}>Fechar ✕</button>
        </div>

        {companies.length > 1 && companyIdAtiva && (
          <div style={{ background: C.cream, borderRadius: 8, padding: 8, marginBottom: 10, fontSize: 11, color: C.espressoM }}>
            Empresa: <strong style={{ color: C.espresso }}>{companies.find((c) => c.id === companyIdAtiva)?.nome_fantasia || companies.find((c) => c.id === companyIdAtiva)?.razao_social || '—'}</strong>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={lbl}>Descrição do serviço *</label>
            <textarea
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="Ex.: Troca de pastilhas dianteiras"
              style={{ ...inp, minHeight: 70, resize: 'vertical' }}
              data-testid="os-nova-descricao"
            />
          </div>

          <div>
            <label style={lbl}>Cliente (opcional)</label>
            {cliente ? (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: 10, background: C.cream, borderRadius: 8 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.espresso }}>{cliente.nome_fantasia || cliente.razao_social}</div>
                  {cliente.cpf_cnpj && <div style={{ fontSize: 10, color: C.espressoL, fontFamily: 'monospace' }}>{cliente.cpf_cnpj}</div>}
                </div>
                <button onClick={() => { setCliente(null); setBusca('') }} style={{ background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 10px', cursor: 'pointer', color: C.espressoM, fontSize: 11, minHeight: 36 }}>Trocar</button>
              </div>
            ) : (
              <>
                <input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar cliente por nome ou CNPJ (ou deixar sem cliente)"
                  style={inp}
                />
                {resultados.length > 0 && (
                  <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 8, marginTop: 4, maxHeight: 200, overflowY: 'auto' }}>
                    {resultados.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => { setCliente(c); setResultados([]) }}
                        style={{ width: '100%', textAlign: 'left', background: 'transparent', border: 'none', borderBottom: `1px solid ${C.border}`, padding: 10, cursor: 'pointer', minHeight: 44 }}
                      >
                        <div style={{ fontSize: 13, fontWeight: 500, color: C.espresso }}>{c.nome_fantasia || c.razao_social}</div>
                        {c.cpf_cnpj && <div style={{ fontSize: 10, color: C.espressoL, fontFamily: 'monospace' }}>{c.cpf_cnpj}</div>}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr', gap: 8 }}>
            <div>
              <label style={lbl}>Placa</label>
              <input
                value={placa}
                onChange={(e) => setPlaca(e.target.value.toUpperCase())}
                placeholder="ABC-1234"
                maxLength={8}
                style={{ ...inp, fontFamily: 'ui-monospace, Menlo, monospace', fontWeight: 700, letterSpacing: 1 }}
                data-testid="os-nova-placa"
              />
            </div>
            <div>
              <label style={lbl}>Modelo / veículo (opcional)</label>
              <input
                value={veiculo}
                onChange={(e) => setVeiculo(e.target.value)}
                placeholder="Ex.: VW Gol 2015"
                style={inp}
                data-testid="os-nova-veiculo"
              />
            </div>
          </div>

          <div>
            <label style={lbl}>Defeito relatado (opcional)</label>
            <textarea
              value={defeito}
              onChange={(e) => setDefeito(e.target.value)}
              placeholder="O que o cliente relatou"
              style={{ ...inp, minHeight: 60, resize: 'vertical' }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={lbl}>Mecânico</label>
              <input
                value={tecnicoNome}
                onChange={(e) => setTecnicoNome(e.target.value)}
                placeholder="Seu nome"
                style={inp}
              />
            </div>
            <div>
              <label style={lbl}>Prioridade</label>
              <select value={prioridade} onChange={(e) => setPrioridade(e.target.value)} style={{ ...inp, cursor: 'pointer' }}>
                <option value="baixa">Baixa</option>
                <option value="normal">Normal</option>
                <option value="alta">Alta</option>
                <option value="urgente">Urgente</option>
              </select>
            </div>
          </div>

          {erroLocal && <div style={{ background: C.redBg, color: C.red, padding: '10px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600 }}>❌ {erroLocal}</div>}

          <button
            onClick={salvar}
            disabled={salvando || !descricao.trim()}
            style={{
              minHeight: 48, padding: '12px 18px', borderRadius: 10,
              background: salvando || !descricao.trim() ? C.cream : C.gold,
              color: salvando || !descricao.trim() ? C.espressoL : C.white,
              border: 'none', fontSize: 14, fontWeight: 700,
              cursor: salvando || !descricao.trim() ? 'not-allowed' : 'pointer',
            }}
            data-testid="os-nova-salvar"
          >
            {salvando ? 'Criando…' : 'Criar OS'}
          </button>
        </div>
      </div>
    </div>
  )
}
