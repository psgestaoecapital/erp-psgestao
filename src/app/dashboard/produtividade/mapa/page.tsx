'use client'

// Produtividade da Indústria · TELA 1 — Mapa do fluxo (PR B, CEO 28/10).
// Um fluxograma ÚNICO, de ponta a ponta: cada RAIA é um bloco (prod_fluxo, em ordem); dentro dela as ATIVIDADES
// (prod_fluxo_etapa) em sequência, cada uma com posto, tipo, tempo de ciclo, pessoas e unidade. Cada raia diz o que
// ENTRA e o que SAI (prod_estrutura, com rendimento). Núcleo GENÉRICO (desmontagem de qualquer indústria): o
// "Abate de bovinos" é só um modelo (dado). Simples: blocos; no celular vira lista vertical por raia. Edição no
// lugar (CelulaEditavel). "?" (RD-95) em todo campo e ação. Lê fn_prod_mapa_completo; grava pelas RPCs da PR A.

import { useCallback, useEffect, useMemo, useState, Suspense } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { CelulaEditavel } from '@/components/produtividade/CelulaEditavel'

const ROTA = '/dashboard/produtividade/mapa'
const Aj = ({ k }: { k: string }) => <AjudaCampo chave={k} rota={ROTA} />

const C = {
  esp: '#3D2314', espM: '#6B5D4F', espL: '#9C8E80', bg: '#FAF7F2', white: '#FFFFFF',
  cream: '#F0ECE3', border: '#E0D8CC', gold: '#C8941A', goldD: '#A57A15', goldBg: '#FDF7E8',
  green: '#166534', greenBg: '#ECFDF5', amber: '#BA7517', amberBg: '#FAEEDA', red: '#B42318', redBg: '#FCEBEB', blue: '#2F5AA8',
}
const inp: React.CSSProperties = { padding: '7px 9px', fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 7, background: C.white, color: C.esp, outline: 'none', width: 'auto' }
const btn = (on = true): React.CSSProperties => ({ padding: '8px 14px', fontSize: 13, fontWeight: 700, borderRadius: 8, border: 'none', cursor: on ? 'pointer' : 'not-allowed', background: on ? C.gold : C.espL, color: C.white })
const btnGhost: React.CSSProperties = { padding: '5px 10px', fontSize: 12, fontWeight: 600, borderRadius: 7, border: `1px solid ${C.border}`, background: C.white, color: C.esp, cursor: 'pointer' }

type Plant = { id: string; nome_planta: string }
type Setor = { id: string; nome: string }
type Modelo = { modelo: string; modelo_nome: string; segmento: string | null }
type ProdLado = { produto_id: string; codigo: string | null; nome: string | null; tipo_saida?: string; rendimento_padrao_pct?: number | null }
type Atividade = {
  id: string; ordem: number; nome: string | null; tipo: string | null;
  tempo_ciclo_seg: number | null; pessoas: number | null; unidade: string | null;
  posto_id: string; posto_numero: string | null; posto_atividade: string | null
}
type Raia = {
  id: string; nome: string; ordem: number; direcao: string; setor_id: string | null; setor_nome: string | null;
  atividades: Atividade[]; entra: ProdLado[]; sai: ProdLado[]
}
type Mapa = { ok: boolean; erro?: string; raias: Raia[]; modelos: Modelo[] }

const TIPOS = [
  { value: 'manual', label: 'Manual' },
  { value: 'misto', label: 'Misto' },
  { value: 'equipamento', label: 'Equipamento' },
]
const rotuloTipo = (v: string | null) => TIPOS.find((t) => t.value === v)?.label ?? '—'
const seg = (n: number | null | undefined) => (n == null ? '' : String(n))

export default function MapaFluxoPage() {
  return (
    <Suspense fallback={<div style={{ padding: 40, color: C.espM, background: C.bg, minHeight: '100vh' }}>Carregando…</div>}>
      <Inner />
    </Suspense>
  )
}

function Inner() {
  const { selInfo, sel } = useCompanyIds()
  const companyId = selInfo.tipo === 'empresa' && sel ? sel : null
  const [plants, setPlants] = useState<Plant[]>([])
  const [plantId, setPlantId] = useState<string | null>(null)
  const [setores, setSetores] = useState<Setor[]>([])
  const [mapa, setMapa] = useState<Mapa | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [msg, setMsg] = useState<{ t: 'ok' | 'erro'; v: string } | null>(null)
  const [modeloSel, setModeloSel] = useState('')

  const aviso = useCallback((t: 'ok' | 'erro', v: string) => { setMsg({ t, v }); window.setTimeout(() => setMsg(null), 3500) }, [])

  // planta(s) da empresa
  useEffect(() => {
    let vivo = true
    void (async () => {
      if (!companyId) { if (vivo) { setPlants([]); setPlantId(null) } return }
      const { data } = await supabase.from('industrial_plants').select('id, nome_planta').eq('company_id', companyId).eq('is_active', true).order('nome_planta')
      if (!vivo) return
      const ps = (data ?? []) as Plant[]
      setPlants(ps); setPlantId((prev) => (prev && ps.some((p) => p.id === prev) ? prev : ps[0]?.id ?? null))
    })()
    return () => { vivo = false }
  }, [companyId])

  // setores da planta (para criar raia / aplicar modelo)
  useEffect(() => {
    let vivo = true
    void (async () => {
      if (!companyId || !plantId) { if (vivo) setSetores([]); return }
      const { data } = await supabase.from('prod_setor').select('id, nome').eq('company_id', companyId).eq('plant_id', plantId).order('ordem')
      if (vivo) setSetores((data ?? []) as Setor[])
    })()
    return () => { vivo = false }
  }, [companyId, plantId])

  const carregar = useCallback(async () => {
    if (!companyId || !plantId) { setMapa(null); return }
    setCarregando(true)
    const { data, error } = await supabase.rpc('fn_prod_mapa_completo', { p_company_id: companyId, p_plant_id: plantId })
    setCarregando(false)
    if (error) { aviso('erro', 'Não deu para carregar o mapa agora.'); return }
    setMapa(data as Mapa)
  }, [companyId, plantId, aviso])
  useEffect(() => { let vivo = true; void (async () => { if (vivo) await carregar() })(); return () => { vivo = false } }, [carregar])

  const chamar = useCallback(async (fn: string, args: Record<string, unknown>): Promise<string | null> => {
    const { data, error } = await supabase.rpc(fn, args)
    if (error) return error.message
    const r = data as { ok?: boolean; erro?: string } | null
    if (!r?.ok) return r?.erro ?? 'Não foi possível concluir.'
    return null
  }, [])

  // ações de raia
  const salvarRaiaCampo = useCallback(async (raia: Raia, campo: Partial<Raia>): Promise<string | null> => {
    const e = await chamar('fn_prod_fluxo_salvar', { p_dados: { id: raia.id, nome: raia.nome, setor_id: raia.setor_id, direcao: raia.direcao, ...campo } })
    if (!e) await carregar()
    return e
  }, [chamar, carregar])

  const novaRaia = useCallback(async () => {
    if (!companyId || !plantId) return
    const setor = setores[0]?.id
    if (!setor) { aviso('erro', 'Cadastre um setor antes de criar a raia.'); return }
    const e = await chamar('fn_prod_fluxo_salvar', { p_dados: { company_id: companyId, plant_id: plantId, setor_id: setor, nome: 'Nova raia', direcao: 'desmontagem' } })
    if (e) aviso('erro', e); else { aviso('ok', 'Raia criada.'); await carregar() }
  }, [companyId, plantId, setores, chamar, carregar, aviso])

  const excluirRaia = useCallback(async (raia: Raia) => {
    const motivo = window.prompt(`Excluir a raia "${raia.nome}"? Diga o motivo (fica registrado):`)
    if (motivo == null) return
    const e = await chamar('fn_prod_fluxo_excluir', { p_fluxo_id: raia.id, p_motivo: motivo })
    if (e) aviso('erro', e); else { aviso('ok', 'Raia excluída.'); await carregar() }
  }, [chamar, carregar, aviso])

  const moverRaia = useCallback(async (raia: Raia, direcao: 'cima' | 'baixo') => {
    const e = await chamar('fn_prod_fluxo_mover', { p_fluxo_id: raia.id, p_direcao: direcao })
    if (e) aviso('erro', e); else await carregar()
  }, [chamar, carregar, aviso])

  // ações de atividade
  const salvarAtivCampo = useCallback(async (raia: Raia, at: Atividade, campo: Partial<Atividade>): Promise<string | null> => {
    const e = await chamar('fn_prod_etapa_salvar', {
      p_dados: {
        id: at.id, nome: at.nome, tipo: at.tipo, tempo_ciclo_seg: at.tempo_ciclo_seg,
        pessoas: at.pessoas, unidade: at.unidade, ...campo,
      },
    })
    if (!e) await carregar()
    return e
  }, [chamar, carregar])

  const novaAtividade = useCallback(async (raia: Raia) => {
    const e = await chamar('fn_prod_etapa_salvar', { p_dados: { fluxo_id: raia.id, nome: 'Nova atividade', tipo: 'manual' } })
    if (e) aviso('erro', e); else { aviso('ok', 'Atividade criada.'); await carregar() }
  }, [chamar, carregar, aviso])

  const excluirAtividade = useCallback(async (at: Atividade) => {
    const motivo = window.prompt(`Excluir a atividade "${at.nome ?? at.posto_atividade}"? Diga o motivo:`)
    if (motivo == null) return
    const e = await chamar('fn_prod_etapa_excluir', { p_etapa_id: at.id, p_motivo: motivo })
    if (e) aviso('erro', e); else { aviso('ok', 'Atividade excluída.'); await carregar() }
  }, [chamar, carregar, aviso])

  const moverAtividade = useCallback(async (at: Atividade, direcao: 'cima' | 'baixo') => {
    const e = await chamar('fn_prod_etapa_mover', { p_etapa_id: at.id, p_direcao: direcao })
    if (e) aviso('erro', e); else await carregar()
  }, [chamar, carregar, aviso])

  const aplicarModelo = useCallback(async () => {
    if (!companyId || !plantId || !modeloSel) return
    const setor = setores[0]?.id ?? null
    const e = await chamar('fn_prod_modelo_aplicar', { p_company_id: companyId, p_plant_id: plantId, p_modelo: modeloSel, p_setor_id: setor })
    if (e) aviso('erro', e); else { aviso('ok', 'Modelo aplicado — edite as raias e atividades à vontade.'); setModeloSel(''); await carregar() }
  }, [companyId, plantId, modeloSel, setores, chamar, carregar, aviso])

  const raias = useMemo(() => (mapa?.raias ?? []).slice().sort((a, b) => a.ordem - b.ordem), [mapa])

  if (!companyId) {
    return <div style={{ padding: 40, color: C.espM, background: C.bg, minHeight: '100vh' }}>Selecione uma empresa para ver o mapa do fluxo.</div>
  }

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '20px 16px 60px' }} data-testid="prod-mapa">
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: C.esp, margin: 0 }}>Mapa do fluxo</h1>
          <label style={{ fontSize: 12, color: C.espM, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            Planta <Aj k="prod.mapa.planta" />
            <select aria-label="Planta" value={plantId ?? ''} onChange={(e) => setPlantId(e.target.value)} style={inp}>
              {plants.map((p) => <option key={p.id} value={p.id}>{p.nome_planta}</option>)}
            </select>
          </label>
        </div>
        <p style={{ fontSize: 13, color: C.espM, marginTop: 0, marginBottom: 16 }}>
          Da recepção à câmara final, em raias: o que sai de uma raia entra na próxima. Toque para editar; tudo é seu para ajustar.
        </p>

        {msg && (
          <div style={{ marginBottom: 14, padding: '8px 12px', borderRadius: 8, fontSize: 13, fontWeight: 600,
            background: msg.t === 'ok' ? C.greenBg : C.redBg, color: msg.t === 'ok' ? C.green : C.red }} data-testid="prod-mapa-msg">{msg.v}</div>
        )}

        {carregando && <div style={{ color: C.espM, fontSize: 13 }}>Carregando o mapa…</div>}

        {!carregando && raias.length === 0 && (
          <div style={{ background: C.white, border: `1px dashed ${C.border}`, borderRadius: 12, padding: 24, textAlign: 'center' }} data-testid="prod-mapa-vazio">
            <div style={{ fontSize: 15, fontWeight: 700, color: C.esp }}>Nenhuma raia ainda</div>
            <div style={{ fontSize: 13, color: C.espM, margin: '6px 0 16px' }}>Comece por um modelo pronto (depois edite tudo) ou crie a primeira raia do zero.</div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap', alignItems: 'center' }}>
              <label style={{ fontSize: 12, color: C.espM, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                Modelo <Aj k="prod.mapa.modelo" />
                <select aria-label="Modelo" value={modeloSel} onChange={(e) => setModeloSel(e.target.value)} style={inp}>
                  <option value="">Escolha um modelo…</option>
                  {(mapa?.modelos ?? []).map((m) => <option key={m.modelo} value={m.modelo}>{m.modelo_nome}</option>)}
                </select>
              </label>
              <button type="button" style={btn(!!modeloSel)} disabled={!modeloSel} onClick={() => void aplicarModelo()} data-testid="prod-mapa-aplicar-modelo">Começar pelo modelo</button>
              <button type="button" style={btnGhost} onClick={() => void novaRaia()} data-testid="prod-mapa-nova-raia-vazio">+ Nova raia</button>
            </div>
          </div>
        )}

        {!carregando && raias.length > 0 && (
          <>
            <div style={{ display: 'flex', gap: 10, marginBottom: 14, alignItems: 'center' }}>
              <button type="button" style={btn()} onClick={() => void novaRaia()} data-testid="prod-mapa-nova-raia">+ Nova raia</button>
              <Aj k="prod.mapa.nova_raia" />
            </div>
            <div style={{ display: 'grid', gap: 14 }}>
              {raias.map((r, i) => (
                <RaiaCard key={r.id} raia={r} primeira={i === 0} ultima={i === raias.length - 1}
                  onNome={(v) => salvarRaiaCampo(r, { nome: v })}
                  onDirecao={(v) => salvarRaiaCampo(r, { direcao: v })}
                  onMover={(d) => void moverRaia(r, d)}
                  onExcluir={() => void excluirRaia(r)}
                  onNovaAtiv={() => void novaAtividade(r)}
                  onAtivCampo={(at, campo) => salvarAtivCampo(r, at, campo)}
                  onAtivMover={(at, d) => void moverAtividade(at, d)}
                  onAtivExcluir={(at) => void excluirAtividade(at)} />
              ))}
            </div>
          </>
        )}

        <div style={{ marginTop: 24, fontSize: 12, color: C.espL }}>
          <Link href="/dashboard/produtividade" style={{ color: C.blue, textDecoration: 'none' }}>← Produtividade</Link>
        </div>
      </div>
    </div>
  )
}

function RaiaCard({ raia, primeira, ultima, onNome, onDirecao, onMover, onExcluir, onNovaAtiv, onAtivCampo, onAtivMover, onAtivExcluir }: {
  raia: Raia; primeira: boolean; ultima: boolean
  onNome: (v: string) => Promise<string | null>
  onDirecao: (v: string) => Promise<string | null>
  onMover: (d: 'cima' | 'baixo') => void
  onExcluir: () => void
  onNovaAtiv: () => void
  onAtivCampo: (at: Atividade, campo: Partial<Atividade>) => Promise<string | null>
  onAtivMover: (at: Atividade, d: 'cima' | 'baixo') => void
  onAtivExcluir: (at: Atividade) => void
}) {
  const ladoTexto = (p: ProdLado) => `${p.codigo ? p.codigo + ' · ' : ''}${p.nome ?? 'produto'}${p.rendimento_padrao_pct != null ? ` (${p.rendimento_padrao_pct}%)` : ''}`
  const ativ = raia.atividades.slice().sort((a, b) => a.ordem - b.ordem)
  return (
    <section style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: '14px 16px' }} data-testid="prod-raia">
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 220, flex: 1 }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: C.gold }}>#{raia.ordem}</span>
          <div style={{ fontWeight: 800, fontSize: 16, color: C.esp }}>
            <CelulaEditavel testid="prod-raia-nome" valor={raia.nome} obrigatorio onSalvar={onNome} />
          </div>
          <Aj k="prod.mapa.raia_nome" />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11, color: C.espM }}>Direção <Aj k="prod.mapa.raia_direcao" /></span>
          <CelulaEditavel testid="prod-raia-direcao" valor={raia.direcao} tipo="lista"
            opcoes={[{ value: 'desmontagem', label: 'Desmontagem' }, { value: 'montagem', label: 'Montagem' }]}
            rotuloValor={(v) => (v === 'montagem' ? 'Montagem' : 'Desmontagem')} onSalvar={onDirecao} />
          <button type="button" style={btnGhost} disabled={primeira} onClick={() => onMover('cima')} aria-label="Mover raia para cima" data-testid="prod-raia-cima">↑</button>
          <button type="button" style={btnGhost} disabled={ultima} onClick={() => onMover('baixo')} aria-label="Mover raia para baixo" data-testid="prod-raia-baixo">↓</button>
          <Aj k="prod.mapa.raia_mover" />
          <button type="button" style={{ ...btnGhost, color: C.red }} onClick={onExcluir} data-testid="prod-raia-excluir">Excluir</button>
          <Aj k="prod.mapa.raia_excluir" />
        </div>
      </div>

      <div style={{ fontSize: 12, color: C.espM, margin: '8px 0', display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }} data-testid="prod-raia-entra-sai">
        <span style={{ fontWeight: 700, color: C.esp }}>Entra:</span> {raia.entra.length ? raia.entra.map(ladoTexto).join(', ') : '—'}
        <span style={{ color: C.espL }}>→</span>
        <span style={{ fontWeight: 700, color: C.esp }}>Sai:</span> {raia.sai.length ? raia.sai.map(ladoTexto).join(', ') : '—'}
        <Aj k="prod.mapa.entra_sai" />
      </div>

      <div style={{ borderTop: `1px solid ${C.cream}`, paddingTop: 8 }}>
        {ativ.length === 0 && <div style={{ fontSize: 12, color: C.espL, marginBottom: 6 }}>Sem atividades nesta raia ainda.</div>}
        <div style={{ display: 'grid', gap: 8 }}>
          {ativ.map((at, j) => (
            <div key={at.id} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 8, alignItems: 'center',
              background: C.bg, border: `1px solid ${C.cream}`, borderRadius: 8, padding: '8px 10px' }} data-testid="prod-atividade">
              <Campo rotulo="Atividade" ajuda="prod.mapa.atividade_nome">
                <CelulaEditavel testid="prod-ativ-nome" valor={at.nome ?? at.posto_atividade ?? ''} obrigatorio onSalvar={(v) => onAtivCampo(at, { nome: v })} />
              </Campo>
              <Campo rotulo="Tipo" ajuda="prod.mapa.atividade_tipo">
                <CelulaEditavel testid="prod-ativ-tipo" valor={at.tipo ?? ''} tipo="lista" opcoes={TIPOS} vazio="—" rotuloValor={rotuloTipo} onSalvar={(v) => onAtivCampo(at, { tipo: v })} />
              </Campo>
              <Campo rotulo="Tempo/ciclo (s)" ajuda="prod.mapa.atividade_tempo">
                <CelulaEditavel testid="prod-ativ-tempo" valor={seg(at.tempo_ciclo_seg)} tipo="numero" vazio="a medir" onSalvar={(v) => onAtivCampo(at, { tempo_ciclo_seg: v === '' ? null : Number(v) })} />
              </Campo>
              <Campo rotulo="Pessoas" ajuda="prod.mapa.atividade_pessoas">
                <CelulaEditavel testid="prod-ativ-pessoas" valor={seg(at.pessoas)} tipo="numero" vazio="—" onSalvar={(v) => onAtivCampo(at, { pessoas: v === '' ? null : Number(v) })} />
              </Campo>
              <Campo rotulo="Unidade" ajuda="prod.mapa.atividade_unidade">
                <CelulaEditavel testid="prod-ativ-unidade" valor={at.unidade ?? ''} vazio="—" onSalvar={(v) => onAtivCampo(at, { unidade: v || null })} />
              </Campo>
              <Campo rotulo="Posto" ajuda="prod.mapa.atividade_posto">
                <span style={{ fontSize: 13, color: C.esp }}>{at.posto_numero ?? '—'}</span>
              </Campo>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center', justifyContent: 'flex-end' }}>
                <button type="button" style={btnGhost} disabled={j === 0} onClick={() => onAtivMover(at, 'cima')} aria-label="Subir atividade" data-testid="prod-ativ-cima">↑</button>
                <button type="button" style={btnGhost} disabled={j === ativ.length - 1} onClick={() => onAtivMover(at, 'baixo')} aria-label="Descer atividade" data-testid="prod-ativ-baixo">↓</button>
                <Aj k="prod.mapa.atividade_mover" />
                <button type="button" style={{ ...btnGhost, color: C.red }} onClick={() => onAtivExcluir(at)} data-testid="prod-ativ-excluir">×</button>
                <Aj k="prod.mapa.atividade_excluir" />
              </div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
          <button type="button" style={btnGhost} onClick={onNovaAtiv} data-testid="prod-nova-atividade">+ Atividade</button>
          <Aj k="prod.mapa.nova_atividade" />
        </div>
      </div>
    </section>
  )
}

function Campo({ rotulo, ajuda, children }: { rotulo: string; ajuda: string; children: React.ReactNode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 10.5, color: C.espM, marginBottom: 2 }}>{rotulo} <AjudaCampo chave={ajuda} rota={ROTA} /></div>
      {children}
    </div>
  )
}
