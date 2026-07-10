// URL canônica ESTÁVEL do app. Fonte única da verdade pra todo link compartilhável
// (proposta de orçamento, portal do cliente, convite, QR de instalação).
//
// POR QUÊ (RD-38): usar window.location.origin herda o host em que o usuário está —
// inclusive deployments CONGELADOS de preview/hash da Vercel (erp-psgestao-<hash>...
// .vercel.app), que são IMUTÁVEIS e servem o build velho pra sempre. Isso propagava
// a "versão antiga" pra clientes e time. Aqui o link SEMPRE aponta pro canônico.
//
// Valor vem de NEXT_PUBLIC_APP_URL (setar no Vercel/Production). Fallback = alias de
// produção atual. Ideal futuro: domínio próprio (app.psgestao.com.br) que nunca muda.
export const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://erp-psgestao.vercel.app').replace(/\/+$/, '')

// Hostname canônico (sem protocolo) — usado pela guarda de host no PwaBootstrap.
export function canonicalHostname(): string {
  try { return new URL(APP_URL).hostname } catch { return 'erp-psgestao.vercel.app' }
}
