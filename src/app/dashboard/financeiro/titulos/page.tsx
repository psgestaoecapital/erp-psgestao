'use client'

// src/app/dashboard/financeiro/titulos/page.tsx
//
// Aba Titulos Consolidada — visao unificada de contas a pagar + receber.
//
// Existencia: criada em 12/05/2026 atendendo feedback da Jordana (operadora BPO)
// que verbalizou "sinto falta de uma aba em que possamos conferir todos os
// titulos a pagar e receber, para que possamos ter uma visao total do que
// temos registrado no sistema."
//
// Padrao: Client Component (consistente com demais pages do dashboard que
// usam useCompanyIds para multi-tenant). Filtros via state local — URL
// preserva o estado via useSearchParams + router.replace para CTAs
// vindas do meu-dia.
//
// Identidade: Estrela Polar V1.2 — espresso/off-white/dourado.
// Cores semaforicas APENAS para status calculado.

import Link from 'next/link'
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CalendarClock,
  Filter,
  Search,
} from 'lucide-react'

export const dynamic = 'force-dynamic'

type TipoFiltro = 'todos' | 'pagar' | 'receber'
type StatusFiltro = 'todos' | 'aberto' | 'vencido' | 'agendado' | 'pago' | 'cancelado'

type Titulo = {
  id: string
  company_id: string
  tipo: 'pagar' | 'receber'
  descricao: string | null
  contraparte_nome: string | null
  valor: number | null
  data_vencimento: string | null
  data_pagamento: string | null
  status: string
  status_calculado: string
  categoria: string | null
  numero_documento: string | null
  numero_nf: string | null
}

const PAGE_SIZE = 50

function fmtBRL(v: number | null | undefined): string {
  if (v == null) return '—'
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
function fmtDate(d: string | null): string {
  if (!d) return '—'
  return new Date(d + 'T00:00:00').toLocaleDateString('pt-BR')
}
function statusBadge(status: string, tipoLinha?: string): { bg: string; tx: string; label: string } {
  switch (status) {
    case 'pago':
      // Pilar 3: conta a RECEBER quitada = "Recebido" (entrou dinheiro), não "Pago".
      return { bg: 'bg-emerald-50', tx: 'text-emerald-700', label: tipoLinha === 'receber' ? 'Recebido' : 'Pago' }
    case 'agendado':
      return { bg: 'bg-blue-50', tx: 'text-blue-700', label: 'Agendado' }
    case 'aberto':
      return { bg: 'bg-amber-50', tx: 'text-amber-700', label: 'Aberto' }
    case 'vencido':
      return { bg: 'bg-rose-50', tx: 'text-rose-700', label: 'Vencido' }
    case 'cancelado':
      return { bg: 'bg-stone-50', tx: 'text-stone-500', label: 'Cancelado' }
    default:
      return { bg: 'bg-stone-50', tx: 'text-stone-600', label: status }
  }
}

export default function TitulosPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#FAF7F2] p-8 text-[#3D2314]">Carregando…</div>}>
      <TitulosInner />
    </Suspense>
  )
}

function TitulosInner() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const { companyIds, companies, selInfo } = useCompanyIds()
  const companyIdsKey = useMemo(() => [...(companyIds ?? [])].sort().join(','), [companyIds])

  // Filtros derivados da URL (deep-linkable, vem do meu-dia)
  const tipo = (searchParams?.get('tipo') as TipoFiltro) || 'todos'
  const status = (searchParams?.get('status') as StatusFiltro) || 'todos'
  const empresaSP = searchParams?.get('empresa')
  const empresa = empresaSP && companyIds.includes(empresaSP) ? empresaSP : 'todas'
  const page = Math.max(1, parseInt(searchParams?.get('page') || '1', 10) || 1)
  const offset = (page - 1) * PAGE_SIZE

  const [titulos, setTitulos] = useState<Titulo[]>([])
  const [aggregados, setAggregados] = useState<{ tipo: string; valor: number | null; status_calculado: string }[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  function urlComFiltro(patch: Record<string, string>): string {
    const params = new URLSearchParams()
    const merged: Record<string, string> = {
      tipo, status, empresa, page: String(page), ...patch,
    }
    Object.entries(merged).forEach(([k, v]) => {
      if (v && v !== 'todos' && v !== 'todas' && v !== '1') params.set(k, v)
    })
    const qs = params.toString()
    return qs ? `${pathname}?${qs}` : pathname || '/dashboard/financeiro/titulos'
  }

  const carregar = useCallback(async () => {
    if (companyIds.length === 0) {
      setTitulos([])
      setAggregados([])
      setTotal(0)
      setLoading(false)
      return
    }
    setLoading(true)
    setErro(null)
    try {
      const ids = empresa !== 'todas' ? [empresa] : companyIds
      let q = supabase
        .from('v_titulos_consolidados')
        .select(
          'id, company_id, tipo, descricao, contraparte_nome, valor, data_vencimento, data_pagamento, status, status_calculado, categoria, numero_documento, numero_nf',
          { count: 'exact' },
        )
        .in('company_id', ids)
      if (tipo !== 'todos') q = q.eq('tipo', tipo)
      if (status !== 'todos') q = q.eq('status_calculado', status)
      q = q
        .order('data_vencimento', { ascending: false, nullsFirst: false })
        .range(offset, offset + PAGE_SIZE - 1)
      const { data, count, error } = await q
      if (error) throw error
      setTitulos((data ?? []) as Titulo[])
      setTotal(count ?? 0)

      // Agregados separados (para KPIs no header)
      const aggQ = supabase
        .from('v_titulos_consolidados')
        .select('tipo, valor, status_calculado')
        .in('company_id', ids)
      const { data: aggData } = await aggQ
      setAggregados((aggData ?? []) as { tipo: string; valor: number | null; status_calculado: string }[])
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setErro(msg || 'Falha ao carregar títulos.')
    } finally {
      setLoading(false)
    }
  }, [companyIdsKey, tipo, status, empresa, offset])

  useEffect(() => { carregar() }, [carregar])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  // KPIs agregados
  const kpiPagar = aggregados
    .filter((t) => t.tipo === 'pagar' && ['aberto', 'vencido', 'agendado'].includes(t.status_calculado))
    .reduce((a, t) => a + (Number(t.valor) || 0), 0)
  const kpiReceber = aggregados
    .filter((t) => t.tipo === 'receber' && ['aberto', 'vencido', 'agendado'].includes(t.status_calculado))
    .reduce((a, t) => a + (Number(t.valor) || 0), 0)
  const kpiVencido = aggregados
    .filter((t) => t.status_calculado === 'vencido')
    .reduce((a, t) => a + (Number(t.valor) || 0), 0)

  return (
    <div className="min-h-screen bg-[#FAF7F2]">
      <div className="mx-auto max-w-7xl px-4 py-6 md:px-8 md:py-10">
        {/* Header */}
        <header className="mb-8">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#3D2314]">
              <CalendarClock className="h-6 w-6 text-[#C8941A]" />
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-[#3D2314]/50">
                Financeiro · Visão Consolidada
              </p>
              <h1 className="mt-1 text-2xl font-semibold text-[#3D2314] md:text-3xl">
                Títulos a pagar e a receber
              </h1>
              <p className="mt-1 text-sm text-[#3D2314]/60">
                Todos os títulos registrados no sistema, em uma única tela.
              </p>
            </div>
          </div>
        </header>

        {/* Erro */}
        {erro && (
          <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {erro}
          </div>
        )}

        {/* KPIs */}
        <section className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-3">
          <KpiCard label="A pagar (aberto + vencido + agendado)" valor={kpiPagar} tone="amber" Icon={ArrowUpFromLine} />
          <KpiCard label="A receber (aberto + vencido + agendado)" valor={kpiReceber} tone="emerald" Icon={ArrowDownToLine} />
          <KpiCard label="Total vencido" valor={kpiVencido} tone="rose" Icon={CalendarClock} />
        </section>

        {/* Filtros */}
        <section className="mb-6 rounded-2xl border border-[#3D2314]/10 bg-white p-4 md:p-5">
          <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-[#3D2314]/50">
            <Filter className="h-3.5 w-3.5" /> Filtros
          </div>
          <div className="flex flex-wrap gap-2">
            <FiltroGrupo
              label="Tipo"
              opcoes={[
                { v: 'todos', l: 'Todos' },
                { v: 'pagar', l: 'A pagar' },
                { v: 'receber', l: 'A receber' },
              ]}
              atual={tipo}
              campo="tipo"
              urlBuilder={urlComFiltro}
            />
            <FiltroGrupo
              label="Status"
              opcoes={[
                { v: 'todos', l: 'Todos' },
                { v: 'aberto', l: 'Aberto' },
                { v: 'vencido', l: 'Vencido' },
                { v: 'agendado', l: 'Agendado' },
                { v: 'pago', l: 'Pago' },
                { v: 'cancelado', l: 'Cancelado' },
              ]}
              atual={status}
              campo="status"
              urlBuilder={urlComFiltro}
            />
          </div>
          {companies && companies.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium uppercase tracking-wider text-[#3D2314]/50">
                Empresa:
              </span>
              <Link
                href={urlComFiltro({ empresa: 'todas' })}
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  empresa === 'todas' ? 'bg-[#3D2314] text-white' : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
                }`}
              >
                Todas ({selInfo.tipo === 'consolidado' ? selInfo.count : companies.length})
              </Link>
              {companies.slice(0, 12).map((c: { id: string; nome_fantasia?: string | null; razao_social?: string | null }) => (
                <Link
                  key={c.id}
                  href={urlComFiltro({ empresa: c.id })}
                  className={`rounded-full px-3 py-1 text-xs font-medium ${
                    empresa === c.id ? 'bg-[#3D2314] text-white' : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
                  }`}
                >
                  {c.nome_fantasia || c.razao_social || c.id.slice(0, 8)}
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* Tabela */}
        <section className="overflow-hidden rounded-2xl border border-[#3D2314]/10 bg-white">
          <div className="border-b border-[#3D2314]/10 px-4 py-3 text-xs font-medium uppercase tracking-wider text-[#3D2314]/50 md:px-5">
            {total.toLocaleString('pt-BR')} título{total !== 1 ? 's' : ''}
          </div>
          {loading ? (
            <div className="px-5 py-12 text-center text-sm text-[#3D2314]/60">Carregando…</div>
          ) : titulos.length === 0 ? (
            <div className="px-5 py-12 text-center text-sm text-[#3D2314]/60">
              <Search className="mx-auto mb-3 h-8 w-8 text-[#3D2314]/30" />
              Nenhum título encontrado com esses filtros.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-[#FAF7F2] text-left text-xs font-medium uppercase tracking-wider text-[#3D2314]/60">
                  <tr>
                    <th className="px-4 py-3 md:px-5">Tipo</th>
                    <th className="px-4 py-3">Contraparte</th>
                    <th className="px-4 py-3">Descrição</th>
                    <th className="px-4 py-3">Vencimento</th>
                    <th className="px-4 py-3 text-right">Valor</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#3D2314]/5">
                  {titulos.map((t) => {
                    const sb = statusBadge(t.status_calculado, t.tipo)
                    return (
                      <tr key={`${t.tipo}-${t.id}`} className="hover:bg-[#FAF7F2]/60">
                        <td className="whitespace-nowrap px-4 py-3 md:px-5">
                          <span
                            className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium ${
                              t.tipo === 'pagar' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'
                            }`}
                          >
                            {t.tipo === 'pagar' ? 'P' : 'R'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-[#3D2314]">{t.contraparte_nome || '—'}</td>
                        <td className="px-4 py-3 text-[#3D2314]/70">
                          {t.descricao || '—'}
                          {t.numero_nf && (
                            <span className="ml-1 text-xs text-[#3D2314]/40">· NF {t.numero_nf}</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-[#3D2314]/70">{fmtDate(t.data_vencimento)}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-medium text-[#3D2314]">
                          {fmtBRL(Number(t.valor))}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${sb.bg} ${sb.tx}`}>
                            {sb.label}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-[#3D2314]/10 px-4 py-3 md:px-5">
              <span className="text-xs text-[#3D2314]/50">
                Página {page} de {totalPages}
              </span>
              <div className="flex gap-2">
                {page > 1 && (
                  <Link
                    href={urlComFiltro({ page: String(page - 1) })}
                    className="rounded-md border border-[#3D2314]/15 px-3 py-1 text-xs font-medium text-[#3D2314] hover:bg-[#FAF7F2]"
                  >
                    ← Anterior
                  </Link>
                )}
                {page < totalPages && (
                  <Link
                    href={urlComFiltro({ page: String(page + 1) })}
                    className="rounded-md bg-[#3D2314] px-3 py-1 text-xs font-medium text-white hover:bg-[#3D2314]/90"
                  >
                    Próxima →
                  </Link>
                )}
              </div>
            </div>
          )}
        </section>

        <footer className="mt-6 text-xs text-[#3D2314]/40">
          PS Gestão · Financeiro · view v_titulos_consolidados · Estrela Polar V1.2
        </footer>
      </div>
      {/* router usage signal (silenced lint) */}
      {router && null}
    </div>
  )
}

/* ─────────── Sub-componentes ─────────── */

function KpiCard({
  label, valor, tone, Icon,
}: {
  label: string; valor: number;
  tone: 'amber' | 'emerald' | 'rose';
  Icon: typeof CalendarClock;
}) {
  const tones = {
    amber: 'bg-amber-50 text-amber-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    rose: 'bg-rose-50 text-rose-700',
  } as const
  return (
    <div className="rounded-2xl border border-[#3D2314]/10 bg-white p-4">
      <div className="flex items-center gap-2">
        <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${tones[tone]}`}>
          <Icon className="h-4 w-4" />
        </div>
        <p className="text-xs text-[#3D2314]/60">{label}</p>
      </div>
      <p className="mt-3 text-2xl font-semibold text-[#3D2314]">
        {valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
      </p>
    </div>
  )
}

function FiltroGrupo({
  label, opcoes, atual, campo, urlBuilder,
}: {
  label: string;
  opcoes: { v: string; l: string }[];
  atual: string;
  campo: string;
  urlBuilder: (patch: Record<string, string>) => string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs font-medium uppercase tracking-wider text-[#3D2314]/50">{label}:</span>
      {opcoes.map((o) => (
        <Link
          key={o.v}
          href={urlBuilder({ [campo]: o.v })}
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            atual === o.v ? 'bg-[#3D2314] text-white' : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
          }`}
        >
          {o.l}
        </Link>
      ))}
    </div>
  )
}
