// Gate · chamado #3862 (FC Pisos): NFS-e 448 autorizada com INSS e ISS retidos ficou com valor_retencoes=0 e
// valor_liquido=NULL, porque só o "Gerar financeiro" os preenchia. A rota de emissão agora grava os dois. Sem rede.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (c) console.log('✓', m); else { falhas++; console.error('✗', m) } }
const rota = readFileSync('src/app/api/fiscal/nfse/emitir/route.ts', 'utf8')

const iss = rota.indexOf('const issRetido = issRetidoNfse(')
const liq = rota.search(/valor_retencoes: retTotal,/)
ok(iss > 0 && liq > iss, 'rota: grava valor_retencoes depois de calcular o ISS retido')
ok(/valor_liquido: Math\.max\(0, cent\(Number\(nfseReq\.valorServicos\) - retTotal\)\)/.test(rota), 'rota: valor_liquido = serviço − retenções (piso 0)')
ok(/retTotal = cent\(issRetido \+ \(rf\?\.valorCp[^\n]*valorIrrf[^\n]*valorPisRet[^\n]*valorCofinsRet[^\n]*valorCsllRet/.test(rota),
  'rota: retenção total soma ISS + INSS + IRRF + PIS + COFINS + CSLL')
ok(/if \(retTotal > 0\)/.test(rota), 'rota: sem retenção a nota não é tocada')

if (falhas) { console.error(`\ncheck-nfse-liquido-na-emissao: ${falhas} falha(s)`); process.exit(1) }
console.log('\ncheck-nfse-liquido-na-emissao: ok')
