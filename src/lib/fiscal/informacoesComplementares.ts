// Informações Complementares da NF-e (tag infCpl → campo Focus informacoes_adicionais_contribuinte).
// Pedido Jordana 20/10 (FCR): a tela de faturamento mostra o texto FINAL antes de emitir (observação do pedido + textos
// legais do Simples/crédito #2876 + Lei 12.741), deixa editar, e avisa quando passa do limite do campo — nunca corta o
// texto sozinho: o que sai na nota é o que a pessoa viu. Leiaute NF-e 4.00 (MOC): infCpl com até 5000 caracteres.
// O provedor (Focus) passa o texto por sanitizeTextoFiscal antes de enviar (quebra de linha vira espaço, "…" vira "...");
// por isso a prévia já devolve o texto sanitizado — a prévia, o limite e a nota contam o mesmo texto (revisor 27/10).
import { sanitizeTextoFiscal } from './providers/focusnfe'

export const LIMITE_INF_CPL = 5000

// Texto que vai para a nota: o editado na tela (quando veio) substitui o composto por inteiro; vazio = nota sem texto.
export function textoInformacoesComplementares(composto: string | undefined, editado?: string | null): string | undefined {
  const t = typeof editado === 'string' ? editado : composto
  return sanitizeTextoFiscal(t) || undefined
}

export function excedeLimiteInfCpl(texto: string | undefined | null): boolean {
  return (texto ?? '').length > LIMITE_INF_CPL
}

export function mensagemLimiteInfCpl(tamanho: number): string {
  return `As informações complementares têm ${tamanho} caracteres e o limite da NF-e é ${LIMITE_INF_CPL}. Encurte o texto antes de emitir.`
}
