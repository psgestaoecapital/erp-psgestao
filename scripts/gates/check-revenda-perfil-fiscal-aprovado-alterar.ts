// Gate (chamado #5659 Alliance): perfil fiscal aprovado abre preenchido e bloqueado, com botão "Alterar" que cria a próxima versão.
// Estático, sem rede.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const sql = readFileSync('supabase/migrations/20261103180030_revenda_perfil_fiscal_aprovado_alterar.sql', 'utf8')
ok(sql.includes("'aprovado', CASE WHEN v_apr.id IS NULL"), 'obter devolve o bloco "aprovado" quando não há rascunho')
ok(sql.includes('CREATE OR REPLACE FUNCTION public.fn_veic_perfil_fiscal_nova_versao'), 'existe a função de nova versão')
ok(sql.includes('FROM veic_perfil_fiscal_operacao WHERE perfil_id = v_apr.id'), 'nova versão copia as operações')
ok(/REVOKE ALL ON FUNCTION public\.fn_veic_perfil_fiscal_nova_versao\(uuid,uuid\) FROM PUBLIC, anon/.test(sql), 'REVOKE de anon')
ok(!/fn_veic_perfil_fiscal_aprovar/.test(sql.replace(/--.*$/gm, '')), 'não toca a regra de aprovação')

const tela = readFileSync('src/app/dashboard/revenda/fiscal/page.tsx', 'utf8')
ok(tela.includes('fn_veic_perfil_fiscal_nova_versao'), 'a tela chama a nova versão')
ok(tela.includes('<fieldset disabled={somenteLeitura}'), 'o formulário fica bloqueado quando só há aprovado')
ok(tela.includes('revenda.fiscal.alterar'), 'botão Alterar tem o "?"')

if (falhas) process.exit(1)
