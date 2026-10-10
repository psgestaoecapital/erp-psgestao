// Gate (#2167, Gean, item 2): nota fiscal e boleto saem com o nome do cliente no arquivo, não com código aleatório.
// Prova o nome gerado (acento, caractere proibido, sem cliente, cabeçalho ida e volta) e que as telas/rotas usam o helper.
import { readFileSync } from 'node:fs'
import { contentDisposition, nomeArquivoDocumento, nomeDoContentDisposition } from '../../src/lib/documentos/nomeArquivo'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

ok(nomeArquivoDocumento('NF-e', '394', 'GEAN AUTO MECANICA', 'pdf') === 'NF-e 394 - GEAN AUTO MECANICA.pdf', 'NF-e com número e cliente')
ok(nomeArquivoDocumento('NFS-e', 12, 'Mecânica Diesel Triches', 'xml') === 'NFS-e 12 - Mecanica Diesel Triches.xml', 'acento sai, extensão xml')
ok(nomeArquivoDocumento('Boleto', '000123', 'FC PISOS/REVEST: "LTDA"', 'pdf') === 'Boleto 000123 - FC PISOS REVEST LTDA.pdf', 'caractere proibido em nome de arquivo sai')
ok(nomeArquivoDocumento('NF-e', null, null, 'pdf') === 'NF-e.pdf', 'sem número e sem cliente não quebra')
ok(nomeArquivoDocumento('Boleto', '1', 'X'.repeat(200), 'pdf').length <= 'Boleto 1 - '.length + 80 + 4, 'nome do cliente limitado a 80 caracteres')

const nome = 'Boleto 7 - Proplay Produção.pdf'
const cd = contentDisposition(nome)
ok(/^inline; filename="[\x20-\x7e]+"; filename\*=UTF-8''/.test(cd), 'content-disposition com filename ASCII e filename* UTF-8')
ok(nomeDoContentDisposition(cd) === nome, 'nome volta inteiro do cabeçalho (filename*)')
ok(nomeDoContentDisposition('inline; filename="boleto-1.pdf"') === 'boleto-1.pdf', 'lê cabeçalho antigo (só filename)')
ok(nomeDoContentDisposition(null) === null, 'sem cabeçalho → null')

const usa = (f: string, trecho: RegExp, msg: string) => ok(trecho.test(readFileSync(f, 'utf8')), `${f}: ${msg}`)
usa('src/app/dashboard/fiscal/nfe/NFeListClient.tsx', /nomeArquivoDocumento\('NF-e'/, 'DANFE/XML com o nome do cliente')
usa('src/app/dashboard/fiscal/nfe/NFeListClient.tsx', /createSignedUrl\([^)]*\{ download: nome \}/, 'arquivo guardado baixa com o nome')
usa('src/app/dashboard/fiscal/nfse/NFSeListClient.tsx', /nomeArquivoDocumento\('NFS-e'/, 'PDF/XML com o nome do cliente')
usa('src/app/dashboard/fiscal/nfse/NFSeListClient.tsx', /createSignedUrl\([^)]*\{ download: nome \}/, 'arquivo guardado baixa com o nome')
usa('src/app/api/boleto/pdf/route.ts', /contentDisposition\(nomeArquivoDocumento\('Boleto'/, 'rota do boleto manda o nome do cliente')
ok(!/filename="boleto-\$\{/.test(readFileSync('src/app/api/boleto/pdf/route.ts', 'utf8')), 'rota do boleto sem o nome antigo boleto-<código>')
usa('src/components/financeiro/GerarBoletosReceita.tsx', /nomeDoContentDisposition\(/, 'baixar todos usa o nome da rota')
if (falhas) process.exit(1)
