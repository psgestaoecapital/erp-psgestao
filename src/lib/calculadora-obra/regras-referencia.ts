// Valores de REFERÊNCIA (Trevo Drywall) — "referência de mercado a validar" com o fabricante de cada empresa (Parte O.1).
// Entram só como semente do dado editável por empresa; o motor não conhece estes números.
import type { Faixa, RegraSistema } from './motor'

const f = (de: number, ate: number, bitola: string, espacamento: number, duplo = false): Faixa => ({ de, ate, bitola, espacamento, duplo })

export const PAREDE_SIMPLES_ST_1CHAPA: RegraSistema = {
  codigo: 'parede_simples_st_1chapa',
  nome: 'Parede simples (ST, 1 chapa por face)',
  perda: 0.05,
  referencia: 'Referência de mercado a validar (Trevo Drywall; NBR 15758/14715)',
  faixas: [
    f(0.2, 2.5, 'M48', 0.6), f(2.55, 2.7, 'M48', 0.4), f(2.75, 3, 'M70', 0.6), f(3.05, 3.3, 'M70', 0.4),
    f(3.35, 3.6, 'M70', 0.6, true), f(3.65, 4.05, 'M70', 0.4, true), f(4.1, 4.15, 'M90', 0.6, true), f(4.2, 4.6, 'M90', 0.4, true),
  ],
  itens: [
    { chave: 'chapa', nome: 'Chapa de gesso 1,20 × 1,80', tipo: 'chapa', faces: 2, camadas: 1, area_chapa: 2.16, unidade_compra: 'chapa' },
    { chave: 'guia', nome: 'Guia', tipo: 'guia', barra: 3, unidade_compra: 'barra 3 m' },
    { chave: 'montante', nome: 'Montante', tipo: 'montante', barra: 3, unidade_compra: 'barra 3 m' },
    { chave: 'la', nome: 'Lã mineral', tipo: 'por_area', coef: 1, perda: true, embalagem: 1, unidade_compra: 'm²' },
    { chave: 'banda', nome: 'Banda acústica', tipo: 'por_comprimento', coef: 2, perda: true, embalagem: 10, unidade_compra: 'rolo 10 m' },
    { chave: 'parafuso_ppa25', nome: 'Parafuso PPA25', tipo: 'por_area', coef: 22, perda: false, embalagem: 100, unidade_compra: 'cento' },
    { chave: 'massa', nome: 'Massa para juntas', tipo: 'por_area', coef: 0.94, perda: false, embalagem: 22, unidade_compra: 'balde 22 kg' },
    { chave: 'fita', nome: 'Fita para juntas', tipo: 'por_area', coef: 3, perda: false, embalagem: 150, unidade_compra: 'rolo 150 m' },
  ],
}
