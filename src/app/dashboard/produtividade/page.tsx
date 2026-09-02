'use client'

// Módulo Produtividade Industrial · Fase 1 — tela de cadastro (parâmetros → postos → fluxos).
// Só cadastro (Fase 2 = painel/cálculo). Regras §5 na tela: capacidade NULL = "a medir" (nunca zero);
// posto rotativo avisa que a produtividade por pessoa vem do ponto; tempo deduzido é rotulado;
// ao sugerir o fator cabeça→kg, mostra o PERÍODO da amostra (não é número atual — RD-51).
// CRUD por supabase.from() com RLS; posto_turno e sugestão de fator via RPC.

import { useCallback, useEffect, useMemo, useState, Suspense } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

const C = {
  esp: '#3D2314', espM: '#6B5D4F', espL: '#9C8E80', bg: '#FAF7F2', white: '#FFFFFF',
  cream: '#F0ECE3', border: '#E0D8CC', gold: '#C8941A', goldD: '#A57A15', goldBg: '#FDF7E8',
  green: '#166534', greenBg: '#ECFDF5', amber: '#BA7517', amberBg: '#FAEEDA', red: '#B42318', blue: '#2F5AA8',
}
const inp: React.CSSProperties = { padding: '8px 10px', fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 8, background: C.white, color: C.esp, outline: 'none', minWidth: 0 }
const btn = (on = true): React.CSSProperties => ({ padding: '8px 14px', fontSize: 13, fontWeight: 700, borderRadius: 8, border: 'none', cursor: on ? 'pointer' : 'not-allowed', background: on ? C.gold : C.espL, color: C.white })

type Plant = { id: string; nome_planta: string }
type Row = Record<string, unknown> & { id: string }
type Aba = 'parametros' | 'postos' | 'fluxos'

export default function ProdutividadePage() {
  return <Suspense fallback={<div style={{ padding: 40, color: C.espM, background: C.bg, minHeight: '100vh' }}>Carregando…</div>}><Inner /></Suspense>
}

function Inner() {
  const { selInfo, sel } = useCompanyIds()
  const companyId = selInfo.tipo === 'empresa' && sel ? sel : null
  const [plants, setPlants] = useState<Plant[]>([])
  const [plantId, setPlantId] = useState<string | null>(null)
  const [aba, setAba] = useState<Aba>('parametros')
  const [erro, setErro] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!companyId) { setPlants([]); setPlantId(null); return }
    void (async () => {
      const { data } = await supabase.from('industrial_plants').select('id, nome_planta').eq('company_id', companyId).eq('is_active', true).order('nome_planta')
      const ps = (data as Plant[]) ?? []
      setPlants(ps); setPlantId((prev) => prev && ps.some((p) => p.id === prev) ? prev : (ps[0]?.id ?? null))
    })()
  }, [companyId])

  const flash = useCallback((m: string) => { setMsg(m); setErro(null); window.setTimeout(() => setMsg(null), 3500) }, [])
  const flashErr = useCallback((m: string) => { setErro(m); window.setTimeout(() => setErro(null), 6000) }, [])
  const ctx = useMemo<Ctx>(() => ({ companyId: companyId ?? '', plantId: plantId ?? '', flash, flashErr }), [companyId, plantId, flash, flashErr])

  if (!companyId) return <Aviso texto="Selecione uma empresa específica no topo — o cadastro é por planta." />
  if (plants.length === 0) return <Aviso texto="Esta empresa não tem planta industrial cadastrada. Cadastre a planta antes." />

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '22px 16px 48px', maxWidth: 1080, margin: '0 auto', color: C.esp }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: C.gold, fontWeight: 700 }}>🏭 Indústria · Produtividade</div>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: '2px 0 0' }}>Cadastro de produtividade</h1>
      <p style={{ color: C.espM, fontSize: 13, margin: '6px 0 14px' }}>Setores, postos, turnos e fluxos por planta. Só cadastro — o painel vem depois, quando houver o que medir.</p>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
        <label style={{ fontSize: 12, color: C.espM }}>Planta&nbsp;
          <select value={plantId ?? ''} onChange={(e) => setPlantId(e.target.value)} style={inp}>
            {plants.map((p) => <option key={p.id} value={p.id}>{p.nome_planta}</option>)}
          </select>
        </label>
        <div style={{ display: 'inline-flex', gap: 4, background: C.white, border: `1px solid ${C.border}`, borderRadius: 10, padding: 4 }}>
          {(['parametros', 'postos', 'fluxos'] as Aba[]).map((a) => (
            <button key={a} onClick={() => setAba(a)} style={{ ...btn(true), background: aba === a ? C.gold : 'transparent', color: aba === a ? C.white : C.espM }}>
              {a === 'parametros' ? 'Parâmetros' : a === 'postos' ? 'Postos' : 'Fluxos'}
            </button>
          ))}
        </div>
      </div>

      {msg && <div style={{ background: C.greenBg, color: C.green, padding: '9px 13px', borderRadius: 8, fontSize: 13, marginBottom: 12 }}>{msg}</div>}
      {erro && <div style={{ background: '#FCEBEB', color: C.red, padding: '9px 13px', borderRadius: 8, fontSize: 13, marginBottom: 12 }}>{erro}</div>}

      {aba === 'parametros' && <Parametros ctx={ctx} />}
      {aba === 'postos' && <Postos ctx={ctx} />}
      {aba === 'fluxos' && <Fluxos ctx={ctx} />}
    </div>
  )
}

type Ctx = { companyId: string; plantId: string; flash: (m: string) => void; flashErr: (m: string) => void }

// hook genérico de lista por planta
function useLista(tabela: string, ctx: Ctx, order = 'created_at') {
  const [rows, setRows] = useState<Row[]>([])
  const carregar = useCallback(async () => {
    const { data, error } = await supabase.from(tabela).select('*').eq('company_id', ctx.companyId).eq('plant_id', ctx.plantId).order(order)
    if (error) { ctx.flashErr(`${tabela}: ${error.message}`); return }
    setRows((data as Row[]) ?? [])
  }, [tabela, ctx, order])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])
  return { rows, carregar }
}

async function inserir(tabela: string, ctx: Ctx, payload: Record<string, unknown>): Promise<boolean> {
  const { error } = await supabase.from(tabela).insert({ company_id: ctx.companyId, plant_id: ctx.plantId, ...payload })
  if (error) { ctx.flashErr(error.message); return false }
  ctx.flash('Salvo.'); return true
}
async function remover(tabela: string, ctx: Ctx, id: string) {
  const { error } = await supabase.from(tabela).delete().eq('id', id)
  if (error) { ctx.flashErr(error.message); return }
  ctx.flash('Removido.')
}

function Bloco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, marginBottom: 14 }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>{titulo}</div>
      {children}
    </div>
  )
}
function Chips({ rows, label, onDel }: { rows: Row[]; label: (r: Row) => React.ReactNode; onDel: (id: string) => void }) {
  if (rows.length === 0) return <div style={{ fontSize: 12, color: C.espL, fontStyle: 'italic' }}>Nada cadastrado ainda.</div>
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {rows.map((r) => (
        <span key={r.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: C.cream, borderRadius: 999, padding: '4px 10px', fontSize: 12.5 }}>
          {label(r)}
          <button onClick={() => onDel(r.id)} title="Remover" style={{ border: 'none', background: 'none', color: C.red, cursor: 'pointer', fontWeight: 700 }}>×</button>
        </span>
      ))}
    </div>
  )
}

// ─────────── PARÂMETROS ───────────
function Parametros({ ctx }: { ctx: Ctx }) {
  const setores = useLista('prod_setor', ctx, 'ordem')
  const cargos = useLista('prod_cargo', ctx, 'nome')
  const unidades = useLista('prod_unidade_medida', ctx, 'codigo')
  const tipos = useLista('prod_tipo_posto', ctx, 'codigo')
  const turnos = useLista('ind_turnos', ctx, 'codigo')
  const conv = useLista('prod_conversao', ctx, 'vigencia_inicio')

  const [nsetor, setNsetor] = useState(''); const [ncargo, setNcargo] = useState('')
  const [uc, setUc] = useState(''); const [un, setUn] = useState('')
  const [tc, setTc] = useState('manual'); const [tn, setTn] = useState('')
  const [tuc, setTuc] = useState(''); const [tun, setTun] = useState(''); const [ti, setTi] = useState(''); const [tf, setTf] = useState('')
  // conversão
  const [co, setCo] = useState(''); const [cd, setCd] = useState(''); const [cfator, setCfator] = useState(''); const [cvig, setCvig] = useState('')
  const [sugest, setSugest] = useState<{ fator: number; n: number; ini: string; fim: string } | null>(null)

  async function sugerirFator() {
    const { data, error } = await supabase.rpc('fn_prod_sugerir_fator_cabeca_kg', { p_company_id: ctx.companyId })
    const r = data as { ok?: boolean; erro?: string; fator?: number; n_carcacas?: number; periodo_inicio?: string; periodo_fim?: string } | null
    if (error || !r?.ok) { ctx.flashErr(r?.erro === 'sem_dado_abate' ? 'Sem dado de abate para calcular o fator.' : (error?.message || 'Falha ao sugerir')); return }
    setSugest({ fator: r.fator!, n: r.n_carcacas!, ini: r.periodo_inicio!, fim: r.periodo_fim! })
    setCo('cabeca'); setCd('kg'); setCfator(String(r.fator))
  }
  const brDate = (d: string) => d ? d.split('-').reverse().join('/') : ''

  return (
    <>
      <Bloco titulo="Setores (na ordem da linha)">
        <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          <input value={nsetor} onChange={(e) => setNsetor(e.target.value)} placeholder="ex.: Abate, Desossa" style={{ ...inp, flex: '1 1 200px' }} />
          <button disabled={!nsetor.trim()} style={btn(!!nsetor.trim())} onClick={async () => { if (await inserir('prod_setor', ctx, { nome: nsetor.trim(), ordem: setores.rows.length + 1 })) { setNsetor(''); void setores.carregar() } }}>+ Setor</button>
        </div>
        <Chips rows={setores.rows} label={(r) => <>{String(r.nome)}</>} onDel={async (id) => { await remover('prod_setor', ctx, id); void setores.carregar() }} />
      </Bloco>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
        <Bloco titulo="Cargos">
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <input value={ncargo} onChange={(e) => setNcargo(e.target.value)} placeholder="ex.: Operador" style={{ ...inp, flex: 1 }} />
            <button disabled={!ncargo.trim()} style={btn(!!ncargo.trim())} onClick={async () => { if (await inserir('prod_cargo', ctx, { nome: ncargo.trim() })) { setNcargo(''); void cargos.carregar() } }}>+</button>
          </div>
          <Chips rows={cargos.rows} label={(r) => <>{String(r.nome)}</>} onDel={async (id) => { await remover('prod_cargo', ctx, id); void cargos.carregar() }} />
        </Bloco>

        <Bloco titulo="Unidades de medida (kg é o padrão do abate)">
          <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
            <input value={uc} onChange={(e) => setUc(e.target.value)} placeholder="código (kg, cabeca…)" style={{ ...inp, flex: '1 1 120px' }} />
            <input value={un} onChange={(e) => setUn(e.target.value)} placeholder="nome" style={{ ...inp, flex: '1 1 120px' }} />
            <button disabled={!uc.trim() || !un.trim()} style={btn(!!uc.trim() && !!un.trim())} onClick={async () => { if (await inserir('prod_unidade_medida', ctx, { codigo: uc.trim(), nome: un.trim(), e_padrao_planta: uc.trim() === 'kg' })) { setUc(''); setUn(''); void unidades.carregar() } }}>+</button>
          </div>
          <Chips rows={unidades.rows} label={(r) => <><b>{String(r.codigo)}</b> {String(r.nome)}{r.e_padrao_planta ? ' ⭐' : ''}</>} onDel={async (id) => { await remover('prod_unidade_medida', ctx, id); void unidades.carregar() }} />
        </Bloco>

        <Bloco titulo="Tipos de posto">
          <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
            <select value={tc} onChange={(e) => setTc(e.target.value)} style={inp}><option value="manual">manual</option><option value="misto">misto</option><option value="automatico">automático</option></select>
            <input value={tn} onChange={(e) => setTn(e.target.value)} placeholder="nome" style={{ ...inp, flex: 1 }} />
            <button disabled={!tn.trim()} style={btn(!!tn.trim())} onClick={async () => { if (await inserir('prod_tipo_posto', ctx, { codigo: tc, nome: tn.trim() })) { setTn(''); void tipos.carregar() } }}>+</button>
          </div>
          <Chips rows={tipos.rows} label={(r) => <><b>{String(r.codigo)}</b> {String(r.nome)}</>} onDel={async (id) => { await remover('prod_tipo_posto', ctx, id); void tipos.carregar() }} />
        </Bloco>

        <Bloco titulo="Turnos da planta (horário de referência)">
          <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
            <input value={tuc} onChange={(e) => setTuc(e.target.value)} placeholder="T1" style={{ ...inp, width: 60 }} />
            <input value={tun} onChange={(e) => setTun(e.target.value)} placeholder="nome" style={{ ...inp, flex: '1 1 100px' }} />
            <input type="time" value={ti} onChange={(e) => setTi(e.target.value)} style={inp} />
            <input type="time" value={tf} onChange={(e) => setTf(e.target.value)} style={inp} />
            <button disabled={!tuc.trim()} style={btn(!!tuc.trim())} onClick={async () => { if (await inserir('ind_turnos', ctx, { codigo: tuc.trim(), nome: tun.trim() || tuc.trim(), inicio: ti || null, fim: tf || null, ativo: true })) { setTuc(''); setTun(''); setTi(''); setTf(''); void turnos.carregar() } }}>+</button>
          </div>
          <Chips rows={turnos.rows} label={(r) => <><b>{String(r.codigo ?? '—')}</b> {r.inicio ? `${String(r.inicio).slice(0, 5)}–${String(r.fim ?? '').slice(0, 5)}` : ''}</>} onDel={async (id) => { await remover('ind_turnos', ctx, id); void turnos.carregar() }} />
        </Bloco>
      </div>

      <Bloco titulo="Conversões (com vigência) — o que permite somar cabeça com quilo">
        <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input value={co} onChange={(e) => setCo(e.target.value)} placeholder="de (cabeca)" style={{ ...inp, width: 110 }} />
          <span>→</span>
          <input value={cd} onChange={(e) => setCd(e.target.value)} placeholder="para (kg)" style={{ ...inp, width: 110 }} />
          <input value={cfator} onChange={(e) => setCfator(e.target.value)} placeholder="fator" style={{ ...inp, width: 100 }} />
          <label style={{ fontSize: 12, color: C.espM }}>vigência&nbsp;<input type="date" value={cvig} onChange={(e) => setCvig(e.target.value)} style={inp} /></label>
          <button disabled={!co.trim() || !cd.trim() || !cfator || !cvig} style={btn(!!co.trim() && !!cd.trim() && !!cfator && !!cvig)}
            onClick={async () => { if (await inserir('prod_conversao', ctx, { unidade_origem: co.trim(), unidade_destino: cd.trim(), fator: Number(cfator), vigencia_inicio: cvig, origem: sugest ? 'medida' : 'informada' })) { setCo(''); setCd(''); setCfator(''); setCvig(''); setSugest(null); void conv.carregar() } }}>+ Conversão</button>
        </div>
        <div style={{ marginBottom: 10 }}>
          <button style={{ ...btn(true), background: C.blue }} onClick={() => void sugerirFator()}>🐂 Sugerir fator cabeça→kg do abate</button>
          {sugest && (
            <div style={{ marginTop: 8, background: C.goldBg, border: `1px solid ${C.gold}44`, borderRadius: 8, padding: '9px 12px', fontSize: 12.5 }}>
              Sugestão: <b>{sugest.fator} kg/cabeça</b> — <b>medida</b> de <b>{sugest.n.toLocaleString('pt-BR')} carcaças</b>, período <b>{brDate(sugest.ini)}–{brDate(sugest.fim)}</b>.
              <div style={{ color: C.espM, marginTop: 2 }}>É a média do período acima, não um número atual — confira antes de salvar. Ajuste a vigência conforme o momento que ela representa.</div>
            </div>
          )}
        </div>
        {conv.rows.length === 0 ? <div style={{ fontSize: 12, color: C.espL, fontStyle: 'italic' }}>Nenhuma conversão. Sem fator vigente, o cálculo consolidado da Fase 2 fica bloqueado (nomeando a unidade que falta).</div>
          : conv.rows.map((r) => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, borderTop: `1px solid ${C.cream}`, padding: '5px 0' }}>
              <b>{String(r.unidade_origem)}→{String(r.unidade_destino)}</b> = {String(r.fator)}
              <span style={{ color: C.espM }}>a partir de {brDate(String(r.vigencia_inicio))}{r.vigencia_fim ? ` até ${brDate(String(r.vigencia_fim))}` : ''}</span>
              <span style={{ fontSize: 10.5, padding: '2px 7px', borderRadius: 999, background: r.origem === 'medida' ? C.greenBg : C.cream, color: r.origem === 'medida' ? C.green : C.espM }}>{String(r.origem)}</span>
              <button onClick={async () => { await remover('prod_conversao', ctx, r.id); void conv.carregar() }} style={{ marginLeft: 'auto', border: 'none', background: 'none', color: C.red, cursor: 'pointer' }}>remover</button>
            </div>
          ))}
      </Bloco>
    </>
  )
}

// ─────────── POSTOS ───────────
function Postos({ ctx }: { ctx: Ctx }) {
  const postos = useLista('prod_posto', ctx, 'ordem_linha')
  const setores = useLista('prod_setor', ctx, 'ordem')
  const unidades = useLista('prod_unidade_medida', ctx, 'codigo')
  const tipos = useLista('prod_tipo_posto', ctx, 'codigo')
  const cargos = useLista('prod_cargo', ctx, 'nome')
  const turnos = useLista('ind_turnos', ctx, 'codigo')

  const nomeDe = (rows: Row[], id: unknown, campo = 'nome') => { const r = rows.find((x) => x.id === id); return r ? String(r[campo]) : '—' }

  const [f, setF] = useState<{ numero: string; atividade: string; setor_id: string; tipo_posto_id: string; cargo_id: string; unidade_medida_id: string; capacidade_hora: string; alocacao: string }>({ numero: '', atividade: '', setor_id: '', tipo_posto_id: '', cargo_id: '', unidade_medida_id: '', capacidade_hora: '', alocacao: 'fixa' })
  const [quadroDe, setQuadroDe] = useState<string | null>(null)

  const podeSalvar = f.numero.trim() && f.atividade.trim() && f.setor_id
  async function salvarPosto() {
    const ok = await inserir('prod_posto', ctx, {
      numero: f.numero.trim(), atividade: f.atividade.trim(), setor_id: f.setor_id,
      tipo_posto_id: f.tipo_posto_id || null, cargo_id: f.cargo_id || null, unidade_medida_id: f.unidade_medida_id || null,
      capacidade_hora: f.capacidade_hora ? Number(f.capacidade_hora) : null,
      capacidade_origem: f.capacidade_hora ? 'medida' : null,
      alocacao: f.alocacao, ordem_linha: postos.rows.length + 1,
    })
    if (ok) { setF({ numero: '', atividade: '', setor_id: '', tipo_posto_id: '', cargo_id: '', unidade_medida_id: '', capacidade_hora: '', alocacao: 'fixa' }); void postos.carregar() }
  }

  return (
    <>
      <Bloco titulo="Novo posto">
        {setores.rows.length === 0 && <div style={{ fontSize: 12, color: C.amber, marginBottom: 8 }}>Cadastre ao menos um setor em Parâmetros antes.</div>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, marginBottom: 8 }}>
          <input value={f.numero} onChange={(e) => setF({ ...f, numero: e.target.value })} placeholder="número" style={inp} />
          <input value={f.atividade} onChange={(e) => setF({ ...f, atividade: e.target.value })} placeholder="atividade (ex.: Sangria)" style={inp} />
          <select value={f.setor_id} onChange={(e) => setF({ ...f, setor_id: e.target.value })} style={inp}><option value="">setor…</option>{setores.rows.map((s) => <option key={s.id} value={s.id}>{String(s.nome)}</option>)}</select>
          <select value={f.tipo_posto_id} onChange={(e) => setF({ ...f, tipo_posto_id: e.target.value })} style={inp}><option value="">tipo…</option>{tipos.rows.map((t) => <option key={t.id} value={t.id}>{String(t.nome)}</option>)}</select>
          <select value={f.cargo_id} onChange={(e) => setF({ ...f, cargo_id: e.target.value })} style={inp}><option value="">cargo…</option>{cargos.rows.map((cg) => <option key={cg.id} value={cg.id}>{String(cg.nome)}</option>)}</select>
          <select value={f.unidade_medida_id} onChange={(e) => setF({ ...f, unidade_medida_id: e.target.value })} style={inp}><option value="">unidade que conta…</option>{unidades.rows.map((u) => <option key={u.id} value={u.id}>{String(u.codigo)}</option>)}</select>
          <input value={f.capacidade_hora} onChange={(e) => setF({ ...f, capacidade_hora: e.target.value })} placeholder="capacidade/h (deixe em branco = a medir)" style={inp} />
          <select value={f.alocacao} onChange={(e) => setF({ ...f, alocacao: e.target.value })} style={inp}><option value="fixa">pessoas fixas</option><option value="rotativa">pessoas rotativas</option></select>
        </div>
        {f.alocacao === 'rotativa' && <div style={{ fontSize: 12, color: C.amber, marginBottom: 8 }}>⚠️ Posto rotativo: a produtividade por pessoa virá do <b>ponto eletrônico</b>, não do quadro — o quadro aqui é projeção.</div>}
        {!f.capacidade_hora && <div style={{ fontSize: 12, color: C.espM, marginBottom: 8 }}>Capacidade em branco = <b>a medir</b> (nunca zero nem estimativa).</div>}
        <button disabled={!podeSalvar} style={btn(!!podeSalvar)} onClick={() => void salvarPosto()}>Salvar posto</button>
      </Bloco>

      <Bloco titulo={`Postos (${postos.rows.length})`}>
        {postos.rows.length === 0 ? <div style={{ fontSize: 12, color: C.espL, fontStyle: 'italic' }}>Nenhum posto ainda.</div> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 620 }}>
              <thead style={{ background: C.cream }}><tr><Th>Nº</Th><Th>Atividade</Th><Th>Setor</Th><Th>Capacidade/h</Th><Th>Alocação</Th><Th></Th></tr></thead>
              <tbody>
                {postos.rows.map((p) => (
                  <tr key={p.id} style={{ borderTop: `1px solid ${C.cream}` }}>
                    <Td>{String(p.numero)}</Td><Td>{String(p.atividade)}</Td><Td>{nomeDe(setores.rows, p.setor_id)}</Td>
                    <Td>{p.capacidade_hora != null ? `${Number(p.capacidade_hora).toLocaleString('pt-BR')}` : <span style={{ color: C.amber }}>a medir</span>}</Td>
                    <Td>{p.alocacao === 'rotativa' ? <span style={{ color: C.blue }}>rotativa</span> : 'fixa'}</Td>
                    <Td><button onClick={() => setQuadroDe(quadroDe === p.id ? null : p.id)} style={{ ...btn(true), padding: '4px 10px', background: C.blue }}>Quadro</button></Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {quadroDe && <QuadroTurno ctx={ctx} postoId={quadroDe} turnos={turnos.rows} />}
      </Bloco>
    </>
  )
}

function QuadroTurno({ ctx, postoId, turnos }: { ctx: Ctx; postoId: string; turnos: Row[] }) {
  const [linhas, setLinhas] = useState<Row[]>([])
  const [turnoId, setTurnoId] = useState(''); const [he, setHe] = useState(''); const [hs, setHs] = useState(''); const [pes, setPes] = useState(''); const [vig, setVig] = useState('')
  const carregar = useCallback(async () => {
    const { data } = await supabase.from('prod_posto_turno').select('*').eq('posto_id', postoId).order('vigencia_inicio')
    setLinhas((data as Row[]) ?? [])
  }, [postoId])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])
  const codigoDe = (id: unknown) => { const t = turnos.find((x) => x.id === id); return t ? String(t.codigo ?? t.nome ?? '—') : '—' }

  async function salvar() {
    const { data, error } = await supabase.rpc('fn_prod_posto_turno_salvar', { p_posto_id: postoId, p_turno_id: turnoId, p_hora_entrada: he || null, p_hora_saida: hs || null, p_pessoas: pes ? Number(pes) : null, p_vigencia_inicio: vig })
    const r = data as { ok?: boolean; erro?: string } | null
    if (error || !r?.ok) { ctx.flashErr(error?.message || r?.erro || 'Falha ao salvar quadro'); return }
    ctx.flash('Quadro salvo (linha nova com vigência; a anterior fica no histórico).'); setHe(''); setHs(''); setPes(''); setVig(''); void carregar()
  }

  return (
    <div style={{ marginTop: 10, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12 }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>Quadro e horário por turno — alterar cria linha nova; a anterior permanece consultável</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
        <select value={turnoId} onChange={(e) => setTurnoId(e.target.value)} style={inp}><option value="">turno…</option>{turnos.map((t) => <option key={t.id} value={t.id}>{String(t.codigo ?? t.nome)}</option>)}</select>
        <label style={{ fontSize: 11, color: C.espM }}>entra<input type="time" value={he} onChange={(e) => setHe(e.target.value)} style={{ ...inp, marginLeft: 4 }} /></label>
        <label style={{ fontSize: 11, color: C.espM }}>sai<input type="time" value={hs} onChange={(e) => setHs(e.target.value)} style={{ ...inp, marginLeft: 4 }} /></label>
        <input value={pes} onChange={(e) => setPes(e.target.value)} placeholder="pessoas" style={{ ...inp, width: 90 }} />
        <label style={{ fontSize: 11, color: C.espM }}>vigência<input type="date" value={vig} onChange={(e) => setVig(e.target.value)} style={{ ...inp, marginLeft: 4 }} /></label>
        <button disabled={!turnoId || !vig} style={btn(!!turnoId && !!vig)} onClick={() => void salvar()}>Salvar quadro</button>
      </div>
      {linhas.length === 0 ? <div style={{ fontSize: 12, color: C.espL }}>Sem quadro ainda.</div> : linhas.map((l) => (
        <div key={l.id} style={{ fontSize: 12, color: l.vigencia_fim ? C.espL : C.esp, padding: '3px 0' }}>
          <b>{codigoDe(l.turno_id)}</b> {String(l.hora_entrada ?? '').slice(0, 5)}–{String(l.hora_saida ?? '').slice(0, 5)} · {l.pessoas != null ? `${String(l.pessoas)} pessoa(s)` : '—'} · desde {String(l.vigencia_inicio).split('-').reverse().join('/')}{l.vigencia_fim ? ` (encerrado ${String(l.vigencia_fim).split('-').reverse().join('/')})` : ' (vigente)'}
        </div>
      ))}
    </div>
  )
}

// ─────────── FLUXOS ───────────
function Fluxos({ ctx }: { ctx: Ctx }) {
  const fluxos = useLista('prod_fluxo', ctx, 'created_at')
  const setores = useLista('prod_setor', ctx, 'ordem')
  const unidades = useLista('prod_unidade_medida', ctx, 'codigo')
  const [f, setF] = useState({ setor_id: '', nome: '', modo: 'compartilhado', unidade_entrada_id: '' })
  const pode = f.setor_id && f.nome.trim()
  return (
    <>
      <Bloco titulo="Novo fluxo">
        <div style={{ fontSize: 12, color: C.espM, marginBottom: 8 }}>Compartilhado = todos os produtos no mesmo caminho, o tempo padrão diferencia. Específico = um fluxo por produto.</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, marginBottom: 8 }}>
          <select value={f.setor_id} onChange={(e) => setF({ ...f, setor_id: e.target.value })} style={inp}><option value="">setor…</option>{setores.rows.map((s) => <option key={s.id} value={s.id}>{String(s.nome)}</option>)}</select>
          <input value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} placeholder="nome do fluxo" style={inp} />
          <select value={f.modo} onChange={(e) => setF({ ...f, modo: e.target.value })} style={inp}><option value="compartilhado">compartilhado</option><option value="especifico">específico (por produto)</option></select>
          <select value={f.unidade_entrada_id} onChange={(e) => setF({ ...f, unidade_entrada_id: e.target.value })} style={inp}><option value="">unidade de entrada…</option>{unidades.rows.map((u) => <option key={u.id} value={u.id}>{String(u.codigo)}</option>)}</select>
        </div>
        {f.modo === 'especifico' && <div style={{ fontSize: 12, color: C.amber, marginBottom: 8 }}>Modo específico precisa de produto — o vínculo de produto ao fluxo entra junto com o catálogo (Fase 1 cadastra o compartilhado; o específico por produto vem com o produto selecionado).</div>}
        <button disabled={!pode || f.modo === 'especifico'} style={btn(!!pode && f.modo !== 'especifico')}
          onClick={async () => { if (await inserir('prod_fluxo', ctx, { setor_id: f.setor_id, nome: f.nome.trim(), modo: 'compartilhado', produto_id: null, unidade_entrada_id: f.unidade_entrada_id || null })) { setF({ setor_id: '', nome: '', modo: 'compartilhado', unidade_entrada_id: '' }); void fluxos.carregar() } }}>Salvar fluxo</button>
      </Bloco>
      <Bloco titulo={`Fluxos (${fluxos.rows.length})`}>
        {fluxos.rows.length === 0 ? <div style={{ fontSize: 12, color: C.espL, fontStyle: 'italic' }}>Nenhum fluxo ainda.</div> : fluxos.rows.map((fl) => (
          <FluxoLinha key={fl.id} ctx={ctx} fluxo={fl} setorNome={String(setores.rows.find((s) => s.id === fl.setor_id)?.nome ?? '—')} onDel={() => void fluxos.carregar()} />
        ))}
      </Bloco>
    </>
  )
}

function FluxoLinha({ ctx, fluxo, setorNome, onDel }: { ctx: Ctx; fluxo: Row; setorNome: string; onDel: () => void }) {
  const [etapas, setEtapas] = useState<Row[]>([])
  const [postos, setPostos] = useState<Row[]>([])
  const [postoId, setPostoId] = useState('')
  const carregar = useCallback(async () => {
    const [e, p] = await Promise.all([
      supabase.from('prod_fluxo_etapa').select('*').eq('fluxo_id', fluxo.id).order('ordem'),
      supabase.from('prod_posto').select('id, numero, atividade').eq('setor_id', fluxo.setor_id),
    ])
    setEtapas((e.data as Row[]) ?? []); setPostos((p.data as Row[]) ?? [])
  }, [fluxo.id, fluxo.setor_id])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])
  const postoLabel = (id: unknown) => { const p = postos.find((x) => x.id === id); return p ? `${String(p.numero)} ${String(p.atividade)}` : '—' }
  return (
    <div style={{ borderTop: `1px solid ${C.cream}`, padding: '8px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <b>{String(fluxo.nome)}</b> <span style={{ fontSize: 11, color: C.espM }}>{setorNome} · {String(fluxo.modo)}</span>
        <button onClick={async () => { await remover('prod_fluxo', ctx, fluxo.id); onDel() }} style={{ marginLeft: 'auto', border: 'none', background: 'none', color: C.red, cursor: 'pointer', fontSize: 12 }}>remover</button>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', margin: '6px 0', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: C.espM }}>etapas:</span>
        {etapas.map((et) => <span key={et.id} style={{ fontSize: 11.5, background: C.cream, borderRadius: 999, padding: '3px 9px' }}>{postoLabel(et.posto_id)}</span>)}
        <select value={postoId} onChange={(e) => setPostoId(e.target.value)} style={{ ...inp, padding: '4px 8px' }}><option value="">+ posto…</option>{postos.map((p) => <option key={p.id} value={p.id}>{String(p.numero)} {String(p.atividade)}</option>)}</select>
        {postoId && <button style={{ ...btn(true), padding: '4px 10px' }} onClick={async () => { const { error } = await supabase.from('prod_fluxo_etapa').insert({ company_id: ctx.companyId, plant_id: fluxo.plant_id, fluxo_id: fluxo.id, posto_id: postoId, ordem: etapas.length + 1 }); if (error) ctx.flashErr(error.message); else { setPostoId(''); void carregar() } }}>add</button>}
      </div>
    </div>
  )
}

function Th({ children }: { children?: React.ReactNode }) { return <th style={{ textAlign: 'left', padding: '7px 9px', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.4, color: C.espM }}>{children}</th> }
function Td({ children }: { children?: React.ReactNode }) { return <td style={{ padding: '6px 9px', color: C.esp }}>{children}</td> }
function Aviso({ texto }: { texto: string }) { return <div style={{ background: C.bg, minHeight: '100vh', padding: 28, color: C.espM, fontSize: 14 }}>{texto}</div> }
