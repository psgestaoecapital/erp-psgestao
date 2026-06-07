'use client'

import { useState, useRef, useEffect, useMemo, Suspense } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { ChevronDown, Sparkles, type LucideIcon } from 'lucide-react'
import * as LucideIcons from 'lucide-react'
import { useAreasVisiveis, type AreaVisivel } from '@/hooks/useAreasVisiveis'

// FIX-NAV-COMMERCE-EM-GE-v1 · area selection prioriza ?area= e persiste em localStorage
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
  // match pelo prefixo mais longo (evita /dashboard pegar tudo)
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

function StatusBadge({ status }: { status: AreaVisivel['status_comercial'] }) {
  if (status === 'piloto') {
    return (
      <span className="text-[9px] uppercase tracking-wider bg-[#FAEEDA] text-[#633806] px-1.5 py-0.5 rounded font-medium border border-[#E8C387]">
        Piloto
      </span>
    )
  }
  if (status === 'backlog' || status === 'futuro') {
    return (
      <span className="text-[9px] uppercase tracking-wider bg-[#3D2314]/8 text-[#3D2314]/70 px-1.5 py-0.5 rounded font-medium">
        Em breve
      </span>
    )
  }
  return null
}

// FIX-NAV-COMMERCE-EM-GE-v1 · wrap em Suspense pq useSearchParams forca CSR
// bailout · sem isso o prerender estatico falha em paginas tipo redirect-only.
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
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [areaPersistida, setAreaPersistida] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const pathname = usePathname() || ''
  const searchParams = useSearchParams()
  const queryArea = searchParams?.get('area') ?? null

  // Resolve company atual + escuta trocas via polling (mesmo padrão de useCompanyIds)
  useEffect(() => {
    if (typeof window === 'undefined') return
    setCompanyId(resolveSelectedCompanyId())
    setAreaPersistida(lerAreaPersistida())
    const interval = setInterval(() => {
      const atual = resolveSelectedCompanyId()
      setCompanyId((prev) => (prev === atual ? prev : atual))
    }, 800)
    return () => clearInterval(interval)
  }, [])

  const { areas, loading } = useAreasVisiveis(companyId)

  // FIX-NAV-COMMERCE-EM-GE-v1 · ordem de prioridade pra detectar area ativa:
  //   1. ?area= no querystring (ex.: /dashboard/commerce/compras?area=gestao_empresarial)
  //   2. area persistida em localStorage (mantida ao navegar entre rotas)
  //   3. match pelo prefixo do pathname (rota_raiz)
  const areaAtiva: AreaVisivel | null = useMemo(() => {
    return (
      detectarAreaPorSlug(areas, queryArea) ??
      detectarAreaAtivaPorPath(areas, pathname) ??
      detectarAreaPorSlug(areas, areaPersistida)
    )
  }, [areas, queryArea, pathname, areaPersistida])

  // Persiste area atual em localStorage pra sobreviver a navegacoes sem ?area=
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

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    if (open) document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

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
          className="absolute top-full left-0 mt-2 w-[340px] bg-[#FAF7F2] rounded-2xl p-2 z-50 shadow-[0_1px_2px_rgba(61,35,20,0.05),0_16px_40px_rgba(61,35,20,0.18),0_0_0_0.5px_rgba(61,35,20,0.08)] max-h-[480px] overflow-y-auto"
        >
          <div className="px-3 py-2 text-[10px] text-[#3D2314]/55 tracking-[0.8px] font-medium uppercase">
            Trocar de área
          </div>
          {loading && areas.length === 0 ? (
            <div className="px-3 py-6 text-[12px] text-[#3D2314]/55 text-center">
              Carregando áreas…
            </div>
          ) : areas.length === 0 ? (
            <div className="px-3 py-6 text-[12px] text-[#3D2314]/55 text-center">
              Nenhuma área disponível. Selecione uma empresa específica.
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-1">
              {areas.map((area) => {
                const Icon = resolveIcon(area.icone)
                const isAtual = areaAtiva?.area_slug === area.area_slug
                const acessivel = area.empresa_tem_acesso

                const base =
                  'flex items-start gap-2.5 px-3 py-2.5 rounded-lg transition-colors text-left min-w-0'

                const inner = (
                  <>
                    <Icon
                      size={18}
                      className={acessivel ? 'text-[#C8941A] flex-shrink-0 mt-[1px]' : 'text-[#3D2314]/35 flex-shrink-0 mt-[1px]'}
                    />
                    <div className="min-w-0 flex-1">
                      <div
                        className={`text-[12.5px] font-medium leading-tight flex items-center gap-1.5 flex-wrap ${
                          isAtual ? 'text-[#C8941A]' : acessivel ? 'text-[#3D2314]' : 'text-[#3D2314]/55'
                        }`}
                      >
                        <span className="truncate">{area.nome_menu}</span>
                        <StatusBadge status={area.status_comercial} />
                      </div>
                      {area.descricao_curta && (
                        <div className="text-[10.5px] text-[#3D2314]/60 leading-[1.4] mt-[2px] line-clamp-2">
                          {area.descricao_curta}
                        </div>
                      )}
                      {!acessivel && (
                        <div className="text-[10px] text-[#633806] mt-1 font-medium">
                          Sem plano contratado
                        </div>
                      )}
                    </div>
                  </>
                )

                if (acessivel) {
                  return (
                    <Link
                      key={area.area_slug}
                      href={area.rota_raiz}
                      role="menuitem"
                      onClick={() => { persistirArea(area.area_slug); setAreaPersistida(area.area_slug); setOpen(false) }}
                      data-testid={`area-${area.area_slug}`}
                      className={`${base} ${
                        isAtual
                          ? 'bg-[#C8941A]/12 ring-1 ring-[#C8941A]/30'
                          : 'hover:bg-[#C8941A]/10'
                      }`}
                    >
                      {inner}
                    </Link>
                  )
                }

                return (
                  <div
                    key={area.area_slug}
                    role="menuitem"
                    aria-disabled="true"
                    data-testid={`area-${area.area_slug}-locked`}
                    title={area.motivo_acesso ?? 'Sem plano contratado'}
                    className={`${base} opacity-70 cursor-not-allowed`}
                  >
                    {inner}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
