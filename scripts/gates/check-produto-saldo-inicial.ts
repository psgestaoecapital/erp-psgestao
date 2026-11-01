// Gate (#3255 Gean): o formulário de produto novo tem "Saldo inicial" e lança o saldo pela função de ajuste existente,
// e o "?" do campo existe em migration. Sem rede.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const form = readFileSync('src/components/cadastros/ProdutoForm.tsx', 'utf8')
const erros: string[] = []
if (!form.includes('produto-saldo-inicial')) erros.push('campo produto-saldo-inicial ausente no ProdutoForm')
if (!form.includes("rpc('fn_estoque_ajuste_migracao'")) erros.push('ProdutoForm não lança o saldo via fn_estoque_ajuste_migracao')
if (!form.includes('cadastros.produtos.saldo_inicial')) erros.push('"?" cadastros.produtos.saldo_inicial ausente')
const dir = 'supabase/migrations'
const tem = readdirSync(dir).some((f) => f.endsWith('.sql') && readFileSync(join(dir, f), 'utf8').includes("'cadastros.produtos.saldo_inicial'"))
if (!tem) erros.push('chave de ajuda cadastros.produtos.saldo_inicial sem migration')
if (erros.length) { console.error('✗ saldo inicial do produto:\n - ' + erros.join('\n - ')); process.exit(1) }
console.log('saldo inicial do produto: ok')
