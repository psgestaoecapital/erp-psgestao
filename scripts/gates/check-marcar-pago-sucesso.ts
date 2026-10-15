// Gate (chamado #2688, Troian): o MarcarPagoModal precisa tratar o retorno { sucesso:false, erro } das RPCs de baixa
// (elas não lançam exceção). Sem isso o modal fechava como se tivesse baixado e nada era gravado.
import { readFileSync } from 'node:fs'

const src = readFileSync('src/components/financeiro/MarcarPagoModal.tsx', 'utf8')
const ok = /const \{ data, error \} = await supabase\.rpc\(rpcName, params\)/.test(src) && /sucesso === false/.test(src)
if (!ok) {
  console.error('✗ MarcarPagoModal ignora { sucesso:false } da RPC de baixa (chamado #2688)')
  process.exit(1)
}
console.log('✓ MarcarPagoModal trata sucesso:false da RPC de baixa')
