// Gate (Rodrigo · R.R) — campo "Informações complementares" na emissão de NFS-e, com CNO puxado automático.
// Travas do código, sem rede — roda no build. Garante o contrato: o modal tem o campo, puxa o CNO da obra
// (editável, sem sobrescrever o digitado), envia `observacoes` nos dois caminhos, e o backend injeta nas
// informações complementares SEM apagar o bloco da Lei 12.741.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const modal = readFileSync('src/components/fiscal/NFSeEmitirGovModal.tsx', 'utf8')
const rota = readFileSync('src/app/api/fiscal/nfse/emitir/route.ts', 'utf8')

// 1) o modal tem o campo e o estado
ok(modal.includes('const [observacoes, setObservacoes] = useState('), 'modal: estado observacoes')
ok(modal.includes('data-testid="nfse-observacoes"'), 'modal: textarea de informações complementares')

// 2) CNO automático da obra: lê projetos_obras.cno e só preenche quando vazio (não sobrescreve o digitado)
ok(modal.includes(".from('projetos_obras')") && modal.includes(".select('cno')"), 'modal: CNO vem de projetos_obras.cno')
ok(/setObservacoes\(\(prev\) => \(prev\.trim\(\) === '' \? `CNO: \$\{cno\}` : prev\)\)/.test(modal), 'modal: pré-preenche CNO só quando vazio (editável, não sobrescreve)')

// 3) reseta na abertura
ok(modal.includes("setObservacoes('')"), 'modal: reseta observacoes na abertura')

// 4) envia observacoes nos DOIS caminhos (Focus bodyFocus e gov legado) — nível superior
ok((modal.match(/observacoes: observacoes\.trim\(\) \|\| undefined/g) ?? []).length >= 2, 'modal: envia observacoes no caminho Focus e no gov legado')

// 5) a rota injeta em informações complementares e NÃO sobrescreve o bloco da Lei 12.741
ok(/if \(typeof body\.observacoes === 'string'[\s\S]*?nfseReq\.observacoes = body\.observacoes\.trim\(\)/.test(rota), 'rota: observacoes do corpo → informações complementares')
ok(rota.includes('[blocoLei12741, nfseReq.observacoes]'), 'rota: Lei 12.741 é concatenada à observação, não substitui')

if (falhas) { console.error(`\ncheck-nfse-observacoes: ${falhas} falha(s)`); process.exit(1) }
console.log('\ncheck-nfse-observacoes: ok')
