#!/usr/bin/env tsx
// Classificador PURO (CEO 01/11) — entre as migrations CRÍTICAS, quais devem publicar SOZINHAS, fora do lote de
// críticas, cada uma com o seu PRÓPRIO @pos-migration. A fila passou a batelar até LOTE_MIG_CRIT_MAX (5) migrations
// críticas sob UM só @pos para drenar a fila; mas as de NÚCLEO ULTRA-SENSÍVEL nunca entram no lote: um erro numa
// dessas é inaceitável e o `git revert` da migration NÃO desfaz o ALTER/UPDATE/DELETE já aplicado no banco (RD-52 e
// reverter-automatico.sh trava 3 — revert de migration = down-migration humana). Isoladas, a atribuição da falha é
// inequívoca (1 PR = 1 @pos), sem precisar bissectar um lote.
//
// Categorias que publicam SOZINHA (decisão CEO 01/11):
//   • NR-36
//   • fiscal (NF-e/NFS-e/imposto/tributo/SPED/ICMS/ISS/PIS/COFINS)
//   • financeiro de cliente (boleto/título/parcela/repasse/cartão/cobrança/fatura/conciliação/conta bancária)
//   • RLS/permissão/isolamento entre empresas (policy/grant/revoke/row level security/auth.uid)
//   • LGPD/dados pessoais/salários (folha de pagamento/remuneração/anonimização)
// (o conserto-main é tratado pela própria fila, pela label — não depende deste classificador.)
//
// Viés de SEGURANÇA: migration sem conteúdo legível → SOZINHA (na dúvida, não batela). Isso só REDUZ a vazão do lote;
// nunca afrouxa — o pior caso é publicar uma crítica isolada, como era antes do lote.

export type Sozinha = { sozinha: boolean; motivo: string }

// Regexes sobre o ALVO já NORMALIZADO (minúsculo, sem acento, com `_`/`-`/`/` e espaços virando um só espaço; `.` mantido
// para auth.uid). Assim casa tanto no NOME do arquivo (ex.: `..._boleto.sql`) quanto no SQL.
const AREAS: { re: RegExp; nome: string }[] = [
  { re: /\bnr ?36\b/, nome: 'NR-36' },
  { re: /\b(nf e|nfs e|nota fiscal|notafiscal|imposto|tribut|sped|icms|iss|pis|cofins|fiscal)\b/, nome: 'fiscal' },
  { re: /\b(boleto|titulo|titulos|parcela|repasse|cartao|cobranca|fatura|conciliac|conta banc|remessa banc|retorno banc)/, nome: 'financeiro de cliente' },
  { re: /(row level security|create policy|alter policy|drop policy|\bgrant\b|\brevoke\b|permiss|\brls\b|isolament|auth\.uid)/, nome: 'RLS/permissão/isolamento' },
  { re: /(\blgpd\b|\bdados? pessoa|\bsalario|folha pag|remunerac|anonimiz)/, nome: 'LGPD/dados pessoais/salários' },
]

const semAcento = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

// nomes = caminhos das migrations da PR (um por linha); sql = conteúdo concatenado das migrations (ou undefined).
export function migracaoSozinha(nomes: string, sql: string | undefined): Sozinha {
  if (sql === undefined || sql.trim() === '') {
    return { sozinha: true, motivo: 'migration sem conteúdo legível — na dúvida, publica sozinha (não batela)' }
  }
  // tira comentários e literais de string (ajuda/metadado) para não casar palavra dentro de texto do usuário
  const limpo = semAcento(sql).replace(/--[^\n]*/g, ' ').replace(/'[^']*'/g, "''")
  // ALVO = nome dos arquivos + SQL, sem acento, com separadores (`_`, `-`, `/`, espaço) colapsados em um só espaço
  const alvo = `${semAcento(nomes)}\n${limpo}`.replace(/[^a-z0-9.]+/g, ' ')
  for (const a of AREAS) if (a.re.test(alvo)) return { sozinha: true, motivo: `núcleo ultra-sensível: ${a.nome}` }
  return { sozinha: false, motivo: 'crítica batelável (não toca núcleo ultra-sensível)' }
}

async function main(): Promise<void> {
  const { readFileSync } = await import('node:fs')
  const sqlPath = process.argv[2]
  let sql: string | undefined
  try { sql = sqlPath ? readFileSync(sqlPath, 'utf8') : undefined } catch { sql = undefined }
  let nomes = ''
  for await (const c of process.stdin) nomes += c
  process.stdout.write(JSON.stringify(migracaoSozinha(nomes, sql)))
}
if (process.argv[1] && /\/migracao-sempre-sozinha\.ts$/.test(process.argv[1])) void main()
