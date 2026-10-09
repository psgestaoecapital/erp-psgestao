// Gate (#2260) — Nova OS cadastra cliente inline pela mesma RPC da recepção, vincula e tem "?" (RD-95) com chave no banco.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }
const tela = readFileSync('src/app/dashboard/os/page.tsx', 'utf8')
const mig = readFileSync('supabase/migrations/20261009193030_os_nova_cliente_inline_ajuda.sql', 'utf8')

ok(tela.includes("rpc('fn_cliente_criar_inline'"), 'usa fn_cliente_criar_inline')
ok(tela.includes('+ Cadastrar novo cliente'), 'botão "+ Cadastrar novo cliente"')
ok(/setCliente\(\{ id: data as string/.test(tela), 'vincula o cliente criado à OS')
ok(tela.includes('/api/cnpj-lookup'), 'auto-preenche por CNPJ via /api/cnpj-lookup')
for (const k of ['os.nova.cliente', 'os.nova.cliente_novo_nome', 'os.nova.cliente_novo_doc', 'os.nova.cliente_novo_tel']) {
  ok(tela.includes(`chave="${k}"`), `"?" ${k} na tela`)
  ok(mig.includes(`'${k}'`), `${k} na migration`)
}
if (falhas) process.exit(1)
