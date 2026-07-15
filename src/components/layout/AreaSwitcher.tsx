'use client'

import { useState, useRef, useEffect, useMemo, Suspense } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { ChevronDown, ChevronRight, Sparkles, type LucideIcon } from 'lucide-react'
import * as LucideIcons from 'lucide-react'
import { useAreasVisiveis, type AreaVisivel } from '@/hooks/useAreasVisiveis'
import { supabase } from '@/lib/supabase'

// FIX-NAV-COMMERCE-EM-GE-v1 · seletor-areas-lista-unica-v1
const AREA_STORAGE_KEY = 'ps_area_sel'

function resolveSelectedCompanyId(): string | null {
  if (typeof window === 'undefined') return null
  const sel = localStorage.getItem('ps_empresa_sel')
  if (!sel || sel === 'consolidado') return null
  if (sel.startsWith('group_')) return null
  return sel
}

function detectarAreaAtivaPorPath(areas: AreaVisivel[], pathname: string): AreaVisivel | null {
  if (!pathname || areas.length === 0) return null
  let melhor: AreaVisivel | null = null
  for (const a of areas) {
    if (!a.rota_raiz) continue
    if (pathname === a.rota_raiz || pathname.startsWith(a.rota_raiz + '/')) {
      if (!melhor || a.rota_raiz.length > melhor.rota_raiz.length) {
        melhor = a
      }
    }
  }
  return melhor
}

function detectarAreaPorSlug(areas: AreaVisivel[], slug: string | null): AreaVisivel | null {
  if (!slug || areas.length === 0) return null
  return areas.find((a) => a.area_slug === slug) ?? null
}

function lerAreaPersistida(): string | null {
  if (typeof window === 'undefined') return null
  try { return localStorage.getItem(AREA_STORAGE_KEY) } catch { return null }
}

function persistirArea(slug: string) {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(AREA_STORAGE_KEY, slug) } catch { /* noop */ }
}

function resolveIcon(nome: string | null | undefined): LucideIcon {
  if (!nome) return Sparkles
  const found = (LucideIcons as unknown as Record<string, LucideIcon>)[nome]
  return found ?? Sparkles
}

type Grupo = 'contratadas' | 'disponiveis' | 'em_dev' | 'roadmap'

// Precedencia: se habilitada (contratada), vai pra 'contratadas' independente
// de status_comercial · estagio do produto nao rebaixa area contratada.
function classificarGrupo(area: AreaVisivel): Grupo {
  if (area.empresa_tem_acesso) return 'contratadas'
  if (area.status_comercial === 'piloto' || area.status_comercial === 'em_producao') return 'disponiveis'
  if (area.status_comercial === 'backlog') return 'em_dev'
  return 'roadmap'
}

const GRUPO_LABEL: Record<Grupo, string> = {
  contratadas: 'Contratadas',
  disponiveis: 'Disponíveis',
  em_dev: 'Em desenvolvimento',
  roadmap: 'Roadmap',
}

function BadgeStatus({ status }: { status: AreaVisivel['status_comercial'] }) {
  if (status === 'piloto') {
    return (
      <span
        className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded font-semibold"
        style={{ background: '#FAEEDA', color: '#854F0B' }}
      >
        Piloto
      </span>
    )
  }
  if (status === 'backlog' || status === 'futuro') {
    return (
      <span
        className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded font-semibold"
        style={{ background: 'rgba(61,35,20,0.08)', color: 'rgba(61,35,20,0.70)' }}
      >
        Em breve
      </span>
    )
  }
  return null
}

export default function AreaSwitcher() {
  return (
    <Suspense fallback={<AreaSwitcherFallback />}>
      <AreaSwitcherInner />
    </Suspense>
  )
}

function AreaSwitcherFallback() {
  return (
    <div className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-[#C8941A]/18 border border-[#C8941A]/45 text-[12px] font-medium text-[#FAF7F2]">
      <span className="flex items-center gap-2 min-w-0">
        <Sparkles size={14} className="text-[#C8941A] flex-shrink-0" />
        <span className="truncate">Carregando…</span>
      </span>
    </div>
  )
}

function AreaSwitcherInner() {
  const [open, setOpen] = useState(false)
  const [outrasExpand, setOutrasExpand] = useState(false)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [companyNome, setCompanyNome] = useState<string | null>(null)
  const [areaPersistida, setAreaPersistida] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const pathname = usePathname() || ''
  const searchParams = useSearchParams()
  const queryArea = searchParams?.get('area') ?? null

  useEffect(() => {
    if (typeof window === 'undefined') return
    let alive = true
    let empresasUsuario: string[] | null = null // cache do fallback (busca 1x)

    // FALLBACK (RD-52): o switcher resolvia empresa SÓ do localStorage (ps_empresa_sel).
    // Quando vem null/consolidado/group, a RPC de áreas recebia company=NULL e escondia
    // TODA área contratada (Agro virava 🚫) — enquanto os DADOS resolviam a empresa por
    // user_companies e apareciam. Bug de dois resolvedores divergentes. Aqui alinhamos:
    // se o usuário tem EXATAMENTE UMA empresa, usamos ela. Multi-empresa NUNCA é chutada.
    async function empresasDoUsuario(): Promise<string[]> {
      if (empresasUsuario) return empresasUsuario
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return []
      const { data } = await supabase.from('user_companies').select('company_id').eq('user_id', user.id)
      empresasUsuario = ((data ?? []) as { company_id: string }[]).map((r) => r.company_id).filter(Boolean)
      return empresasUsuario
    }

    async function resolver() {
      const local = resolveSelectedCompanyId()
      if (local) { if (alive) setCompanyId((prev) => (prev === local ? prev : local)); return }
      const emp = await empresasDoUsuario()
      const unica = emp.length === 1 ? emp[0] : null // só single-company usa o fallback
      if (alive) setCompanyId((prev) => (prev === unica ? prev : unica))
    }

    setAreaPersistida(lerAreaPersistida())
    resolver()
    const interval = setInterval(resolver, 800)
    return () => { alive = false; clearInterval(interval) }
  }, [])

  // seletor-header-empresa · busca nome da empresa selecionada
  useEffect(() => {
    let alive = true
    if (!companyId) {
      setCompanyNome(null)
      return
    }
    ;(async () => {
      const { data } = await supabase
        .from('companies')
        .select('nome_fantasia, razao_social')
        .eq('id', companyId)
        .maybeSingle()
      if (!alive) return
      const nome = (data?.nome_fantasia || data?.razao_social || null) as string | null
      setCompanyNome(nome)
    })()
    return () => { alive = false }
  }, [companyId])

  const { areas, loading } = useAreasVisiveis(companyId)

  const areaAtiva: AreaVisivel | null = useMemo(() => {
    // Cascata alinhada ao useSidebarModulos: query > persistida (escolha
    // explicita) > path > primeira disponivel. Persistida ganha de path pra
    // a escolha do usuario no switcher nao ser revertida pelo auto-sync
    // abaixo quando a navegacao Link nao atualiza o pathname (ex.: rota
    // /dashboard/<area> sem page.tsx; ou empresa multi-area presa no path GE).
    return (
      detectarAreaPorSlug(areas, queryArea) ??
      detectarAreaPorSlug(areas, areaPersistida) ??
      detectarAreaAtivaPorPath(areas, pathname) ??
      areas[0] ??
      null
    )
  }, [areas, queryArea, pathname, areaPersistida])

  // limpa slug orfao no localStorage quando o usuario nao tem mais a area
  useEffect(() => {
    if (!areas.length || !areaPersistida) return
    if (!areas.some((a) => a.area_slug === areaPersistida)) {
      try { localStorage.removeItem(AREA_STORAGE_KEY) } catch { /* noop */ }
      setAreaPersistida(null)
    }
  }, [areas, areaPersistida])

  useEffect(() => {
    if (areaAtiva && areaAtiva.area_slug && areaAtiva.area_slug !== areaPersistida) {
      persistirArea(areaAtiva.area_slug)
      setAreaPersistida(areaAtiva.area_slug)
    }
  }, [areaAtiva, areaPersistida])

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // foco-contratadas · ao fechar, volta "outras areas" pra colapsado
  useEffect(() => {
    if (!open) setOutrasExpand(false)
  }, [open])

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    if (open) document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  const grupos = useMemo(() => {
    const buckets: Record<Grupo, AreaVisivel[]> = {
      contratadas: [],
      disponiveis: [],
      em_dev: [],
      roadmap: [],
    }
    for (const a of areas) {
      if (areaAtiva && a.area_slug === areaAtiva.area_slug) continue
      buckets[classificarGrupo(a)].push(a)
    }
    return buckets
  }, [areas, areaAtiva])

  const ActiveIcon = resolveIcon(areaAtiva?.icone)
  const activeLabel = areaAtiva?.nome_menu ?? (loading ? 'Carregando…' : 'Selecionar área')

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="true"
        data-testid="area-switcher"
        className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-[#C8941A]/18 hover:bg-[#C8941A]/25 border border-[#C8941A]/45 text-[12px] font-medium text-[#FAF7F2] transition-colors"
      >
        <span className="flex items-center gap-2 min-w-0">
          <ActiveIcon size={14} className="text-[#C8941A] flex-shrink-0" />
          <span className="truncate">{activeLabel}</span>
        </span>
        <ChevronDown size={12} className="opacity-70 flex-shrink-0" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute top-full left-0 mt-2 w-[min(470px,calc(100vw-32px))] rounded-2xl p-3 z-50 shadow-[0_1px_2px_rgba(61,35,20,0.05),0_16px_40px_rgba(61,35,20,0.18),0_0_0_0.5px_rgba(61,35,20,0.08)] max-h-[80vh] overflow-y-auto"
          style={{ background: '#FAF7F2' }}
        >
          <div className="px-1 pb-3">
            <div className="text-[10px] tracking-[0.8px] font-medium uppercase" style={{ color: 'rgba(61,35,20,0.55)' }}>
              Trocar de área
            </div>
            <div className="text-[13px] mt-0.5" style={{ color: 'rgba(61,35,20,0.60)' }}>
              {companyNome ? `${companyNome} · ` : ''}selecione a área de trabalho
            </div>
          </div>

          {loading && areas.length === 0 ? (
            <div className="px-3 py-6 text-[12px] text-center" style={{ color: 'rgba(61,35,20,0.55)' }}>
              Carregando áreas…
            </div>
          ) : areas.length === 0 ? (
            <div className="px-3 py-6 text-[12px] text-center" style={{ color: 'rgba(61,35,20,0.55)' }}>
              Nenhuma área disponível. Selecione uma empresa específica.
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {/* Área atual destacada no topo */}
              {areaAtiva && (
                <AreaAtualCard area={areaAtiva} />
              )}

              {/* Sempre visivel · area atual + contratadas */}
              {(['contratadas'] as Grupo[]).map((g) => {
                const itens = grupos[g]
                if (itens.length === 0) return null
                return (
                  <section key={g} aria-label={GRUPO_LABEL[g]}>
                    <div
                      className="px-1 pb-1.5 text-[11px] font-medium uppercase tracking-[0.6px]"
                      style={{ color: 'rgba(61,35,20,0.45)' }}
                    >
                      {GRUPO_LABEL[g]}
                    </div>
                    <ul
                      className="rounded-xl bg-white overflow-hidden"
                      style={{ boxShadow: '0 0 0 0.5px rgba(61,35,20,0.10)' }}
                    >
                      {itens.map((area, i) => (
                        <li key={area.area_slug}>
                          {i > 0 && (
                            <div
                              className="mx-3"
                              style={{ height: 0.5, background: 'rgba(61,35,20,0.08)' }}
                            />
                          )}
                          <AreaListItem
                            area={area}
                            grupo={g}
                            onClick={() => {
                              persistirArea(area.area_slug)
                              setAreaPersistida(area.area_slug)
                              setOpen(false)
                            }}
                          />
                        </li>
                      ))}
                    </ul>
                  </section>
                )
              })}

              {/* Upsell recolhivel · areas nao contratadas (Disponiveis + Em desenvolvimento + Roadmap) */}
              {(() => {
                const totalOutras = grupos.disponiveis.length + grupos.em_dev.length + grupos.roadmap.length
                if (totalOutras === 0) return null
                return (
                  <div>
                    <button
                      type="button"
                      onClick={() => setOutrasExpand((v) => !v)}
                      aria-expanded={outrasExpand}
                      className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl bg-white hover:bg-[rgba(200,148,26,0.06)] transition-colors text-left"
                      style={{ boxShadow: '0 0 0 0.5px rgba(61,35,20,0.10)', minHeight: 44 }}
                    >
                      <span className="text-[13px] font-medium" style={{ color: 'rgba(61,35,20,0.75)' }}>
                        Conhecer outras áreas ({totalOutras})
                      </span>
                      <ChevronDown
                        size={16}
                        style={{
                          color: 'rgba(61,35,20,0.50)',
                          transform: outrasExpand ? 'rotate(180deg)' : 'rotate(0deg)',
                          transition: 'transform 0.15s',
                        }}
                      />
                    </button>

                    {outrasExpand && (
                      <div className="flex flex-col gap-3 mt-3">
                        {(['disponiveis', 'em_dev', 'roadmap'] as Grupo[]).map((g) => {
                          const itens = grupos[g]
                          if (itens.length === 0) return null
                          return (
                            <section key={g} aria-label={GRUPO_LABEL[g]}>
                              <div
                                className="px-1 pb-1.5 text-[11px] font-medium uppercase tracking-[0.6px]"
                                style={{ color: 'rgba(61,35,20,0.45)' }}
                              >
                                {GRUPO_LABEL[g]}
                              </div>
                              <ul
                                className="rounded-xl bg-white overflow-hidden"
                                style={{ boxShadow: '0 0 0 0.5px rgba(61,35,20,0.10)' }}
                              >
                                {itens.map((area, i) => (
                                  <li key={area.area_slug}>
                                    {i > 0 && (
                                      <div
                                        className="mx-3"
                                        style={{ height: 0.5, background: 'rgba(61,35,20,0.08)' }}
                                      />
                                    )}
                                    <AreaListItem
                                      area={area}
                                      grupo={g}
                                      onClick={() => {
                                        persistirArea(area.area_slug)
                                        setAreaPersistida(area.area_slug)
                                        setOpen(false)
                                      }}
                                    />
                                  </li>
                                ))}
                              </ul>
                            </section>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })()}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function AreaAtualCard({ area }: { area: AreaVisivel }) {
  const Icon = resolveIcon(area.icone)
  return (
    <div
      className="flex items-center gap-3 rounded-xl p-3"
      style={{ background: '#FAEEDA' }}
    >
      <div
        className="flex items-center justify-center rounded-md flex-shrink-0"
        style={{ width: 40, height: 40, background: '#FAC775' }}
      >
        <Icon size={20} style={{ color: '#633806' }} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[15px] font-medium leading-tight" style={{ color: '#3D2314' }}>
            {area.nome_menu}
          </span>
          <span
            className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded font-semibold"
            style={{ background: '#FAEEDA', color: '#854F0B', border: '0.5px solid rgba(133,79,11,0.30)' }}
          >
            Área atual
          </span>
        </div>
        {area.descricao_curta && (
          <div className="text-[13px] leading-snug mt-0.5" style={{ color: 'rgba(61,35,20,0.65)' }}>
            {area.descricao_curta}
          </div>
        )}
      </div>
      <div className="text-[12px] font-medium flex-shrink-0" style={{ color: '#854F0B' }}>
        Contratado
      </div>
    </div>
  )
}

function AreaListItem({
  area,
  grupo,
  onClick,
}: {
  area: AreaVisivel
  grupo: Grupo
  onClick: () => void
}) {
  const Icon = resolveIcon(area.icone)
  const acessivel = area.empresa_tem_acesso
  const isRoadmap = grupo === 'roadmap'
  const statusLabel = acessivel
    ? 'Contratado'
    : grupo === 'disponiveis'
      ? 'Disponível'
      : grupo === 'em_dev'
        ? 'Em breve'
        : 'Roadmap'

  const inner = (
    <div
      className={`flex items-center gap-3 px-3 py-3 ${isRoadmap ? 'opacity-60' : ''}`}
      style={{ minHeight: 44 }}
    >
      <div
        className="flex items-center justify-center rounded-md flex-shrink-0"
        style={{
          width: 40,
          height: 40,
          background: isRoadmap ? 'rgba(61,35,20,0.04)' : 'rgba(200,148,26,0.10)',
        }}
      >
        <Icon
          size={20}
          style={{
            color: isRoadmap ? 'rgba(61,35,20,0.45)' : '#C8941A',
          }}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="text-[15px] font-medium leading-tight"
            style={{ color: isRoadmap ? 'rgba(61,35,20,0.55)' : '#3D2314' }}
          >
            {area.nome_menu}
          </span>
          {!isRoadmap && <BadgeStatus status={area.status_comercial} />}
        </div>
        {area.descricao_curta && (
          <div
            className="text-[13px] leading-snug mt-0.5"
            style={{ color: 'rgba(61,35,20,0.55)' }}
          >
            {area.descricao_curta}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <span
          className="text-[12px]"
          style={{ color: isRoadmap ? 'rgba(61,35,20,0.40)' : 'rgba(61,35,20,0.55)' }}
        >
          {statusLabel}
        </span>
        {!isRoadmap && (
          <ChevronRight size={14} style={{ color: 'rgba(61,35,20,0.40)' }} />
        )}
      </div>
    </div>
  )

  if (isRoadmap || !acessivel) {
    return (
      <div
        role="menuitem"
        aria-disabled="true"
        data-testid={`area-${area.area_slug}-locked`}
        title={!acessivel ? (area.motivo_acesso ?? 'Sem plano contratado') : 'Roadmap'}
        className="cursor-not-allowed hover:bg-[rgba(200,148,26,0.04)]"
      >
        {inner}
      </div>
    )
  }

  return (
    <Link
      href={area.rota_raiz}
      role="menuitem"
      onClick={onClick}
      data-testid={`area-${area.area_slug}`}
      className="block hover:bg-[rgba(200,148,26,0.06)] transition-colors"
    >
      {inner}
    </Link>
  )
}
