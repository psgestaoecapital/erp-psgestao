'use client'

// Produtividade · Fase 2 (MVP) · kg por homem-hora por setor e dia. Le fn_prod_indicadores (so leitura);
// meta por setor editavel (fn_prod_meta_salvar). Sem dado = "sem dado", nunca zero. PDF = impressao do navegador.

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

const C = {
  esp: '#3D2314', espM: '#6B5D4F', espL: '#9C8E80', white: '#FFFFFF', cream: '#F0ECE3', border: '#E0D8CC',
  gold: '#C8941A', green: '#166534', greenBg: '#ECFDF5', amber: '#BA7517', amberBg: '#FAEEDA', red: '#B42318', redBg: '#FCEBEB',
}
const inp: React.CSSProperties = { padding: '7px 9px', fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 7, background: C.white, color: C.esp }

type Dia = { data: string; kg: number | null; pessoas: number | null; horas: number | null; horas_extras: number | null; kg_hh: number | null }
type Setor = {
  setor: string; fonte_producao: string; fonte_ponto: string; meta_kg_hh: number | null
  kg: number | null; horas: number | null; horas_extras: number | null; pessoas_media: number | null
  dias_medidos: number; kg_hh: number | null; dias: Dia[]
}
type Resp = { ok: boolean; erro?: string; setores?: Setor[]; lacunas?: string[] }

const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
const fmt = (n: number | null | undefined, c = 1) => n == null ? 'sem dado' : n.toLocaleString('pt-BR', { minimumFractionDigits: c, maximumFractionDigits: c })
const dm = (s: string) => s.slice(8, 10) + '/' + s.slice(5, 7)

function Ajuda({ texto }: { texto: string }) {
  return <span title={texto} aria-label={texto} style={{ display: 'inline-block', marginLeft: 5, width: 16, height: 16, lineHeight: '16px', textAlign: 'center', borderRadius: 8, background: C.cream, color: C.espM, fontSize: 11, fontWeight: 700, cursor: 'help' }}>?</span>
}

function cor(v: number | null, meta: number | null) {
  if (v == null || meta == null) return { fg: C.esp, bg: C.cream }
  if (v >= meta) return { fg: C.green, bg: C.greenBg }
  if (v >= meta * 0.9) return { fg: C.amber, bg: C.amberBg }
  return { fg: C.red, bg: C.redBg }
}

export default function IndicadoresProdutividade({ companyId }: { companyId: string }) {
  const hoje = new Date()
  const [inicio, setInicio] = useState(iso(new Date(hoje.getTime() - 29 * 86400000)))
  const [fim, setFim] = useState(iso(hoje))
  const [setorSel, setSetorSel] = useState('')
  const [r, setR] = useState<Resp | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [metaTxt, setMetaTxt] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setCarregando(true)
    const { data, error } = await supabase.rpc('fn_prod_indicadores', { p_company_id: companyId, p_inicio: inicio, p_fim: fim, p_setor: setorSel || null })
    setCarregando(false)
    if (error) { setR({ ok: false, erro: 'Falha ao carregar os indicadores.' }); return }
    const resp = data as Resp
    setR(resp)
    if (resp.ok) setMetaTxt(Object.fromEntries((resp.setores ?? []).map((s) => [s.setor, s.meta_kg_hh == null ? '' : String(s.meta_kg_hh).replace('.', ',')])))
  }, [companyId, inicio, fim, setorSel])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])

  async function salvarMeta(setor: string) {
    const t = (metaTxt[setor] ?? '').trim().replace(',', '.')
    const v = t === '' ? null : Number(t)
    if (v !== null && (!Number.isFinite(v) || v <= 0)) { setMsg('Meta inválida: informe um número maior que zero.'); return }
    const { data, error } = await supabase.rpc('fn_prod_meta_salvar', { p_company_id: companyId, p_setor: setor, p_meta: v })
    const d = data as { ok: boolean; erro?: string } | null
    if (error || !d?.ok) { setMsg('Não foi possível salvar a meta.'); return }
    setMsg(v === null ? `Meta de ${setor} removida.` : `Meta de ${setor} salva.`)
    window.setTimeout(() => setMsg(null), 3000)
    void carregar()
  }

  const setores = r?.setores ?? []
  const desossa = setores.find((s) => s.setor === 'DESOSSA')

  return (
    <div>
      <style>{`@media print { nav, aside, .no-print { display: none !important } body { background: #fff } }`}</style>
      <div className="no-print" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', margin: '4px 0 14px' }}>
        <label style={{ fontSize: 12, color: C.espM }}>De&nbsp;<input type="date" value={inicio} max={fim} onChange={(e) => setInicio(e.target.value)} style={inp} /></label>
        <label style={{ fontSize: 12, color: C.espM }}>Até&nbsp;<input type="date" value={fim} min={inicio} onChange={(e) => setFim(e.target.value)} style={inp} /></label>
        <label style={{ fontSize: 12, color: C.espM }}>Setor&nbsp;
          <select value={setorSel} onChange={(e) => setSetorSel(e.target.value)} style={inp}>
            <option value="">Todos</option><option value="DESOSSA">Desossa</option><option value="ABATE">Abate</option>
          </select>
        </label>
        <button onClick={() => window.print()} style={{ ...inp, background: C.gold, color: C.white, fontWeight: 700, border: 'none', cursor: 'pointer' }}>Exportar PDF</button>
      </div>
      {msg && <div style={{ background: C.amberBg, color: C.amber, padding: '8px 12px', borderRadius: 8, fontSize: 13, marginBottom: 10 }}>{msg}</div>}
      {carregando && <div style={{ color: C.espM, fontSize: 13 }}>Carregando…</div>}
      {r && !r.ok && <div style={{ background: C.redBg, color: C.red, padding: '9px 13px', borderRadius: 8, fontSize: 13 }}>{r.erro === 'periodo_invalido' ? 'Período inválido (máximo 120 dias).' : r.erro === 'sem_acesso' ? 'Sem acesso a esta empresa.' : r.erro}</div>}

      {desossa && <DesossaDestaque s={desossa} />}

      {setores.map((s) => {
        const k = cor(s.kg_hh, s.meta_kg_hh)
        return (
          <section key={s.setor} style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, margin: '14px 0' }}>
            <h2 style={{ fontSize: 17, margin: 0, color: C.esp }}>{s.setor === 'DESOSSA' ? 'Desossa' : 'Abate'}</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10, margin: '10px 0' }}>
              <Kpi rotulo="kg / homem-hora" valor={fmt(s.kg_hh, 2)} cor={k} ajuda={`Produção (kg) ÷ horas trabalhadas, só dias completos. Produção: ${s.fonte_producao}. Horas: ${s.fonte_ponto}.`} />
              <Kpi rotulo="Produção (kg)" valor={fmt(s.kg, 0)} ajuda={`Soma do QTDE_KG dos dias medidos. Fonte: ${s.fonte_producao}.`} />
              <Kpi rotulo="Horas trabalhadas" valor={fmt(s.horas, 1)} ajuda={`Soma das horas do ponto (worked_seconds) nos dias medidos. Fonte: ${s.fonte_ponto}.`} />
              <Kpi rotulo="Pessoas / dia (média)" valor={fmt(s.pessoas_media, 1)} ajuda="Média de colaboradores distintos com ponto por dia, no setor." />
              <Kpi rotulo="Horas extras" valor={fmt(s.horas_extras, 1)} ajuda="Horas trabalhadas acima de 8h por pessoa/dia, somadas no período." />
              <Kpi rotulo="Faltas" valor="sem dado" ajuda="O ponto registra só dia trabalhado; falta ainda não é medida." />
            </div>
            <div className="no-print" style={{ fontSize: 12.5, color: C.espM, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              Meta (kg/homem-hora)<Ajuda texto="Opcional. Sem meta, a tela mostra só o realizado; com meta, o número ganha semáforo (verde ≥ meta, âmbar ≥ 90%, vermelho abaixo)." />
              <input inputMode="decimal" value={metaTxt[s.setor] ?? ''} onChange={(e) => setMetaTxt((m) => ({ ...m, [s.setor]: e.target.value }))} placeholder="sem meta" style={{ ...inp, width: 100 }} />
              <button onClick={() => void salvarMeta(s.setor)} style={{ ...inp, cursor: 'pointer', fontWeight: 700 }}>Salvar meta</button>
            </div>
            <div style={{ overflowX: 'auto', marginTop: 10 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead><tr style={{ color: C.espM, textAlign: 'right' }}>
                  <th style={{ textAlign: 'left', padding: 5 }}>Dia</th><th>Produção kg</th><th>Pessoas</th><th>Horas</th><th>H. extras</th>
                  <th>kg/h-h<Ajuda texto="kg ÷ horas do dia. “sem dado” = dia incompleto (menos de 5 pessoas ou menos de 4h por pessoa) ou sem produção/ponto." /></th>
                </tr></thead>
                <tbody>{s.dias.map((d) => {
                  const c = cor(d.kg_hh, s.meta_kg_hh)
                  return <tr key={d.data} style={{ borderTop: `1px solid ${C.border}`, textAlign: 'right' }}>
                    <td style={{ textAlign: 'left', padding: 5 }}>{dm(d.data)}</td><td>{fmt(d.kg, 0)}</td><td>{d.pessoas ?? 'sem dado'}</td>
                    <td>{fmt(d.horas, 1)}</td><td>{fmt(d.horas_extras, 1)}</td>
                    <td style={{ fontWeight: 700, color: c.fg, background: c.bg }}>{fmt(d.kg_hh, 2)}</td></tr>
                })}</tbody>
              </table>
              {s.dias.length === 0 && <div style={{ color: C.espM, fontSize: 13, padding: 8 }}>sem dado no período.</div>}
            </div>
          </section>
        )
      })}

      {(r?.lacunas ?? []).length > 0 && (
        <div style={{ fontSize: 12, color: C.espM, margin: '10px 0' }}>
          <b>Limites desta versão:</b>
          <ul style={{ margin: '4px 0 0 18px', padding: 0 }}>{(r?.lacunas ?? []).map((l) => <li key={l}>{l}</li>)}</ul>
        </div>
      )}
    </div>
  )
}

function Kpi({ rotulo, valor, ajuda, cor: k }: { rotulo: string; valor: string; ajuda: string; cor?: { fg: string; bg: string } }) {
  return (
    <div style={{ background: k?.bg ?? C.cream, borderRadius: 10, padding: '10px 12px' }}>
      <div style={{ fontSize: 11.5, color: C.espM }}>{rotulo}<Ajuda texto={ajuda} /></div>
      <div style={{ fontSize: 20, fontWeight: 700, color: k?.fg ?? C.esp }}>{valor}</div>
    </div>
  )
}

function DesossaDestaque({ s }: { s: Setor }) {
  const ok = s.dias.filter((d) => d.kg_hh != null)
  if (ok.length === 0) return <div style={{ background: C.amberBg, color: C.amber, padding: 12, borderRadius: 10, fontSize: 13, margin: '8px 0' }}>Desossa: sem dia completo medido no período.</div>
  const melhor = ok.reduce((a, b) => (b.kg_hh! > a.kg_hh! ? b : a))
  const pior = ok.reduce((a, b) => (b.kg_hh! < a.kg_hh! ? b : a))
  const metade = Math.floor(ok.length / 2)
  const med = (xs: Dia[]) => xs.reduce((t, d) => t + d.kg_hh!, 0) / xs.length
  const tend = ok.length >= 4 ? med(ok.slice(metade)) - med(ok.slice(0, metade)) : null
  const max = Math.max(...ok.map((d) => d.kg_hh!))
  return (
    <section style={{ background: C.esp, color: C.white, borderRadius: 12, padding: 14, margin: '8px 0' }}>
      <div style={{ fontSize: 13, opacity: .85 }}>Projeto Produtividade na Desossa<Ajuda texto="kg de produto acabado da Desossa ÷ horas-homem do ponto (departamento DESOSSA), por dia completo. Melhor/pior = maior/menor dia; tendência = média da 2ª metade do período menos a da 1ª." /></div>
      <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', margin: '6px 0 10px', fontSize: 14 }}>
        <span>Média <b style={{ fontSize: 22 }}>{fmt(s.kg_hh, 2)}</b> kg/h-h</span>
        <span>Melhor <b>{dm(melhor.data)}</b> · {fmt(melhor.kg_hh, 2)}</span>
        <span>Pior <b>{dm(pior.data)}</b> · {fmt(pior.kg_hh, 2)}</span>
        <span>Tendência <b>{tend == null ? 'sem dado' : (tend >= 0 ? '▲ ' : '▼ ') + fmt(Math.abs(tend), 2)}</b></span>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 70 }}>
        {ok.map((d) => <div key={d.data} title={`${dm(d.data)}: ${fmt(d.kg_hh, 2)} kg/h-h`} style={{ flex: 1, minWidth: 4, background: C.gold, height: `${Math.max(6, (d.kg_hh! / max) * 100)}%`, borderRadius: 2 }} />)}
      </div>
    </section>
  )
}
