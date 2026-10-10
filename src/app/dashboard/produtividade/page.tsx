'use client'

// Produtividade Industrial · tela UNICA por fluxo. O fluxo e o CONTEXTO (setor, unidade de
// entrada, vinculos de ponto/producao) — nao se repete em cada posto. Uma linha por posto,
// editavel no lugar; o turno vem pronto do ponto (com a contagem, que da confianca); parametros
// saem da frente ("configuracao avancada"). A faixa de prontidao responde "onde vou ver o
// resultado". Erros aparecem NA LINHA (nao so no topo). CRIOU/ALTEROU/EXCLUIU. Sem "0" no lugar
// de ausencia — capacidade em branco = a medir.

import { useCallback, useEffect, useMemo, useState, Suspense } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { CelulaEditavel } from '@/components/produtividade/CelulaEditavel'
import { ArvoreProduto } from '@/components/produtividade/ArvoreProduto'

const ROTA = '/dashboard/produtividade'
const Aj = ({ k }: { k: string }) => <AjudaCampo chave={k} rota={ROTA} />

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
type Prontidao = { ok: boolean; pronto_para_medir: boolean; falta: string[]; tem: { setores_com_vinculo: number; postos: number; quadros: number; dias_com_ponto: number; datas_distintas: number; vinculos_ponto: number; producao_chaves: string[]; fluxos: number } }

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
  const [configAberto, setConfigAberto] = useState(false)
  const [salAberto, setSalAberto] = useState(false)
  const [novoFluxo, setNovoFluxo] = useState(false)
  const [setoresOpt, setSetoresOpt] = useState<Opt[]>([])
  const [foco, setFoco] = useState<Foco>(null)

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

  // setores da planta (para trocar o setor do fluxo)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!companyId || !plantId) { setSetoresOpt([]); return }
    void (async () => {
      const { data } = await supabase.from('prod_setor').select('id, nome').eq('company_id', companyId).eq('plant_id', plantId).order('ordem')
      setSetoresOpt((data as Opt[]) ?? [])
    })()
  }, [companyId, plantId])

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
      <div style={{ display: 'flex', gap: 14, fontSize: 14, margin: '6px 0' }}><b style={{ borderBottom: `2px solid ${C.gold}` }}>Cadastro</b><Link href="/dashboard/produtividade/indicadores" style={{ color: C.espM }}>Indicadores</Link></div>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: '2px 0 0' }}>Cadastro por fluxo</h1>
      <p style={{ color: C.espM, fontSize: 13, margin: '6px 0 12px' }}>O fluxo é o contexto. Cada linha é um posto — clique para editar. O turno vem do ponto.</p>

      {msg && <div style={{ background: C.greenBg, color: C.green, padding: '9px 13px', borderRadius: 8, fontSize: 13, marginBottom: 12 }}>{msg}</div>}
      {erro && <div style={{ background: C.redBg, color: C.red, padding: '9px 13px', borderRadius: 8, fontSize: 13, marginBottom: 12 }}>{erro}</div>}

      {/* Produto acabado + árvore até a origem (Onda 2) */}
      {plantId && <ArvoreProduto companyId={companyId} plantId={plantId} fluxos={fluxos.map((f) => ({ id: f.id, nome: f.nome }))} flash={flash} flashErr={flashErr} onMudou={recarregar} />}

      {/* Faixa: o que falta para medir */}
      {pront && <FaixaProntidao pront={pront} temPostos={(fc?.postos.length ?? 0) > 0} onIr={(tipo) => setFoco({ tipo, n: Date.now() })} />}

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
        <button data-testid="novo-fluxo" onClick={() => setNovoFluxo(true)} style={{ ...btn(true), padding: '7px 12px', fontSize: 12.5 }}>+ Novo fluxo</button>
        <button onClick={() => setConfigAberto(true)} style={{ ...btn(true), background: 'transparent', color: C.esp, border: `1px solid ${C.border}`, padding: '7px 12px', fontSize: 12.5 }}>⚙ Cadastros</button>
      </div>

      {fluxos.length === 0 ? (
        <div style={{ background: C.white, border: `1px dashed ${C.border}`, borderRadius: 12, padding: '28px 16px', textAlign: 'center', color: C.espM }}>
          Comece criando um fluxo (ex.: <b>Abate — do boi à carcaça pesada</b>). O setor e a unidade de entrada ficam no fluxo, não em cada posto.
        </div>
      ) : fc ? (
        <>
          {/* Contexto do fluxo — cada valor edita no lugar */}
          <ContextoFluxo fc={fc} setores={setoresOpt} flash={flash} onMudou={recarregar} />
          <ProntidaoFluxo fc={fc} companyId={companyId} plantId={plantId!} flash={flash} onMudou={recarregar} onIr={(tipo) => { if (tipo === 'turno' || tipo === 'novo') setFoco({ tipo, n: Date.now() }); else document.querySelector('[data-testid="arvore-produto"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }} />

          <TabelaPostos fc={fc} companyId={companyId} plantId={plantId!} flash={flash} flashErr={flashErr} onMudou={recarregar} foco={foco} />
        </>
      ) : (
        <div style={{ fontSize: 13, color: C.espM, padding: 20 }}>Carregando o fluxo…</div>
      )}

      {/* Salario base (custo por posto) */}
      <div style={{ marginTop: 10 }}>
        <button onClick={() => setSalAberto((v) => !v)} style={{ background: 'none', border: 'none', color: C.espM, cursor: 'pointer', fontSize: 12.5, fontWeight: 700, padding: '6px 0' }}>
          💰 Salário base — para custo por posto (da folha ou manual) {salAberto ? '▲' : '▼'}
        </button>
        {salAberto && plantId && <SalarioBase ctx={{ companyId, plantId, flash, flashErr }} />}
      </div>

      {novoFluxo && plantId && <NovoFluxoModal companyId={companyId} plantId={plantId} onClose={() => setNovoFluxo(false)} onSaved={(id) => { setNovoFluxo(false); setFluxoId(id); void carregarPlanta() }} onErro={flashErr} />}
      {configAberto && plantId && <ConfigModal ctx={{ companyId, plantId, flash, flashErr }} onClose={() => setConfigAberto(false)} onMudou={recarregar} />}
    </div>
  )
}

function FaixaProntidao({ pront, temPostos, onIr }: { pront: Prontidao; temPostos: boolean; onIr: (tipo: 'turno' | 'novo') => void }) {
  const ok = pront.pronto_para_medir
  const t = pront.tem
  const temFrase = [
    t.vinculos_ponto > 0 ? `${t.vinculos_ponto} vínculo(s) de ponto` : null,
    t.producao_chaves.length > 0 ? `produção ${t.producao_chaves.join(', ')}` : null,
    t.dias_com_ponto > 0 ? `${t.dias_com_ponto.toLocaleString('pt-BR')} dias de ponto em ${(t.datas_distintas ?? 0).toLocaleString('pt-BR')} datas` : null,
  ].filter(Boolean).join(', ')
  // cada pendencia vira link para o campo que a resolve (fn_prod_prontidao devolve estes textos)
  const destino = (f: string): { rotulo: string; tipo: 'turno' | 'novo' | null; dica: string } => {
    if (f === 'nenhum posto cadastrado') return { rotulo: 'cadastrar o 1º posto', tipo: 'novo', dica: 'abre a linha "nova atividade"' }
    if (f === 'nenhum posto tem quadro de turno') return temPostos
      ? { rotulo: 'definir o Turno e horário do 1º posto', tipo: 'turno', dica: 'abre o Turno e horário do 1º posto' }
      : { rotulo: 'cadastre um posto primeiro', tipo: 'novo', dica: 'abre a linha "nova atividade"' }
    if (f === 'nenhum setor vinculado a uma base (ponto ou producao)') return { rotulo: 'vincular o setor ao ponto/produção (feito pela equipe PS — peça pelo chamado)', tipo: null, dica: 'não há campo nesta tela para isso' }
    return { rotulo: f, tipo: null, dica: '' }
  }
  return (
    <div data-testid="faixa-prontidao" style={{ background: ok ? C.greenBg : C.amberBg, border: `1px solid ${ok ? C.green : C.amber}55`, borderRadius: 12, padding: '11px 14px', fontSize: 13, color: ok ? C.green : '#8A4B08' }}>
      {ok ? <b>Base da planta pronta.</b> : (
        <>
          <b>Base da planta incompleta.</b>{pront.falta.length > 0 && ' Falta:'}
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {pront.falta.map((f) => {
              const d = destino(f)
              return (
                <li key={f}>{f} {d.tipo
                  ? <button type="button" data-testid={`falta-${d.tipo}`} onClick={() => onIr(d.tipo!)} title={d.dica} style={{ background: 'none', border: 'none', padding: 0, color: C.blue, textDecoration: 'underline', cursor: 'pointer', fontSize: 13 }}>→ {d.rotulo}</button>
                  : <span style={{ color: C.espM }}>→ {d.rotulo}</span>}</li>
              )
            })}
          </ul>
        </>
      )}
      {temFrase && <div style={{ color: C.espM, marginTop: 3 }}>Você já tem: {temFrase}.</div>}
    </div>
  )
}

// Contexto do fluxo (nome, setor, unidade de entrada) editavel no lugar — grava em prod_fluxo (RLS por empresa).
function ContextoFluxo({ fc, setores, flash, onMudou }: { fc: FluxoCompleto; setores: Opt[]; flash: (m: string) => void; onMudou: () => Promise<void> }) {
  const f = fc.fluxo
  async function gravar(patch: Record<string, unknown>, msg: string): Promise<string | null> {
    const { error } = await supabase.from('prod_fluxo').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', f.id)
    if (error) return ehDuplicado(error) ? 'Já existe um fluxo com esse nome nesta planta — escolha outro nome.' : `Não consegui salvar: ${error.message}`
    flash(msg); await onMudou(); return null
  }
  const sets = setores.map((s) => ({ value: s.id, label: s.nome }))
  const unids = fc.listas.unidades.map((u) => ({ value: u.id, label: String(u.codigo ?? u.nome) }))
  return (
    <div data-testid="fluxo-contexto" style={{ fontSize: 12.5, color: C.espM, margin: '2px 0 10px', display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
      <span>Fluxo<Aj k="prod.fluxo.nome" /> <b style={{ color: C.esp }}><CelulaEditavel testid="fluxo-nome" valor={f.nome} obrigatorio onSalvar={(v) => gravar({ nome: v }, 'ALTEROU o nome do fluxo.')} /></b></span>
      <span>Setor<Aj k="prod.fluxo.setor" /> <b style={{ color: C.esp }}><CelulaEditavel testid="fluxo-setor" tipo="lista" obrigatorio valor={f.setor_id} opcoes={sets} rotuloValor={(v) => sets.find((o) => o.value === v)?.label ?? f.setor_nome ?? '—'}
        onSalvar={async (v) => {
          if (!window.confirm('Trocar o setor do fluxo?\n\nA tabela passa a mostrar os postos do NOVO setor. Os postos do setor antigo não são apagados.')) return 'Troca de setor cancelada — nada foi alterado.'
          return gravar({ setor_id: v }, 'ALTEROU o setor do fluxo.')
        }} /></b></span>
      <span>Entra<Aj k="prod.fluxo.unidade_entrada" /> <b style={{ color: C.esp }}><CelulaEditavel testid="fluxo-unidade" tipo="lista" valor={f.unidade_entrada_id ?? ''} opcoes={unids} vazio="— escolher" rotuloValor={(v) => unids.find((o) => o.value === v)?.label ?? '—'} onSalvar={(v) => gravar({ unidade_entrada_id: v || null }, 'ALTEROU a unidade de entrada.')} /></b></span>
      <span>{`ponto: ${fc.contexto.ponto} vínculo(s)`}{fc.contexto.producao.length > 0 ? ` · produção: ${fc.contexto.producao.join(', ')}` : ' · produção: sem vínculo'}</span>
    </div>
  )
}


// "Pronto para medir" POR FLUXO (RD-58): só fica verde quando o fluxo selecionado tem produto de origem, saídas, postos com turno e fontes ligadas.
type FaltaFluxo = { chave: string; texto: string; destino: string | null }
function ProntidaoFluxo({ fc, companyId, plantId, flash, onMudou, onIr }: { fc: FluxoCompleto; companyId: string; plantId: string; flash: (m: string) => void; onMudou: () => Promise<void>; onIr: (destino: string) => void }) {
  const fluxoId = fc.fluxo.id
  const [r, setR] = useState<{ pronto: boolean; falta: FaltaFluxo[] } | null>(null)
  const [origemId, setOrigemId] = useState('')
  const [prods, setProds] = useState<{ value: string; label: string }[]>([])
  const carregar = useCallback(async () => {
    const [{ data }, { data: fx }, { data: pp }] = await Promise.all([
      supabase.rpc('fn_prod_fluxo_prontidao', { p_fluxo_id: fluxoId }),
      supabase.from('prod_fluxo').select('produto_origem_id').eq('id', fluxoId).maybeSingle(),
      supabase.from('prod_produto').select('id, codigo, nome').eq('company_id', companyId).eq('plant_id', plantId).eq('ativo', true).order('codigo').limit(500),
    ])
    const x = data as { ok?: boolean; pronto?: boolean; falta?: FaltaFluxo[] } | null
    setR(x?.ok ? { pronto: !!x.pronto, falta: x.falta ?? [] } : null)
    setOrigemId((fx as { produto_origem_id: string | null } | null)?.produto_origem_id ?? '')
    setProds(((pp as { id: string; codigo: string; nome: string }[]) ?? []).map((p) => ({ value: p.id, label: `${p.codigo} · ${p.nome}` })))
  }, [fluxoId, companyId, plantId])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar, fc])
  async function gravarOrigem(v: string): Promise<string | null> {
    const { error } = await supabase.from('prod_fluxo').update({ produto_origem_id: v || null, updated_at: new Date().toISOString() }).eq('id', fluxoId)
    if (error) return `Não consegui salvar: ${error.message}`
    flash('ALTEROU o produto de origem do fluxo.'); await carregar(); await onMudou(); return null
  }
  const linkTxt: Record<string, string> = { origem: 'escolher o produto de origem', saidas: 'cadastrar as saídas na árvore', novo: 'cadastrar o 1º posto', turno: 'definir turno e horário' }
  return (
    <div data-testid="prontidao-fluxo" style={{ background: r?.pronto ? C.greenBg : C.amberBg, border: `1px solid ${r?.pronto ? C.green : C.amber}55`, borderRadius: 12, padding: '10px 14px', fontSize: 13, margin: '0 0 12px', color: r?.pronto ? C.green : '#8A4B08' }}>
      <div style={{ marginBottom: 4, color: C.esp }}>Entrada do fluxo<Aj k="prod.fluxo.produto_origem" /> <b><CelulaEditavel testid="fluxo-origem" tipo="busca" valor={origemId} opcoes={prods} vazio="— produto de origem" rotuloValor={(v) => prods.find((o) => o.value === v)?.label ?? '—'} onSalvar={gravarOrigem} /></b></div>
      {r == null ? 'Conferindo o fluxo…' : r.pronto ? <b>Pronto para medir este fluxo.</b> : (
        <>
          <b>Este fluxo ainda não está pronto para medir.</b> Falta:
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {r.falta.map((f) => (
              <li key={f.chave}>{f.texto} {f.destino
                ? <button type="button" data-testid={`falta-fluxo-${f.chave}`} onClick={() => onIr(f.destino!)} style={{ background: 'none', border: 'none', padding: 0, color: C.blue, textDecoration: 'underline', cursor: 'pointer', fontSize: 13 }}>→ {linkTxt[f.destino] ?? 'resolver'}</button>
                : <span style={{ color: C.espM }}>→ ligar em ⚙ Cadastros ou pedir pelo chamado</span>}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

// ─────────── TABELA DE POSTOS ───────────
type Foco = { tipo: 'turno' | 'novo'; n: number } | null

// Cargos do posto = TODAS as funcoes do PONTO da planta (fonte unica, RD-65) + os prod_cargo ja cadastrados. Lista via
// fn_prod_sugerir_cargos (so funcao + contagem, sem dado pessoal). Ao escolher: fn_prod_cargo_do_ponto_vincular reusa/cria o prod_cargo
// e grava o vinculo com o ponto (prod_cargo_vinculo) — e assim que as horas do ponto passam a contar para o posto.
const normCargo = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
type OpcaoCargo = { value: string; label: string; nome: string; doPonto: boolean }
type CargosPonto = { opcoes: OpcaoCargo[]; vinculados: number | null; resolver: (valor: string) => Promise<{ id: string; erro?: string }> }
function useCargosPonto(companyId: string, plantId: string, cargos: Opt[], flashErr: (m: string) => void): CargosPonto {
  const [ponto, setPonto] = useState<{ nome: string; pessoas: number }[]>([])
  const [vinculados, setVinculados] = useState<number | null>(null)
  const carregar = useCallback(async () => {
    const [{ data }, vinc] = await Promise.all([
      supabase.rpc('fn_prod_sugerir_cargos', { p_company_id: companyId, p_plant_id: plantId }),
      supabase.from('prod_cargo_vinculo').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('plant_id', plantId),
    ])
    const r = data as { ok?: boolean; itens?: { nome: string; pessoas: number }[] } | null
    // mesma funcao com maiuscula/acento diferente = um item so (soma as pessoas; fica a grafia mais frequente)
    const m = new Map<string, { nome: string; pessoas: number; top: number }>()
    for (const it of r?.ok ? (r.itens ?? []) : []) {
      const k = normCargo(it.nome); const a = m.get(k)
      if (!a) m.set(k, { nome: it.nome, pessoas: it.pessoas, top: it.pessoas })
      else { a.pessoas += it.pessoas; if (it.pessoas > a.top) { a.top = it.pessoas; a.nome = it.nome } }
    }
    setPonto([...m.values()].map(({ nome, pessoas }) => ({ nome, pessoas })))
    setVinculados(vinc.error ? null : (vinc.count ?? 0))
  }, [companyId, plantId])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])
  // liga ao ponto os prod_cargo que ja existem (idempotente: so insere o que falta)
  useEffect(() => {
    void (async () => { const { data } = await supabase.rpc('fn_prod_cargo_do_ponto_vincular', { p_company_id: companyId, p_plant_id: plantId, p_funcao: null }); if ((data as { vinculos_novos?: number } | null)?.vinculos_novos) void carregar() })()
  }, [companyId, plantId, carregar])

  const opcoes = useMemo<OpcaoCargo[]>(() => {
    const porNorm = new Map(cargos.map((c) => [normCargo(c.nome), c]))
    const out: OpcaoCargo[] = ponto.map((f) => {
      const c = porNorm.get(normCargo(f.nome))
      return { value: c ? c.id : `ponto:${f.nome}`, label: `${f.nome} · ${f.pessoas}`, nome: f.nome, doPonto: true }
    })
    const jaTem = new Set(out.map((o) => o.value))
    for (const c of cargos) if (!jaTem.has(c.id)) out.push({ value: c.id, label: c.nome, nome: c.nome, doPonto: false })
    return out.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
  }, [ponto, cargos])

  const resolver: CargosPonto['resolver'] = async (valor) => {
    if (!valor) return { id: '' }
    const o = opcoes.find((x) => x.value === valor)
    if (!o || !o.doPonto) return { id: valor }
    const { data, error } = await supabase.rpc('fn_prod_cargo_do_ponto_vincular', { p_company_id: companyId, p_plant_id: plantId, p_funcao: o.nome })
    const r = data as { ok?: boolean; erro?: string; cargo_id?: string } | null
    if (error || !r?.ok || !r.cargo_id) {
      const msg = r?.erro === 'sem_fonte_ponto' ? 'Esta planta não tem o ponto conectado — conecte o ponto antes de escolher o cargo.' : r?.erro === 'funcao_nao_esta_no_ponto' ? 'Essa função não está mais no ponto. Atualize a página.' : (error?.message || 'Não consegui ligar o cargo ao ponto. Tente de novo.')
      flashErr(msg); return { id: '', erro: msg }
    }
    void carregar()
    return { id: r.cargo_id }
  }
  return { opcoes, vinculados, resolver }
}

function TabelaPostos({ fc, companyId, plantId, flash, flashErr, onMudou, foco }: {
  fc: FluxoCompleto; companyId: string; plantId: string; flash: (m: string) => void; flashErr: (m: string) => void; onMudou: () => Promise<void>; foco: Foco
}) {
  // descricao_funcao nao vem em fn_prod_fluxo_completo: leitura a parte (so dos postos desta tela).
  const [descs, setDescs] = useState<Record<string, string>>({})
  const cp = useCargosPonto(companyId, plantId, fc.listas.cargos, flashErr)
  const ids = fc.postos.map((p) => p.id).join(',')
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!ids) { setDescs({}); return }
    void (async () => {
      const { data } = await supabase.from('prod_posto').select('id, descricao_funcao').in('id', ids.split(','))
      const m: Record<string, string> = {}
      ;((data as { id: string; descricao_funcao: string | null }[]) ?? []).forEach((r) => { m[r.id] = r.descricao_funcao ?? '' })
      setDescs(m)
    })()
  }, [ids, fc])
  useEffect(() => {
    if (foco?.tipo !== 'novo') return
    const el = document.querySelector<HTMLInputElement>('[data-testid="posto-novo-atividade"]')
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' }); el?.focus()
  }, [foco])
  return (
    <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ overflowX: 'auto' }}>
        <div data-testid="cargos-ponto-vinculados" style={{ fontSize: 11.5, color: C.espM, padding: '6px 10px 0' }}>{cp.opcoes.filter((o) => o.doPonto).length} cargo(s) do ponto na lista · {cp.vinculados ?? '—'} função(ões) do ponto ligada(s) a cargos</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 720 }}>
          <thead style={{ background: C.cream }}>
            <tr>
              <Th w={54} ajuda="prod.posto.numero">Nº</Th><Th ajuda="prod.posto.atividade">Atividade</Th><Th w={150} ajuda="prod.posto.cargo">Cargo</Th><Th w={170} ajuda="prod.posto.turno_horario">Turno e horário</Th><Th w={80} ajuda="prod.posto.pessoas">Pessoas</Th><Th w={90} ajuda="prod.posto.capacidade">Cap./h</Th><Th w={70} ajuda="prod.posto.arquivar"></Th>
            </tr>
          </thead>
          <tbody>
            {fc.postos.map((p, i) => (
              <LinhaPostoEditavel key={p.id} posto={p} descricao={descs[p.id] ?? ''} fc={fc} companyId={companyId} plantId={plantId} flash={flash} flashErr={flashErr} onMudou={onMudou} cp={cp} abrirTurno={i === 0 && foco?.tipo === 'turno' ? foco.n : 0} />
            ))}
            <LinhaPosto novo fc={fc} companyId={companyId} plantId={plantId} setor_id={fc.fluxo.setor_id} flash={flash} flashErr={flashErr} onMudou={onMudou} cp={cp} />
          </tbody>
        </table>
      </div>
    </div>
  )
}

// Linha de posto ja criada: cada valor edita no lugar (clique → campo → salva ao sair/Enter, Esc cancela). Toda gravacao manda a
// linha INTEIRA para fn_prod_posto_salvar (a funcao regrava todos os campos da linha; mandar so um apagaria os outros).
function LinhaPostoEditavel({ posto, descricao, fc, flash, flashErr, onMudou, abrirTurno, cp }: {
  posto: Posto; descricao: string; fc: FluxoCompleto; companyId: string; plantId: string;
  flash: (m: string) => void; flashErr: (m: string) => void; onMudou: () => Promise<void>; abrirTurno: number; cp: CargosPonto
}) {
  const [mais, setMais] = useState(false)
  const [turnoOpen, setTurnoOpen] = useState(false)
  const [t, setT] = useState<TurnoRasc>({ turno_id: '', hora_entrada: '', hora_saida: '' })
  const [erroTurno, setErroTurno] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const base = rascunhoDe(posto)
  // reabre/reidrata o horario quando o posto muda de fora
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setT({ turno_id: base.turno_id, hora_entrada: base.hora_entrada, hora_saida: base.hora_saida }) }, [posto]) // eslint-disable-line react-hooks/exhaustive-deps
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (abrirTurno > 0) setTurnoOpen(true) }, [abrirTurno])

  // devolve null = gravou; texto = erro que ensina
  async function gravar(patch: Partial<Rascunho>): Promise<string | null> {
    const r = { ...base, ...patch }
    if (!r.atividade.trim()) return 'A atividade é obrigatória — digite o que o posto faz.'
    const mexeuTurno = ['turno_id', 'hora_entrada', 'hora_saida', 'pessoas'].some((k) => k in patch)
    const cap = r.capacidade_hora.trim().replace(',', '.')
    if (cap && (!Number.isFinite(Number(cap)) || Number(cap) <= 0)) return cap && Number(cap) === 0 ? 'Zero não vale: deixe em branco (a medir) até medir de verdade.' : 'Digite só número, ex.: 420 ou 12,5.'
    const pes = r.pessoas.trim().replace(',', '.')
    if (pes && (!Number.isFinite(Number(pes)) || Number(pes) <= 0)) return 'Pessoas: digite só número maior que zero, ex.: 4.'
    if (mexeuTurno && pes && !r.turno_id && !r.hora_entrada) return 'Pessoas só entram junto com o horário: preencha antes o "Turno e horário" deste posto.'
    const dados: Record<string, unknown> = {
      id: posto.id, numero: r.numero?.trim() || undefined, atividade: r.atividade.trim(), cargo_id: r.cargo_id || null, unidade_medida_id: r.unidade_medida_id || null,
      tipo_posto_id: r.tipo_posto_id || null, categoria_produto_id: r.categoria_produto_id || null, indicador_id: posto.indicador_id,
      capacidade_hora: cap || null, alocacao: r.alocacao, centro_custo: r.centro_custo || null, supervisor_nome: r.supervisor_nome || null,
    }
    if (mexeuTurno && (r.turno_id || r.hora_entrada)) dados.turno = { turno_id: r.turno_id || null, hora_entrada: r.hora_entrada || null, hora_saida: r.hora_saida || null, pessoas: pes || null }
    const { data: { user } } = await supabase.auth.getUser()
    const { data, error } = await supabase.rpc('fn_prod_posto_salvar', { p_dados: dados, p_user: user?.id ?? null })
    const res = data as { ok?: boolean; erro?: string; numero?: string } | null
    if (error || !res?.ok) {
      return res?.erro === 'numero_duplicado' ? `Já existe um posto com o número ${res?.numero} neste setor — escolha outro número.`
        : res?.erro === 'atividade_obrigatoria' ? 'A atividade é obrigatória.'
        : res?.erro === 'sem_acesso' ? 'Sem acesso a este posto.'
        : (error?.message || 'Não consegui salvar. Confira o valor e tente de novo.')
    }
    if (mexeuTurno && dados.turno) await fecharQuadrosAntigos(posto.id, r)
    await onMudou()
    return null
  }

  // fn_prod_posto_salvar so encerra o quadro do MESMO turno; ao trocar o horario sobraria um 2º quadro aberto no posto
  // (a faixa "Pronto para medir" contaria dois). Encerra (vigencia_fim = hoje) os abertos que nao sao o que acabou de gravar.
  async function fecharQuadrosAntigos(postoId: string, r: Rascunho) {
    const { data } = await supabase.from('prod_posto_turno').select('id, hora_entrada, hora_saida, pessoas').eq('posto_id', postoId).is('vigencia_fim', null)
    const abertos = (data as { id: string; hora_entrada: string | null; hora_saida: string | null; pessoas: number | null }[]) ?? []
    if (abertos.length < 2) return
    const igual = (a: string | null, b: string) => hhmm(a) === b
    const novo = abertos.find((q) => igual(q.hora_entrada, r.hora_entrada) && igual(q.hora_saida, r.hora_saida) && (q.pessoas == null ? !r.pessoas.trim() : Number(q.pessoas) === Number(r.pessoas.replace(',', '.'))))
    if (!novo) return
    const hoje = new Date().toLocaleDateString('en-CA')
    await supabase.from('prod_posto_turno').update({ vigencia_fim: hoje }).in('id', abertos.filter((q) => q.id !== novo.id).map((q) => q.id))
  }

  async function salvarTurno() {
    setErroTurno(null); setBusy(true)
    const e = await gravar({ turno_id: t.turno_id, hora_entrada: t.hora_entrada, hora_saida: t.hora_saida })
    setBusy(false)
    if (e) { setErroTurno(e); return }
    flash('ALTEROU o horário do posto.'); setTurnoOpen(false)
  }

  async function arquivar() {
    if (!window.confirm(`Arquivar o posto "${posto.numero} · ${posto.atividade}"?\n\nNada é apagado: o posto sai da lista e o histórico fica guardado.`)) return
    setBusy(true)
    const hoje = new Date().toLocaleDateString('en-CA')
    const { error } = await supabase.from('prod_posto').update({ ativo: false, updated_at: new Date().toISOString() }).eq('id', posto.id)
    if (!error) await supabase.from('prod_posto_turno').update({ vigencia_fim: hoje }).eq('posto_id', posto.id).is('vigencia_fim', null)
    setBusy(false)
    if (error) { flashErr(`Não consegui arquivar o posto: ${error.message}`); return }
    flash('ARQUIVOU o posto.'); await onMudou()
  }

  async function gravarDescricao(v: string): Promise<string | null> {
    const { error } = await supabase.from('prod_posto').update({ descricao_funcao: v || null, updated_at: new Date().toISOString() }).eq('id', posto.id)
    if (error) return error.message
    await onMudou(); return null
  }

  const topSug = fc.sugestoes_turno[0]
  const temHorario = !!(base.hora_entrada || base.turno_id)
  const turnoLabel = temHorario
    ? (base.hora_entrada ? `${base.hora_entrada}${base.hora_saida ? `–${base.hora_saida}` : ''}` : (fc.listas.turnos.find((x) => x.id === base.turno_id)?.codigo ?? 'turno'))
    : (topSug ? `${topSug.horario} · ${topSug.ocorrencias.toLocaleString('pt-BR')}d (sugestão)` : 'sem histórico')
  const n = posto.numero
  const tid = (c: string) => `posto-${n}-${c}`
  const lista = (xs: Opt[], campoNome: 'nome' | 'codigo' = 'nome') => xs.map((o) => ({ value: o.id, label: String(campoNome === 'codigo' ? (o.codigo ?? o.nome) : o.nome) }))
  const rot = (xs: { value: string; label: string }[]) => (v: string) => xs.find((o) => o.value === v)?.label ?? '—'
  const cargos = cp.opcoes.map((o) => ({ value: o.value, label: o.label })), cats = lista(fc.listas.categorias), tipos = lista(fc.listas.tipos), unids = lista(fc.listas.unidades, 'codigo')
  const aloc = [{ value: 'fixa', label: 'pessoas fixas' }, { value: 'rotativa', label: 'pessoas rotativas' }]

  return (
    <>
      <tr data-testid={`posto-${n}`} style={{ borderTop: `1px solid ${C.cream}`, verticalAlign: 'top' }}>
        <Td><CelulaEditavel testid={tid('numero')} valor={posto.numero} obrigatorio onSalvar={(v) => gravar({ numero: v })} /></Td>
        <Td><CelulaEditavel testid={tid('atividade')} valor={posto.atividade} obrigatorio onSalvar={(v) => gravar({ atividade: v })} /></Td>
        <Td><CelulaEditavel testid={tid('cargo')} tipo="busca" valor={base.cargo_id} opcoes={cargos} vazio="— escolher" rotuloValor={(v) => (rot(cargos)(v).replace(/ · \d+$/, '') || '—')}
          onSalvar={async (v) => { const r = await cp.resolver(v); return r.erro ? r.erro : gravar({ cargo_id: r.id }) }} /></Td>
        <Td>
          <button type="button" data-testid={tid('turno')} onClick={() => setTurnoOpen((v) => !v)} title={temHorario ? 'Turno e horário — clique para editar' : 'Sem quadro de turno — clique para definir'}
            style={{ ...inp, padding: '5px 6px', fontSize: 12.5, textAlign: 'left', cursor: 'pointer', color: temHorario ? C.esp : C.blue, fontStyle: temHorario ? 'normal' : 'italic' }}>
            {turnoLabel} {turnoOpen ? '▲' : '▾'}
          </button>
        </Td>
        <Td><CelulaEditavel testid={tid('pessoas')} tipo="numero" valor={base.pessoas} vazio="— (preencha)" onSalvar={(v) => gravar({ pessoas: v })} /></Td>
        <Td><CelulaEditavel testid={tid('capacidade')} tipo="numero" valor={base.capacidade_hora} vazio="a medir" onSalvar={(v) => gravar({ capacidade_hora: v })} /></Td>
        <Td>
          <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
            <button disabled={busy} data-testid={tid('arquivar')} onClick={() => void arquivar()} title="Arquivar posto (não apaga)" style={{ border: 'none', background: 'none', color: C.red, cursor: 'pointer', fontWeight: 700, fontSize: 16 }}>×</button>
          </div>
        </Td>
      </tr>
      {turnoOpen && (
        <tr>
          <td /><td colSpan={6} style={{ padding: '8px 9px' }}>
            <TurnoPicker fc={fc} r={t} up={(p) => { setT((o) => ({ ...o, ...p })); setErroTurno(null) }} onClose={() => setTurnoOpen(false)} onSalvar={() => void salvarTurno()} erro={erroTurno} />
          </td>
        </tr>
      )}
      {mais && (
        <tr>
          <td /><td colSpan={6} style={{ padding: '4px 9px 10px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
              <L label="Centro de custo" ajuda="prod.posto.centro_custo"><CelulaEditavel testid={tid('centro_custo')} valor={base.centro_custo} onSalvar={(v) => gravar({ centro_custo: v })} /></L>
              <L label="Supervisor" ajuda="prod.posto.supervisor"><CelulaEditavel testid={tid('supervisor')} valor={base.supervisor_nome} onSalvar={(v) => gravar({ supervisor_nome: v })} /></L>
              <L label="Alocação" ajuda="prod.posto.alocacao"><CelulaEditavel testid={tid('alocacao')} tipo="lista" obrigatorio valor={base.alocacao} opcoes={aloc} rotuloValor={rot(aloc)} onSalvar={(v) => gravar({ alocacao: v })} /></L>
              <L label="Categoria de produto" ajuda="prod.posto.categoria"><CelulaEditavel testid={tid('categoria')} tipo="lista" valor={base.categoria_produto_id} opcoes={cats} rotuloValor={rot(cats)} onSalvar={(v) => gravar({ categoria_produto_id: v })} /></L>
              <L label="Tipo do posto" ajuda="prod.posto.tipo"><CelulaEditavel testid={tid('tipo')} tipo="lista" valor={base.tipo_posto_id} opcoes={tipos} rotuloValor={rot(tipos)} onSalvar={(v) => gravar({ tipo_posto_id: v })} /></L>
              <L label="Unidade que conta" ajuda="prod.posto.unidade"><CelulaEditavel testid={tid('unidade')} tipo="lista" valor={base.unidade_medida_id} opcoes={unids} rotuloValor={rot(unids)} onSalvar={(v) => gravar({ unidade_medida_id: v })} /></L>
              <L label="Descrição da função" ajuda="prod.posto.descricao_funcao"><CelulaEditavel testid={tid('descricao')} tipo="longo" valor={descricao} onSalvar={gravarDescricao} /></L>
            </div>
            {base.alocacao === 'rotativa' && <div style={{ fontSize: 11.5, color: C.amber, marginTop: 6 }}>⚠️ Posto rotativo: a produtividade por pessoa virá do ponto, não do quadro.</div>}
          </td>
        </tr>
      )}
      <tr>
        <td /><td colSpan={6} style={{ padding: '0 9px 8px' }}>
          <button type="button" data-testid={tid('mais')} onClick={() => setMais((v) => !v)} style={{ background: 'none', border: 'none', color: C.blue, cursor: 'pointer', fontSize: 11.5, padding: 0 }}>
            {mais ? '− menos campos' : '+ mais campos (centro de custo, supervisor, categoria, descrição…)'}
          </button>
          {posto.capacidade_hora == null && <span style={{ fontSize: 11.5, color: C.espM, marginLeft: 10 }}>Capacidade em branco = <b>a medir</b> (nunca zero).</span>}
        </td>
      </tr>
    </>
  )
}

type Rascunho = {
  numero?: string; atividade: string; cargo_id: string; unidade_medida_id: string; tipo_posto_id: string; categoria_produto_id: string;
  pessoas: string; capacidade_hora: string; alocacao: string; centro_custo: string; supervisor_nome: string;
  turno_id: string; hora_entrada: string; hora_saida: string
}
function rascunhoDe(p?: Posto): Rascunho {
  return {
    numero: p?.numero ?? '', atividade: p?.atividade ?? '', cargo_id: p?.cargo_id ?? '', unidade_medida_id: p?.unidade_medida_id ?? '',
    tipo_posto_id: p?.tipo_posto_id ?? '', categoria_produto_id: p?.categoria_produto_id ?? '',
    pessoas: p?.quadro?.pessoas != null ? String(p.quadro.pessoas) : '', capacidade_hora: p?.capacidade_hora != null ? String(p.capacidade_hora) : '',
    alocacao: p?.alocacao ?? 'fixa', centro_custo: p?.centro_custo ?? '', supervisor_nome: p?.supervisor_nome ?? '',
    turno_id: p?.quadro?.turno_id ?? '', hora_entrada: hhmm(p?.quadro?.hora_entrada), hora_saida: hhmm(p?.quadro?.hora_saida),
  }
}

function LinhaPosto({ posto, novo, fc, companyId, plantId, setor_id, flash, flashErr, onMudou, cp }: {
  posto?: Posto; novo?: boolean; fc: FluxoCompleto; companyId: string; plantId: string; setor_id: string;
  flash: (m: string) => void; flashErr: (m: string) => void; onMudou: () => Promise<void>; cp: CargosPonto
}) {
  // linha nova ja abre com a entrada mais comum do ponto (o turno vem pronto — SPEC §3).
  const [r, setR] = useState<Rascunho>(() => { const b = rascunhoDe(posto); if (novo && !b.hora_entrada && fc.sugestoes_turno[0]) b.hora_entrada = fc.sugestoes_turno[0].horario; return b })
  const [mais, setMais] = useState(false)
  const [turnoOpen, setTurnoOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [erroLinha, setErroLinha] = useState<string | null>(null)
  const [cargoTexto, setCargoTexto] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  // reidrata quando o posto muda de fora (recarregar)
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (!novo) { setR(rascunhoDe(posto)); setDirty(false) } }, [posto, novo])

  const up = (patch: Partial<Rascunho>) => { setR((p) => ({ ...p, ...patch })); setDirty(true); setErroLinha(null) }
  const podeSalvar = r.atividade.trim().length > 0

  async function salvar() {
    if (!podeSalvar) { setErroLinha('A atividade é obrigatória.'); return }
    setBusy(true); setErroLinha(null)
    const cg = await cp.resolver(r.cargo_id)
    if (cg.erro) { setBusy(false); setErroLinha(cg.erro); return }
    const cargoId = cg.id
    const { data: { user } } = await supabase.auth.getUser()
    const turno = (r.turno_id || r.hora_entrada || r.pessoas)
      ? { turno_id: r.turno_id || null, hora_entrada: r.hora_entrada || null, hora_saida: r.hora_saida || null, pessoas: r.pessoas || null }
      : null
    const dados: Record<string, unknown> = {
      atividade: r.atividade.trim(), cargo_id: cargoId || null, unidade_medida_id: r.unidade_medida_id || null,
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
    if (novo) setR(() => { const b = rascunhoDe(); if (fc.sugestoes_turno[0]) b.hora_entrada = fc.sugestoes_turno[0].horario; return b }) // limpa e re-sugere
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
  // Turno: horario salvo/editado > sugestao do ponto (muted) > "sem historico". NUNCA so um traço.
  const topSug = fc.sugestoes_turno[0]
  const temHorario = !!(r.hora_entrada || r.turno_id)
  const sugerindo = !temHorario && !!topSug
  const turnoLabel = temHorario
    ? (r.hora_entrada ? `${r.hora_entrada}${r.hora_saida ? `–${r.hora_saida}` : ''}` : (fc.listas.turnos.find((t) => t.id === r.turno_id)?.codigo ?? 'turno'))
    : (topSug ? `${topSug.horario} · ${topSug.ocorrencias.toLocaleString('pt-BR')}d` : 'sem histórico')

  return (
    <>
      <tr style={{ borderTop: `1px solid ${C.cream}`, background: novo ? C.goldBg : undefined, verticalAlign: 'top' }}>
        <Td>{novo ? '+' : posto!.numero}</Td>
        <Td>
          <input data-testid={novo ? 'posto-novo-atividade' : undefined} value={r.atividade} onChange={(e) => up({ atividade: e.target.value })} placeholder={novo ? 'nova atividade…' : ''} style={{ ...inp, padding: '5px 7px' }} />
        </Td>
        <Td>
          <input data-testid={novo ? 'posto-novo-cargo' : undefined} list={`cargos-${posto?.id ?? 'novo'}`} placeholder="cargo — digite para buscar" style={{ ...inp, padding: '5px 7px' }}
            value={cargoTexto ?? (cp.opcoes.find((o) => o.value === r.cargo_id)?.label ?? '')}
            onChange={(e) => { const t = e.target.value; setCargoTexto(t); const o = cp.opcoes.find((x) => x.label.toLowerCase() === t.trim().toLowerCase()); if (o) up({ cargo_id: o.value }); else if (!t.trim()) up({ cargo_id: '' }) }}
            onBlur={() => setCargoTexto(null)} />
          <datalist id={`cargos-${posto?.id ?? 'novo'}`}>{cp.opcoes.map((o) => <option key={o.value} value={o.label} />)}</datalist>
        </Td>
        <Td>
          <button type="button" onClick={() => setTurnoOpen((v) => !v)}
            title={sugerindo ? 'Entrada mais comum no ponto — clique para aceitar ou editar' : (!temHorario ? 'Sem histórico de ponto para este setor' : 'Turno e horário')}
            style={{ ...cellSel, textAlign: 'left', cursor: 'pointer', background: C.white, color: temHorario ? C.esp : (sugerindo ? C.blue : C.espL), fontStyle: temHorario ? 'normal' : 'italic' }}>
            {turnoLabel} {turnoOpen ? '▲' : '▾'}
          </button>
        </Td>
        <Td><input data-testid="posto-novo-pessoas" value={r.pessoas} onChange={(e) => up({ pessoas: e.target.value })} placeholder="—" inputMode="numeric" style={{ ...inp, padding: '5px 7px' }} /></Td>
        <Td>
          <input data-testid="posto-novo-capacidade" value={r.capacidade_hora} onChange={(e) => up({ capacidade_hora: e.target.value })} placeholder="a medir" inputMode="decimal" style={{ ...inp, padding: '5px 7px' }} />
        </Td>
        <Td>
          <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
            {(dirty || novo) && <button disabled={busy || !podeSalvar} data-testid="posto-novo-salvar" onClick={() => void salvar()} title="Salvar linha" style={{ ...btn(!busy && podeSalvar), padding: '5px 9px', fontSize: 12 }}>{busy ? '…' : '✓'}</button>}
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
                <L label="Centro de custo" ajuda="prod.posto.centro_custo"><input value={r.centro_custo} onChange={(e) => up({ centro_custo: e.target.value })} style={inp} /></L>
                <L label="Supervisor" ajuda="prod.posto.supervisor"><input value={r.supervisor_nome} onChange={(e) => up({ supervisor_nome: e.target.value })} style={inp} /></L>
                <L label="Alocação" ajuda="prod.posto.alocacao"><select value={r.alocacao} onChange={(e) => up({ alocacao: e.target.value })} style={inp}><option value="fixa">pessoas fixas</option><option value="rotativa">pessoas rotativas</option></select></L>
                <L label="Categoria de produto" ajuda="prod.posto.categoria"><select value={r.categoria_produto_id} onChange={(e) => up({ categoria_produto_id: e.target.value })} style={inp}><option value="">—</option>{fc.listas.categorias.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></L>
                <L label="Tipo do posto" ajuda="prod.posto.tipo"><select value={r.tipo_posto_id} onChange={(e) => up({ tipo_posto_id: e.target.value })} style={inp}><option value="">—</option>{fc.listas.tipos.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}</select></L>
                <L label="Unidade que conta" ajuda="prod.posto.unidade"><select value={r.unidade_medida_id} onChange={(e) => up({ unidade_medida_id: e.target.value })} style={inp}><option value="">—</option>{fc.listas.unidades.map((u) => <option key={u.id} value={u.id}>{u.codigo}</option>)}</select></L>
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

type TurnoRasc = Pick<Rascunho, 'hora_entrada' | 'hora_saida' | 'turno_id'>
function TurnoPicker({ fc, r, up, onClose, onSalvar, erro }: { fc: FluxoCompleto; r: TurnoRasc; up: (p: Partial<TurnoRasc>) => void; onClose: () => void; onSalvar?: () => void; erro?: string | null }) {
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
        <label style={{ fontSize: 11.5, color: C.espM }}>entra<Aj k="prod.turno.entrada" /> <input type="time" data-testid="turno-entrada" value={r.hora_entrada} onChange={(e) => up({ hora_entrada: e.target.value, turno_id: '' })} style={{ ...inp, width: 'auto', marginLeft: 4 }} /></label>
        <label style={{ fontSize: 11.5, color: C.espM }}>sai<Aj k="prod.turno.saida" /> <input type="time" data-testid="turno-saida" value={r.hora_saida} onChange={(e) => up({ hora_saida: e.target.value })} style={{ ...inp, width: 'auto', marginLeft: 4 }} /></label>
        {fc.listas.turnos.length > 0 && (
          <label style={{ fontSize: 11.5, color: C.espM }}>ou turno da planta<Aj k="prod.turno.turno_planta" />&nbsp;
            <select value={r.turno_id} onChange={(e) => { const t = fc.listas.turnos.find((x) => x.id === e.target.value); up({ turno_id: e.target.value, hora_entrada: hhmm(t?.inicio) || r.hora_entrada, hora_saida: hhmm(t?.fim) || r.hora_saida }) }} style={{ ...inp, width: 'auto' }}>
              <option value="">—</option>{fc.listas.turnos.map((t) => <option key={t.id} value={t.id}>{t.codigo}{t.inicio ? ` (${hhmm(t.inicio)}–${hhmm(t.fim)})` : ''}</option>)}
            </select>
          </label>
        )}
        {onSalvar && <button type="button" data-testid="turno-salvar" onClick={onSalvar} style={{ ...btn(true), padding: '5px 12px', fontSize: 12 }}>Salvar horário</button>}
        <button type="button" onClick={onClose} style={{ ...btn(true), background: 'transparent', color: C.espM, border: `1px solid ${C.border}`, padding: '5px 10px', fontSize: 12 }}>{onSalvar ? 'fechar' : 'ok'}</button>
      </div>
      {erro && <div data-testid="turno-erro" role="alert" style={{ background: C.redBg, color: C.red, padding: '5px 9px', borderRadius: 7, fontSize: 12, marginTop: 6 }}>{erro}</div>}
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><input data-testid="novo-fluxo-nome" value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} placeholder="nome do fluxo (ex.: Desossa de Bola)" style={inp} /><Aj k="prod.fluxo.nome" /></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><select data-testid="novo-fluxo-setor" value={f.setor_id} onChange={(e) => setF({ ...f, setor_id: e.target.value })} style={inp}><option value="">setor…</option>{setores.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}</select><Aj k="prod.fluxo.setor" /></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><select data-testid="novo-fluxo-unidade" value={f.unidade_entrada_id} onChange={(e) => setF({ ...f, unidade_entrada_id: e.target.value })} style={inp}><option value="">unidade de entrada… (opcional)</option>{unidades.map((u) => <option key={u.id} value={u.id}>{u.codigo}</option>)}</select><Aj k="prod.fluxo.unidade_entrada" /></div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ ...btn(true), background: 'transparent', color: C.espM, border: `1px solid ${C.border}` }}>Cancelar</button>
          <button disabled={!pode || busy} data-testid="novo-fluxo-criar" style={btn(!!pode && !busy)} onClick={() => void salvar()}>{busy ? 'Criando…' : 'Criar fluxo'}</button>
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

// ─────────── CATEGORIAS DE PRODUTO · agrupamento a partir do ATAK ───────────
// O usuario cria a categoria (ex.: "Miudos") e ESCOLHE quais DESC_PRODUTO_EST entram. O sistema
// lista os produtos mais frequentes por dominio (com a contagem) — mas NAO decide: o dominio do
// ATAK reflete a consulta do Jian, nao o produto (miudos_5quarto traz "FEMEA PARA ABATE"). Um
// produto em UMA categoria (fn_prod_categoria_item_atribuir MOVE, nao duplica).
type CatRow = { id: string; nome: string }
type AtakItem = { descricao: string; ocorrencias: number; categoria_id: string | null; categoria_nome: string | null }
type CatItem = { id: string; categoria_id: string; descricao: string; dominio: string | null }

function CategoriasProdutos({ ctx, onMudou }: { ctx: Ctx; onMudou: () => void }) {
  const [cats, setCats] = useState<CatRow[]>([])
  const [itens, setItens] = useState<CatItem[]>([])
  const [novo, setNovo] = useState('')
  const [abertoCat, setAbertoCat] = useState<string | null>(null)
  const [edit, setEdit] = useState<{ id: string; nome: string } | null>(null)
  const carregar = useCallback(async () => {
    const [{ data: c }, { data: i }] = await Promise.all([
      supabase.from('prod_categoria_produto').select('id, nome').eq('company_id', ctx.companyId).eq('plant_id', ctx.plantId).order('ordem').order('nome'),
      supabase.from('prod_categoria_item').select('id, categoria_id, descricao, dominio').eq('company_id', ctx.companyId).eq('plant_id', ctx.plantId).order('descricao'),
    ])
    setCats((c as CatRow[]) ?? []); setItens((i as CatItem[]) ?? [])
  }, [ctx.companyId, ctx.plantId])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])
  const itensDe = (catId: string) => itens.filter((x) => x.categoria_id === catId)
  async function criar() {
    const nome = novo.trim(); if (!nome) return
    if (await inserir('prod_categoria_produto', ctx, { nome }, `Já existe uma categoria "${nome}".`)) { setNovo(''); await carregar(); onMudou() }
  }
  async function excluirCat(id: string, nome: string) {
    const { count: nPost } = await supabase.from('prod_posto').select('id', { count: 'exact', head: true }).eq('company_id', ctx.companyId).eq('categoria_produto_id', id)
    const partes = [nPost ? `${nPost} posto(s)` : null, itensDe(id).length ? `${itensDe(id).length} produto(s) agrupado(s)` : null].filter(Boolean)
    const aviso = partes.length ? `\n\n⚠️ Afeta: ${partes.join(', ')}. Os produtos agrupados serão desvinculados.` : ''
    if (window.confirm(`Excluir a categoria "${nome}"?${aviso}`) && await remover('prod_categoria_produto', ctx, id)) { await carregar(); onMudou() }
  }
  async function removerItem(id: string) {
    const { data } = await supabase.rpc('fn_prod_categoria_item_remover', { p_item_id: id, p_user: null })
    if ((data as { ok?: boolean } | null)?.ok) { await carregar() } else ctx.flashErr('Falha ao remover o produto.')
  }
  return (
    <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, gridColumn: '1 / -1' }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>Categorias de produto</div>
      <div style={{ fontSize: 11, color: C.espM, marginBottom: 8 }}>Agrupe os produtos do ATAK — ex.: crie “Miúdos” e escolha quais entram. O domínio do ATAK não é categoria; você decide.</div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        <input value={novo} onChange={(e) => setNovo(e.target.value)} placeholder="nova categoria (ex.: Miúdos)" style={{ ...inp, maxWidth: 260 }} />
        <button disabled={!novo.trim()} style={btn(!!novo.trim())} onClick={() => void criar()}>+</button>
      </div>
      {cats.length === 0 ? <div style={{ fontSize: 12, color: C.espL, fontStyle: 'italic' }}>Nenhuma categoria ainda.</div> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {cats.map((cat) => (
            <div key={cat.id} style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {edit?.id === cat.id ? (
                  <>
                    <input value={edit.nome} onChange={(e) => setEdit({ id: cat.id, nome: e.target.value })} style={{ ...inp, width: 140, padding: '2px 6px' }} autoFocus />
                    <button onClick={async () => { if (edit.nome.trim() && await renomear('prod_categoria_produto', ctx, cat.id, edit.nome.trim())) { setEdit(null); await carregar(); onMudou() } }} style={{ border: 'none', background: 'none', color: C.green, cursor: 'pointer', fontWeight: 700 }}>✓</button>
                    <button onClick={() => setEdit(null)} style={{ border: 'none', background: 'none', color: C.espM, cursor: 'pointer' }}>×</button>
                  </>
                ) : (
                  <>
                    <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{cat.nome} <span style={{ color: C.espM, fontWeight: 400, fontSize: 11.5 }}>· {itensDe(cat.id).length} produto(s)</span></span>
                    <button onClick={() => setAbertoCat(abertoCat === cat.id ? null : cat.id)} style={{ ...btn(true), background: 'transparent', color: C.blue, border: `1px solid ${C.blue}44`, padding: '3px 9px', fontSize: 11.5 }}>{abertoCat === cat.id ? 'fechar' : '📦 produtos'}</button>
                    <button onClick={() => setEdit({ id: cat.id, nome: cat.nome })} title="Renomear" style={{ border: 'none', background: 'none', color: C.blue, cursor: 'pointer', fontSize: 11 }}>✎</button>
                    <button onClick={() => void excluirCat(cat.id, cat.nome)} title="Excluir" style={{ border: 'none', background: 'none', color: C.red, cursor: 'pointer', fontWeight: 700 }}>×</button>
                  </>
                )}
              </div>
              {itensDe(cat.id).length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 6 }}>
                  {itensDe(cat.id).map((it) => (
                    <span key={it.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: C.cream, borderRadius: 999, padding: '2px 6px 2px 9px', fontSize: 11.5 }}>
                      {it.descricao}
                      <button onClick={() => void removerItem(it.id)} title="Tirar da categoria" style={{ border: 'none', background: 'none', color: C.red, cursor: 'pointer', fontWeight: 700 }}>×</button>
                    </span>
                  ))}
                </div>
              )}
              {abertoCat === cat.id && <AtakPicker ctx={ctx} categoriaId={cat.id} onMudou={async () => { await carregar(); onMudou() }} />}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function AtakPicker({ ctx, categoriaId, onMudou }: { ctx: Ctx; categoriaId: string; onMudou: () => Promise<void> }) {
  const [dominios, setDominios] = useState<{ dominio: string; produtos: number }[]>([])
  const [dominio, setDominio] = useState('')
  const [itens, setItens] = useState<AtakItem[] | null>(null)
  const [busy, setBusy] = useState(false)
  const carregarDominios = useCallback(async () => {
    const { data } = await supabase.rpc('fn_prod_atak_produtos', { p_company_id: ctx.companyId, p_plant_id: ctx.plantId, p_dominio: null, p_limit: null })
    const r = data as { ok?: boolean; dominios?: { dominio: string; produtos: number }[] } | null
    setDominios(r?.ok ? (r.dominios ?? []) : [])
  }, [ctx.companyId, ctx.plantId])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregarDominios() }, [carregarDominios])
  async function carregarItens(d: string) {
    setDominio(d); setItens(null); if (!d) return
    setBusy(true)
    const { data } = await supabase.rpc('fn_prod_atak_produtos', { p_company_id: ctx.companyId, p_plant_id: ctx.plantId, p_dominio: d, p_limit: 60 })
    setBusy(false)
    setItens((data as { ok?: boolean; itens?: AtakItem[] } | null)?.ok ? ((data as { itens?: AtakItem[] }).itens ?? []) : [])
  }
  async function atribuir(descricao: string) {
    const { data } = await supabase.rpc('fn_prod_categoria_item_atribuir', { p_categoria_id: categoriaId, p_descricao: descricao, p_dominio: dominio, p_user: null })
    if (!(data as { ok?: boolean } | null)?.ok) { ctx.flashErr('Falha ao agrupar o produto.'); return }
    await carregarItens(dominio); await onMudou()
  }
  return (
    <div style={{ marginTop: 8, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: 10 }}>
      <div style={{ fontSize: 11.5, color: C.espM, marginBottom: 6 }}>Produtos do ATAK, por frequência. Clique pra pôr nesta categoria. Já agrupado mostra onde está. ⚠️ O domínio (ex.: “miudos_5quarto”) reflete a consulta, não o produto — confira antes.</div>
      <select value={dominio} onChange={(e) => void carregarItens(e.target.value)} style={{ ...inp, width: 'auto', marginBottom: 8 }}>
        <option value="">escolha um domínio…</option>
        {dominios.map((d) => <option key={d.dominio} value={d.dominio}>{d.dominio} ({d.produtos} produtos)</option>)}
      </select>
      {busy ? <div style={{ fontSize: 12, color: C.espM }}>Buscando…</div>
        : itens && (itens.length === 0 ? <div style={{ fontSize: 12, color: C.espM }}>Sem produtos neste domínio.</div> : (
        <div style={{ maxHeight: 260, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {itens.map((it) => {
            const meu = it.categoria_id === categoriaId
            const doOutro = !!it.categoria_id && !meu
            return (
              <div key={it.descricao} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, padding: '3px 4px' }}>
                <span style={{ flex: 1 }}>{it.descricao}</span>
                <span style={{ fontSize: 10.5, color: C.espM }}>{it.ocorrencias.toLocaleString('pt-BR')}×</span>
                {meu ? <span style={{ fontSize: 10.5, padding: '1px 7px', borderRadius: 999, background: C.greenBg, color: C.green }}>nesta categoria</span>
                  : <button onClick={() => void atribuir(it.descricao)} style={{ ...btn(true), padding: '2px 9px', fontSize: 11.5, background: doOutro ? C.amber : C.gold }}>{doOutro ? `mover de "${it.categoria_nome}"` : '+ pôr aqui'}</button>}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

// Sugere setores/cargos do ponto eletronico (fn_prod_sugerir_*). Mostra quantos vem e quantos ja
// estao; multi-selecao (o usuario marca quais quer); ja cadastrado aparece MARCADO e travado —
// nunca some da lista (senao o usuario nao entende por que "sumiu" um setor que ele viu).
type ItemSug = { nome: string; pessoas: number; ja_cadastrado: boolean; possivel_duplicata_de?: string | null }
function SugerirDoPonto({ ctx, rpc, tabela, sugLabel, jaExistentes, onAdd }: { ctx: Ctx; rpc: string; tabela: string; sugLabel: string; jaExistentes: number; onAdd: () => Promise<void> }) {
  const [aberto, setAberto] = useState(false)
  const [itens, setItens] = useState<ItemSug[] | null>(null)
  const [sel, setSel] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)
  async function abrir() {
    setAberto(true); setBusy(true); setItens(null)
    const { data, error } = await supabase.rpc(rpc, { p_company_id: ctx.companyId, p_plant_id: ctx.plantId })
    setBusy(false)
    const r = data as { ok?: boolean; erro?: string; itens?: ItemSug[] } | null
    if (error || !r?.ok) { ctx.flashErr(error?.message || (r?.erro === 'sem_acesso' ? 'Sem acesso.' : r?.erro) || 'Falha ao buscar do ponto'); setAberto(false); return }
    const its = r.itens ?? []
    setItens(its)
    const s: Record<string, boolean> = {}; its.forEach((it) => { if (!it.ja_cadastrado) s[it.nome] = true }) // pre-marca os novos; o usuario desmarca RH/TI etc.
    setSel(s)
  }
  const selecionados = (itens ?? []).filter((it) => !it.ja_cadastrado && sel[it.nome])
  const jaCad = (itens ?? []).filter((it) => it.ja_cadastrado).length
  async function adicionar() {
    if (selecionados.length === 0) return
    setBusy(true)
    const payloads = selecionados.map((it, i) => ({ company_id: ctx.companyId, plant_id: ctx.plantId, nome: it.nome, ...(tabela === 'prod_setor' ? { ordem: jaExistentes + i + 1 } : {}) }))
    const { error } = await supabase.from(tabela).insert(payloads)
    setBusy(false)
    if (error) { ctx.flashErr(error.message); return }
    ctx.flash(`CRIOU ${payloads.length} ${sugLabel} do ponto.`); setAberto(false); setItens(null); await onAdd()
  }
  return (
    <>
      <button type="button" onClick={() => aberto ? setAberto(false) : void abrir()} style={{ ...btn(true), background: C.blue, padding: '5px 10px', fontSize: 11.5 }}>👥 Sugerir do ponto</button>
      {aberto && (
        <div style={{ marginTop: 8, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: 10 }}>
          {busy && !itens ? <div style={{ fontSize: 12, color: C.espM }}>Buscando no ponto…</div>
            : (itens && itens.length === 0) ? <div style={{ fontSize: 12, color: C.espM }}>O ponto desta planta não tem {sugLabel} para sugerir.</div>
            : itens && (
            <>
              <div style={{ fontSize: 11.5, color: C.espM, marginBottom: 8 }}>
                <b>{itens.length}</b> {sugLabel} no ponto · <b>{jaCad}</b> já cadastrado(s). RH, TI e Comercial também aparecem — quem decide é você. Duplicata provável fica marcada.
              </div>
              <div style={{ maxHeight: 260, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
                {itens.map((it) => (
                  <label key={it.nome} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, padding: '3px 4px', opacity: it.ja_cadastrado ? 0.6 : 1 }}>
                    <input type="checkbox" disabled={it.ja_cadastrado} checked={it.ja_cadastrado ? true : !!sel[it.nome]} onChange={(e) => setSel((p) => ({ ...p, [it.nome]: e.target.checked }))} />
                    <span style={{ flex: 1 }}>{it.nome}</span>
                    <span style={{ fontSize: 10.5, color: C.espM }}>{it.pessoas} pessoa{it.pessoas === 1 ? '' : 's'}</span>
                    {it.ja_cadastrado && <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 999, background: C.greenBg, color: C.green }}>já cadastrado</span>}
                    {it.possivel_duplicata_de && <span title={`Parece o mesmo que "${it.possivel_duplicata_de}"`} style={{ fontSize: 10, padding: '1px 6px', borderRadius: 999, background: C.amberBg, color: C.amber }}>possível duplicata</span>}
                  </label>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button type="button" disabled={busy || selecionados.length === 0} style={btn(!busy && selecionados.length > 0)} onClick={() => void adicionar()}>{busy ? 'Adicionando…' : `Adicionar ${selecionados.length} selecionado(s)`}</button>
                <button type="button" onClick={() => setAberto(false)} style={{ ...btn(true), background: 'transparent', color: C.espM, border: `1px solid ${C.border}` }}>Fechar</button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  )
}

function CadastroSimples({ ctx, tabela, titulo, order, placeholder, onMudou, rpcSugestao, sugLabel, dica }: { ctx: Ctx; tabela: string; titulo: string; order: string; placeholder: string; onMudou: () => void; rpcSugestao?: string; sugLabel?: string; dica?: string }) {
  const { rows, carregar } = useLista(tabela, ctx, order)
  const [novo, setNovo] = useState('')
  const [edit, setEdit] = useState<{ id: string; nome: string } | null>(null)
  const campo = tabela === 'prod_unidade_medida' || tabela === 'prod_tipo_posto' ? 'codigo' : 'nome'
  // aviso do que quebra ANTES de apagar (RD-55): conta os postos/fluxos/salarios que apontam pro item.
  async function contarDeps(id: string): Promise<string> {
    const q = (t: string, col: string) => supabase.from(t).select('id', { count: 'exact', head: true }).eq('company_id', ctx.companyId).eq(col, id)
    const p: string[] = []
    const push = (n: number | null, lbl: string) => { if (n) p.push(`${n} ${lbl}`) }
    if (tabela === 'prod_setor') { const [a, b] = await Promise.all([q('prod_posto', 'setor_id'), q('prod_fluxo', 'setor_id')]); push(a.count, 'posto(s)'); push(b.count, 'fluxo(s)') }
    else if (tabela === 'prod_cargo') { const [a, b] = await Promise.all([q('prod_posto', 'cargo_id'), q('prod_salario_base', 'cargo_id')]); push(a.count, 'posto(s)'); push(b.count, 'salário(s) por cargo') }
    else if (tabela === 'prod_unidade_medida') { const [a, b] = await Promise.all([q('prod_posto', 'unidade_medida_id'), q('prod_fluxo', 'unidade_entrada_id')]); push(a.count, 'posto(s)'); push(b.count, 'fluxo(s)') }
    else if (tabela === 'prod_categoria_produto') { const a = await q('prod_posto', 'categoria_produto_id'); push(a.count, 'posto(s)') }
    return p.join(', ')
  }
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
      {rpcSugestao && <div style={{ marginBottom: 8 }}><SugerirDoPonto ctx={ctx} rpc={rpcSugestao} tabela={tabela} sugLabel={sugLabel ?? 'itens'} jaExistentes={rows.length} onAdd={async () => { await carregar(); onMudou() }} /></div>}
      {dica && <div style={{ fontSize: 11, color: C.espM, marginBottom: 8, lineHeight: 1.4 }}>{dica}</div>}
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
                  <button onClick={async () => { const deps = await contarDeps(r.id); const aviso = deps ? `\n\n⚠️ Está vinculado a: ${deps}. A exclusão será bloqueada até remover o vínculo.` : ''; if (window.confirm(`Excluir "${String(r[campo] ?? r.nome)}"?${aviso}`) && await remover(tabela, ctx, r.id)) { await carregar(); onMudou() } }} title="Excluir" style={{ border: 'none', background: 'none', color: C.red, cursor: 'pointer', fontWeight: 700 }}>×</button>
                </>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function ConfigModal({ ctx, onClose, onMudou }: { ctx: Ctx; onClose: () => void; onMudou: () => Promise<void> }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 80, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '30px 16px', overflowY: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.bg, borderRadius: 12, padding: 18, width: 'min(780px,100%)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Cadastros da planta</div>
          <button onClick={onClose} style={{ border: 'none', background: 'none', color: C.espM, cursor: 'pointer', fontSize: 22, lineHeight: 1 }}>×</button>
        </div>
        <div style={{ fontSize: 12, color: C.espM, margin: '2px 0 6px' }}>Setores, cargos, unidades e categorias. Renomeie no ✎; ao excluir, o sistema avisa o que está vinculado antes.</div>
        <Avancado ctx={ctx} onMudou={onMudou} />
      </div>
    </div>
  )
}

function Avancado({ ctx, onMudou }: { ctx: Ctx; onMudou: () => Promise<void> }) {
  const md = () => { void onMudou() }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12, marginTop: 10 }}>
      <CadastroSimples ctx={ctx} tabela="prod_setor" titulo="Setores" order="ordem" placeholder="ex.: Abate, Desossa" rpcSugestao="fn_prod_sugerir_setores" sugLabel="setores" onMudou={md} />
      <CadastroSimples ctx={ctx} tabela="prod_cargo" titulo="Cargos" order="nome" placeholder="ex.: Operador" rpcSugestao="fn_prod_sugerir_cargos" sugLabel="cargos" onMudou={md} />
      <CadastroSimples ctx={ctx} tabela="prod_unidade_medida" titulo="Unidades de medida" order="codigo" placeholder="código (kg, cabeca…)" onMudou={md} />
      <CategoriasProdutos ctx={ctx} onMudou={md} />
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
  // corrige o valor no lugar; como passou a ser digitado, a fonte vira "digitado" (a folha não confirma mais esse número)
  async function editarValor(id: string, txt: string): Promise<string | null> {
    const n = Number(txt.replace(/\./g, '').replace(',', '.'))
    if (!Number.isFinite(n) || n <= 0) return 'Digite o valor em reais, só números, ex.: 2850,00.'
    const { error } = await supabase.from('prod_salario_base').update({ valor: n, fonte: 'manual' }).eq('id', id)
    if (error) return `Não consegui salvar o salário: ${error.message}`
    ctx.flash('ALTEROU o salário base.'); await carregar(); return null
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
        <label style={{ fontSize: 12, color: C.espM }}>Competência<Aj k="prod.salario.competencia" />&nbsp;
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
          <select data-testid="sal-cargo" value={manualCargo.cargo_id} onChange={(e) => setManualCargo({ ...manualCargo, cargo_id: e.target.value })} style={{ ...inp, width: 'auto' }}><option value="">cargo…</option>{cargos.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</select><Aj k="prod.salario.cargo" />
          <input data-testid="sal-valor" value={manualCargo.valor} onChange={(e) => setManualCargo({ ...manualCargo, valor: e.target.value })} placeholder="R$ base" inputMode="decimal" style={{ ...inp, width: 110 }} /><Aj k="prod.salario.valor" />
          <select data-testid="sal-fonte" value={manualCargo.fonte} onChange={(e) => setManualCargo({ ...manualCargo, fonte: e.target.value })} style={{ ...inp, width: 'auto' }}><option value="manual">digitado</option><option value="acordo_coletivo">acordo coletivo</option></select><Aj k="prod.salario.fonte" />
          <button type="button" data-testid="sal-salvar-cargo" disabled={!manualCargo.cargo_id || !manualCargo.valor} style={btn(!!manualCargo.cargo_id && !!manualCargo.valor)} onClick={async () => { if (await salvar({ cargo_id: manualCargo.cargo_id, valor: manualCargo.valor, fonte: manualCargo.fonte })) setManualCargo({ cargo_id: '', valor: '', fonte: 'manual' }) }}>+ Salvar por cargo</button>
        </div>
      </div>
      {rows.length === 0 ? <div style={{ fontSize: 12, color: C.espL, fontStyle: 'italic' }}>Nenhum salário base cadastrado.</div> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {rows.map((r) => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, borderBottom: `1px solid ${C.cream}`, padding: '4px 0' }}>
              <span style={{ flex: 1 }}>{r.funcionario_id ? (r.compliance_funcionarios?.nome_completo ?? `matrícula ${r.matricula ?? '—'}`) : `cargo: ${r.prod_cargo?.nome ?? '—'}`}</span>
              <b><CelulaEditavel testid={`sal-${r.id}-valor`} tipo="numero" obrigatorio valor={String(r.valor).replace('.', ',')} rotuloValor={() => brl(r.valor)} onSalvar={(v) => editarValor(r.id, v)} /></b><Aj k="prod.salario.valor" />
              <span style={{ fontSize: 10.5, padding: '2px 7px', borderRadius: 999, background: r.fonte === 'folha' ? C.greenBg : C.cream, color: r.fonte === 'folha' ? C.green : C.espM }}>
                {r.fonte === 'folha' ? `folha ${mesBr(r.competencia_ref ?? '')}` : r.fonte === 'acordo_coletivo' ? 'acordo coletivo' : 'digitado'}
              </span><Aj k="prod.salario.fonte" />
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
          <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="outro valor" inputMode="decimal" style={{ ...inp, width: 100, padding: '4px 7px' }} /><Aj k="prod.salario.valor" />
          {manual && <button type="button" style={{ ...btn(true), background: 'transparent', color: C.esp, border: `1px solid ${C.border}`, padding: '4px 8px', fontSize: 12 }} onClick={() => void onSalvar({ matricula: String(s.matricula), valor: manual, fonte: 'manual', competencia_ref: comp })}>digitar</button>}
        </div>
      )}
    </div>
  )
}

function Th({ children, w, ajuda }: { children?: React.ReactNode; w?: number; ajuda?: string }) { return <th style={{ textAlign: 'left', padding: '8px 9px', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.4, color: C.espM, width: w }}>{children}{ajuda && <Aj k={ajuda} />}</th> }
function Td({ children }: { children?: React.ReactNode }) { return <td style={{ padding: '6px 9px', color: C.esp }}>{children}</td> }
function L({ label, ajuda, children }: { label: string; ajuda?: string; children: React.ReactNode }) { return <label style={{ fontSize: 11, color: C.espM, display: 'block' }}>{label}{ajuda && <Aj k={ajuda} />}<div style={{ marginTop: 2 }}>{children}</div></label> }
function Aviso({ texto }: { texto: string }) { return <div style={{ background: C.bg, minHeight: '100vh', padding: 28, color: C.espM, fontSize: 14 }}>{texto}</div> }
