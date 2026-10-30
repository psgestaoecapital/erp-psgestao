// Campos numéricos digitados em pt-BR ("0,65"): vão ao banco com ponto e reabrem com vírgula.
export const CAMPOS_NUM = ['pis_pct', 'cofins_pct', 'irpj_pct', 'irpj_presuncao_pct', 'csll_pct', 'csll_presuncao_pct',
  'icms_saida_pct', 'icms_reducao_base_pct', 'encargos_pct', 'coaf_limite_especie']

export function numParaBanco(v: unknown): unknown {
  if (typeof v !== 'string') return v
  const t = v.trim()
  if (!t) return t
  return (t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t)
}

export function numParaTela(v: unknown): unknown {
  return v === null || v === undefined || v === '' ? v : String(v).replace('.', ',')
}
