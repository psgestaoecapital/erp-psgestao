// Campos numéricos editáveis das regras da Calculadora (por sistema). A chave de ajuda "?" (RD-95) de cada um está em erp_ajuda_campo.
import type { Regras } from './motor'
import type { SistemaCalc } from './regras-empresa'

export type CampoRegra = { caminho: string; rotulo: string; unidade: string; ajuda: string }

const comuns: CampoRegra[] = [
  { caminho: 'perda', rotulo: 'Perda', unidade: '×', ajuda: 'multiplicador de perda aplicado às chapas e perfis' },
  { caminho: 'areaChapa', rotulo: 'Área da chapa', unidade: 'm²', ajuda: 'área de uma chapa de gesso' },
  { caminho: 'comprimentoBarra', rotulo: 'Comprimento da barra', unidade: 'm', ajuda: 'comprimento da barra de perfil' },
  { caminho: 'massaKgM2', rotulo: 'Massa', unidade: 'kg/m²', ajuda: 'consumo de massa por m²' },
  { caminho: 'fitaMM2', rotulo: 'Fita', unidade: 'm/m²', ajuda: 'metros de fita por m²' },
  { caminho: 'baldeKg', rotulo: 'Balde de massa', unidade: 'kg', ajuda: 'peso da embalagem de massa' },
  { caminho: 'rolofitaM', rotulo: 'Rolo de fita', unidade: 'm', ajuda: 'metros por rolo de fita' },
]
export const CAMPOS_REGRA: Record<SistemaCalc, CampoRegra[]> = {
  parede_separativa: [], parede_corta_fogo: [],
  parede: [
    ...comuns,
    { caminho: 'chapasPorFace', rotulo: 'Chapas por face', unidade: 'un', ajuda: 'camadas de chapa em cada face da parede' },
    { caminho: 'rolobandaM', rotulo: 'Rolo de banda', unidade: 'm', ajuda: 'metros por rolo de banda acústica' },
    { caminho: 'laRoloM2', rotulo: 'Rolo de lã', unidade: 'm²', ajuda: 'área de um rolo de lã mineral' },
    { caminho: 'parafusoPorM2.0.6', rotulo: 'Parafuso — montante a 0,60', unidade: 'un/m²', ajuda: 'parafusos por m² com montante a cada 0,60 m' },
    { caminho: 'parafusoPorM2.0.4', rotulo: 'Parafuso — montante a 0,40', unidade: 'un/m²', ajuda: 'parafusos por m² com montante a cada 0,40 m' },
    { caminho: 'parafusoPorM2.0.6d', rotulo: 'Parafuso — 0,60 duplo', unidade: 'un/m²', ajuda: 'parafusos por m² com montante duplo a cada 0,60 m' },
    { caminho: 'parafusoPorM2.0.4d', rotulo: 'Parafuso — 0,40 duplo', unidade: 'un/m²', ajuda: 'parafusos por m² com montante duplo a cada 0,40 m' },
  ],
  forro_f530: [
    ...comuns,
    { caminho: 'perfilF530MM2', rotulo: 'Perfil F530', unidade: 'm/m²', ajuda: 'metros de perfil F530 por m²' },
    { caminho: 'pendularPorM2', rotulo: 'Pendural', unidade: 'un/m²', ajuda: 'penduras por m²' },
    { caminho: 'tiranteUnPorM2', rotulo: 'Tirante', unidade: 'un/m²', ajuda: 'tirantes por m²' },
    { caminho: 'uniaoPorM2', rotulo: 'União de perfil', unidade: 'un/m²', ajuda: 'uniões de perfil por m²' },
    { caminho: 'parafusoPPA25PorM2', rotulo: 'Parafuso PPA 25', unidade: 'un/m²', ajuda: 'parafusos PPA 25 por m²' },
    { caminho: 'parafusoPFM13PorM2', rotulo: 'Parafuso PFM 13', unidade: 'un/m²', ajuda: 'parafusos PFM 13 por m²' },
  ],
  revestimento_estruturado: [
    ...comuns,
    { caminho: 'rolobandaM', rotulo: 'Rolo de banda', unidade: 'm', ajuda: 'metros por rolo de banda acústica' },
    { caminho: 'parafusoPorM2.0.6', rotulo: 'Parafuso — montante a 0,60', unidade: 'un/m²', ajuda: 'parafusos por m² com montante a cada 0,60 m' },
    { caminho: 'parafusoPorM2.0.4', rotulo: 'Parafuso — montante a 0,40', unidade: 'un/m²', ajuda: 'parafusos por m² com montante a cada 0,40 m' },
    { caminho: 'parafusoPorM2.0.6d', rotulo: 'Parafuso — 0,60 duplo', unidade: 'un/m²', ajuda: 'parafusos por m² com montante duplo a cada 0,60 m' },
    { caminho: 'parafusoPorM2.0.4d', rotulo: 'Parafuso — 0,40 duplo', unidade: 'un/m²', ajuda: 'parafusos por m² com montante duplo a cada 0,40 m' },
  ],
  revestimento_colado: [
    { caminho: 'perda', rotulo: 'Perda', unidade: '×', ajuda: 'multiplicador de perda aplicado às chapas' },
    { caminho: 'areaChapa', rotulo: 'Área da chapa', unidade: 'm²', ajuda: 'área de uma chapa de gesso' },
    { caminho: 'gessoColaKgM2', rotulo: 'Gesso cola', unidade: 'kg/m²', ajuda: 'consumo de gesso cola por m²' },
    { caminho: 'sacoGessoColaKg', rotulo: 'Saco de gesso cola', unidade: 'kg', ajuda: 'peso da embalagem de gesso cola' },
    { caminho: 'massaKgM2', rotulo: 'Massa', unidade: 'kg/m²', ajuda: 'consumo de massa por m²' },
    { caminho: 'fitaMM2', rotulo: 'Fita', unidade: 'm/m²', ajuda: 'metros de fita por m²' },
    { caminho: 'baldeKg', rotulo: 'Balde de massa', unidade: 'kg', ajuda: 'peso da embalagem de massa' },
    { caminho: 'rolofitaM', rotulo: 'Rolo de fita', unidade: 'm', ajuda: 'metros por rolo de fita' },
  ],
  forro_aramado: [
    ...comuns,
    { caminho: 'nervuraPorM2', rotulo: 'Nervura', unidade: 'm/m²', ajuda: 'metros de nervura por m² de forro' },
    { caminho: 'juncaoHPorM2', rotulo: 'Junção H', unidade: 'un/m²', ajuda: 'junções H por m²' },
    { caminho: 'arameKgM2', rotulo: 'Arame nº 18', unidade: 'kg/m²', ajuda: 'quilos de arame por m²' },
    { caminho: 'gessoColaKgM2', rotulo: 'Gesso cola', unidade: 'kg/m²', ajuda: 'consumo de gesso cola por m²' },
    { caminho: 'sacoGessoColaKg', rotulo: 'Saco de gesso cola', unidade: 'kg', ajuda: 'peso da embalagem de gesso cola' },
  ],
}
CAMPOS_REGRA.parede_separativa = CAMPOS_REGRA.parede
CAMPOS_REGRA.parede_corta_fogo = CAMPOS_REGRA.parede
export const chaveAjudaRegra = (s: SistemaCalc, caminho: string) => `projetos.calculadora.regra.${s}.${caminho}`.toLowerCase()

export function lerCampo(regras: Regras, caminho: string): number | undefined {
  const m = caminho.match(/^parafusoPorM2\.(.+)$/)
  const v = m ? (regras as unknown as { parafusoPorM2?: Record<string, number> }).parafusoPorM2?.[m[1]] : (regras as unknown as Record<string, unknown>)[caminho]
  return typeof v === 'number' ? v : undefined
}

// Monta o JSON a salvar só com o que difere da referência; valor inválido (vazio, negativo, NaN) devolve erro e nunca é salvo.
export function montarRegras(ref: Regras, valores: Record<string, string>, s: SistemaCalc): { ok: true; regras: Record<string, unknown> } | { ok: false; erro: string } {
  const out: Record<string, unknown> = {}
  for (const c of CAMPOS_REGRA[s]) {
    const bruto = (valores[c.caminho] ?? '').trim().replace(',', '.')
    if (bruto === '') return { ok: false, erro: `Preencha "${c.rotulo}".` }
    const v = Number(bruto)
    if (!Number.isFinite(v) || v < 0) return { ok: false, erro: `"${c.rotulo}" precisa ser um número maior ou igual a zero.` }
    if ((c.caminho === 'perda' || c.caminho === 'areaChapa' || c.caminho === 'comprimentoBarra' || c.caminho === 'baldeKg' || c.caminho === 'rolofitaM' || c.caminho === 'sacoGessoColaKg' || c.caminho === 'laRoloM2') && v === 0) return { ok: false, erro: `"${c.rotulo}" não pode ser zero.` }
    if (v === lerCampo(ref, c.caminho)) continue
    const m = c.caminho.match(/^parafusoPorM2\.(.+)$/)
    if (m) out.parafusoPorM2 = { ...(out.parafusoPorM2 as object | undefined), [m[1]]: v }
    else out[c.caminho] = v
  }
  return { ok: true, regras: out }
}
