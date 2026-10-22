// Nome do arquivo baixado (chamado #2957): boleto e nota fiscal saem com um nome que o usuário reconhece e manda ao
// cliente, em vez de "boleto-<nosso número>.pdf", "<chave>.xml" ou o nome técnico do storage.
//   boleto: <Cliente>_<vencimento DDMMAAAA>.pdf          → FC_Pisos_30102026.pdf
//   nota:   <Cliente>_NF<número>_<emissão DDMMAAAA>.<ext> → FC_Pisos_NF1234_14102026.pdf / .xml
// Cliente = nome fantasia; sem ele, razão social. Sem acento, espaço vira "_", sem / \ : * ? " < > |, até 30 caracteres.
// Funções puras (sem rede): usadas no navegador e na rota do boleto; o gate check-nome-arquivo-download as testa.

const LIMITE_CLIENTE = 30

/** Parte do cliente no nome do arquivo: fantasia (ou razão social), só ASCII seguro, até 30 caracteres. */
export function nomeClienteArquivo(fantasia?: string | null, razao?: string | null): string {
  const bruto = (fantasia ?? '').trim() || (razao ?? '').trim()
  const limpo = bruto
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // tira acento
    .replace(/[^A-Za-z0-9._-]+/g, '_')                 // espaço, / \ : * ? " < > | e o resto viram "_"
    .replace(/_+/g, '_')
    .replace(/^[_.-]+|[_.-]+$/g, '')
    .slice(0, LIMITE_CLIENTE)
    .replace(/[_.-]+$/g, '')
  return limpo || 'Cliente'
}

/** DDMMAAAA de uma data. Data pura (AAAA-MM-DD) é lida como está; data com hora vai para o horário de Brasília. */
export function dataArquivo(data?: string | Date | null): string {
  if (!data) return ''
  if (typeof data === 'string') {
    const so = /^(\d{4})-(\d{2})-(\d{2})$/.exec(data.trim())
    if (so) return `${so[3]}${so[2]}${so[1]}`
  }
  const d = data instanceof Date ? data : new Date(data)
  if (Number.isNaN(d.getTime())) return ''
  const p = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' })
    .formatToParts(d)
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? ''
  return `${v('day')}${v('month')}${v('year')}`
}

function juntar(partes: string[], ext: string): string {
  return `${partes.filter(Boolean).join('_')}.${ext}`
}

/** Boleto: Cliente_DDMMAAAA.pdf */
export function nomeArquivoBoleto(o: { fantasia?: string | null; razao?: string | null; vencimento?: string | Date | null }): string {
  return juntar([nomeClienteArquivo(o.fantasia, o.razao), dataArquivo(o.vencimento)], 'pdf')
}

/** Nota fiscal (NF-e, NFS-e, DANFE, XML): Cliente_NF<número>_DDMMAAAA.<ext> */
export function nomeArquivoNota(o: {
  fantasia?: string | null; razao?: string | null; numero?: string | number | null; emissao?: string | Date | null; ext: 'pdf' | 'xml'
}): string {
  const num = String(o.numero ?? '').replace(/[^0-9A-Za-z]/g, '')
  return juntar([nomeClienteArquivo(o.fantasia, o.razao), num ? `NF${num}` : '', dataArquivo(o.emissao)], o.ext)
}

/** Lote (vários arquivos ou zip): nomes repetidos ganham sufixo _2, _3… antes da extensão. */
export function nomesUnicos(nomes: string[]): string[] {
  const usados = new Set<string>()
  return nomes.map((n) => {
    if (!usados.has(n.toLowerCase())) { usados.add(n.toLowerCase()); return n }
    const i = n.lastIndexOf('.')
    const base = i > 0 ? n.slice(0, i) : n
    const ext = i > 0 ? n.slice(i) : ''
    let k = 2
    while (usados.has(`${base}_${k}${ext}`.toLowerCase())) k++
    const novo = `${base}_${k}${ext}`
    usados.add(novo.toLowerCase())
    return novo
  })
}

/** Lê o nome do arquivo do cabeçalho Content-Disposition (filename="..."), ou null. */
export function nomeDoContentDisposition(cd: string | null | undefined): string | null {
  if (!cd) return null
  const m = /filename="?([^";]+)"?/i.exec(cd)
  return m?.[1]?.trim() || null
}
