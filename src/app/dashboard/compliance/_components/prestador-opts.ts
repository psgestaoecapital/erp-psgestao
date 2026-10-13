// #87 · opções do pré-cadastro de prestador (Compras/Manutenção). Base para a automação de
// NRs na fase 2 — os valores (v) são estáveis e gravados no banco; os rótulos (l) são a UI.
export const CLASSIFICACAO_SERVICO = [
  { v: 'fixo', l: 'Fixo' },
  { v: 'eventual', l: 'Eventual' },
] as const

export const TIPOS_SERVICO = [
  { v: 'manutencao', l: 'Manutenção' },
  { v: 'montagem_instalacao', l: 'Montagem / Instalação' },
  { v: 'construcao_civil', l: 'Construção civil' },
  { v: 'carga_descarga', l: 'Carga / Descarga' },
  { v: 'transporte', l: 'Transporte' },
] as const

export const ATIVIDADES_ESPECIAIS = [
  { v: 'trabalho_altura', l: 'Trabalho em altura' },
  { v: 'espaco_confinado', l: 'Espaço confinado' },
  { v: 'eletricidade', l: 'Eletricidade' },
  { v: 'trabalho_quente', l: 'Trabalho a quente (corte e solda)' },
  { v: 'icamento', l: 'Içamento de cargas e pessoas' },
  { v: 'escavacao', l: 'Escavação' },
  { v: 'maquinas', l: 'Máquinas (bloqueio e sinalização)' },
] as const

export const labelDe = (opts: readonly { v: string; l: string }[], v: string) =>
  opts.find((o) => o.v === v)?.l ?? v
