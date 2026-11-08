// Gate (CEO 08/11, tarefa beebd8a4) — "Pessoas e vagas" do posto em /dashboard/produtividade.
// Garante que a LEITURA de pessoa/CPF do posto seja fail-closed por empresa (LGPD) e aditiva, e que a tela
// consuma só as RPCs já guardadas. Sem rede, só leitura estática dos arquivos do repo.
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }
const ler = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : '')

// ── migration: RPC de leitura nova, guardada e aditiva ───────────────────────────────────────────────
const dir = 'supabase/migrations'
const arq = existsSync(dir) ? readdirSync(dir).find((f) => f.endsWith('_prod_posto_pessoas_vagas_ui.sql')) : undefined
ok(!!arq, `migration prod_posto_pessoas_vagas_ui presente (${arq ?? '—'})`)
const sql = (arq ? ler(join(dir, arq)) : '').replace(/--[^\n]*/g, '')
ok(/CREATE OR REPLACE FUNCTION public\.fn_prod_posto_pessoas_listar/.test(sql), 'cria a função de leitura fn_prod_posto_pessoas_listar')
ok(/SECURITY DEFINER/.test(sql) && /SET search_path TO 'public'/.test(sql), 'SECURITY DEFINER com search_path fixo')
ok(/get_user_company_ids\(\)\s*\)\s*OR\s*is_admin\(\)/.test(sql.replace(/\s+/g, ' ')) ||
   /IN \(SELECT get_user_company_ids\(\)\) OR is_admin\(\)/.test(sql), 'guarda fail-closed por empresa (get_user_company_ids OR is_admin)')
ok(/sem_acesso/.test(sql), 'retorna sem_acesso quando fora do escopo')
ok(/REVOKE ALL ON FUNCTION public\.fn_prod_posto_pessoas_listar\(uuid\) FROM anon/.test(sql), 'REVOKE anon na função de leitura')
// aditiva: não mexe em RLS/policy/grant de tabela nem apaga dado
ok(!/\b(DROP|DELETE|TRUNCATE|ALTER TABLE)\b/i.test(sql), 'migration aditiva (sem DROP/DELETE/TRUNCATE/ALTER TABLE)')
ok(!/CREATE POLICY|ALTER POLICY|USING \(true\)/i.test(sql), 'não cria/afrouxa policy (sem USING(true))')
// RD-95: 3 chaves de ajuda da seção
for (const chave of ['prod.posto.pessoas_vagas', 'prod.posto.pessoa_cpf', 'prod.posto.pessoa_turno']) {
  ok(sql.includes(`'${chave}'`), `ajuda RD-95 cadastrada: ${chave}`)
}

// ── componente e tela ────────────────────────────────────────────────────────────────────────────────
const comp = ler('src/components/produtividade/PostoPessoas.tsx')
ok(comp.includes('fn_prod_posto_pessoas_listar'), 'componente lê por fn_prod_posto_pessoas_listar')
ok(comp.includes('fn_prod_posto_pessoa_alocar') && comp.includes('fn_prod_posto_pessoa_desalocar'), 'incluir/excluir usam as RPCs guardadas (alocar/desalocar)')
ok(/(chave|k)="prod\.posto\.pessoa_cpf"/.test(comp) && /(chave|k)="prod\.posto\.pessoas_vagas"/.test(comp), 'RD-95 "?" no CPF e no indicador de vagas')
ok(/Math\.max\(0, capacidade - ocupado\)/.test(comp), 'vaga = quadro − ocupado (nunca negativo)')

const page = ler('src/app/dashboard/produtividade/page.tsx')
ok(page.includes("import { PostoPessoas }"), 'tela importa PostoPessoas')
ok(/<PostoPessoas[\s\S]{0,200}postoId=\{posto\.id\}/.test(page), 'tela renderiza PostoPessoas por posto')

if (falhas) { console.error(`\n${falhas} falha(s) no gate Pessoas e vagas do posto.`); process.exit(1) }
console.log('✓ Pessoas e vagas do posto: leitura guardada, aditiva e com "?" (RD-95)')
