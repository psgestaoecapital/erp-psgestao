// PS Gestão ERP — Adaptador Omie para a arquitetura genérica de conectores.
// syncModule reutiliza /api/sync/omie/clientes e /api/omie/promote via fetch
// interno (sem duplicar mapeamento/upsert). reconcileModule chama a API Omie
// diretamente pra colher total_de_registros sem baixar todos os registros.

import { omieCall } from '@/lib/omieClient'
import type {
  Connector,
  ConnectorContext,
  ReconcileReport,
  SyncReport,
  TestResult,
} from './base'

type OmieCallCfg = { call: string; extraParam: Record<string, any> }

const MODULE_TO_TABLE: Record<string, string> = {
  clientes: 'erp_clientes',
  contas_pagar: 'erp_pagar',
  contas_receber: 'erp_receber',
}

const MODULE_TO_OMIE: Record<string, OmieCallCfg> = {
  clientes: { call: 'ListarClientes', extraParam: { filtrar_apenas_clientes: 'S' } },
  contas_pagar: { call: 'ListarContasPagar', extraParam: {} },
  contas_receber: { call: 'ListarContasReceber', extraParam: {} },
}

export class OmieConnector implements Connector {
  constructor(private ctx: ConnectorContext) {}

  // Sprint 1: company_data_sources.credentials_encrypted ainda vazio,
  // então cai pra env vars OMIE_APP_KEY / OMIE_APP_SECRET.
  private auth(): { app_key: string; app_secret: string } {
    const k = this.ctx.credentials?.app_key || process.env.OMIE_APP_KEY
    const s = this.ctx.credentials?.app_secret || process.env.OMIE_APP_SECRET
    if (!k || !s) {
      throw new Error('Credenciais Omie ausentes (OMIE_APP_KEY/OMIE_APP_SECRET)')
    }
    return { app_key: k, app_secret: s }
  }

  async test(): Promise<TestResult> {
    try {
      await omieCall(this.auth(), {
        call: 'ListarClientes',
        param: { pagina: 1, registros_por_pagina: 1 },
      })
      return { ok: true }
    } catch (e: any) {
      return { ok: false, message: e.message }
    }
  }

  async syncModule(module: string): Promise<SyncReport> {
    if (module === 'clientes') {
      const res = await fetch(`${this.ctx.baseUrl}/api/sync/omie/clientes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: this.ctx.companyId }),
      })
      const j: any = await res.json().catch(() => ({}))
      return {
        module,
        lidos: Number(j.total_omie) || 0,
        processados: (Number(j.inseridos) || 0) + (Number(j.atualizados) || 0),
        erros: Number(j.erros) || 0,
        detalhes: j,
      }
    }

    if (module === 'contas_pagar' || module === 'contas_receber') {
      const res = await fetch(`${this.ctx.baseUrl}/api/omie/promote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: this.ctx.companyId,
          import_types: [module],
        }),
      })
      const j: any = await res.json().catch(() => ({}))
      const k = module === 'contas_pagar' ? 'pagar' : 'receber'
      const proc = Number(j?.processed?.[k]) || 0
      const errs = Array.isArray(j?.errors) ? j.errors.length : 0
      return {
        module,
        lidos: proc,
        processados: proc,
        erros: errs,
        detalhes: j,
      }
    }

    throw new Error(`Omie.syncModule: módulo não suportado: ${module}`)
  }

  async reconcileModule(module: string): Promise<ReconcileReport> {
    const cfg = MODULE_TO_OMIE[module]
    const tabela = MODULE_TO_TABLE[module]
    if (!cfg || !tabela) {
      return {
        module,
        source_count: -1,
        erp_count: -1,
        ok: false,
        details: `módulo não suportado: ${module}`,
      }
    }

    // Conta na fonte (Omie): 1 página com 1 registro só pra colher o total.
    const omieRes = await omieCall(this.auth(), {
      call: cfg.call,
      param: { pagina: 1, registros_por_pagina: 1, ...cfg.extraParam },
    })
    const sourceCount = Number(omieRes?.total_de_registros) || 0

    // Conta no ERP (escopo OMIE).
    const { count, error } = await this.ctx.supabase
      .from(tabela)
      .select('id', { count: 'exact', head: true })
      .eq('company_id', this.ctx.companyId)
      .eq('ref_externa_sistema', 'OMIE')
    if (error) {
      return {
        module,
        source_count: sourceCount,
        erp_count: -1,
        ok: false,
        details: `select ${tabela}: ${error.message}`,
      }
    }
    const erpCount = count ?? 0
    return {
      module,
      source_count: sourceCount,
      erp_count: erpCount,
      ok: sourceCount === erpCount,
      divergencias: Math.abs(sourceCount - erpCount),
    }
  }

  async fetchRaw(module: string, params: Record<string, any> = {}): Promise<any> {
    const cfg = MODULE_TO_OMIE[module]
    if (!cfg) throw new Error(`Omie.fetchRaw: módulo não suportado: ${module}`)
    return omieCall(this.auth(), {
      call: cfg.call,
      param: { pagina: 1, registros_por_pagina: 50, ...cfg.extraParam, ...params },
    })
  }
}
