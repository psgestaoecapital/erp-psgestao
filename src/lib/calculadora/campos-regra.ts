// Campos numéricos das regras da Calculadora editáveis por empresa (tela /dashboard/projetos/calculadora/regras).
import type { SistemaCalc } from './regras-empresa'

export type CampoRegra = { chave: string; rotulo: string; unidade: string; minimoExclusivo?: boolean }

const comuns: CampoRegra[] = [
  { chave: 'perda', rotulo: 'Fator de perda', unidade: '× (1,05 = 5%)', minimoExclusivo: true },
  { chave: 'areaChapa', rotulo: 'Área da chapa', unidade: 'm²', minimoExclusivo: true },
  { chave: 'massaKgM2', rotulo: 'Massa por m²', unidade: 'kg/m²' },
  { chave: 'fitaMM2', rotulo: 'Fita por m²', unidade: 'm/m²' },
  { chave: 'baldeKg', rotulo: 'Balde de massa', unidade: 'kg', minimoExclusivo: true },
  { chave: 'rolofitaM', rotulo: 'Rolo de fita', unidade: 'm', minimoExclusivo: true },
]

export const CAMPOS_REGRA: Record<SistemaCalc, CampoRegra[]> = {
  parede: [
    ...comuns,
    { chave: 'chapasPorFace', rotulo: 'Chapas por face', unidade: 'camadas', minimoExclusivo: true },
    { chave: 'comprimentoBarra', rotulo: 'Comprimento da barra', unidade: 'm', minimoExclusivo: true },
    { chave: 'rolobandaM', rotulo: 'Rolo de banda acústica', unidade: 'm', minimoExclusivo: true },
  ],
  forro_f530: [
    ...comuns,
    { chave: 'comprimentoBarra', rotulo: 'Comprimento da barra', unidade: 'm', minimoExclusivo: true },
    { chave: 'perfilF530MM2', rotulo: 'Perfil F530 por m²', unidade: 'm/m²' },
    { chave: 'pendularPorM2', rotulo: 'Pendural por m²', unidade: 'un/m²' },
    { chave: 'tiranteUnPorM2', rotulo: 'Tirante por m²', unidade: 'un/m²' },
    { chave: 'uniaoPorM2', rotulo: 'União por m²', unidade: 'un/m²' },
    { chave: 'parafusoPPA25PorM2', rotulo: 'Parafuso PA25 por m²', unidade: 'un/m²' },
    { chave: 'parafusoPFM13PorM2', rotulo: 'Parafuso FM13 por m²', unidade: 'un/m²' },
  ],
}
