'use client'

// Consumo do veículo (auditor 24/10, gap "Abastecimento na viagem"): km/l pelo método do tanque cheio, combustível por km,
// preço médio do litro e custo total da viagem por km, juntando todas as viagens da placa. Só lê a fn_viagem_consumo
// (o custo vem da mesma fonte do Resultado da obra); esta tela não calcula nada.
import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const LINE = '#E7DECF'
type Veiculo = { placa: string; abastecimentos: number; litros: number; preco_litro: number; trechos: number; km_l: number | null; combustivel_km: number | null; viagens: number; custo_km: number | null; sem_hodometro: number }
type Trecho = { placa: string; hod_ini: number; hod_fim: number; km: number; litros: number; km_l: number; combustivel_km: number; alerta: boolean }
type Consumo = { veiculos: Veiculo[]; trechos: Trecho[] }
const brl = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }))
const num = (n: number | null | undefined, d = 2) => (n == null ? '—' : n.toLocaleString('pt-BR', { maximumFractionDigits: d }))

export function ConsumoVeiculo({ empresa, placa }: { empresa: string; placa: string }) {
  const [c, setC] = useState<Consumo | null>(null)
  const [erro, setErro] = useState('')

  useEffect(() => {
    let vivo = true
    supabase.rpc('fn_viagem_consumo', { p_company_id: empresa, p_placa: placa }).then(({ data, error }) => {
      if (!vivo) return
      setErro(error?.message ?? ''); setC((data as Consumo) ?? null)
    })
    return () => { vivo = false }
  }, [empresa, placa])

  if (erro) return <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-2 text-sm text-red-800">{erro}</div>
  const v = c?.veiculos[0]
  if (!v) return null
  return (
    <section className="rounded-xl border bg-white p-3" style={{ borderColor: LINE }} aria-label={`Consumo do veículo ${v.placa}`}>
      <h3 className="text-sm font-semibold">Consumo do veículo {v.placa} <span className="text-xs font-normal opacity-60">· {v.viagens} viagem(ns) · {v.abastecimentos} abastecimento(s)</span></h3>
      <p className="text-xs opacity-70">Junta todas as viagens desta placa (tanque cheio a tanque cheio). O consumo acima, no resumo, é só desta viagem.</p>
      <div className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <div>Consumo médio do veículo<AjudaCampo chave="projetos.viagem.cons_km_l" /><br /><b>{v.km_l == null ? 'falta 2º tanque cheio' : `${num(v.km_l)} km/l`}</b></div>
        <div>Combustível por km<AjudaCampo chave="projetos.viagem.cons_combustivel_km" /><br /><b>{brl(v.combustivel_km)}</b></div>
        <div>Preço médio do litro<AjudaCampo chave="projetos.viagem.cons_preco_litro" /><br /><b>{brl(v.preco_litro)}</b></div>
        <div>Viagem por km<AjudaCampo chave="projetos.viagem.cons_custo_km" /><br /><b>{brl(v.custo_km)}</b></div>
      </div>
      {v.sem_hodometro > 0 && <p className="mt-1 text-xs opacity-70">{v.sem_hodometro} abastecimento(s) sem hodômetro ficaram fora do consumo.</p>}
      {c.trechos.length > 0 && <>
        <div className="mt-3 text-xs font-medium">Trechos de tanque cheio<AjudaCampo chave="projetos.viagem.cons_trecho" /></div>
        <div className="mt-1 overflow-x-auto">
          <table className="w-full min-w-[480px] text-xs">
            <thead><tr className="text-left opacity-70"><th className="p-1">Hodômetro</th><th className="p-1 text-right">Km</th><th className="p-1 text-right">Litros</th><th className="p-1 text-right">Km/l</th><th className="p-1 text-right">R$/km</th></tr></thead>
            <tbody>{c.trechos.map((t) => (
              <tr key={`${t.placa}-${t.hod_ini}`} className="border-t" style={{ borderColor: LINE, color: t.alerta ? '#B42318' : undefined }}>
                <td className="p-1">{num(t.hod_ini, 0)} → {num(t.hod_fim, 0)}</td>
                <td className="p-1 text-right">{num(t.km, 0)}</td>
                <td className="p-1 text-right">{num(t.litros)}</td>
                <td className="p-1 text-right font-medium">{t.alerta && <AlertTriangle aria-label="Consumo acima do normal do veículo" className="mr-1 inline h-3 w-3 align-[-2px]" />}{num(t.km_l)}</td>
                <td className="p-1 text-right">{brl(t.combustivel_km)}</td>
              </tr>))}</tbody>
          </table>
        </div>
      </>}
    </section>
  )
}
