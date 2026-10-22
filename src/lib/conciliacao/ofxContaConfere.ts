// src/lib/conciliacao/ofxContaConfere.ts
// Travas da importação de OFX (pedido da Jordana 20/10 — extrato da Proplay importado na SICREDI PRIGOL da Pdois):
//   1) o banco/conta do ARQUIVO (<BANKACCTFROM>: BANKID/BRANCHID/ACCTID) tem de bater com a conta escolhida;
//   2) aviso quando movimentos do arquivo já foram importados em outra empresa do mesmo grupo.
// Funções puras (sem rede) — a tela faz as consultas e chama estas para decidir. Gate: check-ofx-conta-confere.ts.

export interface ContaOFX {
  bankId: string | null
  branchId: string | null
  acctId: string | null
}

export interface ContaCadastro {
  nome?: string | null
  banco?: string | null
  banco_codigo?: string | null
  agencia?: string | null
  conta?: string | null
}

export interface Conferencia {
  /** true = bate; false = é de outra conta (bloquear); null = não dá para conferir (cadastro ou arquivo sem dado). */
  confere: boolean | null
  motivo: string
}

const digitos = (s: string | null | undefined): string => (s ?? '').replace(/\D/g, '').replace(/^0+/, '')

/** Lê BANKID/BRANCHID/ACCTID do bloco <BANKACCTFROM> (OFX 1.x SGML ou 2.x XML). null se o arquivo não traz conta bancária. */
export function extrairContaOFX(texto: string): ContaOFX | null {
  if (!texto) return null
  const ini = texto.search(/<BANKACCTFROM>/i)
  if (ini < 0) return null
  const resto = texto.slice(ini)
  const fim = resto.search(/<\/BANKACCTFROM>|<BANKTRANLIST>|<STMTTRN>/i)
  const bloco = fim > 0 ? resto.slice(0, fim) : resto.slice(0, 600)
  const tag = (t: string) => {
    const m = bloco.match(new RegExp(`<${t}>([^<\\r\\n]+)`, 'i'))
    const v = m ? m[1].trim() : ''
    return v || null
  }
  const conta = { bankId: tag('BANKID'), branchId: tag('BRANCHID'), acctId: tag('ACCTID') }
  return conta.bankId || conta.acctId ? conta : null
}

/** Código do banco do cadastro: banco_codigo ou o campo banco quando é número (ex.: "748"). '' = desconhecido. */
function codigoBancoCadastro(c: ContaCadastro): string {
  const cod = digitos(c.banco_codigo)
  if (cod) return cod
  const b = (c.banco ?? '').trim()
  return /^\d{1,4}$/.test(b) ? digitos(b) : ''
}

/** A conta do arquivo contém a do cadastro (tolera agência/posto à frente e dígito verificador a mais ou a menos). */
function contaBate(acctArquivo: string, contaCadastro: string): boolean {
  if (acctArquivo === contaCadastro) return true
  if (acctArquivo.includes(contaCadastro) || contaCadastro.includes(acctArquivo)) return true
  const semDv = contaCadastro.slice(0, -1)
  return semDv.length >= 4 && acctArquivo.includes(semDv)
}

export function contaOFXConfere(ofx: ContaOFX, cad: ContaCadastro): Conferencia {
  const bancoArq = digitos(ofx.bankId)
  const bancoCad = codigoBancoCadastro(cad)
  if (bancoArq && bancoCad && bancoArq !== bancoCad) {
    return { confere: false, motivo: `banco do arquivo ${bancoArq} ≠ banco da conta ${bancoCad}` }
  }
  const acct = digitos(ofx.acctId)
  const conta = digitos(cad.conta)
  if (!acct || !conta) return { confere: null, motivo: 'sem número de conta para conferir' }
  if (!contaBate(acct, conta)) {
    return { confere: false, motivo: `conta do arquivo ${acct} ≠ conta cadastrada ${conta}` }
  }
  return { confere: true, motivo: 'banco e conta conferem' }
}

/** Descrição curta da conta do arquivo: "banco 133 · ag. 1553 · conta 857106". */
export function descreverContaOFX(ofx: ContaOFX): string {
  const partes = [
    ofx.bankId ? `banco ${digitos(ofx.bankId) || ofx.bankId}` : '',
    ofx.branchId ? `ag. ${ofx.branchId}` : '',
    ofx.acctId ? `conta ${ofx.acctId}` : '',
  ].filter(Boolean)
  return partes.join(' · ') || 'outra conta'
}

/** Mensagem do bloqueio: "Este extrato é da conta X (empresa Y?), e não da conta escolhida." */
export function mensagemContaErrada(
  ofx: ContaOFX,
  escolhida: ContaCadastro,
  achada?: { nome: string | null; empresa: string | null } | null,
): string {
  const contaX = achada?.nome ? `${achada.nome} (${descreverContaOFX(ofx)})` : descreverContaOFX(ofx)
  const empresaY = achada?.empresa ? ` (empresa ${achada.empresa}?)` : ''
  const nomeEscolhida = escolhida.nome ? ` (${escolhida.nome})` : ''
  return `Este extrato é da conta ${contaX}${empresaY}, e não da conta escolhida${nomeEscolhida}. Nada foi importado.`
}

// ── Aviso de movimento já importado em outra empresa do grupo ────────────────────────────────────────────────

export interface MovimentoArquivo {
  id_externo: string | null
  data_transacao: string
  valor: number
  natureza: string
  descricao: string
}

export interface MovimentoExistente {
  company_id: string
  id_externo: string | null
  data_transacao: string
  valor: number | string
  natureza: string
  descricao: string | null
}

const normDesc = (s: string | null | undefined) =>
  (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim()

/**
 * Quantos movimentos do arquivo já existem em cada outra empresa: mesmo FITID (com o mesmo valor — o Bradesco
 * reaproveita FITID entre exportações, ver check-ofx-dedup-conteudo), ou mesma data + valor + natureza + descrição.
 */
export function movimentosJaNoGrupo(
  arquivo: MovimentoArquivo[],
  existentes: MovimentoExistente[],
): Record<string, number> {
  const porFitid = new Map<string, Set<string>>()
  const porChave = new Map<string, Set<string>>()
  const add = (m: Map<string, Set<string>>, k: string, co: string) => {
    if (!m.has(k)) m.set(k, new Set())
    m.get(k)!.add(co)
  }
  const chave = (d: string, v: number | string, n: string, desc: string | null) =>
    `${d}|${Number(v).toFixed(2)}|${n}|${normDesc(desc)}`
  for (const e of existentes) {
    if (e.id_externo) add(porFitid, `${e.id_externo}|${Number(e.valor).toFixed(2)}`, e.company_id)
    add(porChave, chave(e.data_transacao, e.valor, e.natureza, e.descricao), e.company_id)
  }
  const contagem: Record<string, number> = {}
  for (const m of arquivo) {
    const empresas = new Set<string>()
    if (m.id_externo) porFitid.get(`${m.id_externo}|${Number(m.valor).toFixed(2)}`)?.forEach((c) => empresas.add(c))
    porChave.get(chave(m.data_transacao, m.valor, m.natureza, m.descricao))?.forEach((c) => empresas.add(c))
    empresas.forEach((c) => { contagem[c] = (contagem[c] ?? 0) + 1 })
  }
  return contagem
}
