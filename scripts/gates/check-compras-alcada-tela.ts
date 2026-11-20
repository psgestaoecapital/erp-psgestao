/**
 * Gate (#1677 B1): tela "Alçada de compras" — validação do formulário, RPCs da etapa A com guarda, menu/inventário
 * e todo "?" da tela com chave cadastrada na migration (RD-95).
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { validarAlcadaForm } from '../../src/lib/compras/alcada'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }

ok(validarAlcadaForm({ principal: '', substituto: '' }) !== null, 'sem aprovador principal não grava')
ok(validarAlcadaForm({ principal: 'u1', substituto: 'u1' }) !== null, 'principal e substituto iguais não grava')
ok(validarAlcadaForm({ principal: 'u1', substituto: '' }) === null && validarAlcadaForm({ principal: 'u1', substituto: 'u2' }) === null, 'principal (com ou sem substituto) grava')

const tela = readFileSync('src/app/dashboard/compras/alcada/page.tsx', 'utf8')
const migDir = 'supabase/migrations'
const telaMig = readFileSync(join(migDir, '20261017020020_compras_alcada_tela.sql'), 'utf8')
// A ajuda das chaves da alçada pode ser semeada em qualquer migration da área (a allowlist de produtos por UI — #5345 —
// trouxe urgencia_produtos/incluir_produto numa migration própria); procura em todas as migrations "*alcada*".
const migAlcada = readdirSync(migDir)
  .filter((f) => f.endsWith('.sql') && /alcada/.test(f))
  .map((f) => readFileSync(join(migDir, f), 'utf8'))
  .join('\n')
ok(/rpc\('fn_compras_alcada_obter'/.test(tela) && /rpc\('fn_compras_alcada_salvar'/.test(tela), 'tela lê e grava só pelas RPCs com guarda (etapa A)')
ok(!/from\('erp_compras_alcada_config'\)\s*\.\s*(insert|update|upsert|delete)/.test(tela), 'tela não escreve direto na tabela')
ok(/somenteLeitura/.test(tela) && /pode_configurar/.test(tela), 'não-Master vê em modo leitura')
// Preservação: a allowlist de produtos carrega a config atual para o estado e salva esse mesmo estado — o que já estava
// configurado não se perde ao salvar (a UI só acrescenta/remove, nunca zera o que veio do banco).
ok(/setProdutoIds\(\s*conf\.urgencia_produto_ids\s*\?\?\s*\[\]\s*\)/.test(tela) && /urgencia_produto_ids:\s*produtoIds/.test(tela),
  'salvar preserva os produtos urgentes já configurados')
const chaves = [...tela.matchAll(/<AjudaCampo chave="([^"]+)"/g)].map((m) => m[1])
ok(chaves.length >= 6, `tela tem "?" nos campos e ação (${chaves.length})`)
for (const c of chaves) ok(migAlcada.includes(`'${c}'`), `chave de ajuda cadastrada: ${c}`)
ok(/INSERT INTO public\.module_catalog[\s\S]*'\/dashboard\/compras\/alcada'/.test(telaMig), 'tela entra no menu (module_catalog)')
ok(/INSERT INTO public\.system_screens[\s\S]*'\/dashboard\/compras\/alcada'/.test(telaMig), 'tela no inventário (system_screens)')
ok(!/CREATE OR REPLACE|DROP |DELETE FROM|UPDATE public\.(?!.*SET titulo)/i.test(telaMig.replace(/ON CONFLICT[^;]*;/g, ';')), 'migration só aditiva')

if (falhas) { console.error(`\n[check-compras-alcada-tela] ${falhas} falha(s) — build bloqueado.`); process.exit(1) }
console.log('\n[check-compras-alcada-tela] tela da alçada de compras conferida.')
