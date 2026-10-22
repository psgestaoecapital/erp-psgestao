'use client'

// Produtividade Industrial · Tarefas (CEO 08/10). O grão da "tarefa" vive SOB a etapa de um fluxo: o fluxo dá o
// contexto, a etapa aponta o posto, e a tarefa é o trabalho medível ali dentro. Fluxo → Etapa → Tarefas, edição no
// lugar (CRIOU/ALTEROU/EXCLUIU). Capacidade/hora em branco = "a medir" — NUNCA 0 no lugar de ausência.
// Bloco de VÍDEOS por tarefa é PREPARADO, não inteligente: consentimento LGPD + upload, status "aguardando análise".
// NENHUMA IA roda agora — a análise (ciclos, ergonomia) entra na próxima fatia. Desenho próprio PS (RD-96), "?" em
// todo campo/coluna/filtro/ação (RD-95).

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, Suspense } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { CelulaEditavel, type OpcaoCelula } from '@/components/produtividade/CelulaEditavel'
import { Video, Timer } from 'lucide-react'

const ROTA = '/dashboard/produtividade/tarefas'
const Aj = ({ k }: { k: string }) => <AjudaCampo chave={k} rota={ROTA} />

const C = {
  esp: '#3D2314', espM: '#6B5D4F', espL: '#9C8E80', bg: '#FAF7F2', white: '#FFFFFF',
  cream: '#F0ECE3', border: '#E0D8CC', gold: '#C8941A', goldD: '#A57A15', goldBg: '#FDF7E8',
  green: '#166534', greenBg: '#ECFDF5', amber: '#BA7517', amberBg: '#FAEEDA', red: '#B42318', redBg: '#FCEBEB', blue: '#2F5AA8',
}
const inp: React.CSSProperties = { padding: '7px 9px', fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 7, background: C.white, color: C.esp, outline: 'none', minWidth: 0, width: '100%' }
const btn = (on = true): React.CSSProperties => ({ padding: '8px 14px', fontSize: 13, fontWeight: 700, borderRadius: 8, border: 'none', cursor: on ? 'pointer' : 'not-allowed', background: on ? C.gold : C.espL, color: C.white })

const BUCKET = 'industria-produtividade'
const ESTADOS: OpcaoCelula[] = [{ value: 'em_validacao', label: 'Em validação' }, { value: 'valida', label: 'Válida' }]
const rotuloEstado = (v: string) => ESTADOS.find((e) => e.value === v)?.label ?? 'Em validação'
const ERRS_TAREFA: Record<string, string> = {
  nome_invalido: 'Informe o nome da tarefa.',
  cap_hora_invalida: 'Capacidade/hora inválida — deixe em branco para "a medir" ou informe um número maior que zero.',
  etapa_nao_encontrada: 'Etapa não encontrada — recarregue a tela.',
  tarefa_nao_encontrada: 'Tarefa não encontrada — pode ter sido arquivada por outra pessoa.',
}
const ERRS_VIDEO: Record<string, string> = {
  arquivo_invalido: 'Arquivo inválido — envie um arquivo de vídeo.',
  tarefa_nao_encontrada: 'Tarefa não encontrada — recarregue a tela.',
  sem_consentimento: 'Escolha o consentimento do colaborador antes de subir o vídeo (LGPD).',
  limite_videos: 'Limite atingido: até 10 vídeos por tarefa.',
}

type Plant = { id: string; nome_planta: string }
type Fluxo = { id: string; nome: string }
type Posto = { id: string; numero: string; atividade: string }
type Etapa = { id: string; ordem: number; posto_id: string | null }
type Cargo = { id: string; nome: string }
type Tarefa = { id: string; etapa_id: string; ordem: number; nome: string; cargo_id: string | null; cap_hora: number | null; unidade_cap: string | null; estado: string; ativo: boolean }
type Consent = { id: string; colaborador_nome: string; termo_versao: string; consentido: boolean; revogado_em: string | null }
type Video = { id: string; storage_path: string; duracao_seg: number | null; protocolo_ok: boolean; status: string; guardar_ate: string | null; created_at: string }

type Ctx = { companyId: string; plantId: string; flash: (m: string) => void; flashErr: (m: string) => void }

function parseCap(s: string): { v: number | null; erro: string | null } {
  const t = s.trim()
  if (!t) return { v: null, erro: null }                     // em branco = a medir (nunca 0)
  const n = Number(t.replace(/\./g, '').replace(',', '.'))
  if (!Number.isFinite(n) || n <= 0) return { v: null, erro: 'Capacidade/hora: deixe em branco para "a medir" ou informe um número maior que zero.' }
  return { v: n, erro: null }
}

export default function TarefasPage() {
  return <Suspense fallback={<div style={{ padding: 40, color: C.espM, background: C.bg, minHeight: '100vh' }}>Carregando…</div>}><Inner /></Suspense>
}

function Inner() {
  const { selInfo, sel } = useCompanyIds()
  const companyId = selInfo.tipo === 'empresa' && sel ? sel : null
  const [plants, setPlants] = useState<Plant[]>([])
  const [plantId, setPlantId] = useState<string | null>(null)
  const [fluxos, setFluxos] = useState<Fluxo[]>([])
  const [fluxoId, setFluxoId] = useState<string | null>(null)
  const [etapas, setEtapas] = useState<Etapa[]>([])
  const [etapaId, setEtapaId] = useState<string | null>(null)
  const [postos, setPostos] = useState<Posto[]>([])
  const [cargos, setCargos] = useState<Cargo[]>([])
  const [tarefas, setTarefas] = useState<Tarefa[]>([])
  const [carregandoTarefas, setCarregandoTarefas] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const flash = useCallback((m: string) => { setMsg(m); setErro(null); window.setTimeout(() => setMsg(null), 3500) }, [])
  const flashErr = useCallback((m: string) => { setErro(m); try { window.scrollTo({ top: 0, behavior: 'smooth' }) } catch { /* */ } window.setTimeout(() => setErro(null), 6000) }, [])

  // plantas
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!companyId) { setPlants([]); setPlantId(null); return }
    void (async () => {
      const { data } = await supabase.from('industrial_plants').select('id, nome_planta').eq('company_id', companyId).eq('is_active', true).order('nome_planta')
      const ps = (data as Plant[]) ?? []
      setPlants(ps); setPlantId((prev) => prev && ps.some((p) => p.id === prev) ? prev : (ps[0]?.id ?? null))
    })()
  }, [companyId])

  // fluxos + postos + cargos da planta
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!companyId || !plantId) { setFluxos([]); setFluxoId(null); setPostos([]); setCargos([]); return }
    void (async () => {
      const [{ data: fx }, { data: po }, { data: cg }] = await Promise.all([
        supabase.from('prod_fluxo').select('id, nome').eq('company_id', companyId).eq('plant_id', plantId).order('created_at'),
        supabase.from('prod_posto').select('id, numero, atividade').eq('company_id', companyId).eq('plant_id', plantId),
        supabase.from('prod_cargo').select('id, nome').eq('company_id', companyId).eq('plant_id', plantId).eq('ativo', true).order('nome'),
      ])
      const lista = (fx as Fluxo[]) ?? []
      setFluxos(lista)
      setFluxoId((prev) => prev && lista.some((f) => f.id === prev) ? prev : (lista[0]?.id ?? null))
      setPostos((po as Posto[]) ?? [])
      setCargos((cg as Cargo[]) ?? [])
    })()
  }, [companyId, plantId])

  // etapas do fluxo
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!companyId || !plantId || !fluxoId) { setEtapas([]); setEtapaId(null); return }
    void (async () => {
      const { data } = await supabase.from('prod_fluxo_etapa').select('id, ordem, posto_id').eq('company_id', companyId).eq('plant_id', plantId).eq('fluxo_id', fluxoId).order('ordem')
      const es = (data as Etapa[]) ?? []
      setEtapas(es); setEtapaId((prev) => prev && es.some((e) => e.id === prev) ? prev : (es[0]?.id ?? null))
    })()
  }, [companyId, plantId, fluxoId])

  const postoLabel = useCallback((posto_id: string | null): string => {
    const p = posto_id ? postos.find((x) => x.id === posto_id) : undefined
    return p ? `Posto ${p.numero} — ${p.atividade}` : 'posto não vinculado'
  }, [postos])
  const etapaLabel = useCallback((e: Etapa): string => `Etapa ${e.ordem} · ${postoLabel(e.posto_id)}`, [postoLabel])

  const carregarTarefas = useCallback(async () => {
    if (!companyId || !plantId || !etapaId) { setTarefas([]); return }
    setCarregandoTarefas(true)
    const { data, error } = await supabase.rpc('fn_prod_tarefa_listar', { p_company_id: companyId, p_plant_id: plantId, p_etapa_id: etapaId })
    setCarregandoTarefas(false)
    if (error) { flashErr(error.message); return }
    const r = data as { ok: boolean; itens?: Tarefa[] } | null
    setTarefas(r?.ok ? (r.itens ?? []).filter((t) => t.ativo) : [])
  }, [companyId, plantId, etapaId, flashErr])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregarTarefas() }, [carregarTarefas])

  const cargosOpt = useMemo<OpcaoCelula[]>(() => cargos.map((c) => ({ value: c.id, label: c.nome })), [cargos])
  const proximaOrdem = useMemo(() => (tarefas.reduce((m, t) => Math.max(m, t.ordem), 0) + 1), [tarefas])

  if (!companyId) return <Aviso texto="Selecione uma empresa específica no topo — o cadastro de tarefas é por planta industrial." />
  if (plants.length === 0) return <Aviso texto="Esta empresa não tem planta industrial cadastrada. Cadastre a planta antes de lançar tarefas." />

  const ctxOk: Ctx | null = companyId && plantId ? { companyId, plantId, flash, flashErr } : null

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '22px 16px 60px', maxWidth: 1120, margin: '0 auto', color: C.esp }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: C.gold, fontWeight: 700 }}>Indústria · Produtividade</div>
      <div style={{ display: 'flex', gap: 14, fontSize: 14, margin: '6px 0' }}>
        <Link href="/dashboard/produtividade" style={{ color: C.espM }}>Cadastro por fluxo</Link>
        <b style={{ borderBottom: `2px solid ${C.gold}` }}>Tarefas</b>
      </div>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: '2px 0 0' }}>Tarefas da etapa</h1>
      <p style={{ color: C.espM, fontSize: 13, margin: '6px 0 12px' }}>Escolha o fluxo e a etapa; cada tarefa é o trabalho medível no posto. Clique em qualquer valor para editar. Capacidade em branco = a medir.</p>

      {msg && <div style={{ background: C.greenBg, color: C.green, padding: '9px 13px', borderRadius: 8, fontSize: 13, marginBottom: 12 }}>{msg}</div>}
      {erro && <div style={{ background: C.redBg, color: C.red, padding: '9px 13px', borderRadius: 8, fontSize: 13, marginBottom: 12 }}>{erro}</div>}

      {/* Seletores de planta · fluxo · etapa */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', margin: '14px 0 12px' }}>
        {plants.length > 1 && (
          <label data-ajuda="prod.tarefa.fluxo" style={{ fontSize: 12, color: C.espM, display: 'inline-flex', alignItems: 'center' }}>Planta<Aj k="prod.tarefa.fluxo" />&nbsp;
            <select data-testid="sel-planta" value={plantId ?? ''} onChange={(e) => setPlantId(e.target.value)} style={{ ...inp, width: 'auto' }}>
              {plants.map((p) => <option key={p.id} value={p.id}>{p.nome_planta}</option>)}
            </select>
          </label>
        )}
        <label data-ajuda="prod.tarefa.fluxo" style={{ fontSize: 12, color: C.espM, display: 'inline-flex', alignItems: 'center' }}>Fluxo<Aj k="prod.tarefa.fluxo" />&nbsp;
          <select data-testid="sel-fluxo" value={fluxoId ?? ''} onChange={(e) => setFluxoId(e.target.value)} style={{ ...inp, width: 'auto', fontWeight: 700, minWidth: 200 }}>
            {fluxos.length === 0 && <option value="">— nenhum fluxo —</option>}
            {fluxos.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
          </select>
        </label>
        <label data-ajuda="prod.tarefa.etapa" style={{ fontSize: 12, color: C.espM, display: 'inline-flex', alignItems: 'center' }}>Etapa<Aj k="prod.tarefa.etapa" />&nbsp;
          <select data-testid="sel-etapa" value={etapaId ?? ''} onChange={(e) => setEtapaId(e.target.value)} style={{ ...inp, width: 'auto', fontWeight: 700, minWidth: 260 }}>
            {etapas.length === 0 && <option value="">— nenhuma etapa —</option>}
            {etapas.map((e) => <option key={e.id} value={e.id}>{etapaLabel(e)}</option>)}
          </select>
        </label>
      </div>

      {fluxos.length === 0 ? (
        <VazioCard>Nenhum fluxo nesta planta ainda. Crie o fluxo no <Link href="/dashboard/produtividade" style={{ color: C.blue, textDecoration: 'underline' }}>Cadastro por fluxo</Link> e depois volte para lançar as tarefas.</VazioCard>
      ) : etapas.length === 0 ? (
        <VazioCard>Este fluxo não tem etapas. Abra o <Link href="/dashboard/produtividade" style={{ color: C.blue, textDecoration: 'underline' }}>Cadastro por fluxo</Link>, inclua os postos/etapas e volte aqui.</VazioCard>
      ) : !ctxOk || !etapaId ? (
        <VazioCard>Selecione uma etapa acima para ver e editar suas tarefas.</VazioCard>
      ) : (
        <>
          <TabelaTarefas
            ctx={ctxOk} etapaId={etapaId} tarefas={tarefas} carregando={carregandoTarefas}
            cargosOpt={cargosOpt} proximaOrdem={proximaOrdem} onMudou={carregarTarefas}
          />
          <p style={{ color: C.espL, fontSize: 11.5, marginTop: 10 }}>
            Etapa selecionada: <b style={{ color: C.espM }}>{etapaLabel(etapas.find((e) => e.id === etapaId) ?? { id: '', ordem: 0, posto_id: null })}</b>. As tarefas valem só para ela.
          </p>
        </>
      )}
    </div>
  )
}

function VazioCard({ children }: { children: React.ReactNode }) {
  return <div style={{ background: C.white, border: `1px dashed ${C.border}`, borderRadius: 12, padding: '28px 16px', textAlign: 'center', color: C.espM, fontSize: 13 }}>{children}</div>
}

function TabelaTarefas({ ctx, etapaId, tarefas, carregando, cargosOpt, proximaOrdem, onMudou }: {
  ctx: Ctx; etapaId: string; tarefas: Tarefa[]; carregando: boolean; cargosOpt: OpcaoCelula[]; proximaOrdem: number; onMudou: () => Promise<void>
}) {
  const [abertoVideo, setAbertoVideo] = useState<string | null>(null)
  const [abertoCrono, setAbertoCrono] = useState<string | null>(null)

  const salvar = useCallback(async (base: Tarefa | null, patch: Partial<Tarefa>): Promise<string | null> => {
    const next: Tarefa = { id: '', etapa_id: etapaId, ordem: proximaOrdem, nome: '', cargo_id: null, cap_hora: null, unidade_cap: null, estado: 'em_validacao', ativo: true, ...(base ?? {}), ...patch }
    const { data, error } = await supabase.rpc('fn_prod_tarefa_salvar', {
      p_company_id: ctx.companyId, p_plant_id: ctx.plantId, p_etapa_id: etapaId, p_nome: next.nome,
      p_id: next.id || null, p_ordem: next.ordem, p_cargo_id: next.cargo_id,
      p_cap_hora: next.cap_hora, p_unidade_cap: next.unidade_cap, p_estado: next.estado,
    })
    if (error) return error.message
    const r = data as { ok: boolean; id?: string; erro?: string } | null
    if (!r?.ok) return ERRS_TAREFA[r?.erro ?? ''] ?? 'Não consegui salvar a tarefa agora.'
    await onMudou()
    return null
  }, [ctx, etapaId, proximaOrdem, onMudou])

  async function arquivar(t: Tarefa) {
    if (!window.confirm(`Arquivar a tarefa "${t.nome}"?\n\nEla sai da etapa (não é apagada). Os vídeos registrados ficam guardados.`)) return
    const { error } = await supabase.rpc('fn_prod_tarefa_arquivar', { p_company_id: ctx.companyId, p_plant_id: ctx.plantId, p_id: t.id, p_ativo: false })
    if (error) { ctx.flashErr(`Não consegui arquivar: ${error.message}`); return }
    ctx.flash(`EXCLUIU (arquivou) a tarefa "${t.nome}".`)
    await onMudou()
  }

  const colEstilo: React.CSSProperties = { padding: '9px 10px', textAlign: 'left', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, color: C.espM, fontWeight: 700, whiteSpace: 'nowrap' }
  const cel: React.CSSProperties = { padding: '9px 10px', fontSize: 13, borderTop: `1px solid ${C.border}`, verticalAlign: 'top' }

  return (
    <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, overflow: 'hidden' }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
          <thead>
            <tr style={{ background: C.cream }}>
              <th style={colEstilo}>#<Aj k="prod.tarefa.ordem" /></th>
              <th style={{ ...colEstilo, minWidth: 220 }}>Tarefa<Aj k="prod.tarefa.nome" /></th>
              <th style={colEstilo}>Cargo<Aj k="prod.tarefa.cargo" /></th>
              <th style={colEstilo}>Cap./h<Aj k="prod.tarefa.cap_hora" /></th>
              <th style={colEstilo}>Unidade<Aj k="prod.tarefa.unidade_cap" /></th>
              <th style={colEstilo}>Estado<Aj k="prod.tarefa.estado" /></th>
              <th style={{ ...colEstilo, textAlign: 'right' }}>Ações</th>
            </tr>
          </thead>
          <tbody>
            {tarefas.length === 0 && !carregando && (
              <tr><td colSpan={7} style={{ ...cel, textAlign: 'center', color: C.espM, padding: '22px 10px' }}>
                Nenhuma tarefa nesta etapa ainda. Use a linha abaixo para cadastrar a primeira.
              </td></tr>
            )}
            {tarefas.map((t) => (
              <Fragment key={t.id}>
                <tr>
                  <td style={cel}>
                    <CelulaEditavel testid={`tarefa-ordem-${t.id}`} tipo="numero" largura={60} valor={String(t.ordem)}
                      onSalvar={async (v) => { const n = Number(v.trim().replace(/\D/g, '')); if (!n) return 'Informe a ordem (número).'; return salvar(t, { ordem: n }) }} />
                  </td>
                  <td style={cel}>
                    <CelulaEditavel testid={`tarefa-nome-${t.id}`} valor={t.nome} obrigatorio onSalvar={(v) => salvar(t, { nome: v })} />
                  </td>
                  <td style={cel}>
                    <CelulaEditavel testid={`tarefa-cargo-${t.id}`} tipo="lista" valor={t.cargo_id ?? ''} opcoes={cargosOpt} vazio="— sem cargo"
                      rotuloValor={(v) => cargosOpt.find((o) => o.value === v)?.label ?? '—'} onSalvar={(v) => salvar(t, { cargo_id: v || null })} />
                  </td>
                  <td style={cel}>
                    <CelulaEditavel testid={`tarefa-cap-${t.id}`} tipo="numero" largura={90} valor={t.cap_hora == null ? '' : String(t.cap_hora)} vazio="a medir"
                      onSalvar={(v) => { const { v: cap, erro } = parseCap(v); if (erro) return Promise.resolve(erro); return salvar(t, { cap_hora: cap }) }} />
                  </td>
                  <td style={cel}>
                    <CelulaEditavel testid={`tarefa-unid-${t.id}`} valor={t.unidade_cap ?? ''} vazio="—" largura={90} onSalvar={(v) => salvar(t, { unidade_cap: v.trim() || null })} />
                  </td>
                  <td style={cel}>
                    <EstadoBadge estado={t.estado} />
                    <div style={{ marginTop: 2 }}>
                      <CelulaEditavel testid={`tarefa-estado-${t.id}`} tipo="lista" obrigatorio valor={t.estado} opcoes={ESTADOS} rotuloValor={rotuloEstado} onSalvar={(v) => salvar(t, { estado: v })} />
                    </div>
                  </td>
                  <td style={{ ...cel, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button type="button" data-testid={`tarefa-crono-${t.id}`} onClick={() => setAbertoCrono((v) => v === t.id ? null : t.id)}
                      style={{ background: abertoCrono === t.id ? C.goldBg : 'transparent', border: `1px solid ${C.border}`, color: C.esp, borderRadius: 7, padding: '5px 9px', fontSize: 12, fontWeight: 700, cursor: 'pointer', marginRight: 6 }}>
                      <Timer size={13} strokeWidth={1.5} style={{ verticalAlign: '-2px', marginRight: 4 }} />Cronômetro {abertoCrono === t.id ? '▲' : '▼'}
                    </button>
                    <button type="button" data-testid={`tarefa-videos-${t.id}`} onClick={() => setAbertoVideo((v) => v === t.id ? null : t.id)}
                      style={{ background: abertoVideo === t.id ? C.goldBg : 'transparent', border: `1px solid ${C.border}`, color: C.esp, borderRadius: 7, padding: '5px 9px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                      <Video size={13} strokeWidth={1.5} style={{ verticalAlign: '-2px', marginRight: 4 }} />Vídeos {abertoVideo === t.id ? '▲' : '▼'}
                    </button>
                    <button type="button" data-testid={`tarefa-arquivar-${t.id}`} onClick={() => void arquivar(t)}
                      style={{ background: 'transparent', border: `1px solid ${C.border}`, color: C.red, borderRadius: 7, padding: '5px 9px', fontSize: 12, fontWeight: 700, cursor: 'pointer', marginLeft: 6 }}>
                      Arquivar
                    </button>
                  </td>
                </tr>
                {abertoVideo === t.id && (
                  <tr>
                    <td colSpan={7} style={{ padding: 0, borderTop: `1px solid ${C.border}`, background: C.bg }}>
                      <BlocoVideos ctx={ctx} tarefa={t} />
                    </td>
                  </tr>
                )}
                {abertoCrono === t.id && (
                  <tr>
                    <td colSpan={7} style={{ padding: 0, borderTop: `1px solid ${C.border}`, background: C.bg }}>
                      <BlocoCronometro ctx={ctx} tarefa={t} onMudou={onMudou} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {carregando && <tr><td colSpan={7} style={{ ...cel, textAlign: 'center', color: C.espM }}>Carregando tarefas…</td></tr>}
          </tbody>
        </table>
      </div>
      <NovaTarefaLinha salvar={salvar} cargosOpt={cargosOpt} proximaOrdem={proximaOrdem} />
    </div>
  )
}

function EstadoBadge({ estado }: { estado: string }) {
  const valida = estado === 'valida'
  return <span style={{ display: 'inline-block', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: valida ? C.greenBg : C.amberBg, color: valida ? C.green : '#8A4B08', border: `1px solid ${(valida ? C.green : C.amber)}55` }}>{rotuloEstado(estado)}</span>
}

type MedicaoCrono = { id: string; tempo_seg: number; qtd_pecas: number; seg_por_peca: number; observacao: string | null; medido_em: string }

// Cronoanálise digitada: tempo medido + nº de peças → Cap./h (3600 ÷ segundos por peça), média de 3+ ciclos.
function BlocoCronometro({ ctx, tarefa, onMudou }: { ctx: Ctx; tarefa: Tarefa; onMudou: () => Promise<void> }) {
  const [tempo, setTempo] = useState('')
  const [pecas, setPecas] = useState('1')
  const [obs, setObs] = useState('')
  const [lista, setLista] = useState<MedicaoCrono[]>([])
  const [carregando, setCarregando] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setCarregando(true)
    const { data, error } = await supabase.from('prod_tarefa_tempo')
      .select('id, tempo_seg, qtd_pecas, seg_por_peca, observacao, medido_em')
      .eq('tarefa_id', tarefa.id).order('medido_em', { ascending: false }).limit(50)
    setCarregando(false)
    if (!error) setLista((data as MedicaoCrono[]) ?? [])
  }, [tarefa.id])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])

  const media = lista.length ? lista.reduce((s, m) => s + Number(m.seg_por_peca), 0) / lista.length : null
  const capCalc = media ? Math.round((3600 / media) * 10) / 10 : null

  async function gravar() {
    setErro(null)
    const ts = Number(tempo.trim().replace(',', '.'))
    const qp = Number((pecas.trim() || '1').replace(',', '.'))
    if (!(ts > 0)) { setErro('Informe o tempo medido em segundos (maior que zero).'); return }
    if (!(qp > 0)) { setErro('Nº de peças deve ser maior que zero.'); return }
    setSalvando(true)
    const { data, error } = await supabase.rpc('fn_prod_tarefa_cronometro_salvar', {
      p_company_id: ctx.companyId, p_plant_id: ctx.plantId, p_tarefa_id: tarefa.id,
      p_tempo_seg: ts, p_qtd_pecas: qp, p_observacao: obs.trim() || null,
    })
    setSalvando(false)
    const r = data as { ok?: boolean; cap_hora?: number; n_medicoes?: number } | null
    if (error || !r?.ok) { setErro(error?.message ?? 'Não consegui gravar a medição agora.'); return }
    ctx.flash(`Medição gravada — Cap./h recalculada: ${r.cap_hora} peças/h (${r.n_medicoes} ciclo(s)).`)
    setTempo(''); setPecas('1'); setObs('')
    await carregar()
    await onMudou()
  }

  const lab: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: C.espM, display: 'block', marginBottom: 3 }
  return (
    <div style={{ padding: '14px 16px' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.esp, marginBottom: 8 }}>
        Cronômetro — <span style={{ color: C.espM, fontWeight: 400 }}>digite o tempo medido e o sistema calcula a Cap./h</span><Aj k="prod.tarefa.crono" />
      </div>
      {erro && <div style={{ background: C.redBg, color: C.red, padding: '7px 11px', borderRadius: 7, fontSize: 12.5, marginBottom: 8 }}>{erro}</div>}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div data-ajuda="prod.tarefa.crono_tempo" style={{ flex: '1 1 150px' }}>
          <label data-ajuda="prod.tarefa.crono_tempo" style={lab}>Tempo medido (segundos)<Aj k="prod.tarefa.crono_tempo" /></label>
          <input data-testid={`crono-tempo-${tarefa.id}`} value={tempo} onChange={(e) => setTempo(e.target.value)} inputMode="decimal" placeholder="ex.: 130" style={inp} />
        </div>
        <div data-ajuda="prod.tarefa.crono_pecas" style={{ flex: '1 1 110px' }}>
          <label data-ajuda="prod.tarefa.crono_pecas" style={lab}>Nº de peças<Aj k="prod.tarefa.crono_pecas" /></label>
          <input data-testid={`crono-pecas-${tarefa.id}`} value={pecas} onChange={(e) => setPecas(e.target.value)} inputMode="decimal" placeholder="ex.: 3" style={inp} />
        </div>
        <div data-ajuda="prod.tarefa.crono_obs" style={{ flex: '2 1 180px' }}>
          <label data-ajuda="prod.tarefa.crono_obs" style={lab}>Observação (opcional)<Aj k="prod.tarefa.crono_obs" /></label>
          <input data-testid={`crono-obs-${tarefa.id}`} value={obs} onChange={(e) => setObs(e.target.value)} placeholder="ex.: ritmo normal" style={inp} />
        </div>
        <button type="button" data-testid={`crono-gravar-${tarefa.id}`} onClick={() => void gravar()} disabled={salvando} style={btn(!salvando)}>
          {salvando ? 'Gravando…' : 'Gravar medição'}
        </button>
      </div>

      <div style={{ display: 'flex', gap: 22, margin: '12px 0 6px', flexWrap: 'wrap' }}>
        <div><span style={lab}>Média seg/peça<Aj k="prod.tarefa.crono_media" /></span><b style={{ fontSize: 16 }}>{media == null ? '—' : `${Math.round(media * 10) / 10} s`}</b></div>
        <div><span style={lab}>Cap./h calculada</span><b style={{ fontSize: 16, color: C.goldD }}>{capCalc == null ? '—' : `${capCalc} peças/h`}</b></div>
        <div><span style={lab}>Ciclos medidos</span><b style={{ fontSize: 16 }}>{lista.length}{lista.length > 0 && lista.length < 3 ? ' · meça 3+' : ''}</b></div>
      </div>

      {carregando ? <div style={{ fontSize: 12.5, color: C.espM }}>Carregando medições…</div> : lista.length === 0 ? (
        <div style={{ fontSize: 12.5, color: C.espM }}>Nenhuma medição ainda — cronometre pelo menos 3 ciclos para a média ter confiança.</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, marginTop: 2 }}>
          <thead><tr style={{ color: C.espM }}>
            <th style={{ textAlign: 'left', padding: '4px 6px', fontWeight: 700 }}>Quando</th>
            <th style={{ textAlign: 'right', padding: '4px 6px', fontWeight: 700 }}>Tempo</th>
            <th style={{ textAlign: 'right', padding: '4px 6px', fontWeight: 700 }}>Peças</th>
            <th style={{ textAlign: 'right', padding: '4px 6px', fontWeight: 700 }}>seg/peça</th>
            <th style={{ textAlign: 'left', padding: '4px 6px', fontWeight: 700 }}>Obs.</th>
          </tr></thead>
          <tbody>
            {lista.map((m) => (
              <tr key={m.id} style={{ borderTop: `1px solid ${C.border}` }}>
                <td style={{ padding: '4px 6px' }}>{new Date(m.medido_em).toLocaleString('pt-BR')}</td>
                <td style={{ padding: '4px 6px', textAlign: 'right' }}>{Number(m.tempo_seg)} s</td>
                <td style={{ padding: '4px 6px', textAlign: 'right' }}>{Number(m.qtd_pecas)}</td>
                <td style={{ padding: '4px 6px', textAlign: 'right' }}>{Math.round(Number(m.seg_por_peca) * 10) / 10}</td>
                <td style={{ padding: '4px 6px', color: C.espM }}>{m.observacao ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function NovaTarefaLinha({ salvar, cargosOpt, proximaOrdem }: { salvar: (base: Tarefa | null, patch: Partial<Tarefa>) => Promise<string | null>; cargosOpt: OpcaoCelula[]; proximaOrdem: number }) {
  const [nome, setNome] = useState('')
  const [cargoId, setCargoId] = useState('')
  const [cap, setCap] = useState('')
  const [unid, setUnid] = useState('')
  const [estado, setEstado] = useState('em_validacao')
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function criar() {
    setErro(null)
    if (!nome.trim()) { setErro('Informe o nome da tarefa.'); return }
    const { v: capV, erro: capErr } = parseCap(cap)
    if (capErr) { setErro(capErr); return }
    setBusy(true)
    const e = await salvar(null, { nome: nome.trim(), ordem: proximaOrdem, cargo_id: cargoId || null, cap_hora: capV, unidade_cap: unid.trim() || null, estado })
    setBusy(false)
    if (e) { setErro(e); return }
    setNome(''); setCargoId(''); setCap(''); setUnid(''); setEstado('em_validacao')
  }

  return (
    <div style={{ borderTop: `2px solid ${C.border}`, background: C.goldBg, padding: '12px 12px' }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, color: C.goldD, fontWeight: 700, marginBottom: 8 }}>
        CRIAR nova tarefa (ordem {proximaOrdem})<Aj k="prod.tarefa.nome" />
      </div>
      <div data-ajuda="prod.tarefa.nome" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input data-testid="nova-tarefa-nome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome da tarefa" style={{ ...inp, width: 'auto', flex: '2 1 200px' }} />
        <select data-testid="nova-tarefa-cargo" value={cargoId} onChange={(e) => setCargoId(e.target.value)} style={{ ...inp, width: 'auto', flex: '1 1 140px' }}>
          <option value="">— sem cargo —</option>
          {cargosOpt.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <input data-testid="nova-tarefa-cap" value={cap} onChange={(e) => setCap(e.target.value)} inputMode="decimal" placeholder="Cap./h (vazio = a medir)" style={{ ...inp, width: 'auto', flex: '1 1 120px' }} />
        <input data-testid="nova-tarefa-unid" value={unid} onChange={(e) => setUnid(e.target.value)} placeholder="Unidade (peças, kg…)" style={{ ...inp, width: 'auto', flex: '1 1 110px' }} />
        <select data-testid="nova-tarefa-estado" value={estado} onChange={(e) => setEstado(e.target.value)} style={{ ...inp, width: 'auto', flex: '1 1 130px' }}>
          {ESTADOS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <button data-testid="nova-tarefa-salvar" type="button" onClick={() => void criar()} disabled={busy} style={btn(!busy)}>{busy ? 'Salvando…' : '+ Adicionar'}</button>
      </div>
      {erro && <div role="alert" data-testid="nova-tarefa-erro" style={{ background: C.redBg, color: C.red, padding: '6px 10px', borderRadius: 7, fontSize: 12, marginTop: 8 }}>{erro}</div>}
    </div>
  )
}

// Bloco de vídeos da tarefa — PREPARADO: consentimento LGPD + upload, status "aguardando análise". NENHUMA IA agora.
function BlocoVideos({ ctx, tarefa }: { ctx: Ctx; tarefa: Tarefa }) {
  const [consents, setConsents] = useState<Consent[]>([])
  const [videos, setVideos] = useState<Video[]>([])
  const [consentId, setConsentId] = useState('')
  const [protocoloOk, setProtocoloOk] = useState(false)
  const [duracao, setDuracao] = useState('')
  const [guardarAte, setGuardarAte] = useState('')
  const [busy, setBusy] = useState(false)
  const [erroLocal, setErroLocal] = useState<string | null>(null)
  const [novoConsent, setNovoConsent] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const carregarConsents = useCallback(async () => {
    const { data } = await supabase.from('prod_video_consentimento').select('id, colaborador_nome, termo_versao, consentido, revogado_em').eq('company_id', ctx.companyId).eq('plant_id', ctx.plantId)
    setConsents((data as Consent[]) ?? [])
  }, [ctx.companyId, ctx.plantId])

  const carregarVideos = useCallback(async () => {
    const { data } = await supabase.from('prod_tarefa_video').select('id, storage_path, duracao_seg, protocolo_ok, status, guardar_ate, created_at').eq('company_id', ctx.companyId).eq('tarefa_id', tarefa.id).order('created_at')
    setVideos((data as Video[]) ?? [])
  }, [ctx.companyId, tarefa.id])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregarConsents(); void carregarVideos() }, [carregarConsents, carregarVideos])

  const consentsValidos = useMemo(() => consents.filter((c) => c.consentido && !c.revogado_em), [consents])
  const noLimite = videos.length >= 10

  async function subir() {
    setErroLocal(null)
    const file = fileRef.current?.files?.[0] ?? null
    if (!consentId) { setErroLocal('Escolha o consentimento do colaborador antes de subir o vídeo (LGPD).'); return }
    if (!file) { setErroLocal('Escolha o arquivo de vídeo para enviar.'); return }
    if (noLimite) { setErroLocal('Limite atingido: até 10 vídeos por tarefa.'); return }
    setBusy(true)
    const path = `${ctx.companyId}/${tarefa.id}/${Date.now()}-${file.name}`
    const up = await supabase.storage.from(BUCKET).upload(path, file)
    if (up.error) { setBusy(false); setErroLocal(`Falha ao enviar o arquivo: ${up.error.message}`); return }
    const { data, error } = await supabase.rpc('fn_prod_video_subir', {
      p_company_id: ctx.companyId, p_plant_id: ctx.plantId, p_tarefa_id: tarefa.id, p_storage_path: path,
      p_consentimento_id: consentId, p_duracao_seg: duracao.trim() ? Number(duracao.trim()) : null,
      p_protocolo_ok: protocoloOk, p_guardar_ate: guardarAte || null,
    })
    setBusy(false)
    if (error) { setErroLocal(error.message); return }
    const r = data as { ok: boolean; id?: string; status?: string; erro?: string } | null
    if (!r?.ok) { setErroLocal(ERRS_VIDEO[r?.erro ?? ''] ?? 'Não consegui registrar o vídeo.'); return }
    ctx.flash('CRIOU o vídeo da tarefa — status: aguardando análise.')
    if (fileRef.current) fileRef.current.value = ''
    setDuracao(''); setGuardarAte(''); setProtocoloOk(false)
    await carregarVideos()
  }

  const campo: React.CSSProperties = { fontSize: 12, color: C.espM, display: 'flex', flexDirection: 'column', gap: 3 }

  return (
    <div style={{ padding: '16px 16px 20px', display: 'grid', gap: 16 }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.esp }}>Vídeos da tarefa (até 10)<Aj k="prod.video.arquivo" /></div>
        <div style={{ fontSize: 12, color: C.espM, marginTop: 2 }}>
          Preparação apenas: gravamos consentimento (LGPD) e guardamos o vídeo com status <b>aguardando análise</b>. <b>Nenhuma IA roda agora</b> — a análise (ciclos, ergonomia) entra na próxima fatia.
        </div>
      </div>

      {/* Protocolo de gravação (estático) */}
      <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 12px', fontSize: 12.5, color: C.esp }}>
        <b>Protocolo de gravação<Aj k="prod.video.protocolo" />:</b> celular fixo de lado, corpo inteiro, 1 posto, 60–90 s, mínimo 3 ciclos.
      </div>

      {/* Consentimento (picker + criar) */}
      <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px' }}>
        <label data-ajuda="prod.video.consentimento" style={campo}>
          <span>Consentimento do colaborador (LGPD)<Aj k="prod.video.consentimento" /></span>
          <select data-testid={`video-consent-${tarefa.id}`} value={consentId} onChange={(e) => setConsentId(e.target.value)} style={{ ...inp, width: 'auto', maxWidth: 420 }}>
            <option value="">— escolher consentimento —</option>
            {consentsValidos.map((c) => <option key={c.id} value={c.id}>{c.colaborador_nome} · termo {c.termo_versao}</option>)}
          </select>
        </label>
        {consentsValidos.length === 0 && <div style={{ fontSize: 12, color: '#8A4B08', marginTop: 6 }}>Nenhum consentimento válido ainda. Registre o termo assinado do colaborador antes de subir qualquer vídeo.</div>}
        <button type="button" data-testid={`video-novo-consent-${tarefa.id}`} onClick={() => setNovoConsent((v) => !v)} style={{ marginTop: 8, background: 'transparent', border: `1px solid ${C.border}`, color: C.esp, borderRadius: 7, padding: '5px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
          {novoConsent ? 'Fechar' : '+ Registrar consentimento'}
        </button>
        {novoConsent && <NovoConsentimento ctx={ctx} onCriado={async (id) => { setNovoConsent(false); await carregarConsents(); setConsentId(id) }} />}
      </div>

      {/* Upload */}
      <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px', display: 'grid', gap: 10 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: C.esp }}>Subir vídeo</div>
        <label data-ajuda="prod.video.arquivo" style={campo}>
          <span>Arquivo de vídeo<Aj k="prod.video.arquivo" /></span>
          <input ref={fileRef} data-testid={`video-arquivo-${tarefa.id}`} type="file" accept="video/*" disabled={busy || noLimite} style={{ fontSize: 12.5 }} />
        </label>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <label data-ajuda="prod.video.arquivo" style={{ ...campo, flex: '1 1 120px' }}>
            <span>Duração (seg) — opcional</span>
            <input data-testid={`video-duracao-${tarefa.id}`} value={duracao} onChange={(e) => setDuracao(e.target.value)} inputMode="numeric" placeholder="ex.: 75" style={{ ...inp }} disabled={busy} />
          </label>
          <label data-ajuda="prod.video.guardar_ate" style={{ ...campo, flex: '1 1 150px' }}>
            <span>Guardar até<Aj k="prod.video.guardar_ate" /></span>
            <input data-testid={`video-guardar-${tarefa.id}`} type="date" value={guardarAte} onChange={(e) => setGuardarAte(e.target.value)} style={{ ...inp }} disabled={busy} />
          </label>
        </div>
        <label data-ajuda="prod.video.termo" style={{ fontSize: 12.5, color: C.esp, display: 'inline-flex', alignItems: 'center', gap: 7 }}>
          <input data-testid={`video-protocolo-${tarefa.id}`} type="checkbox" checked={protocoloOk} onChange={(e) => setProtocoloOk(e.target.checked)} disabled={busy} />
          Gravado dentro do protocolo acima<Aj k="prod.video.termo" />
        </label>
        <div>
          <button type="button" data-testid={`video-subir-${tarefa.id}`} onClick={() => void subir()} disabled={busy || noLimite} style={btn(!busy && !noLimite)}>
            {busy ? 'Enviando…' : noLimite ? 'Limite de 10 atingido' : 'Enviar vídeo'}
          </button>
          <span style={{ fontSize: 11.5, color: C.espM, marginLeft: 10 }}>{videos.length}/10 nesta tarefa · até 10 por tarefa</span>
        </div>
        {erroLocal && <div role="alert" style={{ background: C.redBg, color: C.red, padding: '6px 10px', borderRadius: 7, fontSize: 12 }}>{erroLocal}</div>}
      </div>

      {/* Lista de vídeos */}
      <div style={{ display: 'grid', gap: 8 }}>
        <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4, color: C.espM, fontWeight: 700 }}>Vídeos registrados<Aj k="prod.video.status" /></div>
        {videos.length === 0 ? (
          <div style={{ fontSize: 12.5, color: C.espM, fontStyle: 'italic' }}>Nenhum vídeo ainda. Registre o consentimento e envie o primeiro vídeo (dentro do protocolo).</div>
        ) : videos.map((v, i) => {
          const nome = v.storage_path.split('/').pop() ?? v.storage_path
          return (
            <div key={v.id} data-testid={`video-item-${v.id}`} style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 12px', display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: C.espL, minWidth: 20 }}>#{i + 1}</span>
              <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                <div style={{ fontSize: 13, color: C.esp, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>{nome}</div>
                <div style={{ fontSize: 11.5, color: C.espM, marginTop: 2 }}>
                  {v.duracao_seg != null ? `${v.duracao_seg}s · ` : ''}
                  {v.protocolo_ok ? 'protocolo confirmado' : 'protocolo não confirmado'}
                  {v.guardar_ate ? ` · guardar até ${v.guardar_ate}` : ''}
                </div>
                <div style={{ fontSize: 11.5, color: C.espM, marginTop: 2 }}>A análise (ciclos, ergonomia) entra na próxima fatia.</div>
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999, background: C.amberBg, color: '#8A4B08', border: `1px solid ${C.amber}55`, whiteSpace: 'nowrap' }}>
                {v.status === 'aguardando_analise' || !v.status ? 'aguardando análise' : v.status}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function NovoConsentimento({ ctx, onCriado }: { ctx: Ctx; onCriado: (id: string) => Promise<void> }) {
  const [nome, setNome] = useState('')
  const [doc, setDoc] = useState('')
  const [termo, setTermo] = useState('v1')
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function criar() {
    setErro(null)
    if (!nome.trim()) { setErro('Informe o nome do colaborador.'); return }
    if (!termo.trim()) { setErro('Informe a versão do termo assinado.'); return }
    setBusy(true)
    const { data, error } = await supabase.rpc('fn_prod_video_consentimento_salvar', {
      p_company_id: ctx.companyId, p_plant_id: ctx.plantId, p_colaborador_nome: nome.trim(),
      p_termo_versao: termo.trim(), p_id: null, p_colaborador_documento: doc.trim() || null, p_consentido: true,
    })
    setBusy(false)
    if (error) { setErro(error.message); return }
    const r = data as { ok: boolean; id?: string } | null
    if (!r?.ok || !r.id) { setErro('Não consegui registrar o consentimento.'); return }
    ctx.flash(`CRIOU o consentimento de ${nome.trim()}.`)
    setNome(''); setDoc(''); setTermo('v1')
    await onCriado(r.id)
  }

  const campo: React.CSSProperties = { fontSize: 12, color: C.espM, display: 'flex', flexDirection: 'column', gap: 3, flex: '1 1 160px' }
  return (
    <div style={{ marginTop: 10, background: C.bg, border: `1px dashed ${C.border}`, borderRadius: 8, padding: '10px 12px', display: 'grid', gap: 10 }}>
      <div style={{ fontSize: 12, color: C.espM }}>O colaborador assina o termo fora do sistema; aqui registramos que o consentimento existe.</div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <label data-ajuda="prod.video.colaborador" style={campo}><span>Colaborador<Aj k="prod.video.colaborador" /></span>
          <input data-testid="consent-nome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome completo" style={inp} disabled={busy} /></label>
        <label data-ajuda="prod.video.colaborador" style={campo}><span>Documento (opcional)</span>
          <input data-testid="consent-doc" value={doc} onChange={(e) => setDoc(e.target.value)} placeholder="CPF / matrícula" style={inp} disabled={busy} /></label>
        <label data-ajuda="prod.video.termo" style={campo}><span>Versão do termo<Aj k="prod.video.termo" /></span>
          <input data-testid="consent-termo" value={termo} onChange={(e) => setTermo(e.target.value)} placeholder="ex.: v1" style={inp} disabled={busy} /></label>
      </div>
      <div>
        <button type="button" data-testid="consent-salvar" onClick={() => void criar()} disabled={busy} style={btn(!busy)}>{busy ? 'Salvando…' : 'Registrar consentimento'}</button>
      </div>
      {erro && <div role="alert" style={{ background: C.redBg, color: C.red, padding: '6px 10px', borderRadius: 7, fontSize: 12 }}>{erro}</div>}
    </div>
  )
}

function Aviso({ texto }: { texto: string }) { return <div style={{ background: C.bg, minHeight: '100vh', padding: 28, color: C.espM, fontSize: 14 }}>{texto}</div> }
