// Marcação leve do briefing (P&M · Pdois/Marciana, CEO 07/10): o editor guarda TEXTO com **negrito**, _itálico_,
// listas (- / 1.) e [links](https://…). Aqui ele vira uma estrutura simples que a tela desenha com elementos React —
// nunca HTML cru (sem dangerouslySetInnerHTML: nada do texto vira script na tela de ninguém). Link só http(s).

export type Trecho =
  | { t: 'texto'; v: string }
  | { t: 'negrito'; v: Trecho[] }
  | { t: 'italico'; v: Trecho[] }
  | { t: 'link'; v: string; href: string }

export type Bloco =
  | { t: 'paragrafo'; linhas: Trecho[][] }
  | { t: 'lista'; numerada: boolean; itens: Trecho[][] }

const LINK = /^\[([^\]\n]+)\]\(([^)\s]+)\)/

export function hrefSeguro(url: string): string | null {
  const u = url.trim()
  return /^https?:\/\/[^\s<>"']+$/i.test(u) ? u : null
}

export function trechos(s: string): Trecho[] {
  const out: Trecho[] = []
  let buf = ''
  const solta = () => { if (buf) { out.push({ t: 'texto', v: buf }); buf = '' } }
  let i = 0
  while (i < s.length) {
    const resto = s.slice(i)
    if (resto.startsWith('**')) {
      const fim = s.indexOf('**', i + 2)
      if (fim > i + 2) { solta(); out.push({ t: 'negrito', v: trechos(s.slice(i + 2, fim)) }); i = fim + 2; continue }
    }
    if (s[i] === '_' && (i === 0 || !/[\p{L}\p{N}]/u.test(s[i - 1]))) {
      const fim = s.indexOf('_', i + 1)
      if (fim > i + 1 && (fim + 1 >= s.length || !/[\p{L}\p{N}]/u.test(s[fim + 1]))) {
        solta(); out.push({ t: 'italico', v: trechos(s.slice(i + 1, fim)) }); i = fim + 1; continue
      }
    }
    if (s[i] === '[') {
      const m = LINK.exec(resto)
      const href = m ? hrefSeguro(m[2]) : null
      if (m && href) { solta(); out.push({ t: 'link', v: m[1], href }); i += m[0].length; continue }
    }
    buf += s[i]; i++
  }
  solta()
  return out
}

const ITEM = /^\s*[-*•]\s+(.*)$/
const ITEM_NUM = /^\s*\d+[.)]\s+(.*)$/

export function blocos(texto: string | null | undefined): Bloco[] {
  const out: Bloco[] = []
  for (const linha of (texto ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const ult = out[out.length - 1]
    const mi = ITEM.exec(linha); const mn = mi ? null : ITEM_NUM.exec(linha)
    if (mi || mn) {
      const numerada = !!mn; const item = trechos((mi ?? mn)![1])
      if (ult?.t === 'lista' && ult.numerada === numerada) ult.itens.push(item)
      else out.push({ t: 'lista', numerada, itens: [item] })
    } else if (!linha.trim()) {
      if (ult && !(ult.t === 'paragrafo' && ult.linhas.length === 0)) out.push({ t: 'paragrafo', linhas: [] })
    } else if (ult?.t === 'paragrafo') ult.linhas.push(trechos(linha))
    else out.push({ t: 'paragrafo', linhas: [trechos(linha)] })
  }
  return out.filter((b) => (b.t === 'paragrafo' ? b.linhas.length > 0 : b.itens.length > 0))
}
