// PS Gestão ERP — Adaptador Omie para a arquitetura genérica de conectores.
// syncModule reutiliza /api/sync/omie/clientes e /api/omie/promote via fetch
// interno (sem duplicar mapeamento/upsert). reconcileModule chama a API Omie
// diretamente pra colher total_de_registros sem baixar todos os registros.

import { omieCall, type OmieCallLog } from '@/lib/omieClient'
import { logCall } from './callLog'
import type {
  Connector,
  ConnectorContext,
  ReconcileReport,
  SyncReport,
  TestResult,
} from './base'

type OmieCallCfg = { call: string; extraParam: Record<string, any> }

type ModuloCfg = {
  omie: OmieCallCfg
  tabelaErp: string
  scopeByRefExterna: boolean
  note?: string
  // Chave onde a lista de registros vive na resposta Omie
  // (e.g. 'clientes_cadastro').
  responseKey?: string
  // Campo do registro Omie que contém o ID único (para detecção de órfãos).
  idField?: string
}

const MODULOS: Record<string, ModuloCfg> = {
  clientes: {
    omie: { call: 'ListarClientes', extraParam: { filtrar_apenas_clientes: 'S' } },
    tabelaErp: 'erp_clientes',
    scopeByRefExterna: true,
    responseKey: 'clientes_cadastro',
    idField: 'codigo_cliente_omie',
  },
  fornecedores: {
    // Omie não tem método ListarFornecedores — a API de clientes diferencia
    // via flag filtrar_apenas_fornecedor. Mesma estratégia usada em
    // /api/sync/omie/fornecedores/route.ts.
    omie: { call: 'ListarClientes', extraParam: { filtrar_apenas_fornecedor: 'S' } },
    tabelaErp: 'erp_fornecedores',
    scopeByRefExterna: true,
    responseKey: 'clientes_cadastro',
    idField: 'codigo_cliente_omie',
  },
  contas_pagar: {
    omie: { call: 'ListarContasPagar', extraParam: {} },
    tabelaErp: 'erp_pagar',
    scopeByRefExterna: true,
    responseKey: 'conta_pagar_cadastro',
    idField: 'codigo_lancamento_omie',
  },
  contas_receber: {
    omie: { call: 'ListarContasReceber', extraParam: {} },
    tabelaErp: 'erp_receber',
    scopeByRefExterna: true,
    responseKey: 'conta_receber_cadastro',
    idField: 'codigo_lancamento_omie',
  },
  categorias: {
    omie: { call: 'ListarCategorias', extraParam: { apenas_informacoes: 'S' } },
    tabelaErp: 'erp_plano_contas',
    scopeByRefExterna: false,
    note: 'erp_plano_contas sem ref_externa_sistema — contagem inclui origens mistas',
    responseKey: 'categoria_cadastro',
    idField: 'codigo',
  },
}

// Backoff do wrapper externo (entre tentativas): 1s, 3s, 8s.
// máx 3 tentativas — primeira imediata, duas com espera.
const RETRY_WAITS_MS = [0, 1000, 3000, 8000]
const MAX_ATTEMPTS = 3
const CALL_TIMEOUT_MS = 25000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
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

  // Callback repassado pro omieCall — grava cada tentativa em
  // data_source_call_logs (best-effort).
  private makeLogHook() {
    return async (entry: OmieCallLog) => {
      await logCall(this.ctx.supabase, {
        companyId: this.ctx.companyId,
        dataSourceSlug: 'omie',
        endpoint: `${entry.endpoint}#${entry.call}#att${entry.attempt}`,
        params: entry.params,
        duracaoMs: entry.durationMs,
        status: entry.status,
        httpStatus: entry.httpStatus ?? null,
        errorMessage: entry.errorMessage ?? null,
        responseBodyPreview: entry.responseBodyPreview ?? null,
      })
    }
  }

  // Wrapper de retry no nível do connector: 3 tentativas com backoff
  // 1s/3s/8s. Cada chamada a omieCall já tem seu próprio retry interno
  // (429/5xx); este loop adiciona resiliência a erros de aplicação/JS
  // não cobertos (ex.: parse error). Timeout explícito de 25s dá sinal
  // rápido pra UI.
  private async callWithRetry(
    cfg: OmieCallCfg,
    params: Record<string, any>
  ): Promise<any> {
    let lastErr: any
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) await sleep(RETRY_WAITS_MS[attempt])
      try {
        return await omieCall(this.auth(), {
          call: cfg.call,
          param: { ...cfg.extraParam, ...params },
          timeout: CALL_TIMEOUT_MS,
          onLog: this.makeLogHook(),
        })
      } catch (err: any) {
        lastErr = err
        console.warn(
          `[OmieConnector] ${cfg.call} tentativa ${attempt + 1}/${MAX_ATTEMPTS} falhou: ${err.message}`
        )
      }
    }
    throw lastErr || new Error(`Omie ${cfg.call} falhou após ${MAX_ATTEMPTS} tentativas`)
  }

  async test(): Promise<TestResult> {
    try {
      await this.callWithRetry(
        { call: 'ListarClientes', extraParam: {} },
        { pagina: 1, registros_por_pagina: 1 }
      )
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
    let sourceCount = 0
    try {
      const omieRes = await this.callWithRetry(cfg.omie, {
        pagina: 1,
        registros_por_pagina: 1,
      })
      sourceCount = Number(omieRes?.total_de_registros) || 0
    } catch (e: any) {
      return {
        module,
        source_count: -1,
        erp_count: -1,
        ok: false,
        details: `falha Omie: ${e.message}`,
      }
    }

    // Conta no ERP.
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
    return this.callWithRetry(cfg.omie, {
      pagina: 1,
      registros_por_pagina: 50,
      ...params,
    })
  }

  // Retorna os N IDs mais recentes da Omie para o módulo dado (usado em
  // detecção de órfãos). Volta vazio se o módulo não expõe uma lista
  // compreensível ou se a chamada falhar.
  async listSourceIds(module: string, limit = 500): Promise<string[]> {
    const cfg = MODULOS[module]
    if (!cfg || !cfg.responseKey || !cfg.idField) return []
    try {
      const res = await this.callWithRetry(cfg.omie, {
        pagina: 1,
        registros_por_pagina: Math.min(limit, 500),
      })
      const arr: any[] = res?.[cfg.responseKey] || []
      const ids: string[] = []
      for (const item of arr) {
        const v = item?.[cfg.idField]
        if (v != null && v !== '') ids.push(String(v))
      }
      return ids
    } catch (e: any) {
      console.warn(`[OmieConnector] listSourceIds(${module}) falhou: ${e.message}`)
      return []
    }
  }
}
