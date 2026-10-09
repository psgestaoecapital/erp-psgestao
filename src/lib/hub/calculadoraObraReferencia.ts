// Regras de REFERÊNCIA da Calculadora de Obra (Trevo Drywall, Parte O.2 do blueprint). "Referência de mercado a validar"
// com o fabricante de cada empresa (NBR 15758/14715): servem de semente (erp_calc_regra, empresa nula) e cada empresa
// ajusta as suas. Nada daqui é lido pelo motor como constante — o motor só recebe a regra.
import type { FaixaPeDireito, SistemaRegra } from './calculadoraObra'

const faixa = (de: number, ate: number, bitola: string, espacamento_mm: number, duplo = false): FaixaPeDireito =>
  ({ de, ate, bitola, espacamento_mm, duplo })

const PAREDE_SIMPLES_ST: FaixaPeDireito[] = [
  faixa(0.2, 2.5, 'M48', 600), faixa(2.55, 2.7, 'M48', 400), faixa(2.75, 3, 'M70', 600), faixa(3.05, 3.3, 'M70', 400),
  faixa(3.35, 3.6, 'M70', 600, true), faixa(3.65, 4.05, 'M70', 400, true), faixa(4.1, 4.15, 'M90', 600, true),
  faixa(4.2, 4.6, 'M90', 400, true),
]

export const PAREDE_SIMPLES: SistemaRegra = {
  codigo: 'parede-simples-1-chapa',
  nome: 'Parede simples (1 chapa por face)',
  tipo: 'parede',
  referencia: 'Trevo Drywall · referência de mercado a validar',
  parametros: { perda: 1.05, chapa_m2: 2.16 },
  faixas_pe_direito: PAREDE_SIMPLES_ST,
  itens: [
    { codigo: 'chapa', nome: 'Chapa de gesso acartonado', unidade_compra: 'chapa', por_embalagem: 2.16, por_embalagem_param: 'chapa_m2', base: 'area', coef: 2, perda: true },
    { codigo: 'la', nome: 'Lã mineral (miolo)', unidade_compra: 'm²', por_embalagem: 1, base: 'area', coef: 1, perda: true },
    { codigo: 'guia', nome: 'Guia (barra 3 m)', unidade_compra: 'barra', por_embalagem: 3, base: 'comprimento', coef: 2, perda: true },
    { codigo: 'montante', nome: 'Montante (barra 3 m)', unidade_compra: 'barra', por_embalagem: 3, base: 'montante_m', coef: 1, perda: false },
    { codigo: 'parafuso-ppa25', nome: 'Parafuso PPA25', unidade_compra: 'cento', por_embalagem: 100, base: 'area', coef: 22, coef_por_espacamento: { '600': 22, '400': 25, '600d': 30, '400d': 33 }, perda: false },
    { codigo: 'massa', nome: 'Massa para junta (balde 22 kg)', unidade_compra: 'balde', por_embalagem: 22, base: 'area', coef: 0.94, perda: false },
    { codigo: 'fita', nome: 'Fita para junta (rolo 150 m)', unidade_compra: 'rolo', por_embalagem: 150, base: 'area', coef: 3, perda: false },
  ],
}

export const FORRO_F530: SistemaRegra = {
  codigo: 'forro-f530',
  nome: 'Forro estruturado F530',
  tipo: 'forro',
  referencia: 'Trevo Drywall · referência de mercado a validar',
  parametros: { perda: 1.05, chapa_m2: 2.16 },
  faixas_pe_direito: [],
  itens: [
    { codigo: 'chapa', nome: 'Chapa de gesso acartonado', unidade_compra: 'chapa', por_embalagem: 2.16, por_embalagem_param: 'chapa_m2', base: 'area', coef: 1, perda: true },
    { codigo: 'perfil-f530', nome: 'Perfil F530 (barra 3 m)', unidade_compra: 'barra', por_embalagem: 3, base: 'area', coef: 1.7, perda: false },
    { codigo: 'tabica', nome: 'Tabica (barra 3 m), pelo perímetro real', unidade_compra: 'barra', por_embalagem: 3, base: 'perimetro', coef: 1.1, perda: false },
    { codigo: 'pendural', nome: 'Pendural', unidade_compra: 'un', por_embalagem: 1, base: 'area', coef: 1.25, perda: false },
    { codigo: 'tirante', nome: 'Tirante', unidade_compra: 'un', por_embalagem: 1, base: 'area', coef: 1.25, perda: false },
    { codigo: 'uniao', nome: 'União de perfil', unidade_compra: 'un', por_embalagem: 1, base: 'area', coef: 0.45, perda: false },
    { codigo: 'parafuso-ppa25', nome: 'Parafuso PPA25', unidade_compra: 'cento', por_embalagem: 100, base: 'area', coef: 13, perda: false },
    { codigo: 'parafuso-pfm13', nome: 'Parafuso PFM13', unidade_compra: 'cento', por_embalagem: 100, base: 'area', coef: 2, perda: false },
    { codigo: 'massa', nome: 'Massa para junta (balde 22 kg)', unidade_compra: 'balde', por_embalagem: 22, base: 'area', coef: 0.7, perda: false },
    { codigo: 'fita', nome: 'Fita para junta (rolo 150 m)', unidade_compra: 'rolo', por_embalagem: 150, base: 'area', coef: 1.5, perda: false },
  ],
}

export const SISTEMAS_REFERENCIA: SistemaRegra[] = [PAREDE_SIMPLES, FORRO_F530]
