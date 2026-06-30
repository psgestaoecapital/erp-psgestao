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

const onlyDigits = (s: unknown) => String(s ?? '').replace(/\D/g, '')

async function getJson(url: string, token: string): Promise<unknown> {
  const r = await fetch(url, {
    method: 'GET',
    headers: { apiIopointToken: token, accept: 'application/json' },
    cache: 'no-store',
  })
  const text = await r.text()
  if (!r.ok) {
    throw new Error(`IO Point ${r.status}: ${text.slice(0, 300)}`)
  }
  try { return JSON.parse(text) } catch { return text }
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
    matricula: (row.registration_number as string | null) ?? null,
    nome: (row.name as string | null) ?? '',
    email: (row.email as string | null) ?? null,
    funcao: (row.occupation as string | null) ?? null,
    departamento: (row.department as string | null) ?? null,
    equipe: (row.team as string | null) ?? null,
    unidade_negocio: (row.business_unit as string | null) ?? null,
    admissao: (row.admission_date as string | null) ?? null,
    pis: (row.pis as string | null) ?? null,
    raw: row,
  }
}

function mapHoras(row: Record<string, unknown>, beginISO: string, endISO: string): PontoHoras {
  const raw = row.total_hours
  let total = 0
  if (typeof raw === 'number') total = raw
  else if (typeof raw === 'string') {
    // pode vir como "HH:MM" ou numero string
    if (raw.includes(':')) {
      const [h, m] = raw.split(':').map((x) => Number(x) || 0)
      total = h + m / 60
    } else {
      total = Number(raw) || 0
    }
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

export const iopointAdapter: PontoAdapter = {
  async listarColaboradores(cred: PontoCredencial) {
    const data = await getJson(`${cred.base_url}/collaborator`, cred.token)
    return pegarLista(data).map(mapColaborador).filter((c) => c.cpf.length > 0)
  },
  async listarHoras(cred: PontoCredencial, beginISO: string, endISO: string) {
    const url = `${cred.base_url}/collaborator/totalHours?begin_date=${encodeURIComponent(beginISO)}&end_date=${encodeURIComponent(endISO)}`
    const data = await getJson(url, cred.token)
    return pegarLista(data).map((r) => mapHoras(r, beginISO, endISO)).filter((h) => h.cpf.length > 0)
  },
}
