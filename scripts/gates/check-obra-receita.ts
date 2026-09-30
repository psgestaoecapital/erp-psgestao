// Gate (CEO 30/09 · Diego/FC: resultado por obra — versão receita). Roda no build, sem rede. Confere as regras de
// negócio na migration e o cartão na ficha da obra: faturado = só NFS-e AUTORIZADA ligada à obra; recebido = baixas
// dos títulos dessas notas (sem as excluídas; cancelado/excluído fora); guarda por empresa; fechada ao anon; e a tela
// mostra Faturado / Recebido / A receber / Custo "a partir de novembro" sem derrubar o board se a receita falhar.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const mig = readFileSync('supabase/migrations/20260930160000_obra_receita.sql', 'utf8')
const sql = mig.replace(/--[^\n]*/g, '')
const tela = readFileSync('src/app/dashboard/projetos/obras/page.tsx', 'utf8')

ok(/CREATE OR REPLACE FUNCTION public\.fn_obras_receita\(p_company_ids uuid\[\]\)/.test(sql), 'fn_obras_receita(p_company_ids uuid[])')
ok(/n\.status = 'autorizada'/.test(sql) && /n\.obra_id IS NOT NULL/.test(sql), 'faturado: só NFS-e autorizada ligada à obra (cancelada/rejeitada fora)')
ok(/COALESCE\(n\.valor_bruto, n\.valor_servicos, 0\)/.test(sql), 'faturado pelo valor bruto dos serviços')
ok(/JOIN public\.erp_receber r ON r\.id = nt\.erp_receber_id/.test(sql), 'recebido: título da própria nota (erp_receber_id)')
ok(/erp_receber_baixa b WHERE b\.receber_id = r\.id AND b\.deleted_at IS NULL/.test(sql), 'recebido: soma das baixas, sem as excluídas')
ok(/r\.deleted_at IS NULL AND r\.status <> 'cancelado'/.test(sql), 'título excluído ou cancelado não conta')
ok(/DISTINCT ON \(r\.id\)/.test(sql), 'título ligado a mais de uma nota não conta em dobro')
ok((sql.match(/IN \(SELECT public\.get_user_company_ids\(\)\)/g) ?? []).length >= 2, 'guarda: só empresas do usuário (notas e obras)')
ok(/STABLE SECURITY DEFINER/.test(sql) && /SET search_path TO 'public'/.test(sql), 'só leitura (STABLE) com search_path fixo')
ok(/REVOKE ALL ON FUNCTION public\.fn_obras_receita\(uuid\[\]\) FROM PUBLIC, anon;/.test(sql) && !/TO[^;]*\banon\b/.test(sql.replace(/FROM PUBLIC, anon/, '')), 'fechada ao anon')
ok(!/\b(INSERT|UPDATE|DELETE)\b/i.test(sql), 'não grava nada')

ok(tela.includes("supabase.rpc('fn_obras_receita', { p_company_ids: companyIds })"), 'board chama fn_obras_receita')
ok(/setReceita\(er \? null :/.test(tela), 'falha na receita não derruba o board (cartão avisa)')
for (const id of ['obra-resultado', 'obra-faturado', 'obra-recebido', 'obra-a-receber', 'obra-custo', 'obra-notas']) {
  ok(tela.includes(`'${id}'`) || tela.includes(`"${id}"`), `cartão: ${id}`)
}
ok(tela.includes("cel('Custo', 'a partir de novembro'"), 'custo aparece como "a partir de novembro"')
ok(tela.includes('<ResultadoObra r={receita} />'), 'cartão dentro da ficha (card) da obra')

if (falhas) { console.error(`\n${falhas} falha(s) no resultado por obra`); process.exit(1) }
console.log('\nResultado por obra (receita): ok')
