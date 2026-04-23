// PS Gestão ERP — Núcleo da arquitetura genérica de conectores.
// Define os tipos comuns + um registry global preenchido por
// efeito colateral em src/lib/connectors/registry.ts.

import type { SupabaseClient } from '@supabase/supabase-js'

export type ConnectorContext = {
  companyId: string
  companyDataSourceId: string
  credentials: Record<string, any>
  supabase: SupabaseClient
  // Origem (proto://host) usada para chamadas HTTP internas dentro de
  // syncModule — permite reaproveitar /api/sync/omie/* e /api/omie/promote
  // sem duplicar a lógica de mapeamento/upsert.
  baseUrl: string
}

export type SyncReport = {
  module: string
  lidos: number
  processados: number
  erros: number
  detalhes?: Record<string, any>
}

export type ReconcileReport = {
  module: string
  source_count: number
  erp_count: number
  source_sum?: number
  erp_sum?: number
  ok: boolean
  details?: string
  divergencias?: number
}

export type TestResult = {
  ok: boolean
  message?: string
}

export interface Connector {
  test(): Promise<TestResult>
  syncModule(module: string, since?: string): Promise<SyncReport>
  reconcileModule(module: string): Promise<ReconcileReport>
  fetchRaw(module: string, params?: Record<string, any>): Promise<any>
  // Opcional: retorna os N identificadores mais recentes da fonte externa
  // para o módulo dado (usado para detecção de órfãos na reconciliação).
  // Implementar apenas nos módulos onde faz sentido; caller checa existência.
  listSourceIds?(module: string, limit?: number): Promise<string[]>
}

export type ConnectorFactory = (ctx: ConnectorContext) => Connector

const REGISTRY = new Map<string, ConnectorFactory>()

export function register(slug: string, factory: ConnectorFactory): void {
  REGISTRY.set(slug, factory)
}

export function getConnector(slug: string, ctx: ConnectorContext): Connector | null {
  const factory = REGISTRY.get(slug)
  return factory ? factory(ctx) : null
}

export function isRegistered(slug: string): boolean {
  return REGISTRY.has(slug)
}

export function listRegistered(): string[] {
  return Array.from(REGISTRY.keys())
}
