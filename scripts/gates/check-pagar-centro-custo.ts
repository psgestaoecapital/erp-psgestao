// Gate (CEO 01/10 · item 4): centro de custo DE VERDADE no contas a pagar + obra do Hub com centro de custo. Roda no
// build, sem rede. Confere que:
//  - a migration dá a erp_pagar a FK centro_custo_id, com guarda de empresa e o texto legado espelhando o nome;
//  - o editor completo (fn_pagar_editar_completo) aceita centro_custo_id e barra centro de outra empresa;
//  - toda obra ganha centro de custo (trigger de INSERT + as obras que estavam sem), com FK e guarda de empresa;
//  - nenhum título existente é reescrito (RD-55): a migration não faz UPDATE em erp_pagar;
//  - a Nova despesa tem o campo "Centro de custo / obra" e grava centro_custo_id (criar e editar), e o modal de edição
//    do pagar deixou de gravar o nome em texto.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const mig = readFileSync('supabase/migrations/20261001100000_pagar_centro_custo_obra.sql', 'utf8')
const sql = mig.replace(/--[^\n]*/g, '')

ok(/ALTER TABLE public\.erp_pagar ADD COLUMN IF NOT EXISTS centro_custo_id uuid/.test(sql), 'erp_pagar.centro_custo_id criado')
ok(/erp_pagar_centro_custo_id_fkey[\s\S]*REFERENCES public\.erp_centros_custo\(id\) ON DELETE SET NULL/.test(sql), 'FK para erp_centros_custo (ON DELETE SET NULL)')
ok(/fn_trg_pagar_centro_custo[\s\S]*IS DISTINCT FROM NEW\.company_id[\s\S]*RAISE EXCEPTION[\s\S]*NEW\.centro_custo := v_nome/.test(sql),
  'trigger do pagar: centro de outra empresa é barrado e o texto legado espelha o nome')
ok(/BEFORE INSERT OR UPDATE OF centro_custo_id ON public\.erp_pagar/.test(sql), 'trigger dispara ao gravar/trocar o centro')

const editor = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.fn_pagar_editar_completo'))
ok(/'centro_custo_id','uuid'/.test(editor), 'editor completo aceita centro_custo_id')
ok(/centro_custo_de_outra_empresa/.test(editor) && /IN \(SELECT public\.get_user_company_ids\(\)\)/.test(editor), 'editor: guarda de empresa do título e do centro')
ok(/REVOKE ALL ON FUNCTION public\.fn_pagar_editar_completo\(uuid, jsonb\) FROM PUBLIC, anon/.test(sql), 'editor fechado ao anon')

ok(/fn_trg_obra_centro_custo[\s\S]*c\.codigo = NEW\.numero[\s\S]*INSERT INTO public\.erp_centros_custo/.test(sql), 'obra nova: acha (código = número) ou cria o centro')
ok(/BEFORE INSERT OR UPDATE OF centro_custo_id ON public\.projetos_obras/.test(sql), 'trigger na obra (criação e troca de centro)')
ok(/projetos_obras_centro_custo_id_fkey[\s\S]*NOT VALID[\s\S]*VALIDATE CONSTRAINT projetos_obras_centro_custo_id_fkey/.test(sql), 'FK da obra para o centro, validada')
ok(/WHERE centro_custo_id IS NULL AND NULLIF\(btrim\(numero\), ''\) IS NOT NULL/.test(sql), 'obras sem centro recebem o seu na migration')
// fora dos corpos de função ($function$ … $function$), nenhum UPDATE em erp_pagar
const foraDeFuncoes = sql.replace(/\$function\$[\s\S]*?\$function\$/g, '')
ok(!/UPDATE\s+public\.erp_pagar/i.test(foraDeFuncoes), 'nenhum título a pagar existente é reescrito (RD-55)')
ok(/fn_obras_custo[\s\S]*IN \(SELECT public\.get_user_company_ids\(\)\)[\s\S]*REVOKE ALL ON FUNCTION public\.fn_obras_custo\(uuid\[\]\) FROM PUBLIC, anon/.test(sql),
  'custo por obra: guarda de empresa e fechado ao anon')

const form = readFileSync('src/components/financeiro/NovaDespesaForm.tsx', 'utf8')
ok(/data-testid="despesa-centro-custo"/.test(form) && /Centro de custo \/ obra/.test(form), 'Nova despesa: campo "Centro de custo / obra"')
ok(/from\('erp_centros_custo'\)[\s\S]{0,120}\.eq\('company_id', companyId\)/.test(form), 'lista de centros é da empresa')
ok(/update\(\{ centro_custo_id: centroCustoId \}\)\.in\('id', ids\)/.test(form), 'criar: grava o centro em todas as parcelas')
ok(/centro_custo_id: v\.centroCustoId \|\| null/.test(form) && /centroCustoId: String\(l\.centro_custo_id/.test(form), 'editar: carrega e salva centro_custo_id')

const modal = readFileSync('src/components/financeiro/EditarLancamentoModal.tsx', 'utf8')
ok(/const centroCampo: Campo = \{ col: 'centro_custo_id'/.test(modal) && !/centro_txt/.test(modal), 'modal de edição: pagar grava centro_custo_id (não mais o nome em texto)')

if (falhas) { console.error(`\n${falhas} falha(s) no centro de custo do contas a pagar`); process.exit(1) }
console.log('\nCentro de custo no contas a pagar + obra: ok')
