// Adapter IO Point — converte resposta da API IO Point pro modelo canonico
// (PontoColaborador / PontoHoras). Auth via header apiIopointToken.
//
// Endpoints validados ao vivo (30/06/2026):
//   GET /collaborator                              -> 151 registros
//   GET /collaborator/totalHours?begin_date=&end_date=
//       periodo maximo 31 dias.
//
// Campos vindos da API (validados):
//   national_registry, registration_number, email, name, occupation,
//   department, team, business_unit, admission_date, pis, company,
//   + total_hours em /totalHours.

import type {
  PontoAdapter, PontoColaborador, PontoCredencial, PontoHoras,
} from './types'
import { hhmmParaDecimal } from './hhmm'

const onlyDigits = (s: unknown) => String(s ?? '').replace(/\D/g, '')

// FIX-PONTO-ADMISSION-VAZIO (07/07): a API IO Point manda admission_date=""
// (string vazia) pra alguns colaboradores (7/158 na Frioeste). O `?? null`
// NAO pega string vazia — so null/undefined — entao "" ia direto pra coluna
// `admissao date` e o Postgres rejeitava (SQLSTATE 22007 "invalid input
// syntax for type date") DERRUBANDO O LOTE INTEIRO dos 158. Resultado:
// ind_ponto_colaborador=0 e erro mascarado como "[object Object]".
// dateOrNull: string vazia/invalida -> null; ISO valido -> mantem.
const dateOrNull = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : ''
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null
}
// textOrNull: normaliza string vazia -> null (evita "" em colunas opcionais).
const textOrNull = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : ''
  return s === '' ? null : s
}

// FIX-PONTO-SYNC-TIMEOUT (07/07): a API IO Point (sobretudo /totalHours) e'
// lenta e as vezes estoura o timeout default do fetch — confirmado empirico
// (pg_net: /collaborator 200 rapido, /totalHours timeout >5s). Sem timeout
// explicito + retry, a sync morria com erro de rede generico. Agora:
// AbortController com timeout amplo (route tem maxDuration=60) + 1 retry
// em falha de rede/timeout (nao em 4xx, que e' erro definitivo).
const TIMEOUT_MS = 25_000

async function getJson(url: string, token: string): Promise<unknown> {
  let ultimoErro: unknown = null
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
    try {
      const r = await fetch(url, {
        method: 'GET',
        headers: { apiIopointToken: token, accept: 'application/json' },
        cache: 'no-store',
        signal: ctrl.signal,
      })
      const text = await r.text()
      if (!r.ok) {
        // 4xx = erro definitivo (auth/rota) — nao adianta repetir.
        throw new Error(`IO Point ${r.status}: ${text.slice(0, 300)}`)
      }
      try { return JSON.parse(text) } catch { return text }
    } catch (e) {
      ultimoErro = e
      const abortou = e instanceof Error && e.name === 'AbortError'
      const httpErro = e instanceof Error && /^IO Point \d/.test(e.message)
      // Repete so em timeout/rede; erro HTTP 4xx nao se repete.
      if (httpErro || tentativa === 2) break
      if (!abortou) break // erro de rede diferente de timeout — nao insiste
    } finally {
      clearTimeout(timer)
    }
  }
  if (ultimoErro instanceof Error && ultimoErro.name === 'AbortError') {
    throw new Error(`IO Point timeout (${TIMEOUT_MS / 1000}s) em ${url.split('?')[0]}`)
  }
  throw ultimoErro instanceof Error ? ultimoErro : new Error(String(ultimoErro))
}

function pegarLista(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload as Record<string, unknown>[]
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>
    for (const k of ['data', 'collaborators', 'items', 'result']) {
      const v = obj[k]
      if (Array.isArray(v)) return v as Record<string, unknown>[]
    }
  }
  return []
}

function mapColaborador(row: Record<string, unknown>): PontoColaborador {
  return {
    cpf: onlyDigits(row.national_registry),
    matricula: textOrNull(row.registration_number),
    nome: (typeof row.name === 'string' ? row.name.trim() : '') || '',
    email: textOrNull(row.email),
    funcao: textOrNull(row.occupation),
    departamento: textOrNull(row.department),
    equipe: textOrNull(row.team),
    unidade_negocio: textOrNull(row.business_unit),
    admissao: dateOrNull(row.admission_date), // "" -> null (evita 22007)
    pis: textOrNull(row.pis),
    raw: row,
  }
}

// FIX-PONTO-HORAS (07/07): a API IO Point retorna total_hours como OBJETO
// (nao numero/string) com ~37 sub-campos HH:MM:
//   total_hours: { worked_time:"36:37", worked_actual_time:"36:50",
//                  over_time_1:"02:37", fault_full_time:"08:48", ... }
// O parser antigo tratava total_hours como escalar -> caia no else -> 0.
// Agora: extrai worked_time (jornada trabalhada no periodo) e converte via
// hhmmParaDecimal (./hhmm — fonte unica, reusada pelo BI de ponto). Guarda o
// objeto inteiro em raw pro Painel de Jornada fazer drill-down (extras, faltas).
function mapHoras(row: Record<string, unknown>, beginISO: string, endISO: string): PontoHoras {
  const th = row.total_hours
  let total = 0
  if (th && typeof th === 'object') {
    const o = th as Record<string, unknown>
    // worked_time = jornada trabalhada oficial no periodo; fallback worked_actual_time.
    total = hhmmParaDecimal(o.worked_time ?? o.worked_actual_time)
  } else {
    total = hhmmParaDecimal(th)
  }
  return {
    cpf: onlyDigits(row.national_registry),
    periodo_inicio: beginISO,
    periodo_fim: endISO,
    total_horas: Number(total.toFixed(2)),
    funcao: (row.occupation as string | null) ?? null,
    departamento: (row.department as string | null) ?? null,
    equipe: (row.team as string | null) ?? null,
    unidade_negocio: (row.business_unit as string | null) ?? null,
    raw: row,
  }
}

// Dedup/agrega por CPF: a API /totalHours retorna mais linhas que colaboradores
// (empirico Frioeste: 373 linhas, 359 CPFs — ha CPFs com 2-3 matriculas). O
// upsert em ind_ponto_horas usa onConflict (company_id,provider,cpf,periodo_*)
// — CPF duplicado no mesmo periodo quebra o batch ("cannot affect row a second
// time"). Solucao: somar as horas por CPF (total do colaborador no periodo,
// atravessando matriculas). Preserva todas as linhas de origem em raw.linhas.
function agregarPorCpf(rows: PontoHoras[]): PontoHoras[] {
  const porCpf = new Map<string, PontoHoras>()
  for (const h of rows) {
    if (!h.cpf) continue
    const existente = porCpf.get(h.cpf)
    if (!existente) {
      porCpf.set(h.cpf, { ...h, raw: { linhas: [h.raw] } })
    } else {
      existente.total_horas = Number((existente.total_horas + h.total_horas).toFixed(2))
      ;(existente.raw as { linhas: unknown[] }).linhas.push(h.raw)
    }
  }
  return Array.from(porCpf.values())
}

export const iopointAdapter: PontoAdapter = {
  async listarColaboradores(cred: PontoCredencial) {
    const data = await getJson(`${cred.base_url}/collaborator`, cred.token)
    return pegarLista(data).map(mapColaborador).filter((c) => c.cpf.length > 0)
  },
  async listarHoras(cred: PontoCredencial, beginISO: string, endISO: string) {
    const url = `${cred.base_url}/collaborator/totalHours?begin_date=${encodeURIComponent(beginISO)}&end_date=${encodeURIComponent(endISO)}`
    const data = await getJson(url, cred.token)
    const mapeadas = pegarLista(data).map((r) => mapHoras(r, beginISO, endISO)).filter((h) => h.cpf.length > 0)
    // Agrega por CPF antes de retornar (evita colisao no upsert onConflict).
    return agregarPorCpf(mapeadas)
  },
}
