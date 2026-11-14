// Gate (HB0, auditor F15 em /dashboard/projetos/propostas) — a lista mostra a versão da proposta (e de qual nasceu), o PDF
// anexo, atalho à Calculadora, aviso quando a lista é cortada em 100 e "Mostrar mais" de 25 em 25. Só leitura. Sem rede.
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const src = readFileSync('src/app/dashboard/projetos/propostas/page.tsx', 'utf8')
ok(src.includes('versao,orcamento_origem_id,pdf_anexo_path'), 'tela lê versao, orcamento_origem_id e pdf_anexo_path')
ok(src.includes("{ count: 'exact' }") && src.includes('totalBanco > linhas.length'), 'avisa quando a lista é cortada (total do banco × exibidas)')
ok(src.includes('vis.slice(0, mostrar)') && src.includes('POR_PAGINA'), 'lista pagina de 25 em 25')
// #4014/#4015 (Tryo): a lista atribui o ORÇAMENTISTA (orcamentista_id/_nome) in-place — única escrita permitida.
// Nenhum insert/upsert/delete de proposta e nenhum update que toque outros campos (status/total/cliente/datas…).
const escritasProp = [...src.matchAll(/erp_orcamentos'\)\.(update|upsert|insert|delete)\((\{[^}]*\})?/g)]
ok(escritasProp.every((m) => m[1] === 'update' && !!m[2] && /orcamentista_id/.test(m[2]) && /orcamentista_nome/.test(m[2]) && !/\b(status|total|valor|cliente_nome|numero|data_\w+|obra_id|eh_obra|versao|pdf_anexo_path|company_id)\b/.test(m[2])),
  'só leitura da proposta (única escrita: atribuir orçamentista)')
for (const id of ['hub-proposta-versao', 'hub-proposta-pdf', 'hub-propostas-com-pdf', 'hub-propostas-revisoes', 'hub-proposta-calculadora', 'hub-propostas-mostrar-mais', 'hub-propostas-truncado']) ok(src.includes(`data-testid="${id}"`), `tela tem ${id}`)

const mig = readdirSync('supabase/migrations').filter(f => f.endsWith('.sql')).map(f => readFileSync(`supabase/migrations/${f}`, 'utf8')).join('\n')
for (const c of ['versao', 'com_pdf', 'revisoes', 'calculadora', 'mostrar_mais']) {
  const chave = `projetos.propostas.${c}`
  ok(src.includes(`chave="${chave}"`) && mig.includes(`'${chave}'`), `"?" ${chave} na tela e no banco`)
}

if (falhas) { console.error(`\n${falhas} falha(s) — check-hub-propostas-versao-pdf`); process.exit(1) }
console.log('\ncheck-hub-propostas-versao-pdf: verde')
