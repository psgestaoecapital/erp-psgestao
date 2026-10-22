// Gate (chamados #1960 e #1882 · Vender e Faturar › card "NFS-e do serviço"). Estático, sem rede.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const src = readFileSync('src/app/dashboard/commerce/otc/page.tsx', 'utf8')
ok(/const eCancelada = ultStatus === 'cancelada'/.test(src), 'cancelada tem estado próprio (eCancelada)')
ok(/const eRejeitada = ultStatus === 'rejeitada' \|\| ultStatus === 'erro'(?!\s*\|\|)/.test(src), 'eRejeitada não inclui mais "cancelada"')
ok(src.includes('NFS-e cancelada — nº'), 'bloco neutro "NFS-e cancelada" renderizado')
ok(/\.select\('id,numero,status,pdf_url,xml_url,cancelado_em,motivo_rejeicao'\)/.test(src), 'consulta traz xml_url e cancelado_em')
ok(src.includes('nfse-baixar-xml') && src.includes('nfse-ver-pdf'), 'botões Baixar XML e Baixar PDF')
ok(src.includes('nfse-arquivo-gerando'), 'arquivo ainda não gerado mostra aviso, nunca botão morto')

if (falhas) { console.error(`check-otc-nfse-cancelada: ${falhas} falha(s)`); process.exit(1) }
console.log('check-otc-nfse-cancelada: ok')
