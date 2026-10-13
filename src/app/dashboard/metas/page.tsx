'use client'

// Central de Metas — a tela ÚNICA de metas do PS (arquitetura 🅑+). Lista o catálogo
// de indicadores (area_indicadores_mestres) por tema e deixa o gestor DEFINIR a meta
// de cada um (erp_meta via fn_meta_definir). RD-25: a meta é decisão do gestor — o
// sistema só SUGERE (benchmark/catálogo). Serve todas as verticais, não só Gente.
import CentralMetas from '@/components/metas/CentralMetas'

export default function MetasPage() {
  return <CentralMetas />
}
