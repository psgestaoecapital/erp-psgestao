// RD-97 (CEO 16/10) — análise estática de migration destrutiva. Usada por check-migration-segura.ts.
// Regra: migration nova da PR só pode ser ADITIVA. Reprova o que pode perder dado ou derrubar quem opera em tempo real.
// Heurística textual (sem banco): remove comentários e literais de texto, quebra em comandos e confere cada um.

export type Achado = { regra: string; trecho: string }

// Tabelas de domínio (dado real de cliente). DELETE/UPDATE nelas é proibido mesmo com WHERE.
const DOMINIO = [
  'erp_pagar', 'erp_receber', 'erp_produtos', 'erp_estoque_movimentacoes', 'erp_clientes', 'erp_contratos',
  'erp_compras', 'tenant_subscriptions', 'erp_fornecedores', 'erp_vendas', 'erp_pedidos', 'erp_ordens_servico',
  'erp_lancamentos', 'erp_caixa', 'erp_conciliacao', 'erp_boletos', 'erp_titulos',
]
const DOMINIO_PREFIXOS = ['erp_nfe_', 'erp_nfse_', 'erp_financeiro', 'erp_fiscal']

export function ehTabelaDominio(nome: string): boolean {
  const n = nome.toLowerCase().replace(/^public\./, '').replace(/"/g, '')
  return DOMINIO.includes(n) || DOMINIO_PREFIXOS.some((p) => n.startsWith(p))
}

// Tira comentários (-- e /* */) e o conteúdo de strings '...' e $$...$$ (corpo de função não conta como comando do arquivo,
// exceto quando o corpo é DDL de manutenção — esse é analisado em separado por analisarMigration).
function limpar(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''")
}

// Comandos executados no arquivo: tudo fora de blocos $$...$$ (CREATE FUNCTION só define; DDL dentro de corpo não roda agora).
function comandosDoArquivo(sql: string): string[] {
  const semCorpo = limpar(sql).replace(/\$([a-zA-Z_]*)\$[\s\S]*?\$\1\$/g, ' $$ ')
  return semCorpo.split(';').map((c) => c.replace(/\s+/g, ' ').trim()).filter(Boolean)
}

const NOME = String.raw`(?:"?[a-z0-9_]+"?\.)?"?([a-z0-9_]+)"?`

// "Redefinir" é aditivo: DROP … IF EXISTS seguido de CREATE do MESMO nome no mesmo arquivo (policy, trigger, constraint,
// índice, função, view) mantém o objeto existindo. Tabela/coluna/tipo nunca têm essa folga.
const REDEFINIVEIS = ['policy', 'trigger', 'index', 'function', 'procedure', 'view', 'materialized view']
const ID = String.raw`(?:"?[a-z0-9_]+"?\.)?"?([a-z0-9_]+)"?`
function nomesCriados(cmds: string[]): Set<string> {
  const s = new Set<string>()
  for (const c of cmds) {
    const l = c.toLowerCase()
    const m = l.match(new RegExp(String.raw`^create\s+(?:or\s+replace\s+)?(?:unique\s+)?(?:constraint\s+)?(policy|trigger|index|function|procedure|materialized view|view)\s+(?:if not exists\s+)?(?:concurrently\s+)?${ID}`))
    if (m) s.add(`${m[1]}:${m[2]}`)
    for (const k of l.matchAll(/\badd\s+constraint\s+"?([a-z0-9_]+)"?/g)) s.add(`constraint:${k[1]}`)
  }
  return s
}

export function analisarMigration(sql: string): Achado[] {
  const out: Achado[] = []
  const add = (regra: string, cmd: string) => out.push({ regra, trecho: cmd.slice(0, 140) })
  const cmds = comandosDoArquivo(sql)
  const criados = nomesCriados(cmds)
  for (const cmd of cmds) {
    const c = cmd.toLowerCase()
    const dr = c.match(new RegExp(String.raw`^drop\s+(${REDEFINIVEIS.join('|')})\s+(?:if exists\s+)?(?:concurrently\s+)?${ID}`))
    const redefinido = dr && criados.has(`${dr[1]}:${dr[2]}`)
    if (!redefinido && /^drop\s+(table|view|materialized view|function|procedure|type|schema|trigger|policy|index)\b/.test(c)) {
      // DROP de objeto criado na mesma migration não existe em produção, mas não dá para provar aqui: reprova e exige exceção.
      add(`DROP proibido (objeto existente): ${c.split(' ').slice(0, 3).join(' ')}`, cmd)
    }
    if (/^alter\s+table\b.*\bdrop\s+column\b/.test(c)) add('ALTER TABLE … DROP COLUMN proibido', cmd)
    for (const k of c.matchAll(/\bdrop\s+constraint\s+(?:if exists\s+)?"?([a-z0-9_]+)"?/g)) {
      if (!criados.has(`constraint:${k[1]}`)) add(`DROP CONSTRAINT proibido sem recriar: ${k[1]}`, cmd)
    }
    if (/^truncate\b/.test(c)) add('TRUNCATE proibido', cmd)
    if (/^alter\s+table\b.*\balter\s+(column\s+)?"?[a-z0-9_]+"?\s+(set\s+data\s+)?type\b/.test(c)) add('ALTER COLUMN TYPE proibido (pode perder dado)', cmd)
    if (/^alter\s+table\b.*\brename\b/.test(c)) add('RENAME de tabela/coluna proibido (sem compatibilidade)', cmd)
    if (/^alter\s+(view|function|type|schema)\b.*\brename\b/.test(c)) add('RENAME proibido', cmd)
    if (/^alter\s+table\b.*\balter\s+(column\s+)?"?[a-z0-9_]+"?\s+set\s+not\s+null\b/.test(c)) {
      add('SET NOT NULL em coluna existente proibido (exige DEFAULT/backfill em PR separada)', cmd)
    }
    // ADD COLUMN … NOT NULL sem DEFAULT
    for (const m of c.matchAll(/\badd\s+column\s+(?:if not exists\s+)?[^,]*?(?=,\s*add\b|,\s*alter\b|$)/g)) {
      if (/\bnot\s+null\b/.test(m[0]) && !/\bdefault\b/.test(m[0]) && !/\bgenerated\b/.test(m[0])) add('ADD COLUMN NOT NULL sem DEFAULT proibido', cmd)
    }
    const del = c.match(new RegExp(String.raw`^delete\s+from\s+(?:only\s+)?${NOME}`))
    if (del) {
      if (!/\bwhere\b/.test(c)) add('DELETE sem WHERE proibido', cmd)
      else if (ehTabelaDominio(del[1])) add(`DELETE em tabela de domínio proibido: ${del[1]}`, cmd)
    }
    const upd = c.match(new RegExp(String.raw`^update\s+(?:only\s+)?${NOME}`))
    if (upd) {
      if (!/\bwhere\b/.test(c)) add('UPDATE sem WHERE proibido', cmd)
      else if (ehTabelaDominio(upd[1])) add(`UPDATE em tabela de domínio proibido: ${upd[1]}`, cmd)
    }
  }
  // DDL destrutiva escondida em DO $$ … $$ (roda na migration, ao contrário do corpo de CREATE FUNCTION).
  for (const m of sql.matchAll(/\bdo\s+\$([a-zA-Z_]*)\$([\s\S]*?)\$\1\$/gi)) {
    for (const a of analisarMigration(m[2].replace(/\b(begin|then|else|loop|exception)\b/gi, ';'))) out.push({ regra: `${a.regra} (dentro de DO $$)`, trecho: a.trecho })
  }
  return out
}

export const ETIQUETA_EXCECAO = 'migration-destrutiva-autorizada'

// Exceção: etiqueta posta pelo revisor + plano de volta descrito no corpo da PR.
export function excecaoValida(labels: string[], corpoPr: string): { ok: boolean; motivo: string } {
  if (!labels.includes(ETIQUETA_EXCECAO)) return { ok: false, motivo: `sem a etiqueta "${ETIQUETA_EXCECAO}" (posta pelo revisor)` }
  if (!/plano de volta\s*[:\-—]?\s*\S[\s\S]{14,}/i.test(corpoPr)) return { ok: false, motivo: 'corpo da PR sem "Plano de volta: …" descrito' }
  return { ok: true, motivo: 'etiqueta do revisor + plano de volta no corpo' }
}
