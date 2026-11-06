'use client'

// Indicadores da viagem (auditor 24/10): por obra — custo de viagem por m² executado, por km e por dia de equipe, e o %
// do custo previsto com alerta acima do limite; por rota — o histórico das viagens fechadas para orçar a próxima
// mobilização. Só lê a fn_viagem_indicadores (mesma fonte do Resultado da obra); esta tela não calcula nada.
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ESP = '#3D2314', GOLD = '#C8941A', LINE = '#E7DECF'
type IndObra = { obra_id: string; numero: string; nome: string; viagens: number; custo_viagens: number; confere: boolean; m2_executado: number; custo_m2: number | null; custo_km: number | null; custo_dia: number | null; pct_orcado: number | null; alerta: boolean; preco_mobilizacao: number | null; mobilizacao_tabela: string | null; mobilizacao_pct: number | null; mobilizacao_alerta: boolean | null }
type IndRota = { origem: string; destino: string; viagens: number; custo_medio: number; km_medio: number | null; dias_medio: number; custo_km: number | null; custo_dia: number; ultima: string }
type Ind = { obras: IndObra[]; rotas: IndRota[]; alertas: number; mobilizacao_alertas?: number; confere: boolean }
const brl = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }))
const num = (n: number | null | undefined, d = 1) => (n == null ? '—' : n.toLocaleString('pt-BR', { maximumFractionDigits: d }))
const dt = (s: string) => s.split('-').reverse().join('/')
// drill-down para o Resultado da obra (cockpit): o custo de viagem desta tela é o mesmo que entra no Resultado da obra
// (fn_viagem_indicadores → v_obra_resultado). Mesmo padrão aprovado em /obras/resultado (#3206). Auditor 25/10.
const cockpit = (obraId: string) => `/dashboard/projetos/obras/${obraId}/cockpit`

export function IndicadoresViagem({ empresa }: { empresa: string }) {
  const [limite, setLimite] = useState('5')
  const [ind, setInd] = useState<Ind | null>(null)
  const [erro, setErro] = useState('')

  useEffect(() => {
    const pct = Number(limite.replace(',', '.'))
    if (!Number.isFinite(pct) || pct < 0) return
    let vivo = true
    supabase.rpc('fn_viagem_indicadores', { p_company_id: empresa, p_obra_id: null, p_limite_pct: pct }).then(({ data, error }) => {
      if (!vivo) return
      setErro(error?.message ?? ''); setInd((data as Ind) ?? null)
    })
    return () => { vivo = false }
  }, [empresa, limite])

  // A seção (cabeçalho + controle de %) sempre aparece: antes ela sumia por inteiro enquanto a fn_viagem_indicadores
  // não respondia (ind === null), o que o auditor lia como "indicadores cortados/sem linhas". Agora: erro → aviso;
  // carregando → esqueleto; carregado → tabela ou estado vazio.
  return (
    <section className="mt-6 space-y-3" aria-label="Indicadores da viagem">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h2 className="text-lg font-semibold">Indicadores da viagem</h2>
        <label className="flex flex-col gap-1 text-xs"><span className="inline-flex items-center">Alerta acima de (% do orçado)<AjudaCampo chave="projetos.viagem.ind_limite" /></span>
          <span className="relative w-28"><input inputMode="decimal" className="w-full rounded-lg border bg-white px-2 py-1.5 pr-7 text-right text-sm" style={{ borderColor: LINE }} value={limite} onChange={(e) => setLimite(e.target.value)} aria-label="Alerta acima de (% do custo previsto)" /><span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-sm opacity-60">%</span></span></label>
      </div>

      {erro
        ? <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-2 text-sm text-red-800">{erro}</div>
        : !ind
          ? <div role="status" aria-label="Carregando indicadores" className="space-y-2">
            <div className="h-20 animate-pulse rounded-xl border bg-white" style={{ borderColor: LINE }} />
            <div className="h-16 animate-pulse rounded-xl border bg-white" style={{ borderColor: LINE }} />
          </div>
          : <IndCorpo ind={ind} limite={limite} />}
    </section>
  )
}

function IndCorpo({ ind, limite }: { ind: Ind; limite: string }) {
  return (
    <>
      {ind.alertas > 0 && <div role="status" className="rounded-lg border p-2 text-sm" style={{ borderColor: GOLD, background: '#FFF7E6' }}>{ind.alertas} obra(s) com viagem acima de {limite}% do custo previsto.</div>}
      {(ind.mobilizacao_alertas ?? 0) > 0 && <div role="status" className="rounded-lg border p-2 text-sm" style={{ borderColor: '#B42318', background: '#FEF2F2', color: '#7A271A' }}>{ind.mobilizacao_alertas} obra(s) com custo de deslocamento ACIMA do preço de mobilização do contrato — o excesso sai da margem.</div>}

      {ind.obras.length === 0
        ? <p className="rounded-xl border bg-white p-4 text-sm opacity-70" style={{ borderColor: LINE }}>Sem custo de viagem nas obras ainda. Os indicadores aparecem depois do primeiro cupom lançado.</p>
        : <div className="overflow-x-auto rounded-xl border bg-white" style={{ borderColor: LINE }}>
          <table className="w-full min-w-[760px] text-sm">
            <thead><tr className="text-left text-xs font-medium" style={{ color: ESP, background: '#FAF7F2' }}>
              <th className="p-2">Obra</th>
              <Th rotulo="Custo de viagem" chave="projetos.viagem.rel_custo_obra" />
              <Th rotulo="Por m²" chave="projetos.viagem.ind_custo_m2" />
              <Th rotulo="Por km" chave="projetos.viagem.ind_custo_km" />
              <Th rotulo="Por dia" chave="projetos.viagem.ind_custo_dia" />
              <Th rotulo="% do orçado" chave="projetos.viagem.ind_pct_orcado" />
              <Th rotulo="Mobilização (contrato)" chave="projetos.viagem.ind_mobilizacao" />
            </tr></thead>
            <tbody>{ind.obras.map((o) => (
              <tr key={o.obra_id} className="border-t" style={{ borderColor: LINE }}>
                <td className="p-2"><Link href={cockpit(o.obra_id)} style={{ color: GOLD, textDecoration: 'none' }} title="Abrir o Resultado da obra (cockpit)"><b>{o.numero}</b> · {o.nome}</Link><div className="text-xs opacity-60">{o.viagens} viagem(ns){o.m2_executado > 0 ? ` · ${num(o.m2_executado)} m² executados` : ''}</div></td>
                <td className="p-2 text-right">{brl(o.custo_viagens)}</td>
                <td className="p-2 text-right">{brl(o.custo_m2)}</td>
                <td className="p-2 text-right">{brl(o.custo_km)}</td>
                <td className="p-2 text-right">{brl(o.custo_dia)}</td>
                <td className="p-2 text-right font-medium" style={{ color: o.alerta ? '#B42318' : ESP }}>{o.alerta && <AlertTriangle aria-label="Acima do limite" className="mr-1 inline h-3.5 w-3.5 align-[-2px]" />}{o.pct_orcado == null ? '—' : `${num(o.pct_orcado, 2)}%`}</td>
                <MobilizacaoCell o={o} />
              </tr>))}</tbody>
          </table>
          <p className="px-2 pb-2 text-xs opacity-70">{ind.confere ? 'Confere com o Resultado da obra' : 'Não confere com o Resultado da obra — avise o suporte'}<AjudaCampo chave="projetos.viagem.rel_confere" /></p>
        </div>}

      <h3 className="pt-1 text-sm font-semibold">Histórico por rota<AjudaCampo chave="projetos.viagem.ind_rota" /></h3>
      {ind.rotas.length === 0
        ? <p className="rounded-xl border bg-white p-4 text-sm opacity-70" style={{ borderColor: LINE }}>Nenhuma viagem fechada com origem e destino ainda.</p>
        : <ul className="grid gap-2 sm:grid-cols-2">{ind.rotas.map((r) => (
          <li key={`${r.origem}→${r.destino}`} className="rounded-xl border bg-white p-3 text-sm" style={{ borderColor: LINE }}>
            <b>{r.origem} → {r.destino}</b> <span className="text-xs opacity-60">· {r.viagens} viagem(ns) · última {dt(r.ultima)}</span>
            <div className="mt-1 grid grid-cols-2 gap-1 text-xs">
              <span className="inline-flex items-center">Custo médio<AjudaCampo chave="projetos.viagem.rota_custo_medio" /> <b className="ml-1">{brl(r.custo_medio)}</b></span><span className="inline-flex items-center">Km médio<AjudaCampo chave="projetos.viagem.rota_km_medio" /> <b className="ml-1">{num(r.km_medio)}</b></span>
              <span className="inline-flex items-center">Dias médios<AjudaCampo chave="projetos.viagem.rota_dias_medio" /> <b className="ml-1">{num(r.dias_medio)}</b></span><span className="inline-flex items-center">Por km<AjudaCampo chave="projetos.viagem.rota_custo_km" /> <b className="ml-1">{brl(r.custo_km)}</b></span>
              <span className="inline-flex items-center">Por dia<AjudaCampo chave="projetos.viagem.rota_custo_dia" /> <b className="ml-1">{brl(r.custo_dia)}</b></span>
            </div>
          </li>))}</ul>}
    </>
  )
}

// comparativo custo real de deslocamento × preço de mobilização do contrato do cliente (decisão CEO 22/10, FC Pisos).
// Sem verba de mobilização no contrato → estado vazio honesto (não inventa número — RD-38). Com verba: preço + o quanto
// o real representa dele (abaixo de 100% coube; acima estourou e sai da margem).
function MobilizacaoCell({ o }: { o: IndObra }) {
  if (o.preco_mobilizacao == null) return (
    <td className="p-2 text-right align-top">
      <span className="text-xs opacity-45" title="Cadastre a verba de mobilização na tabela de preços do cliente">sem verba no contrato</span>
      <span className="inline-flex"><AjudaCampo chave="projetos.viagem.ind_mobilizacao" alinhar="fim" /></span>
    </td>
  )
  const acima = o.mobilizacao_alerta === true
  return (
    <td className="p-2 text-right align-top">
      <div className="font-medium" style={{ color: ESP }}>{brl(o.preco_mobilizacao)}</div>
      {o.mobilizacao_pct != null && (
        <span className="mt-0.5 inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-1.5 py-0.5 text-[11px] font-medium"
          style={acima ? { borderColor: '#B42318', color: '#B42318', background: '#FEF2F2' } : { borderColor: GOLD, color: GOLD, background: '#FBF3E0' }}>
          {acima && <AlertTriangle aria-hidden className="h-3 w-3" />}real {num(o.mobilizacao_pct, 0)}%<AjudaCampo chave="projetos.viagem.ind_mob_pct" alinhar="fim" /></span>
      )}
    </td>
  )
}

// cabeçalho numérico: rótulo e "?" lado a lado, alinhados à direita, sem opacidade (o "?" precisa aparecer inteiro)
function Th({ rotulo, chave }: { rotulo: string; chave: string }) {
  return <th className="p-2 text-right"><span className="inline-flex items-center justify-end whitespace-nowrap">{rotulo}<AjudaCampo chave={chave} alinhar="fim" /></span></th>
}
