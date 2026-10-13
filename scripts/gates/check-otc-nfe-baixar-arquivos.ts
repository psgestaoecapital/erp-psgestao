// Gate (chamado #1882 · parte NF-e · Vender e Faturar › card "NF-e do produto"). Estático, sem rede.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const src = readFileSync('src/components/comum/NFeCard.tsx', 'utf8')
ok(/\.select\('id,numero,status,danfe_url,xml_url,/.test(src), 'consulta traz xml_url além de danfe_url')
ok(src.includes('nfe-pedido-baixar-xml') && src.includes('nfe-pedido-ver-danfe'), 'botões Baixar XML e Baixar DANFE (PDF)')
ok(src.includes('nfe-arquivo-gerando'), 'arquivo ainda não gerado mostra aviso, nunca botão morto')

if (falhas) { console.error(`check-otc-nfe-baixar-arquivos: ${falhas} falha(s)`); process.exit(1) }
console.log('check-otc-nfe-baixar-arquivos: ok')
