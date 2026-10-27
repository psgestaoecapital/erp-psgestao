// PM-T (4a) · anti-esquecimento do cronômetro (CEO 06/10, blueprint 00.5-B): sem atividade por 30 min a tela pergunta;
// o cronômetro esquecido (aberto há mais de 12 h) é cortado no último sinal de vida. Regra pura; quem decide é a pessoa.
export const INATIVIDADE_MIN = 30
export const TETO_ESQUECIDO_H = 12

export const inativo = (ultimaAtividade: number, agora: number) => agora - ultimaAtividade >= INATIVIDADE_MIN * 60_000
export const esquecido = (inicioIso: string, agora: number) => agora - new Date(inicioIso).getTime() >= TETO_ESQUECIDO_H * 3_600_000

// Fim do corte: o último sinal de vida, nunca antes do início.
export const fimDoCorte = (inicioIso: string, ultimaAtividade: number) => new Date(Math.max(ultimaAtividade, new Date(inicioIso).getTime()))
