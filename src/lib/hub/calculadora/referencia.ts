// Valores de REFERÊNCIA (Trevo Drywall, levantamento 08/10/2026) — "referência de mercado a validar" com o fabricante
// (NBR 15758/14715). São semente de dado: cada empresa ajusta os seus; o motor não conhece nenhum número daqui.
import type { FaixaPeDireito, SistemaCalculo } from './motor'

export const REFERENCIA_STATUS = 'referência de mercado a validar'

const f = (de: number, ate: number, bitola: string, espacamento: 600 | 400, duplo = false): FaixaPeDireito => ({ de, ate, bitola, espacamento, duplo })

// p-s-st: parede simples, chapa ST
export const FAIXAS_PAREDE_SIMPLES: FaixaPeDireito[] = [
  f(0.2, 2.5, 'M48', 600), f(2.55, 2.7, 'M48', 400), f(2.75, 3, 'M70', 600), f(3.05, 3.3, 'M70', 400),
  f(3.35, 3.6, 'M70', 600, true), f(3.65, 4.05, 'M70', 400, true), f(4.1, 4.15, 'M90', 600, true), f(4.2, 4.6, 'M90', 400, true),
]

const PAR = { '600': 22, '400': 25, d600: 30, d400: 33 }

export const PAREDE_SIMPLES: SistemaCalculo = {
  chave: 'parede_simples', nome: 'Parede simples (1 chapa por face)', modo: 'parede', perda: 0.05,
  faixas_pe_direito: FAIXAS_PAREDE_SIMPLES,
  itens: [
    { chave: 'chapa', nome: 'Chapa de gesso', unidade_compra: 'chapa', divisor: 2.16, usa_chapa: true, aplica_perda: true, por_area: 1, faces: 2, explicacao: 'Duas faces; a perda cobre cortes.' },
    { chave: 'guia', nome: 'Guia', unidade_compra: 'barra 3 m', divisor: 3, aplica_perda: true, por_comprimento: 1, faces: 2, usa_bitola: true, explicacao: 'Uma guia no piso e outra no teto.' },
    { chave: 'montante', nome: 'Montante', unidade_compra: 'barra 3 m', divisor: 3, aplica_perda: true, por_montante: true, usa_bitola: true, explicacao: 'Um montante a cada espaçamento da faixa do pé-direito (dobrado quando duplo).' },
    { chave: 'parafuso_ppa25', nome: 'Parafuso PPA 25', unidade_compra: 'cento', divisor: 100, aplica_perda: false, por_area: PAR, explicacao: 'Un/m² conforme espaçamento e montante duplo.' },
    { chave: 'la', nome: 'Lã mineral', unidade_compra: 'm²', divisor: 1, aplica_perda: true, opcional: 'la', por_area: 1, explicacao: 'Opcional, preenche a parede.' },
    { chave: 'banda', nome: 'Banda acústica', unidade_compra: 'rolo 10 m', divisor: 10, aplica_perda: true, opcional: 'banda', por_comprimento: 1, faces: 2, explicacao: 'Opcional, sob as guias.' },
    { chave: 'massa', nome: 'Massa para junta', unidade_compra: 'balde 22 kg', divisor: 22, aplica_perda: false, por_area: 0.94, explicacao: '0,94 kg/m² em parede de 1 chapa.' },
    { chave: 'fita', nome: 'Fita para junta', unidade_compra: 'rolo 150 m', divisor: 150, aplica_perda: false, por_area: 3, explicacao: '3 m/m².' },
  ],
}

export const FORRO_F530: SistemaCalculo = {
  chave: 'forro_f530', nome: 'Forro estruturado F530', modo: 'forro', perda: 0.05,
  itens: [
    { chave: 'chapa', nome: 'Chapa de gesso', unidade_compra: 'chapa', divisor: 2.16, usa_chapa: true, aplica_perda: true, por_area: 1, explicacao: 'Uma camada.' },
    { chave: 'perfil_f530', nome: 'Perfil F530', unidade_compra: 'barra 3 m', divisor: 3, aplica_perda: false, por_area: 1.7, explicacao: '1,7 m por m².' },
    { chave: 'tabica', nome: 'Cantoneira/tabica de borda', unidade_compra: 'barra 3 m', divisor: 3, aplica_perda: false, por_perimetro: 1, explicacao: 'Pelo perímetro real do ambiente.' },
    { chave: 'pendural', nome: 'Pendural', unidade_compra: 'un', divisor: 1, aplica_perda: false, por_area: 1.25, explicacao: '1,25 un/m².' },
    { chave: 'tirante', nome: 'Tirante', unidade_compra: 'un', divisor: 1, aplica_perda: false, por_area: 1.25, explicacao: '1,25 un/m².' },
    { chave: 'uniao', nome: 'União de perfil', unidade_compra: 'un', divisor: 1, aplica_perda: false, por_area: 0.45, explicacao: '0,45 un/m².' },
    { chave: 'parafuso_ppa25', nome: 'Parafuso PPA 25', unidade_compra: 'cento', divisor: 100, aplica_perda: false, por_area: 13, explicacao: '13 un/m².' },
    { chave: 'parafuso_pfm13', nome: 'Parafuso PFM 13', unidade_compra: 'cento', divisor: 100, aplica_perda: false, por_area: 2, explicacao: '2 un/m².' },
    { chave: 'massa', nome: 'Massa para junta', unidade_compra: 'balde 22 kg', divisor: 22, aplica_perda: false, por_area: 0.7, explicacao: '0,70 kg/m².' },
    { chave: 'fita', nome: 'Fita para junta', unidade_compra: 'rolo 150 m', divisor: 150, aplica_perda: false, por_area: 1.5, explicacao: '1,5 m/m².' },
  ],
}
