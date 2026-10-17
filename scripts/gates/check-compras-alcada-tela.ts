/**
 * Gate (#1677 B1): tela "Alçada de compras" — validação do formulário, RPCs da etapa A com guarda, menu/inventário
 * e todo "?" da tela com chave cadastrada na migration (RD-95).
 */
import { readFileSync } from 'node:fs'
import { validarAlcadaForm } from '../../src/lib/compras/alcada'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }

ok(validarAlcadaForm({ principal: '', substituto: '' }) !== null, 'sem aprovador principal não grava')
ok(validarAlcadaForm({ principal: 'u1', substituto: 'u1' }) !== null, 'principal e substituto iguais não grava')
ok(validarAlcadaForm({ principal: 'u1', substituto: '' }) === null && validarAlcadaForm({ principal: 'u1', substituto: 'u2' }) === null, 'principal (com ou sem substituto) grava')

const tela = readFileSync('src/app/dashboard/compras/alcada/page.tsx', 'utf8')
const mig = readFileSync('supabase/migrations/20261017020020_compras_alcada_tela.sql', 'utf8')
ok(/rpc\('fn_compras_alcada_obter'/.test(tela) && /rpc\('fn_compras_alcada_salvar'/.test(tela), 'tela lê e grava só pelas RPCs com guarda (etapa A)')
ok(!/from\('erp_compras_alcada_config'\)\s*\.\s*(insert|update|upsert|delete)/.test(tela), 'tela não escreve direto na tabela')
ok(/somenteLeitura/.test(tela) && /pode_configurar/.test(tela), 'não-Master vê em modo leitura')
ok(/urgencia_produto_ids:\s*cfg\.urgencia_produto_ids/.test(tela), 'salvar preserva os produtos urgentes já configurados')
const chaves = [...tela.matchAll(/<AjudaCampo chave="([^"]+)"/g)].map((m) => m[1])
ok(chaves.length >= 6, `tela tem "?" nos campos e ação (${chaves.length})`)
for (const c of chaves) ok(mig.includes(`'${c}'`), `chave de ajuda cadastrada: ${c}`)
ok(/INSERT INTO public\.module_catalog[\s\S]*'\/dashboard\/compras\/alcada'/.test(mig), 'tela entra no menu (module_catalog)')
ok(/INSERT INTO public\.system_screens[\s\S]*'\/dashboard\/compras\/alcada'/.test(mig), 'tela no inventário (system_screens)')
ok(!/CREATE OR REPLACE|DROP |DELETE FROM|UPDATE public\.(?!.*SET titulo)/i.test(mig.replace(/ON CONFLICT[^;]*;/g, ';')), 'migration só aditiva')

if (falhas) { console.error(`\n[check-compras-alcada-tela] ${falhas} falha(s) — build bloqueado.`); process.exit(1) }
console.log('\n[check-compras-alcada-tela] tela da alçada de compras conferida.')
