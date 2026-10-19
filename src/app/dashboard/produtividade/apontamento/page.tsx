'use client'

// Produtividade Industrial · APONTAMENTO hora a hora. Confronta o PRODUZIDO com a CAPACIDADE do
// posto, por hora, e devolve produtividade % e ociosidade % com semáforo. O apontamento é o dado
// de campo (manual, do ponto ou da balança); a capacidade vem do cadastro do posto — em branco =
// "a medir" (nunca "0"). Pessoas presentes é só CONTAGEM, sem nomes. CRIOU/ALTEROU/EXCLUIU.
// O lançamento é idempotente por (fluxo, posto, produto, data, hora): relançar a mesma hora
// corrige o valor, não duplica.

import { useCallback, useEffect, useMemo, useState, Suspense } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ROTA = '/dashboard/produtividade/apontamento'
const Aj = ({ k }: { k: string }) => <AjudaCampo chave={k} rota={ROTA} />

const C = {
  esp: '#3D2314', espM: '#6B5D4F', espL: '#9C8E80', bg: '#FAF7F2', white: '#FFFFFF',
  cream: '#F0ECE3', border: '#E0D8CC', gold: '#C8941A', goldD: '#A57A15', goldBg: '#FDF7E8',
  green: '#166534', greenBg: '#ECFDF5', amber: '#BA7517', amberBg: '#FAEEDA', red: '#B42318', redBg: '#FCEBEB', blue: '#2F5AA8',
}
const inp: React.CSSProperties = { padding: '7px 9px', fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 7, background: C.white, color: C.esp, outline: 'none', minWidth: 0, width: '100%' }
const btn = (on = true): React.CSSProperties => ({ padding: '8px 14px', fontSize: 13, fontWeight: 700, borderRadius: 8, border: 'none', cursor: on ? 'pointer' : 'not-allowed', background: on ? C.gold : C.espL, color: C.white })

type Plant = { id: string; nome_planta: string }
type Fluxo = { id: string; nome: string }
type Posto = { id: string; numero: string; atividade: string; capacidade_hora: number | null }
type Produto = { id: string; codigo: string; nome: string }
type Fonte = 'manual' | 'ponto' | 'balanca'

type ApontarResp = { ok: boolean; id?: string; erro?: string }
type LinhaProd = {
  posto_id: string; posto_numero: string; hora: number; produzido: number;
  capacidade: number | null; produtividade_pct: number | null; ociosidade_pct: number | null; pessoas_presentes: number | null
}
type GridResp = { ok: boolean; data: string; postos: LinhaProd[] }

const hoje = () => new Date().toISOString().slice(0, 10)
const num = (n: number | null, suf = '') => (n == null ? '—' : `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}${suf}`)

// Semáforo da produtividade: ≥90 verde · 70–89 âmbar · <70 vermelho. Sem capacidade = sem semáforo.
function semaforo(pct: number | null): { fg: string; bg: string } | null {
  if (pct == null) return null
  if (pct >= 90) return { fg: C.green, bg: C.greenBg }
  if (pct >= 70) return { fg: C.amber, bg: C.amberBg }
  return { fg: C.red, bg: C.redBg }
}

const ERROS: Record<string, string> = {
  hora_invalida: 'Hora inválida — informe um inteiro de 0 a 23.',
  qtd_invalida: 'Quantidade inválida — informe um número maior que zero.',
  fonte_invalida: 'Fonte inválida — escolha manual, ponto ou balança.',
  fluxo_nao_encontrado: 'Fluxo não encontrado nesta planta.',
  produto_nao_encontrado: 'Produto não encontrado nesta planta.',
}

export default function ApontamentoPage() {
  return <Suspense fallback={<div style={{ padding: 40, color: C.espM, background: C.bg, minHeight: '100vh' }}>Carregando…</div>}><Inner /></Suspense>
}

function Inner() {
  const { selInfo, sel } = useCompanyIds()
  const companyId = selInfo.tipo === 'empresa' && sel ? sel : null

  const [plants, setPlants] = useState<Plant[]>([])
  const [plantId, setPlantId] = useState<string | null>(null)
  const [fluxos, setFluxos] = useState<Fluxo[]>([])
  const [fluxoId, setFluxoId] = useState<string | null>(null)
  const [data, setData] = useState<string>(hoje())
  const [postos, setPostos] = useState<Posto[]>([])
  const [produtos, setProdutos] = useState<Produto[]>([])
  const [grid, setGrid] = useState<LinhaProd[]>([])
  const [carregando, setCarregando] = useState(false)

  // formulário de lançamento
  const [postoId, setPostoId] = useState<string>('')
  const [produtoId, setProdutoId] = useState<string>('')
  const [buscaProd, setBuscaProd] = useState<string>('')
  const [hora, setHora] = useState<string>(String(new Date().getHours()))
  const [qtd, setQtd] = useState<string>('')
  const [unidade, setUnidade] = useState<string>('un')
  const [pessoas, setPessoas] = useState<string>('')
  const [fonte, setFonte] = useState<Fonte>('manual')
  const [salvando, setSalvando] = useState(false)

  const [msg, setMsg] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const flash = useCallback((m: string) => { setMsg(m); setErro(null); window.setTimeout(() => setMsg(null), 3500) }, [])
  const flashErr = useCallback((m: string) => { setErro(m); try { window.scrollTo({ top: 0, behavior: 'smooth' }) } catch { /* */ } window.setTimeout(() => setErro(null), 6000) }, [])

  // plantas da empresa
  useEffect(() => {
    if (!companyId) { setPlants([]); setPlantId(null); return }
    void (async () => {
      const { data: d } = await supabase.from('industrial_plants').select('id, nome_planta').eq('company_id', companyId).eq('is_active', true).order('nome_planta')
      const ps = (d as Plant[]) ?? []
      setPlants(ps); setPlantId((prev) => prev && ps.some((p) => p.id === prev) ? prev : (ps[0]?.id ?? null))
    })()
  }, [companyId])

  // fluxos, postos e produtos da planta
  useEffect(() => {
    if (!companyId || !plantId) { setFluxos([]); setFluxoId(null); setPostos([]); setProdutos([]); return }
    void (async () => {
      const [{ data: fx }, { data: pt }, { data: pr }] = await Promise.all([
        supabase.from('prod_fluxo').select('id, nome').eq('company_id', companyId).eq('plant_id', plantId).order('created_at'),
        supabase.from('prod_posto').select('id, numero, atividade, capacidade_hora').eq('company_id', companyId).eq('plant_id', plantId).eq('ativo', true).order('ordem_linha'),
        supabase.from('prod_produto').select('id, codigo, nome').eq('company_id', companyId).eq('plant_id', plantId).eq('ativo', true).order('codigo'),
      ])
      const lista = (fx as Fluxo[]) ?? []
      setFluxos(lista)
      setFluxoId((prev) => prev && lista.some((f) => f.id === prev) ? prev : (lista[0]?.id ?? null))
      setPostos((pt as Posto[]) ?? [])
      setProdutos((pr as Produto[]) ?? [])
    })()
  }, [companyId, plantId])

  // grade de confronto (produzido × capacidade) por posto e hora
  const carregarGrid = useCallback(async () => {
    if (!companyId || !plantId || !fluxoId) { setGrid([]); return }
    setCarregando(true)
    try {
      const { data: d, error } = await supabase.rpc('fn_prod_produtividade_hora', { p_company_id: companyId, p_plant_id: plantId, p_fluxo_id: fluxoId, p_data: data })
      if (error) { flashErr(error.message); setGrid([]); return }
      const r = d as unknown as GridResp | null
      setGrid(r?.ok ? (r.postos ?? []) : [])
    } finally {
      setCarregando(false)
    }
  }, [companyId, plantId, fluxoId, data, flashErr])
  useEffect(() => { void carregarGrid() }, [carregarGrid])

  // linhas ordenadas por posto (número) e hora
  const linhas = useMemo(() => {
    return [...grid].sort((a, b) => {
      const p = a.posto_numero.localeCompare(b.posto_numero, 'pt-BR', { numeric: true })
      return p !== 0 ? p : a.hora - b.hora
    })
  }, [grid])

  const produtosFiltrados = useMemo(() => {
    const t = buscaProd.trim().toLowerCase()
    if (!t) return produtos
    return produtos.filter((p) => p.codigo.toLowerCase().includes(t) || p.nome.toLowerCase().includes(t))
  }, [produtos, buscaProd])

  const podeSalvar = Boolean(companyId && plantId && fluxoId && postoId && produtoId && qtd.trim() && !salvando)

  async function lancar() {
    if (!companyId || !plantId || !fluxoId) { flashErr('Selecione o fluxo primeiro.'); return }
    if (!postoId) { flashErr('Escolha o posto.'); return }
    if (!produtoId) { flashErr('Escolha o produto.'); return }
    const h = Number(hora)
    if (!Number.isInteger(h) || h < 0 || h > 23) { flashErr('A hora deve ser um inteiro de 0 a 23.'); return }
    const q = Number(qtd.replace(',', '.'))
    if (!(q > 0)) { flashErr('A quantidade produzida deve ser maior que zero.'); return }
    const pessoasNum = pessoas.trim() === '' ? null : Number(pessoas)
    if (pessoasNum != null && (!Number.isInteger(pessoasNum) || pessoasNum < 0)) { flashErr('Pessoas presentes deve ser uma contagem inteira (ou em branco).'); return }

    setSalvando(true)
    try {
      const { data: d, error } = await supabase.rpc('fn_prod_apontar_hora', {
        p_company_id: companyId, p_plant_id: plantId, p_fluxo_id: fluxoId, p_produto_id: produtoId,
        p_data: data, p_hora: h, p_qtd_produzida: q, p_posto_id: postoId, p_etapa_id: null, p_tarefa_id: null,
        p_unidade: unidade.trim() || 'un', p_pessoas_presentes: pessoasNum, p_fonte: fonte,
      })
      if (error) { flashErr(error.message); return }
      const r = d as unknown as ApontarResp | null
      if (!r?.ok) { flashErr(r?.erro ? (ERROS[r.erro] ?? `Não consegui lançar: ${r.erro}`) : 'Não consegui lançar o apontamento.'); return }
      flash('Produção LANÇADA')
      setQtd('')
      await carregarGrid()
    } finally {
      setSalvando(false)
    }
  }

  if (!companyId) return <Aviso texto="Selecione uma empresa específica no topo — o apontamento é por planta." />
  if (plants.length === 0) return <Aviso texto="Esta empresa não tem planta industrial cadastrada. Cadastre a planta antes de apontar." />

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '22px 16px 60px', maxWidth: 1120, margin: '0 auto', color: C.esp }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: C.gold, fontWeight: 700 }}>Indústria · Produtividade</div>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: '2px 0 0' }}>Apontamento hora a hora</h1>
      <p style={{ color: C.espM, fontSize: 13, margin: '6px 0 12px' }}>
        Lance o produzido por posto e hora. A tela confronta com a capacidade do posto e mostra a produtividade e a ociosidade, com semáforo.
      </p>

      {msg && <div style={{ background: C.greenBg, color: C.green, padding: '9px 13px', borderRadius: 8, fontSize: 13, marginBottom: 12 }}>{msg}</div>}
      {erro && <div style={{ background: C.redBg, color: C.red, padding: '9px 13px', borderRadius: 8, fontSize: 13, marginBottom: 12 }}>{erro}</div>}

      {/* Filtros: fluxo + data */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', margin: '6px 0 14px' }}>
        {plants.length > 1 && (
          <label data-ajuda="prod.apont.planta" style={{ fontSize: 12, color: C.espM }}>Planta<Aj k="prod.apont.planta" /><br />
            <select value={plantId ?? ''} onChange={(e) => setPlantId(e.target.value)} style={{ ...inp, width: 'auto', minWidth: 180 }}>
              {plants.map((p) => <option key={p.id} value={p.id}>{p.nome_planta}</option>)}
            </select>
          </label>
        )}
        <label data-ajuda="prod.apont.fluxo" style={{ fontSize: 12, color: C.espM }}>Fluxo<Aj k="prod.apont.fluxo" /><br />
          <select data-testid="apont-fluxo" value={fluxoId ?? ''} onChange={(e) => setFluxoId(e.target.value)} style={{ ...inp, width: 'auto', fontWeight: 700, minWidth: 220 }}>
            {fluxos.length === 0 && <option value="">— nenhum fluxo —</option>}
            {fluxos.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
          </select>
        </label>
        <label data-ajuda="prod.apont.data" style={{ fontSize: 12, color: C.espM }}>Dia<Aj k="prod.apont.data" /><br />
          <input data-testid="apont-data" type="date" value={data} onChange={(e) => setData(e.target.value)} style={{ ...inp, width: 'auto' }} />
        </label>
      </div>

      {!fluxoId ? (
        <Aviso texto="Selecione um fluxo para lançar e ver o confronto do dia." />
      ) : (
        <>
          {/* Formulário de lançamento */}
          <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: '16px 16px 18px', marginBottom: 18 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Lançar apontamento</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
              <label data-ajuda="prod.apont.posto" style={{ fontSize: 12, color: C.espM }}>Posto<Aj k="prod.apont.posto" />
                <select data-testid="apont-posto" value={postoId} onChange={(e) => setPostoId(e.target.value)} style={inp}>
                  <option value="">— escolher posto —</option>
                  {postos.map((p) => <option key={p.id} value={p.id}>{p.numero} · {p.atividade}</option>)}
                </select>
              </label>

              <label data-ajuda="prod.apont.produto" style={{ fontSize: 12, color: C.espM }}>Produto<Aj k="prod.apont.produto" />
                <input data-testid="apont-produto-busca" value={buscaProd} onChange={(e) => setBuscaProd(e.target.value)} placeholder="Buscar por código ou nome…" style={{ ...inp, marginBottom: 6 }} />
                <select data-testid="apont-produto" value={produtoId} onChange={(e) => setProdutoId(e.target.value)} style={inp}>
                  <option value="">— escolher produto —</option>
                  {produtosFiltrados.map((p) => <option key={p.id} value={p.id}>{p.codigo} · {p.nome}</option>)}
                </select>
              </label>

              <label data-ajuda="prod.apont.hora" style={{ fontSize: 12, color: C.espM }}>Hora (0–23)<Aj k="prod.apont.hora" />
                <input data-testid="apont-hora" type="number" min={0} max={23} step={1} value={hora} onChange={(e) => setHora(e.target.value)} style={inp} />
              </label>

              <label data-ajuda="prod.apont.qtd" style={{ fontSize: 12, color: C.espM }}>Quantidade produzida<Aj k="prod.apont.qtd" />
                <input data-testid="apont-qtd" type="number" min={0} step="any" value={qtd} onChange={(e) => setQtd(e.target.value)} placeholder="ex.: 320" style={inp} />
              </label>

              <label data-ajuda="prod.apont.unidade" style={{ fontSize: 12, color: C.espM }}>Unidade<Aj k="prod.apont.unidade" />
                <input data-testid="apont-unidade" value={unidade} onChange={(e) => setUnidade(e.target.value)} placeholder="un, kg, cx…" style={inp} />
              </label>

              <label data-ajuda="prod.apont.pessoas" style={{ fontSize: 12, color: C.espM }}>Pessoas presentes (contagem — sem nomes)<Aj k="prod.apont.pessoas" />
                <input data-testid="apont-pessoas" type="number" min={0} step={1} value={pessoas} onChange={(e) => setPessoas(e.target.value)} placeholder="opcional" style={inp} />
              </label>

              <label data-ajuda="prod.apont.fonte" style={{ fontSize: 12, color: C.espM }}>Fonte<Aj k="prod.apont.fonte" />
                <select data-testid="apont-fonte" value={fonte} onChange={(e) => setFonte(e.target.value as Fonte)} style={inp}>
                  <option value="manual">Manual</option>
                  <option value="ponto">Ponto</option>
                  <option value="balanca">Balança</option>
                </select>
              </label>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14, flexWrap: 'wrap' }}>
              <button data-testid="apont-lancar" onClick={() => void lancar()} disabled={!podeSalvar} style={btn(podeSalvar)}>
                {salvando ? 'Lançando…' : 'Lançar apontamento'}
              </button>
              <span style={{ fontSize: 11.5, color: C.espM }}>
                Relançar a mesma hora para o mesmo posto e produto CORRIGE o valor (não duplica).
              </span>
            </div>
          </div>

          {/* Grade de confronto */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 8px' }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>Confronto do dia · produzido × capacidade<Aj k="prod.apont.produtividade" /></div>
            {carregando && <span style={{ fontSize: 12, color: C.espM }}>atualizando…</span>}
          </div>

          <Legenda />

          {linhas.length === 0 ? (
            <div data-testid="apont-vazio" style={{ background: C.white, border: `1px dashed ${C.border}`, borderRadius: 12, padding: '28px 16px', textAlign: 'center', color: C.espM, marginTop: 10 }}>
              Nenhum apontamento neste dia — lance o produzido por posto e hora.
            </div>
          ) : (
            <div style={{ overflowX: 'auto', marginTop: 8, background: C.white, border: `1px solid ${C.border}`, borderRadius: 12 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 720 }}>
                <thead>
                  <tr style={{ background: C.cream, color: C.espM, textAlign: 'left' }}>
                    <Th>Posto<Aj k="prod.apont.posto" /></Th>
                    <Th center>Hora<Aj k="prod.apont.hora" /></Th>
                    <Th right>Produzido<Aj k="prod.apont.qtd" /></Th>
                    <Th right>Capacidade</Th>
                    <Th right>Produtividade<Aj k="prod.apont.produtividade" /></Th>
                    <Th right>Ociosidade</Th>
                    <Th right>Pessoas<Aj k="prod.apont.pessoas" /></Th>
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((l, i) => {
                    const sem = semaforo(l.produtividade_pct)
                    const semCap = l.capacidade == null
                    return (
                      <tr key={`${l.posto_id}-${l.hora}-${i}`} style={{ borderTop: `1px solid ${C.border}` }}>
                        <Td><b style={{ color: C.esp }}>{l.posto_numero}</b></Td>
                        <Td center>{String(l.hora).padStart(2, '0')}h</Td>
                        <Td right>{num(l.produzido)}</Td>
                        <Td right>{semCap ? <span style={{ color: C.espL }}>a medir</span> : num(l.capacidade)}</Td>
                        <Td right>
                          {semCap || l.produtividade_pct == null ? <span style={{ color: C.espL }}>a medir</span> : (
                            <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontWeight: 700, color: sem?.fg ?? C.espM, background: sem?.bg ?? 'transparent' }}>
                              {num(l.produtividade_pct, '%')}
                            </span>
                          )}
                        </Td>
                        <Td right>{semCap || l.ociosidade_pct == null ? <span style={{ color: C.espL }}>—</span> : num(l.ociosidade_pct, '%')}</Td>
                        <Td right>{l.pessoas_presentes == null ? <span style={{ color: C.espL }}>—</span> : l.pessoas_presentes.toLocaleString('pt-BR')}</Td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Legenda() {
  const item = (fg: string, bg: string, txt: string) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: C.espM }}>
      <span style={{ width: 11, height: 11, borderRadius: 3, background: bg, border: `1px solid ${fg}55` }} />{txt}
    </span>
  )
  return (
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', marginBottom: 4 }}>
      {item(C.green, C.greenBg, 'Produtividade ≥ 90%')}
      {item(C.amber, C.amberBg, '70% a 89%')}
      {item(C.red, C.redBg, 'abaixo de 70%')}
      <span style={{ fontSize: 11.5, color: C.espL }}>sem capacidade cadastrada = “a medir”</span>
    </div>
  )
}

function Th({ children, center, right }: { children: React.ReactNode; center?: boolean; right?: boolean }) {
  return <th style={{ padding: '9px 12px', fontWeight: 700, fontSize: 11.5, textTransform: 'uppercase', letterSpacing: 0.4, textAlign: center ? 'center' : right ? 'right' : 'left', whiteSpace: 'nowrap' }}>{children}</th>
}
function Td({ children, center, right }: { children: React.ReactNode; center?: boolean; right?: boolean }) {
  return <td style={{ padding: '9px 12px', textAlign: center ? 'center' : right ? 'right' : 'left', whiteSpace: 'nowrap' }}>{children}</td>
}

function Aviso({ texto }: { texto: string }) { return <div style={{ background: C.bg, minHeight: '100vh', padding: 28, color: C.espM, fontSize: 14 }}>{texto}</div> }
