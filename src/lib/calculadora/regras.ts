// Regras da Calculadora como DADO por empresa (Hub HB2, Parte O): a empresa sobrescreve só coeficientes numéricos
// que já existem na referência; faixas e demais estruturas continuam as de referência (a validar com o fabricante).
export type Override = Record<string, number>

/** Campos numéricos escalares editáveis (exclui faixas e objetos aninhados). */
export function camposEditaveis(ref: object): string[] {
  return Object.entries(ref).filter(([k, v]) => typeof v === 'number' && k !== 'tipo').map(([k]) => k)
}

/** Aplica o override sobre a referência; ignora chave desconhecida, não numérica, zero ou negativa. */
export function mesclarRegras<T extends object>(ref: T, override: unknown): T {
  const base = { ...ref } as Record<string, unknown>
  if (override && typeof override === 'object') {
    const ok = new Set(camposEditaveis(ref))
    for (const [k, v] of Object.entries(override as Record<string, unknown>)) {
      if (ok.has(k) && typeof v === 'number' && Number.isFinite(v) && v > 0) base[k] = v
    }
  }
  return base as T
}

/** Só o que difere da referência vai para o banco. */
export function diferencas(ref: object, atual: Override): Override {
  const r = ref as Record<string, number>
  return Object.fromEntries(Object.entries(atual).filter(([k, v]) => camposEditaveis(ref).includes(k) && Number.isFinite(v) && v > 0 && v !== r[k]))
}

export const ROTULO_REGRA: Record<string, string> = {
  perda: 'Perda (multiplicador)', areaChapa: 'Área da chapa (m²)', chapasPorFace: 'Chapas por face', massaKgM2: 'Massa (kg/m²)',
  fitaMM2: 'Fita (m/m²)', baldeKg: 'Balde de massa (kg)', rolofitaM: 'Rolo de fita (m)', comprimentoBarra: 'Barra (m)', rolobandaM: 'Rolo de banda (m)',
  perfilF530MM2: 'Perfil F530 (m/m²)', pendularPorM2: 'Pendural (un/m²)', tiranteUnPorM2: 'Tirante (un/m²)', uniaoPorM2: 'União (un/m²)',
  parafusoPPA25PorM2: 'Parafuso PPA25 (un/m²)', parafusoPFM13PorM2: 'Parafuso PFM13 (un/m²)',
}
