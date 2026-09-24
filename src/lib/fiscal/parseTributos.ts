// Parser de tributos do XML fiscal — TIPO-AWARE (NF-e ≠ NFS-e). Puro (sem I/O) para ser testável.
//
// Por que existe (achado 24/09, provado no XML): o parser antigo fazia um match cego de <vTotTrib>
// no XML inteiro. Num XML de NFS-e (padrão nacional) essa tag NÃO existe — o que existe é
// <totTrib> com <pTotTribSN> (o percentual do Simples que NÓS enviamos) — então gravava null e
// perdíamos a informação que EXISTE. E na NF-e o match cego pegaria a primeira ocorrência (podia ser
// a de um item), não o total. Aqui cada layout é lido pelo seu próprio grupo:
//   NF-e   → <total><ICMSTot><vTotTrib> (total) e <det><imposto><vTotTrib> (por item, diagnóstico).
//   NFS-e  → <totTrib>: pTotTribSN (percentual único do Simples) e/ou vTotTribFed/Est/Mun (valores).
// As tags são do leiaute oficial (SEFAZ NF-e / NFS-e nacional), não deduzidas de provedor.

export interface TributosParsed {
  tipo: 'nfe' | 'nfse' | 'desconhecido'
  // valor monetário aproximado dos tributos, quando o XML traz (NF-e: ICMSTot; NFS-e: soma Fed+Est+Mun)
  vTotTrib: number | null
  // NFS-e Simples: percentual único (ex.: 6.00). Não é valor — é %.
  pTotTribSN: number | null
  vTotTribFed: number | null
  vTotTribEst: number | null
  vTotTribMun: number | null
  // NF-e: quantos itens trazem <vTotTrib> > 0 (diagnóstico: a Focus preenche por item?)
  itensComVTotTrib: number
}

function num(s: string | undefined | null): number | null {
  if (s == null) return null
  const t = String(s).trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

// pega o conteúdo de <name>…</name> tolerando prefixo de namespace (ns:name) e atributos.
function tag(xml: string, name: string): string | undefined {
  const m = xml.match(new RegExp(`<(?:[\\w.-]+:)?${name}(?:\\s[^>]*)?>\\s*([^<]*?)\\s*</(?:[\\w.-]+:)?${name}>`, 'i'))
  return m?.[1]
}

// pega o bloco interno de <name …>…</name> (primeira ocorrência), tolerando namespace/atributos.
function block(xml: string, name: string): string | undefined {
  const m = xml.match(new RegExp(`<(?:[\\w.-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?${name}>`, 'i'))
  return m?.[1]
}

export function parseTributos(xml: string): TributosParsed {
  const base: TributosParsed = {
    tipo: 'desconhecido', vTotTrib: null, pTotTribSN: null,
    vTotTribFed: null, vTotTribEst: null, vTotTribMun: null, itensComVTotTrib: 0,
  }
  if (!xml || typeof xml !== 'string') return base

  const isNfse = /<(?:[\w.-]+:)?(infNFSe|NFSe|DPS|infDPS|totTrib|pTotTribSN)\b/i.test(xml)
  const isNfe = /<(?:[\w.-]+:)?(infNFe|ICMSTot)\b/i.test(xml)

  // NFS-e (padrão nacional): grupo totTrib
  if (isNfse && !isNfe) {
    const tt = block(xml, 'totTrib') ?? xml
    const fed = num(tag(tt, 'vTotTribFed'))
    const est = num(tag(tt, 'vTotTribEst'))
    const mun = num(tag(tt, 'vTotTribMun'))
    const somaMonet = (fed == null && est == null && mun == null)
      ? null
      : Number(((fed ?? 0) + (est ?? 0) + (mun ?? 0)).toFixed(2))
    return {
      ...base, tipo: 'nfse',
      pTotTribSN: num(tag(tt, 'pTotTribSN')),
      vTotTribFed: fed, vTotTribEst: est, vTotTribMun: mun,
      vTotTrib: somaMonet,
    }
  }

  // NF-e: total no ICMSTot + diagnóstico por item
  if (isNfe) {
    const icmsTot = block(xml, 'ICMSTot')
    const total = icmsTot ? num(tag(icmsTot, 'vTotTrib')) : null
    const itens = xml.match(/<(?:[\w.-]+:)?det\b[\s\S]*?<\/(?:[\w.-]+:)?det>/gi) ?? []
    let comItem = 0
    for (const it of itens) {
      const v = num(tag(it, 'vTotTrib'))
      if (v != null && v > 0) comItem++
    }
    return { ...base, tipo: 'nfe', vTotTrib: total, itensComVTotTrib: comItem }
  }

  // Desconhecido: best-effort (compat) — vTotTrib em qualquer lugar
  return { ...base, vTotTrib: num(tag(xml, 'vTotTrib')) }
}
