// #2936 etapa 2 · Assinatura eletrônica de contratos — utilitários comuns das rotas do servidor e das telas.
// O token do link nunca é guardado (o banco só tem o hash); o código de confirmação (2º fator) nunca volta para a tela:
// a rota pública o manda por e-mail ao signatário.

export const BUCKET_CONTRATOS = 'contratos-assinados'
export const TOKEN_RE = /^[0-9a-f]{48}$/

export function linkAssinatura(origem: string, token: string): string {
  return `${origem.replace(/\/+$/, '')}/sign/contrato/${token}`
}

// IP do cliente vindo do proxy (x-forwarded-for). Só IPv4/IPv6 de formato válido vai ao banco (coluna inet).
export function ipDaRequisicao(req: Request): string | null {
  const bruto = (req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || '').split(',')[0].trim()
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(bruto) && bruto.split('.').every((p) => Number(p) <= 255)) return bruto
  if (/^[0-9a-f:]+$/i.test(bruto) && bruto.includes(':') && bruto.length <= 45) return bruto
  return null
}

export function escaparHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// "maria.souza@exemplo.com" → "ma***@exemplo.com" (para dizer ao signatário para onde foi o código, sem expor o e-mail)
export function mascararEmail(email: string): string {
  const [u, d] = email.split('@')
  if (!d) return '***'
  return `${u.slice(0, 2)}***@${d}`
}

export async function sha256Hex(dados: ArrayBuffer): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', dados)
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function soDigitos(s: string | null | undefined): string {
  return (s ?? '').replace(/\D/g, '')
}

// Telefone brasileiro para o wa.me: 10/11 dígitos ganham o 55 na frente.
export function telefoneWhatsApp(tel: string | null | undefined): string | null {
  const d = soDigitos(tel)
  if (d.length === 10 || d.length === 11) return `55${d}`
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) return d
  return null
}

export function textoWhatsApp(nome: string, empresa: string | null, contrato: string, link: string): string {
  return `Olá, ${nome.split(' ')[0]}! ${empresa ? `A ${empresa} enviou` : 'Enviamos'} o contrato "${contrato}" para você assinar pelo celular. `
    + `Abra o link, confira o documento e confirme com o código que chega no seu e-mail: ${link}`
}
