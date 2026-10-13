/**
 * Gate de build · #2259 (Rodrigo): a busca de CNPJ do cadastro usa a rota interna /api/cnpj-lookup (BrasilAPI → ReceitaWS)
 * e diferencia "não encontrado" (404) de "serviço indisponível" (limite/instabilidade).
 */
import { readFileSync } from 'node:fs'

let falhas = 0
function ok(cond: boolean, msg: string) { if (!cond) { falhas++; console.error(`✘ ${msg}`) } else console.log(`✓ ${msg}`) }

const lib = readFileSync('src/lib/cadastros/buscarCNPJ.ts', 'utf8')
ok(lib.includes('/api/cnpj-lookup'), 'buscarCNPJ consulta a rota interna')
ok(!/fetch\(`https:\/\/brasilapi/.test(lib), 'buscarCNPJ não chama a BrasilAPI direto do navegador')
ok(/indisponivel/.test(lib), 'buscarCNPJ distingue indisponível de não encontrado')

const rota = readFileSync('src/app/api/cnpj-lookup/route.ts', 'utf8')
ok(/status: 503/.test(rota), 'a rota responde 503 quando as fontes estão indisponíveis')
ok(/brasilNaoExiste && r2\.status === 404/.test(rota), '404 só quando as duas fontes dizem que não existe')

const form = readFileSync('src/components/cadastros/PessoaForm.tsx', 'utf8')
ok(form.includes('consultarCNPJ(') && form.includes('Consulta externa indisponível'), 'o formulário mostra "indisponível" separado de "não encontrado"')

if (falhas > 0) { console.error(`\n[check-cnpj-busca-fallback] ${falhas} regra(s) quebrada(s) — build bloqueado.`); process.exit(1) }
console.log('\n[check-cnpj-busca-fallback] busca de CNPJ conferida.')
