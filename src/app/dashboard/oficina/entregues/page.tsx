'use client'

// RD-41 · Oficina — Veículos/serviços ENTREGUES (histórico operacional). Genérica:
// mecânica/elétrica/tornearia (placa/veículo opcionais). Custo real do snapshot [→GE];
// receita/lucro seguem a regra honesta ("aguardando faturamento"). Números por company_id.
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { supabase } from '@/lib/supabase'
import { PackageCheck, Search, ChevronRight, RefreshCw } from 'lucide-react'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF', ESP60 = 'rgba(61,35,20,0.6)', ESP40 = 'rgba(61,35,20,0.45)', WHITE = '#FFFFFF', OK = '#166534'
const brl = (v: number | null | undefined) => v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const fmtDataHora = (iso: string | null) => iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'
const isoDaysAgo = (d: number) => { const t = new Date(); t.setDate(t.getDate() - d); return t.toISOString().slice(0, 10) }

type Linha = {
  os_id: string; numero: string | null; entregue_em: string | null; cliente_nome: string | null
  placa: string | null; veiculo: string | null; servico: string | null; mecanico: string | null
  custo_pecas: number; custo_mo: number; receita: number | null; lucro: number | null; aguardando: boolean
}
type Totais = { qtd: number; custo_total: number; custo_pecas: number; custo_mo: number; receita: number | null; lucro: number | null; qtd_aguardando: number }
// "Dinheiro esquecido" · OS entregues NÃO faturadas por idade (fn_oficina_a_faturar)
type AFaturarLinha = { os_id: string; numero: string | null; cliente_nome: string | null; placa: string | null; entregue_em: string | null; total: number; dias: number }
type AFaturarTotais = { qtd: number; soma_total: number; mais_antiga_dias: number; sem_valor: number }
// #20 Fase 3b · OS entregues SEM nota fiscal (nem NFS-e nem NF-e) — onde a obrigação fiscal parou
type SemNotaLinha = { os_id: string; numero: string | null; cliente_nome: string | null; total: number | null; entregue_em: string | null; dias: number; faturada: boolean; tem_servico: boolean; tem_peca: boolean }

export default function EntreguesPage() {
  const router = useRouter()
  const { companyIds } = useCompanyIds()
  const companyId = companyIds.length === 1 ? companyIds[0] : null
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [totais, setTotais] = useState<Totais | null>(null)
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [dataIni, setDataIni] = useState(isoDaysAgo(30))
  const [dataFim, setDataFim] = useState(isoDaysAgo(0))
  const [busca, setBusca] = useState('')
  // modo: histórico por período OU "a faturar" (entregues não faturadas por idade — dinheiro esquecido)
  const [modo, setModo] = useState<'historico' | 'afaturar' | 'semnota'>('historico')
  const [afLinhas, setAfLinhas] = useState<AFaturarLinha[]>([])
  const [afTotais, setAfTotais] = useState<AFaturarTotais | null>(null)
  const [snLinhas, setSnLinhas] = useState<SemNotaLinha[]>([])
  const [snTotais, setSnTotais] = useState<{ qtd: number; total_parado: number } | null>(null)

  const carregar = useCallback(async () => {
    if (!companyId) return
    setLoading(true); setErro(null)
    if (modo === 'afaturar') {
      const { data, error } = await supabase.rpc('fn_oficina_a_faturar', { p_company_id: companyId })
      setLoading(false)
      const r = data as { ok?: boolean; erro?: string; linhas?: AFaturarLinha[]; totais?: AFaturarTotais } | null
      if (error || !r?.ok) { setErro(error?.message || r?.erro || 'Falha ao carregar'); return }
      setAfLinhas(r.linhas ?? []); setAfTotais(r.totais ?? null)
      return
    }
    if (modo === 'semnota') {
      const { data, error } = await supabase.rpc('fn_os_entregue_sem_nota', { p_company_id: companyId })
      setLoading(false)
      const r = data as { ok?: boolean; erro?: string; itens?: SemNotaLinha[]; total_parado?: number; qtd?: number } | null
      if (error || !r?.ok) { setErro(error?.message || r?.erro || 'Falha ao carregar'); return }
      setSnLinhas(r.itens ?? []); setSnTotais({ qtd: r.qtd ?? 0, total_parado: r.total_parado ?? 0 })
      return
    }
    const { data, error } = await supabase.rpc('fn_oficina_entregues_listar', {
      p_company_id: companyId, p_data_ini: dataIni || null, p_data_fim: dataFim || null, p_busca: busca.trim() || null,
    })
    setLoading(false)
    const r = data as { ok?: boolean; erro?: string; linhas?: Linha[]; totais?: Totais } | null
    if (error || !r?.ok) { setErro(error?.message || r?.erro || 'Falha ao carregar'); return }
    setLinhas(r.linhas ?? []); setTotais(r.totais ?? null)
  }, [companyId, dataIni, dataFim, busca, modo])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])

  if (!companyId) return <div style={{ padding: 24, color: ESP60, background: BG, minHeight: '100vh' }}>Selecione uma empresa específica no topo para ver as entregas.</div>

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '20px 14px 44px', maxWidth: 900, margin: '0 auto', color: ESP }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <div>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700 }}>🔧 Oficina</div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: '2px 0 0', display: 'inline-flex', alignItems: 'center', gap: 8 }}><PackageCheck size={22} color={GOLD} /> Veículos entregues</h1>
        </div>
        <button onClick={() => void carregar()} title="Atualizar" style={{ background: WHITE, border: `1px solid ${LINE}`, borderRadius: 8, padding: 9, cursor: 'pointer', color: ESP60 }}><RefreshCw size={16} /></button>
      </div>
      <p style={{ color: ESP60, fontSize: 13, marginTop: 6, marginBottom: 12 }}>Histórico do que já saiu. Custos são reais; receita/lucro aguardam o faturamento pela OS.</p>

      {/* Modo: histórico por período · a faturar (não faturadas por idade — dinheiro esquecido) */}
      <div style={{ display: 'inline-flex', gap: 4, marginBottom: 12, background: WHITE, border: `1px solid ${LINE}`, borderRadius: 10, padding: 4 }}>
        <button onClick={() => setModo('historico')} style={segBtn(modo === 'historico')}>Histórico</button>
        <button onClick={() => setModo('afaturar')} style={segBtn(modo === 'afaturar')}>💰 A faturar</button>
        <button onClick={() => setModo('semnota')} style={segBtn(modo === 'semnota')}>🧾 Sem nota</button>
      </div>

      {/* Filtros (só no histórico por período) */}
      {modo === 'historico' && (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, marginBottom: 14 }}>
        <label style={{ display: 'block' }}><span style={lbl}>De (entrega)</span><input type="date" value={dataIni} onChange={(e) => setDataIni(e.target.value)} style={inp} /></label>
        <label style={{ display: 'block' }}><span style={lbl}>Até</span><input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} style={inp} /></label>
        <label style={{ display: 'block', gridColumn: 'span 2' }}><span style={lbl}>Buscar</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, border: `1px solid ${LINE}`, borderRadius: 8, background: WHITE, padding: '0 10px' }}>
            <Search size={15} color={ESP40} />
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="placa · cliente · nº da OS" style={{ ...inp, border: 'none', padding: '9px 0' }} />
          </span>
        </label>
      </div>
      )}

      {/* Totais do período */}
      {modo === 'historico' && totais && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 14 }}>
          <Tot l="Entregas no período" v={String(totais.qtd)} />
          <Tot l="Custo total (peças+MO)" v={brl(totais.custo_total)} />
          <Tot l="Receita" v={totais.receita == null ? 'aguardando' : brl(totais.receita)} small={totais.receita == null} />
          <Tot l="Lucro" v={totais.lucro == null ? 'aguardando' : brl(totais.lucro)} small={totais.lucro == null} />
        </div>
      )}

      {erro && <div style={{ background: '#FCEBEB', color: '#791F1F', padding: '8px 12px', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>{erro}</div>}

      {loading ? (
        <div style={{ color: ESP60, fontSize: 13, padding: 20, textAlign: 'center' }}>Carregando…</div>
      ) : modo === 'afaturar' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {afTotais && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
              <Tot l="OS a faturar" v={String(afTotais.qtd)} />
              <Tot l="Valor parado" v={brl(afTotais.soma_total)} />
              <Tot l="Mais antiga" v={`${afTotais.mais_antiga_dias} dia(s)`} />
              <Tot l="Sem valor lançado" v={String(afTotais.sem_valor)} small={afTotais.sem_valor > 0} />
            </div>
          )}
          <p style={{ fontSize: 12, color: ESP60, margin: 0 }}>
            Entregues e ainda não faturadas, da mais antiga para a mais nova. Pode ser serviço prestado que ainda não foi cobrado.
          </p>
          {afLinhas.length === 0 ? (
            <div style={{ background: WHITE, border: `1px solid ${LINE}`, borderRadius: 12, padding: '30px 16px', textAlign: 'center', color: ESP60 }}>Nada a faturar — tudo que foi entregue já foi faturado. 🎉</div>
          ) : afLinhas.map((l) => (
            <div key={l.os_id} style={{ background: WHITE, border: `1px solid ${LINE}`, borderRadius: 10, padding: '12px 14px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 240px', minWidth: 0 }}>
                <div style={{ fontSize: 11, color: l.dias >= 30 ? '#B45309' : ESP60, fontWeight: 700 }}>⏳ {l.dias} dia(s) parada · entregue {fmtDataHora(l.entregue_em)}</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: ESP, marginTop: 2 }}>{l.placa || l.numero || '—'}</div>
                <div style={{ fontSize: 12, color: ESP60, overflow: 'hidden', textOverflow: 'ellipsis' }}>{[l.numero, l.cliente_nome || 'sem cliente'].filter(Boolean).join(' · ')}</div>
              </div>
              <div style={{ textAlign: 'right', minWidth: 130 }}>
                <div style={{ fontSize: 10, color: ESP40, textTransform: 'uppercase', letterSpacing: 0.3, fontWeight: 600 }}>Valor da OS</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: l.total > 0 ? ESP : '#B45309', fontVariantNumeric: 'tabular-nums' }}>{l.total > 0 ? brl(l.total) : 'sem valor'}</div>
              </div>
              <button onClick={() => router.push(`/dashboard/os?os=${l.os_id}`)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '9px 12px', borderRadius: 8, border: `1px solid ${LINE}`, background: BG, color: ESP, fontWeight: 700, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                Abrir OS <ChevronRight size={14} />
              </button>
            </div>
          ))}
        </div>
      ) : modo === 'semnota' ? (
        (() => {
          // §8.2 · dois problemas diferentes, pessoas diferentes:
          //  · SEM TÍTULO (não faturada) = cobrança que não existe → financeiro/cobrança.
          //  · SEM NOTA (faturada, sem documento fiscal) = obrigação fiscal pendente → fiscal.
          const semTitulo = snLinhas.filter((l) => !l.faturada)
          const semNota = snLinhas.filter((l) => l.faturada)
          const soma = (arr: SemNotaLinha[]) => arr.reduce((a, l) => a + (l.total ?? 0), 0)
          const abrir = (id: string) => router.push(`/dashboard/os?os=${id}`)
          const Secao = ({ titulo, sub, cor, corBg, linhas }: { titulo: string; sub: string; cor: string; corBg: string; linhas: SemNotaLinha[] }) => (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ background: corBg, borderRadius: 10, padding: '10px 12px' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: cor }}>{titulo} · {linhas.length}</div>
                <div style={{ fontSize: 11.5, color: cor, opacity: 0.9 }}>{sub}</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: cor, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>{brl(soma(linhas))}</div>
              </div>
              {linhas.length === 0
                ? <div style={{ fontSize: 12, color: ESP60, fontStyle: 'italic', padding: '2px 4px' }}>Nada aqui. 🎉</div>
                : linhas.map((l) => <SemNotaRow key={l.os_id} l={l} onOpen={() => abrir(l.os_id)} />)}
            </div>
          )
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <p style={{ fontSize: 12, color: ESP60, margin: 0 }}>
                Entregues sem nota fiscal, da mais antiga para a mais nova. A entrega não trava por causa da nota — mas são <b>dois problemas diferentes</b>: sem título é cobrança que não existe; sem nota (já faturada) é obrigação fiscal pendente. Abra a OS para resolver.
              </p>
              {snLinhas.length === 0
                ? <div style={{ background: WHITE, border: `1px solid ${LINE}`, borderRadius: 12, padding: '30px 16px', textAlign: 'center', color: ESP60 }}>Tudo que foi entregue tem nota. 🎉</div>
                : <>
                    <Secao titulo="🏷️ Sem título" sub="Entregue e não faturada — cobrança que não existe (financeiro)." cor="#8A4B08" corBg="#FAEEDA" linhas={semTitulo} />
                    <Secao titulo="🧾 Sem nota fiscal" sub="Faturada, mas sem documento fiscal — obrigação pendente (fiscal)." cor="#791F1F" corBg="#FCEBEB" linhas={semNota} />
                  </>}
            </div>
          )
        })()
      ) : linhas.length === 0 ? (
        <div style={{ background: WHITE, border: `1px solid ${LINE}`, borderRadius: 12, padding: '30px 16px', textAlign: 'center', color: ESP60 }}>Nenhuma entrega no período.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {linhas.map((l) => {
            const ident = l.placa || l.veiculo || l.servico || '—'   // genérico: placa > veículo > serviço
            return (
              <div key={l.os_id} style={{ background: WHITE, border: `1px solid ${LINE}`, borderRadius: 10, padding: '12px 14px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 240px', minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: OK, fontWeight: 700 }}>🚗 Entregue · {fmtDataHora(l.entregue_em)}</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: ESP, marginTop: 2 }}>{ident}</div>
                  <div style={{ fontSize: 12, color: ESP60, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {[l.cliente_nome || '—', l.placa && l.veiculo ? l.veiculo : null, l.servico && l.servico !== ident ? l.servico : null].filter(Boolean).join(' · ')}
                    {l.mecanico ? ` · 🔧 ${l.mecanico}` : ''}
                  </div>
                </div>
                <div style={{ textAlign: 'right', minWidth: 130 }}>
                  <div style={{ fontSize: 10, color: ESP40, textTransform: 'uppercase', letterSpacing: 0.3, fontWeight: 600 }}>Custo (peças+MO)</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: ESP, fontVariantNumeric: 'tabular-nums' }}>{brl(l.custo_pecas + l.custo_mo)}</div>
                  <div style={{ fontSize: 10.5, color: l.aguardando ? '#1D4671' : ESP60, marginTop: 1 }}>
                    {l.aguardando ? 'receita/lucro aguardando' : `lucro ${brl(l.lucro)}`}
                  </div>
                </div>
                <button onClick={() => router.push(`/dashboard/os?os=${l.os_id}`)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '9px 12px', borderRadius: 8, border: `1px solid ${LINE}`, background: BG, color: ESP, fontWeight: 700, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  Abrir OS <ChevronRight size={14} />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

const inp: React.CSSProperties = { width: '100%', padding: '9px 11px', fontSize: 13, borderRadius: 8, border: `1px solid ${LINE}`, background: WHITE, color: ESP, boxSizing: 'border-box' }
const lbl: React.CSSProperties = { fontSize: 11, color: ESP60, display: 'block', marginBottom: 3 }
const segBtn = (ativo: boolean): React.CSSProperties => ({ padding: '7px 14px', fontSize: 12.5, fontWeight: 700, borderRadius: 8, border: 'none', cursor: 'pointer', background: ativo ? GOLD : 'transparent', color: ativo ? WHITE : ESP60 })
const faltaTag: React.CSSProperties = { fontSize: 10.5, fontWeight: 700, padding: '2px 7px', borderRadius: 999, background: '#FCEBEB', color: '#791F1F' }
function Tot({ l, v, small }: { l: string; v: string; small?: boolean }) {
  return (
    <div style={{ background: WHITE, border: `1px solid ${LINE}`, borderRadius: 10, padding: 12 }}>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: ESP40, fontWeight: 600 }}>{l}</div>
      <div style={{ fontSize: small ? 14 : 18, fontWeight: 700, color: small ? '#1D4671' : ESP, marginTop: 3, lineHeight: 1.2 }}>{v}</div>
    </div>
  )
}
// #20 Fase 3b · uma linha da fila "entregue sem nota" (reusada nos dois grupos: sem título × sem nota).
function SemNotaRow({ l, onOpen }: { l: SemNotaLinha; onOpen: () => void }) {
  return (
    <div style={{ background: WHITE, border: `1px solid ${LINE}`, borderRadius: 10, padding: '12px 14px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      <div style={{ flex: '1 1 240px', minWidth: 0 }}>
        <div style={{ fontSize: 11, color: l.dias >= 30 ? '#B45309' : ESP60, fontWeight: 700 }}>🧾 {l.dias} dia(s) sem nota · entregue {fmtDataHora(l.entregue_em)}</div>
        <div style={{ fontSize: 15, fontWeight: 700, color: ESP, marginTop: 2 }}>{l.numero || '—'}</div>
        <div style={{ fontSize: 12, color: ESP60, overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.cliente_nome || 'sem cliente'}</div>
        <div style={{ display: 'flex', gap: 6, marginTop: 5, flexWrap: 'wrap' }}>
          {l.tem_servico && <span style={faltaTag}>falta NFS-e (serviço)</span>}
          {l.tem_peca && <span style={faltaTag}>falta NF-e (peça)</span>}
        </div>
      </div>
      <div style={{ textAlign: 'right', minWidth: 120 }}>
        <div style={{ fontSize: 10, color: ESP40, textTransform: 'uppercase', letterSpacing: 0.3, fontWeight: 600 }}>Valor da OS</div>
        <div style={{ fontSize: 14, fontWeight: 700, color: (l.total ?? 0) > 0 ? ESP : '#B45309', fontVariantNumeric: 'tabular-nums' }}>{(l.total ?? 0) > 0 ? brl(l.total) : 'sem valor'}</div>
      </div>
      <button onClick={onOpen} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '9px 12px', borderRadius: 8, border: `1px solid ${LINE}`, background: BG, color: ESP, fontWeight: 700, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}>
        Abrir OS <ChevronRight size={14} />
      </button>
    </div>
  )
}
