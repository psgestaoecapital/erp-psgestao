'use client'

// Produtividade · Indicadores (Fase 2, MVP). kg por homem-hora por setor e dia = producao ATAK ÷ horas do ponto.
// Setor/dia sem producao ou sem ponto confiavel mostra "sem dado" (nunca zero inventado). Meta editavel por setor;
// semaforo so existe com meta. Desossa em destaque (30 dias). "Exportar PDF" = impressao do navegador.

import { useCallback, useEffect, useMemo, useState, Suspense } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

const C = { esp: '#3D2314', espM: '#6B5D4F', bg: '#FAF7F2', white: '#FFFFFF', border: '#E0D8CC', gold: '#C8941A', green: '#166534', amber: '#BA7517', red: '#B42318' }

type Linha = { setor: string; dia: string; pessoas: number; horas: number; kg: number | null; kg_hh: number | null; motivo_sem_dado: string | null }
type Resp = { ok: boolean; linhas: Linha[]; metas: Record<string, number>; fonte: string; setores_com_producao: string[] }

const iso = (d: Date) => d.toISOString().slice(0, 10)
const fmt = (n: number | null | undefined, c = 1) => (n == null ? 'sem dado' : n.toLocaleString('pt-BR', { maximumFractionDigits: c }))
const Ajuda = ({ t }: { t: string }) => <span title={t} aria-label={t} style={{ cursor: 'help', marginLeft: 4, color: C.gold, fontWeight: 700 }}>?</span>

export default function Page() {
  return <Suspense fallback={<div style={{ padding: 40, background: C.bg }}>Carregando…</div>}><Inner /></Suspense>
}

function Inner() {
  const { selInfo, sel } = useCompanyIds()
  const companyId = selInfo.tipo === 'empresa' && sel ? sel : null
  const [ate, setAte] = useState(iso(new Date()))
  const [de, setDe] = useState(iso(new Date(Date.now() - 29 * 86400000)))
  const [setor, setSetor] = useState('DESOSSA')
  const [r, setR] = useState<Resp | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    if (!companyId) return
    setErro(null)
    const { data, error } = await supabase.rpc('fn_prod_indicadores', { p_company_id: companyId, p_de: de, p_ate: ate })
    if (error) { setErro(error.message); setR(null); return }
    setR(data as Resp)
  }, [companyId, de, ate])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])

  const setores = useMemo(() => Array.from(new Set((r?.linhas ?? []).map((l) => l.setor))).sort(), [r])
  const dias = useMemo(() => (r?.linhas ?? []).filter((l) => l.setor === setor), [r, setor])
  const meta = r?.metas?.[setor] ?? null
  const comDado = dias.filter((d) => d.kg_hh != null)
  const melhor = comDado.reduce<Linha | null>((a, d) => (!a || (d.kg_hh as number) > (a.kg_hh as number) ? d : a), null)
  const pior = comDado.reduce<Linha | null>((a, d) => (!a || (d.kg_hh as number) < (a.kg_hh as number) ? d : a), null)
  const media = comDado.length ? comDado.reduce((s, d) => s + (d.kg_hh as number), 0) / comDado.length : null
  const cor = (v: number | null) => (v == null || meta == null ? C.esp : v >= meta ? C.green : v >= meta * 0.9 ? C.amber : C.red)

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
        <label style={{ fontSize: 13 }}>Meta kg/h-h <input defaultValue={meta ?? ''} key={`${setor}-${meta}`} onBlur={(e) => void salvarMeta(e.target.value)} style={{ width: 70 }} /></label>
        <button onClick={() => window.print()} style={{ padding: '6px 12px', background: C.gold, color: C.white, border: 0, borderRadius: 6, fontWeight: 700 }}>Exportar PDF</button>
      </div>
      {erro && <div style={{ color: C.red, marginBottom: 10 }}>{erro}</div>}
      {!companyId && <div>Selecione uma empresa.</div>}
      {r && !r.setores_com_producao.includes(setor) && <div style={{ background: C.white, border: `1px solid ${C.border}`, padding: 10, borderRadius: 8, marginBottom: 12 }}>Este setor ainda não tem produção medida em kg/caixas: mostramos só pessoas e horas (kg por homem-hora = sem dado).</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 10, marginBottom: 14 }}>
        {[
          ['Média kg/h-h', fmt(media), 'Média dos dias com dado: produção do dia ÷ horas trabalhadas no ponto.', cor(media)],
          ['Melhor dia', melhor ? `${fmt(melhor.kg_hh)} (${melhor.dia.slice(8)}/${melhor.dia.slice(5, 7)})` : 'sem dado', 'Maior kg por homem-hora no período.', C.esp],
          ['Pior dia', pior ? `${fmt(pior.kg_hh)} (${pior.dia.slice(8)}/${pior.dia.slice(5, 7)})` : 'sem dado', 'Menor kg por homem-hora no período.', C.esp],
          ['Meta', meta == null ? 'sem meta' : fmt(meta), 'Definida por você; sem meta não há semáforo.', C.esp],
        ].map(([t, v, h, c]) => (
          <div key={t} style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12 }}>
            <div style={{ fontSize: 12, color: C.espM }}>{t}<Ajuda t={h} /></div>
            <div style={{ fontSize: 20, fontWeight: 800, color: c }}>{v}</div>
          </div>
        ))}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', background: C.white, fontSize: 13 }}>
          <thead><tr style={{ textAlign: 'left' }}>
            <th>Dia</th>
            <th>Pessoas<Ajuda t="Pessoas distintas com horas no ponto no setor." /></th>
            <th>Horas<Ajuda t="Soma das horas trabalhadas (ponto) no setor." /></th>
            <th>kg<Ajuda t="Produção de desossa no ATAK (perfis PCP0301/PCP0302) na data de estoque." /></th>
            <th>kg/h-h<Ajuda t="kg ÷ horas. Dia com menos de 5 pessoas no ponto = sem dado." /></th>
          </tr></thead>
          <tbody>
            {dias.map((d) => (
              <tr key={d.dia} style={{ borderTop: `1px solid ${C.border}` }}>
                <td>{d.dia.slice(8)}/{d.dia.slice(5, 7)}</td><td>{fmt(d.pessoas, 0)}</td><td>{fmt(d.horas)}</td><td>{fmt(d.kg, 0)}</td>
                <td style={{ fontWeight: 700, color: cor(d.kg_hh) }} title={d.motivo_sem_dado ?? ''}>{fmt(d.kg_hh)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
