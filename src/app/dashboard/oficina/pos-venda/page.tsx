'use client'
// OFICINA · PÓS-VENDA (contagem regressiva) + CENTRAL DE MENSAGENS. Mobile-first.
// Mostra QUANTOS DIAS FALTAM para cada veículo entrar no pós-venda (janela configurável, default 90).
// A KGF é nova: hoje ninguém passou dos 90 dias — o painel mostra a FILA SE FORMANDO. Serve desde o 1º dia.
// "Chamar" abre o wa.me com uma mensagem CONVITE (nunca "revisão venceu") e registra o contato (Entrega C).
// 🚫 SEM cifrão em lugar nenhum — a RPC (fn_oficina_pos_venda_fila) não devolve valor (R4).
import React, { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft, BellRing, Phone, PhoneOff, Clock, MessageCircle } from 'lucide-react'
import { supabase } from '@/lib/supabase'

const ESP = '#3D2314'; const BG = '#FAF7F2'; const GOLD = '#C8941A'; const LINE = '#E7DECF'; const ESP60 = 'rgba(61,35,20,0.55)'
const OK = '#166534'; const RED = '#A32D2D'
const LIMITE_BREVE = 60 // "entram em breve" = faltam ≤ ~2 meses (mostra a fila próxima de se formar)
const nf = new Intl.NumberFormat('pt-BR')
const fmtKm = (k: number | null) => k == null ? '—' : `${nf.format(k)} km`
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const CONTATO_LABEL: Record<string, string> = { enviado: 'mensagem enviada', respondeu: 'respondeu', agendou: 'agendou retorno', recusou: 'não quis', sem_resposta: 'sem resposta' }

type Linha = {
  placa: string; veiculo: string | null; cliente_nome: string | null; cliente_id: string | null
  ultima_visita: string | null; ultimo_km: number | null; visitas: number; ultimo_servico: string | null
  dias_desde: number; dias_faltantes: number; tem_telefone: boolean | null; aceita_pos_venda: boolean | null
  contato_status: string | null; situacao: string
}

function useCompanyId(): string | null {
  const [id, setId] = useState<string | null>(null)
  useEffect(() => {
    const read = () => {
      if (typeof window === 'undefined') return null
      const v = localStorage.getItem('ps_empresa_sel')
      if (!v || v === 'consolidado' || v.startsWith('group_')) return null
      return v
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setId(read())
    const t = setInterval(() => { const v = read(); setId((p) => (p === v ? p : v)) }, 800)
    return () => clearInterval(t)
  }, [])
  return id
}

// Constrói a mensagem CONVITE (RD-42 · wa.me). Diz o que SABEMOS (passou em X, com Y km), nunca o que supomos.
function montarMensagem(l: Linha): string {
  const nome = (l.cliente_nome || '').trim().split(/\s+/)[0] || 'tudo bem'
  const mes = l.ultima_visita ? MESES[new Date(l.ultima_visita + 'T00:00:00').getMonth()] : null
  const veic = l.veiculo || 'veículo'
  const serv = l.ultimo_servico ? ` pra ${l.ultimo_servico.toLowerCase()}` : ''
  const km = l.ultimo_km ? `, com ${nf.format(l.ultimo_km)} km` : ''
  const quando = mes ? ` em ${mes}` : ''
  return `Oi ${nome}! Aqui é da oficina.\n\nSeu ${veic} passou aqui${quando}${serv}${km}. Já faz um tempinho — se quiser que a gente dê uma olhada, é só chamar.\n\nQualquer coisa, tô por aqui!`
}

export default function PosVendaPage() {
  const companyId = useCompanyId()
  const router = useRouter()
  const [lista, setLista] = useState<Linha[]>([])
  const [carregando, setCarregando] = useState(true)
  const [msg, setMsg] = useState<string | null>(null)
  const [salvandoJanela, setSalvandoJanela] = useState(false)
  const [chamandoPlaca, setChamandoPlaca] = useState<string | null>(null)
  const [desfechoDe, setDesfechoDe] = useState<{ placa: string; contatoId: string } | null>(null)

  const carregar = useCallback(async () => {
    if (!companyId) return
    setCarregando(true)
    const { data } = await supabase.rpc('fn_oficina_pos_venda_fila', { p_company_id: companyId, p_janela_dias: null })
    setLista((data as Linha[]) ?? [])
    setCarregando(false)
  }, [companyId])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(null), 4000); return () => clearTimeout(t) }, [msg])

  const janela = lista.length ? (lista[0].dias_desde + lista[0].dias_faltantes) : 90
  const aContatar = lista.filter((l) => l.dias_faltantes <= 0)
  const emBreve = lista.filter((l) => l.dias_faltantes > 0 && l.dias_faltantes <= LIMITE_BREVE)
  const acompanhando = lista.filter((l) => l.dias_faltantes > LIMITE_BREVE)
  const primeiro = lista.find((l) => l.dias_faltantes > 0)

  const setJanela = async (dias: number) => {
    if (!companyId || salvandoJanela || dias === janela) return
    setSalvandoJanela(true); setMsg(null)
    const { data, error } = await supabase.rpc('fn_oficina_pos_venda_janela_set', { p_company_id: companyId, p_dias: dias })
    setSalvandoJanela(false)
    const r = data as { ok?: boolean; mensagem?: string } | null
    if (error || !r?.ok) { setMsg(r?.mensagem || error?.message || 'Não foi possível ajustar a janela.'); return }
    void carregar()
  }

  const chamar = async (l: Linha) => {
    if (!companyId || chamandoPlaca) return
    setChamandoPlaca(l.placa); setMsg(null)
    // O telefone NÃO vem na fila (R4). Buscamos aqui só p/ montar o link (fn de A).
    const { data: cont } = await supabase.rpc('fn_oficina_cliente_contato_obter', { p_company_id: companyId, p_cliente_id: l.cliente_id })
    const tel = ((cont as { whatsapp?: string | null } | null)?.whatsapp || '').replace(/\D/g, '')
    const full = tel.length > 0 && tel.length <= 11 ? '55' + tel : tel
    const texto = montarMensagem(l)
    const { data: reg } = await supabase.rpc('fn_oficina_contato_registrar', {
      p_company_id: companyId, p_placa: l.placa, p_tipo: 'pos_venda', p_canal: 'whatsapp', p_mensagem: texto, p_cliente_id: l.cliente_id,
    })
    setChamandoPlaca(null)
    const url = full.length >= 12 ? `https://wa.me/${full}?text=${encodeURIComponent(texto)}` : `https://wa.me/?text=${encodeURIComponent(texto)}`
    if (typeof window !== 'undefined') window.open(url, '_blank')
    const r = reg as { ok?: boolean; contato_id?: string } | null
    if (r?.ok && r.contato_id) setDesfechoDe({ placa: l.placa, contatoId: r.contato_id })
  }

  const marcarDesfecho = async (contatoId: string, resultado: string) => {
    if (!companyId) return
    let agendado: string | null = null
    if (resultado === 'agendou') {
      const d = typeof window !== 'undefined' ? window.prompt('Data do retorno agendado (AAAA-MM-DD):') : null
      if (!d) return
      agendado = d
    }
    const { data } = await supabase.rpc('fn_oficina_contato_desfecho', { p_company_id: companyId, p_contato_id: contatoId, p_resultado: resultado, p_agendado_para: agendado })
    const r = data as { ok?: boolean } | null
    if (r?.ok) { setDesfechoDe(null); setMsg('Contato registrado.'); void carregar() }
    else setMsg('Não consegui registrar o desfecho.')
  }

  if (!companyId) return <div style={{ padding: 24, color: ESP60, background: BG, minHeight: '100vh' }}>Selecione uma empresa específica no topo para abrir o Pós-venda.</div>

  const cardProps = (l: Linha) => ({
    l, janela, chamando: chamandoPlaca === l.placa,
    desfechoContatoId: desfechoDe?.placa === l.placa ? desfechoDe.contatoId : null,
    onChamar: () => void chamar(l),
    onDesfecho: (res: string) => void marcarDesfecho(desfechoDe?.placa === l.placa ? desfechoDe.contatoId : '', res),
  })

  return (
    <div style={{ background: BG, minHeight: '100vh', color: ESP }}>
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '16px 14px 40px' }}>
        <button onClick={() => router.push('/dashboard/oficina')} style={linkBtn}><ChevronLeft size={16} /> Oficina</button>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700, marginTop: 6 }}>🔧 Oficina · Pós-venda</div>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: '2px 0 4px', display: 'flex', alignItems: 'center', gap: 8 }}><BellRing size={22} /> Pós-venda</h1>
        <div style={{ fontSize: 13, color: ESP60, marginBottom: 12 }}>
          {carregando ? 'Carregando…' : `${lista.length} veículo(s) acompanhado(s) · janela de ${janela} dias`}
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: ESP60 }}>Contato após:</span>
          {[60, 90, 120].map((d) => (
            <button key={d} onClick={() => void setJanela(d)} disabled={salvandoJanela}
              style={{ ...chip, background: d === janela ? ESP : '#fff', color: d === janela ? '#fff' : ESP, cursor: salvandoJanela ? 'wait' : 'pointer' }}>
              {d} dias
            </button>
          ))}
        </div>

        {!carregando && lista.length === 0 && (
          <div style={{ color: ESP60, fontSize: 14, padding: '20px 0' }}>Nenhum veículo com histórico ainda.</div>
        )}

        {!carregando && lista.length > 0 && (
          <>
            <Grupo titulo={`A contatar agora (${aContatar.length})`}>
              {aContatar.length === 0
                ? <div style={{ fontSize: 13, color: ESP60, padding: '2px 2px 6px' }}>
                    Nenhum ainda{primeiro ? ` — o primeiro entra em ${primeiro.dias_faltantes} dias.` : '.'}
                  </div>
                : aContatar.map((l) => <Card key={l.placa} {...cardProps(l)} />)}
            </Grupo>

            {emBreve.length > 0 && (
              <Grupo titulo={`Entram em breve (${emBreve.length})`} sub="próximos ~2 meses">
                {emBreve.map((l) => <Card key={l.placa} {...cardProps(l)} />)}
              </Grupo>
            )}

            {acompanhando.length > 0 && (
              <Grupo titulo={`Acompanhando (${acompanhando.length})`}>
                {acompanhando.map((l) => <Card key={l.placa} {...cardProps(l)} />)}
              </Grupo>
            )}
          </>
        )}
      </div>

      {msg && <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: ESP, color: '#fff', padding: '10px 16px', borderRadius: 999, fontSize: 13, zIndex: 70, maxWidth: '92%', textAlign: 'center' }}>{msg}</div>}
    </div>
  )
}

function Card({ l, janela, chamando, desfechoContatoId, onChamar, onDesfecho }: {
  l: Linha; janela: number; chamando: boolean; desfechoContatoId: string | null
  onChamar: () => void; onDesfecho: (resultado: string) => void
}) {
  const pct = Math.max(0, Math.min(100, Math.round((l.dias_desde / Math.max(1, janela)) * 100)))
  const aContatar = l.dias_faltantes <= 0
  const temTel = l.tem_telefone === true
  const recusou = l.aceita_pos_venda === false
  const jaContatado = !!l.contato_status
  return (
    <div style={{ border: `1px solid ${LINE}`, borderRadius: 12, padding: 14, marginBottom: 10, background: '#fff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span style={{ fontWeight: 700, fontSize: 16, letterSpacing: 1 }}>{l.placa}</span>
        <span style={{ fontSize: 11, color: ESP60 }}>{l.visitas} passagem(ns) · {fmtKm(l.ultimo_km)}</span>
      </div>
      <div style={{ fontSize: 13, color: ESP, marginTop: 2 }}>{l.veiculo || '—'}{l.cliente_nome ? ` · ${l.cliente_nome}` : ''}</div>
      <div style={{ fontSize: 12, color: ESP60, marginTop: 3 }}>última: {l.ultimo_servico || '—'} · há {l.dias_desde} dias</div>

      <div style={{ background: '#F0EADE', borderRadius: 6, height: 8, overflow: 'hidden', marginTop: 10 }}>
        <div style={{ width: `${pct}%`, height: '100%', background: aContatar ? OK : GOLD }} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        {aContatar
          ? <span style={{ fontSize: 12.5, fontWeight: 700, color: OK, display: 'inline-flex', alignItems: 'center', gap: 4 }}><BellRing size={13} /> já pode contatar</span>
          : <span style={{ fontSize: 12.5, fontWeight: 600, color: ESP, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Clock size={13} /> faltam {l.dias_faltantes} dias</span>}
        {temTel
          ? <span style={{ fontSize: 11.5, fontWeight: 700, color: OK, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Phone size={12} /> tem WhatsApp</span>
          : <span style={{ fontSize: 11.5, fontWeight: 700, color: GOLD, display: 'inline-flex', alignItems: 'center', gap: 4 }}><PhoneOff size={12} /> sem telefone</span>}
      </div>

      {jaContatado && !desfechoContatoId && (
        <div style={{ fontSize: 11.5, color: ESP60, marginTop: 8 }}>✓ {CONTATO_LABEL[l.contato_status ?? ''] ?? l.contato_status}</div>
      )}

      {/* Ações de contato (Entrega C) */}
      {recusou ? (
        <div style={{ fontSize: 11.5, color: ESP60, marginTop: 10, fontStyle: 'italic' }}>Cliente pediu para não receber contato de pós-venda.</div>
      ) : desfechoContatoId ? (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 11, color: ESP60, marginBottom: 6 }}>Como foi o contato?</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {[['respondeu', 'Respondeu'], ['agendou', 'Agendou'], ['sem_resposta', 'Sem resposta'], ['recusou', 'Não quer']].map(([v, lb]) => (
              <button key={v} onClick={() => onDesfecho(v)}
                style={{ ...chipSm, borderColor: v === 'recusou' ? RED : LINE, color: v === 'recusou' ? RED : ESP }}>{lb}</button>
            ))}
          </div>
        </div>
      ) : temTel ? (
        <button onClick={onChamar} disabled={chamando}
          style={{ marginTop: 10, width: '100%', minHeight: 42, borderRadius: 10, border: 'none', background: '#25D366', color: '#0b3d1f', fontWeight: 800, fontSize: 13.5, cursor: chamando ? 'wait' : 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <MessageCircle size={16} /> {chamando ? 'Abrindo…' : 'Chamar no WhatsApp'}
        </button>
      ) : (
        <div style={{ fontSize: 11.5, color: GOLD, marginTop: 10 }}>Sem WhatsApp no cadastro — pegue na próxima passada pela recepção.</div>
      )}
    </div>
  )
}

function Grupo({ titulo, sub, children }: { titulo: string; sub?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: ESP60, fontWeight: 700, marginBottom: 8 }}>
        {titulo}{sub ? <span style={{ textTransform: 'none', fontWeight: 400, marginLeft: 6 }}>· {sub}</span> : null}
      </div>
      {children}
    </div>
  )
}

const chip: CSSProperties = { border: `1px solid ${LINE}`, borderRadius: 999, padding: '6px 14px', fontSize: 12.5, fontWeight: 700 }
const chipSm: CSSProperties = { border: `1px solid ${LINE}`, borderRadius: 999, padding: '6px 12px', fontSize: 12, fontWeight: 700, background: '#fff', cursor: 'pointer' }
const linkBtn: CSSProperties = { background: 'none', border: 'none', color: ESP60, fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', padding: 0 }
