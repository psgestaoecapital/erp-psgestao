// Gate (chamado #2957): nome do arquivo baixado de boleto e nota fiscal. Boleto = Cliente_DDMMAAAA.pdf; nota =
// Cliente_NF<número>_DDMMAAAA.pdf/.xml; fantasia antes da razão; sem acento nem / \ : * ? " < > |; até 30 caracteres no
// cliente; nomes repetidos do lote ganham sufixo. Confere também que as telas usam essas funções. Sem rede.
import { readFileSync } from 'node:fs'
import { nomeArquivoBoleto, nomeArquivoNota, nomeClienteArquivo, nomesUnicos, dataArquivo, nomeDoContentDisposition } from '../../src/lib/download/nomeArquivo'

let falhas = 0
function eq(nome: string, obtido: unknown, esperado: unknown) {
  if (JSON.stringify(obtido) !== JSON.stringify(esperado)) { falhas++; console.error(`✗ ${nome}: obtido ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`) }
  else console.log(`✓ ${nome}`)
}

eq('boleto do exemplo', nomeArquivoBoleto({ fantasia: 'FC Pisos', razao: 'FC PISOS LTDA', vencimento: '2026-10-30' }), 'FC_Pisos_30102026.pdf')
eq('nota PDF do exemplo', nomeArquivoNota({ fantasia: 'FC Pisos', numero: '1234', emissao: '2026-10-14', ext: 'pdf' }), 'FC_Pisos_NF1234_14102026.pdf')
eq('nota XML do exemplo', nomeArquivoNota({ fantasia: 'FC Pisos', numero: 1234, emissao: '2026-10-14', ext: 'xml' }), 'FC_Pisos_NF1234_14102026.xml')
eq('sem fantasia usa a razão social', nomeClienteArquivo('  ', 'Mecânica Diesel Triches'), 'Mecanica_Diesel_Triches')
eq('acento e barra viram nome válido', nomeClienteArquivo('Gean Auto Mecânica / Filial: "Centro"?'), 'Gean_Auto_Mecanica_Filial_Cent')
eq('nome sem caractere proibido', /[\\/:*?"<>|\s]/.test(nomeArquivoBoleto({ razao: 'A/B\\C:D*E?F"G<H>I|J K', vencimento: '2026-01-02' })), false)
eq('cliente limitado a 30 caracteres', nomeClienteArquivo('Nueva Energia Solar Comercio de Equipamentos Ltda').length <= 30, true)
eq('cliente vazio vira "Cliente"', nomeClienteArquivo(null, null), 'Cliente')
// emissão gravada em UTC: 09/10 00:50 UTC é 08/10 em Brasília (nota 130 da Gean)
eq('emissão com hora usa o horário de Brasília', dataArquivo('2026-10-09T00:50:54.900505+00:00'), '08102026')
eq('nota sem número não deixa "NF" solto', nomeArquivoNota({ razao: 'Toy Tintas', numero: null, emissao: '2026-10-14', ext: 'pdf' }), 'Toy_Tintas_14102026.pdf')
eq('lote com nomes repetidos ganha sufixo', nomesUnicos(['A_01.pdf', 'B_01.pdf', 'A_01.pdf', 'A_01.pdf']), ['A_01.pdf', 'B_01.pdf', 'A_01_2.pdf', 'A_01_3.pdf'])
eq('lê o nome do Content-Disposition', nomeDoContentDisposition('inline; filename="FC_Pisos_30102026.pdf"'), 'FC_Pisos_30102026.pdf')

// as telas usam o padrão (não voltaram ao nome técnico)
const usos: Array<[string, RegExp]> = [
  ['src/app/api/boleto/pdf/route.ts', /filename="\$\{await nomeArquivoDoTitulo\(rec\)\}"/],
  ['src/components/financeiro/BoletoActions.tsx', /abrirPdfBoleto\(true\)/],
  ['src/components/financeiro/GerarBoletosReceita.tsx', /nomesUnicos\(usados\)/],
  ['src/app/dashboard/fiscal/nfe/NFeListClient.tsx', /nomeArquivoNota\(/],
  ['src/app/dashboard/fiscal/nfse/NFSeListClient.tsx', /nomeArquivoNota\(/],
]
for (const [f, re] of usos) eq(`${f} usa o nome padrão`, re.test(readFileSync(f, 'utf8')), true)

if (falhas) { console.error(`✗ nome do arquivo baixado: ${falhas} falha(s)`); process.exit(1) }
console.log('✓ nome do arquivo baixado (boleto e nota) no padrão do chamado #2957')
