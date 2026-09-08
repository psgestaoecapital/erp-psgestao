'use client'

// Produtividade Industrial · tela UNICA por fluxo. O fluxo e o CONTEXTO (setor, unidade de
// entrada, vinculos de ponto/producao) — nao se repete em cada posto. Uma linha por posto,
// editavel no lugar; o turno vem pronto do ponto (com a contagem, que da confianca); parametros
// saem da frente ("configuracao avancada"). A faixa de prontidao responde "onde vou ver o
// resultado". Erros aparecem NA LINHA (nao so no topo). CRIOU/ALTEROU/EXCLUIU. Sem "0" no lugar
// de ausencia — capacidade em branco = a medir.

import { useCallback, useEffect, useState, Suspense } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

const C = {
  esp: '#3D2314', espM: '#6B5D4F', espL: '#9C8E80', bg: '#FAF7F2', white: '#FFFFFF',
  cream: '#F0ECE3', border: '#E0D8CC', gold: '#C8941A', goldD: '#A57A15', goldBg: '#FDF7E8',
  green: '#166534', greenBg: '#ECFDF5', amber: '#BA7517', amberBg: '#FAEEDA', red: '#B42318', redBg: '#FCEBEB', blue: '#2F5AA8',
}
const inp: React.CSSProperties = { padding: '7px 9px', fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 7, background: C.white, color: C.esp, outline: 'none', minWidth: 0, width: '100%' }
const btn = (on = true): React.CSSProperties => ({ padding: '8px 14px', fontSize: 13, fontWeight: 700, borderRadius: 8, border: 'none', cursor: on ? 'pointer' : 'not-allowed', background: on ? C.gold : C.espL, color: C.white })
const hhmm = (t: unknown) => t ? String(t).slice(0, 5) : ''

type Plant = { id: string; nome_planta: string }
type Fluxo = { id: string; nome: string; setor_id: string }
type Opt = { id: string; nome: string; codigo?: string }
type Quadro = { turno_id: string | null; hora_entrada: string | null; hora_saida: string | null; pessoas: number | null } | null
type Posto = {
  id: string; numero: string; ordem_linha: number; atividade: string;
  cargo_id: string | null; cargo_nome: string | null;
  unidade_medida_id: string | null; unidade_codigo: string | null;
  tipo_posto_id: string | null; tipo_nome: string | null;
  categoria_produto_id: string | null; categoria_nome: string | null; indicador_id: string | null;
  capacidade_hora: number | null; capacidade_origem: string | null;
  alocacao: string; centro_custo: string | null; supervisor_nome: string | null; quadro: Quadro
}
type Sugestao = { horario: string; ocorrencias: number }
type FluxoCompleto = {
  ok: boolean; erro?: string;
  fluxo: { id: string; nome: string; modo: string; setor_id: string; setor_nome: string | null; unidade_entrada_id: string | null; unidade_entrada_codigo: string | null };
  postos: Posto[]; contexto: { ponto: number; producao: string[] }; sugestoes_turno: Sugestao[];
  listas: { cargos: Opt[]; unidades: Opt[]; tipos: Opt[]; categorias: Opt[]; turnos: (Opt & { inicio: string | null; fim: string | null })[] }
}
type Prontidao = { ok: boolean; pronto_para_medir: boolean; falta: string[]; tem: { setores_com_vinculo: number; postos: number; quadros: number; dias_com_ponto: number; vinculos_ponto: number; producao_chaves: string[]; fluxos: number } }

export default function ProdutividadePage() {
  return <Suspense fallback={<div style={{ padding: 40, color: C.espM, background: C.bg, minHeight: '100vh' }}>Carregando…</div>}><Inner /></Suspense>
}

function Inner() {
  const { selInfo, sel } = useCompanyIds()
  const companyId = selInfo.tipo === 'empresa' && sel ? sel : null
  const [plants, setPlants] = useState<Plant[]>([])
  const [plantId, setPlantId] = useState<string | null>(null)
  const [fluxos, setFluxos] = useState<Fluxo[]>([])
  const [fluxoId, setFluxoId] = useState<string | null>(null)
  const [fc, setFc] = useState<FluxoCompleto | null>(null)
  const [pront, setPront] = useState<Prontidao | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [avancado, setAvancado] = useState(false)
  const [salAberto, setSalAberto] = useState(false)
  const [novoFluxo, setNovoFluxo] = useState(false)

  const flash = useCallback((m: string) => { setMsg(m); setErro(null); window.setTimeout(() => setMsg(null), 3500) }, [])
  const flashErr = useCallback((m: string) => { setErro(m); try { window.scrollTo({ top: 0, behavior: 'smooth' }) } catch { /* */ } window.setTimeout(() => setErro(null), 6000) }, [])

  // plants
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!companyId) { setPlants([]); setPlantId(null); return }
    void (async () => {
      const { data } = await supabase.from('industrial_plants').select('id, nome_planta').eq('company_id', companyId).eq('is_active', true).order('nome_planta')
      const ps = (data as Plant[]) ?? []
      setPlants(ps); setPlantId((prev) => prev && ps.some((p) => p.id === prev) ? prev : (ps[0]?.id ?? null))
    })()
  }, [companyId])

  // fluxos + prontidao da planta
  const carregarPlanta = useCallback(async () => {
    if (!companyId || !plantId) { setFluxos([]); setFluxoId(null); setPront(null); return }
    const [{ data: fx }, { data: pr }] = await Promise.all([
      supabase.from('prod_fluxo').select('id, nome, setor_id').eq('company_id', companyId).eq('plant_id', plantId).order('created_at'),
      supabase.rpc('fn_prod_prontidao', { p_company_id: companyId, p_plant_id: plantId }),
    ])
    const lista = (fx as Fluxo[]) ?? []
    setFluxos(lista)
    setFluxoId((prev) => prev && lista.some((f) => f.id === prev) ? prev : (lista[0]?.id ?? null))
    const p = pr as Prontidao | null
    setPront(p?.ok ? p : null)
  }, [companyId, plantId])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregarPlanta() }, [carregarPlanta])

  // fluxo completo (tabela)
  const carregarFluxo = useCallback(async () => {
    if (!fluxoId) { setFc(null); return }
    const { data, error } = await supabase.rpc('fn_prod_fluxo_completo', { p_fluxo_id: fluxoId })
    if (error) { flashErr(error.message); return }
    const r = data as FluxoCompleto
    setFc(r?.ok ? r : null)
    if (r && !r.ok) flashErr(r.erro === 'sem_acesso' ? 'Sem acesso a este fluxo.' : 'Falha ao carregar o fluxo.')
  }, [fluxoId, flashErr])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregarFluxo() }, [carregarFluxo])

  const recarregar = useCallback(async () => { await Promise.all([carregarFluxo(), carregarPlanta()]) }, [carregarFluxo, carregarPlanta])

  if (!companyId) return <Aviso texto="Selecione uma empresa específica no topo — o cadastro é por planta." />
  if (plants.length === 0) return <Aviso texto="Esta empresa não tem planta industrial cadastrada. Cadastre a planta antes." />

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '22px 16px 60px', maxWidth: 1120, margin: '0 auto', color: C.esp }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: C.gold, fontWeight: 700 }}>🏭 Indústria · Produtividade</div>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: '2px 0 0' }}>Cadastro por fluxo</h1>
      <p style={{ color: C.espM, fontSize: 13, margin: '6px 0 12px' }}>O fluxo é o contexto. Cada linha é um posto — clique para editar. O turno vem do ponto.</p>

      {msg && <div style={{ background: C.greenBg, color: C.green, padding: '9px 13px', borderRadius: 8, fontSize: 13, marginBottom: 12 }}>{msg}</div>}
      {erro && <div style={{ background: C.redBg, color: C.red, padding: '9px 13px', borderRadius: 8, fontSize: 13, marginBottom: 12 }}>{erro}</div>}

      {/* Faixa: o que falta para medir */}
      {pront && <FaixaProntidao pront={pront} />}

      {/* Seletor de planta + fluxo */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', margin: '14px 0 10px' }}>
        {plants.length > 1 && (
          <label style={{ fontSize: 12, color: C.espM }}>Planta&nbsp;
            <select value={plantId ?? ''} onChange={(e) => setPlantId(e.target.value)} style={{ ...inp, width: 'auto' }}>
              {plants.map((p) => <option key={p.id} value={p.id}>{p.nome_planta}</option>)}
            </select>
          </label>
        )}
        <label style={{ fontSize: 12, color: C.espM }}>Fluxo&nbsp;
          <select value={fluxoId ?? ''} onChange={(e) => setFluxoId(e.target.value)} style={{ ...inp, width: 'auto', fontWeight: 700, minWidth: 220 }}>
            {fluxos.length === 0 && <option value="">— nenhum fluxo —</option>}
            {fluxos.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
          </select>
        </label>
        <button onClick={() => setNovoFluxo(true)} style={{ ...btn(true), padding: '7px 12px', fontSize: 12.5 }}>+ Novo fluxo</button>
      </div>

      {fluxos.length === 0 ? (
        <div style={{ background: C.white, border: `1px dashed ${C.border}`, borderRadius: 12, padding: '28px 16px', textAlign: 'center', color: C.espM }}>
          Comece criando um fluxo (ex.: <b>Abate — do boi à carcaça pesada</b>). O setor e a unidade de entrada ficam no fluxo, não em cada posto.
        </div>
      ) : fc ? (
        <>
          {/* Contexto do fluxo */}
          <div style={{ fontSize: 12.5, color: C.espM, margin: '2px 0 10px' }}>
            Setor <b style={{ color: C.esp }}>{fc.fluxo.setor_nome ?? '—'}</b>
            {fc.fluxo.unidade_entrada_codigo ? <> · entra <b style={{ color: C.esp }}>{fc.fluxo.unidade_entrada_codigo}</b></> : null}
            {` · ponto: ${fc.contexto.ponto} vínculo(s)`}
            {fc.contexto.producao.length > 0 ? ` · produção: ${fc.contexto.producao.join(', ')}` : ' · produção: sem vínculo'}
          </div>

          <TabelaPostos fc={fc} companyId={companyId} plantId={plantId!} flash={flash} flashErr={flashErr} onMudou={recarregar} />
        </>
      ) : (
        <div style={{ fontSize: 13, color: C.espM, padding: 20 }}>Carregando o fluxo…</div>
      )}

      {/* Configuracao avancada */}
      <div style={{ marginTop: 24 }}>
        <button onClick={() => setAvancado((v) => !v)} style={{ background: 'none', border: 'none', color: C.espM, cursor: 'pointer', fontSize: 12.5, fontWeight: 700, padding: '6px 0' }}>
          ⚙ Setores, cargos e unidades · configuração avançada {avancado ? '▲' : '▼'}
        </button>
        {avancado && plantId && <Avancado ctx={{ companyId, plantId, flash, flashErr }} onMudou={recarregar} />}
      </div>

      {/* Salario base (custo por posto) */}
      <div style={{ marginTop: 10 }}>
        <button onClick={() => setSalAberto((v) => !v)} style={{ background: 'none', border: 'none', color: C.espM, cursor: 'pointer', fontSize: 12.5, fontWeight: 700, padding: '6px 0' }}>
          💰 Salário base — para custo por posto (da folha ou manual) {salAberto ? '▲' : '▼'}
        </button>
        {salAberto && plantId && <SalarioBase ctx={{ companyId, plantId, flash, flashErr }} />}
      </div>

      {novoFluxo && plantId && <NovoFluxoModal companyId={companyId} plantId={plantId} onClose={() => setNovoFluxo(false)} onSaved={(id) => { setNovoFluxo(false); setFluxoId(id); void carregarPlanta() }} onErro={flashErr} />}
    </div>
  )
}

function FaixaProntidao({ pront }: { pront: Prontidao }) {
  const ok = pront.pronto_para_medir
  const t = pront.tem
  const temFrase = [
    t.vinculos_ponto > 0 ? `${t.vinculos_ponto} vínculo(s) de ponto` : null,
    t.producao_chaves.length > 0 ? `produção ${t.producao_chaves.join(', ')}` : null,
    t.dias_com_ponto > 0 ? `${t.dias_com_ponto.toLocaleString('pt-BR')} dias de ponto coletados` : null,
  ].filter(Boolean).join(', ')
  return (
    <div style={{ background: ok ? C.greenBg : C.amberBg, border: `1px solid ${ok ? C.green : C.amber}55`, borderRadius: 12, padding: '11px 14px', fontSize: 13, color: ok ? C.green : '#8A4B08' }}>
      {ok ? <b>Pronto para medir.</b> : <><b>Ainda não dá para medir.</b> {pront.falta.length > 0 && `Falta: ${pront.falta.join(' · ')}.`}</>}
      {temFrase && <div style={{ color: C.espM, marginTop: 3 }}>Você já tem: {temFrase}.</div>}
    </div>
  )
}

// ─────────── TABELA DE POSTOS ───────────
function TabelaPostos({ fc, companyId, plantId, flash, flashErr, onMudou }: {
  fc: FluxoCompleto; companyId: string; plantId: string; flash: (m: string) => void; flashErr: (m: string) => void; onMudou: () => Promise<void>
}) {
  return (
    <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 720 }}>
          <thead style={{ background: C.cream }}>
            <tr>
              <Th w={44}>Nº</Th><Th>Atividade</Th><Th w={150}>Cargo</Th><Th w={170}>Turno e horário</Th><Th w={80}>Pessoas</Th><Th w={90}>Cap./h</Th><Th w={70}></Th>
            </tr>
          </thead>
          <tbody>
            {fc.postos.map((p) => (
              <LinhaPosto key={p.id} posto={p} fc={fc} companyId={companyId} plantId={plantId} setor_id={fc.fluxo.setor_id} flash={flash} flashErr={flashErr} onMudou={onMudou} />
            ))}
            <LinhaPosto novo fc={fc} companyId={companyId} plantId={plantId} setor_id={fc.fluxo.setor_id} flash={flash} flashErr={flashErr} onMudou={onMudou} />
          </tbody>
        </table>
      </div>
    </div>
  )
}

type Rascunho = {
  atividade: string; cargo_id: string; unidade_medida_id: string; tipo_posto_id: string; categoria_produto_id: string;
  pessoas: string; capacidade_hora: string; alocacao: string; centro_custo: string; supervisor_nome: string;
  turno_id: string; hora_entrada: string; hora_saida: string
}
function rascunhoDe(p?: Posto): Rascunho {
  return {
    atividade: p?.atividade ?? '', cargo_id: p?.cargo_id ?? '', unidade_medida_id: p?.unidade_medida_id ?? '',
    tipo_posto_id: p?.tipo_posto_id ?? '', categoria_produto_id: p?.categoria_produto_id ?? '',
    pessoas: p?.quadro?.pessoas != null ? String(p.quadro.pessoas) : '', capacidade_hora: p?.capacidade_hora != null ? String(p.capacidade_hora) : '',
    alocacao: p?.alocacao ?? 'fixa', centro_custo: p?.centro_custo ?? '', supervisor_nome: p?.supervisor_nome ?? '',
    turno_id: p?.quadro?.turno_id ?? '', hora_entrada: hhmm(p?.quadro?.hora_entrada), hora_saida: hhmm(p?.quadro?.hora_saida),
  }
}

function LinhaPosto({ posto, novo, fc, companyId, plantId, setor_id, flash, flashErr, onMudou }: {
  posto?: Posto; novo?: boolean; fc: FluxoCompleto; companyId: string; plantId: string; setor_id: string;
  flash: (m: string) => void; flashErr: (m: string) => void; onMudou: () => Promise<void>
}) {
  const [r, setR] = useState<Rascunho>(() => rascunhoDe(posto))
  const [mais, setMais] = useState(false)
  const [turnoOpen, setTurnoOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [erroLinha, setErroLinha] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  // reidrata quando o posto muda de fora (recarregar)
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (!novo) { setR(rascunhoDe(posto)); setDirty(false) } }, [posto, novo])

  const up = (patch: Partial<Rascunho>) => { setR((p) => ({ ...p, ...patch })); setDirty(true); setErroLinha(null) }
  const podeSalvar = r.atividade.trim().length > 0

  async function salvar() {
    if (!podeSalvar) { setErroLinha('A atividade é obrigatória.'); return }
    setBusy(true); setErroLinha(null)
    const { data: { user } } = await supabase.auth.getUser()
    const turno = (r.turno_id || r.hora_entrada || r.pessoas)
      ? { turno_id: r.turno_id || null, hora_entrada: r.hora_entrada || null, hora_saida: r.hora_saida || null, pessoas: r.pessoas || null }
      : null
    const dados: Record<string, unknown> = {
      atividade: r.atividade.trim(), cargo_id: r.cargo_id || null, unidade_medida_id: r.unidade_medida_id || null,
      tipo_posto_id: r.tipo_posto_id || null, categoria_produto_id: r.categoria_produto_id || null,
      capacidade_hora: r.capacidade_hora || null, alocacao: r.alocacao,
      centro_custo: r.centro_custo || null, supervisor_nome: r.supervisor_nome || null, turno,
    }
    if (novo) Object.assign(dados, { company_id: companyId, plant_id: plantId, setor_id })
    else Object.assign(dados, { id: posto!.id })
    const { data, error } = await supabase.rpc('fn_prod_posto_salvar', { p_dados: dados, p_user: user?.id ?? null })
    setBusy(false)
    const res = data as { ok?: boolean; erro?: string; criou?: boolean; numero?: string } | null
    if (error || !res?.ok) {
      setErroLinha(
        res?.erro === 'numero_duplicado' ? `Já existe um posto com o número ${res?.numero} neste setor.`
        : res?.erro === 'atividade_obrigatoria' ? 'A atividade é obrigatória.'
        : res?.erro === 'sem_acesso' ? 'Sem acesso.'
        : (error?.message || 'Falha ao salvar a linha.'))
      return
    }
    flash(res.criou ? `CRIOU o posto nº ${res.numero}.` : 'ALTEROU a linha.')
    if (novo) setR(rascunhoDe()) // limpa a linha de adicionar
    setDirty(false); setTurnoOpen(false); await onMudou()
  }

  async function excluir() {
    if (!posto) return
    setBusy(true)
    const { data: { user } } = await supabase.auth.getUser()
    const { data: prev } = await supabase.rpc('fn_prod_posto_excluir', { p_posto_id: posto.id, p_confirmar: false, p_user: user?.id ?? null })
    const pv = prev as { ok?: boolean; afeta?: Record<string, number> } | null
    const af = pv?.afeta ?? {}
    const partes = [af.quadros && `${af.quadros} quadro(s) de turno`, af.etapas_fluxo && `${af.etapas_fluxo} etapa(s) de fluxo`, af.pessoas && `${af.pessoas} alocação(ões)`, af.epis && `${af.epis} EPI(s)`, af.riscos && `${af.riscos} risco(s)`].filter(Boolean)
    const aviso = partes.length > 0 ? `\n\nIsso também apaga: ${partes.join(', ')}.` : ''
    setBusy(false)
    if (!window.confirm(`EXCLUIR o posto "${posto.numero} · ${posto.atividade}"?${aviso}\n\nNão dá para desfazer.`)) return
    setBusy(true)
    const { data, error } = await supabase.rpc('fn_prod_posto_excluir', { p_posto_id: posto.id, p_confirmar: true, p_user: user?.id ?? null })
    setBusy(false)
    const res = data as { ok?: boolean; erro?: string } | null
    if (error || !res?.ok) { flashErr(error?.message || 'Falha ao excluir.'); return }
    flash('EXCLUIU o posto.'); await onMudou()
  }

  const cellSel: React.CSSProperties = { ...inp, padding: '5px 6px', fontSize: 12.5 }
  const turnoLabel = r.hora_entrada ? `${r.hora_entrada}${r.hora_saida ? `–${r.hora_saida}` : ''}` : (r.turno_id ? (fc.listas.turnos.find((t) => t.id === r.turno_id)?.codigo ?? 'turno') : '—')

  return (
    <>
      <tr style={{ borderTop: `1px solid ${C.cream}`, background: novo ? C.goldBg : undefined, verticalAlign: 'top' }}>
        <Td>{novo ? '+' : posto!.numero}</Td>
        <Td>
          <input value={r.atividade} onChange={(e) => up({ atividade: e.target.value })} placeholder={novo ? 'nova atividade…' : ''} style={{ ...inp, padding: '5px 7px' }} />
        </Td>
        <Td>
          <select value={r.cargo_id} onChange={(e) => up({ cargo_id: e.target.value })} style={cellSel}>
            <option value="">—</option>{fc.listas.cargos.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </Td>
        <Td>
          <button type="button" onClick={() => setTurnoOpen((v) => !v)} style={{ ...cellSel, textAlign: 'left', cursor: 'pointer', background: C.white }}>
            {turnoLabel} {turnoOpen ? '▲' : '▾'}
          </button>
        </Td>
        <Td><input value={r.pessoas} onChange={(e) => up({ pessoas: e.target.value })} placeholder="—" inputMode="numeric" style={{ ...inp, padding: '5px 7px' }} /></Td>
        <Td>
          <input value={r.capacidade_hora} onChange={(e) => up({ capacidade_hora: e.target.value })} placeholder="a medir" inputMode="decimal" style={{ ...inp, padding: '5px 7px' }} />
        </Td>
        <Td>
          <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
            {(dirty || novo) && <button disabled={busy || !podeSalvar} onClick={() => void salvar()} title="Salvar linha" style={{ ...btn(!busy && podeSalvar), padding: '5px 9px', fontSize: 12 }}>{busy ? '…' : '✓'}</button>}
            {!novo && <button disabled={busy} onClick={() => void excluir()} title="Excluir posto" style={{ border: 'none', background: 'none', color: C.red, cursor: 'pointer', fontWeight: 700, fontSize: 16 }}>×</button>}
          </div>
        </Td>
      </tr>
      {turnoOpen && (
        <tr style={{ background: novo ? C.goldBg : C.bg }}>
          <td /><td colSpan={6} style={{ padding: '8px 9px' }}>
            <TurnoPicker fc={fc} r={r} up={up} onClose={() => setTurnoOpen(false)} />
          </td>
        </tr>
      )}
      {(mais || erroLinha) && (
        <tr style={{ background: novo ? C.goldBg : C.bg }}>
          <td /><td colSpan={6} style={{ padding: '4px 9px 10px' }}>
            {erroLinha && <div style={{ background: C.redBg, color: C.red, padding: '6px 10px', borderRadius: 7, fontSize: 12.5, marginBottom: mais ? 8 : 0 }}>{erroLinha}</div>}
            {mais && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
                <L label="Centro de custo"><input value={r.centro_custo} onChange={(e) => up({ centro_custo: e.target.value })} style={inp} /></L>
                <L label="Supervisor"><input value={r.supervisor_nome} onChange={(e) => up({ supervisor_nome: e.target.value })} style={inp} /></L>
                <L label="Alocação"><select value={r.alocacao} onChange={(e) => up({ alocacao: e.target.value })} style={inp}><option value="fixa">pessoas fixas</option><option value="rotativa">pessoas rotativas</option></select></L>
                <L label="Categoria de produto"><select value={r.categoria_produto_id} onChange={(e) => up({ categoria_produto_id: e.target.value })} style={inp}><option value="">—</option>{fc.listas.categorias.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></L>
                <L label="Tipo do posto"><select value={r.tipo_posto_id} onChange={(e) => up({ tipo_posto_id: e.target.value })} style={inp}><option value="">—</option>{fc.listas.tipos.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}</select></L>
                <L label="Unidade que conta"><select value={r.unidade_medida_id} onChange={(e) => up({ unidade_medida_id: e.target.value })} style={inp}><option value="">—</option>{fc.listas.unidades.map((u) => <option key={u.id} value={u.id}>{u.codigo}</option>)}</select></L>
              </div>
            )}
            {r.alocacao === 'rotativa' && mais && <div style={{ fontSize: 11.5, color: C.amber, marginTop: 6 }}>⚠️ Posto rotativo: a produtividade por pessoa virá do ponto, não do quadro.</div>}
          </td>
        </tr>
      )}
      <tr style={{ background: novo ? C.goldBg : undefined }}>
        <td /><td colSpan={6} style={{ padding: '0 9px 8px' }}>
          <button type="button" onClick={() => setMais((v) => !v)} style={{ background: 'none', border: 'none', color: C.blue, cursor: 'pointer', fontSize: 11.5, padding: 0 }}>
            {mais ? '− menos campos' : '+ mais campos (centro de custo, supervisor, categoria…)'}
          </button>
          {!novo && posto && posto.capacidade_hora == null && !dirty && <span style={{ fontSize: 11.5, color: C.espM, marginLeft: 10 }}>Capacidade em branco = <b>a medir</b> (nunca zero).</span>}
        </td>
      </tr>
    </>
  )
}

function TurnoPicker({ fc, r, up, onClose }: { fc: FluxoCompleto; r: Rascunho; up: (p: Partial<Rascunho>) => void; onClose: () => void }) {
  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 9, padding: 10, background: C.white }}>
      <div style={{ fontSize: 11.5, color: C.espM, marginBottom: 6 }}>
        Entradas mais comuns no ponto da planta (jornada individual — não é turno de planta, mas mostra a realidade). Um clique preenche a entrada.
      </div>
      {fc.sugestoes_turno.length === 0 ? (
        <div style={{ fontSize: 12, color: C.espM, marginBottom: 8 }}>Sem histórico de ponto para esta planta.</div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
          {fc.sugestoes_turno.slice(0, 8).map((s) => (
            <button key={s.horario} type="button" onClick={() => up({ hora_entrada: s.horario, turno_id: '' })}
              style={{ border: `1px solid ${r.hora_entrada === s.horario ? C.green : C.border}`, background: r.hora_entrada === s.horario ? C.greenBg : C.white, borderRadius: 999, padding: '4px 10px', fontSize: 12, cursor: 'pointer', color: C.esp }}>
              <b>{s.horario}</b> <span style={{ color: C.espM, fontSize: 10.5 }}>{s.ocorrencias.toLocaleString('pt-BR')} dias</span>
            </button>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ fontSize: 11.5, color: C.espM }}>entra <input type="time" value={r.hora_entrada} onChange={(e) => up({ hora_entrada: e.target.value, turno_id: '' })} style={{ ...inp, width: 'auto', marginLeft: 4 }} /></label>
        <label style={{ fontSize: 11.5, color: C.espM }}>sai <input type="time" value={r.hora_saida} onChange={(e) => up({ hora_saida: e.target.value })} style={{ ...inp, width: 'auto', marginLeft: 4 }} /></label>
        {fc.listas.turnos.length > 0 && (
          <label style={{ fontSize: 11.5, color: C.espM }}>ou turno da planta&nbsp;
            <select value={r.turno_id} onChange={(e) => { const t = fc.listas.turnos.find((x) => x.id === e.target.value); up({ turno_id: e.target.value, hora_entrada: hhmm(t?.inicio) || r.hora_entrada, hora_saida: hhmm(t?.fim) || r.hora_saida }) }} style={{ ...inp, width: 'auto' }}>
              <option value="">—</option>{fc.listas.turnos.map((t) => <option key={t.id} value={t.id}>{t.codigo}{t.inicio ? ` (${hhmm(t.inicio)}–${hhmm(t.fim)})` : ''}</option>)}
            </select>
          </label>
        )}
        <button type="button" onClick={onClose} style={{ ...btn(true), background: 'transparent', color: C.espM, border: `1px solid ${C.border}`, padding: '5px 10px', fontSize: 12 }}>ok</button>
      </div>
      <div style={{ fontSize: 11, color: C.espM, marginTop: 6 }}>O horário do ponto vira um turno da planta ao salvar. Depois é só ajustar em “configuração avançada”.</div>
    </div>
  )
}

// ─────────── NOVO FLUXO ───────────
function NovoFluxoModal({ companyId, plantId, onClose, onSaved, onErro }: { companyId: string; plantId: string; onClose: () => void; onSaved: (id: string) => void; onErro: (m: string) => void }) {
  const [setores, setSetores] = useState<Opt[]>([])
  const [unidades, setUnidades] = useState<Opt[]>([])
  const [f, setF] = useState({ nome: '', setor_id: '', unidade_entrada_id: '' })
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void (async () => {
      const [{ data: s }, { data: u }] = await Promise.all([
        supabase.from('prod_setor').select('id, nome').eq('company_id', companyId).eq('plant_id', plantId).order('ordem'),
        supabase.from('prod_unidade_medida').select('id, nome, codigo').eq('company_id', companyId).eq('plant_id', plantId).order('codigo'),
      ])
      setSetores((s as Opt[]) ?? []); setUnidades((u as Opt[]) ?? [])
    })()
  }, [companyId, plantId])
  async function salvar() {
    setBusy(true)
    const { data, error } = await supabase.from('prod_fluxo').insert({ company_id: companyId, plant_id: plantId, setor_id: f.setor_id, nome: f.nome.trim(), modo: 'compartilhado', produto_id: null, unidade_entrada_id: f.unidade_entrada_id || null }).select('id').single()
    setBusy(false)
    if (error || !data) { onErro(error?.message || 'Falha ao criar fluxo.'); return }
    onSaved((data as { id: string }).id)
  }
  const pode = f.nome.trim() && f.setor_id
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.white, borderRadius: 12, padding: 18, width: 'min(520px,100%)' }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Novo fluxo</div>
        <div style={{ fontSize: 12, color: C.espM, marginBottom: 12 }}>O fluxo é o contexto dos postos. Escolha o setor e a unidade que entra.</div>
        {setores.length === 0 && <div style={{ fontSize: 12, color: C.amber, marginBottom: 8 }}>Cadastre ao menos um setor em “configuração avançada” antes.</div>}
        <div style={{ display: 'grid', gap: 8 }}>
          <input value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} placeholder="nome do fluxo (ex.: Abate — do boi à carcaça)" style={inp} />
          <select value={f.setor_id} onChange={(e) => setF({ ...f, setor_id: e.target.value })} style={inp}><option value="">setor…</option>{setores.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}</select>
          <select value={f.unidade_entrada_id} onChange={(e) => setF({ ...f, unidade_entrada_id: e.target.value })} style={inp}><option value="">unidade de entrada… (opcional)</option>{unidades.map((u) => <option key={u.id} value={u.id}>{u.codigo}</option>)}</select>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ ...btn(true), background: 'transparent', color: C.espM, border: `1px solid ${C.border}` }}>Cancelar</button>
          <button disabled={!pode || busy} style={btn(!!pode && !busy)} onClick={() => void salvar()}>{busy ? 'Criando…' : 'Criar fluxo'}</button>
        </div>
      </div>
    </div>
  )
}

// ─────────── CONFIGURACAO AVANCADA (parametros) ───────────
type Ctx = { companyId: string; plantId: string; flash: (m: string) => void; flashErr: (m: string) => void }
type Row = Record<string, unknown> & { id: string }

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
function ehDuplicado(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  return error.code === '23505' || /duplicate key|already exists|unique constraint/i.test(error.message ?? '')
}
async function inserir(tabela: string, ctx: Ctx, payload: Record<string, unknown>, msgDup?: string): Promise<boolean> {
  const { error } = await supabase.from(tabela).insert({ company_id: ctx.companyId, plant_id: ctx.plantId, ...payload })
  if (error) { ctx.flashErr(ehDuplicado(error) && msgDup ? msgDup : error.message); return false }
  ctx.flash('CRIOU.'); return true
}
async function renomear(tabela: string, ctx: Ctx, id: string, nome: string): Promise<boolean> {
  const { error } = await supabase.from(tabela).update({ nome }).eq('id', id)
  if (error) { ctx.flashErr(ehDuplicado(error) ? 'Já existe um item com esse nome.' : error.message); return false }
  ctx.flash('ALTEROU.'); return true
}
async function remover(tabela: string, ctx: Ctx, id: string): Promise<boolean> {
  const { error } = await supabase.from(tabela).delete().eq('id', id)
  if (error) { ctx.flashErr(/foreign key|violates/i.test(error.message) ? 'Não dá para excluir: item vinculado a um posto/fluxo. Remova o vínculo antes.' : error.message); return false }
  ctx.flash('EXCLUIU.'); return true
}

function CadastroSimples({ ctx, tabela, titulo, order, placeholder, onMudou }: { ctx: Ctx; tabela: string; titulo: string; order: string; placeholder: string; onMudou: () => void }) {
  const { rows, carregar } = useLista(tabela, ctx, order)
  const [novo, setNovo] = useState('')
  const [edit, setEdit] = useState<{ id: string; nome: string } | null>(null)
  const campo = tabela === 'prod_unidade_medida' || tabela === 'prod_tipo_posto' ? 'codigo' : 'nome'
  return (
    <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>{titulo}</div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        <input value={novo} onChange={(e) => setNovo(e.target.value)} placeholder={placeholder} style={inp} />
        <button disabled={!novo.trim()} style={btn(!!novo.trim())} onClick={async () => {
          const nome = novo.trim()
          const payload = tabela === 'prod_setor' ? { nome, ordem: rows.length + 1 } : { nome }
          if (await inserir(tabela, ctx, payload, `Já existe um item chamado "${nome}".`)) { setNovo(''); await carregar(); onMudou() }
        }}>+</button>
      </div>
      {rows.length === 0 ? <div style={{ fontSize: 12, color: C.espL, fontStyle: 'italic' }}>Nada cadastrado.</div> : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {rows.map((r) => (
            <span key={r.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: C.cream, borderRadius: 999, padding: '3px 6px 3px 10px', fontSize: 12.5 }}>
              {edit?.id === r.id ? (
                <>
                  <input value={edit.nome} onChange={(e) => setEdit({ id: r.id, nome: e.target.value })} style={{ ...inp, width: 120, padding: '2px 6px' }} autoFocus />
                  <button onClick={async () => { if (edit.nome.trim() && await renomear(tabela, ctx, r.id, edit.nome.trim())) { setEdit(null); await carregar(); onMudou() } }} style={{ border: 'none', background: 'none', color: C.green, cursor: 'pointer', fontWeight: 700 }}>✓</button>
                  <button onClick={() => setEdit(null)} style={{ border: 'none', background: 'none', color: C.espM, cursor: 'pointer' }}>×</button>
                </>
              ) : (
                <>
                  <span>{String(r[campo] ?? r.nome)}</span>
                  <button onClick={() => setEdit({ id: r.id, nome: String(r.nome ?? r[campo] ?? '') })} title="Renomear" style={{ border: 'none', background: 'none', color: C.blue, cursor: 'pointer', fontSize: 11 }}>✎</button>
                  <button onClick={async () => { if (window.confirm(`Excluir "${String(r[campo] ?? r.nome)}"?`) && await remover(tabela, ctx, r.id)) { await carregar(); onMudou() } }} title="Excluir" style={{ border: 'none', background: 'none', color: C.red, cursor: 'pointer', fontWeight: 700 }}>×</button>
                </>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function Avancado({ ctx, onMudou }: { ctx: Ctx; onMudou: () => Promise<void> }) {
  const md = () => { void onMudou() }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12, marginTop: 10 }}>
      <CadastroSimples ctx={ctx} tabela="prod_setor" titulo="Setores" order="ordem" placeholder="ex.: Abate, Desossa" onMudou={md} />
      <CadastroSimples ctx={ctx} tabela="prod_cargo" titulo="Cargos" order="nome" placeholder="ex.: Operador" onMudou={md} />
      <CadastroSimples ctx={ctx} tabela="prod_unidade_medida" titulo="Unidades de medida" order="codigo" placeholder="código (kg, cabeca…)" onMudou={md} />
      <CadastroSimples ctx={ctx} tabela="prod_categoria_produto" titulo="Categorias de produto" order="ordem" placeholder="ex.: Abate, Miúdos" onMudou={md} />
    </div>
  )
}

// ─────────── SALARIO BASE (§2-bis) ───────────
// A folha traz o PAGO no mes (oscila com HE/faltas/rescisao) — nao o salario base. Por isso a
// folha SUGERE (fn_prod_salario_sugerir_da_folha, so leitura), o humano CONFIRMA (fn_prod_salario_salvar).
// A fonte SEMPRE aparece ao lado do valor (RD-51). Por pessoa (elo = matricula) ou por cargo (estimativa).
type SalSug = { matricula: number; nome: string; sugerido: number; competencias: { competencia: string; remuneracao: number }[]; variacao_pct: number | null; aviso: boolean }
type SalRow = Row & { funcionario_id: string | null; cargo_id: string | null; matricula: number | null; valor: number; fonte: string; competencia_ref: string | null; compliance_funcionarios?: { nome_completo?: string } | null; prod_cargo?: { nome?: string } | null }
const brl = (v: unknown) => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const mesBr = (d: string) => d ? d.slice(0, 7).split('-').reverse().join('/') : ''

function SalarioBase({ ctx }: { ctx: Ctx }) {
  const [rows, setRows] = useState<SalRow[]>([])
  const [cargos, setCargos] = useState<Opt[]>([])
  const [comps, setComps] = useState<string[]>([])
  const [comp, setComp] = useState('')
  const [sug, setSug] = useState<SalSug[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [manualCargo, setManualCargo] = useState({ cargo_id: '', valor: '', fonte: 'manual' })

  const carregar = useCallback(async () => {
    const [{ data: sal }, { data: cg }, { data: fc }] = await Promise.all([
      supabase.from('prod_salario_base').select('*, compliance_funcionarios(nome_completo), prod_cargo(nome)').eq('company_id', ctx.companyId).is('vigencia_fim', null).order('criado_em', { ascending: false }),
      supabase.from('prod_cargo').select('id, nome').eq('company_id', ctx.companyId).eq('plant_id', ctx.plantId).order('nome'),
      supabase.from('folha_competencia').select('competencia').eq('company_id', ctx.companyId).order('competencia', { ascending: false }),
    ])
    setRows((sal as SalRow[]) ?? [])
    setCargos((cg as Opt[]) ?? [])
    const uniq = Array.from(new Set(((fc as { competencia: string }[]) ?? []).map((x) => x.competencia)))
    setComps(uniq); setComp((prev) => prev || uniq[0] || '')
  }, [ctx.companyId, ctx.plantId])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])

  async function sugerir() {
    if (!comp) return
    setBusy(true); setSug(null)
    const { data, error } = await supabase.rpc('fn_prod_salario_sugerir_da_folha', { p_company_id: ctx.companyId, p_competencia: comp })
    setBusy(false)
    const r = data as { ok?: boolean; itens?: SalSug[] } | null
    if (error || !r?.ok) { ctx.flashErr(error?.message || 'Falha ao buscar da folha.'); return }
    setSug(r.itens ?? [])
  }
  async function salvar(dados: Record<string, unknown>): Promise<boolean> {
    const { data: { user } } = await supabase.auth.getUser()
    const { data, error } = await supabase.rpc('fn_prod_salario_salvar', { p_dados: { company_id: ctx.companyId, plant_id: ctx.plantId, ...dados }, p_user: user?.id ?? null })
    const r = data as { ok?: boolean; erro?: string } | null
    if (error || !r?.ok) { ctx.flashErr(r?.erro === 'sem_alvo' ? 'Sem cadastro de funcionário para esta matrícula — use o salário por cargo.' : r?.erro === 'valor_invalido' ? 'Valor inválido.' : (error?.message || 'Falha ao salvar salário.')); return false }
    ctx.flash('CRIOU salário base.'); await carregar(); return true
  }
  async function excluir(id: string) {
    if (!window.confirm('Excluir este salário base?')) return
    const { error } = await supabase.from('prod_salario_base').delete().eq('id', id)
    if (error) { ctx.flashErr(error.message); return }
    ctx.flash('EXCLUIU.'); await carregar()
  }
  const jaTem = (mat: number) => rows.some((r) => r.matricula === mat)

  return (
    <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, marginTop: 10 }}>
      <div style={{ fontSize: 11.5, color: C.espM, marginBottom: 10 }}>
        A folha traz o <b>pago no mês</b> (oscila com hora extra, faltas, rescisão) — <b>não</b> o salário base. Por isso a folha <b>sugere</b>, você <b>confirma</b>. A fonte fica sempre ao lado do valor.
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
        <label style={{ fontSize: 12, color: C.espM }}>Competência&nbsp;
          <select value={comp} onChange={(e) => setComp(e.target.value)} style={{ ...inp, width: 'auto' }}>
            {comps.length === 0 && <option value="">— sem folha —</option>}
            {comps.map((c) => <option key={c} value={c}>{mesBr(c)}</option>)}
          </select>
        </label>
        <button type="button" disabled={busy || !comp} onClick={() => void sugerir()} style={{ ...btn(!busy && !!comp), background: C.blue, padding: '6px 12px', fontSize: 12 }}>{busy ? 'Buscando…' : '📄 Sugerir da folha'}</button>
      </div>
      {sug && (
        <div style={{ maxHeight: 320, overflowY: 'auto', border: `1px solid ${C.border}`, borderRadius: 8, marginBottom: 12 }}>
          {sug.length === 0 ? <div style={{ padding: 12, fontSize: 12, color: C.espM }}>Sem folha nesta competência.</div>
            : sug.map((s) => <SugLinha key={s.matricula} s={s} jaTem={jaTem(s.matricula)} comp={comp} onSalvar={salvar} />)}
        </div>
      )}
      <div style={{ background: C.bg, borderRadius: 8, padding: 10, marginBottom: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Salário por cargo <span style={{ fontWeight: 400, color: C.espM }}>— estimativa, enquanto não há alocação nominal</span></div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={manualCargo.cargo_id} onChange={(e) => setManualCargo({ ...manualCargo, cargo_id: e.target.value })} style={{ ...inp, width: 'auto' }}><option value="">cargo…</option>{cargos.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</select>
          <input value={manualCargo.valor} onChange={(e) => setManualCargo({ ...manualCargo, valor: e.target.value })} placeholder="R$ base" inputMode="decimal" style={{ ...inp, width: 110 }} />
          <select value={manualCargo.fonte} onChange={(e) => setManualCargo({ ...manualCargo, fonte: e.target.value })} style={{ ...inp, width: 'auto' }}><option value="manual">digitado</option><option value="acordo_coletivo">acordo coletivo</option></select>
          <button type="button" disabled={!manualCargo.cargo_id || !manualCargo.valor} style={btn(!!manualCargo.cargo_id && !!manualCargo.valor)} onClick={async () => { if (await salvar({ cargo_id: manualCargo.cargo_id, valor: manualCargo.valor, fonte: manualCargo.fonte })) setManualCargo({ cargo_id: '', valor: '', fonte: 'manual' }) }}>+ Salvar por cargo</button>
        </div>
      </div>
      {rows.length === 0 ? <div style={{ fontSize: 12, color: C.espL, fontStyle: 'italic' }}>Nenhum salário base cadastrado.</div> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {rows.map((r) => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, borderBottom: `1px solid ${C.cream}`, padding: '4px 0' }}>
              <span style={{ flex: 1 }}>{r.funcionario_id ? (r.compliance_funcionarios?.nome_completo ?? `matrícula ${r.matricula ?? '—'}`) : `cargo: ${r.prod_cargo?.nome ?? '—'}`}</span>
              <b>{brl(r.valor)}</b>
              <span style={{ fontSize: 10.5, padding: '2px 7px', borderRadius: 999, background: r.fonte === 'folha' ? C.greenBg : C.cream, color: r.fonte === 'folha' ? C.green : C.espM }}>
                {r.fonte === 'folha' ? `folha ${mesBr(r.competencia_ref ?? '')}` : r.fonte === 'acordo_coletivo' ? 'acordo coletivo' : 'digitado'}
              </span>
              <button onClick={() => void excluir(r.id)} title="Excluir" style={{ border: 'none', background: 'none', color: C.red, cursor: 'pointer', fontWeight: 700 }}>×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function SugLinha({ s, jaTem, comp, onSalvar }: { s: SalSug; jaTem: boolean; comp: string; onSalvar: (d: Record<string, unknown>) => Promise<boolean> }) {
  const [manual, setManual] = useState('')
  return (
    <div style={{ padding: '7px 10px', borderBottom: `1px solid ${C.cream}`, opacity: jaTem ? 0.6 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 700, fontSize: 12.5, flex: '1 1 160px' }}>{s.nome} <span style={{ color: C.espM, fontWeight: 400 }}>· mat. {s.matricula}</span></span>
        {s.competencias.map((c) => <span key={c.competencia} style={{ fontSize: 11, color: C.espM }}>{mesBr(c.competencia)} {brl(c.remuneracao)}</span>)}
      </div>
      {s.aviso && <div style={{ fontSize: 11, color: C.amber, marginTop: 2 }}>⚠️ variação de {s.variacao_pct}% — a folha traz o pago, não o base</div>}
      {jaTem ? <div style={{ fontSize: 11, color: C.green, marginTop: 4 }}>✓ já tem salário base</div> : (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 5, flexWrap: 'wrap' }}>
          <button type="button" style={{ ...btn(true), padding: '4px 10px', fontSize: 12 }} onClick={() => void onSalvar({ matricula: String(s.matricula), valor: String(s.sugerido), fonte: 'folha', competencia_ref: comp })}>usar {brl(s.sugerido)}</button>
          <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="outro valor" inputMode="decimal" style={{ ...inp, width: 100, padding: '4px 7px' }} />
          {manual && <button type="button" style={{ ...btn(true), background: 'transparent', color: C.esp, border: `1px solid ${C.border}`, padding: '4px 8px', fontSize: 12 }} onClick={() => void onSalvar({ matricula: String(s.matricula), valor: manual, fonte: 'manual', competencia_ref: comp })}>digitar</button>}
        </div>
      )}
    </div>
  )
}

function Th({ children, w }: { children?: React.ReactNode; w?: number }) { return <th style={{ textAlign: 'left', padding: '8px 9px', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.4, color: C.espM, width: w }}>{children}</th> }
function Td({ children }: { children?: React.ReactNode }) { return <td style={{ padding: '6px 9px', color: C.esp }}>{children}</td> }
function L({ label, children }: { label: string; children: React.ReactNode }) { return <label style={{ fontSize: 11, color: C.espM, display: 'block' }}>{label}<div style={{ marginTop: 2 }}>{children}</div></label> }
function Aviso({ texto }: { texto: string }) { return <div style={{ background: C.bg, minHeight: '100vh', padding: 28, color: C.espM, fontSize: 14 }}>{texto}</div> }
