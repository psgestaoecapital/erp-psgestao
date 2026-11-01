// Gate (chamado #3842 · NR-36): documento assinado da Conferência. Estático, sem rede.
// Prova o contrato do anexo: papel TST/Compliance em salvar/listar/remover e no arquivo do bucket, caminho do tenant,
// soft-delete (sem DELETE físico), RLS/REVOKE anon e upload sem CPF no nome, com checagem de papel antes do upload.
import { readFileSync } from 'node:fs'
import { readdirSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const arq = readdirSync('supabase/migrations').find(f => f.endsWith('_nr36_3842_conferencia_anexo.sql'))
ok(!!arq, 'migration do anexo existe')
const sql = readFileSync('supabase/migrations/' + arq, 'utf8')
const fn = (nome: string) => sql.slice(sql.indexOf('FUNCTION public.' + nome), sql.indexOf('END $function$', sql.indexOf('FUNCTION public.' + nome)))
const tela = readFileSync('src/app/dashboard/compliance/pausas-tecnicas/page.tsx', 'utf8')

ok(/ENABLE ROW LEVEL SECURITY/.test(sql) && /REVOKE ALL ON public\.nr36_conferencia_anexo FROM PUBLIC, anon, authenticated/.test(sql), 'tabela com RLS ligada e REVOKE de anon')
ok(!/GRANT[^;]*(INSERT|UPDATE|DELETE)[^;]*nr36_conferencia_anexo/i.test(sql) && !/DELETE FROM public\.nr36_conferencia_anexo/i.test(sql), 'tabela sem DELETE físico nem escrita direta (só pelas funções)')
ok(/CREATE POLICY nr36_conferencia_anexo_ler[\s\S]{0,200}fn_nr36_pode_subir\(company_id\)/.test(sql), 'outra empresa / sem papel não lê a tabela (RLS pelo papel)')
ok(/fn_nr36_pode_subir\(p_company_id\)[\s\S]{0,200}sem_permissao/.test(fn('fn_nr36_conferencia_anexo_salvar')), 'salvar devolve sem_permissao sem o papel')
ok(/split_part\(p_arquivo_path, '\/', 1\) <> p_company_id::text/.test(fn('fn_nr36_conferencia_anexo_salvar')), 'salvar recusa caminho de outra empresa')
ok(/fn_nr36_pode_subir\(p_company_id\)[\s\S]{0,200}sem_permissao/.test(fn('fn_nr36_conferencia_anexo_listar')), 'listar só devolve para quem tem o papel')
ok(/fn_nr36_pode_subir\(v_company\)[\s\S]{0,200}sem_permissao/.test(fn('fn_nr36_conferencia_anexo_remover')), 'remover devolve sem_permissao sem o papel')
ok(/SET removido_em = now\(\)/.test(fn('fn_nr36_conferencia_anexo_remover')) && !/DELETE/.test(fn('fn_nr36_conferencia_anexo_remover')), 'remover é só soft-delete (a linha fica no rastro)')
ok(/nr36_conferencia_arquivo_insert ON storage\.objects AS RESTRICTIVE FOR INSERT/.test(sql) && /nr36_conferencia_arquivo_select ON storage\.objects AS RESTRICTIVE FOR SELECT/.test(sql), 'bucket: subir e ler o arquivo da conferência exigem o papel (policy RESTRICTIVE)')
ok(!/ON storage\.objects[^;]*FOR DELETE/i.test(sql), 'bucket sem policy de DELETE')
ok(!/REVOKE[^;]*anon[^;]*;[\s\S]*GRANT EXECUTE[^;]*TO anon/.test(sql) && !/TO anon/.test(sql.replace(/FROM PUBLIC, anon/g, '')), 'nenhuma função concedida a anon')
ok(!/Anderson/.test(sql), 'texto de ajuda sem nome real')

const sub = tela.slice(tela.indexOf('async function subirAnexo'), tela.indexOf('async function verAnexo'))
ok(sub.indexOf("'fn_nr36_pode_subir'") > -1 && sub.indexOf("'fn_nr36_pode_subir'") < sub.indexOf('.upload('), 'a tela confere o papel ANTES do upload')
ok(/randomUUID\(\)/.test(sub) && !/\$\{cpf\}/.test(sub), 'o nome do arquivo leva UUID, sem CPF')
ok(/\.remove\(\[path\]\)/.test(sub), 'falha ao registrar tenta remover o arquivo órfão')

if (falhas) { console.error(`\n${falhas} falha(s) no anexo da Conferência (#3842)`); process.exit(1) }
console.log('\nAnexo assinado da Conferência (#3842): ok')
