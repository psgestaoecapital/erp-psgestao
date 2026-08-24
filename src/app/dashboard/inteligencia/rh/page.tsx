'use client'

// RH Industrial · Hub (Inteligência → Recursos humanos). Sub-cards no topo + conteúdo do selecionado.
// Tema CLARO (padrão do dashboard — off-white #FAF7F2 / Espresso), igual às páginas-irmãs de detalhe.
// Sub-cards: Quadro de Lotação (fn_rh_quadro_lotacao) e Remuneração Variável (fn_rh_rv_calcular +
// fn_rh_rv_lancar_dia). Folha e Ponto LINKAM pras telas existentes (fronteira GE — não duplica).

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF'
const MUT = 'rgba(61,35,20,0.55)', GREEN = '#166534', RED = '#A32D2D'
const brl = (n: number | null | undefined) => 'R$ ' + Number(n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

type QuadroRow = {
  setor: string; posto_id: string; codigo_po: string | null; cargo: string | null; atividade: string | null
  proj_t1: number; proj_t2: number; proj_t3: number; proj_total: number; real: number; gap: number; custo: number | null
}
type QuadroResp = {
  ok: boolean; erro?: string; pode_salario: boolean
  kpis: { postos_ativos: number; postos_ocupados: number; vagas_abertas: number; proj_total: number; real_total: number; custo_registrado: number | null }
  lista: QuadroRow[]
}
type RvRow = {
  funcionario_id: string; cargo: string | null; perfil: string; faixa: string
  dias: number; entregas: number; entregas_origem: string | null; infracoes_registradas: number; sem_infracao: boolean
  salario_base: number | null; premio_util: number | null; diaria: number | null; hora_extra: number | null
  por_entrega: number | null; bonus: number | null; ajuste_manual: number | null; inss: number | null; variavel_total: number | null; bruto_total: number | null
}
type RvResp = {
  ok: boolean; erro?: string; competencia: string; pode_salario: boolean; inss_pela_folha: boolean
  kpis: { no_plano: number; dias_apurados: number; sem_infracao: number; variavel_mes: number | null }
  lista: RvRow[]
}
type Participante = { id: string; funcionario_id: string; plano_id: string; ativo: boolean }
type Plano = {
  id: string; perfil: string; faixa: string
  salario_base: number | null; diaria_valor: number | null; premio_util: number | null
  valor_entrega: number | null; bonus_sem_infracao: number | null; he_min_dia: number | null
  inss_pct: number | null; calcula_inss: boolean | null; entregas_meta: number | null; infracoes_zera: number | null
}
// campos editáveis do plano (rótulo + chave + tipo) — fonte única do formulário de edição.
const PLANO_CAMPOS: { k: keyof Plano; l: string; tipo: 'moeda' | 'int' | 'pct' }[] = [
  { k: 'salario_base', l: 'Salário base', tipo: 'moeda' },
  { k: 'diaria_valor', l: 'Diária (R$/dia)', tipo: 'moeda' },
  { k: 'premio_util', l: 'Prêmio utilização', tipo: 'moeda' },
  { k: 'valor_entrega', l: 'Valor por entrega', tipo: 'moeda' },
  { k: 'bonus_sem_infracao', l: 'Bônus sem infração', tipo: 'moeda' },
  { k: 'he_min_dia', l: 'HE (min/dia)', tipo: 'int' },
  { k: 'inss_pct', l: 'INSS %', tipo: 'pct' },
  { k: 'entregas_meta', l: 'Meta de entregas', tipo: 'int' },
  { k: 'infracoes_zera', l: 'Infrações que zeram bônus', tipo: 'int' },
]
type Func = { id: string; nome_completo: string | null; cargo: string | null }

type SubKey = 'quadro' | 'folha' | 'ponto' | 'remun' | 'indic' | 'nr'
const compAtual = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
const hojeISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

export default function RhHubPage() {
  const { selInfo, companyIds } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : (companyIds[0] ?? null)
  const router = useRouter()

  const [sub, setSub] = useState<SubKey>('quadro')
  const [quadro, setQuadro] = useState<QuadroResp | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [counts, setCounts] = useState({ postos: 0, folha: 0, ponto: 0, participantes: 0 })

  // RV
  const [competencia, setCompetencia] = useState(compAtual())
  const [rv, setRv] = useState<RvResp | null>(null)
  const [rvLoading, setRvLoading] = useState(false)
  const [nomes, setNomes] = useState<Record<string, string>>({})
  const [lancarOpen, setLancarOpen] = useState(false)
  const [partOpen, setPartOpen] = useState(false)
  // RV-F4 · fechamento da competência (evento GE)
  const [compFechada, setCompFechada] = useState(false)
  const [fechando, setFechando] = useState(false)
  const [rvAviso, setRvAviso] = useState<string | null>(null)
  // RV-F5.1 · ajuste individual por motorista
  const [ajusteFor, setAjusteFor] = useState<{ funcionario_id: string; nome: string } | null>(null)
  // RV-F6 · entregas do mês (total digitável por pessoa)
  const [entregasEdit, setEntregasEdit] = useState<Record<string, string>>({})
  const [savingEntregas, setSavingEntregas] = useState<string | null>(null)

  async function salvarEntregasMes(funcId: string) {
    const val = entregasEdit[funcId]
    if (val === undefined || !empresa) return
    setSavingEntregas(funcId); setRvAviso(null)
    const { data, error } = await supabase.rpc('fn_rh_rv_entregas_mes_salvar', {
      p_company_id: empresa, p_funcionario_id: funcId, p_competencia: competencia, p_entregas: parseInt(val || '0', 10) || 0 })
    setSavingEntregas(null)
    const j = data as { ok?: boolean; erro?: string } | null
    if (error || !j?.ok) {
      setRvAviso('Erro ao salvar entregas: ' + (j?.erro === 'competencia_fechada' ? 'competência fechada.' : (error?.message ?? j?.erro ?? 'falhou')))
      return
    }
    setEntregasEdit((prev) => { const n = { ...prev }; delete n[funcId]; return n })
    setRvAviso('✔ ALTEROU entregas do mês'); void carregarRv()
  }

  const carregar = useCallback(async () => {
    if (!empresa) { setLoading(false); return }
    setLoading(true); setErro(null)
    const [q, cPostos, cFolha, cPonto, cPart] = await Promise.all([
      supabase.rpc('fn_rh_quadro_lotacao', { p_company_id: empresa }),
      supabase.from('rh_posto_trabalho').select('*', { count: 'exact', head: true }).eq('company_id', empresa).eq('ativo', true),
      supabase.from('folha_competencia').select('*', { count: 'exact', head: true }).eq('company_id', empresa),
      supabase.from('ind_ponto_colaborador').select('*', { count: 'exact', head: true }).eq('company_id', empresa),
      supabase.from('rh_rv_participante').select('*', { count: 'exact', head: true }).eq('company_id', empresa).eq('ativo', true),
    ])
    setCounts({ postos: cPostos.count ?? 0, folha: cFolha.count ?? 0, ponto: cPonto.count ?? 0, participantes: cPart.count ?? 0 })
    if (q.error) setErro(q.error.message)
    else {
      const r = q.data as QuadroResp
      if (!r?.ok) setErro(r?.erro === 'sem_acesso' ? 'Sem acesso ao quadro desta empresa.' : (r?.erro ?? 'Erro ao carregar'))
      else setQuadro(r)
    }
    setLoading(false)
  }, [empresa])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])

  const carregarRv = useCallback(async () => {
    if (!empresa) return
    setRvLoading(true)
    const { data, error } = await supabase.rpc('fn_rh_rv_calcular', { p_company_id: empresa, p_competencia: competencia })
    if (!error) {
      const r = data as RvResp
      setRv(r?.ok ? r : null)
      const ids = (r?.lista ?? []).map((x) => x.funcionario_id)
      if (ids.length) {
        const { data: fs } = await supabase.from('compliance_funcionarios').select('id, nome_completo').in('id', ids)
        const m: Record<string, string> = {}
        for (const f of (fs ?? []) as { id: string; nome_completo: string | null }[]) m[f.id] = f.nome_completo ?? '—'
        setNomes(m)
      }
    }
    // status da competência (fechada trava lançamento e some o botão fechar)
    const { data: comp } = await supabase.from('rh_rv_competencia')
      .select('status').eq('company_id', empresa).eq('competencia', competencia).maybeSingle()
    setCompFechada((comp as { status?: string } | null)?.status === 'fechada')
    setRvLoading(false)
  }, [empresa, competencia])

  async function fecharCompetencia() {
    if (!empresa) return
    if (typeof window !== 'undefined' && !window.confirm(
      `Fechar a competência ${competencia}?\nGera 1 conta a pagar por motorista na Gestão Empresarial (folha) e trava novos lançamentos deste mês.`)) return
    setFechando(true); setRvAviso(null)
    const { data, error } = await supabase.rpc('fn_rh_rv_fechar_competencia', { p_company_id: empresa, p_competencia: competencia })
    setFechando(false)
    const j = data as { ok?: boolean; erro?: string; motoristas?: number; total?: number } | null
    if (error || !j?.ok) {
      setRvAviso('Não foi possível fechar: ' + (j?.erro === 'sem_permissao_fechar'
        ? 'só RH/sócio podem fechar a competência.' : (error?.message ?? j?.erro ?? 'falhou')))
      return
    }
    setRvAviso(`✔ Fechou a competência · ${j.motoristas} motorista(s) enviados à GE (folha)${rv?.pode_salario ? ` · ${brl(j.total)}` : ''}.`)
    void carregarRv()
  }
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (sub === 'remun') void carregarRv() }, [sub, carregarRv])

  const subcards = useMemo(() => ([
    { key: 'quadro' as SubKey, icone: '📋', nome: 'Quadro de lotação', tipo: 'ativo' as const, badge: counts.postos > 0 ? `${counts.postos} postos` : 'aguarda import', aceso: counts.postos > 0 },
    { key: 'remun' as SubKey, icone: '📈', nome: 'Remuneração variável', tipo: 'ativo' as const, badge: counts.participantes > 0 ? `${counts.participantes} no plano` : 'sem participantes', aceso: counts.participantes > 0 },
    { key: 'folha' as SubKey, icone: '💰', nome: 'Folha de pagamento', tipo: 'link' as const, rota: '/dashboard/industrial/folha', badge: counts.folha > 0 ? `${counts.folha} lançamentos` : '—', aceso: counts.folha > 0 },
    { key: 'ponto' as SubKey, icone: '⏱️', nome: 'Ponto e jornada', tipo: 'link' as const, rota: '/dashboard/industrial/producao', badge: counts.ponto > 0 ? `${counts.ponto} colaboradores` : '—', aceso: counts.ponto > 0 },
    { key: 'indic' as SubKey, icone: '📊', nome: 'Indicadores', tipo: 'breve' as const, badge: 'em breve · aguarda dados', aceso: false },
    { key: 'nr' as SubKey, icone: '🎓', nome: 'Treinamentos NR', tipo: 'breve' as const, badge: 'em breve · aguarda dados', aceso: false },
  ]), [counts])

  function clicarSub(sc: (typeof subcards)[number]) {
    if (sc.tipo === 'link' && 'rota' in sc && sc.rota) { router.push(sc.rota); return }
    if (sc.tipo === 'breve') return
    setSub(sc.key)
  }

  const porSetor = useMemo(() => {
    const m = new Map<string, QuadroRow[]>()
    for (const r of (quadro?.lista ?? [])) { const a = m.get(r.setor) ?? []; a.push(r); m.set(r.setor, a) }
    return Array.from(m.entries())
  }, [quadro])

  function exportarRv() {
    if (!rv?.lista?.length) return
    const head = ['Funcionario', 'Cargo', 'Perfil', 'Faixa', 'Dias', 'Entregas', 'InfracoesReg', 'Diaria', 'HoraExtra', 'PorEntrega', 'Bonus', 'VariavelTotal', 'BrutoTotal']
    const linhas = rv.lista.map((r) => [
      (nomes[r.funcionario_id] ?? r.funcionario_id).replace(/;/g, ' '), (r.cargo ?? '').replace(/;/g, ' '), r.perfil, r.faixa,
      r.dias, r.entregas, r.infracoes_registradas, r.diaria ?? '', r.hora_extra ?? '', r.por_entrega ?? '', r.bonus ?? '', r.variavel_total ?? '', r.bruto_total ?? '',
    ].join(';'))
    const csv = [head.join(';'), ...linhas].join('\n')
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a'); a.href = url; a.download = `rv_${competencia}.csv`; a.click(); URL.revokeObjectURL(url)
  }

  if (!empresa) {
    return <div style={{ background: BG, minHeight: '100vh', padding: 40, color: MUT, fontSize: 14 }}>Selecione uma empresa específica para ver os Recursos Humanos.</div>
  }

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '24px clamp(14px, 4vw, 40px)', color: ESP }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <header style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700 }}>👥 Inteligência · Industrial</div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: '2px 0 0' }}>Recursos Humanos</h1>
          <p style={{ fontSize: 12.5, color: MUT, margin: '4px 0 0' }}>
            Planejamento de lotação e remuneração variável × folha realizada. Folha e Ponto abrem as telas existentes.
          </p>
        </header>

        {/* Sub-cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, marginBottom: 18 }}>
          {subcards.map((sc) => {
            const ativo = sub === sc.key && sc.tipo === 'ativo'
            return (
              <button key={sc.key} type="button" onClick={() => clicarSub(sc)} disabled={sc.tipo === 'breve'}
                style={{ textAlign: 'left', background: ativo ? '#FBF3DE' : '#fff', border: `1px solid ${ativo ? GOLD : LINE}`, borderRadius: 12,
                  padding: '12px 14px', cursor: sc.tipo === 'breve' ? 'default' : 'pointer', opacity: sc.tipo === 'breve' ? 0.6 : 1, color: ESP }}>
                <div style={{ fontSize: 20, marginBottom: 4 }}>{sc.icone}</div>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{sc.nome}</div>
                <div style={{ fontSize: 10.5, marginTop: 4, color: sc.aceso ? GREEN : MUT, fontWeight: 600 }}>
                  {sc.tipo === 'link' && sc.aceso ? '🔗 ' : ''}{sc.badge}
                </div>
              </button>
            )
          })}
        </div>

        {/* ===== QUADRO DE LOTAÇÃO ===== */}
        {sub === 'quadro' && (
          loading ? <div style={{ padding: 30, textAlign: 'center', color: MUT, fontSize: 13 }}>Carregando…</div>
          : erro ? <div style={{ background: '#FCEBEB', border: `0.5px solid ${RED}`, color: RED, padding: '10px 14px', borderRadius: 8, fontSize: 12.5 }}>{erro}</div>
          : (quadro?.kpis.postos_ativos ?? 0) === 0 ? (
            <div style={{ background: '#fff', border: `1px dashed ${LINE}`, borderRadius: 12, padding: 28, textAlign: 'center' }}>
              <div style={{ fontSize: 34, marginBottom: 8 }}>🗂️</div>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Quadro aguardando importação</div>
              <div style={{ fontSize: 12.5, color: MUT, maxWidth: 520, margin: '0 auto' }}>
                Os postos ainda não foram importados. Rode a importação da planilha de lotação (perfil RH/sócio) —
                os KPIs e a tabela por setor aparecem aqui. Folha ({counts.folha}) e Ponto ({counts.ponto}) já têm dado.
              </div>
            </div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 16 }}>
                {[
                  { l: 'Postos ativos', v: String(quadro!.kpis.postos_ativos) },
                  { l: 'Ocupados', v: String(quadro!.kpis.postos_ocupados) },
                  { l: 'Vagas abertas', v: String(quadro!.kpis.vagas_abertas), cor: quadro!.kpis.vagas_abertas > 0 ? RED : GREEN },
                  { l: 'Projetado × Real', v: `${quadro!.kpis.proj_total} / ${quadro!.kpis.real_total}` },
                  ...(quadro!.pode_salario ? [{ l: 'Custo registrado', v: brl(quadro!.kpis.custo_registrado) }] : []),
                ].map((k, i) => (
                  <div key={i} style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: '12px 14px' }}>
                    <div style={{ fontSize: 10.5, color: MUT, textTransform: 'uppercase', letterSpacing: 0.5 }}>{k.l}</div>
                    <div style={{ fontSize: 20, fontWeight: 700, marginTop: 2, color: (k as { cor?: string }).cor ?? ESP }}>{k.v}</div>
                  </div>
                ))}
              </div>
              {!quadro!.pode_salario && <div style={{ fontSize: 11, color: MUT, marginBottom: 12 }}>🔒 Salário/custo ocultos — visíveis só para o perfil de RH (LGPD).</div>}
              {porSetor.map(([setor, linhas]) => (
                <div key={setor} style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: GOLD, marginBottom: 6 }}>{setor} · {linhas.length} posto(s)</div>
                  <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, overflow: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead><tr style={{ color: MUT, textAlign: 'left' }}>
                        {['Posto', 'Cargo', 'Proj (T1/T2/T3)', 'Real', 'Gap', ...(quadro!.pode_salario ? ['Custo'] : [])].map((h) => (
                          <th key={h} style={{ padding: '8px 10px', borderBottom: `1px solid ${LINE}`, fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                        ))}
                      </tr></thead>
                      <tbody>
                        {linhas.map((r) => (
                          <tr key={r.posto_id} style={{ borderBottom: `1px solid ${LINE}` }}>
                            <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>{r.codigo_po ?? '—'}</td>
                            <td style={{ padding: '8px 10px' }}>{r.cargo ?? r.atividade ?? '—'}</td>
                            <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>{r.proj_total} <span style={{ color: MUT }}>({r.proj_t1}/{r.proj_t2}/{r.proj_t3})</span></td>
                            <td style={{ padding: '8px 10px' }}>{r.real}</td>
                            <td style={{ padding: '8px 10px', fontWeight: 700, color: r.gap > 0 ? RED : GREEN, whiteSpace: 'nowrap' }}>{r.gap > 0 ? `🔴 falta ${r.gap}` : r.gap < 0 ? `+${-r.gap}` : '✅ ok'}</td>
                            {quadro!.pode_salario && <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>{brl(r.custo)}</td>}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </>
          )
        )}

        {/* ===== REMUNERAÇÃO VARIÁVEL ===== */}
        {sub === 'remun' && (
          <div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
              <label style={{ fontSize: 12, color: MUT }}>Competência
                <input type="month" value={competencia} onChange={(e) => setCompetencia(e.target.value)}
                  style={{ marginLeft: 6, border: `0.5px solid ${LINE}`, borderRadius: 6, padding: '6px 8px', fontSize: 12.5, color: ESP, background: '#fff' }} />
              </label>
              <button type="button" onClick={() => void carregarRv()} disabled={rvLoading}
                style={{ background: GOLD, color: '#fff', border: 'none', borderRadius: 6, padding: '7px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                {rvLoading ? 'Recalculando…' : '↻ Recalcular'}</button>
              <button type="button" onClick={() => setLancarOpen(true)}
                style={{ background: ESP, color: BG, border: 'none', borderRadius: 6, padding: '7px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>📝 Lançar dia</button>
              <button type="button" onClick={() => setPartOpen(true)}
                style={{ background: '#fff', color: ESP, border: `0.5px solid ${LINE}`, borderRadius: 6, padding: '7px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>👥 Participantes</button>
              <button type="button" onClick={exportarRv} disabled={!rv?.lista?.length}
                style={{ background: '#fff', color: ESP, border: `0.5px solid ${LINE}`, borderRadius: 6, padding: '7px 12px', fontSize: 12, fontWeight: 700, cursor: rv?.lista?.length ? 'pointer' : 'not-allowed', opacity: rv?.lista?.length ? 1 : 0.5 }}>⬇ Exportar</button>
              {compFechada ? (
                <span style={{ marginLeft: 'auto', background: '#EDE4D3', color: ESP, border: `0.5px solid ${GOLD}`, borderRadius: 6, padding: '7px 12px', fontSize: 12, fontWeight: 700 }}>🔒 Competência fechada · enviada à folha (GE)</span>
              ) : (
                <button type="button" onClick={() => void fecharCompetencia()} disabled={fechando || !rv?.lista?.length}
                  style={{ marginLeft: 'auto', background: '#7A1F1F', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 12px', fontSize: 12, fontWeight: 700, cursor: rv?.lista?.length ? 'pointer' : 'not-allowed', opacity: rv?.lista?.length ? 1 : 0.5 }}>
                  {fechando ? 'Fechando…' : '🔒 Fechar competência'}</button>
              )}
            </div>

            {rvAviso && <div style={{ fontSize: 12, color: rvAviso.startsWith('✔') ? GREEN : RED, marginBottom: 10, fontWeight: 600 }}>{rvAviso}</div>}
            <div style={{ fontSize: 11, color: MUT, marginBottom: 12 }}>ℹ️ INSS não é calculado aqui — vem da folha oficial (Dominio), pra não divergir. Ao fechar, gera 1 conta a pagar por motorista na GE (rastreável).</div>

            {rvLoading ? <div style={{ padding: 30, textAlign: 'center', color: MUT, fontSize: 13 }}>Carregando…</div>
            : (rv?.lista?.length ?? 0) === 0 ? (
              <div style={{ background: '#fff', border: `1px dashed ${LINE}`, borderRadius: 12, padding: 28, textAlign: 'center' }}>
                <div style={{ fontSize: 34, marginBottom: 8 }}>🚚</div>
                <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Nenhum motorista no plano ainda</div>
                <div style={{ fontSize: 12.5, color: MUT, maxWidth: 520, margin: '0 auto' }}>
                  Clique em <strong>Participantes</strong> para incluir os motoristas/ajudantes no plano. Depois use
                  <strong> Lançar dia</strong> para registrar entregas e infrações — os dias e horas vêm do ponto automático.
                </div>
              </div>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 16 }}>
                  {[
                    { l: 'No plano', v: String(rv!.kpis.no_plano) },
                    { l: 'Dias apurados', v: String(rv!.kpis.dias_apurados) },
                    { l: 'Sem infração', v: `${rv!.kpis.sem_infracao}/${rv!.kpis.no_plano}` },
                    ...(rv!.pode_salario ? [{ l: 'Variável do mês', v: brl(rv!.kpis.variavel_mes) }] : []),
                  ].map((k, i) => (
                    <div key={i} style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: '12px 14px' }}>
                      <div style={{ fontSize: 10.5, color: MUT, textTransform: 'uppercase', letterSpacing: 0.5 }}>{k.l}</div>
                      <div style={{ fontSize: 20, fontWeight: 700, marginTop: 2 }}>{k.v}</div>
                    </div>
                  ))}
                </div>
                {!rv!.pode_salario && <div style={{ fontSize: 11, color: MUT, marginBottom: 12 }}>🔒 Valores ocultos — visíveis só para o perfil de RH (LGPD).</div>}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
                  {rv!.lista.map((r) => (
                    <div key={r.funcionario_id} style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: 14 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 700 }}>{nomes[r.funcionario_id] ?? '—'}</div>
                      <div style={{ fontSize: 11, color: MUT, marginBottom: 8 }}>{r.cargo ?? '—'} · {r.perfil}/{r.faixa} · {r.dias} dia(s) · {r.entregas} entrega(s){!r.sem_infracao ? ' · ⚠ infração' : ''}</div>
                      {rv!.pode_salario ? (
                        <>
                          {r.salario_base === 0 && <div style={{ fontSize: 11, color: RED, marginBottom: 6, fontWeight: 600 }}>⚠ Salário base não configurado no plano — cálculo incompleto.</div>}
                          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}><tbody>
                            {[
                              { l: 'Salário base', tag: '📋', v: r.salario_base },
                              { l: 'Prêmio útil', tag: '📋', v: r.premio_util },
                              { l: 'Diária', tag: '⏱', v: r.diaria },
                              { l: 'Hora extra', tag: '⏱', v: r.hora_extra },
                              { l: 'Por entrega', tag: '✍', v: r.por_entrega },
                              { l: 'Bônus s/ infração', tag: '✍', v: r.bonus, red: !r.sem_infracao },
                            ].map((row, i) => (
                              <tr key={i}><td style={{ color: MUT, padding: '3px 0' }}>{row.tag} {row.l}</td>
                                <td style={{ textAlign: 'right', padding: '3px 0', color: row.red ? RED : ESP, fontWeight: row.red ? 700 : 400 }}>{brl(row.v as number)}{row.red ? ' (zerado)' : ''}</td></tr>
                            ))}
                            {!!r.ajuste_manual && (
                              <tr><td style={{ color: MUT, padding: '3px 0' }}>✍ Ajustes manuais</td>
                                <td style={{ textAlign: 'right', padding: '3px 0', fontWeight: 600, color: (r.ajuste_manual ?? 0) < 0 ? RED : GREEN }}>{(r.ajuste_manual ?? 0) >= 0 ? '+' : '−'}{brl(Math.abs(r.ajuste_manual as number))}</td></tr>
                            )}
                            <tr style={{ borderTop: `1px solid ${LINE}` }}><td style={{ fontWeight: 700, padding: '5px 0' }}>Variável</td><td style={{ textAlign: 'right', fontWeight: 700, color: GOLD }}>{brl(r.variavel_total)}</td></tr>
                            <tr><td style={{ color: MUT, padding: '2px 0', fontSize: 11 }}>Bruto (c/ base+prêmio)</td><td style={{ textAlign: 'right', padding: '2px 0', fontSize: 11, color: MUT }}>{brl(r.bruto_total)}</td></tr>
                          </tbody></table>
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 11, color: MUT }}>Entregas do mês:</span>
                            <input inputMode="numeric" value={entregasEdit[r.funcionario_id] ?? String(r.entregas)} disabled={compFechada}
                              onChange={(e) => setEntregasEdit((prev) => ({ ...prev, [r.funcionario_id]: e.target.value.replace(/\D/g, '') }))}
                              style={{ width: 72, border: `0.5px solid ${LINE}`, borderRadius: 5, padding: '4px 7px', fontSize: 12, color: ESP, background: compFechada ? '#F3ECE0' : '#fff' }} />
                            {!compFechada && <button onClick={() => void salvarEntregasMes(r.funcionario_id)} disabled={savingEntregas === r.funcionario_id} style={{ background: GOLD, color: '#fff', border: 'none', borderRadius: 5, padding: '4px 9px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>{savingEntregas === r.funcionario_id ? '…' : 'ok'}</button>}
                            <span style={{ fontSize: 10, color: MUT }} title={r.entregas_origem === 'mensal' ? 'total digitado do mês' : 'somado dos lançamentos diários'}>{r.entregas_origem === 'mensal' ? '✍ total do mês' : '⏱ somado dos dias'}</span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                            <span style={{ fontSize: 10, color: MUT }}>📋 plano · ⏱ ponto · ✍ manual</span>
                            {!compFechada && <button onClick={() => setAjusteFor({ funcionario_id: r.funcionario_id, nome: nomes[r.funcionario_id] ?? '—' })} style={{ background: '#fff', border: `0.5px solid ${GOLD}`, color: ESP, borderRadius: 6, padding: '4px 10px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>+ Ajuste</button>}
                          </div>
                        </>
                      ) : <div style={{ fontSize: 11.5, color: MUT }}>Valores ocultos (LGPD).</div>}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {lancarOpen && empresa && (
        <LancarDiaModal empresa={empresa} competencia={competencia} competenciaFechada={compFechada} onClose={() => setLancarOpen(false)} onSaved={() => { void carregarRv() }} />
      )}
      {partOpen && empresa && (
        <ParticipantesModal empresa={empresa} podeSalario={rv?.pode_salario ?? false} compFechada={compFechada}
          onClose={() => setPartOpen(false)} onChanged={() => { void carregar(); void carregarRv() }} />
      )}
      {ajusteFor && empresa && (
        <AjusteModal empresa={empresa} competencia={competencia} funcionarioId={ajusteFor.funcionario_id} nome={ajusteFor.nome}
          onClose={() => setAjusteFor(null)} onChanged={() => void carregarRv()} />
      )}
    </div>
  )
}

// ── Lançamento diário (mobile): data + entregas + infração por participante ──────────────────────
function LancarDiaModal({ empresa, competencia, competenciaFechada, onClose, onSaved }: { empresa: string; competencia?: string; competenciaFechada?: boolean; onClose: () => void; onSaved: () => void }) {
  const [data, setData] = useState(hojeISO())
  const dataFechada = !!competenciaFechada && data.slice(0, 7) === competencia
  const [rows, setRows] = useState<{ funcionario_id: string; nome: string; entregas: string; infracao: boolean; tipo: string; lancId: string | null }[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const { data: parts } = await supabase.from('rh_rv_participante').select('funcionario_id').eq('company_id', empresa).eq('ativo', true)
      const ids = ((parts ?? []) as { funcionario_id: string }[]).map((p) => p.funcionario_id)
      const nomeMap: Record<string, string> = {}
      if (ids.length) {
        const { data: fs } = await supabase.from('compliance_funcionarios').select('id, nome_completo').in('id', ids)
        for (const f of (fs ?? []) as { id: string; nome_completo: string | null }[]) nomeMap[f.id] = f.nome_completo ?? '—'
      }
      if (!alive) return
      setRows(ids.map((id) => ({ funcionario_id: id, nome: nomeMap[id] ?? '—', entregas: '', infracao: false, tipo: 'registrada', lancId: null })))
      setLoading(false)
    })()
    return () => { alive = false }
  }, [empresa])

  // Ao trocar a data, carrega os lançamentos JÁ existentes desse dia (editar/excluir).
  useEffect(() => {
    if (loading) return
    let alive = true
    ;(async () => {
      const { data: ls } = await supabase.from('rh_rv_lancamento_dia')
        .select('id, funcionario_id, entregas_qtd, infracao, infracao_tipo').eq('company_id', empresa).eq('data', data)
      if (!alive) return
      const m = new Map(((ls ?? []) as { id: string; funcionario_id: string; entregas_qtd: number | null; infracao: boolean | null; infracao_tipo: string | null }[]).map((l) => [l.funcionario_id, l]))
      setRows((rs) => rs.map((r) => {
        const l = m.get(r.funcionario_id)
        return l ? { ...r, lancId: l.id, entregas: String(l.entregas_qtd ?? ''), infracao: !!l.infracao, tipo: l.infracao_tipo || 'registrada' }
                 : { ...r, lancId: null, entregas: '', infracao: false, tipo: 'registrada' }
      }))
    })()
    return () => { alive = false }
  }, [data, empresa, loading])

  async function excluir(r: (typeof rows)[number]) {
    if (!r.lancId) return
    if (typeof window !== 'undefined' && !window.confirm(`Excluir o lançamento de ${r.nome} em ${data.split('-').reverse().join('/')}?`)) return
    setBusy(r.funcionario_id); setMsg(null)
    const { data: res, error } = await supabase.rpc('fn_rh_rv_lancamento_excluir', { p_company_id: empresa, p_lancamento_id: r.lancId })
    setBusy(null)
    const j = res as { ok?: boolean; erro?: string } | null
    if (error || !j?.ok) { setMsg('Erro: ' + (j?.erro === 'competencia_fechada' ? 'competência fechada.' : (error?.message ?? j?.erro ?? 'falhou'))); return }
    setRows((rs) => rs.map((x) => x.funcionario_id === r.funcionario_id ? { ...x, lancId: null, entregas: '', infracao: false, tipo: 'registrada' } : x))
    setMsg(`✔ EXCLUIU lançamento de ${r.nome}`); onSaved()
  }

  async function salvar(r: (typeof rows)[number]) {
    setBusy(r.funcionario_id); setMsg(null)
    const { data: res, error } = await supabase.rpc('fn_rh_rv_lancar_dia', {
      p_company_id: empresa, p_funcionario_id: r.funcionario_id, p_data: data,
      p_entregas_qtd: parseInt(r.entregas || '0', 10) || 0, p_infracao: r.infracao,
      p_infracao_tipo: r.infracao ? r.tipo : null,
    })
    setBusy(null)
    const j = res as { ok?: boolean; erro?: string } | null
    if (error || !j?.ok) { setMsg(`Erro: ${error?.message ?? j?.erro ?? 'falhou'}`); return }
    setMsg(`✔ ${r.nome} salvo (${data.split('-').reverse().join('/')})`); onSaved()
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '30px 12px', zIndex: 60, overflowY: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: BG, borderRadius: 12, width: '100%', maxWidth: 560 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', background: ESP, borderRadius: '12px 12px 0 0' }}>
          <div style={{ color: GOLD, fontWeight: 700, fontSize: 15 }}>📝 Lançar dia</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: BG, cursor: 'pointer', fontSize: 18 }}>✕</button>
        </div>
        <div style={{ padding: 16 }}>
          <label style={{ fontSize: 12, color: MUT }}>Data <input type="date" value={data} onChange={(e) => setData(e.target.value)} style={{ marginLeft: 6, border: `0.5px solid ${LINE}`, borderRadius: 6, padding: '6px 8px', color: ESP, background: '#fff' }} /></label>
          {dataFechada && <div style={{ marginTop: 8, fontSize: 12, color: RED, fontWeight: 600 }}>🔒 A competência {competencia} está fechada (enviada à folha) — não dá para lançar neste mês.</div>}
          {msg && <div style={{ marginTop: 8, fontSize: 12, color: msg.startsWith('Erro') ? RED : GREEN }}>{msg}</div>}
          {loading ? <div style={{ padding: 20, textAlign: 'center', color: MUT }}>Carregando…</div>
          : rows.length === 0 ? <div style={{ padding: 20, textAlign: 'center', color: MUT, fontSize: 12.5 }}>Nenhum participante no plano. Inclua em “Participantes”.</div>
          : (
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {rows.map((r, idx) => (
                <div key={r.funcionario_id} style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 8, padding: '8px 10px' }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>{r.nome}</div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <input inputMode="numeric" placeholder="entregas" value={r.entregas} onChange={(e) => setRows((rs) => rs.map((x, i) => i === idx ? { ...x, entregas: e.target.value.replace(/\D/g, '') } : x))} style={{ width: 90, border: `0.5px solid ${LINE}`, borderRadius: 6, padding: '6px 8px', fontSize: 12.5, color: ESP, background: '#fff' }} />
                    <label style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <input type="checkbox" checked={r.infracao} onChange={(e) => setRows((rs) => rs.map((x, i) => i === idx ? { ...x, infracao: e.target.checked } : x))} /> infração
                    </label>
                    {r.infracao && (
                      <select value={r.tipo} onChange={(e) => setRows((rs) => rs.map((x, i) => i === idx ? { ...x, tipo: e.target.value } : x))} style={{ border: `0.5px solid ${LINE}`, borderRadius: 6, padding: '5px 6px', fontSize: 12, color: ESP, background: '#fff' }}>
                        <option value="registrada">registrada</option><option value="verbal">verbal</option>
                      </select>
                    )}
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                      {r.lancId && !dataFechada && (
                        <button onClick={() => void excluir(r)} disabled={busy === r.funcionario_id} title="Excluir lançamento deste dia" style={{ background: 'transparent', border: `0.5px solid ${RED}`, color: RED, borderRadius: 6, padding: '6px 10px', fontSize: 12, cursor: 'pointer' }}>🗑</button>
                      )}
                      <button onClick={() => void salvar(r)} disabled={busy === r.funcionario_id || dataFechada} style={{ background: GOLD, color: '#fff', border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 700, cursor: dataFechada ? 'not-allowed' : 'pointer', opacity: dataFechada ? 0.5 : 1 }}>{busy === r.funcionario_id ? '…' : r.lancId ? 'Atualizar' : 'Salvar'}</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div style={{ fontSize: 10.5, color: MUT, marginTop: 10 }}>Só a infração <strong>registrada</strong> zera o bônus. Dias e horas extras vêm do ponto — aqui só entregas e infração.</div>
        </div>
      </div>
    </div>
  )
}

// ── Participantes: incluir motorista/ajudante no plano (perfil/faixa) ────────────────────────────
function ParticipantesModal({ empresa, podeSalario, compFechada, onClose, onChanged }: { empresa: string; podeSalario: boolean; compFechada: boolean; onClose: () => void; onChanged: () => void }) {
  const [planos, setPlanos] = useState<Plano[]>([])
  const [planosEdit, setPlanosEdit] = useState<Record<string, Plano>>({})
  const [savingPlano, setSavingPlano] = useState<string | null>(null)
  const [planoMsg, setPlanoMsg] = useState<string | null>(null)
  const [participantes, setParticipantes] = useState<(Participante & { nome: string })[]>([])
  const [funcs, setFuncs] = useState<Func[]>([])
  const [selFunc, setSelFunc] = useState('')
  const [selPlano, setSelPlano] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    const [pl, pa, fu] = await Promise.all([
      supabase.from('rh_rv_plano').select('id, perfil, faixa, salario_base, diaria_valor, premio_util, valor_entrega, bonus_sem_infracao, he_min_dia, inss_pct, calcula_inss, entregas_meta, infracoes_zera').eq('company_id', empresa).eq('ativo', true).order('perfil'),
      supabase.from('rh_rv_participante').select('id, funcionario_id, plano_id, ativo').eq('company_id', empresa).eq('ativo', true),
      supabase.from('compliance_funcionarios').select('id, nome_completo, cargo').eq('company_id', empresa).or('cargo.ilike.%motorista%,cargo.ilike.%ajudante%').order('nome_completo'),
    ])
    const planosList = (pl.data as Plano[]) ?? []
    setPlanos(planosList)
    setPlanosEdit(Object.fromEntries(planosList.map((p) => [p.id, { ...p }])))
    setFuncs((fu.data as Func[]) ?? [])
    const parts = (pa.data as Participante[]) ?? []
    const nomeMap: Record<string, string> = {}
    for (const f of ((fu.data as Func[]) ?? [])) nomeMap[f.id] = f.nome_completo ?? '—'
    setParticipantes(parts.map((p) => ({ ...p, nome: nomeMap[p.funcionario_id] ?? '—' })))
  }, [empresa])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])

  async function incluir() {
    if (!selFunc || !selPlano) { setMsg('Escolha o funcionário e o plano.'); return }
    setBusy(true); setMsg(null)
    const { data, error } = await supabase.rpc('fn_rh_rv_participante_salvar', {
      p_company_id: empresa, p_funcionario_id: selFunc, p_plano_id: selPlano, p_ativo: true })
    setBusy(false)
    const j = data as { ok?: boolean; erro?: string } | null
    if (error || !j?.ok) { setMsg('Erro: ' + (error?.message ?? j?.erro ?? 'falhou')); return }
    setSelFunc(''); setMsg('✔ CRIOU vínculo'); await carregar(); onChanged()
  }
  async function remover(id: string) {
    if (typeof window !== 'undefined' && !window.confirm('Excluir este participante do plano?')) return
    setBusy(true)
    const { data, error } = await supabase.rpc('fn_rh_rv_participante_excluir', { p_company_id: empresa, p_participante_id: id })
    setBusy(false)
    const j = data as { ok?: boolean; erro?: string } | null
    if (error || !j?.ok) { setMsg('Erro: ' + (error?.message ?? j?.erro ?? 'falhou')); return }
    setMsg('✔ EXCLUIU participante'); await carregar(); onChanged()
  }

  async function salvarPlano(pl: Plano) {
    setSavingPlano(pl.id); setPlanoMsg(null)
    const patch: Record<string, unknown> = {}
    for (const c of PLANO_CAMPOS) patch[c.k] = pl[c.k]
    const { data, error } = await supabase.rpc('fn_rh_rv_plano_salvar', { p_company_id: empresa, p_plano_id: pl.id, p_patch: patch })
    setSavingPlano(null)
    const j = data as { ok?: boolean; erro?: string } | null
    if (error || !j?.ok) {
      setPlanoMsg('Erro ao salvar plano: ' + (j?.erro === 'sem_permissao' ? 'só RH/sócio editam valores.' : (error?.message ?? j?.erro ?? 'falhou')))
      return
    }
    setPlanoMsg(`✔ ALTEROU o plano ${pl.perfil}/${pl.faixa}`); onChanged()
  }
  const setPlanoField = (id: string, k: keyof Plano, v: string) =>
    setPlanosEdit((prev) => ({ ...prev, [id]: { ...prev[id], [k]: v === '' ? null : Number(v) } }))

  const planoLabel = (id: string) => { const p = planos.find((x) => x.id === id); return p ? `${p.perfil}/${p.faixa}` : '—' }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '30px 12px', zIndex: 60, overflowY: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: BG, borderRadius: 12, width: '100%', maxWidth: 560 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', background: ESP, borderRadius: '12px 12px 0 0' }}>
          <div style={{ color: GOLD, fontWeight: 700, fontSize: 15 }}>👥 Participantes e planos</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: BG, cursor: 'pointer', fontSize: 18 }}>✕</button>
        </div>
        <div style={{ padding: 16 }}>
          {podeSalario && planos.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>Valores dos planos (perfil × faixa){compFechada ? ' · 🔒 fechada (leitura)' : ''}</div>
              {planoMsg && <div style={{ fontSize: 12, color: planoMsg.startsWith('✔') ? GREEN : RED, marginBottom: 8 }}>{planoMsg}</div>}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {planos.map((p) => { const e = planosEdit[p.id] ?? p; return (
                  <div key={p.id} style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 8, padding: 10 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: GOLD, marginBottom: 6 }}>{p.perfil} / {p.faixa}{(e.salario_base ?? 0) === 0 ? ' · ⚠ salário base 0' : ''}</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }}>
                      {PLANO_CAMPOS.map((c) => (
                        <label key={String(c.k)} style={{ fontSize: 10.5, color: MUT }}>{c.l}
                          <input type="number" step={c.tipo === 'moeda' ? '0.01' : c.tipo === 'pct' ? '0.001' : '1'} value={(e[c.k] ?? '') as number | string} disabled={compFechada}
                            onChange={(ev) => setPlanoField(p.id, c.k, ev.target.value)}
                            style={{ width: '100%', border: `0.5px solid ${LINE}`, borderRadius: 5, padding: '5px 7px', fontSize: 12, color: ESP, background: compFechada ? '#F3ECE0' : '#fff', marginTop: 2 }} />
                        </label>
                      ))}
                    </div>
                    {!compFechada && (
                      <button onClick={() => void salvarPlano(e)} disabled={savingPlano === p.id} style={{ marginTop: 8, background: GOLD, color: '#fff', border: 'none', borderRadius: 6, padding: '6px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>{savingPlano === p.id ? 'Salvando…' : 'Salvar plano'}</button>
                    )}
                  </div>
                )})}
              </div>
              <div style={{ height: 1, background: LINE, margin: '14px 0' }} />
            </div>
          )}
          {planos.length === 0 ? (
            <div style={{ fontSize: 12.5, color: RED }}>Nenhum plano visível (precisa de perfil RH/sócio para gerenciar o plano — LGPD).</div>
          ) : (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
              <select value={selFunc} onChange={(e) => setSelFunc(e.target.value)} style={{ flex: 1, minWidth: 180, border: `0.5px solid ${LINE}`, borderRadius: 6, padding: '7px 8px', fontSize: 12.5, color: ESP, background: '#fff' }}>
                <option value="">Funcionário (motorista/ajudante)…</option>
                {funcs.map((f) => <option key={f.id} value={f.id}>{f.nome_completo} · {f.cargo}</option>)}
              </select>
              <select value={selPlano} onChange={(e) => setSelPlano(e.target.value)} style={{ border: `0.5px solid ${LINE}`, borderRadius: 6, padding: '7px 8px', fontSize: 12.5, color: ESP, background: '#fff' }}>
                <option value="">Plano…</option>
                {planos.map((p) => <option key={p.id} value={p.id}>{p.perfil}/{p.faixa}</option>)}
              </select>
              <button onClick={() => void incluir()} disabled={busy} style={{ background: GOLD, color: '#fff', border: 'none', borderRadius: 6, padding: '7px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>+ Incluir</button>
            </div>
          )}
          {msg && <div style={{ fontSize: 12, color: msg.startsWith('Erro') ? RED : GREEN, marginBottom: 8 }}>{msg}</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {participantes.length === 0 ? <div style={{ fontSize: 12.5, color: MUT, padding: 8 }}>Nenhum participante ainda.</div>
            : participantes.map((p) => (
              <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 8, padding: '8px 10px' }}>
                <div style={{ fontSize: 12.5 }}><strong>{p.nome}</strong> <span style={{ color: MUT }}>· {planoLabel(p.plano_id)}</span></div>
                <button onClick={() => void remover(p.id)} disabled={busy} style={{ background: 'transparent', border: `0.5px solid ${RED}`, color: RED, borderRadius: 6, padding: '4px 10px', fontSize: 11.5, cursor: 'pointer' }}>remover</button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── RV-F5.1 · Ajuste individual por motorista numa competência ───────────────────────────────────
function AjusteModal({ empresa, competencia, funcionarioId, nome, onClose, onChanged }: { empresa: string; competencia: string; funcionarioId: string; nome: string; onClose: () => void; onChanged: () => void }) {
  const [lista, setLista] = useState<{ id: string; tipo: string; valor: number; motivo: string }[]>([])
  const [tipo, setTipo] = useState<'adicional' | 'desconto'>('adicional')
  const [valor, setValor] = useState('')
  const [motivo, setMotivo] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    const { data } = await supabase.from('rh_rv_ajuste_manual')
      .select('id, tipo, valor, motivo').eq('company_id', empresa).eq('funcionario_id', funcionarioId)
      .eq('competencia', competencia).eq('ativo', true).order('created_at', { ascending: false })
    setLista((data as { id: string; tipo: string; valor: number; motivo: string }[]) ?? [])
  }, [empresa, funcionarioId, competencia])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])

  async function salvar() {
    if (!motivo.trim()) { setMsg('O motivo é obrigatório.'); return }
    if (!(parseFloat(valor) > 0)) { setMsg('Informe um valor maior que zero.'); return }
    setBusy(true); setMsg(null)
    const { data, error } = await supabase.rpc('fn_rh_rv_ajuste_salvar', {
      p_company_id: empresa, p_funcionario_id: funcionarioId, p_competencia: competencia, p_tipo: tipo, p_valor: parseFloat(valor), p_motivo: motivo.trim() })
    setBusy(false)
    const j = data as { ok?: boolean; erro?: string } | null
    if (error || !j?.ok) { setMsg('Erro: ' + (j?.erro === 'competencia_fechada' ? 'competência fechada.' : j?.erro === 'sem_permissao' ? 'só RH/sócio.' : (error?.message ?? j?.erro ?? 'falhou'))); return }
    setValor(''); setMotivo(''); setMsg('✔ CRIOU ajuste'); await carregar(); onChanged()
  }
  async function excluir(id: string) {
    setBusy(true); setMsg(null)
    const { data, error } = await supabase.rpc('fn_rh_rv_ajuste_excluir', { p_company_id: empresa, p_ajuste_id: id })
    setBusy(false)
    const j = data as { ok?: boolean; erro?: string } | null
    if (error || !j?.ok) { setMsg('Erro: ' + (error?.message ?? j?.erro ?? 'falhou')); return }
    setMsg('✔ EXCLUIU ajuste'); await carregar(); onChanged()
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '30px 12px', zIndex: 70, overflowY: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: BG, borderRadius: 12, width: '100%', maxWidth: 480 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', background: ESP, borderRadius: '12px 12px 0 0' }}>
          <div style={{ color: GOLD, fontWeight: 700, fontSize: 14 }}>✍ Ajuste · {nome} · {competencia}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: BG, cursor: 'pointer', fontSize: 18 }}>✕</button>
        </div>
        <div style={{ padding: 16 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <select value={tipo} onChange={(e) => setTipo(e.target.value as 'adicional' | 'desconto')} style={{ border: `0.5px solid ${LINE}`, borderRadius: 6, padding: '7px 8px', fontSize: 12.5, color: ESP, background: '#fff' }}>
              <option value="adicional">Adicional (+)</option><option value="desconto">Desconto (−)</option>
            </select>
            <input inputMode="decimal" placeholder="valor R$" value={valor} onChange={(e) => setValor(e.target.value.replace(/[^\d.,]/g, '').replace(',', '.'))} style={{ width: 110, border: `0.5px solid ${LINE}`, borderRadius: 6, padding: '7px 8px', fontSize: 12.5, color: ESP, background: '#fff' }} />
          </div>
          <input placeholder="motivo (obrigatório)" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={200} style={{ width: '100%', marginTop: 8, border: `0.5px solid ${LINE}`, borderRadius: 6, padding: '7px 8px', fontSize: 12.5, color: ESP, background: '#fff', boxSizing: 'border-box' }} />
          <button onClick={() => void salvar()} disabled={busy} style={{ marginTop: 8, background: GOLD, color: '#fff', border: 'none', borderRadius: 6, padding: '7px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>+ Lançar ajuste</button>
          {msg && <div style={{ fontSize: 12, color: msg.startsWith('✔') ? GREEN : RED, marginTop: 8 }}>{msg}</div>}
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {lista.length === 0 ? <div style={{ fontSize: 12, color: MUT }}>Nenhum ajuste nesta competência.</div>
            : lista.map((a) => (
              <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 8, padding: '8px 10px' }}>
                <div style={{ fontSize: 12 }}>
                  <strong style={{ color: a.tipo === 'desconto' ? RED : GREEN }}>{a.tipo === 'desconto' ? '−' : '+'}{brl(a.valor)}</strong>
                  <span style={{ color: MUT }}> · {a.motivo}</span>
                </div>
                <button onClick={() => void excluir(a.id)} disabled={busy} style={{ background: 'transparent', border: `0.5px solid ${RED}`, color: RED, borderRadius: 6, padding: '3px 9px', fontSize: 11, cursor: 'pointer' }}>🗑</button>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 10.5, color: MUT, marginTop: 10 }}>O ajuste entra na Variável e no valor da conta a pagar ao fechar. Bloqueado após o fechamento.</div>
        </div>
      </div>
    </div>
  )
}
