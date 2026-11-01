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
export type RegrasRevestimentoColado = {
  tipo: 'revestimento_colado'
  perda: number; areaChapa: number
  gessoColaKgM2: number; sacoGessoColaKg: number
  massaKgM2: number; fitaMM2: number; baldeKg: number; rolofitaM: number
}
export type RegrasRevestimentoEstruturado = {
  tipo: 'revestimento_estruturado'
  perda: number; areaChapa: number; comprimentoBarra: number; rolobandaM: number
  faixas: FaixaPeDireito[]; faixas2: FaixaPeDireito[] // 1 chapa e 2 chapas
  parafusoPorM2: { '0.6': number; '0.4': number; '0.6d': number; '0.4d': number } // PPA25, 1 chapa
  parafusoDuasPPA25PorM2: { '0.6': number; '0.4': number; '0.6d': number; '0.4d': number } // 1ª camada, 2 chapas
  parafusoDuasPPA35PorM2: { '0.6': number; '0.4': number; '0.6d': number; '0.4d': number } // 2ª camada, 2 chapas
  massaKgM2: number; fitaMM2: number; baldeKg: number; rolofitaM: number
}
export type Regras = RegrasParede | RegrasForroF530 | RegrasForroAramado | RegrasRevestimentoColado | RegrasRevestimentoEstruturado

export type ItemCalculo = {
  chave: string; descricao: string; unidadeCompra: string
  quantidadeBruta: number; quantidade: number; conta: string
  // Quantidade real ao lado da embalagem de compra (ex.: "2.640 un necessárias → 27 centos (2.700 un)"); só nas embalagens de contagem
  equivalente?: string
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

// Parede separativa (entre unidades) e parede corta-fogo: mesma conta da parede, faixas de pé-direito PRÓPRIAS (dado, editável por empresa).
// Valores: referência de mercado a validar com o fabricante. Separativa sem o montante a mais que o site de referência soma (anomalia a não copiar).
const fx = (de: number, ate: number, bitola: FaixaPeDireito['bitola'], espacamento: 0.4 | 0.6, duplo = false): FaixaPeDireito => ({ de, ate, bitola, espacamento, duplo })
export const REGRAS_PAREDE_SEPARATIVA: RegrasParede = {
  ...REGRAS_PAREDE_SIMPLES_ST,
  faixas: [
    fx(0.2, 2.9, 'M48', 0.6), fx(2.95, 3.2, 'M48', 0.4), fx(3.25, 3.7, 'M70', 0.6), fx(3.75, 4.1, 'M70', 0.4),
    fx(4.15, 4.4, 'M70', 0.6, true), fx(4.45, 4.8, 'M70', 0.4, true), fx(4.85, 5.0, 'M90', 0.6, true), fx(5.05, 5.5, 'M90', 0.4, true),
  ],
}
export const REGRAS_PAREDE_CORTA_FOGO: RegrasParede = {
  ...REGRAS_PAREDE_SIMPLES_ST, chapasPorFace: 2,
  faixas: [
    fx(0.2, 3.8, 'M70', 0.6), fx(3.85, 4.2, 'M70', 0.4), fx(4.25, 4.5, 'M70', 0.6, true), fx(4.55, 4.9, 'M70', 0.4, true),
    fx(4.95, 5.1, 'M90', 0.6, true), fx(5.15, 5.6, 'M90', 0.4, true),
  ],
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

// Revestimento colado (chapa colada direto na alvenaria, sem estrutura). Valores: referência de mercado a validar.
export const REGRAS_REVESTIMENTO_COLADO: RegrasRevestimentoColado = {
  tipo: 'revestimento_colado', perda: 1.05, areaChapa: 2.16,
  gessoColaKgM2: 12.5, sacoGessoColaKg: 5,
  massaKgM2: 0.5, fitaMM2: 1.5, baldeKg: 22, rolofitaM: 150,
}

// Revestimento estruturado (chapa parafusada em estrutura própria encostada na alvenaria, uma face só). Valores: referência de mercado
// a validar. Faixas de 2 chapas: o site de referência trava entre 2,30 e 2,95 m (anomalia a não copiar) — aqui essa faixa usa M70 @600,
// a confirmar com o fabricante.
const parafusos1 = { '0.6': 13, '0.4': 15, '0.6d': 18, '0.4d': 20 }
export const REGRAS_REVESTIMENTO_ESTRUTURADO: RegrasRevestimentoEstruturado = {
  tipo: 'revestimento_estruturado', perda: 1.05, areaChapa: 2.16, comprimentoBarra: 3, rolobandaM: 10,
  faixas: [
    { de: 0.2, ate: 1.5, bitola: 'M48', espacamento: 0.6, duplo: false },
    { de: 1.55, ate: 1.8, bitola: 'M48', espacamento: 0.4, duplo: false },
    { de: 1.85, ate: 2.0, bitola: 'M48', espacamento: 0.6, duplo: true },
    { de: 2.05, ate: 2.2, bitola: 'M48', espacamento: 0.4, duplo: true },
    { de: 2.25, ate: 2.3, bitola: 'M70', espacamento: 0.6, duplo: false },
    { de: 2.35, ate: 2.55, bitola: 'M70', espacamento: 0.4, duplo: false },
    { de: 2.6, ate: 2.75, bitola: 'M70', espacamento: 0.6, duplo: true },
    { de: 2.8, ate: 3.05, bitola: 'M70', espacamento: 0.4, duplo: true },
    { de: 3.1, ate: 3.2, bitola: 'M90', espacamento: 0.6, duplo: true },
    { de: 3.25, ate: 3.55, bitola: 'M90', espacamento: 0.4, duplo: true },
  ],
  faixas2: [
    { de: 0.2, ate: 2.25, bitola: 'M48', espacamento: 0.6, duplo: false },
    { de: 2.3, ate: 2.95, bitola: 'M70', espacamento: 0.6, duplo: false },
    { de: 3.0, ate: 3.05, bitola: 'M70', espacamento: 0.6, duplo: false },
    { de: 3.1, ate: 3.65, bitola: 'M70', espacamento: 0.6, duplo: true },
    { de: 3.7, ate: 4.2, bitola: 'M90', espacamento: 0.6, duplo: true },
  ],
  parafusoPorM2: parafusos1,
  parafusoDuasPPA25PorM2: { '0.6': 6, '0.4': 7, '0.6d': 9, '0.4d': 10 },
  parafusoDuasPPA35PorM2: { ...parafusos1 },
  massaKgM2: 0.5, fitaMM2: 1.5, baldeKg: 22, rolofitaM: 150,
}

const POR_EMBALAGEM: Record<string, number> = { cento: 100 }
const inteiro = (n: number) => Math.round(n).toLocaleString('pt-BR')
const item = (chave: string, descricao: string, unidadeCompra: string, bruta: number, conta: string): ItemCalculo => {
  const quantidade = paraCima(bruta)
  const porEmb = POR_EMBALAGEM[unidadeCompra]
  const equivalente = porEmb
    ? `${inteiro(arred2(bruta) * porEmb)} un necessárias → compra de ${quantidade} ${quantidade === 1 ? unidadeCompra : unidadeCompra + 's'} (${inteiro(quantidade * porEmb)} un)`
    : undefined
  return { chave, descricao, unidadeCompra, quantidadeBruta: arred2(bruta), quantidade, conta, ...(equivalente ? { equivalente } : {}) }
}

export function faixaDoPeDireito(faixas: FaixaPeDireito[], pd: number): FaixaPeDireito | null {
  // escolhe a última faixa que começa em/antes do pé-direito: entre 2,50 e 2,55 vale a anterior (nunca "trava")
  const ordenadas = [...faixas].sort((a, b) => a.de - b.de)
  let achada: FaixaPeDireito | null = null
  for (const x of ordenadas) if (pd + 1e-9 >= x.de) achada = x
  if (!achada || pd - 1e-9 > achada.ate + 0.05) return null
  return achada
}

export type EntradaParede = { comprimento: number; peDireito: number; vaos?: number; comLa?: boolean; camadas?: number; estruturaDupla?: boolean }
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
  // estrutura dupla (separativa): dois quadros independentes de guias, montantes e banda; chapas e parafusos não mudam
  const est = e.estruturaDupla ? 2 : 1
  const xq = e.estruturaDupla ? ' × 2 (estrutura dupla)' : ''
  const un = r.parafusoPorM2[`${fx.espacamento}${fx.duplo ? 'd' : ''}` as keyof RegrasParede['parafusoPorM2']]
  const itens = [
    item('chapa', 'Chapa de gesso', 'chapa', (area * cam * 2 * p) / r.areaChapa,
      `${f(area)} m² × ${cam * 2} camadas (${cam} por face) × perda ${f(p)} ÷ ${f(r.areaChapa)} m² por chapa`),
    item('guia', `Guia ${fx.bitola}`, 'barra 3 m', (L * 2 * est * p) / r.comprimentoBarra,
      `${f(L)} m × 2 (piso e teto)${xq} × perda ${f(p)} ÷ ${r.comprimentoBarra} m por barra`),
    item('montante', `Montante ${fx.bitola}${fx.duplo ? ' duplo' : ''} a cada ${fx.espacamento * 100} cm`, 'barra 3 m',
      ((L / fx.espacamento) * p * e.peDireito * (fx.duplo ? 2 : 1) * est) / r.comprimentoBarra,
      `${f(L)} m ÷ ${fx.espacamento} m × perda ${f(p)} × pé-direito ${f(e.peDireito)} m${fx.duplo ? ' × 2 (duplo)' : ''}${xq} ÷ ${r.comprimentoBarra} m por barra`),
    item('banda', 'Banda acústica', 'rolo 10 m', (L * 2 * est * p) / r.rolobandaM,
      `${f(L)} m × 2${xq} × perda ${f(p)} ÷ ${r.rolobandaM} m por rolo`),
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

export function calcularRevestimentoColado(r: RegrasRevestimentoColado, e: EntradaParede): Resultado {
  if (!(e.comprimento > 0) || !(e.peDireito > 0)) return { ok: false, erro: 'Informe comprimento e altura maiores que zero.' }
  const area = arred2(e.comprimento * e.peDireito - (e.vaos ?? 0))
  if (area <= 0) return { ok: false, erro: 'Os vãos descontados são maiores que a parede.' }
  const p = r.perda
  const itens = [
    item('chapa', 'Chapa de gesso', 'chapa', (area * p) / r.areaChapa, `${f(area)} m² × perda ${f(p)} ÷ ${f(r.areaChapa)} m² por chapa`),
    item('gesso_cola', 'Gesso cola', `saco ${r.sacoGessoColaKg} kg`, (area * r.gessoColaKgM2) / r.sacoGessoColaKg, `${f(area)} m² × ${f(r.gessoColaKgM2)} kg/m² ÷ ${r.sacoGessoColaKg} kg por saco`),
    item('massa', 'Massa para junta', `balde ${r.baldeKg} kg`, (area * r.massaKgM2) / r.baldeKg, `${f(area)} m² × ${f(r.massaKgM2)} kg/m² ÷ ${r.baldeKg} kg por balde`),
    item('fita', 'Fita para junta', `rolo ${r.rolofitaM} m`, (area * r.fitaMM2) / r.rolofitaM, `${f(area)} m² × ${f(r.fitaMM2)} m/m² ÷ ${r.rolofitaM} m por rolo`),
  ]
  return { ok: true, area, itens, avisos: [] }
}

// camadas: 1 ou 2 chapas (qualquer outro valor vira 1). Só uma face: guia piso/teto, montante e banda uma vez.
export function calcularRevestimentoEstruturado(r: RegrasRevestimentoEstruturado, e: EntradaParede): Resultado {
  if (!(e.comprimento > 0) || !(e.peDireito > 0)) return { ok: false, erro: 'Informe comprimento e altura maiores que zero.' }
  const area = arred2(e.comprimento * e.peDireito - (e.vaos ?? 0))
  if (area <= 0) return { ok: false, erro: 'Os vãos descontados são maiores que a parede.' }
  const cam = e.camadas === 2 ? 2 : 1
  const fx = faixaDoPeDireito(cam === 2 ? r.faixas2 : r.faixas, e.peDireito)
  if (!fx) return { ok: false, erro: `Altura de ${f(e.peDireito)} m fora das faixas cadastradas para ${cam} chapa${cam > 1 ? 's' : ''} — ajuste as regras do sistema.` }
  const L = e.comprimento, p = r.perda
  const k = `${fx.espacamento}${fx.duplo ? 'd' : ''}` as keyof RegrasRevestimentoEstruturado['parafusoPorM2']
  const itens = [
    item('chapa', 'Chapa de gesso', 'chapa', (area * cam * p) / r.areaChapa, `${f(area)} m² × ${cam} chapa${cam > 1 ? 's' : ''} × perda ${f(p)} ÷ ${f(r.areaChapa)} m² por chapa`),
    item('guia', `Guia ${fx.bitola}`, 'barra 3 m', (L * 2 * p) / r.comprimentoBarra, `${f(L)} m × 2 (piso e teto) × perda ${f(p)} ÷ ${r.comprimentoBarra} m por barra`),
    item('montante', `Montante ${fx.bitola}${fx.duplo ? ' duplo' : ''} a cada ${fx.espacamento * 100} cm`, 'barra 3 m',
      ((L / fx.espacamento) * p * e.peDireito * (fx.duplo ? 2 : 1)) / r.comprimentoBarra,
      `${f(L)} m ÷ ${fx.espacamento} m × perda ${f(p)} × altura ${f(e.peDireito)} m${fx.duplo ? ' × 2 (duplo)' : ''} ÷ ${r.comprimentoBarra} m por barra`),
    item('banda', 'Banda acústica', 'rolo 10 m', (L * 2 * p) / r.rolobandaM, `${f(L)} m × 2 × perda ${f(p)} ÷ ${r.rolobandaM} m por rolo`),
  ]
  if (cam === 1) itens.push(item('parafuso', 'Parafuso PPA25', 'cento', (area * r.parafusoPorM2[k]) / 100, `${f(area)} m² × ${r.parafusoPorM2[k]} un/m² ÷ 100 por cento`))
  else {
    itens.push(item('parafuso', 'Parafuso PPA25 (1ª chapa)', 'cento', (area * r.parafusoDuasPPA25PorM2[k]) / 100, `${f(area)} m² × ${r.parafusoDuasPPA25PorM2[k]} un/m² ÷ 100 por cento`))
    itens.push(item('parafuso_ppa35', 'Parafuso PPA35 (2ª chapa)', 'cento', (area * r.parafusoDuasPPA35PorM2[k]) / 100, `${f(area)} m² × ${r.parafusoDuasPPA35PorM2[k]} un/m² ÷ 100 por cento`))
  }
  itens.push(
    item('massa', 'Massa para junta', `balde ${r.baldeKg} kg`, (area * r.massaKgM2) / r.baldeKg, `${f(area)} m² × ${f(r.massaKgM2)} kg/m² ÷ ${r.baldeKg} kg por balde`),
    item('fita', 'Fita para junta', `rolo ${r.rolofitaM} m`, (area * r.fitaMM2) / r.rolofitaM, `${f(area)} m² × ${f(r.fitaMM2)} m/m² ÷ ${r.rolofitaM} m por rolo`),
  )
  return { ok: true, area, itens, avisos: [] }
}
