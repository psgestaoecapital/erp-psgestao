'use client'

// Produtividade · Indicadores (Fase 2, MVP). kg por homem-hora por setor e dia = producao ATAK ÷ horas do ponto.
// Setor/dia sem producao ou sem ponto confiavel mostra "sem dado" (nunca zero inventado). Meta editavel por setor;
// semaforo so existe com meta. Desossa em destaque (30 dias). "Exportar PDF" = impressao do navegador.

import { useCallback, useEffect, useMemo, useState, Suspense } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

const C = { esp: '#3D2314', espM: '#6B5D4F', bg: '#FAF7F2', white: '#FFFFFF', border: '#E0D8CC', gold: '#C8941A', green: '#166534', amber: '#BA7517', red: '#B42318' }

type Dia = { data: string; kg: number | null; pessoas: number | null; horas: number | null; horas_extras: number | null; kg_hh: number | null; motivo_sem_dado: string | null }
type SetorR = { setor: string; meta_kg_hh: number | null; kg: number | null; horas: number | null; horas_extras: number | null; pessoas_media: number | null; dias_medidos: number; kg_hh: number | null; dias: Dia[] }
type Resp = { ok: boolean; base: string; base_texto: string; fonte: string; lacunas: string[]; setores: SetorR[] }

const BASES = [
  { v: 'PCP0302', t: '1 · Produção da desossa — PCP0302 (padrão)', d: 'Só o que a desossa produz (perfil PCP0302).' },
  { v: 'PCP0301+PCP0302', t: '2 · Tudo que passa na desossa — PCP0301 + PCP0302', d: 'Soma os dois perfis: produção da desossa mais o que entra/passa por ela.' },
  { v: 'PCP0301_F630', t: '3 · Só produto acabado — PCP0301 / F630', d: 'Apenas o produto acabado (perfil PCP0301, movimento F630).' },
]

const iso = (d: Date) => d.toISOString().slice(0, 10)
const fmt = (n: number | null | undefined, c = 1) => (n == null ? 'sem dado' : n.toLocaleString('pt-BR', { maximumFractionDigits: c }))
const Ajuda = ({ t }: { t: string }) => <span title={t} aria-label={t} style={{ cursor: 'help', marginLeft: 4, color: C.gold, fontWeight: 700 }}>?</span>

export default function Page() {
  return <Suspense fallback={<div style={{ padding: 40, background: C.bg }}>Carregando…</div>}><Inner /></Suspense>
}

function Inner() {
  const { selInfo, sel } = useCompanyIds()
  const companyId = selInfo.tipo === 'empresa' && sel ? sel : null
  const [ate, setAte] = useState(() => iso(new Date()))
  const [de, setDe] = useState(() => iso(new Date(Date.now() - 29 * 86400000)))
  const [setor, setSetor] = useState('DESOSSA')
  const [base, setBase] = useState('PCP0302')
  const [r, setR] = useState<Resp | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    if (!companyId) return
    setErro(null)
    const { data, error } = await supabase.rpc('fn_prod_indicadores', { p_company_id: companyId, p_de: de, p_ate: ate, p_setor: null, p_base: base })
    if (error) { setErro(error.message); setR(null); return }
    setR(data as Resp)
  }, [companyId, de, ate, base])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])

  const setores = useMemo(() => (r?.setores ?? []).map((x) => x.setor), [r])
  const sr = useMemo(() => r?.setores.find((x) => x.setor === setor) ?? null, [r, setor])
  const dias = sr?.dias ?? []
  const meta = sr?.meta_kg_hh ?? null
  const comDado = dias.filter((d) => d.kg_hh != null)
  const melhor = comDado.reduce<Dia | null>((a, d) => (!a || (d.kg_hh as number) > (a.kg_hh as number) ? d : a), null)
  const pior = comDado.reduce<Dia | null>((a, d) => (!a || (d.kg_hh as number) < (a.kg_hh as number) ? d : a), null)
  const media = sr?.kg_hh ?? null
  const metade = Math.floor(comDado.length / 2)
  const avg = (xs: Dia[]) => (xs.length ? xs.reduce((t, d) => t + (d.kg_hh as number), 0) / xs.length : null)
  const tendencia = comDado.length >= 4 ? (avg(comDado.slice(metade)) as number) - (avg(comDado.slice(0, metade)) as number) : null
  const maxHH = Math.max(1, ...comDado.map((d) => d.kg_hh as number))
  const cor = (v: number | null) => (v == null || meta == null ? C.esp : v >= meta ? C.green : v >= meta * 0.9 ? C.amber : C.red)
  const dm = (d: string) => `${d.slice(8)}/${d.slice(5, 7)}`

  async function salvarMeta(txt: string) {
    if (!companyId) return
    const n = txt.trim() === '' ? null : Number(txt.replace(',', '.'))
    if (n !== null && !(n > 0)) { setErro('Meta deve ser maior que zero.'); return }
    const { error } = await supabase.rpc('fn_prod_indicador_meta_salvar', { p_company_id: companyId, p_setor: setor, p_meta: n })
    if (error) setErro(error.message); else void carregar()
  }

  return (
    <div style={{ padding: 16, background: C.bg, minHeight: '100vh', color: C.esp, maxWidth: 1100, margin: '0 auto' }}>
      <style>{`@media print { .nao-imprimir { display: none !important } }`}</style>
      <div className="nao-imprimir" style={{ display: 'flex', gap: 14, marginBottom: 12, fontSize: 14 }}>
        <Link href="/dashboard/produtividade" style={{ color: C.espM }}>Cadastro</Link>
        <b style={{ borderBottom: `2px solid ${C.gold}` }}>Indicadores</b>
      </div>
      <h1 style={{ fontSize: 20, margin: '0 0 4px' }}>Produtividade · Indicadores</h1>
      <div style={{ fontSize: 12, color: C.espM, marginBottom: 12 }}>{r?.fonte}</div>
      <div className="nao-imprimir" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        <input type="date" value={de} onChange={(e) => setDe(e.target.value)} aria-label="De" />
        <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} aria-label="Até" />
        <select value={setor} onChange={(e) => setSetor(e.target.value)} aria-label="Setor">
          {[...new Set(['DESOSSA', ...setores])].map((s) => <option key={s}>{s}</option>)}
        </select>
        <select value={base} onChange={(e) => setBase(e.target.value)} aria-label="Base do kg" title="Base do kg">
          {BASES.map((b) => <option key={b.v} value={b.v}>Base do kg: {b.t}</option>)}
        </select>
        <label style={{ fontSize: 13 }}>Meta kg/h-h <input defaultValue={meta ?? ''} key={`${setor}-${meta}`} onBlur={(e) => void salvarMeta(e.target.value)} style={{ width: 70 }} /></label>
        <button onClick={() => window.print()} style={{ padding: '6px 12px', background: C.gold, color: C.white, border: 0, borderRadius: 6, fontWeight: 700 }}>Exportar PDF</button>
      </div>
      {erro && <div style={{ color: C.red, marginBottom: 10 }}>{erro}</div>}
      {!companyId && <div>Selecione uma empresa.</div>}
      <div style={{ background: C.white, border: `1px solid ${C.border}`, padding: 10, borderRadius: 8, marginBottom: 12, fontSize: 13 }}>
        <b>Base do kg<Ajuda t="Define qual produção do ATAK entra no numerador (vale para a Desossa). A Frioeste define a base definitiva na reunião." /></b>: {BASES.find((b) => b.v === base)?.d}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 10, marginBottom: 14 }}>
        {[
          ['Média kg/h-h', fmt(media), 'Média dos dias com dado: produção do dia ÷ horas trabalhadas no ponto.', cor(media)],
          ['Melhor dia', melhor ? `${fmt(melhor.kg_hh)} (${dm(melhor.data)})` : 'sem dado', 'Maior kg por homem-hora no período.', C.esp],
          ['Pior dia', pior ? `${fmt(pior.kg_hh)} (${dm(pior.data)})` : 'sem dado', 'Menor kg por homem-hora no período.', C.esp],
          ['Meta', meta == null ? 'sem meta' : fmt(meta), 'Definida por você; sem meta não há semáforo.', C.esp],
          ['Tendência', tendencia == null ? 'sem dado' : `${tendencia >= 0 ? '+' : ''}${fmt(tendencia)}`, 'Média da 2ª metade dos dias com dado menos a da 1ª metade (kg/h-h).', C.esp],
          ['Pessoas (média)', fmt(sr?.pessoas_media), 'Média de pessoas distintas no ponto por dia.', C.esp],
          ['Horas-homem', fmt(sr?.horas), 'Soma das horas trabalhadas nos dias com dado.', C.esp],
          ['kg no período', fmt(sr?.kg, 0), 'Soma do kg dos dias com dado.', C.esp],
          ['Horas extras', fmt(sr?.horas_extras), 'Horas acima de 8h por pessoa/dia.', C.esp],
        ].map(([t, v, h, c]) => (
          <div key={t} style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12 }}>
            <div style={{ fontSize: 12, color: C.espM }}>{t}<Ajuda t={h} /></div>
            <div style={{ fontSize: 20, fontWeight: 800, color: c }}>{v}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 90, marginBottom: 14, background: C.white, border: `1px solid ${C.border}`, borderRadius: 8, padding: 8 }} aria-label="kg por homem-hora por dia">
        {comDado.map((d) => <div key={d.data} title={`${dm(d.data)}: ${fmt(d.kg_hh)} kg/h-h`} style={{ flex: 1, height: `${((d.kg_hh as number) / maxHH) * 100}%`, background: cor(d.kg_hh) === C.esp ? C.gold : cor(d.kg_hh) }} />)}
        {comDado.length === 0 && <span style={{ fontSize: 13, color: C.espM }}>sem dado no período</span>}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', background: C.white, fontSize: 13 }}>
          <thead><tr style={{ textAlign: 'left' }}>
            <th>Dia</th>
            <th>Pessoas<Ajuda t="Pessoas distintas com horas no ponto no setor." /></th>
            <th>Horas<Ajuda t="Soma das horas trabalhadas (ponto) no setor." /></th>
            <th>kg<Ajuda t="Produção de desossa no ATAK (perfis PCP0301/PCP0302) na data de estoque." /></th>
            <th>H. extras<Ajuda t="Horas acima de 8h por pessoa/dia." /></th>
            <th>kg/h-h<Ajuda t="kg ÷ horas. Dia com menos de 5 pessoas no ponto = sem dado." /></th>
          </tr></thead>
          <tbody>
            {dias.map((d) => (
              <tr key={d.data} style={{ borderTop: `1px solid ${C.border}` }}>
                <td>{dm(d.data)}</td><td>{fmt(d.pessoas, 0)}</td><td>{fmt(d.horas)}</td><td>{fmt(d.kg, 0)}</td><td>{fmt(d.horas_extras)}</td>
                <td style={{ fontWeight: 700, color: cor(d.kg_hh) }} title={d.motivo_sem_dado ?? ''}>{fmt(d.kg_hh)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul style={{ fontSize: 12, color: C.espM, marginTop: 12 }}>{(r?.lacunas ?? []).map((l) => <li key={l}>{l}</li>)}</ul>
    </div>
  )
}
