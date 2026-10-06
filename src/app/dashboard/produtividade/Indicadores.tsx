'use client'

// Produtividade · aba Indicadores (Fase 2 MVP). kg por homem-hora = produção ATAK ÷ horas do ponto,
// por setor e dia. Sem dado = "sem dado" (nunca zero). Meta editável por setor; semáforo só com meta.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

const C = {
  esp: '#3D2314', espM: '#6B5D4F', espL: '#9C8E80', bg: '#FAF7F2', white: '#FFFFFF', border: '#E0D8CC',
  gold: '#C8941A', green: '#166534', greenBg: '#ECFDF5', amber: '#BA7517', amberBg: '#FAEEDA', red: '#B42318', redBg: '#FCEBEB',
}
type Linha = { dia: string; setor: string; pessoas: number | null; horas: number | null; horas_extras: number | null; kg: number | null; kgh: number | null }
type Resp = { ok: boolean; erro?: string; linhas: Linha[]; metas: Record<string, number>; setores: string[]; setores_com_producao: string[] }

const iso = (d: Date) => d.toISOString().slice(0, 10)
const hoje = () => new Date()
const menosDias = (n: number) => { const d = hoje(); d.setDate(d.getDate() - n); return iso(d) }
const fmt = (v: number | null | undefined, c = 1) => v == null ? 'sem dado' : v.toLocaleString('pt-BR', { minimumFractionDigits: c, maximumFractionDigits: c })
const dm = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}`
const soma = (a: (number | null)[]) => a.reduce<number>((t, v) => t + (v ?? 0), 0)

function Ajuda({ t }: { t: string }) {
  return <span title={t} aria-label={t} style={{ display: 'inline-block', width: 15, height: 15, lineHeight: '15px', textAlign: 'center', borderRadius: 8, background: C.border, color: C.espM, fontSize: 10, fontWeight: 700, marginLeft: 5, cursor: 'help' }}>?</span>
}

export default function Indicadores() {
  const { selInfo, sel } = useCompanyIds()
  const companyId = selInfo.tipo === 'empresa' && sel ? sel : null
  const [ini, setIni] = useState(menosDias(30))
  const [fim, setFim] = useState(iso(hoje()))
  const [setor, setSetor] = useState('')
  const [data, setData] = useState<Resp | null>(null)
  const [todosSetores, setTodosSetores] = useState<string[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(false)

  const carregar = useCallback(async () => {
    if (!companyId) return
    setCarregando(true); setErro(null)
    const { data: r, error } = await supabase.rpc('fn_prod_indicadores', { p_company_id: companyId, p_inicio: ini, p_fim: fim, p_setor: setor || null })
    setCarregando(false)
    const j = r as Resp | null
    if (error || !j?.ok) { setErro(error?.message ?? j?.erro ?? 'erro'); setData(null); return }
    setData(j)
    if (!setor) setTodosSetores(j.setores)
  }, [companyId, ini, fim, setor])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])

  const salvarMeta = async (s: string, v: string) => {
    if (!companyId) return
    const n = v.trim() === '' ? null : Number(v.replace(',', '.'))
    if (n != null && !(n > 0)) { setErro('Meta deve ser maior que zero.'); return }
    const { data: r, error } = await supabase.rpc('fn_prod_indicador_meta_salvar', { p_company_id: companyId, p_setor: s, p_meta_kgh: n })
    if (error || !(r as { ok: boolean })?.ok) { setErro(error?.message ?? 'Não foi possível salvar a meta.'); return }
    void carregar()
  }

  const linhas = useMemo(() => data?.linhas ?? [], [data])
  const metas = data?.metas ?? {}
  const resumo = useMemo(() => {
    const m = new Map<string, Linha[]>()
    for (const l of linhas) m.set(l.setor, [...(m.get(l.setor) ?? []), l])
    return [...m.entries()].map(([s, ls]) => {
      const comKgh = ls.filter((l) => l.kgh != null)
      const horasMed = soma(comKgh.map((l) => l.horas)), kgMed = soma(comKgh.map((l) => l.kg))
      return {
        setor: s, dias: ls.length, pessoasMed: ls.length ? soma(ls.map((l) => l.pessoas)) / ls.length : null,
        horas: soma(ls.map((l) => l.horas)), extras: soma(ls.map((l) => l.horas_extras)),
        kg: comKgh.length ? kgMed : null, kgh: comKgh.length && horasMed > 0 ? kgMed / horasMed : null, ls,
      }
    }).sort((a, b) => a.setor.localeCompare(b.setor))
  }, [linhas])

  const semaforo = (kgh: number | null, s: string) => {
    const meta = metas[s]
    if (meta == null || kgh == null) return null
    return kgh >= meta ? { cor: C.green, bg: C.greenBg, t: 'na meta' } : kgh >= meta * 0.9 ? { cor: C.amber, bg: C.amberBg, t: 'perto' } : { cor: C.red, bg: C.redBg, t: 'abaixo' }
  }

  const des = resumo.find((r) => r.setor === 'DESOSSA')
  const desDias = (des?.ls ?? []).filter((l) => l.kgh != null).sort((a, b) => (a.dia < b.dia ? -1 : 1))
  const melhor = desDias.length ? desDias.reduce((a, b) => (b.kgh! > a.kgh! ? b : a)) : null
  const pior = desDias.length ? desDias.reduce((a, b) => (b.kgh! < a.kgh! ? b : a)) : null
  const tend = (() => {
    if (desDias.length < 6) return null
    const h = Math.floor(desDias.length / 2)
    const m = (a: Linha[]) => soma(a.map((l) => l.kg)) / soma(a.map((l) => l.horas))
    const p = m(desDias.slice(0, h)), s = m(desDias.slice(h))
    return { p, s, pct: ((s - p) / p) * 100 }
  })()
  const maxK = Math.max(1, ...desDias.map((l) => l.kgh!))

  if (!companyId) return <div style={{ padding: 30, color: C.espM }}>Selecione uma empresa específica no topo.</div>

  const card: React.CSSProperties = { background: C.white, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 }
  const inp: React.CSSProperties = { padding: '7px 9px', fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 7, background: C.white, color: C.esp }

  return (
    <div data-testid="prod-indicadores" style={{ color: C.esp }}>
      <div className="print:hidden" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', margin: '8px 0 14px' }}>
        <label style={{ fontSize: 12, color: C.espM }}>De&nbsp;<input type="date" value={ini} max={fim} onChange={(e) => setIni(e.target.value)} style={inp} /></label>
        <label style={{ fontSize: 12, color: C.espM }}>Até&nbsp;<input type="date" value={fim} min={ini} onChange={(e) => setFim(e.target.value)} style={inp} /></label>
        <label style={{ fontSize: 12, color: C.espM }}>Setor&nbsp;
          <select value={setor} onChange={(e) => setSetor(e.target.value)} style={inp}>
            <option value="">Todos</option>
            {todosSetores.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <button onClick={() => window.print()} style={{ ...inp, fontWeight: 700, cursor: 'pointer', background: C.gold, color: C.white, border: 'none' }}>Exportar PDF</button>
      </div>

      {erro && <div style={{ background: C.redBg, color: C.red, padding: '9px 13px', borderRadius: 8, fontSize: 13, marginBottom: 12 }}>{erro}</div>}
      {carregando && <div style={{ color: C.espM, fontSize: 13 }}>Carregando…</div>}

      {data && des && (
        <div style={{ ...card, borderColor: C.gold, marginBottom: 16 }} data-testid="prod-desossa">
          <div style={{ fontWeight: 700, fontSize: 16 }}>Desossa — kg por homem-hora<Ajuda t="Produção da desossa (ATAK, perfil PCP0301, movimento F630, por data de estoque) ÷ horas trabalhadas no ponto dos funcionários do setor DESOSSA. Fonte: ATAK + ponto." /></div>
          <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', margin: '10px 0' }}>
            <Kpi t="Média do período" v={fmt(des.kgh)} s="kg/h-h" />
            <Kpi t="Melhor dia" v={melhor ? fmt(melhor.kgh) : 'sem dado'} s={melhor ? dm(melhor.dia) : ''} />
            <Kpi t="Pior dia" v={pior ? fmt(pior.kgh) : 'sem dado'} s={pior ? dm(pior.dia) : ''} />
            <Kpi t="Tendência" v={tend ? `${tend.pct >= 0 ? '+' : ''}${fmt(tend.pct)}%` : 'sem dado'} s={tend ? '2ª metade vs 1ª' : 'período curto'} />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 90, overflowX: 'auto' }}>
            {desDias.map((l) => (
              <div key={l.dia} title={`${dm(l.dia)}: ${fmt(l.kgh)} kg/h-h · ${l.pessoas} pessoas`} style={{ flex: '1 0 14px', maxWidth: 30, textAlign: 'center' }}>
                <div style={{ background: C.gold, height: Math.max(3, (l.kgh! / maxK) * 70), borderRadius: 3 }} />
                <div style={{ fontSize: 9, color: C.espL }}>{dm(l.dia).slice(0, 2)}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11, color: C.espL, marginTop: 6 }}>Comparação entre turnos: sem dado — o ATAK não informa o turno da produção (campo TURNO vazio).</div>
        </div>
      )}

      <div style={{ ...card, overflowX: 'auto' }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Por setor — {dm(ini)} a {dm(fim)}</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 640 }}>
          <thead><tr style={{ textAlign: 'left', color: C.espM }}>
            <th>Setor</th>
            <th>Pessoas/dia<Ajuda t="Média de funcionários com marcação de ponto por dia no setor (departamento do ponto)." /></th>
            <th>Horas<Ajuda t="Soma das horas trabalhadas do ponto (worked_seconds)." /></th>
            <th>Horas extras<Ajuda t="Horas acima de 8h por pessoa por dia, somadas." /></th>
            <th>Produção kg<Ajuda t="ATAK: kg produzidos nos dias em que há ponto e produção. Só ABATE e DESOSSA têm produção medida em kg." /></th>
            <th>kg/h-h<Ajuda t="Produção em kg ÷ horas trabalhadas, nos dias com produção e ponto." /></th>
            <th>Meta<Ajuda t="Meta editável de kg/h-h. Sem meta, só o realizado é mostrado." /></th>
            <th>Faltas<Ajuda t="O ponto só registra quem marcou; ausência sem escala cadastrada não é medida." /></th>
          </tr></thead>
          <tbody>
            {resumo.map((r) => {
              const sm = semaforo(r.kgh, r.setor)
              return (
                <tr key={r.setor} style={{ borderTop: `1px solid ${C.border}` }}>
                  <td style={{ fontWeight: 700 }}>{r.setor}</td>
                  <td>{fmt(r.pessoasMed)}</td><td>{fmt(r.horas)}</td><td>{fmt(r.extras)}</td>
                  <td>{fmt(r.kg, 0)}</td>
                  <td style={{ fontWeight: 700 }}>{fmt(r.kgh)} {sm && <span style={{ background: sm.bg, color: sm.cor, borderRadius: 6, padding: '1px 6px', fontSize: 11 }}>{sm.t}</span>}</td>
                  <td className="print:hidden"><MetaInput valor={metas[r.setor]} onSalvar={(v) => salvarMeta(r.setor, v)} /></td>
                  <td style={{ color: C.espL }}>sem dado</td>
                </tr>
              )
            })}
            {resumo.length === 0 && !carregando && <tr><td colSpan={8} style={{ padding: 16, color: C.espM }}>Sem dado no período.</td></tr>}
          </tbody>
        </table>
        <div style={{ fontSize: 11, color: C.espL, marginTop: 8 }}>Setores sem produção em kg/caixas medida no ATAK mostram “sem dado”. A conversão cabeça→kg não está cadastrada.</div>
      </div>
    </div>
  )
}

function Kpi({ t, v, s }: { t: string; v: string; s: string }) {
  return <div><div style={{ fontSize: 11, color: C.espM }}>{t}</div><div style={{ fontSize: 22, fontWeight: 700 }}>{v}</div><div style={{ fontSize: 11, color: C.espL }}>{s}</div></div>
}

function MetaInput({ valor, onSalvar }: { valor: number | undefined; onSalvar: (v: string) => void }) {
  const [v, setV] = useState(valor == null ? '' : String(valor))
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setV(valor == null ? '' : String(valor)) }, [valor])
  return <input value={v} placeholder="sem meta" inputMode="decimal" onChange={(e) => setV(e.target.value)} onBlur={() => { if (v !== (valor == null ? '' : String(valor))) onSalvar(v) }} style={{ width: 80, padding: '4px 6px', fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 6 }} />
}
