'use client'

// Revenda · Onda 5B — vistoria no pátio, tela mobile. Fluxo LINEAR guiado (decisão do CEO 06/09):
// uma região por vez, uma pergunta por vez, na ordem em que a pessoa anda em volta do carro.
// Salva item a item no servidor (fn_insp_responder); a tolerância vem da RETOMADA (vistoria fica
// em_andamento e fn_insp_vistoria_abrir devolve ela de volta). SEM localStorage (RD/pátio).

import { useCallback, useEffect, useMemo, useRef, useState, Suspense } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'

const C = {
  esp: '#3D2314', espM: '#6B5D4F', espL: '#9C8E80', bg: '#FAF7F2', white: '#FFFFFF', cream: '#F0ECE3',
  border: '#E0D8CC', gold: '#C8941A', green: '#166534', greenBg: '#ECFDF5', amber: '#BA7517', amberBg: '#FFF6E5',
  red: '#B42318', redBg: '#FDECEC', blue: '#2F5AA8',
}
const BUCKET = 'revenda-veiculos'
const brl = (v: number) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

type Estado = 'ok' | 'desgaste' | 'reparo' | 'troca'
type Item = { item_id: string; nome: string; ordem: number; categoria_custo: string | null; estado: Estado | null; descricao: string | null; gasto_previsto: number | null; gasto_realizado: number | null; custo_id: string | null }
type FotoR = { foto_id: string; storage_path: string; legenda: string | null }
type Regiao = { regiao_id: string; codigo: string; nome: string; ordem: number; foto_obrigatoria: boolean; foto_rotulo: string | null; tem_foto: boolean; fotos: FotoR[]; itens: Item[] }
type Vistoria = { id: string; situacao: string; km: number | null; previsao_total: number; concluida_em: string | null; observacao: string | null }
type Obter = { ok?: boolean; vistoria?: Vistoria; itens_total?: number; itens_avaliados?: number; regioes?: Regiao[] }

const ESTADO_COR: Record<Estado, { bg: string; fg: string }> = {
  ok: { bg: C.greenBg, fg: C.green }, desgaste: { bg: C.amberBg, fg: C.amber },
  reparo: { bg: '#FDEEDD', fg: '#B4530F' }, troca: { bg: C.redBg, fg: C.red },
}

export default function VistoriaPage() {
  return <Suspense fallback={<div style={{ padding: 40, color: C.espM, background: C.bg, minHeight: '100vh' }}>Carregando…</div>}><Inner /></Suspense>
}

function Inner() {
  const params = useParams()
  const veiculoId = typeof params?.id === 'string' ? params.id : Array.isArray(params?.id) ? params!.id[0] : ''
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [vistoriaId, setVistoriaId] = useState<string | null>(null)
  const [data, setData] = useState<Obter | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [modo, setModo] = useState<'fluxo' | 'resumo'>('fluxo')
  const [regIdx, setRegIdx] = useState(0)
  const [itemIdx, setItemIdx] = useState(0)
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [saveState, setSaveState] = useState<Record<string, 'salvando' | 'salvo' | 'falhou'>>({})
  const bootRef = useRef(false)

  async function userId() { const { data: { user } } = await supabase.auth.getUser(); return user?.id ?? null }

  const carregarVistoria = useCallback(async (vid: string) => {
    const { data: j } = await supabase.rpc('fn_insp_vistoria_obter', { p_vistoria_id: vid })
    const r = j as Obter | null
    if (r?.ok) {
      setData(r)
      const paths = (r.regioes ?? []).flatMap((rg) => rg.fotos?.map((f) => f.storage_path) ?? [])
      if (paths.length) {
        const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 3600)
        const m: Record<string, string> = {}
        ;(signed ?? []).forEach((s) => { if (s.signedUrl && s.path) m[s.path] = s.signedUrl })
        setUrls((prev) => ({ ...prev, ...m }))
      }
    }
  }, [])

  // boot: descobre empresa, garante modelo, abre (ou retoma) a vistoria
  useEffect(() => {
    if (bootRef.current || !veiculoId) return
    bootRef.current = true
    void (async () => {
      setCarregando(true)
      try {
        const { data: veic } = await supabase.from('veic_veiculo').select('company_id').eq('id', veiculoId).maybeSingle()
        const comp = (veic as { company_id?: string } | null)?.company_id
        if (!comp) { setErro('Veículo não encontrado.'); return }
        setCompanyId(comp)
        const uid = await userId()
        // modelo padrão da empresa (semeia se faltar — §2.1)
        let modeloId: string | null = null
        const { data: mod } = await supabase.from('insp_modelo').select('id').eq('company_id', comp).eq('escopo', 'veiculo_revenda').eq('padrao', true).limit(1).maybeSingle()
        modeloId = (mod as { id?: string } | null)?.id ?? null
        if (!modeloId) {
          const { data: sem } = await supabase.rpc('fn_insp_modelo_semear', { p_company_id: comp, p_escopo: 'veiculo_revenda', p_tipo_alvo: 'carro' })
          modeloId = (sem as { modelo_id?: string } | null)?.modelo_id ?? null
        }
        if (!modeloId) { setErro('Não foi possível preparar o checklist da vistoria.'); return }
        const { data: ab } = await supabase.rpc('fn_insp_vistoria_abrir', { p_company_id: comp, p_alvo_tabela: 'veic_veiculo', p_alvo_id: veiculoId, p_modelo_id: modeloId, p_user: uid })
        const abr = ab as { ok?: boolean; vistoria_id?: string; erro?: string } | null
        if (!abr?.ok || !abr.vistoria_id) { setErro(abr?.erro || 'Não foi possível abrir a vistoria.'); return }
        setVistoriaId(abr.vistoria_id)
        await carregarVistoria(abr.vistoria_id)
      } catch { setErro('Falha ao iniciar a vistoria.') }
      finally { setCarregando(false) }
    })()
  }, [veiculoId, carregarVistoria])

  const regioes = useMemo(() => data?.regioes ?? [], [data])
  const regiao = regioes[regIdx] ?? null
  const concluida = data?.vistoria?.situacao === 'concluida'

  // primeiro item não respondido da região (retomada visual)
  useEffect(() => {
    if (!regiao) return
    const prox = regiao.itens.findIndex((i) => i.estado == null)
    setItemIdx(prox >= 0 ? prox : Math.max(0, regiao.itens.length - 1))
  }, [regIdx, regiao?.regiao_id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function responder(item: Item, estado: Estado | null, descricao: string | null, gasto: number | null, avancar: boolean) {
    if (!vistoriaId) return
    setSaveState((s) => ({ ...s, [item.item_id]: 'salvando' }))
    const { data: j } = await supabase.rpc('fn_insp_responder', { p_vistoria_id: vistoriaId, p_item_id: item.item_id, p_estado: estado, p_descricao: descricao, p_gasto: gasto, p_user: await userId() })
    const r = j as { ok?: boolean; previsao_total?: number } | null
    if (!r?.ok) { setSaveState((s) => ({ ...s, [item.item_id]: 'falhou' })); return }
    setSaveState((s) => ({ ...s, [item.item_id]: 'salvo' }))
    // atualiza local sem recarregar tudo
    setData((prev) => {
      if (!prev) return prev
      const rg = (prev.regioes ?? []).map((x) => x.regiao_id !== regiao?.regiao_id ? x : {
        ...x, itens: x.itens.map((it) => it.item_id === item.item_id ? { ...it, estado, descricao, gasto_previsto: gasto } : it),
      })
      const avaliados = rg.reduce((s, x) => s + x.itens.filter((it) => it.estado != null).length, 0)
      const vist = prev.vistoria ? { ...prev.vistoria, previsao_total: r.previsao_total ?? prev.vistoria.previsao_total } : prev.vistoria
      return { ...prev, regioes: rg, itens_avaliados: avaliados, vistoria: vist }
    })
    if (avancar) proximoItem()
  }

  function proximoItem() {
    if (!regiao) return
    if (itemIdx < regiao.itens.length - 1) setItemIdx(itemIdx + 1)
    // fim da região: não pula sozinho (a foto obrigatória pode faltar) — o botão de avançar região cuida
  }
  function avancarRegiao() {
    if (regIdx < regioes.length - 1) setRegIdx(regIdx + 1)
    else setModo('resumo')
  }
  function voltarRegiao() {
    if (regIdx > 0) setRegIdx(regIdx - 1)
  }

  async function uploadFoto(rg: Regiao, file: File) {
    if (!vistoriaId || !companyId) return
    const ext = ((file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '')) || 'jpg'
    const path = `vistorias/${companyId}/${vistoriaId}/${rg.regiao_id}/${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || 'image/jpeg', upsert: false })
    if (upErr) { setErro('Falha no upload da foto: ' + upErr.message); return }
    const { data: j } = await supabase.rpc('fn_insp_foto_registrar', { p_vistoria_id: vistoriaId, p_regiao_id: rg.regiao_id, p_storage_path: path, p_legenda: rg.foto_rotulo, p_user: await userId() })
    const r = j as { ok?: boolean; erro?: string } | null
    if (!r?.ok) { setErro(r?.erro || 'Falha ao registrar a foto.'); await supabase.storage.from(BUCKET).remove([path]); return }
    await carregarVistoria(vistoriaId)
  }
  async function removerFoto(f: FotoR) {
    if (!vistoriaId) return
    const { data: j } = await supabase.rpc('fn_insp_foto_remover', { p_foto_id: f.foto_id, p_user: await userId() })
    const r = j as { ok?: boolean; storage_path_removido?: string } | null
    if (!r?.ok) { setErro('Falha ao remover a foto.'); return }
    if (r.storage_path_removido) await supabase.storage.from(BUCKET).remove([r.storage_path_removido])
    await carregarVistoria(vistoriaId)
  }
  async function setKm(km: string) {
    if (!vistoriaId) return
    const n = Number(String(km).replace(',', '.'))
    await supabase.from('insp_vistoria').update({ km: Number.isFinite(n) && n > 0 ? n : null }).eq('id', vistoriaId)
    setData((prev) => prev?.vistoria ? { ...prev, vistoria: { ...prev.vistoria, km: Number.isFinite(n) ? n : null } } : prev)
  }

  const totais = useMemo(() => {
    const its = regioes.flatMap((r) => r.itens)
    return {
      total: data?.itens_total ?? its.length,
      avaliados: data?.itens_avaliados ?? its.filter((i) => i.estado != null).length,
      reparo: its.filter((i) => i.estado === 'reparo').length,
      troca: its.filter((i) => i.estado === 'troca').length,
      previsao: data?.vistoria?.previsao_total ?? 0,
      fotosOk: regioes.filter((r) => r.foto_obrigatoria && r.tem_foto).length,
      fotosObrig: regioes.filter((r) => r.foto_obrigatoria).length,
    }
  }, [regioes, data])

  if (carregando) return <div style={{ padding: 40, color: C.espM, background: C.bg, minHeight: '100vh' }}>Preparando a vistoria…</div>
  if (erro && !data) return <div style={{ padding: 28, background: C.bg, minHeight: '100vh' }}><div style={{ background: C.redBg, color: C.red, padding: 14, borderRadius: 10 }}>{erro}</div><a href={`/dashboard/revenda/veiculo/${veiculoId}`} style={{ color: C.blue, fontSize: 13, display: 'inline-block', marginTop: 12 }}>← voltar à ficha</a></div>

  return (
    <div style={{ background: C.bg, minHeight: '100vh', color: C.esp, maxWidth: 560, margin: '0 auto', paddingBottom: 40 }}>
      {/* Barra de progresso permanente (§2.6) */}
      <div style={{ position: 'sticky', top: 0, zIndex: 10, background: C.white, borderBottom: `1px solid ${C.border}`, padding: '10px 14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12.5 }}>
          <a href={`/dashboard/revenda/veiculo/${veiculoId}`} style={{ color: C.blue, textDecoration: 'none' }}>← ficha</a>
          <span style={{ fontWeight: 700, color: C.esp }}>{totais.avaliados}/{totais.total} itens</span>
          <span style={{ color: C.gold, fontWeight: 700 }}>{brl(totais.previsao)}</span>
        </div>
        <div style={{ height: 6, background: C.cream, borderRadius: 999, marginTop: 8, overflow: 'hidden' }}>
          <div style={{ width: `${totais.total ? (totais.avaliados / totais.total * 100) : 0}%`, height: '100%', background: C.gold, transition: 'width .3s' }} />
        </div>
      </div>

      {erro && <div style={{ background: C.redBg, color: C.red, padding: '9px 14px', fontSize: 13 }} onClick={() => setErro(null)}>{erro}</div>}

      {concluida ? (
        <div style={{ padding: 24, textAlign: 'center' }}>
          <div style={{ fontSize: 40 }}>✅</div>
          <div style={{ fontSize: 18, fontWeight: 700, margin: '8px 0' }}>Vistoria concluída</div>
          <div style={{ fontSize: 13, color: C.espM }}>Previsão de gastos <b style={{ color: C.gold }}>{brl(totais.previsao)}</b> · {totais.avaliados} de {totais.total} itens avaliados.</div>
          <a href={`/dashboard/revenda/veiculo/${veiculoId}`} style={{ display: 'inline-block', marginTop: 16, background: C.gold, color: '#fff', padding: '10px 18px', borderRadius: 10, textDecoration: 'none', fontWeight: 700 }}>Ver na ficha</a>
        </div>
      ) : modo === 'resumo' ? (
        <Resumo totais={totais} onVoltar={() => setModo('fluxo')} vistoriaId={vistoriaId} userId={userId}
          onConcluida={() => { if (vistoriaId) void carregarVistoria(vistoriaId) }} onErro={setErro}
          regioes={regioes} onIrRegiao={(idx) => { setRegIdx(idx); setModo('fluxo') }} />
      ) : regiao ? (
        <div style={{ padding: 14 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: C.gold, fontWeight: 700 }}>Região {regiao.ordem}/{regioes.length}</div>
          <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 10 }}>{regiao.nome}</div>

          {/* Foto da região (§2.4) */}
          {(regiao.foto_obrigatoria || (regiao.foto_rotulo ?? '') !== '') && (
            <FotoRegiao rg={regiao} urls={urls} onUpload={(f) => void uploadFoto(regiao, f)} onRemover={(f) => void removerFoto(f)} />
          )}

          {/* KM (só interior) */}
          {regiao.codigo === 'interior' && (
            <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: 12, marginBottom: 12 }}>
              <label style={{ fontSize: 12.5, color: C.espM, fontWeight: 700 }}>KM do veículo</label>
              <input defaultValue={data?.vistoria?.km ?? ''} inputMode="numeric" onBlur={(e) => void setKm(e.target.value)}
                placeholder="ex.: 84500" style={{ width: '100%', boxSizing: 'border-box', marginTop: 6, padding: '12px', fontSize: 18, border: `1px solid ${C.border}`, borderRadius: 10, color: C.esp }} />
            </div>
          )}

          {/* Item atual — o coração (§2.2) */}
          {regiao.itens[itemIdx] && (
            <ItemCard key={regiao.itens[itemIdx].item_id} item={regiao.itens[itemIdx]} idx={itemIdx} total={regiao.itens.length}
              regiaoNome={regiao.nome} companyId={companyId} save={saveState[regiao.itens[itemIdx].item_id]}
              onResponder={(estado, desc, gasto, avancar) => void responder(regiao.itens[itemIdx], estado, desc, gasto, avancar)}
              onPular={() => { void responder(regiao.itens[itemIdx], null, null, null, true) }} />
          )}

          {/* Navegação da região */}
          <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center' }}>
            <button onClick={() => itemIdx > 0 ? setItemIdx(itemIdx - 1) : voltarRegiao()} style={btnGhost}>‹ anterior</button>
            <div style={{ flex: 1 }} />
            {itemIdx < regiao.itens.length - 1
              ? <button onClick={() => setItemIdx(itemIdx + 1)} style={btnGhost}>próximo ›</button>
              : <AvancarRegiao regiao={regiao} onAvancar={avancarRegiao} />}
          </div>
        </div>
      ) : null}
    </div>
  )
}

const btnGhost: React.CSSProperties = { background: 'none', border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 12px', fontSize: 13, color: C.espM, cursor: 'pointer' }

function AvancarRegiao({ regiao, onAvancar }: { regiao: Regiao; onAvancar: () => void }) {
  const bloqueado = regiao.foto_obrigatoria && !regiao.tem_foto
  return (
    <div style={{ textAlign: 'right' }}>
      <button disabled={bloqueado} onClick={onAvancar}
        style={{ background: bloqueado ? C.espL : C.gold, color: '#fff', border: 'none', borderRadius: 10, padding: '10px 16px', fontSize: 14, fontWeight: 700, cursor: bloqueado ? 'not-allowed' : 'pointer' }}>
        {regiao.ordem >= 7 ? 'ir ao resumo →' : 'próxima região →'}
      </button>
      {bloqueado && <div style={{ fontSize: 11, color: C.amber, marginTop: 4 }}>Tire a foto obrigatória desta região para avançar.</div>}
    </div>
  )
}

function FotoRegiao({ rg, urls, onUpload, onRemover }: { rg: Regiao; urls: Record<string, string>; onUpload: (f: File) => void; onRemover: (f: FotoR) => void }) {
  const [busy, setBusy] = useState(false)
  return (
    <div style={{ background: C.white, border: `1px solid ${rg.foto_obrigatoria && !rg.tem_foto ? C.amber : C.border}`, borderRadius: 12, padding: 12, marginBottom: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.esp }}>📷 {rg.foto_rotulo || 'Foto da região'}{rg.foto_obrigatoria && <span style={{ color: C.amber }}> · obrigatória</span>}</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
        {rg.fotos.map((f) => (
          <div key={f.foto_id} style={{ position: 'relative', width: 84, height: 84, borderRadius: 8, overflow: 'hidden', background: C.cream, border: `1px solid ${C.border}` }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {urls[f.storage_path] ? <img src={urls[f.storage_path]} alt="foto" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: 10, color: C.espL, display: 'block', padding: 6 }}>carregando…</span>}
            <button onClick={() => onRemover(f)} aria-label="remover" style={{ position: 'absolute', top: 2, right: 2, background: 'rgba(0,0,0,.55)', color: '#fff', border: 'none', borderRadius: 999, width: 22, height: 22, cursor: 'pointer', fontSize: 13 }}>✕</button>
          </div>
        ))}
        <label style={{ width: 84, height: 84, borderRadius: 8, border: `1px dashed ${C.gold}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.gold, fontSize: 24, cursor: busy ? 'wait' : 'pointer' }}>
          {busy ? '…' : '＋'}
          <input type="file" accept="image/*" capture="environment" disabled={busy} style={{ display: 'none' }}
            onChange={async (e) => { const f = e.target.files?.[0]; e.currentTarget.value = ''; if (f) { setBusy(true); try { await onUpload(f) } finally { setBusy(false) } } }} />
        </label>
      </div>
    </div>
  )
}

function ItemCard({ item, idx, total, regiaoNome, companyId, save, onResponder, onPular }: {
  item: Item; idx: number; total: number; regiaoNome: string; companyId: string | null
  save?: 'salvando' | 'salvo' | 'falhou'
  onResponder: (estado: Estado, desc: string | null, gasto: number | null, avancar: boolean) => void
  onPular: () => void
}) {
  const [expandido, setExpandido] = useState<null | 'reparo' | 'troca'>(item.estado === 'reparo' || item.estado === 'troca' ? item.estado : null)
  const [desc, setDesc] = useState(item.descricao ?? '')
  const [valor, setValor] = useState(item.gasto_previsto != null ? String(item.gasto_previsto) : '')
  const [sug, setSug] = useState<{ tem_historico?: boolean; ocorrencias?: number; min?: number; max?: number } | null>(null)

  useEffect(() => {
    if (!expandido || !companyId) return  // painel fechado: mantém sug (não seta síncrono no efeito)
    let vivo = true
    void supabase.rpc('fn_insp_sugestao_gasto', { p_company_id: companyId, p_item_id: item.item_id }).then(({ data }) => {
      if (vivo) setSug(data as { tem_historico?: boolean; ocorrencias?: number; min?: number; max?: number } | null)
    })
    return () => { vivo = false }
  }, [expandido, companyId, item.item_id])

  const escolher = (estado: Estado) => {
    if (estado === 'reparo' || estado === 'troca') { setExpandido(estado) }
    else onResponder(estado, null, null, true) // OK/DESGASTE avança sozinho
  }
  const salvarValor = () => {
    if (!expandido) return
    const n = Number(String(valor).replace(',', '.'))
    onResponder(expandido, desc.trim() || null, Number.isFinite(n) && n > 0 ? n : null, true)
  }

  const cor = item.estado ? ESTADO_COR[item.estado] : null
  return (
    <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: 16 }}>
      <div style={{ fontSize: 21, fontWeight: 700, textAlign: 'center' }}>{item.nome}</div>
      <div style={{ fontSize: 12, color: C.espM, textAlign: 'center', marginTop: 2 }}>
        item {idx + 1} de {total} · {regiaoNome}
        {cor && <span style={{ marginLeft: 8, padding: '1px 8px', borderRadius: 999, background: cor.bg, color: cor.fg, fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase' }}>{item.estado}</span>}
        {save === 'salvando' && <span style={{ marginLeft: 8, color: C.espL }}>salvando…</span>}
        {save === 'salvo' && <span style={{ marginLeft: 8, color: C.green }}>salvo ✓</span>}
        {save === 'falhou' && <span style={{ marginLeft: 8, color: C.red }}>falhou ↻</span>}
      </div>

      {!expandido ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 16 }}>
            {(['ok', 'desgaste', 'reparo', 'troca'] as Estado[]).map((e) => {
              const c = ESTADO_COR[e]
              const sel = item.estado === e
              return (
                <button key={e} onClick={() => escolher(e)}
                  style={{ padding: '20px 8px', borderRadius: 12, border: `2px solid ${sel ? c.fg : C.border}`, background: sel ? c.bg : C.white, color: c.fg, fontSize: 16, fontWeight: 700, textTransform: 'uppercase', cursor: 'pointer', minHeight: 64 }}>
                  {e}
                </button>
              )
            })}
          </div>
          <div style={{ textAlign: 'center', marginTop: 12 }}>
            <button onClick={onPular} style={{ background: 'none', border: 'none', color: C.espL, fontSize: 13, cursor: 'pointer', textDecoration: 'underline' }}>pular</button>
          </div>
        </>
      ) : (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12.5, color: C.espM, fontWeight: 700 }}>O que precisa?</div>
          <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="ex.: Reparo tecido/couro"
            style={{ width: '100%', boxSizing: 'border-box', marginTop: 6, padding: 12, fontSize: 15, border: `1px solid ${C.border}`, borderRadius: 10, color: C.esp }} />
          <div style={{ fontSize: 12.5, color: C.espM, fontWeight: 700, marginTop: 12 }}>Quanto vai custar?</div>
          <input value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal" placeholder="R$ 0,00"
            style={{ width: '100%', boxSizing: 'border-box', marginTop: 6, padding: 12, fontSize: 18, border: `1px solid ${C.border}`, borderRadius: 10, color: C.esp }} />
          {/* sugestão só com histórico real (§2.3) — nunca faixa inventada */}
          {sug?.tem_historico && sug.min != null && sug.max != null && (
            <div style={{ background: C.amberBg, borderRadius: 8, padding: '8px 10px', marginTop: 8, fontSize: 12, color: '#8A4B08' }}>
              💡 Nas últimas {sug.ocorrencias} vezes você pagou entre {brl(sug.min)} e {brl(sug.max)}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'space-between' }}>
            <button onClick={() => setExpandido(null)} style={btnGhost}>‹ voltar</button>
            <button onClick={salvarValor} style={{ background: C.gold, color: '#fff', border: 'none', borderRadius: 10, padding: '10px 20px', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>salvar</button>
          </div>
        </div>
      )}
    </div>
  )
}

function Resumo({ totais, onVoltar, vistoriaId, userId, onConcluida, onErro, regioes, onIrRegiao }: {
  totais: { total: number; avaliados: number; reparo: number; troca: number; previsao: number; fotosOk: number; fotosObrig: number }
  onVoltar: () => void; vistoriaId: string | null; userId: () => Promise<string | null>
  onConcluida: () => void; onErro: (m: string) => void; regioes: Regiao[]; onIrRegiao: (idx: number) => void
}) {
  const [busy, setBusy] = useState(false)
  const [pend, setPend] = useState<{ fotos: string[]; gastos: string[] } | null>(null)
  const naoAvaliados = totais.total - totais.avaliados

  async function concluir() {
    if (!vistoriaId) return
    setBusy(true); setPend(null)
    const { data: j } = await supabase.rpc('fn_insp_vistoria_concluir', { p_vistoria_id: vistoriaId, p_user: await userId() })
    setBusy(false)
    const r = j as { ok?: boolean; erro?: string; fotos_faltando?: string[]; gastos_faltando?: string[] } | null
    if (r?.ok) { onConcluida(); return }
    if (r?.erro === 'pendencias') { setPend({ fotos: r.fotos_faltando ?? [], gastos: r.gastos_faltando ?? [] }); return }
    onErro(r?.erro || 'Não foi possível concluir a vistoria.')
  }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: C.gold, fontWeight: 700 }}>Resumo</div>
      <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: 16, marginTop: 8 }}>
        <Linha label="Avaliados" valor={`${totais.avaliados} de ${totais.total} itens`} alerta={naoAvaliados > 0 ? `⚠️ ${naoAvaliados} não avaliados` : undefined} />
        <Linha label="Precisa reparo" valor={`${totais.reparo} ${totais.reparo === 1 ? 'item' : 'itens'}`} />
        <Linha label="Precisa troca" valor={`${totais.troca} ${totais.troca === 1 ? 'item' : 'itens'}`} />
        <div style={{ borderTop: `1px solid ${C.cream}`, margin: '10px 0', paddingTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>PREVISÃO DE GASTOS</span>
          <span style={{ fontSize: 22, fontWeight: 700, color: C.gold }}>{brl(totais.previsao)}</span>
        </div>
        <Linha label="Fotos" valor={`${totais.fotosOk} de ${totais.fotosObrig} regiões`} ok={totais.fotosOk === totais.fotosObrig} />
      </div>

      {pend && (pend.fotos.length > 0 || pend.gastos.length > 0) && (
        <div style={{ background: C.redBg, border: `1px solid ${C.red}44`, borderRadius: 12, padding: 12, marginTop: 12, fontSize: 13, color: C.red }}>
          <b>Falta para concluir:</b>
          {pend.fotos.length > 0 && <div style={{ marginTop: 6 }}>📷 Foto obrigatória: {pend.fotos.map((nome) => {
            const idx = regioes.findIndex((r) => r.nome === nome)
            return <button key={nome} onClick={() => idx >= 0 && onIrRegiao(idx)} style={{ background: 'none', border: 'none', color: C.red, textDecoration: 'underline', cursor: 'pointer', fontSize: 13, padding: 0, marginRight: 8 }}>{nome}</button>
          })}</div>}
          {pend.gastos.length > 0 && <div style={{ marginTop: 6 }}>💰 Valor faltando em: {pend.gastos.join(', ')}</div>}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button onClick={onVoltar} style={btnGhost}>‹ continuar avaliando</button>
        <div style={{ flex: 1 }} />
        <button disabled={busy} onClick={() => void concluir()}
          style={{ background: busy ? C.espL : C.green, color: '#fff', border: 'none', borderRadius: 10, padding: '12px 22px', fontSize: 15, fontWeight: 700, cursor: busy ? 'wait' : 'pointer' }}>
          {busy ? 'Concluindo…' : 'CONCLUIR VISTORIA'}
        </button>
      </div>
    </div>
  )
}

function Linha({ label, valor, alerta, ok }: { label: string; valor: string; alerta?: string; ok?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', fontSize: 14 }}>
      <span style={{ color: C.espM }}>{label}</span>
      <span style={{ fontWeight: 700, color: C.esp }}>{valor} {alerta && <span style={{ color: C.amber, fontWeight: 400, fontSize: 12 }}>{alerta}</span>}{ok && <span style={{ color: C.green }}> ✅</span>}</span>
    </div>
  )
}
