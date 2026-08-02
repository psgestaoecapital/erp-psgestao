'use client'

// RD-41 · Oficina genérica — Fase 1. O "ramo" da oficina (config em erp_oficina_parametros,
// lido via fn_oficina_ramo) dirige LABELS, CAMPOS e CATEGORIAS. Config-driven: nada de regra
// hardcoded por cliente. O banco (RD-26) já é genérico (placa/veículo/km nullable) — aqui só
// ligamos/desligamos a camada "automotiva" do frontend. Automotiva = comportamento atual (KGF).

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export type Ramo = 'automotiva' | 'retifica' | 'usinagem' | 'eletrica' | 'geral'
export const RAMOS: Ramo[] = ['automotiva', 'retifica', 'usinagem', 'eletrica', 'geral']

export interface Categoria { id: string; label: string }

export interface RamoConfig {
  ramo: Ramo
  /** placa/veículo/km/combustível são o modelo do objeto (só a automotiva). */
  automotivo: boolean
  /** título do objeto da OS: "Veículo" | "Peça / trabalho". */
  objetoLabel: string
  /** minúsculo p/ frases: "veículo" | "peça". */
  objetoLabelCurto: string
  /** identificação principal: "Placa" | "Peça". */
  identLabel: string
  identPlaceholder: string
  /** título da recepção. */
  recepcaoTitulo: string
  /** mostra/obriga placa+marca+modelo+ano+km. */
  pedeVeiculo: boolean
  /** mostra combustível + checklist de carro (retrovisores/pneus…) + objetos. */
  pedeCheckinAutomotivo: boolean
  /** categorias do tempário. */
  categorias: Categoria[]
}

const cat = (id: string, label: string): Categoria => ({ id, label })

// Categorias automotivas: IDÊNTICAS às de hoje (regressão zero p/ KGF).
const CAT_AUTOMOTIVA: Categoria[] = [
  cat('mecanica', 'Mecânica'), cat('eletrica', 'Elétrica'), cat('suspensao', 'Suspensão'),
  cat('motor', 'Motor'), cat('freios', 'Freios'), cat('transmissao', 'Transmissão'),
  cat('arrefecimento', 'Arrefecimento'), cat('outros', 'Outros'),
]

const BASE: Record<Ramo, Omit<RamoConfig, 'ramo'>> = {
  automotiva: {
    automotivo: true,
    objetoLabel: 'Veículo', objetoLabelCurto: 'veículo',
    identLabel: 'Placa', identPlaceholder: 'ABC-1234',
    recepcaoTitulo: 'Check-in do veículo',
    pedeVeiculo: true, pedeCheckinAutomotivo: true,
    categorias: CAT_AUTOMOTIVA,
  },
  retifica: {
    automotivo: false,
    objetoLabel: 'Peça / trabalho', objetoLabelCurto: 'peça',
    identLabel: 'Peça', identPlaceholder: 'Ex.: cabeçote 4cc',
    recepcaoTitulo: 'Recebimento da peça',
    pedeVeiculo: false, pedeCheckinAutomotivo: false,
    categorias: [
      cat('cabecote', 'Cabeçote'), cat('virabrequim', 'Virabrequim'), cat('bloco', 'Bloco'),
      cat('comando', 'Comando'), cat('usinagem', 'Usinagem'), cat('solda', 'Solda / recuperação'),
      cat('testes', 'Testes'), cat('outros', 'Outros'),
    ],
  },
  usinagem: {
    automotivo: false,
    objetoLabel: 'Peça / trabalho', objetoLabelCurto: 'peça',
    identLabel: 'Peça', identPlaceholder: 'Ex.: eixo Ø40',
    recepcaoTitulo: 'Recebimento da peça',
    pedeVeiculo: false, pedeCheckinAutomotivo: false,
    categorias: [
      cat('usinagem', 'Usinagem'), cat('torneamento', 'Torneamento'), cat('fresa', 'Fresa'),
      cat('furacao', 'Furação'), cat('solda', 'Solda'), cat('testes', 'Testes'), cat('outros', 'Outros'),
    ],
  },
  eletrica: {
    automotivo: false,
    objetoLabel: 'Equipamento', objetoLabelCurto: 'equipamento',
    identLabel: 'Equipamento', identPlaceholder: 'Ex.: motor 5cv trifásico',
    recepcaoTitulo: 'Recebimento do equipamento',
    pedeVeiculo: false, pedeCheckinAutomotivo: false,
    categorias: [
      cat('eletrica', 'Elétrica'), cat('rebobinamento', 'Rebobinamento'), cat('bobinas', 'Bobinas'),
      cat('testes', 'Testes'), cat('outros', 'Outros'),
    ],
  },
  geral: {
    automotivo: false,
    objetoLabel: 'Item / trabalho', objetoLabelCurto: 'item',
    identLabel: 'Item', identPlaceholder: 'Ex.: descrição do item',
    recepcaoTitulo: 'Recebimento',
    pedeVeiculo: false, pedeCheckinAutomotivo: false,
    categorias: [cat('servico', 'Serviço'), cat('outros', 'Outros')],
  },
}

// Rótulo de categoria: procura em TODOS os ramos (um serviço antigo mantém o rótulo certo
// mesmo que a empresa mude de configuração). Fallback = o próprio id.
const TODAS_CATEGORIAS: Record<string, string> = RAMOS.reduce((acc, r) => {
  for (const c of BASE[r].categorias) acc[c.id] = c.label
  return acc
}, {} as Record<string, string>)

export function labelCategoria(id: string | null | undefined): string {
  if (!id) return '—'
  return TODAS_CATEGORIAS[id] ?? id
}

/** Config do ramo (default automotiva — sempre o comportamento atual quando desconhecido). */
export function ramoConfig(ramo: Ramo | null | undefined): RamoConfig {
  const r: Ramo = ramo && RAMOS.includes(ramo) ? ramo : 'automotiva'
  return { ramo: r, ...BASE[r] }
}

/**
 * Lê o ramo da empresa (fn_oficina_ramo) e devolve a config pronta.
 * Enquanto carrega (ou sem empresa), cai no automotiva — regressão zero.
 */
export function useOficinaRamo(companyId: string | null): { config: RamoConfig; ramo: Ramo | null; carregado: boolean } {
  const [ramo, setRamo] = useState<Ramo | null>(null)
  useEffect(() => {
    let vivo = true
    if (!companyId) return
    void supabase.rpc('fn_oficina_ramo', { p_company_id: companyId }).then(({ data }) => {
      if (!vivo) return
      setRamo((typeof data === 'string' && RAMOS.includes(data as Ramo) ? data : 'automotiva') as Ramo)
    })
    return () => { vivo = false }
  }, [companyId])
  return { config: ramoConfig(ramo), ramo, carregado: ramo !== null }
}
