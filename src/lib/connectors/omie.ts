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

// Configuração por módulo. `scopeByRefExterna` indica se a tabela ERP
// tem coluna ref_externa_sistema para escopar a contagem ao Omie; tabelas
// sem esse marcador (plano de contas/categorias) usam só company_id e a
// comparação reconcilia origens mistas — sinalizamos isso em `note`.
type ModuloCfg = {
  omie: OmieCallCfg
  tabelaErp: string
  scopeByRefExterna: boolean
  note?: string
}

const MODULOS: Record<string, ModuloCfg> = {
  clientes: {
    omie: { call: 'ListarClientes', extraParam: { filtrar_apenas_clientes: 'S' } },
    tabelaErp: 'erp_clientes',
    scopeByRefExterna: true,
  },
  fornecedores: {
    // Omie não tem método ListarFornecedores — a API de clientes diferencia
    // via flag filtrar_apenas_fornecedor. Mesma estratégia usada em
    // /api/sync/omie/fornecedores/route.ts.
    omie: { call: 'ListarClientes', extraParam: { filtrar_apenas_fornecedor: 'S' } },
    tabelaErp: 'erp_fornecedores',
    scopeByRefExterna: true,
  },
  contas_pagar: {
    omie: { call: 'ListarContasPagar', extraParam: {} },
    tabelaErp: 'erp_pagar',
    scopeByRefExterna: true,
  },
  contas_receber: {
    omie: { call: 'ListarContasReceber', extraParam: {} },
    tabelaErp: 'erp_receber',
    scopeByRefExterna: true,
  },
  categorias: {
    omie: { call: 'ListarCategorias', extraParam: { apenas_informacoes: 'S' } },
    tabelaErp: 'erp_plano_contas',
    scopeByRefExterna: false,
    note: 'erp_plano_contas sem ref_externa_sistema — contagem inclui origens mistas',
  },
}

export class OmieConnector implements Connector {
  constructor(private ctx: ConnectorContext) {}

  // Credenciais vêm de company_data_sources.credentials_encrypted.
  // TODO: implementar criptografia real na Fase 2 de segurança — hoje é
  // JSONB puro.
  private auth(): { app_key: string; app_secret: string } {
    const app_key = this.ctx.credentials?.app_key
    const app_secret = this.ctx.credentials?.app_secret
    if (!app_key || !app_secret) {
      throw new Error(
        'Credenciais Omie ausentes em company_data_sources.credentials_encrypted ' +
          '(esperado { app_key, app_secret })'
      )
    }
    return { app_key, app_secret }
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
    const cfg = MODULOS[module]
    if (!cfg) {
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
      call: cfg.omie.call,
      param: { pagina: 1, registros_por_pagina: 1, ...cfg.omie.extraParam },
    })
    const sourceCount = Number(omieRes?.total_de_registros) || 0

    // Conta no ERP. Escopa por ref_externa_sistema='OMIE' quando disponível.
    let query = this.ctx.supabase
      .from(cfg.tabelaErp)
      .select('id', { count: 'exact', head: true })
      .eq('company_id', this.ctx.companyId)
    if (cfg.scopeByRefExterna) {
      query = query.eq('ref_externa_sistema', 'OMIE')
    }
    const { count, error } = await query
    if (error) {
      return {
        module,
        source_count: sourceCount,
        erp_count: -1,
        ok: false,
        details: `select ${cfg.tabelaErp}: ${error.message}`,
      }
    }
    const erpCount = count ?? 0
    return {
      module,
      source_count: sourceCount,
      erp_count: erpCount,
      ok: sourceCount === erpCount,
      divergencias: Math.abs(sourceCount - erpCount),
      details: cfg.note,
    }
  }

  async fetchRaw(module: string, params: Record<string, any> = {}): Promise<any> {
    const cfg = MODULOS[module]
    if (!cfg) throw new Error(`Omie.fetchRaw: módulo não suportado: ${module}`)
    return omieCall(this.auth(), {
      call: cfg.omie.call,
      param: { pagina: 1, registros_por_pagina: 50, ...cfg.omie.extraParam, ...params },
    })
  }
}
