// Gate (chamado #6726, Vianz) — Emitir NF-e avulsa: o campo Cliente/Fornecedor filtra em tempo real por qualquer parte do
// nome (razão social ou fantasia, sem acento) e por CPF/CNPJ com ou sem pontuação; não escolhe o 1º cadastro sozinho.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }
const src = readFileSync('src/app/dashboard/fiscal/nfe/remessa/RemessaClient.tsx', 'utf8')

ok(/data-testid="nfe-avulsa-destinatario"/.test(src), 'campo de destinatário é caixa de busca (input), não lista fixa')
ok(/pessoasFiltradas/.test(src) && /\.normalize\('NFD'\)/.test(src), 'filtro sem acento sobre a lista')
ok(/razao_social[\s\S]{0,60}nome_fantasia[\s\S]{0,80}includes\(q\)/.test(src), 'busca por razão social e nome fantasia (qualquer parte)')
ok(/soDigitos\(p\.cnpj_cpf \?\? p\.cpf_cnpj\)\.includes\(d\)/.test(src), 'busca por CPF/CNPJ com ou sem pontuação')
ok(/onMouseDown=\{\(\) => \{ setDestinatarioId\(p\.id\)/.test(src), 'cadastro só é escolhido por clique do usuário na lista')

if (falhas) { console.error(`${falhas} falha(s)`); process.exit(1) }
