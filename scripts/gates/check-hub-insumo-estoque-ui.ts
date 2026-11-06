// Gate · Hub Insumos × estoque do GE (RD-35): migration guardada por empresa + tela usa as RPCs e tem "?" nas chaves novas. Sem rede.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (c) console.log('✓', m); else { falhas++; console.error('✗', m) } }
const sql = readFileSync('supabase/migrations/20261023231535_hub_insumo_ge_busca_vinculos.sql', 'utf8')
const tela = readFileSync('src/app/dashboard/projetos/insumos/page.tsx', 'utf8')
ok((sql.match(/fn__guarda_empresa/g) ?? []).length >= 3, 'as 3 funções guardam a empresa')
ok((sql.match(/REVOKE ALL ON FUNCTION/g) ?? []).length === 3, 'REVOKE de anon nas 3 funções')
ok(!/\bDELETE FROM\b|\bDROP\b|\bTRUNCATE\b/i.test(sql), 'migration sem DELETE/DROP/TRUNCATE')
for (const f of ['fn_hub_insumo_vinculos', 'fn_hub_insumo_buscar_produtos', 'fn_hub_insumo_vincular', 'fn_hub_insumo_custo', 'fn_hub_insumo_desvincular']) ok(tela.includes(f), `tela chama ${f}`)
ok(tela.includes('fn_projetos_atualizar_preco_insumo') && /custo !== Number\(modalGE\.current_cost/.test(tela), 'ligar traz o custo do estoque para o insumo (recalcula serviços)')
for (const k of ['estoque', 'estoque_busca', 'estoque_maior']) ok(tela.includes(`projetos.insumos.${k}`) && sql.includes(`'projetos.insumos.${k}'`), `"?" ${k} na tela e no banco`)
if (falhas) { console.error(`${falhas} falha(s)`); process.exit(1) }
