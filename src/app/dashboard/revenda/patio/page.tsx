'use client'

// Revenda de Veículos · Onda 1 — pátio. Cartão por veículo com dias parados (semáforo pelas faixas
// da empresa), situação e custo acumulado. Filtro por situação, ordenação por dias. Novo veículo pelo
// chassi (placa opcional). Dias e custo são DERIVADOS (view v_veic_patio) — nunca coluna.

import { useCallback, useEffect, useMemo, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

const C = {
  esp: '#3D2314', espM: '#6B5D4F', espL: '#9C8E80', bg: '#FAF7F2', white: '#FFFFFF', cream: '#F0ECE3',
  border: '#E0D8CC', gold: '#C8941A', green: '#166534', greenBg: '#ECFDF5', amber: '#BA7517', amberBg: '#FFF6E5', red: '#B42318', redBg: '#FDECEC',
}
const inp: React.CSSProperties = { padding: '8px 10px', fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 8, background: C.white, color: C.esp, outline: 'none' }
const brl = (v: number) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const brDate = (d?: string | null) => d ? String(d).slice(0, 10).split('-').reverse().join('/') : ''
const SIT = ['em_preparacao', 'disponivel', 'reservado', 'vendido', 'entregue', 'devolvido']
// R7a-2 · mapa de calor: faixas de dias parados. A cor segue o semáforo (dia parado é sinal), a barra
// mostra o quanto de dinheiro (custo acumulado) está preso em cada faixa. Clicar filtra o pátio pela faixa.
const FAIXAS_DIAS: { label: string; min: number; max: number | null; sev: string }[] = [
  { label: '0–15 dias', min: 0, max: 15, sev: 'verde' },
  { label: '16–30 dias', min: 16, max: 30, sev: 'amarelo' },
  { label: '31–60 dias', min: 31, max: 60, sev: 'amarelo' },
  { label: '61–90 dias', min: 61, max: 90, sev: 'vermelho' },
  { label: '90+ dias', min: 91, max: null, sev: 'vermelho' },
]
// R3c · conta por veículo (fn_veic_patio_conta.itens): sangria/dia e vira-prejuízo por card.
type ItemPatio = { veiculo_id: string; sangria_dia: number | null; data_vira_prejuizo: string | null; roi_anualizado_pct: number | null }
// R3-fix T3 · piso hoje, anunciado e KM por veículo (colunas de veic_veiculo — v_veic_patio não expõe).
type Detalhe = { preco_minimo: number | null; preco_venda: number | null; km_atual: number | null; km_entrada: number | null }
const km = (v: number | null) => v != null ? `${v.toLocaleString('pt-BR')} km` : null
const semColor = (s: string) => s === 'verde' ? { c: C.green, bg: C.greenBg } : s === 'amarelo' ? { c: C.amber, bg: C.amberBg } : { c: C.red, bg: C.redBg }

type Veic = { id: string; chassi: string; placa: string | null; modelo: string | null; ano_modelo: number | null; situacao: string; dias_patio: number; custo_acumulado: number; semaforo: string; foto_url: string | null; tem_custo: boolean; fiscais_faltantes: string[] | null; sugestao_ano_chassi: number | null }

export default function PatioPage() {
  return <Suspense fallback={<div style={{ padding: 40, color: C.espM, background: C.bg, minHeight: '100vh' }}>Carregando…</div>}><Inner /></Suspense>
}

function Inner() {
  const router = useRouter()
  const sp = useSearchParams()
  const { selInfo, sel } = useCompanyIds()
  const companyId = selInfo.tipo === 'empresa' && sel ? sel : null
  const [rows, setRows] = useState<Veic[]>([])
  const [fotoUrls, setFotoUrls] = useState<Record<string, string>>({})
  // Onda 7: o painel do dono linka pra ca ja filtrado (?filtro=entregue, ?compl=sem_foto, ...).
  const [filtro, setFiltro] = useState(sp.get('filtro') || 'todos')
  const [compl, setCompl] = useState(sp.get('compl') || 'todos') // completude: todos | sem_custo | sem_dados | sem_vistoria | sem_foto | ...
  const [comVistoria, setComVistoria] = useState<Set<string>>(new Set()) // Onda 5B: ids com vistoria (não cancelada)
  const [precificados, setPrecificados] = useState<Set<string>>(new Set()) // Onda 6A: ids com preco_venda definido
  const [emPreparacao, setEmPreparacao] = useState<Set<string>>(new Set()) // Onda 9: ids com OS de preparação aberta
  const [interessados, setInteressados] = useState<Map<string, number>>(new Map()) // Onda 10: veiculo -> nº de oportunidades abertas
  const [resumoFiscal, setResumoFiscal] = useState<{ total: number; aptos: number; pendentes: number } | null>(null) // Onda 0
  const [conta, setConta] = useState<Map<string, ItemPatio>>(new Map()) // R3c: sangria/vira por veículo
  const [detalhe, setDetalhe] = useState<Map<string, Detalhe>>(new Map()) // R3-fix T3: piso/anunciado/KM
  const [ordem, setOrdem] = useState<'dias' | 'sangria' | 'vira' | 'roi'>('dias') // R3c/R7a: ordenação (+ROI)
  const [erro, setErro] = useState<string | null>(null)
  const [novo, setNovo] = useState(false)
  // R7a (T3): busca por modelo/placa, filtro PS por sinal, e modo lista densa (mobile).
  const [busca, setBusca] = useState('')
  const [filtroPS, setFiltroPS] = useState<'todos' | 'vira_prejuizo' | 'abaixo_piso' | 'sem_custo' | 'sem_nota' | 'roi_negativo'>('todos')
  const [densa, setDensa] = useState(false)
  // R7a-2 · no celular o pátio abre em Lista (cards ocupam demais). Só define no mount.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches) setDensa(true) }, [])
  // R7a-2 · faixa de dias escolhida no mapa de calor (clique). null = sem filtro de faixa.
  const [faixaDias, setFaixaDias] = useState<{ min: number; max: number | null; label: string } | null>(null)
  // R7a-2 · ações em massa: seleção de carros + modal de reprecificação em lote (com prévia da R2).
  const [selVeic, setSelVeic] = useState<Set<string>>(new Set())
  const [loteAberto, setLoteAberto] = useState(false)
  const toggleSel = (id: string) => setSelVeic((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  const carregar = useCallback(async () => {
    if (!companyId) { setRows([]); return }
    const { data, error } = await supabase.from('v_veic_patio').select('*').eq('company_id', companyId).order('dias_patio', { ascending: false })
    if (error) { setErro(error.message); return }
    const lista = (data as Veic[]) ?? []
    setRows(lista)
    // foto_url guarda o storage_path da principal (bucket privado) — assina para exibir.
    // Legado eventual em URL pública (http) passa direto.
    const paths = lista.map((r) => r.foto_url).filter((u): u is string => !!u && !u.startsWith('http'))
    if (paths.length) {
      const { data: signed } = await supabase.storage.from('revenda-veiculos').createSignedUrls(paths, 3600)
      const m: Record<string, string> = {}
      ;(signed ?? []).forEach((s) => { if (s.signedUrl && s.path) m[s.path] = s.signedUrl })
      setFotoUrls(m)
    } else setFotoUrls({})
    // Onda 5B: quais veículos já têm vistoria (badge "sem vistoria" nos demais)
    const { data: vst } = await supabase.from('insp_vistoria').select('alvo_id').eq('company_id', companyId).eq('alvo_tabela', 'veic_veiculo').neq('situacao', 'cancelada')
    setComVistoria(new Set(((vst as { alvo_id: string }[]) ?? []).map((x) => x.alvo_id)))
    // Onda 6A: quais já têm preço de venda (badge "não precificado" nos demais)
    const { data: prc } = await supabase.from('veic_veiculo').select('id').eq('company_id', companyId).is('deleted_at', null).not('preco_venda', 'is', null)
    setPrecificados(new Set(((prc as { id: string }[]) ?? []).map((x) => x.id)))
    // Onda 0: resumo de completude fiscal (contador "X de Y prontos para nota")
    const { data: rf } = await supabase.rpc('fn_veic_completude_resumo', { p_company_id: companyId })
    const rr = rf as { ok?: boolean; total?: number; aptos?: number; pendentes?: number } | null
    setResumoFiscal(rr?.ok ? { total: rr.total ?? 0, aptos: rr.aptos ?? 0, pendentes: rr.pendentes ?? 0 } : null)
    // Onda 9: veículos com OS de preparação AINDA aberta (badge "em preparação" + trava do anúncio na Onda 13)
    const { data: prep } = await supabase.rpc('fn_veic_preparacao_listar', { p_company_id: companyId, p_veiculo_id: null })
    const pl = prep as { ok?: boolean; os?: { veiculo_id: string; concluida: boolean }[] } | null
    setEmPreparacao(new Set((pl?.ok ? (pl.os ?? []) : []).filter((o) => !o.concluida).map((o) => o.veiculo_id)))
    // Onda 10: nº de interessados (oportunidades abertas) por veículo — carro parado com muitos interessados é sinal de preço
    const { data: ops } = await supabase.from('erp_crm_oportunidade').select('veic_interesse_id').eq('company_id', companyId).is('deleted_at', null).not('veic_interesse_id', 'is', null).not('etapa', 'in', '(ganho,perdido)')
    const mp = new Map<string, number>()
    ;((ops as { veic_interesse_id: string }[]) ?? []).forEach((o) => mp.set(o.veic_interesse_id, (mp.get(o.veic_interesse_id) ?? 0) + 1))
    setInteressados(mp)
    // R3c: a conta do pátio (sangria/dia + vira-prejuízo por veículo) — fonte única fn_veic_patio_conta
    const { data: pc } = await supabase.rpc('fn_veic_patio_conta', { p_company_id: companyId })
    const pcr = pc as { ok?: boolean; itens?: ItemPatio[] } | null
    const cm = new Map<string, ItemPatio>()
    ;(pcr?.ok ? (pcr.itens ?? []) : []).forEach((it) => { if (it.veiculo_id) cm.set(it.veiculo_id, it) })
    setConta(cm)
    // R3-fix T3: piso hoje (preco_minimo), anunciado (preco_venda) e KM — colunas de veic_veiculo
    const { data: det } = await supabase.from('veic_veiculo').select('id, preco_minimo, preco_venda, km_atual, km_entrada').eq('company_id', companyId).is('deleted_at', null)
    const dm = new Map<string, Detalhe>()
    ;((det as ({ id: string } & Detalhe)[]) ?? []).forEach((d) => dm.set(d.id, { preco_minimo: d.preco_minimo, preco_venda: d.preco_venda, km_atual: d.km_atual, km_entrada: d.km_entrada }))
    setDetalhe(dm)
  }, [companyId])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase()
    // R7a · filtro PS por sinal (sobre a fonte única: conta do pátio + piso/anunciado por veículo).
    const passaPS = (r: Veic) => {
      if (filtroPS === 'todos') return true
      if (filtroPS === 'sem_custo') return !r.tem_custo
      if (filtroPS === 'sem_nota') return (r.fiscais_faltantes?.length ?? 0) > 0
      const d = detalhe.get(r.id); const it = conta.get(r.id)
      if (filtroPS === 'abaixo_piso') return d?.preco_venda != null && d?.preco_minimo != null && d.preco_venda < d.preco_minimo
      if (filtroPS === 'vira_prejuizo') return !!it?.data_vira_prejuizo
      if (filtroPS === 'roi_negativo') return it?.roi_anualizado_pct != null && it.roi_anualizado_pct < 0
      return true
    }
    const filtrados = rows.filter((r) =>
      (filtro === 'todos' || r.situacao === filtro) &&
      (compl === 'todos'
        || (compl === 'sem_custo' && !r.tem_custo)
        || (compl === 'sem_dados' && (r.fiscais_faltantes?.length ?? 0) > 0)
        || (compl === 'sem_vistoria' && !comVistoria.has(r.id))
        || (compl === 'sem_foto' && !r.foto_url)
        || (compl === 'nao_precificado' && !precificados.has(r.id))
        || (compl === 'pronto_nota' && (r.fiscais_faltantes?.length ?? 0) === 0)
        || (compl === 'em_preparacao_os' && emPreparacao.has(r.id))
        || (compl === 'faltam_nota' && (r.fiscais_faltantes?.length ?? 0) > 0)) &&
      passaPS(r) &&
      // R7a-2 · faixa de dias do mapa de calor
      (faixaDias === null || (r.dias_patio >= faixaDias.min && (faixaDias.max === null || r.dias_patio <= faixaDias.max))) &&
      // R7a · busca por modelo/placa (também casa marca embutida no modelo e o fim do chassi).
      (q === '' || (r.modelo ?? '').toLowerCase().includes(q) || (r.placa ?? '').toLowerCase().includes(q) || r.chassi.toLowerCase().includes(q)))
    // R3c/R7a: ordenação por maior sangria, vira-prejuízo mais próximo, ou pior ROI (senão dias, ordem da view)
    if (ordem === 'sangria') {
      return [...filtrados].sort((a, b) => (conta.get(b.id)?.sangria_dia ?? -1) - (conta.get(a.id)?.sangria_dia ?? -1))
    }
    if (ordem === 'vira') {
      const t = (id: string) => { const d = conta.get(id)?.data_vira_prejuizo; return d ? new Date(d + 'T00:00:00').getTime() : Number.POSITIVE_INFINITY }
      return [...filtrados].sort((a, b) => t(a.id) - t(b.id))
    }
    if (ordem === 'roi') {
      const roi = (id: string) => conta.get(id)?.roi_anualizado_pct ?? Number.POSITIVE_INFINITY // pior ROI primeiro; sem ROI ao fim
      return [...filtrados].sort((a, b) => roi(a.id) - roi(b.id))
    }
    return filtrados
  }, [rows, filtro, compl, comVistoria, precificados, emPreparacao, ordem, conta, detalhe, busca, filtroPS, faixaDias])
  // R7a-2 · mapa de calor: por faixa de dias parados, quantos carros e quanto dinheiro (custo acumulado)
  // está preso. Fonte: as próprias linhas do pátio (dias_patio + custo_acumulado). Sem query nova.
  const heat = useMemo(() => FAIXAS_DIAS.map((f) => {
    const na = rows.filter((r) => r.dias_patio >= f.min && (f.max === null || r.dias_patio <= f.max))
    return { ...f, count: na.length, dinheiro: na.reduce((s, r) => s + (r.custo_acumulado || 0), 0) }
  }), [rows])
  const maxDinheiro = useMemo(() => Math.max(1, ...heat.map((h) => h.dinheiro)), [heat])
  const nSemCusto = useMemo(() => rows.filter((r) => !r.tem_custo).length, [rows])
  const nSemDados = useMemo(() => rows.filter((r) => (r.fiscais_faltantes?.length ?? 0) > 0).length, [rows])
  const nSemVistoria = useMemo(() => rows.filter((r) => !comVistoria.has(r.id)).length, [rows, comVistoria])
  const nSemFoto = useMemo(() => rows.filter((r) => !r.foto_url).length, [rows])
  const nNaoPrecificado = useMemo(() => rows.filter((r) => !precificados.has(r.id)).length, [rows, precificados])
  const nEmPreparacao = useMemo(() => rows.filter((r) => emPreparacao.has(r.id)).length, [rows, emPreparacao])

  if (!companyId) return <div style={{ padding: 28, color: C.espM, background: C.bg, minHeight: '100vh' }}>Selecione uma empresa específica no topo.</div>

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '22px 16px 48px', maxWidth: 1120, margin: '0 auto', color: C.esp }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: C.gold, fontWeight: 700 }}>🚗 Comércio · Revenda</div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: '2px 0 0' }}>Pátio de veículos</h1>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {(nSemDados > 0 || nSemCusto > 0) && (
            <a href="/dashboard/revenda/completar" style={{ padding: '9px 14px', border: `1px solid ${C.gold}`, borderRadius: 8, background: C.white, color: C.gold, fontWeight: 700, textDecoration: 'none', fontSize: 13 }}>
              🧩 Completar dados{nSemDados ? ` (${nSemDados})` : ''}
            </a>
          )}
          <a href="/dashboard/revenda/demanda" style={{ padding: '9px 14px', border: `1px solid ${C.border}`, borderRadius: 8, background: C.white, color: C.esp, fontWeight: 700, textDecoration: 'none', fontSize: 13 }}>
            🏆 O que comprar
          </a>
          <a href="/dashboard/revenda/preparacao" style={{ padding: '9px 14px', border: `1px solid ${C.border}`, borderRadius: 8, background: C.white, color: C.esp, fontWeight: 700, textDecoration: 'none', fontSize: 13 }}>
            🔧 Preparação{nEmPreparacao ? ` (${nEmPreparacao})` : ''}
          </a>
          <a href="/dashboard/revenda/relatorios" style={{ padding: '9px 14px', border: `1px solid ${C.border}`, borderRadius: 8, background: C.white, color: C.esp, fontWeight: 700, textDecoration: 'none', fontSize: 13 }}>
            📊 Relatórios
          </a>
          <a href="/dashboard/revenda/garantia" style={{ padding: '9px 14px', border: `1px solid ${C.border}`, borderRadius: 8, background: C.white, color: C.esp, fontWeight: 700, textDecoration: 'none', fontSize: 13 }}>
            🛡️ Garantia
          </a>
          <button onClick={() => setNovo(true)} style={{ padding: '9px 16px', border: 'none', borderRadius: 8, background: C.gold, color: C.white, fontWeight: 700, cursor: 'pointer' }}>+ Novo veículo</button>
        </div>
      </div>
      <p style={{ color: C.espM, fontSize: 13, margin: '6px 0 14px' }}>Dias parados e custo acumulado são calculados na hora — nunca gravados. Semáforo pelas faixas da empresa.</p>

      {erro && <div style={{ background: C.redBg, color: C.red, padding: '9px 13px', borderRadius: 8, fontSize: 13, marginBottom: 12 }} onClick={() => setErro(null)}>{erro}</div>}

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ fontSize: 12, color: C.espM }}>Situação&nbsp;
          <select value={filtro} onChange={(e) => setFiltro(e.target.value)} style={inp}>
            <option value="todos">todas</option>
            {SIT.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 12, color: C.espM }}>Completude&nbsp;
          <select value={compl} onChange={(e) => setCompl(e.target.value)} style={inp}>
            <option value="todos">todas</option>
            <option value="sem_custo">sem custo de aquisição{nSemCusto ? ` (${nSemCusto})` : ''}</option>
            <option value="sem_dados">sem dados do veículo{nSemDados ? ` (${nSemDados})` : ''}</option>
            <option value="sem_vistoria">sem vistoria{nSemVistoria ? ` (${nSemVistoria})` : ''}</option>
            <option value="sem_foto">sem foto{nSemFoto ? ` (${nSemFoto})` : ''}</option>
            <option value="nao_precificado">não precificado{nNaoPrecificado ? ` (${nNaoPrecificado})` : ''}</option>
            <option value="em_preparacao_os">em preparação (OS aberta){nEmPreparacao ? ` (${nEmPreparacao})` : ''}</option>
            <option value="pronto_nota">pronto para nota{resumoFiscal ? ` (${resumoFiscal.aptos})` : ''}</option>
            <option value="faltam_nota">faltam campos p/ nota{resumoFiscal ? ` (${resumoFiscal.pendentes})` : ''}</option>
          </select>
        </label>
        <label style={{ fontSize: 12, color: C.espM }}>Ordenar&nbsp;
          <select value={ordem} onChange={(e) => setOrdem(e.target.value as 'dias' | 'sangria' | 'vira' | 'roi')} style={inp}>
            <option value="dias">dias parados</option>
            <option value="sangria">maior sangria</option>
            <option value="vira">vira prejuízo antes</option>
            <option value="roi">pior ROI</option>
          </select>
        </label>
        {/* R7a · filtro PS por sinal (o que o dono quer caçar no pátio) */}
        <label style={{ fontSize: 12, color: C.espM }}>Sinal&nbsp;
          <select value={filtroPS} onChange={(e) => setFiltroPS(e.target.value as typeof filtroPS)} style={inp}>
            <option value="todos">todos</option>
            <option value="vira_prejuizo">vai virar prejuízo</option>
            <option value="abaixo_piso">anunciado abaixo do piso</option>
            <option value="roi_negativo">ROI negativo</option>
            <option value="sem_custo">sem custo de aquisição</option>
            <option value="sem_nota">sem dados p/ nota</option>
          </select>
        </label>
        {/* R7a · busca por modelo/placa */}
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="buscar modelo/placa" style={{ ...inp, width: 170 }} />
        {/* R7a-2 · controle segmentado Lista | Cards (comunica a alternância; no celular abre em Lista) */}
        <div style={{ display: 'inline-flex', border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
          <button onClick={() => setDensa(true)} title="lista densa — uma linha por carro"
            style={{ padding: '8px 12px', fontSize: 12.5, fontWeight: 700, border: 'none', cursor: 'pointer', background: densa ? C.gold : C.white, color: densa ? C.white : C.espM }}>☰ Lista</button>
          <button onClick={() => setDensa(false)} title="cards com foto"
            style={{ padding: '8px 12px', fontSize: 12.5, fontWeight: 700, border: 'none', borderLeft: `1px solid ${C.border}`, cursor: 'pointer', background: !densa ? C.gold : C.white, color: !densa ? C.white : C.espM }}>▦ Cards</button>
        </div>
        <span style={{ fontSize: 12, color: C.espM }}>{visiveis.length} veículo(s)</span>
      </div>

      {/* Onda 0: contador de completude fiscal (toque aplica o filtro dos pendentes) */}
      {resumoFiscal && resumoFiscal.total > 0 && (
        <button onClick={() => setCompl(compl === 'faltam_nota' ? 'todos' : 'faltam_nota')}
          style={{ display: 'block', width: '100%', textAlign: 'left', background: resumoFiscal.pendentes > 0 ? C.amberBg : C.greenBg, border: `1px solid ${resumoFiscal.pendentes > 0 ? C.amber : C.green}55`, borderRadius: 10, padding: '9px 12px', marginBottom: 12, cursor: 'pointer', fontSize: 13, color: resumoFiscal.pendentes > 0 ? '#8A4B08' : C.green }}>
          <b>{resumoFiscal.aptos} de {resumoFiscal.total}</b> prontos para emitir nota{resumoFiscal.pendentes > 0 ? ` · toque para ver os ${resumoFiscal.pendentes} pendentes` : ' ✅'}
        </button>
      )}

      {/* R7a-2 · mapa de calor: dias parados × dinheiro parado. Clique numa faixa filtra o pátio. */}
      {rows.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: C.espM, fontWeight: 700, marginBottom: 6 }}>
            Onde o dinheiro está parado <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>· por tempo no pátio</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
            {heat.map((h) => {
              const sc = semColor(h.sev)
              const ativo = faixaDias?.label === h.label
              const share = h.dinheiro / maxDinheiro
              return (
                <button key={h.label}
                  onClick={() => setFaixaDias(ativo ? null : { min: h.min, max: h.max, label: h.label })}
                  title={h.count ? `${h.count} veículo(s) · ${brl(h.dinheiro)} em custo acumulado — clique para filtrar` : 'sem veículos nesta faixa'}
                  style={{ textAlign: 'left', cursor: h.count ? 'pointer' : 'default', background: C.white, border: `1px solid ${ativo ? sc.c : C.border}`, boxShadow: ativo ? `0 0 0 2px ${sc.c}33` : 'none', borderRadius: 10, padding: '10px 12px', opacity: h.count ? 1 : 0.55 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: C.esp }}>{h.label}</span>
                    <span style={{ fontSize: 10.5, padding: '1px 7px', borderRadius: 999, background: sc.bg, color: sc.c, fontWeight: 700 }}>{h.count}</span>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.esp, marginTop: 4 }}>{brl(h.dinheiro)}</div>
                  {/* barra: participação do dinheiro parado nesta faixa (cor do semáforo da faixa) */}
                  <div style={{ height: 6, borderRadius: 999, background: C.cream, marginTop: 6, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${Math.round(share * 100)}%`, background: sc.c, borderRadius: 999 }} />
                  </div>
                </button>
              )
            })}
          </div>
          {faixaDias && (
            <div style={{ marginTop: 6, fontSize: 12, color: C.espM }}>
              Filtrando <b style={{ color: C.esp }}>{faixaDias.label}</b> ·{' '}
              <button onClick={() => setFaixaDias(null)} style={{ border: 'none', background: 'none', color: C.gold, cursor: 'pointer', fontWeight: 700, padding: 0 }}>limpar</button>
            </div>
          )}
        </div>
      )}

      {visiveis.length === 0 ? (
        <div style={{ background: C.white, border: `1px dashed ${C.border}`, borderRadius: 12, padding: '30px 16px', textAlign: 'center', color: C.espM }}>Nenhum veículo no pátio{faixaDias ? ` na faixa ${faixaDias.label}` : ''}. {faixaDias ? '' : 'Cadastre o primeiro.'}</div>
      ) : densa ? (
        /* R7a · modo lista densa — uma linha por carro, boa no celular e em pátios grandes */
        <div style={{ display: 'grid', gap: 6 }}>
          {visiveis.map((v) => {
            const sc = semColor(v.semaforo)
            const d = detalhe.get(v.id); const it = conta.get(v.id)
            const kmv = km(d?.km_atual ?? d?.km_entrada ?? null)
            const abaixo = d?.preco_venda != null && d?.preco_minimo != null && d.preco_venda < d.preco_minimo
            return (
              <div key={v.id} onClick={() => router.push(`/dashboard/revenda/veiculo/${v.id}`)}
                style={{ background: selVeic.has(v.id) ? '#FDF7E8' : C.white, border: `1px solid ${selVeic.has(v.id) ? C.gold : C.border}`, borderRadius: 10, padding: '8px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <input type="checkbox" checked={selVeic.has(v.id)} onClick={(e) => e.stopPropagation()} onChange={() => toggleSel(v.id)} title="selecionar para ações em massa" style={{ width: 16, height: 16, accentColor: C.gold, cursor: 'pointer', flexShrink: 0 }} />
                <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: sc.bg, color: sc.c, fontWeight: 700, whiteSpace: 'nowrap' }}>● {v.dias_patio}d</span>
                <div style={{ minWidth: 0, flex: '1 1 160px' }}>
                  <div style={{ fontWeight: 700, fontSize: 13.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.modelo || '—'}{v.ano_modelo ? ` · ${v.ano_modelo}` : ''}</div>
                  <div style={{ fontSize: 11, color: C.espM, fontFamily: 'monospace' }}>{v.placa || 'sem placa'}{kmv ? ` · ${kmv}` : ''}</div>
                </div>
                <span style={{ fontSize: 11.5, color: C.espM, whiteSpace: 'nowrap' }}>piso <b style={{ color: C.esp }}>{d?.preco_minimo != null ? brl(d.preco_minimo) : '—'}</b></span>
                <span style={{ fontSize: 11.5, whiteSpace: 'nowrap', color: abaixo ? C.red : C.espM }}>anunc. <b style={{ color: abaixo ? C.red : (d?.preco_venda != null ? C.gold : C.espL) }}>{d?.preco_venda != null ? brl(d.preco_venda) : 'sem preço'}</b></span>
                {it?.data_vira_prejuizo && <span style={{ fontSize: 11, color: C.amber, fontWeight: 700, whiteSpace: 'nowrap' }}>🟡 vira {brDate(it.data_vira_prejuizo)}</span>}
                {!v.tem_custo && <span style={{ fontSize: 10.5, padding: '2px 7px', borderRadius: 999, background: '#FAEEDA', color: '#8A4B08', fontWeight: 600 }}>sem custo</span>}
                {(v.fiscais_faltantes?.length ?? 0) > 0 && <span style={{ fontSize: 10.5, padding: '2px 7px', borderRadius: 999, background: C.amberBg, color: C.amber, fontWeight: 700 }}>faltam {v.fiscais_faltantes!.length}</span>}
                <span style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 999, background: C.cream, color: C.espM, whiteSpace: 'nowrap' }}>{v.situacao.replace('_', ' ')}</span>
              </div>
            )
          })}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
          {visiveis.map((v) => {
            const sc = semColor(v.semaforo)
            return (
              <div key={v.id} onClick={() => router.push(`/dashboard/revenda/veiculo/${v.id}`)}
                style={{ background: C.white, border: `1px solid ${selVeic.has(v.id) ? C.gold : C.border}`, boxShadow: selVeic.has(v.id) ? `0 0 0 2px ${C.gold}33` : 'none', borderRadius: 12, overflow: 'hidden', cursor: 'pointer', position: 'relative' }}>
                <label onClick={(e) => e.stopPropagation()} title="selecionar para ações em massa"
                  style={{ position: 'absolute', top: 6, left: 6, zIndex: 1, background: 'rgba(255,255,255,0.92)', borderRadius: 6, padding: '2px 4px', display: 'inline-flex', cursor: 'pointer' }}>
                  <input type="checkbox" checked={selVeic.has(v.id)} onChange={() => toggleSel(v.id)} style={{ width: 16, height: 16, accentColor: C.gold, cursor: 'pointer' }} />
                </label>
                <div style={{ height: 110, background: C.cream, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.espL, fontSize: 12 }}>
                  {(() => {
                    const src = v.foto_url ? (v.foto_url.startsWith('http') ? v.foto_url : fotoUrls[v.foto_url]) : null
                    // eslint-disable-next-line @next/next/no-img-element
                    return src ? <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '📷 sem foto'
                  })()}
                </div>
                <div style={{ padding: 12 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{v.modelo || '—'} {v.ano_modelo ? `· ${v.ano_modelo}` : ''}</div>
                  <div style={{ fontSize: 12, color: C.espM, fontFamily: 'monospace' }}>{v.placa || 'sem placa'} · {v.chassi.slice(-6)}{(() => { const k = km(detalhe.get(v.id)?.km_atual ?? detalhe.get(v.id)?.km_entrada ?? null); return k ? ` · ${k}` : '' })()}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
                    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: sc.bg, color: sc.c, fontWeight: 700 }}>● {v.dias_patio} dia(s)</span>
                    <span style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 999, background: C.cream, color: C.espM }}>{v.situacao.replace('_', ' ')}</span>
                    {emPreparacao.has(v.id) && <span style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 999, background: C.amberBg, color: C.amber, fontWeight: 700 }} title="Veículo com OS de preparação aberta — não deve ir ao anúncio até concluir">🔧 em preparação</span>}
                    {!comVistoria.has(v.id) && <span style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 999, background: C.amberBg, color: C.amber, fontWeight: 700 }}>sem vistoria</span>}
                    {!precificados.has(v.id) && <span style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 999, background: C.amberBg, color: C.amber, fontWeight: 700 }}>não precificado</span>}
                    {(interessados.get(v.id) ?? 0) > 0 && <span style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 999, background: '#FDF7E8', color: C.gold, fontWeight: 700 }} title="Oportunidades abertas com este carro. Muitos interessados + parado há tempo = sinal de preço.">❤ {interessados.get(v.id)} interessado{(interessados.get(v.id) ?? 0) > 1 ? 's' : ''}</span>}
                    {/* Onda 0: badge fiscal — pronto para nota (verde) ou faltam N campos (âmbar) */}
                    {(v.fiscais_faltantes?.length ?? 0) === 0
                      ? <span style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 999, background: C.greenBg, color: C.green, fontWeight: 700 }}>pronto para nota</span>
                      : <span style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 999, background: C.amberBg, color: C.amber, fontWeight: 700 }}>faltam {v.fiscais_faltantes!.length} campos</span>}
                  </div>
                  {/* Selo 1 · custo (margem). Selo 2 · dados do veículo — nomeia o que falta,
                      NUNCA afirma "não emite" (veicProd é do 0km; usado é decisão do contador). */}
                  {v.tem_custo
                    ? <div style={{ marginTop: 8, fontSize: 12, color: C.espM }}>custo acumulado <b style={{ color: C.esp }}>{brl(v.custo_acumulado)}</b></div>
                    : <div style={{ marginTop: 8, fontSize: 11, color: '#8A4B08', background: '#FAEEDA', borderRadius: 6, padding: '4px 8px', fontWeight: 600 }}>⚠️ sem custo de aquisição — margem não calcula</div>}
                  {/* R3-fix T3: piso hoje (preço mínimo) e anunciado no card */}
                  {(() => {
                    const d = detalhe.get(v.id); if (!d) return null
                    return (
                      <div style={{ marginTop: 4, display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 11.5 }}>
                        <span style={{ color: C.espM }}>piso hoje <b style={{ color: C.esp }}>{d.preco_minimo != null ? brl(d.preco_minimo) : '—'}</b></span>
                        <span style={{ color: C.espM }}>anunciado <b style={{ color: d.preco_venda != null ? C.gold : C.espL }}>{d.preco_venda != null ? brl(d.preco_venda) : 'sem preço'}</b></span>
                      </div>
                    )
                  })()}
                  {/* R3c · sangria/dia e vira-prejuízo (semáforo real: vermelho só quando ≤ 15 dias) */}
                  {(() => {
                    const it = conta.get(v.id); if (!it) return null
                    const dv = it.data_vira_prejuizo ? new Date(it.data_vira_prejuizo + 'T00:00:00') : null
                    const dias = dv ? Math.round((dv.getTime() - Date.now()) / 86400000) : null
                    const urgente = dias != null && dias <= 15
                    return (
                      <div style={{ marginTop: 6, display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 11.5 }}>
                        {it.sangria_dia != null && <span style={{ color: C.espM }}>sangria <b style={{ color: C.esp }}>{brl(it.sangria_dia)}/dia</b></span>}
                        {dv && <span style={{ color: urgente ? C.red : C.amber, fontWeight: 700 }}>{urgente ? '🔴' : '🟡'} vira em {brDate(it.data_vira_prejuizo)}</span>}
                      </div>
                    )
                  })()}
                  {(v.fiscais_faltantes?.length ?? 0) > 0 && (
                    <div style={{ marginTop: 6, fontSize: 10.5, color: C.gold, background: C.cream, borderRadius: 6, padding: '4px 8px', lineHeight: 1.35 }}
                      title="Necessário para veículo novo; para usado, a confirmar com o contador">
                      🚙 faltam dados do veículo: {v.fiscais_faltantes!.join(', ')}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* R7a-2 · barra de ações em massa — aparece quando há carros selecionados */}
      {selVeic.size > 0 && (
        <div style={{ position: 'fixed', left: '50%', bottom: 18, transform: 'translateX(-50%)', zIndex: 60, background: C.esp, color: C.white, borderRadius: 999, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 14, boxShadow: '0 8px 24px rgba(0,0,0,0.25)', flexWrap: 'wrap', maxWidth: 'calc(100vw - 24px)' }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>{selVeic.size} selecionado{selVeic.size > 1 ? 's' : ''}</span>
          <button onClick={() => setLoteAberto(true)} style={{ border: 'none', borderRadius: 999, background: C.gold, color: C.white, fontWeight: 700, padding: '7px 14px', cursor: 'pointer', fontSize: 12.5 }}>Reprecificar em lote</button>
          <button onClick={() => setSelVeic(new Set())} style={{ border: 'none', background: 'none', color: '#E9DFD2', cursor: 'pointer', fontSize: 12.5, textDecoration: 'underline' }}>limpar</button>
        </div>
      )}

      {loteAberto && companyId && (
        <LoteModal companyId={companyId} ids={Array.from(selVeic)} onClose={() => setLoteAberto(false)}
          onAplicado={() => { setLoteAberto(false); setSelVeic(new Set()); void carregar() }} onErro={setErro} />
      )}

      {novo && <NovoVeiculo companyId={companyId} onClose={() => setNovo(false)} onSaved={(id) => { setNovo(false); if (id) router.push(`/dashboard/revenda/veiculo/${id}`); else void carregar() }} onErro={setErro} />}
    </div>
  )
}

// R7a-2 · reprecificação em LOTE com prévia da R2 (fn_veic_precificacao_lote). Modo preço fixo ou ajuste %;
// pré-visualiza por carro (piso, preço novo, abaixo-do-piso) antes de confirmar. Histórico por carro sai
// de graça (o aplicar grava veic_precificacao_hist). Paleta PS.
type LoteResultado = {
  veiculo_id: string; modelo: string | null; preco_atual: number | null; preco_novo: number | null
  piso: number | null; abaixo_do_piso: boolean; comissao_nao_configurada: boolean; erro: string | null
}
function LoteModal({ companyId, ids, onClose, onAplicado, onErro }: { companyId: string; ids: string[]; onClose: () => void; onAplicado: () => void; onErro: (m: string) => void }) {
  const [modo, setModo] = useState<'ajuste_pct' | 'preco'>('ajuste_pct')
  const [valor, setValor] = useState('')
  const [prev, setPrev] = useState<LoteResultado[] | null>(null)
  const [busy, setBusy] = useState(false)

  const valorNum = Number(String(valor).replace(',', '.'))
  const valorOk = valor.trim() !== '' && Number.isFinite(valorNum) && (modo === 'preco' ? valorNum > 0 : valorNum !== 0)

  async function chamar(aplicar: boolean): Promise<LoteResultado[] | null> {
    const { data, error } = await supabase.rpc('fn_veic_precificacao_lote', {
      p_company_id: companyId, p_veiculo_ids: ids, p_modo: modo, p_valor: valorNum, p_aplicar: aplicar, p_user: null,
    })
    const r = data as { ok?: boolean; erro?: string; resultados?: LoteResultado[] } | null
    if (error || !r?.ok) { onErro(error?.message || r?.erro || 'Falha na reprecificação em lote'); return null }
    return r.resultados ?? []
  }
  async function previsualizar() { if (!valorOk) return; setBusy(true); const r = await chamar(false); setBusy(false); if (r) setPrev(r) }
  async function aplicar() { if (!valorOk) return; setBusy(true); const r = await chamar(true); setBusy(false); if (r) onAplicado() }

  const nAbaixo = (prev ?? []).filter((r) => r.abaixo_do_piso).length

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.white, borderRadius: 12, padding: 18, width: 'min(680px,100%)', maxHeight: '92vh', overflowY: 'auto' }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 2 }}>Reprecificar {ids.length} veículo{ids.length > 1 ? 's' : ''}</div>
        <p style={{ fontSize: 12, color: C.espM, margin: '0 0 12px' }}>Veja a prévia (piso, preço novo e quem fica abaixo do piso) antes de aplicar. O histórico de cada carro é registrado.</p>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
          <select value={modo} onChange={(e) => { setModo(e.target.value as typeof modo); setPrev(null) }} style={inp}>
            <option value="ajuste_pct">reajuste % sobre o anunciado</option>
            <option value="preco">novo preço fixo (R$)</option>
          </select>
          <input value={valor} onChange={(e) => { setValor(e.target.value); setPrev(null) }} inputMode="decimal"
            placeholder={modo === 'preco' ? 'novo preço (R$)' : 'ex.: -10 (baixar 10%)'} style={{ ...inp, width: 170 }} />
          <button disabled={!valorOk || busy} onClick={() => void previsualizar()}
            style={{ padding: '8px 14px', border: `1px solid ${C.gold}`, borderRadius: 8, background: C.white, color: C.gold, fontWeight: 700, cursor: valorOk && !busy ? 'pointer' : 'not-allowed' }}>
            {busy && prev === null ? 'Calculando…' : 'Pré-visualizar'}
          </button>
        </div>

        {prev && (
          <>
            {nAbaixo > 0 && (
              <div style={{ background: C.redBg, color: C.red, borderRadius: 8, padding: '8px 11px', fontSize: 12.5, marginBottom: 8 }}>
                ⚠️ {nAbaixo} carro{nAbaixo > 1 ? 's ficam' : ' fica'} <b>abaixo do piso</b> com esse valor.
              </div>
            )}
            <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden', marginBottom: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 92px 92px 92px', gap: 0, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.3, color: C.espM, background: C.cream, padding: '6px 10px' }}>
                <span>veículo</span><span style={{ textAlign: 'right' }}>atual</span><span style={{ textAlign: 'right' }}>novo</span><span style={{ textAlign: 'right' }}>piso</span>
              </div>
              <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                {prev.map((r) => (
                  <div key={r.veiculo_id} style={{ display: 'grid', gridTemplateColumns: '1fr 92px 92px 92px', gap: 0, fontSize: 12, padding: '6px 10px', borderTop: `1px solid ${C.cream}`, alignItems: 'center', background: r.abaixo_do_piso ? C.redBg : C.white }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.modelo || '—'}{r.erro ? <span style={{ color: C.red }}> · {r.erro === 'sem_preco_atual' ? 'sem preço atual' : r.erro}</span> : ''}</span>
                    <span style={{ textAlign: 'right', color: C.espM }}>{r.preco_atual != null ? brl(r.preco_atual) : '—'}</span>
                    <span style={{ textAlign: 'right', fontWeight: 700, color: r.abaixo_do_piso ? C.red : C.esp }}>{r.preco_novo != null ? brl(r.preco_novo) : '—'}</span>
                    <span style={{ textAlign: 'right', color: C.espM }}>{r.piso != null ? brl(r.piso) : '—'}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '8px 14px', border: `1px solid ${C.border}`, borderRadius: 8, background: C.white, color: C.espM, cursor: 'pointer' }}>Cancelar</button>
          <button disabled={!prev || busy} onClick={() => void aplicar()}
            style={{ padding: '8px 16px', border: 'none', borderRadius: 8, background: (!prev || busy) ? C.espL : C.gold, color: C.white, fontWeight: 700, cursor: (!prev || busy) ? 'not-allowed' : 'pointer' }}>
            {busy && prev ? 'Aplicando…' : `Aplicar a ${ids.length}`}
          </button>
        </div>
      </div>
    </div>
  )
}

function NovoVeiculo({ companyId, onClose, onSaved, onErro }: { companyId: string; onClose: () => void; onSaved: (id?: string) => void; onErro: (m: string) => void }) {
  const [f, setF] = useState({ chassi: '', placa: '', marca: '', modelo: '', ano_modelo: '', cor: '', origem: 'compra_pf', valor_aquisicao: '' })
  const [busy, setBusy] = useState(false)
  async function salvar() {
    setBusy(true)
    const { data: { session } } = await supabase.auth.getSession(); const user = session?.user
    const { data, error } = await supabase.rpc('fn_veic_criar', {
      p_company_id: companyId,
      p_veiculo: { chassi: f.chassi.trim(), placa: f.placa.trim() || null, marca: f.marca.trim() || null, modelo: f.modelo.trim() || null, ano_modelo: f.ano_modelo ? Number(f.ano_modelo) : null, cor: f.cor.trim() || null, origem: f.origem, valor_aquisicao: f.valor_aquisicao ? Number(f.valor_aquisicao) : null },
      p_user: user?.id ?? null,
    })
    setBusy(false)
    const r = data as { ok?: boolean; erro?: string; id?: string } | null
    if (error || !r?.ok) { onErro(r?.erro === 'chassi_ja_cadastrado' ? 'Chassi já cadastrado nesta empresa.' : r?.erro === 'chassi_obrigatorio' ? 'Chassi é obrigatório.' : (error?.message || 'Falha ao salvar')); return }
    onSaved(r.id)
  }
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.white, borderRadius: 12, padding: 18, width: 'min(520px,100%)' }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>Novo veículo</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <input value={f.chassi} onChange={(e) => setF({ ...f, chassi: e.target.value })} placeholder="chassi (obrigatório)" style={{ ...inp, gridColumn: '1 / -1' }} />
          <input value={f.placa} onChange={(e) => setF({ ...f, placa: e.target.value })} placeholder="placa (opcional — carro sem placa existe)" style={inp} />
          <input value={f.marca} onChange={(e) => setF({ ...f, marca: e.target.value })} placeholder="marca" style={inp} />
          <input value={f.modelo} onChange={(e) => setF({ ...f, modelo: e.target.value })} placeholder="modelo" style={inp} />
          <input value={f.ano_modelo} onChange={(e) => setF({ ...f, ano_modelo: e.target.value })} placeholder="ano modelo" style={inp} />
          <input value={f.cor} onChange={(e) => setF({ ...f, cor: e.target.value })} placeholder="cor" style={inp} />
          <select value={f.origem} onChange={(e) => setF({ ...f, origem: e.target.value })} style={inp}>
            <option value="compra_pf">compra PF</option><option value="compra_pj">compra PJ</option><option value="consignacao">consignação</option><option value="troca">troca</option>
          </select>
          <input value={f.valor_aquisicao} onChange={(e) => setF({ ...f, valor_aquisicao: e.target.value })} placeholder="valor de aquisição" style={{ ...inp, gridColumn: '1 / -1' }} />
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '8px 14px', border: `1px solid ${C.border}`, borderRadius: 8, background: C.white, color: C.espM, cursor: 'pointer' }}>Cancelar</button>
          <button disabled={!f.chassi.trim() || busy} onClick={() => void salvar()} style={{ padding: '8px 16px', border: 'none', borderRadius: 8, background: f.chassi.trim() && !busy ? C.gold : C.espL, color: C.white, fontWeight: 700, cursor: f.chassi.trim() && !busy ? 'pointer' : 'not-allowed' }}>{busy ? 'Salvando…' : 'Salvar'}</button>
        </div>
      </div>
    </div>
  )
}
