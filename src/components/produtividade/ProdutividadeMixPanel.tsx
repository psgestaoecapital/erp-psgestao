'use client'
// Produtividade por posto, pelo MIX de entrada (CEO 25/11). Por raia e por posto: horas padrão (entrada da raia ×
// tempo padrão do posto) × horas reais (ponto das pessoas escaladas) = produtividade %. Quando falta dado, mostra o
// motivo (sem tempo padrão, sem escala, sem entrada). Consome fn_prod_produtividade_mix. RD-95 "?" em todo campo/
// coluna; RD-100 "sistema vinculado".
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { erroAmigavel } from '@/lib/erroAmigavel'

const ROTA = '/dashboard/produtividade/indicadores'
const C = { esp: '#3D2314', espM: '#6B5D4F', bg: '#FAF7F2', white: '#FFFFFF', line: '#E0D8CC', gold: '#C8941A', green: '#166534', amber: '#92400E', amberBg: '#FEF6E7', red: '#B42318', mut: 'rgba(61,35,20,0.55)' }
const Aj = ({ k }: { k: string }) => <AjudaCampo chave={k} rota={ROTA} />
const inp: React.CSSProperties = { padding: '6px 8px', fontSize: 13, border: `1px solid ${C.line}`, borderRadius: 7, background: '#fff', color: C.esp }
const th: React.CSSProperties = { textAlign: 'right', fontSize: 11.5, color: C.mut, fontWeight: 600, padding: '7px 9px', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { textAlign: 'right', fontSize: 13, color: C.esp, padding: '8px 9px', borderTop: `0.5px solid ${C.line}`, whiteSpace: 'nowrap' }

const num = (n: number | null | undefined, c = 2) => n == null ? '—' : n.toLocaleString('pt-BR', { maximumFractionDigits: c })
const pct = (n: number | null | undefined) => n == null ? '—' : `${num(n)}%`
const hrs = (n: number | null | undefined) => n == null ? '—' : `${num(n)} h`
const kg = (n: number | null | undefined) => n == null ? '—' : `${num(n, 0)} kg`
const primeiroDiaMes = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01` }
const hoje = () => new Date().toISOString().slice(0, 10)
const rotuloFonte = (f: string | null) => f === 'sistema_vinculado' ? 'sistema vinculado' : f === 'apontamento' ? 'apontamento' : '—'
const rotuloMotivo = (s: string) => s === 'sem_entrada' ? 'sem entrada no período' : s === 'sem_tempo_padrao' ? 'sem tempo padrão medido' : s === 'sem_escala' ? 'sem escala / ponto' : ''

type Plant = { id: string; nome_planta: string }
type Fluxo = { id: string; nome: string }
type Posto = { posto_id: string; posto_nome: string; seg_por_kg: number | null; horas_padrao: number | null; horas_reais: number | null; produtividade_pct: number | null; kg_por_homem_hora: number | null; status: string }
type Raia = { fluxo_id: string; fluxo_nome: string; entrada_kg: number | null; saida_kg: number | null; fonte: string | null; postos: Posto[] }
type Resp = { ok?: boolean; erro?: string; raias?: Raia[] }

export default function ProdutividadeMixPanel({ companyId }: { companyId: string | null }) {
  const [plants, setPlants] = useState<Plant[]>([])
  const [plantId, setPlantId] = useState<string | null>(null)
  const [fluxos, setFluxos] = useState<Fluxo[]>([])
  const [fluxoId, setFluxoId] = useState<string>('')
  const [ini, setIni] = useState(primeiroDiaMes())
  const [fim, setFim] = useState(hoje())
  const [raias, setRaias] = useState<Raia[] | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!companyId) { setPlants([]); setPlantId(null); return }
    void (async () => {
      const { data } = await supabase.from('industrial_plants').select('id, nome_planta').eq('company_id', companyId).eq('is_active', true).order('nome_planta')
      const ps = (data ?? []) as Plant[]
      setPlants(ps); setPlantId((p) => (p && ps.some((x) => x.id === p) ? p : ps[0]?.id ?? null))
    })()
  }, [companyId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!companyId || !plantId) { setFluxos([]); return }
    void (async () => {
      const { data } = await supabase.from('prod_fluxo').select('id, nome').eq('company_id', companyId).eq('plant_id', plantId).eq('ativo', true).is('deleted_at', null).order('ordem')
      setFluxos((data ?? []) as Fluxo[])
    })()
  }, [companyId, plantId])

  const carregar = useCallback(async () => {
    if (!companyId || !plantId) { setRaias(null); return }
    setCarregando(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_prod_produtividade_mix', { p_company_id: companyId, p_plant_id: plantId, p_data_ini: ini, p_data_fim: fim, p_fluxo_id: fluxoId || null })
    setCarregando(false)
    if (error) { setErro(erroAmigavel(error, 'Não foi possível carregar a produtividade. Tente de novo.')); setRaias(null); return }
    const r = (data ?? {}) as Resp
    if (!r.ok) { setErro(r.erro === 'periodo_maximo' ? 'O período não pode passar de 120 dias.' : r.erro === 'periodo_invalido' ? 'Período inválido.' : 'Não foi possível carregar a produtividade.'); setRaias(null); return }
    setRaias(r.raias ?? [])
  }, [companyId, plantId, ini, fim, fluxoId])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])

  if (!companyId) return <div style={{ color: C.mut, fontSize: 13, padding: 20 }}>Selecione uma empresa para ver a produtividade por posto.</div>
  if (plants.length === 0) return <div style={{ color: C.mut, fontSize: 13, padding: 20 }}>Esta empresa não tem planta industrial cadastrada.</div>

  return (
    <div>
      <div className="nao-imprimir" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14, background: C.white, border: `1px solid ${C.line}`, borderRadius: 10, padding: 12 }}>
        <label data-ajuda="prod.produtividade.planta" style={{ fontSize: 12, color: C.espM }}>Planta <Aj k="prod.produtividade.planta" /><br />
          <select value={plantId ?? ''} onChange={(e) => setPlantId(e.target.value || null)} style={inp} data-testid="prodmix-planta">
            {plants.map((p) => <option key={p.id} value={p.id}>{p.nome_planta}</option>)}
          </select>
        </label>
        <label data-ajuda="prod.produtividade.raia" style={{ fontSize: 12, color: C.espM }}>Raia (fluxo) <Aj k="prod.produtividade.raia" /><br />
          <select value={fluxoId} onChange={(e) => setFluxoId(e.target.value)} style={inp} data-testid="prodmix-raia">
            <option value="">Todas as raias</option>
            {fluxos.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
          </select>
        </label>
        <label data-ajuda="prod.produtividade.periodo" style={{ fontSize: 12, color: C.espM }}>De <Aj k="prod.produtividade.periodo" /><br />
          <input type="date" value={ini} max={fim} onChange={(e) => setIni(e.target.value)} style={inp} data-testid="prodmix-de" />
        </label>
        <label data-ajuda="prod.produtividade.periodo" style={{ fontSize: 12, color: C.espM }}>Até<br />
          <input type="date" value={fim} min={ini} onChange={(e) => setFim(e.target.value)} style={inp} data-testid="prodmix-ate" />
        </label>
      </div>

      {erro && <div style={{ color: C.red, marginBottom: 10, fontSize: 13 }}>{erro}</div>}
      {carregando && <div style={{ color: C.mut, fontSize: 13 }}>Carregando produtividade…</div>}

      {!carregando && raias && raias.length === 0 && (
        <div style={{ background: C.white, border: `1px dashed ${C.line}`, borderRadius: 10, padding: '26px 16px', textAlign: 'center', color: C.espM, fontSize: 13 }}>
          Nenhuma raia (fluxo) cadastrada nesta planta. Monte o fluxo e os postos no Mapa para medir a produtividade.
          <div style={{ marginTop: 8 }}><Link href="/dashboard/produtividade/mapa" style={{ color: C.gold, fontWeight: 700 }}>Abrir o Mapa do fluxo</Link></div>
        </div>
      )}

      {!carregando && raias && raias.map((r) => (
        <div key={r.fluxo_id} style={{ background: C.white, border: `1px solid ${C.line}`, borderRadius: 10, marginBottom: 14, overflow: 'hidden' }}>
          <div style={{ padding: '12px 14px', borderBottom: `0.5px solid ${C.line}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: C.esp }}>{r.fluxo_nome}</div>
            <div style={{ fontSize: 12.5, color: C.espM }}>entrada {kg(r.entrada_kg)} · saída {kg(r.saida_kg)}{r.fonte ? ` · ${rotuloFonte(r.fonte)}` : ''}</div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 680 }}>
              <thead>
                <tr style={{ background: '#FBF8F3' }}>
                  <th style={{ ...th, textAlign: 'left' }}>Posto</th>
                  <th style={th}>Horas padrão <Aj k="prod.produtividade.horas_padrao" /></th>
                  <th style={th}>Horas reais <Aj k="prod.produtividade.horas_reais" /></th>
                  <th style={th}>Produtividade <Aj k="prod.produtividade.pct" /></th>
                  <th style={th}>kg/homem-hora <Aj k="prod.produtividade.kg_hh" /></th>
                  <th style={th}>Situação <Aj k="prod.produtividade.motivo" /></th>
                </tr>
              </thead>
              <tbody>
                {r.postos.length === 0 && <tr><td colSpan={6} style={{ ...td, textAlign: 'center', color: C.mut }}>Sem postos cadastrados nesta raia.</td></tr>}
                {r.postos.map((p) => {
                  const ok = p.status === 'ok'
                  return (
                    <tr key={p.posto_id}>
                      <td style={{ ...td, textAlign: 'left', fontWeight: 600 }}>{p.posto_nome}</td>
                      <td style={td}>{hrs(p.horas_padrao)}</td>
                      <td style={td}>{hrs(p.horas_reais)}</td>
                      <td style={{ ...td, fontWeight: 700, color: p.produtividade_pct == null ? C.mut : p.produtividade_pct >= 100 ? C.green : C.red }}>{pct(p.produtividade_pct)}</td>
                      <td style={td}>{p.kg_por_homem_hora != null ? `${num(p.kg_por_homem_hora)} kg/h` : '—'}</td>
                      <td style={{ ...td, textAlign: 'left' }}>
                        {ok ? <span style={{ color: C.green, fontSize: 12 }}>medindo</span>
                          : <span style={{ color: C.amber, background: C.amberBg, fontSize: 11.5, padding: '2px 7px', borderRadius: 10 }}>{rotuloMotivo(p.status)}</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  )
}
