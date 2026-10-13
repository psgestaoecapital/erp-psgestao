// Tryo #110 + #262 · Oportunidade: o CLIENTE é o que identifica o card no kanban; a descrição do serviço/produto fica
// embaixo. O nome digitado no campo Cliente sem escolher da lista também vale (vira cadastro ou reusa o de mesmo nome) —
// antes só gravava se a pessoa clicasse numa sugestão, e o nome "sumia" ao reabrir. O telefone do cliente aparece no
// formulário e no card para o vendedor ligar.
export type ClienteContato = { telefone?: string | null; celular?: string | null; whatsapp?: string | null }

const limpo = (v: string | null | undefined) => (v ?? '').trim()

// celular > WhatsApp > fixo: o número que o vendedor mais provavelmente consegue usar
export function telefoneDoCliente(c: ClienteContato | null | undefined): string {
  if (!c) return ''
  return limpo(c.celular) || limpo(c.whatsapp) || limpo(c.telefone)
}

// link de discagem (tel:) só com dígitos; vazio se não houver número
export function linkTelefone(tel: string | null | undefined): string {
  const d = (tel ?? '').replace(/\D/g, '')
  return d.length >= 8 ? `tel:${d}` : ''
}

// a coluna titulo é obrigatória: sem descrição, o card leva o nome do cliente
export function tituloOportunidade(descricao: string, clienteNome: string): string {
  return (limpo(descricao) || limpo(clienteNome)).toUpperCase()
}

export function erroOportunidade(descricao: string, clienteNome: string): string | null {
  if (!limpo(descricao) && !limpo(clienteNome)) return 'Informe o cliente ou a descrição do serviço.'
  return null
}
