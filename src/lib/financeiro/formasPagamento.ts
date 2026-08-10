// Fonte única das formas de pagamento (Pagar e Receber) + tipos de chave PIX e validação por tipo.
// Pendência Jordana #4: + Cheque, Permuta, Débito automático; PIX abre tipo de chave + chave.

export interface Opcao { v: string; l: string }

export const FORMAS_PAGAMENTO: Opcao[] = [
  { v: 'pix', l: 'Pix' },
  { v: 'boleto', l: 'Boleto' },
  { v: 'transferencia', l: 'Transferência (TED/DOC)' },
  { v: 'cartao_credito', l: 'Cartão de crédito' },
  { v: 'cartao_debito', l: 'Cartão de débito' },
  { v: 'dinheiro', l: 'Dinheiro' },
  { v: 'cheque', l: 'Cheque' },
  { v: 'permuta', l: 'Permuta' },
  { v: 'debito_automatico', l: 'Débito automático' },
]

export const ehPix = (forma: string | null | undefined) => (forma ?? '').toLowerCase() === 'pix'

export const TIPOS_CHAVE_PIX: Opcao[] = [
  { v: 'cpf_cnpj', l: 'CPF/CNPJ' },
  { v: 'telefone', l: 'Telefone' },
  { v: 'email', l: 'E-mail' },
  { v: 'aleatoria', l: 'Aleatória (EVP)' },
  { v: 'copia_cola', l: 'Copia e cola (QR)' },
]

const soDigitos = (s: string) => (s ?? '').replace(/\D/g, '')

// Máscara amigável por tipo (o valor salvo é o cru/normalizado — ver normalizarChavePix).
export function mascararChavePix(tipo: string, valor: string): string {
  if (tipo === 'cpf_cnpj') {
    const d = soDigitos(valor).slice(0, 14)
    if (d.length <= 11) return d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2')
    return d.replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2}\.\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,4})$/, '$1/$2').replace(/(\d{4})(\d{1,2})$/, '$1-$2')
  }
  if (tipo === 'telefone') {
    const d = soDigitos(valor).slice(0, 11)
    if (d.length <= 10) return d.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{4})(\d{1,4})$/, '$1-$2')
    return d.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d{1,4})$/, '$1-$2')
  }
  return valor // email, aleatoria, copia_cola: sem máscara
}

// Valor a persistir (normalizado): CPF/CNPJ e telefone = só dígitos (telefone com +55); resto = trim.
export function normalizarChavePix(tipo: string, valor: string): string {
  const t = (valor ?? '').trim()
  if (tipo === 'cpf_cnpj') return soDigitos(t)
  if (tipo === 'telefone') { const d = soDigitos(t); return d ? `+55${d}` : '' }
  return t
}

// Validação por tipo → mensagem de erro (null = ok). Usada pra travar salvar/gerar remessa incompleta.
export function validarChavePix(tipo: string, valor: string): string | null {
  const t = (valor ?? '').trim()
  if (!t) return 'Informe a chave PIX.'
  if (tipo === 'cpf_cnpj') { const d = soDigitos(t); return d.length === 11 || d.length === 14 ? null : 'CPF (11) ou CNPJ (14) dígitos.' }
  if (tipo === 'telefone') { const d = soDigitos(t); return d.length === 10 || d.length === 11 ? null : 'Telefone com DDD (10 ou 11 dígitos).' }
  if (tipo === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t) ? null : 'E-mail inválido.'
  if (tipo === 'aleatoria') return /^[0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12}$/.test(t) ? null : 'Chave aleatória (EVP) no formato UUID.'
  if (tipo === 'copia_cola') return t.length >= 20 ? null : 'Cole o payload PIX (copia e cola) completo.'
  return 'Tipo de chave inválido.'
}
