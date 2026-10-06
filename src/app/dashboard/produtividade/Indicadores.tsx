'use client'

// Produtividade · aba Indicadores (Fase 2, MVP). kg por homem-hora por setor e por dia = produção do setor
// (vínculo de produção) ÷ horas trabalhadas no ponto (vínculo de ponto). Sem dado = "sem dado" (nunca zero).
// Meta por setor é editável aqui; sem meta só mostra o realizado (sem semáforo).

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

const C = {
  esp: '#3D2314', espM: '#6B5D4F', espL: '#9C8E80', white: '#FFFFFF', cream: '#F0ECE3', border: '#E0D8CC',
  gold: '#C8941A', green: '#166534', greenBg: '#ECFDF5', amber: '#BA7517', amberBg: '#FAEEDA', red: '#B42318', redBg: '#FCEBEB',
}
const inp: React.CSSProperties = { padding: '7px 9px', fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 7, background: C.white, color: C.esp, outline: 'none' }

type Dia = { data: string; kg: number | null; horas: number | null; extras_h: number | null; pessoas: number | null; kg_hh: number | null }
type Setor = {
  setor_id: string; setor: string; plant_id: string; tem_vinculo_ponto: boolean; tem_vinculo_producao: boolean; meta_kg_hh: number | null
  resumo: { kg: number | null; horas: number | null; extras_h: number | null; pessoas_media: number | null; dias_medidos: number; kg_hh: number | null }
  dias: Dia[]
}
type Resp = { ok: boolean; erro?: string; setores: Setor[] }

const iso = (d: Date) => d.toISOString().slice(0, 10)
const fmt = (n: number | null | undefined, c = 1) => n == null ? 'sem dado' : n.toLocaleString('pt-BR', { minimumFractionDigits: c, maximumFractionDigits: c })
const dm = (s: string) => s.slice(8, 10) + '/' + s.slice(5, 7)

function Q({ t }: { t: string }) {
  const [on, setOn] = useState(false)
  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      <button type="button" aria-label="Como é calculado" title={t} onClick={() => setOn((v) => !v)}
        style={{ marginLeft: 5, width: 17, height: 17, borderRadius: 9, border: `1px solid ${C.espL}`, background: C.white, color: C.espM, fontSize: 11, fontWeight: 700, cursor: 'pointer', lineHeight: '14px', padding: 0 }}>?</button>
      {on && <span className="no-print" style={{ position: 'absolute', left: 0, top: 22, zIndex: 5, width: 250, background: C.esp, color: C.white, fontSize: 12, padding: '8px 10px', borderRadius: 8, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>{t}</span>}
    </span>
  )
}

function semaforo(v: number | null, meta: number | null) {
  if (v == null || meta == null) return null
  const r = v / meta
  return r >= 1 ? { c: C.green, bg: C.greenBg, t: 'Na meta' } : r >= 0.9 ? { c: C.amber, bg: C.amberBg, t: 'Perto da meta' } : { c: C.red, bg: C.redBg, t: 'Abaixo da meta' }
}

function Grafico({ dias, meta }: { dias: Dia[]; meta: number | null }) {
  const pts = dias.filter((d) => d.kg_hh != null)
  if (pts.length === 0) return <div style={{ fontSize: 13, color: C.espL }}>sem dado no período</div>
  const max = Math.max(...pts.map((d) => d.kg_hh as number), meta ?? 0) * 1.1
  const w = 100 / pts.length
  return (
    <svg viewBox="0 0 100 40" preserveAspectRatio="none" style={{ width: '100%', height: 140, background: C.cream, borderRadius: 8 }} role="img" aria-label="kg por homem-hora por dia">
      {pts.map((d, i) => <rect key={d.data} x={i * w + w * 0.15} width={w * 0.7} y={40 - ((d.kg_hh as number) / max) * 38} height={((d.kg_hh as number) / max) * 38} fill={C.gold}><title>{dm(d.data)}: {fmt(d.kg_hh, 1)} kg/h-h</title></rect>)}
      {meta != null && <line x1="0" x2="100" y1={40 - (meta / max) * 38} y2={40 - (meta / max) * 38} stroke={C.red} strokeWidth="0.4" strokeDasharray="1.5 1" vectorEffect="non-scaling-stroke" />}
    </svg>
  )
}

export default function Indicadores() {
  const { selInfo, sel } = useCompanyIds()
  const companyId = selInfo.tipo === 'empresa' && sel ? sel : null
  const hoje = useMemo(() => new Date(), [])
  const [inicio, setInicio] = useState(iso(new Date(hoje.getTime() - 29 * 864e5)))
  const [fim, setFim] = useState(iso(hoje))
  const [setorSel, setSetorSel] = useState('')
  const [dados, setDados] = useState<Setor[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(false)

  const carregar = useCallback(async () => {
    if (!companyId) return
    setCarregando(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_prod_indicadores', { p_company: companyId, p_inicio: inicio, p_fim: fim, p_setor: null })
    setCarregando(false)
    if (error) { setErro(error.message); return }
    const r = data as Resp
    if (!r?.ok) { setErro(r?.erro === 'periodo_invalido' ? 'Período inválido (máximo 92 dias).' : 'Sem acesso a estes indicadores.'); setDados(null); return }
    setDados(r.setores)
  }, [companyId, inicio, fim])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])

  async function salvarMeta(s: Setor, txt: string) {
    const v = Number(txt.replace(',', '.'))
    if (txt.trim() === '') {
      const { error } = await supabase.from('prod_meta_setor').delete().eq('setor_id', s.setor_id)
      if (error) { setErro(error.message); return }
    } else {
      if (!(v > 0)) { setErro('A meta precisa ser um número maior que zero.'); return }
      const { error } = await supabase.from('prod_meta_setor').upsert({ company_id: companyId, plant_id: s.plant_id, setor_id: s.setor_id, meta_kg_hh: v, updated_at: new Date().toISOString() }, { onConflict: 'setor_id' })
      if (error) { setErro(error.message); return }
    }
    void carregar()
  }

  if (!companyId) return <div style={{ padding: 24, color: C.espM }}>Selecione uma empresa específica no topo.</div>
  const lista = (dados ?? []).filter((s) => !setorSel || s.setor_id === setorSel)
  const desossa = lista.find((s) => /desoss/i.test(s.setor))
  const outros = lista.filter((s) => s !== desossa)

  return (
    <div>
      <style>{`@media print { .no-print { display: none !important } body { background: #fff } }`}</style>
      <div className="no-print" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end', margin: '6px 0 14px' }}>
        <label style={{ fontSize: 12, color: C.espM }}>De<br /><input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} style={inp} /></label>
        <label style={{ fontSize: 12, color: C.espM }}>Até<br /><input type="date" value={fim} onChange={(e) => setFim(e.target.value)} style={inp} /></label>
        <label style={{ fontSize: 12, color: C.espM }}>Setor<br />
          <select value={setorSel} onChange={(e) => setSetorSel(e.target.value)} style={inp}>
            <option value="">Todos</option>
            {(dados ?? []).map((s) => <option key={s.setor_id} value={s.setor_id}>{s.setor}</option>)}
          </select>
        </label>
        <button onClick={() => window.print()} style={{ padding: '8px 14px', fontSize: 13, fontWeight: 700, borderRadius: 8, border: 'none', background: C.gold, color: C.white, cursor: 'pointer' }}>Exportar PDF</button>
      </div>
      {erro && <div style={{ background: C.redBg, color: C.red, padding: '9px 13px', borderRadius: 8, fontSize: 13, marginBottom: 12 }}>{erro}</div>}
      {carregando && <div style={{ color: C.espM, fontSize: 13 }}>Carregando…</div>}
      {dados && lista.length === 0 && <div style={{ color: C.espM }}>Nenhum setor com vínculo de ponto/produção. Faça os vínculos na aba de cadastro.</div>}

      {desossa && <Destaque s={desossa} onMeta={salvarMeta} />}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12, marginTop: 14 }}>
        {outros.map((s) => <CartaoSetor key={s.setor_id} s={s} onMeta={salvarMeta} />)}
      </div>
      <p style={{ fontSize: 11.5, color: C.espL, marginTop: 16 }}>
        Dias com menos de 5 pessoas no ponto não entram no kg/homem-hora (dado incompleto). Horas extras = horas acima de 8h48 por pessoa/dia. Faltas e comparação entre turnos: sem dado nesta versão (o ponto não registra ausência; a produção não traz o turno).
      </p>
    </div>
  )
}

function Numero({ rot, val, ajuda }: { rot: string; val: string; ajuda: string }) {
  return (
    <div style={{ minWidth: 90 }}>
      <div style={{ fontSize: 11, color: C.espL, textTransform: 'uppercase', letterSpacing: 0.5 }}>{rot}<Q t={ajuda} /></div>
      <div style={{ fontSize: 18, fontWeight: 700 }}>{val}</div>
    </div>
  )
}

const AJ = {
  kghh: 'kg por homem-hora = kg produzidos no setor ÷ horas trabalhadas no ponto pelas pessoas do setor. Produção: ATAK (romaneios do setor). Horas: ponto eletrônico. Só dias com produção e ao menos 5 pessoas.',
  kg: 'Soma dos kg produzidos nos dias medidos (ATAK, vínculo de produção do setor).',
  horas: 'Soma das horas trabalhadas no ponto pelas pessoas vinculadas ao setor.',
  pessoas: 'Média de pessoas com horas no ponto por dia.',
  extras: 'Horas trabalhadas acima de 8h48 por pessoa/dia (jornada padrão), vindas do ponto.',
}

function MetaEdit({ s, onMeta }: { s: Setor; onMeta: (s: Setor, v: string) => void }) {
  const [v, setV] = useState(s.meta_kg_hh != null ? String(s.meta_kg_hh) : '')
  return (
    <label className="no-print" style={{ fontSize: 12, color: C.espM }}>Meta kg/h-h
      <input value={v} inputMode="decimal" placeholder="sem meta" onChange={(e) => setV(e.target.value)} onBlur={() => { if (v !== (s.meta_kg_hh != null ? String(s.meta_kg_hh) : '')) onMeta(s, v) }}
        style={{ ...inp, width: 90, marginLeft: 6 }} />
    </label>
  )
}

function Semaf({ s }: { s: Setor }) {
  const sm = semaforo(s.resumo.kg_hh, s.meta_kg_hh)
  return sm ? <span style={{ background: sm.bg, color: sm.c, fontSize: 12, fontWeight: 700, padding: '3px 9px', borderRadius: 10 }}>{sm.t}</span> : null
}

function CartaoSetor({ s, onMeta }: { s: Setor; onMeta: (s: Setor, v: string) => void }) {
  const r = s.resumo
  const motivo = !s.tem_vinculo_producao ? 'sem vínculo de produção' : !s.tem_vinculo_ponto ? 'sem vínculo de ponto' : null
  return (
    <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <b>{s.setor}</b><Semaf s={s} />
      </div>
      <div style={{ margin: '8px 0' }}><Numero rot="kg / homem-hora" val={fmt(r.kg_hh, 1)} ajuda={AJ.kghh} /></div>
      {motivo && <div style={{ fontSize: 12, color: C.amber }}>{motivo}</div>}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', margin: '8px 0' }}>
        <Numero rot="Pessoas/dia" val={fmt(r.pessoas_media, 1)} ajuda={AJ.pessoas} />
        <Numero rot="Horas" val={fmt(r.horas, 0)} ajuda={AJ.horas} />
        <Numero rot="Extras (h)" val={fmt(r.extras_h, 0)} ajuda={AJ.extras} />
      </div>
      <MetaEdit key={String(s.meta_kg_hh)} s={s} onMeta={onMeta} />
    </div>
  )
}

function Destaque({ s, onMeta }: { s: Setor; onMeta: (s: Setor, v: string) => void }) {
  const r = s.resumo
  const med = s.dias.filter((d) => d.kg_hh != null)
  const melhor = med.reduce<Dia | null>((a, d) => (a == null || (d.kg_hh as number) > (a.kg_hh as number) ? d : a), null)
  const pior = med.reduce<Dia | null>((a, d) => (a == null || (d.kg_hh as number) < (a.kg_hh as number) ? d : a), null)
  const m = Math.floor(med.length / 2)
  const media = (a: Dia[]) => a.length ? a.reduce((t, d) => t + (d.kg_hh as number), 0) / a.length : null
  const p1 = media(med.slice(0, m)), p2 = media(med.slice(m))
  const tend = p1 != null && p2 != null && med.length >= 4 ? (p2 - p1) / p1 : null
  return (
    <div style={{ background: C.white, border: `2px solid ${C.gold}`, borderRadius: 14, padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div><div style={{ fontSize: 11, color: C.gold, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>Em destaque</div><b style={{ fontSize: 20 }}>{s.setor}</b></div>
        <Semaf s={s} />
      </div>
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', margin: '12px 0' }}>
        <Numero rot="kg / homem-hora" val={fmt(r.kg_hh, 1)} ajuda={AJ.kghh} />
        <Numero rot="kg produzidos" val={fmt(r.kg, 0)} ajuda={AJ.kg} />
        <Numero rot="Horas" val={fmt(r.horas, 0)} ajuda={AJ.horas} />
        <Numero rot="Pessoas/dia" val={fmt(r.pessoas_media, 1)} ajuda={AJ.pessoas} />
        <Numero rot="Extras (h)" val={fmt(r.extras_h, 0)} ajuda={AJ.extras} />
      </div>
      <Grafico dias={s.dias} meta={s.meta_kg_hh} />
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', margin: '10px 0', fontSize: 13 }}>
        <span>Melhor dia: <b>{melhor ? `${dm(melhor.data)} · ${fmt(melhor.kg_hh, 1)}` : 'sem dado'}</b></span>
        <span>Pior dia: <b>{pior ? `${dm(pior.data)} · ${fmt(pior.kg_hh, 1)}` : 'sem dado'}</b></span>
        <span>Tendência (2ª metade × 1ª): <b>{tend == null ? 'sem dado' : `${tend >= 0 ? '+' : ''}${(tend * 100).toFixed(1).replace('.', ',')}%`}</b></span>
      </div>
      <MetaEdit key={String(s.meta_kg_hh)} s={s} onMeta={onMeta} />
    </div>
  )
}
