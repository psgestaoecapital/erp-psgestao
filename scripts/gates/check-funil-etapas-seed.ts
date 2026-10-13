// Gate (DEFEITO 01/10, achado pelo teste do roteiro da Pdois): o funil padrão de leads é criado na 1ª leitura sem o
// erro "chave is ambiguous" — o ON CONFLICT aponta a restrição única pelo NOME (a função devolve uma coluna "chave").
// Sem isso, agência nova (e a demo depois do reset) fica com "Nenhuma etapa configurada" e os leads somem do funil. Sem rede.
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

// a ÚLTIMA migration que redefine a função é a que vale
const arquivos = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).sort()
const ultima = arquivos.filter((f) => readFileSync(`supabase/migrations/${f}`, 'utf8').includes('FUNCTION public.fn_funil_etapas_listar(')).pop() ?? ''
const sql = readFileSync(`supabase/migrations/${ultima}`, 'utf8')
ok(ultima >= '20261001220000', `a definição vigente é a corrigida (${ultima})`)
ok(sql.includes('ON CONFLICT ON CONSTRAINT funil_etapa_company_id_tipo_funil_chave_key DO NOTHING'), 'conflito pelo nome da restrição (sem ambiguidade com a coluna "chave")')
ok(!/ON CONFLICT \(company_id, tipo_funil, chave\)/.test(sql), 'não volta a usar a lista de colunas no ON CONFLICT')
for (const ch of ['novo_atendimento', 'reuniao', 'proposta', 'negociacao', 'ganho', 'perdido']) ok(sql.includes(`('${ch}',`), `etapa padrão ${ch}`)
ok(/RETURNS TABLE\(id uuid, chave text, rotulo text, ordem integer, cor text, tipo_etapa text, ativo boolean\)/.test(sql), 'mesma assinatura de retorno (a tela não muda)')
ok(sql.includes('REVOKE ALL ON FUNCTION public.fn_funil_etapas_listar(uuid, text) FROM PUBLIC, anon;'), 'fechada a quem não está logado')

if (falhas) { console.error(`\ncheck-funil-etapas-seed: ${falhas} falha(s)`); process.exit(1) }
console.log('\nFunil de leads · etapas padrão: ok')
