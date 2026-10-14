// Motor da Calculadora de Obra PS (Hub, blueprint V24 Parte O) — fatia 1: parede simples e forro F530.
// Regras como DADO (RegrasSistema): nenhum coeficiente fixo no cálculo. Os valores de REGRAS_REFERENCIA são
// "referência de mercado a validar" com o fabricante de cada empresa (NBR 15758/14715) e serão editáveis por empresa.
export type FaixaPeDireito = { de: number; ate: number; bitola: 'M48' | 'M70' | 'M90'; espacamento: 0.4 | 0.6; duplo: boolean }

export type RegrasParede = {
  tipo: 'parede'
  perda: number; areaChapa: number; chapasPorFace: number
  faixas: FaixaPeDireito[]
  parafusoPorM2: { '0.6': number; '0.4': number; '0.6d': number; '0.4d': number }
  massaKgM2: number; fitaMM2: number
  baldeKg: number; rolofitaM: number; comprimentoBarra: number; rolobandaM: number
  laRoloM2: number
}
export type RegrasForroF530 = {
  tipo: 'forro_f530'
  perda: number; areaChapa: number; comprimentoBarra: number
  perfilF530MM2: number; pendularPorM2: number; tiranteUnPorM2: number; uniaoPorM2: number
  parafusoPPA25PorM2: number; parafusoPFM13PorM2: number
  massaKgM2: number; fitaMM2: number; baldeKg: number; rolofitaM: number
}
export type RegrasForroAramado = {
  tipo: 'forro_aramado'
  perda: number; areaChapa: number; comprimentoBarra: number
  nervuraPorM2: number; juncaoHPorM2: number; arameKgM2: number
  gessoColaKgM2: number; sacoGessoColaKg: number
  massaKgM2: number; fitaMM2: number; baldeKg: number; rolofitaM: number
}
export type Regras = RegrasParede | RegrasForroF530 | RegrasForroAramado

export type ItemCalculo = {
  chave: string; descricao: string; unidadeCompra: string
  quantidadeBruta: number; quantidade: number; conta: string
}
export type Resultado = { ok: true; area: number; itens: ItemCalculo[]; avisos: string[] } | { ok: false; erro: string }

// "arredondar a 2 casas e depois para cima, por embalagem" (O.2)
export const arred2 = (n: number) => Math.round(n * 100) / 100
export const paraCima = (n: number) => Math.ceil(arred2(n))
const f = (n: number) => String(arred2(n)).replace('.', ',')

export const REGRAS_PAREDE_SIMPLES_ST: RegrasParede = {
  tipo: 'parede', perda: 1.05, areaChapa: 2.16, chapasPorFace: 1,
  faixas: [
    { de: 0.2, ate: 2.5, bitola: 'M48', espacamento: 0.6, duplo: false },
    { de: 2.55, ate: 2.7, bitola: 'M48', espacamento: 0.4, duplo: false },
    { de: 2.75, ate: 3.0, bitola: 'M70', espacamento: 0.6, duplo: false },
    { de: 3.05, ate: 3.3, bitola: 'M70', espacamento: 0.4, duplo: false },
    { de: 3.35, ate: 3.6, bitola: 'M70', espacamento: 0.6, duplo: true },
    { de: 3.65, ate: 4.05, bitola: 'M70', espacamento: 0.4, duplo: true },
    { de: 4.1, ate: 4.15, bitola: 'M90', espacamento: 0.6, duplo: true },
    { de: 4.2, ate: 4.6, bitola: 'M90', espacamento: 0.4, duplo: true },
  ],
  parafusoPorM2: { '0.6': 22, '0.4': 25, '0.6d': 30, '0.4d': 33 },
  massaKgM2: 0.94, fitaMM2: 3, baldeKg: 22, rolofitaM: 150, comprimentoBarra: 3, rolobandaM: 10,
  laRoloM2: 7.2, // lã mineral/PET: rolo de 1,20 × 6,00 m — referência de mercado a validar
}

export const REGRAS_FORRO_F530: RegrasForroF530 = {
  tipo: 'forro_f530', perda: 1.05, areaChapa: 2.16, comprimentoBarra: 3,
  perfilF530MM2: 1.7, pendularPorM2: 1.25, tiranteUnPorM2: 1.25, uniaoPorM2: 0.45,
  parafusoPPA25PorM2: 13, parafusoPFM13PorM2: 2,
  massaKgM2: 0.7, fitaMM2: 1.5, baldeKg: 22, rolofitaM: 150,
}

// Forro aramado (chapa 0,60 × 2,00 = 1,20 m²). A nervura é a cada 1,20 m de comprimento (comprimentoBarra) e arredonda para CIMA
// (o site de referência arredonda para baixo — anomalia a não copiar). Valores: referência de mercado a validar.
export const REGRAS_FORRO_ARAMADO: RegrasForroAramado = {
  tipo: 'forro_aramado', perda: 1.05, areaChapa: 1.2, comprimentoBarra: 1.2,
  nervuraPorM2: 0.09, juncaoHPorM2: 4.5, arameKgM2: 0.14,
  gessoColaKgM2: 1.25, sacoGessoColaKg: 5,
  massaKgM2: 0.84, fitaMM2: 3, baldeKg: 22, rolofitaM: 150,
}

const item = (chave: string, descricao: string, unidadeCompra: string, bruta: number, conta: string): ItemCalculo =>
  ({ chave, descricao, unidadeCompra, quantidadeBruta: arred2(bruta), quantidade: paraCima(bruta), conta })

export function faixaDoPeDireito(faixas: FaixaPeDireito[], pd: number): FaixaPeDireito | null {
  // escolhe a última faixa que começa em/antes do pé-direito: entre 2,50 e 2,55 vale a anterior (nunca "trava")
  const ordenadas = [...faixas].sort((a, b) => a.de - b.de)
  let achada: FaixaPeDireito | null = null
  for (const x of ordenadas) if (pd + 1e-9 >= x.de) achada = x
  if (!achada || pd - 1e-9 > achada.ate + 0.05) return null
  return achada
}

export type EntradaParede = { comprimento: number; peDireito: number; vaos?: number; comLa?: boolean; camadas?: number }
export type EntradaForro = { largura: number; comprimento: number; perimetro?: number }

export function calcularParede(r: RegrasParede, e: EntradaParede): Resultado {
  if (!(e.comprimento > 0) || !(e.peDireito > 0)) return { ok: false, erro: 'Informe comprimento e pé-direito maiores que zero.' }
  const area = arred2(e.comprimento * e.peDireito - (e.vaos ?? 0))
  if (area <= 0) return { ok: false, erro: 'Os vãos descontados são maiores que a parede.' }
  const fx = faixaDoPeDireito(r.faixas, e.peDireito)
  if (!fx) return { ok: false, erro: `Pé-direito de ${f(e.peDireito)} m fora das faixas cadastradas — ajuste as regras do sistema.` }
  const L = e.comprimento, p = r.perda
  // camadas por face (corta-fogo/dupla): padrão = regra da empresa; a entrada só sobrepõe (1 a 3)
  const cam = e.camadas && e.camadas >= 1 ? Math.min(3, Math.round(e.camadas)) : r.chapasPorFace
  const un = r.parafusoPorM2[`${fx.espacamento}${fx.duplo ? 'd' : ''}` as keyof RegrasParede['parafusoPorM2']]
  const itens = [
    item('chapa', 'Chapa de gesso', 'chapa', (area * cam * 2 * p) / r.areaChapa,
      `${f(area)} m² × ${cam * 2} camadas (${cam} por face) × perda ${f(p)} ÷ ${f(r.areaChapa)} m² por chapa`),
    item('guia', `Guia ${fx.bitola}`, 'barra 3 m', (L * 2 * p) / r.comprimentoBarra,
      `${f(L)} m × 2 (piso e teto) × perda ${f(p)} ÷ ${r.comprimentoBarra} m por barra`),
    item('montante', `Montante ${fx.bitola}${fx.duplo ? ' duplo' : ''} a cada ${fx.espacamento * 100} cm`, 'barra 3 m',
      ((L / fx.espacamento) * p * e.peDireito * (fx.duplo ? 2 : 1)) / r.comprimentoBarra,
      `${f(L)} m ÷ ${fx.espacamento} m × perda ${f(p)} × pé-direito ${f(e.peDireito)} m${fx.duplo ? ' × 2 (duplo)' : ''} ÷ ${r.comprimentoBarra} m por barra`),
    item('banda', 'Banda acústica', 'rolo 10 m', (L * 2 * p) / r.rolobandaM,
      `${f(L)} m × 2 × perda ${f(p)} ÷ ${r.rolobandaM} m por rolo`),
    item('parafuso', 'Parafuso PPA25', 'cento', (area * un * cam / r.chapasPorFace) / 100, `${f(area)} m² × ${un} un/m²${cam !== r.chapasPorFace ? ` × ${cam / r.chapasPorFace} (camadas)` : ''} ÷ 100 por cento`),
    item('massa', 'Massa para junta', `balde ${r.baldeKg} kg`, (area * r.massaKgM2) / r.baldeKg,
      `${f(area)} m² × ${f(r.massaKgM2)} kg/m² ÷ ${r.baldeKg} kg por balde`),
    item('fita', 'Fita para junta', `rolo ${r.rolofitaM} m`, (area * r.fitaMM2) / r.rolofitaM,
      `${f(area)} m² × ${f(r.fitaMM2)} m/m² ÷ ${r.rolofitaM} m por rolo`),
  ]
  if (e.comLa) itens.splice(4, 0, item('la', 'Lã mineral (isolamento do miolo)', `rolo ${f(r.laRoloM2)} m²`, (area * p) / r.laRoloM2,
    `${f(area)} m² × perda ${f(p)} ÷ ${f(r.laRoloM2)} m² por rolo`))
  return { ok: true, area, itens, avisos: [] }
}

export function calcularForroF530(r: RegrasForroF530, e: EntradaForro): Resultado {
  if (!(e.largura > 0) || !(e.comprimento > 0)) return { ok: false, erro: 'Informe largura e comprimento maiores que zero.' }
  const area = arred2(e.largura * e.comprimento)
  const perimetro = e.perimetro ?? 2 * (e.largura + e.comprimento)
  const p = r.perda, b = r.comprimentoBarra
  const itens = [
    item('chapa', 'Chapa de gesso', 'chapa', (area * p) / r.areaChapa, `${f(area)} m² × perda ${f(p)} ÷ ${f(r.areaChapa)} m² por chapa`),
    item('perfil_f530', 'Perfil F530', 'barra 3 m', (area * r.perfilF530MM2) / b, `${f(area)} m² × ${f(r.perfilF530MM2)} m/m² ÷ ${b} m por barra`),
    item('tabica', 'Tabica (perímetro real)', 'barra 3 m', (perimetro * p) / b, `${f(perimetro)} m de perímetro × perda ${f(p)} ÷ ${b} m por barra`),
    item('pendural', 'Pendural', 'unidade', area * r.pendularPorM2, `${f(area)} m² × ${f(r.pendularPorM2)} un/m²`),
    item('tirante', 'Tirante', 'unidade', area * r.tiranteUnPorM2, `${f(area)} m² × ${f(r.tiranteUnPorM2)} un/m²`),
    item('uniao', 'União', 'unidade', area * r.uniaoPorM2, `${f(area)} m² × ${f(r.uniaoPorM2)} un/m²`),
    item('ppa25', 'Parafuso PPA25', 'cento', (area * r.parafusoPPA25PorM2) / 100, `${f(area)} m² × ${r.parafusoPPA25PorM2} un/m² ÷ 100 por cento`),
    item('pfm13', 'Parafuso PFM13', 'cento', (area * r.parafusoPFM13PorM2) / 100, `${f(area)} m² × ${r.parafusoPFM13PorM2} un/m² ÷ 100 por cento`),
    item('massa', 'Massa para junta', `balde ${r.baldeKg} kg`, (area * r.massaKgM2) / r.baldeKg, `${f(area)} m² × ${f(r.massaKgM2)} kg/m² ÷ ${r.baldeKg} kg por balde`),
    item('fita', 'Fita para junta', `rolo ${r.rolofitaM} m`, (area * r.fitaMM2) / r.rolofitaM, `${f(area)} m² × ${f(r.fitaMM2)} m/m² ÷ ${r.rolofitaM} m por rolo`),
  ]
  return { ok: true, area, itens, avisos: [] }
}

export function calcularForroAramado(r: RegrasForroAramado, e: EntradaForro): Resultado {
  if (!(e.largura > 0) || !(e.comprimento > 0)) return { ok: false, erro: 'Informe largura e comprimento maiores que zero.' }
  const area = arred2(e.largura * e.comprimento)
  const p = r.perda
  const itens = [
    item('chapa', 'Chapa de gesso 0,60 × 2,00', 'chapa', (area * p) / r.areaChapa, `${f(area)} m² × perda ${f(p)} ÷ ${f(r.areaChapa)} m² por chapa`),
    item('nervura', 'Nervura', 'unidade', (area * r.nervuraPorM2) / r.comprimentoBarra, `${f(area)} m² × ${f(r.nervuraPorM2)} ÷ ${f(r.comprimentoBarra)} m por nervura, sempre para cima`),
    item('juncao_h', 'Junção H', 'unidade', area * r.juncaoHPorM2, `${f(area)} m² × ${f(r.juncaoHPorM2)} un/m²`),
    item('arame', 'Arame nº 18', 'kg', area * r.arameKgM2, `${f(area)} m² × ${f(r.arameKgM2)} kg/m²`),
    item('gesso_cola', 'Gesso cola', `saco ${r.sacoGessoColaKg} kg`, (area * r.gessoColaKgM2) / r.sacoGessoColaKg, `${f(area)} m² × ${f(r.gessoColaKgM2)} kg/m² ÷ ${r.sacoGessoColaKg} kg por saco`),
    item('massa', 'Massa para junta', `balde ${r.baldeKg} kg`, (area * r.massaKgM2) / r.baldeKg, `${f(area)} m² × ${f(r.massaKgM2)} kg/m² ÷ ${r.baldeKg} kg por balde`),
    item('fita', 'Fita para junta', `rolo ${r.rolofitaM} m`, (area * r.fitaMM2) / r.rolofitaM, `${f(area)} m² × ${f(r.fitaMM2)} m/m² ÷ ${r.rolofitaM} m por rolo`),
  ]
  return { ok: true, area, itens, avisos: [] }
}
