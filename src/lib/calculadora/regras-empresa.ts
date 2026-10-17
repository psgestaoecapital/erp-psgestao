// Regras da Calculadora por empresa: o que a empresa gravou (erp_calc_regra) sobrepõe a referência de mercado do motor.
import { REGRAS_PAREDE_CORTA_FOGO, REGRAS_PAREDE_SEPARATIVA, REGRAS_REVESTIMENTO_ESTRUTURADO, REGRAS_REVESTIMENTO_COLADO, REGRAS_FORRO_ARAMADO, REGRAS_FORRO_F530, REGRAS_PAREDE_SIMPLES_ST, type Regras } from './motor'

export type SistemaCalc = 'parede' | 'forro_f530' | 'forro_aramado' | 'revestimento_colado' | 'revestimento_estruturado' | 'parede_separativa' | 'parede_corta_fogo'
export const regrasReferencia = (s: SistemaCalc): Regras =>
  (s === 'parede_separativa' ? REGRAS_PAREDE_SEPARATIVA : s === 'parede_corta_fogo' ? REGRAS_PAREDE_CORTA_FOGO : s === 'parede' ? REGRAS_PAREDE_SIMPLES_ST : s === 'revestimento_estruturado' ? REGRAS_REVESTIMENTO_ESTRUTURADO : s === 'revestimento_colado' ? REGRAS_REVESTIMENTO_COLADO : s === 'forro_aramado' ? REGRAS_FORRO_ARAMADO : REGRAS_FORRO_F530)

// Mescla campo a campo (sobre a referência) e ignora o que não for número/lista válida — regra salva incompleta nunca trava.
export function mesclarRegras<T extends Regras>(base: T, salva: unknown): T {
  if (!salva || typeof salva !== 'object') return base
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(salva as Record<string, unknown>)) {
    if (!(k in base) || k === 'tipo') continue
    const ref = (base as Record<string, unknown>)[k]
    if (typeof ref === 'number' && typeof v === 'number' && Number.isFinite(v) && v >= 0) out[k] = v
    else if (Array.isArray(ref) && Array.isArray(v) && v.length > 0) out[k] = v
    else if (ref && typeof ref === 'object' && !Array.isArray(ref) && v && typeof v === 'object') out[k] = { ...(ref as object), ...(v as object) }
  }
  return out as T
}
