'use client'

// Visão QUADRO (posto a posto) — a tela de RH que o CEO pediu (11/11): o quadro no formato da planilha,
// não o "Cadastro por fluxo". É a MESMA fonte do fluxo (prod_posto / prod_posto_turno / prod_posto_custo),
// lida pela RPC viva fn_rh_quadro_lotacao (RD-26): projetado × real por posto, vagas (gap) e custo do posto
// — o custo é AGREGADO e passa pelo gate da folha (LGPD, fn__pode_ver_folha): quem não pode ver a folha não
// recebe número de custo (pode_salario=false → custo nulo). Slice 1: grade read-only + filtro por setor +
// totais por setor + "?" (RD-95). Incluir/editar/excluir posto e alocar/desalocar pessoa entram na slice 2.

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { erroAmigavel } from '@/lib/erroAmigavel'

const ROTA = '/dashboard/produtividade'
const Aj = ({ k }: { k: string }) => <AjudaCampo chave={k} rota={ROTA} />

const C = {
  esp: '#3D2314', espM: '#6B5D4F', espL: '#9C8E80', bg: '#FAF7F2', white: '#FFFFFF',
  cream: '#F0ECE3', border: '#E0D8CC', gold: '#C8941A', goldBg: '#FDF7E8',
  green: '#166534', greenBg: '#ECFDF5', amber: '#BA7517', amberBg: '#FAEEDA', red: '#B42318', redBg: '#FCEBEB',
}
const nf0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 })
const brl0 = (v: number | null | undefined) => v == null ? '—' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v)

type Linha = {
  setor: string; posto_id: string; codigo_po: string | null; cargo: string | null; atividade: string | null
  proj_t1: number; proj_t2: number; proj_t3: number; proj_total: number; real: number; gap: number; custo: number | null
}
type Kpis = { postos_ativos: number; postos_ocupados: number; vagas_abertas: number; proj_total: number; real_total: number; custo_registrado: number | null }
type Resp = { ok: boolean; erro?: string; pode_salario: boolean; kpis: Kpis; lista: Linha[] }

export function QuadroView({ companyId }: { companyId: string }) {
  const [resp, setResp] = useState<Resp | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [setorFiltro, setSetorFiltro] = useState<string>('')

  const carregar = useCallback(async () => {
    setCarregando(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_rh_quadro_lotacao', { p_company_id: companyId })
    setCarregando(false)
    if (error) { setErro(erroAmigavel(error)); setResp(null); return }
    const r = data as Resp
    if (!r?.ok) { setErro(r?.erro === 'sem_acesso' ? 'Você não tem acesso ao quadro desta empresa.' : 'Não foi possível carregar o quadro.'); setResp(null); return }
    setResp(r)
  }, [companyId])
  useEffect(() => { void carregar() }, [carregar])

  const lista = resp?.lista ?? []
  const podeCusto = resp?.pode_salario ?? false
  const setores = useMemo(() => [...new Set(lista.map((l) => l.setor))].sort((a, b) => a.localeCompare(b)), [lista])
  const filtrada = useMemo(() => setorFiltro ? lista.filter((l) => l.setor === setorFiltro) : lista, [lista, setorFiltro])

  // Agrupa por setor, com subtotais por setor.
  const grupos = useMemo(() => {
    const m = new Map<string, Linha[]>()
    filtrada.forEach((l) => { const a = m.get(l.setor); if (a) a.push(l); else m.set(l.setor, [l]) })
    return [...m].map(([setor, linhas]) => ({
      setor,
      linhas: [...linhas].sort((a, b) => (a.codigo_po ?? '').localeCompare(b.codigo_po ?? '', 'pt-BR', { numeric: true })),
      tot: linhas.reduce((t, l) => ({
        proj: t.proj + l.proj_total, real: t.real + l.real, gap: t.gap + Math.max(0, l.gap),
        custo: l.custo == null ? t.custo : (t.custo ?? 0) + l.custo,
      }), { proj: 0, real: 0, gap: 0, custo: null as number | null }),
    })).sort((a, b) => a.setor.localeCompare(b.setor))
  }, [filtrada])

  const totGeral = useMemo(() => filtrada.reduce((t, l) => ({
    proj: t.proj + l.proj_total, real: t.real + l.real, gap: t.gap + Math.max(0, l.gap),
    custo: l.custo == null ? t.custo : (t.custo ?? 0) + l.custo,
  }), { proj: 0, real: 0, gap: 0, custo: null as number | null }), [filtrada])

  const card: React.CSSProperties = { background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: '12px 14px', flex: '1 1 140px', minWidth: 140 }
  const rotCard: React.CSSProperties = { fontSize: 11.5, color: C.espM, display: 'flex', alignItems: 'center', gap: 4 }
  const valCard: React.CSSProperties = { fontSize: 22, fontWeight: 700, color: C.esp, marginTop: 2 }
  const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 11.5, color: C.espM, fontWeight: 700, whiteSpace: 'nowrap', borderBottom: `2px solid ${C.border}` }
  const thR: React.CSSProperties = { ...th, textAlign: 'right' }
  const td: React.CSSProperties = { padding: '8px 10px', fontSize: 13, color: C.esp, borderBottom: `1px solid ${C.cream}`, whiteSpace: 'nowrap' }
  const tdR: React.CSSProperties = { ...td, textAlign: 'right' }

  if (carregando) return <div style={{ padding: 28, color: C.espM, fontSize: 13 }}>Carregando o quadro…</div>
  if (erro) return <div style={{ background: C.redBg, color: C.red, padding: '10px 14px', borderRadius: 8, fontSize: 13 }}>{erro}</div>

  if (lista.length === 0) {
    return (
      <div style={{ background: C.white, border: `1px dashed ${C.border}`, borderRadius: 12, padding: '28px 18px', textAlign: 'center', color: C.espM }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.esp, marginBottom: 6 }}>Nenhum posto no quadro ainda</div>
        <div style={{ fontSize: 13, marginBottom: 14 }}>Cadastre os postos por fluxo (aba ao lado) ou abasteça tudo de uma vez pela planilha padrão.</div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link href="/dashboard/produtividade/importar" style={{ padding: '8px 14px', borderRadius: 8, background: C.gold, color: C.white, textDecoration: 'none', fontSize: 13, fontWeight: 700 }}>⬆ Importar por planilha</Link>
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* KPIs do quadro */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={card}><div style={rotCard}>Postos ativos<Aj k="industria.quadro.kpi_postos" /></div><div style={valCard}>{nf0.format(resp!.kpis.postos_ativos)}</div></div>
        <div style={card}><div style={rotCard}>Postos ocupados<Aj k="industria.quadro.kpi_ocupados" /></div><div style={valCard}>{nf0.format(resp!.kpis.postos_ocupados)}</div></div>
        <div style={card}><div style={rotCard}>Vagas abertas<Aj k="industria.quadro.kpi_vagas" /></div><div style={{ ...valCard, color: resp!.kpis.vagas_abertas > 0 ? C.amber : C.esp }}>{nf0.format(resp!.kpis.vagas_abertas)}</div></div>
        <div style={card}><div style={rotCard}>Quadro projetado<Aj k="industria.quadro.kpi_projetado" /></div><div style={valCard}>{nf0.format(resp!.kpis.proj_total)}</div></div>
        <div style={card}><div style={rotCard}>Quadro real<Aj k="industria.quadro.kpi_real" /></div><div style={valCard}>{nf0.format(resp!.kpis.real_total)}</div></div>
        {podeCusto && <div style={card}><div style={rotCard}>Custo da folha (mês)<Aj k="industria.quadro.kpi_custo" /></div><div style={valCard}>{brl0(resp!.kpis.custo_registrado)}</div></div>}
      </div>

      {/* Filtro por setor */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <label style={{ fontSize: 12, color: C.espM, display: 'flex', alignItems: 'center', gap: 4 }}>
          Setor<AjudaCampo chave="industria.quadro.filtro_setor" rota={ROTA} />
          <select value={setorFiltro} onChange={(e) => setSetorFiltro(e.target.value)} aria-label="Filtrar por setor"
            style={{ padding: '7px 9px', fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 7, background: C.white, color: C.esp, marginLeft: 4 }}>
            <option value="">Todos os setores</option>
            {setores.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        {!podeCusto && <span style={{ fontSize: 12, color: C.espM, background: C.cream, padding: '5px 9px', borderRadius: 7 }}>O custo da mão de obra só aparece para RH e diretoria.</span>}
      </div>

      {/* Grade por setor (rolagem horizontal no celular) */}
      <div style={{ overflowX: 'auto', border: `1px solid ${C.border}`, borderRadius: 12, background: C.white }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 760 }}>
          <thead>
            <tr style={{ background: C.goldBg }}>
              <th style={th}>Nº PO<Aj k="industria.quadro.col_po" /></th>
              <th style={th}>Cargo<Aj k="industria.quadro.col_cargo" /></th>
              <th style={th}>Área / atividade<Aj k="industria.quadro.col_atividade" /></th>
              <th style={thR}>T1<Aj k="industria.quadro.col_turnos" /></th>
              <th style={thR}>T2<Aj k="industria.quadro.col_turnos" /></th>
              <th style={thR}>T3<Aj k="industria.quadro.col_turnos" /></th>
              <th style={thR}>Projetado<Aj k="industria.quadro.col_projetado" /></th>
              <th style={thR}>Real<Aj k="industria.quadro.col_real" /></th>
              <th style={thR}>Vagas<Aj k="industria.quadro.col_vagas" /></th>
              {podeCusto && <th style={thR}>Custo (mês)<Aj k="industria.quadro.col_custo" /></th>}
            </tr>
          </thead>
          <tbody>
            {grupos.map((g) => (
              <SetorBloco key={g.setor} g={g} podeCusto={podeCusto} td={td} tdR={tdR} />
            ))}
            <tr style={{ background: C.cream, fontWeight: 700 }}>
              <td style={td} colSpan={6}>Total geral</td>
              <td style={tdR}>{nf0.format(totGeral.proj)}</td>
              <td style={tdR}>{nf0.format(totGeral.real)}</td>
              <td style={{ ...tdR, color: totGeral.gap > 0 ? C.amber : C.esp }}>{nf0.format(totGeral.gap)}</td>
              {podeCusto && <td style={tdR}>{brl0(totGeral.custo)}</td>}
            </tr>
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: 11.5, color: C.espL, margin: '8px 2px 0' }}>
        Projetado = pessoas do quadro por turno (prod_posto_turno); Real = pessoas alocadas hoje; Vagas = projetado − real. Mesma base do Cadastro por fluxo.
      </p>
    </div>
  )
}

function SetorBloco({ g, podeCusto, td, tdR }: {
  g: { setor: string; linhas: Linha[]; tot: { proj: number; real: number; gap: number; custo: number | null } }
  podeCusto: boolean; td: React.CSSProperties; tdR: React.CSSProperties
}) {
  const colSpanCabeca = podeCusto ? 10 : 9
  return (
    <>
      <tr style={{ background: '#F6F1E8' }}>
        <td style={{ ...td, fontWeight: 700, color: C.esp }} colSpan={colSpanCabeca}>{g.setor} · {g.linhas.length} posto(s)</td>
      </tr>
      {g.linhas.map((l) => (
        <tr key={l.posto_id}>
          <td style={{ ...td, fontWeight: 600 }}>{l.codigo_po ?? '—'}</td>
          <td style={td}>{l.cargo ?? '—'}</td>
          <td style={td}>{l.atividade ?? '—'}</td>
          <td style={tdR}>{l.proj_t1 || '—'}</td>
          <td style={tdR}>{l.proj_t2 || '—'}</td>
          <td style={tdR}>{l.proj_t3 || '—'}</td>
          <td style={tdR}>{nf0.format(l.proj_total)}</td>
          <td style={tdR}>{nf0.format(l.real)}</td>
          <td style={{ ...tdR, color: l.gap > 0 ? C.amber : C.esp, fontWeight: l.gap > 0 ? 700 : 400 }}>{l.gap > 0 ? nf0.format(l.gap) : '—'}</td>
          {podeCusto && <td style={tdR}>{brl0(l.custo)}</td>}
        </tr>
      ))}
      <tr style={{ background: C.white, fontWeight: 600 }}>
        <td style={{ ...td, color: C.espM }} colSpan={6}>Subtotal {g.setor}</td>
        <td style={tdR}>{nf0.format(g.tot.proj)}</td>
        <td style={tdR}>{nf0.format(g.tot.real)}</td>
        <td style={{ ...tdR, color: g.tot.gap > 0 ? C.amber : C.esp }}>{nf0.format(g.tot.gap)}</td>
        {podeCusto && <td style={tdR}>{brl0(g.tot.custo)}</td>}
      </tr>
    </>
  )
}
