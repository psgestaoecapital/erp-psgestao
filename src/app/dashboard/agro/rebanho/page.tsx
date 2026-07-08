'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useEmpresaSelecionada, usePropriedade, usePainelRebanho } from '@/lib/agro/usePecuaria'
import { exportToExcel } from '@/lib/export-utils'
import { salvarSnapshot, lerSnapshot, type RebanhoSnapshot } from '@/lib/agro/rebanhoOffline'

// slug pra compor nome de arquivo com o filtro ativo (piquete/lote/categoria)
const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

// Estado de conexao (navigator.onLine + eventos) — pra PWA offline (Fase A).
function useOnline(): boolean {
  const [online, setOnline] = useState(true)
  useEffect(() => {
    const set = () => setOnline(typeof navigator === 'undefined' ? true : navigator.onLine)
    set()
    window.addEventListener('online', set)
    window.addEventListener('offline', set)
    return () => { window.removeEventListener('online', set); window.removeEventListener('offline', set) }
  }, [])
  return online
}

const ESP = '#3D2314'
const BG = '#FAF7F2'
const GOLD = '#C8941A'
const LINE = '#E7DECF'
const ESP60 = 'rgba(61,35,20,0.6)'
const GREEN = '#5C8D3F'
const YELLOW = '#C8941A'
const RED = '#C44536'

type Aba = 'painel' | 'animais' | 'lotes' | 'piquetes'

type Animal = {
  id: string
  identificacao: string | null
  categoria: string
  sexo: 'M' | 'F' | null
  raca: string | null
  peso_entrada_kg: number | null
  lote_id: string | null
  area_atual_id: string | null
  status: string
  origem: string
  observacao: string | null
}
type Lote = { id: string; codigo: string; fase: string | null; modo: string; status: string }
type Piquete = { id: string; nome: string; area_ha: number | null; capacidade_ua: number | null }

const CATEGORIAS = ['matriz','touro','bezerro','bezerra','garrote','novilha','boi_magro','boi_gordo','descarte','outro'] as const

export default function RebanhoPage() {
  const { companyId } = useEmpresaSelecionada()
  const { propriedade, loading: loadingProp } = usePropriedade(companyId)
  const online = useOnline()
  const [snap, setSnap] = useState<RebanhoSnapshot | null>(null)
  // Propriedade: online do servidor, offline do snapshot (o app abre sem rede).
  const propriedadeInfo = online ? propriedade : (snap?.propriedade ?? null)
  const propriedadeId = propriedadeInfo?.id ?? null
  const [refresh, setRefresh] = useState(0)
  const [aba, setAba] = useState<Aba>('painel')

  // Carrega o ultimo snapshot do IndexedDB (companyId vem do localStorage — funciona offline).
  useEffect(() => {
    if (!companyId) { setSnap(null); return }
    let alive = true
    void lerSnapshot(companyId).then((s) => { if (alive) setSnap(s) })
    return () => { alive = false }
  }, [companyId, online])

  // Snapshot offline: online, captura o rebanho COMPLETO (todos animais/lotes/piquetes)
  // no IndexedDB pra consulta sem internet (P2/LGPD: so a empresa atual).
  useEffect(() => {
    if (!online || !companyId || !propriedadeId) return
    let alive = true
    void (async () => {
      const [a, l, p] = await Promise.all([
        supabase.from('erp_pec_animal')
          .select('id,identificacao,categoria,sexo,raca,peso_entrada_kg,lote_id,area_atual_id,status,origem,observacao')
          .eq('company_id', companyId).eq('propriedade_id', propriedadeId).eq('status', 'ativo')
          .order('identificacao', { ascending: true, nullsFirst: false }).limit(5000),
        supabase.from('erp_pec_lote').select('id,codigo,fase,modo,status')
          .eq('company_id', companyId).eq('propriedade_id', propriedadeId).eq('status', 'ativo').order('codigo'),
        supabase.from('erp_pec_area').select('id,nome,area_ha,capacidade_ua')
          .eq('company_id', companyId).eq('propriedade_id', propriedadeId).eq('ativo', true).eq('tipo', 'piquete').order('nome'),
      ])
      if (!alive || a.error) return
      const s: RebanhoSnapshot = {
        companyId, ts: Date.now(),
        propriedade: propriedade ? { id: propriedade.id, nome: propriedade.nome } : null,
        animais: a.data ?? [], lotes: l.data ?? [], piquetes: p.data ?? [],
      }
      await salvarSnapshot(s)
      if (alive) setSnap(s)
    })()
    return () => { alive = false }
  }, [online, companyId, propriedadeId, propriedade])

  const { data: painel, loading: loadingPainel } = usePainelRebanho(companyId, propriedadeId, refresh)

  const [lotes, setLotes] = useState<Lote[]>([])
  const [piquetes, setPiquetes] = useState<Piquete[]>([])
  const [contagemLote, setContagemLote] = useState<Record<string, number>>({})
  const [contagemArea, setContagemArea] = useState<Record<string, number>>({})

  const reloadDados = useCallback(async () => {
    if (!companyId || !propriedadeId) return
    // Payload leve pra contagens (id + lote_id + area_atual_id).
    // NAO paginamos aqui porque as contagens precisam do total. 5000 e
    // suficiente pra rebanhos medios; se um dia passar disso, virar RPC
    // agregada.
    const [a, l, p] = await Promise.all([
      supabase.from('erp_pec_animal')
        .select('id,lote_id,area_atual_id')
        .eq('company_id', companyId).eq('propriedade_id', propriedadeId).eq('status', 'ativo')
        .limit(5000),
      supabase.from('erp_pec_lote')
        .select('id,codigo,fase,modo,status')
        .eq('company_id', companyId).eq('propriedade_id', propriedadeId).eq('status', 'ativo').order('codigo'),
      supabase.from('erp_pec_area')
        .select('id,nome,area_ha,capacidade_ua')
        .eq('company_id', companyId).eq('propriedade_id', propriedadeId).eq('ativo', true).eq('tipo', 'piquete').order('nome'),
    ])
    const animList = (a.data ?? []) as Array<{ id: string; lote_id: string | null; area_atual_id: string | null }>
    const loteList = (l.data ?? []) as Lote[]
    const piqList = (p.data ?? []) as Piquete[]
    setLotes(loteList)
    setPiquetes(piqList)
    const cl: Record<string, number> = {}
    const ca: Record<string, number> = {}
    animList.forEach((an) => {
      if (an.lote_id) cl[an.lote_id] = (cl[an.lote_id] ?? 0) + 1
      if (an.area_atual_id) ca[an.area_atual_id] = (ca[an.area_atual_id] ?? 0) + 1
    })
    setContagemLote(cl)
    setContagemArea(ca)
  }, [companyId, propriedadeId])
  useEffect(() => { reloadDados() }, [reloadDados, refresh])

  if (!companyId) return (
    <div style={{ background: BG, color: ESP60 }} className="p-6 text-sm min-h-screen">
      Selecione uma empresa específica para abrir a pecuária.
    </div>
  )
  if (loadingProp && online) return <div style={{ background: BG }} className="p-6 text-sm min-h-screen" />
  if (!propriedadeInfo) return (
    <div style={{ background: BG, color: ESP60 }} className="p-6 text-sm min-h-screen">
      {online
        ? 'Esta empresa ainda não tem propriedade cadastrada.'
        : 'Sem dados offline. Abra esta tela com internet ao menos uma vez para baixar o rebanho.'}
    </div>
  )

  return (
    <div style={{ background: BG, minHeight: '100%', color: ESP }} className="p-4 sm:p-6">
      <div className="max-w-6xl mx-auto mb-3"><BadgeConexao online={online} ts={snap?.ts ?? null} /></div>
      <header className="max-w-6xl mx-auto mb-4 flex items-end justify-between gap-3 flex-wrap">
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest" style={{ color: GOLD }}>🐂 Pecuária · {propriedadeInfo.nome}</div>
          <h1 className="text-2xl sm:text-3xl mt-1" style={{ fontFamily: 'ui-serif,Georgia,serif', fontWeight: 600 }}>Rebanho &amp; Cadastro</h1>
        </div>
        <div className="flex gap-2 flex-wrap">
          <BotaoInstalar />
          {online ? (
            <a href="/dashboard/agro/rebanho/cadastrar" className="px-4 py-2.5 rounded-xl text-sm font-semibold inline-flex items-center gap-2" style={{ background: GOLD, color: '#fff' }}>
              + Cadastrar
            </a>
          ) : (
            <span title="Sem conexão — registre quando o sinal voltar" className="px-4 py-2.5 rounded-xl text-sm font-semibold" style={{ background: '#F0E1B8', color: '#7A5A0B', cursor: 'not-allowed' }}>
              + Cadastrar (offline)
            </span>
          )}
        </div>
      </header>

      <nav className="max-w-6xl mx-auto flex gap-1 mb-4 overflow-x-auto" style={{ borderBottom: `1px solid ${LINE}` }}>
        {(['painel','animais','lotes','piquetes'] as Aba[]).map((a) => (
          <button key={a} onClick={() => setAba(a)} className="px-4 py-2.5 text-sm whitespace-nowrap"
            style={{ color: aba === a ? GOLD : ESP60, fontWeight: aba === a ? 600 : 400,
              borderBottom: aba === a ? `2px solid ${GOLD}` : '2px solid transparent', marginBottom: -1 }}>
            {a === 'painel' ? 'Painel' : a === 'animais' ? 'Animais' : a === 'lotes' ? 'Lotes' : 'Piquetes'}
          </button>
        ))}
      </nav>

      <div className="max-w-6xl mx-auto">
        {aba === 'painel' && (online
          ? <Painel painel={painel} loading={loadingPainel} />
          : <div className="text-sm rounded-2xl p-4" style={{ background: '#fff', border: `1px solid ${LINE}`, color: ESP60 }}>Painel indisponível offline. Veja o rebanho completo na aba <b>Animais</b>.</div>)}
        {aba === 'animais' && <Animais
          companyId={companyId} propriedadeId={propriedadeId!}
          lotes={online ? lotes : ((snap?.lotes as Lote[] | undefined) ?? [])}
          piquetes={online ? piquetes : ((snap?.piquetes as Piquete[] | undefined) ?? [])}
          online={online} snapAnimais={(snap?.animais as Animal[] | undefined) ?? []}
          onReload={() => setRefresh((r) => r + 1)} />}
        {aba === 'lotes' && <Lotes
          companyId={companyId} propriedadeId={propriedadeId!}
          lotes={online ? lotes : ((snap?.lotes as Lote[] | undefined) ?? [])} contagem={contagemLote}
          onReload={() => setRefresh((r) => r + 1)} />}
        {aba === 'piquetes' && <Piquetes
          companyId={companyId} propriedadeId={propriedadeId!}
          piquetes={online ? piquetes : ((snap?.piquetes as Piquete[] | undefined) ?? [])} contagem={contagemArea}
          onReload={() => setRefresh((r) => r + 1)} />}
      </div>
    </div>
  )
}

// ───────── Badge de conexão (PWA · honestidade Pilar 3) ─────────
function BadgeConexao({ online, ts }: { online: boolean; ts: number | null }) {
  if (online) {
    return <span className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full font-semibold" style={{ background: '#EAF3DE', color: '#3B6D11' }}>📶 Online · dados ao vivo</span>
  }
  const quando = ts ? new Date(ts).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
  const velho = ts != null && (Date.now() - ts) > 7 * 86400000
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full font-semibold" style={{ background: '#FAEEDA', color: '#854F0B' }}>📴 Offline · snapshot de {quando}</span>
      {velho && <span className="text-[11px]" style={{ color: '#A32D2D' }}>Snapshot com mais de 7 dias — abra com internet para atualizar os dados.</span>}
    </div>
  )
}

// ───────── Botão instalar (PWA) ─────────
type BIPEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }
function useInstallPrompt() {
  const [evt, setEvt] = useState<BIPEvent | null>(null)
  useEffect(() => {
    const h = (e: Event) => { e.preventDefault(); setEvt(e as BIPEvent) }
    window.addEventListener('beforeinstallprompt', h)
    return () => window.removeEventListener('beforeinstallprompt', h)
  }, [])
  return {
    canInstall: !!evt,
    promptInstall: async () => { if (!evt) return; await evt.prompt(); setEvt(null) },
  }
}
function BotaoInstalar() {
  const { canInstall, promptInstall } = useInstallPrompt()
  return (
    <button
      onClick={() => { if (canInstall) void promptInstall(); else window.location.href = '/dashboard/agro/instalar-app' }}
      title="Instalar o app no celular"
      className="px-4 py-2.5 rounded-xl text-sm font-semibold inline-flex items-center gap-2"
      style={{ border: `1px solid ${GOLD}`, color: GOLD, background: 'transparent' }}
    >
      📲 Instalar no celular
    </button>
  )
}

// ───────── Painel ─────────
function Painel({ painel, loading }: { painel: ReturnType<typeof usePainelRebanho>['data']; loading: boolean }) {
  if (loading) return <div className="text-sm" style={{ color: ESP60 }}>Carregando…</div>
  if (!painel) return null
  const maxQtd = painel.por_categoria.reduce((m, c) => Math.max(m, c.qtd), 1)
  const Card = ({ label, value }: { label: string; value: number | string }) => (
    <div className="rounded-2xl p-4 shadow-sm" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
      <div className="text-3xl font-bold" style={{ color: ESP }}>{value}</div>
      <div className="text-xs mt-1" style={{ color: ESP60 }}>{label}</div>
    </div>
  )
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card label="Cabeças ativas" value={painel.total_cabecas} />
        <Card label="Lotes ativos" value={painel.lotes_ativos} />
        <Card label="Piquetes / áreas" value={painel.areas} />
        <Card label="Propriedades" value={painel.propriedades} />
      </div>
      <section className="rounded-2xl p-4" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
        <div className="text-sm font-semibold mb-3" style={{ color: ESP }}>Composição por categoria</div>
        {painel.por_categoria.length === 0 ? (
          <div className="text-xs" style={{ color: ESP60 }}>Sem animais cadastrados ainda.</div>
        ) : (
          <div className="space-y-2">
            {painel.por_categoria.map((c) => (
              <div key={c.categoria} className="flex items-center gap-3">
                <span className="text-xs capitalize w-28 shrink-0" style={{ color: ESP }}>{c.categoria.replace('_', ' ')}</span>
                <div className="flex-1 rounded-full h-2 overflow-hidden" style={{ background: BG }}>
                  <div style={{ width: `${(c.qtd / maxQtd) * 100}%`, background: GOLD, height: '100%' }} />
                </div>
                <span className="text-sm font-semibold w-12 text-right" style={{ color: ESP }}>{c.qtd}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

// ───────── Animais ─────────
const PAGE_SIZE = 200

function Animais({
  companyId, propriedadeId, lotes, piquetes, online, snapAnimais, onReload,
}: {
  companyId: string; propriedadeId: string
  lotes: Lote[]; piquetes: Piquete[]
  online: boolean; snapAnimais: Animal[]
  onReload: () => void
}) {
  const [busca, setBusca] = useState('')
  const [fCat, setFCat] = useState('todos')
  const [fLote, setFLote] = useState('todos')
  const [fPiq, setFPiq] = useState('todos')
  const [pagina, setPagina] = useState(0)
  const [animais, setAnimais] = useState<Animal[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [exportando, setExportando] = useState(false)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [acao, setAcao] = useState<null | { tipo: 'mover' | 'vender' | 'morte' | 'identificar' | 'novo'; alvos?: string[] }>(null)
  const [contagensCat, setContagensCat] = useState<Record<string, number>>({})
  const [totalRebanho, setTotalRebanho] = useState<number>(0)

  const nomeLote = (id: string | null) => lotes.find((l) => l.id === id)?.codigo ?? '—'
  const nomePiq = (id: string | null) => piquetes.find((p) => p.id === id)?.nome ?? '—'

  // Exporta a lista JA FILTRADA (mesmos filtros server-side da tela) para .xlsx.
  // Re-consulta SEM paginacao (a tela so tem a pagina atual) — respeita fCat/fLote/fPiq/busca.
  async function exportar() {
    setExportando(true); setErro(null)
    try {
      let q = supabase.from('erp_pec_animal')
        .select('identificacao,categoria,sexo,raca,peso_entrada_kg,lote_id,area_atual_id,observacao')
        .eq('company_id', companyId).eq('propriedade_id', propriedadeId).eq('status', 'ativo')
      if (fCat !== 'todos') q = q.eq('categoria', fCat)
      if (fLote !== 'todos') q = q.eq('lote_id', fLote)
      if (fPiq !== 'todos') q = q.eq('area_atual_id', fPiq)
      if (buscaDebounced) { const like = `%${buscaDebounced}%`; q = q.or(`identificacao.ilike.${like},sisbov.ilike.${like}`) }
      const { data, error } = await q.order('identificacao', { ascending: true, nullsFirst: false }).limit(5000)
      if (error) { setErro(error.message); return }
      const linhas = (data ?? []) as Animal[]
      const rows = linhas.map((a) => ({
        'Identificação': a.identificacao ?? '',
        'Categoria': a.categoria,
        'Sexo': a.sexo === 'M' ? 'Macho' : a.sexo === 'F' ? 'Fêmea' : '',
        'Raça': a.raca ?? '',
        'Lote': nomeLote(a.lote_id),
        'Piquete': nomePiq(a.area_atual_id),
        'Peso Entrada (kg)': a.peso_entrada_kg ?? '',
        'Observação': a.observacao ?? '',
      }))
      const ctx = fPiq !== 'todos' ? `_piquete-${slug(nomePiq(fPiq))}`
        : fLote !== 'todos' ? `_lote-${slug(nomeLote(fLote))}`
        : fCat !== 'todos' ? `_${slug(fCat)}` : ''
      const dt = new Date().toISOString().slice(0, 10)
      await exportToExcel(rows, {
        filename: `rebanho${ctx}_${dt}.xlsx`,
        sheetName: 'Rebanho',
        title: `Rebanho · ${dt} · ${rows.length} animais`,
      })
    } catch (e) {
      setErro((e as Error).message || 'Falha ao exportar')
    } finally {
      setExportando(false)
    }
  }

  // Cards de contagem do rebanho — total real, sem filtros de tabela.
  useEffect(() => {
    // Offline: conta a partir do snapshot (sem rede).
    if (!online) {
      const cnt: Record<string, number> = {}
      for (const a of snapAnimais) cnt[a.categoria] = (cnt[a.categoria] ?? 0) + 1
      setContagensCat(cnt)
      setTotalRebanho(snapAnimais.length)
      return
    }
    if (!companyId || !propriedadeId) return
    let alive = true
    void (async () => {
      const { data } = await supabase.from('erp_pec_animal')
        .select('categoria')
        .eq('company_id', companyId)
        .eq('propriedade_id', propriedadeId)
        .eq('status', 'ativo')
        .limit(5000)
      if (!alive || !data) return
      const cnt: Record<string, number> = {}
      let t = 0
      for (const row of data as { categoria: string }[]) {
        cnt[row.categoria] = (cnt[row.categoria] ?? 0) + 1
        t++
      }
      setContagensCat(cnt)
      setTotalRebanho(t)
    })()
    return () => { alive = false }
  }, [companyId, propriedadeId, online, snapAnimais])

  // Debounce da busca (300ms) pra nao disparar fetch a cada tecla.
  const [buscaDebounced, setBuscaDebounced] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setBuscaDebounced(busca.trim()), 300)
    return () => clearTimeout(t)
  }, [busca])

  // Reseta a pagina quando filtros/busca mudam.
  useEffect(() => { setPagina(0) }, [buscaDebounced, fCat, fLote, fPiq])

  // Fetch paginado server-side. count:'exact' → total real, com filtros.
  useEffect(() => {
    // OFFLINE: filtra/pagina o snapshot no cliente (mesmos filtros da tela).
    if (!online) {
      const q = buscaDebounced.toLowerCase()
      const filt = snapAnimais.filter((a) =>
        (fCat === 'todos' || a.categoria === fCat) &&
        (fLote === 'todos' || a.lote_id === fLote) &&
        (fPiq === 'todos' || a.area_atual_id === fPiq) &&
        (!q || (a.identificacao ?? '').toLowerCase().includes(q)),
      )
      setTotal(filt.length)
      setAnimais(filt.slice(pagina * PAGE_SIZE, pagina * PAGE_SIZE + PAGE_SIZE))
      setLoading(false); setErro(null)
      return
    }
    if (!companyId || !propriedadeId) return
    let alive = true
    setLoading(true)
    setErro(null)
    void (async () => {
      let q = supabase.from('erp_pec_animal')
        .select('id,identificacao,categoria,sexo,raca,peso_entrada_kg,lote_id,area_atual_id,status,origem,observacao', { count: 'exact' })
        .eq('company_id', companyId)
        .eq('propriedade_id', propriedadeId)
        .eq('status', 'ativo')
      if (fCat !== 'todos') q = q.eq('categoria', fCat)
      if (fLote !== 'todos') q = q.eq('lote_id', fLote)
      if (fPiq !== 'todos') q = q.eq('area_atual_id', fPiq)
      if (buscaDebounced) {
        const like = `%${buscaDebounced}%`
        q = q.or(`identificacao.ilike.${like},sisbov.ilike.${like}`)
      }
      q = q.order('identificacao', { ascending: true, nullsFirst: false })
      const inicio = pagina * PAGE_SIZE
      const fim = inicio + PAGE_SIZE - 1
      const { data, error, count } = await q.range(inicio, fim)
      if (!alive) return
      if (error) { setErro(error.message); setAnimais([]); setTotal(0) }
      else {
        setAnimais((data ?? []) as Animal[])
        setTotal(count ?? 0)
      }
      setLoading(false)
    })()
    return () => { alive = false }
  }, [companyId, propriedadeId, buscaDebounced, fCat, fLote, fPiq, pagina, online, snapAnimais])

  const filtrados = animais // paginacao (server online / cliente offline) ja aconteceu

  // Ações de escrita ficam desabilitadas offline (Fase A = consulta). Bloqueia na origem.
  const abrirAcao = (a: { tipo: 'mover' | 'vender' | 'morte' | 'identificar' | 'novo'; alvos?: string[] }) => {
    if (!online) { setErro('Sem conexão — registre quando o sinal voltar (modo consulta offline).'); return }
    setAcao(a)
  }

  const toggle = (id: string) => {
    const n = new Set(sel)
    if (n.has(id)) n.delete(id); else n.add(id)
    setSel(n)
  }
  const limparSel = () => setSel(new Set())

  const inp = 'rounded-xl border border-[#E7DECF] bg-white px-3 py-2 text-sm text-[#3D2314]'
  const Card = ({ label, value }: { label: string; value: number }) => (
    <div className="rounded-2xl p-3 sm:p-4" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
      <div className="text-2xl sm:text-3xl font-bold" style={{ color: ESP }}>{value}</div>
      <div className="text-[10px] sm:text-xs mt-1 uppercase tracking-wide" style={{ color: ESP60 }}>{label}</div>
    </div>
  )
  return (
    <div className="space-y-3">
      {/* Cards de contagem do rebanho — totais reais, independem do filtro. */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <Card label="Total" value={totalRebanho} />
        <Card label="Matrizes" value={contagensCat['matriz'] ?? 0} />
        <Card label="Novilhas" value={contagensCat['novilha'] ?? 0} />
        <Card label="Garrotes" value={contagensCat['garrote'] ?? 0} />
        <Card label="Touros" value={contagensCat['touro'] ?? 0} />
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <input className={inp} placeholder="Buscar por brinco/identificação" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <select className={inp} value={fCat} onChange={(e) => setFCat(e.target.value)}>
          <option value="todos">Categoria · todas</option>
          {CATEGORIAS.map((c) => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
        </select>
        <select className={inp} value={fLote} onChange={(e) => setFLote(e.target.value)}>
          <option value="todos">Lote · todos</option>
          {lotes.map((l) => <option key={l.id} value={l.id}>{l.codigo}</option>)}
        </select>
        <select className={inp} value={fPiq} onChange={(e) => setFPiq(e.target.value)}>
          <option value="todos">Piquete · todos</option>
          {piquetes.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
        </select>
        <span className="text-xs" style={{ color: ESP60 }}>
          {loading ? 'Carregando…' : total === 0 ? '0 de 0'
            : `${pagina * PAGE_SIZE + 1}–${Math.min((pagina + 1) * PAGE_SIZE, total)} de ${total}`}
        </span>
        <div className="flex-1" />
        <button
          onClick={exportar}
          disabled={total === 0 || exportando || !online}
          title={!online ? 'Exportar disponível online' : total === 0 ? 'Nada para exportar' : 'Baixa os animais filtrados em Excel'}
          className="px-3 py-2 rounded-xl text-sm font-semibold"
          style={{ border: `1px solid ${GOLD}`, color: GOLD, background: 'transparent', opacity: total === 0 || exportando || !online ? 0.5 : 1 }}
        >
          {exportando ? 'Exportando…' : '⬇ Exportar Excel'}
        </button>
        <button onClick={() => abrirAcao({ tipo: 'novo' })} disabled={!online} className="px-3 py-2 rounded-xl text-sm font-semibold" style={{ background: GOLD, color: '#fff', opacity: online ? 1 : 0.5 }}>+ Novo animal</button>
      </div>

      {sel.size > 0 && (
        <div className="flex flex-wrap gap-2 items-center rounded-xl p-2" style={{ background: '#FFF7E0', border: `1px solid ${GOLD}` }}>
          <span className="text-xs font-semibold" style={{ color: ESP }}>{sel.size} selecionado(s)</span>
          <button onClick={() => abrirAcao({ tipo: 'mover', alvos: Array.from(sel) })} className="text-xs px-3 py-1 rounded-lg font-semibold" style={{ background: ESP, color: '#fff' }}>Mover</button>
          <button onClick={() => abrirAcao({ tipo: 'vender', alvos: Array.from(sel) })} className="text-xs px-3 py-1 rounded-lg font-semibold" style={{ background: GOLD, color: '#fff' }}>Vender</button>
          <button onClick={() => abrirAcao({ tipo: 'morte', alvos: Array.from(sel) })} className="text-xs px-3 py-1 rounded-lg font-semibold" style={{ background: '#fff', border: `1px solid ${RED}`, color: RED }}>Morte</button>
          <button onClick={limparSel} className="text-xs px-3 py-1 rounded-lg" style={{ color: ESP60 }}>Limpar</button>
        </div>
      )}

      <div className="hidden md:block rounded-2xl overflow-hidden" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
        <table className="w-full text-sm">
          <thead className="text-xs" style={{ background: BG, color: ESP60 }}>
            <tr>
              <th className="p-2 text-center w-8"><input type="checkbox" checked={sel.size > 0 && sel.size === filtrados.length} onChange={(e) => setSel(e.target.checked ? new Set(filtrados.map((a) => a.id)) : new Set())} /></th>
              <th className="text-left p-2">Identificação</th>
              <th className="text-left p-2">Categoria</th>
              <th className="text-left p-2">Sexo</th>
              <th className="text-left p-2">Raça</th>
              <th className="text-left p-2">Lote</th>
              <th className="text-left p-2">Piquete</th>
              <th className="text-left p-2">Observação</th>
              <th className="text-right p-2">Peso entrada</th>
              <th className="p-2">Ações</th>
            </tr>
          </thead>
          <tbody>
            {filtrados.map((a) => (
              <tr key={a.id} style={{ borderTop: `1px solid ${LINE}` }}>
                <td className="p-2 text-center"><input type="checkbox" checked={sel.has(a.id)} onChange={() => toggle(a.id)} /></td>
                <td className="p-2">{a.identificacao ?? <span style={{ color: ESP60 }}>— <button onClick={() => abrirAcao({ tipo: 'identificar', alvos: [a.id] })} title="Identificar" style={{ color: GOLD }}>📷</button></span>}</td>
                <td className="p-2"><span className="text-[11px] px-2 py-0.5 rounded-full capitalize" style={{ background: BG, color: ESP }}>{a.categoria.replace('_', ' ')}</span></td>
                <td className="p-2 text-xs">{a.sexo === 'M' ? 'Macho' : a.sexo === 'F' ? 'Fêmea' : '—'}</td>
                <td className="p-2 text-xs">{a.raca ?? '—'}</td>
                <td className="p-2 text-xs">{nomeLote(a.lote_id)}</td>
                <td className="p-2 text-xs">{nomePiq(a.area_atual_id)}</td>
                <td className="p-2 text-xs" title={a.observacao ?? ''} style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.observacao ?? '—'}</td>
                <td className="p-2 text-right text-xs">{a.peso_entrada_kg ?? '—'}{a.peso_entrada_kg ? ' kg' : ''}</td>
                <td className="p-2">
                  <div className="flex gap-1 justify-center">
                    <button onClick={() => abrirAcao({ tipo: 'mover', alvos: [a.id] })} className="text-[10px] px-2 py-1 rounded" style={{ background: BG, color: ESP }}>Mover</button>
                    <button onClick={() => abrirAcao({ tipo: 'vender', alvos: [a.id] })} className="text-[10px] px-2 py-1 rounded" style={{ background: GOLD, color: '#fff' }}>Vender</button>
                    <button onClick={() => abrirAcao({ tipo: 'morte', alvos: [a.id] })} className="text-[10px] px-2 py-1 rounded" style={{ background: '#fff', border: `1px solid ${RED}`, color: RED }}>Morte</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* mobile cards */}
      <div className="md:hidden space-y-2">
        {filtrados.map((a) => (
          <div key={a.id} className="rounded-2xl p-3" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
            <div className="flex justify-between items-start gap-2">
              <div>
                <div className="font-semibold" style={{ color: ESP }}>
                  <input type="checkbox" checked={sel.has(a.id)} onChange={() => toggle(a.id)} className="mr-2" />
                  {a.identificacao ?? <span style={{ color: ESP60 }}>(sem brinco)</span>}
                </div>
                <div className="text-xs capitalize" style={{ color: ESP60 }}>
                  {a.categoria.replace('_', ' ')} · {a.sexo === 'M' ? 'macho' : 'fêmea'}
                </div>
                <div className="text-xs mt-1" style={{ color: ESP60 }}>
                  {nomeLote(a.lote_id)} · {nomePiq(a.area_atual_id)}
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <button onClick={() => abrirAcao({ tipo: 'mover', alvos: [a.id] })} className="text-[10px] px-2 py-1 rounded" style={{ background: BG, color: ESP }}>Mover</button>
                <button onClick={() => abrirAcao({ tipo: 'vender', alvos: [a.id] })} className="text-[10px] px-2 py-1 rounded" style={{ background: GOLD, color: '#fff' }}>Vender</button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Paginacao (rodape) */}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between gap-2 text-xs pt-1" style={{ color: ESP60 }}>
          <span>Página {pagina + 1} de {Math.ceil(total / PAGE_SIZE)}</span>
          <div className="flex gap-2">
            <button
              onClick={() => setPagina((p) => Math.max(0, p - 1))}
              disabled={pagina === 0 || loading}
              className="px-3 py-1.5 rounded-lg font-semibold"
              style={{ background: pagina === 0 ? '#fff' : ESP, color: pagina === 0 ? ESP60 : '#fff', border: `1px solid ${LINE}`, opacity: pagina === 0 ? 0.6 : 1 }}
            >← Anterior</button>
            <button
              onClick={() => setPagina((p) => ((p + 1) * PAGE_SIZE < total ? p + 1 : p))}
              disabled={(pagina + 1) * PAGE_SIZE >= total || loading}
              className="px-3 py-1.5 rounded-lg font-semibold"
              style={{ background: (pagina + 1) * PAGE_SIZE >= total ? '#fff' : ESP, color: (pagina + 1) * PAGE_SIZE >= total ? ESP60 : '#fff', border: `1px solid ${LINE}`, opacity: (pagina + 1) * PAGE_SIZE >= total ? 0.6 : 1 }}
            >Próxima →</button>
          </div>
        </div>
      )}

      {erro && <div className="rounded-xl p-3 text-xs" style={{ background: '#FEE', border: '1px solid #FBB', color: '#A65A3A' }}>{erro}</div>}

      {acao && <AcaoModal companyId={companyId} propriedadeId={propriedadeId} acao={acao}
        lotes={lotes} piquetes={piquetes} onClose={() => setAcao(null)}
        onDone={() => { setAcao(null); limparSel(); onReload() }} />}
    </div>
  )
}

// ───────── Modal de Ações ─────────
function AcaoModal({
  companyId, propriedadeId, acao, lotes, piquetes, onClose, onDone,
}: {
  companyId: string; propriedadeId: string
  acao: { tipo: 'mover' | 'vender' | 'morte' | 'identificar' | 'novo'; alvos?: string[] }
  lotes: Lote[]; piquetes: Piquete[]; onClose: () => void; onDone: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  // mover
  const [loteDestId, setLoteDestId] = useState('')
  const [areaDestId, setAreaDestId] = useState('')
  // vender
  const [valor, setValor] = useState('') // valor recebido (manual override; vazio = usa o calculado)
  const [peso, setPeso] = useState('')
  const [clientes, setClientes] = useState<{ id: string; nome_fantasia: string | null }[]>([])
  const [compradorId, setCompradorId] = useState('')
  const [novoComp, setNovoComp] = useState(false)
  const [novoNome, setNovoNome] = useState('')
  const [novoDoc, setNovoDoc] = useState('')
  const [unidade, setUnidade] = useState<'kg' | 'arroba'>('kg')
  const [valorUnit, setValorUnit] = useState('')
  const [vencimento, setVencimento] = useState('')
  const [gerarFin, setGerarFin] = useState(true)
  // morte
  const [obs, setObs] = useState('')
  // identificar
  const [identificacao, setIdentificacao] = useState('')
  // novo
  const [novo, setNovo] = useState({ categoria: 'bezerro', sexo: 'M', lote_id: '', area_atual_id: '', peso: '', identificacao: '' })

  const hoje = new Date().toISOString().slice(0, 10)

  // valor recebido sugerido = peso x valor/un (÷15 se @); campo "valor" sobrescreve
  const valorSugerido = useMemo(() => {
    const p = Number(peso), vu = Number(valorUnit)
    if (p > 0 && vu > 0) { const t = unidade === 'arroba' ? (p / 15) * vu : p * vu; return String(Math.round(t * 100) / 100) }
    return ''
  }, [peso, valorUnit, unidade])

  // compradores do cadastro (erp_clientes) — carrega ao abrir o modal de venda
  useEffect(() => {
    if (acao.tipo !== 'vender') return
    let alive = true
    supabase.from('erp_clientes').select('id,nome_fantasia').eq('company_id', companyId).eq('ativo', true).order('nome_fantasia')
      .then(({ data }) => { if (alive) setClientes((data ?? []) as { id: string; nome_fantasia: string | null }[]) })
    return () => { alive = false }
  }, [acao.tipo, companyId])

  async function criarComprador() {
    if (!novoNome.trim()) return
    const { data, error } = await supabase.rpc('fn_cliente_criar_inline', { p_company_id: companyId, p_nome: novoNome.trim(), p_cpf_cnpj: novoDoc.trim() || null })
    if (error) { setErro(error.message); return }
    const id = data as string
    setClientes((cs) => [...cs, { id, nome_fantasia: novoNome.trim() }])
    setCompradorId(id); setNovoComp(false); setNovoNome(''); setNovoDoc('')
  }

  const executar = async () => {
    setBusy(true); setErro(null)
    try {
      if (acao.tipo === 'novo') {
        const { error } = await supabase.rpc('fn_pec_animal_salvar', {
          p_company_id: companyId, p_propriedade_id: propriedadeId,
          p_categoria: novo.categoria, p_sexo: novo.sexo,
          p_lote_id: novo.lote_id || null, p_area_atual_id: novo.area_atual_id || null,
          p_peso_entrada_kg: novo.peso ? Number(novo.peso) : null,
          p_identificacao: novo.identificacao || null,
          p_origem: 'comprado',
        })
        if (error) throw error
        onDone(); return
      }
      const alvos = acao.alvos ?? []
      if (acao.tipo === 'identificar') {
        for (const id of alvos) {
          const { error } = await supabase.rpc('fn_pec_animal_salvar', {
            p_company_id: companyId, p_propriedade_id: propriedadeId,
            p_id: id, p_identificacao: identificacao,
          })
          if (error) throw error
        }
        onDone(); return
      }
      // VENDA: RPC dedicada — rateia valor/peso entre os animais, marca vendido e
      // (se marcado) gera o recebivel em Contas a Receber.
      if (acao.tipo === 'vender') {
        const valorTotal = Number(valor || valorSugerido) || null
        const { error } = await supabase.rpc('fn_pec_animal_vender', {
          p_company_id: companyId, p_animal_ids: alvos, p_propriedade_id: propriedadeId,
          p_comprador_id: compradorId || null,
          p_comprador_nome: null,
          p_peso_kg: peso ? Number(peso) : null,
          p_valor_unitario: valorUnit ? Number(valorUnit) : null,
          p_unidade: unidade,
          p_valor_total: valorTotal,
          p_vencimento: vencimento || null,
          p_gerar_financeiro: gerarFin,
        })
        if (error) throw error
        onDone(); return
      }

      for (const id of alvos) {
        const params: Record<string, unknown> = {
          p_company_id: companyId, p_propriedade_id: propriedadeId,
          p_animal_id: id, p_data: hoje,
        }
        if (acao.tipo === 'mover') {
          params.p_tipo = 'transferencia'
          params.p_lote_destino_id = loteDestId || null
          params.p_area_destino_id = areaDestId || null
        } else if (acao.tipo === 'morte') {
          params.p_tipo = 'morte'
          params.p_observacao = obs || null
        }
        const { error } = await supabase.rpc('fn_pec_movimentacao_registrar', params)
        if (error) throw error
      }
      onDone()
    } catch (e) {
      setErro((e as Error).message || String(e))
    } finally {
      setBusy(false)
    }
  }

  const titulo: Record<string, string> = {
    mover: 'Mover animal(is)', vender: 'Vender animal(is)', morte: 'Registrar morte',
    identificar: 'Identificar animal', novo: 'Novo animal',
  }
  const inp = 'w-full rounded-xl border border-[#E7DECF] bg-white px-3 py-2 text-sm text-[#3D2314]'

  return (
    <div onClick={onClose} className="fixed inset-0 flex items-center justify-center p-4" style={{ background: 'rgba(61,35,20,0.45)', zIndex: 50 }}>
      <div onClick={(e) => e.stopPropagation()} className="rounded-2xl p-5 w-full max-w-md" style={{ background: '#fff' }}>
        <div className="text-xs uppercase tracking-widest mb-1" style={{ color: GOLD, fontWeight: 600 }}>Ação</div>
        <h3 className="text-lg font-semibold mb-3" style={{ color: ESP, fontFamily: 'ui-serif,Georgia,serif' }}>{titulo[acao.tipo]}</h3>
        {(acao.alvos?.length ?? 0) > 0 && (
          <div className="text-xs mb-3" style={{ color: ESP60 }}>{acao.alvos!.length} animal(is) selecionado(s)</div>
        )}

        <div className="space-y-2">
          {acao.tipo === 'mover' && (<>
            <select className={inp} value={loteDestId} onChange={(e) => setLoteDestId(e.target.value)}>
              <option value="">Lote destino — manter</option>
              {lotes.map((l) => <option key={l.id} value={l.id}>{l.codigo}</option>)}
            </select>
            <select className={inp} value={areaDestId} onChange={(e) => setAreaDestId(e.target.value)}>
              <option value="">Piquete destino — manter</option>
              {piquetes.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </select>
          </>)}
          {acao.tipo === 'vender' && (<>
            {/* Comprador: do cadastro (erp_clientes) ou cadastro inline */}
            {!novoComp ? (
              <div className="flex gap-2">
                <select className={inp} value={compradorId} onChange={(e) => setCompradorId(e.target.value)}>
                  <option value="">Comprador — selecione</option>
                  {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome_fantasia ?? '—'}</option>)}
                </select>
                <button type="button" onClick={() => setNovoComp(true)} className="text-xs px-3 rounded-xl whitespace-nowrap font-semibold" style={{ border: `1px solid ${GOLD}`, color: GOLD }}>+ Novo</button>
              </div>
            ) : (
              <div className="rounded-xl p-2 space-y-2" style={{ background: '#FFF7E0', border: `1px solid ${GOLD}` }}>
                <input className={inp} placeholder="Nome do comprador" value={novoNome} onChange={(e) => setNovoNome(e.target.value)} />
                <input className={inp} placeholder="CPF / CNPJ (opcional)" value={novoDoc} onChange={(e) => setNovoDoc(e.target.value)} />
                <div className="flex gap-2">
                  <button type="button" onClick={criarComprador} className="text-xs px-3 py-1.5 rounded-lg font-semibold" style={{ background: GOLD, color: '#fff' }}>Cadastrar comprador</button>
                  <button type="button" onClick={() => setNovoComp(false)} className="text-xs px-3 py-1.5 rounded-lg" style={{ color: ESP60 }}>Cancelar</button>
                </div>
              </div>
            )}
            <input className={inp} type="number" inputMode="decimal" placeholder="Peso total (kg) — opcional" value={peso} onChange={(e) => setPeso(e.target.value)} />
            <div className="grid grid-cols-2 gap-2">
              <select className={inp} value={unidade} onChange={(e) => setUnidade(e.target.value as 'kg' | 'arroba')}>
                <option value="kg">Valor por kg</option>
                <option value="arroba">Valor por @ (15kg)</option>
              </select>
              <input className={inp} type="number" inputMode="decimal" placeholder={unidade === 'arroba' ? 'R$/@' : 'R$/kg'} value={valorUnit} onChange={(e) => setValorUnit(e.target.value)} />
            </div>
            <input className={inp} type="number" inputMode="decimal" placeholder={valorSugerido ? `Valor recebido (auto: ${valorSugerido})` : 'Valor recebido (R$)'} value={valor} onChange={(e) => setValor(e.target.value)} />
            {valorSugerido && !valor && <div className="text-[11px]" style={{ color: ESP60 }}>Calculado: R$ {valorSugerido} — editável</div>}
            <div className="grid grid-cols-2 gap-2 items-center">
              <input className={inp} type="date" value={vencimento || hoje} onChange={(e) => setVencimento(e.target.value)} />
              <label className="flex items-center gap-2 text-xs" style={{ color: ESP }}>
                <input type="checkbox" checked={gerarFin} onChange={(e) => setGerarFin(e.target.checked)} />
                Lançar em Contas a Receber
              </label>
            </div>
            {gerarFin && !compradorId && !novoComp && <div className="text-[11px]" style={{ color: RED }}>Selecione um comprador para o recebível entrar no financeiro.</div>}
          </>)}
          {acao.tipo === 'morte' && (
            <textarea className={inp} placeholder="Observação (causa, etc)" rows={3} value={obs} onChange={(e) => setObs(e.target.value)} />
          )}
          {acao.tipo === 'identificar' && (
            <input className={inp} placeholder="Identificação / brinco" value={identificacao} onChange={(e) => setIdentificacao(e.target.value)} />
          )}
          {acao.tipo === 'novo' && (<>
            <input className={inp} placeholder="Identificação / brinco (opcional)" value={novo.identificacao} onChange={(e) => setNovo({ ...novo, identificacao: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <select className={inp} value={novo.categoria} onChange={(e) => setNovo({ ...novo, categoria: e.target.value })}>
                {CATEGORIAS.map((c) => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
              </select>
              <select className={inp} value={novo.sexo} onChange={(e) => setNovo({ ...novo, sexo: e.target.value })}>
                <option value="M">Macho</option><option value="F">Fêmea</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <select className={inp} value={novo.lote_id} onChange={(e) => setNovo({ ...novo, lote_id: e.target.value })}>
                <option value="">Lote — opcional</option>
                {lotes.map((l) => <option key={l.id} value={l.id}>{l.codigo}</option>)}
              </select>
              <select className={inp} value={novo.area_atual_id} onChange={(e) => setNovo({ ...novo, area_atual_id: e.target.value })}>
                <option value="">Piquete — opcional</option>
                {piquetes.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </select>
            </div>
            <input className={inp} type="number" inputMode="decimal" placeholder="Peso de entrada (kg)" value={novo.peso} onChange={(e) => setNovo({ ...novo, peso: e.target.value })} />
          </>)}
        </div>

        {erro && (
          <div className="mt-2 text-xs rounded-lg p-2" style={{ background: '#FCEBEB', color: RED }}>{erro}</div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} disabled={busy} className="px-4 py-2 rounded-xl text-sm" style={{ background: '#fff', border: `1px solid ${LINE}`, color: ESP }}>Cancelar</button>
          <button onClick={executar} disabled={busy} className="px-4 py-2 rounded-xl text-sm font-semibold" style={{ background: GOLD, color: '#fff', opacity: busy ? 0.6 : 1 }}>
            {busy ? 'Salvando…' : 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ───────── Lotes ─────────
function Lotes({
  companyId, propriedadeId, lotes, contagem, onReload,
}: {
  companyId: string; propriedadeId: string; lotes: Lote[]; contagem: Record<string, number>; onReload: () => void
}) {
  const [novo, setNovo] = useState<{ codigo: string; modo: string; fase: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const salvar = async () => {
    if (!novo?.codigo) return
    setBusy(true)
    await supabase.rpc('fn_pec_lote_salvar', {
      p_company_id: companyId, p_propriedade_id: propriedadeId,
      p_codigo: novo.codigo, p_modo: novo.modo, p_fase: novo.fase || null,
    })
    setBusy(false); setNovo(null); onReload()
  }
  const inp = 'w-full rounded-xl border border-[#E7DECF] bg-white px-3 py-2 text-sm text-[#3D2314]'
  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <span className="text-sm font-semibold" style={{ color: ESP }}>{lotes.length} lote(s) ativo(s)</span>
        <button onClick={() => setNovo({ codigo: '', modo: 'pasto', fase: '' })} className="px-3 py-2 rounded-xl text-sm font-semibold" style={{ background: GOLD, color: '#fff' }}>+ Novo lote</button>
      </div>
      <div className="rounded-2xl overflow-hidden" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
        {lotes.length === 0 && <div className="p-6 text-center text-sm" style={{ color: ESP60 }}>Sem lotes.</div>}
        {lotes.map((l, i) => (
          <div key={l.id} className="flex items-center justify-between p-3" style={{ borderTop: i ? `1px solid ${LINE}` : 'none' }}>
            <div>
              <div className="font-semibold" style={{ color: ESP }}>{l.codigo}</div>
              <div className="text-xs capitalize" style={{ color: ESP60 }}>{l.modo}{l.fase ? ` · ${l.fase}` : ''}</div>
            </div>
            <div className="text-right">
              <div className="text-lg font-bold" style={{ color: GOLD }}>{contagem[l.id] ?? 0}</div>
              <div className="text-[10px]" style={{ color: ESP60 }}>cabeças</div>
            </div>
          </div>
        ))}
      </div>

      {novo && (
        <div onClick={() => setNovo(null)} className="fixed inset-0 flex items-center justify-center p-4" style={{ background: 'rgba(61,35,20,0.45)', zIndex: 50 }}>
          <div onClick={(e) => e.stopPropagation()} className="rounded-2xl p-5 w-full max-w-sm" style={{ background: '#fff' }}>
            <h3 className="text-lg font-semibold mb-3" style={{ color: ESP, fontFamily: 'ui-serif,Georgia,serif' }}>Novo lote</h3>
            <div className="space-y-2">
              <input className={inp} placeholder="Código (ex.: Lote A)" value={novo.codigo} onChange={(e) => setNovo({ ...novo, codigo: e.target.value })} />
              <select className={inp} value={novo.modo} onChange={(e) => setNovo({ ...novo, modo: e.target.value })}>
                <option value="pasto">Pasto</option>
                <option value="semiconfinamento">Semiconfinamento</option>
                <option value="confinamento">Confinamento</option>
              </select>
              <select className={inp} value={novo.fase} onChange={(e) => setNovo({ ...novo, fase: e.target.value })}>
                <option value="">Fase — opcional</option>
                <option value="cria">Cria</option><option value="recria">Recria</option>
                <option value="engorda">Engorda</option><option value="terminacao">Terminação</option>
              </select>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setNovo(null)} className="px-4 py-2 rounded-xl text-sm" style={{ background: '#fff', border: `1px solid ${LINE}`, color: ESP }}>Cancelar</button>
              <button onClick={salvar} disabled={busy || !novo.codigo} className="px-4 py-2 rounded-xl text-sm font-semibold" style={{ background: GOLD, color: '#fff', opacity: busy ? 0.6 : 1 }}>Criar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ───────── Piquetes ─────────
function Piquetes({
  companyId, propriedadeId, piquetes, contagem, onReload,
}: {
  companyId: string; propriedadeId: string; piquetes: Piquete[]; contagem: Record<string, number>; onReload: () => void
}) {
  const [novo, setNovo] = useState<{ nome: string; area_ha: string; capacidade_ua: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const salvar = async () => {
    if (!novo?.nome) return
    setBusy(true)
    await supabase.rpc('fn_pec_area_salvar', {
      p_company_id: companyId, p_propriedade_id: propriedadeId,
      p_nome: novo.nome, p_tipo: 'piquete',
      p_area_ha: novo.area_ha ? Number(novo.area_ha) : null,
      p_capacidade_ua: novo.capacidade_ua ? Number(novo.capacidade_ua) : null,
    })
    setBusy(false); setNovo(null); onReload()
  }
  const ocupacaoCor = (cab: number, cap: number | null) => {
    if (!cap || cap <= 0) return ESP60
    const r = cab / cap
    if (r >= 1) return RED
    if (r >= 0.8) return YELLOW
    return GREEN
  }
  const inp = 'w-full rounded-xl border border-[#E7DECF] bg-white px-3 py-2 text-sm text-[#3D2314]'
  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <span className="text-sm font-semibold" style={{ color: ESP }}>{piquetes.length} piquete(s)</span>
        <button onClick={() => setNovo({ nome: '', area_ha: '', capacidade_ua: '' })} className="px-3 py-2 rounded-xl text-sm font-semibold" style={{ background: GOLD, color: '#fff' }}>+ Novo piquete</button>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {piquetes.map((p) => {
          const cab = contagem[p.id] ?? 0
          const cor = ocupacaoCor(cab, p.capacidade_ua)
          return (
            <div key={p.id} className="rounded-2xl p-4" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
              <div className="font-semibold" style={{ color: ESP }}>{p.nome}</div>
              <div className="text-xs mt-1" style={{ color: ESP60 }}>
                {p.area_ha ? `${p.area_ha} ha` : 'sem área'}{p.capacidade_ua ? ` · ${p.capacidade_ua} UA` : ''}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span className="text-lg font-bold" style={{ color: cor }}>{cab}</span>
                <span className="text-xs" style={{ color: ESP60 }}>cabeças{p.capacidade_ua ? ` / ${p.capacidade_ua}` : ''}</span>
              </div>
              {p.capacidade_ua && p.capacidade_ua > 0 && (
                <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: BG }}>
                  <div style={{ width: `${Math.min(100, (cab / p.capacidade_ua) * 100)}%`, background: cor, height: '100%' }} />
                </div>
              )}
            </div>
          )
        })}
      </div>

      {novo && (
        <div onClick={() => setNovo(null)} className="fixed inset-0 flex items-center justify-center p-4" style={{ background: 'rgba(61,35,20,0.45)', zIndex: 50 }}>
          <div onClick={(e) => e.stopPropagation()} className="rounded-2xl p-5 w-full max-w-sm" style={{ background: '#fff' }}>
            <h3 className="text-lg font-semibold mb-3" style={{ color: ESP, fontFamily: 'ui-serif,Georgia,serif' }}>Novo piquete</h3>
            <div className="space-y-2">
              <input className={inp} placeholder="Nome (ex.: Piquete 1)" value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} />
              <div className="grid grid-cols-2 gap-2">
                <input className={inp} type="number" inputMode="decimal" placeholder="Área (ha)" value={novo.area_ha} onChange={(e) => setNovo({ ...novo, area_ha: e.target.value })} />
                <input className={inp} type="number" inputMode="decimal" placeholder="Capacidade UA" value={novo.capacidade_ua} onChange={(e) => setNovo({ ...novo, capacidade_ua: e.target.value })} />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setNovo(null)} className="px-4 py-2 rounded-xl text-sm" style={{ background: '#fff', border: `1px solid ${LINE}`, color: ESP }}>Cancelar</button>
              <button onClick={salvar} disabled={busy || !novo.nome} className="px-4 py-2 rounded-xl text-sm font-semibold" style={{ background: GOLD, color: '#fff', opacity: busy ? 0.6 : 1 }}>Criar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
