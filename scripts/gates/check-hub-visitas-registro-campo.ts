// Gate (PDCA Hub 24/10, caixa e10ef43c): o card da visita mostra e permite o registro de campo sem abrir o formulário:
// local pelo GPS do aparelho (mesma RPC do formulário) e fotos/arquivos com observação (AnexosCard, vínculo visita),
// cada um com o seu "?" (RD-95) e a chave criada por migration.
import { readFileSync, readdirSync } from 'node:fs'
let falhas = 0
const ok = (c: boolean, m: string) => { console.log(`${c ? 'ok  ' : 'FALHA'} ${m}`); if (!c) falhas++ }

const tela = readFileSync('src/app/dashboard/projetos/visitas/page.tsx', 'utf8')
ok(/data-testid="visita-registro-campo"/.test(tela), 'o card tem a linha "Registro de campo"')
ok(/navigator\.geolocation\.getCurrentPosition/.test(tela) && /rpc\('fn_crm_visita_salvar'/.test(tela), 'registrar local usa o GPS e grava pela RPC do formulário')
ok(/p_fotos: r\.fotos \?\? \[\]/.test(tela) && /p_anotacoes: r\.anotacoes/.test(tela), 'registrar local repete os dados atuais da visita (não apaga fotos nem anotações)')
ok(/r\.status !== 'cancelada' \?/.test(tela), 'visita cancelada não oferece registrar local')
ok(/<AnexosCard companyId=\{r\.company_id\} vinculoTipo="visita" vinculoId=\{r\.id\} \/>/.test(tela), 'fotos e arquivos abrem o AnexosCard da visita no card')
ok(/\.from\('erp_crm_anexo'\)\.select\('visita_id'\)/.test(tela) && /\.is\('deleted_at', null\)/.test(tela), 'o número de arquivos conta só os anexos ativos')
ok(/AjudaCampo chave="projetos\.visitas\.registro_local"/.test(tela) && /AjudaCampo chave="projetos\.visitas\.fotos_arquivos"/.test(tela), 'as duas ações têm o "?" (RD-95)')

const mig = readdirSync('supabase/migrations').find((f) => f.endsWith('_hub_visitas_registro_campo_ajuda.sql'))
ok(!!mig, 'migration das chaves de ajuda existe')
const sql = mig ? readFileSync(`supabase/migrations/${mig}`, 'utf8') : ''
ok(sql.includes("'projetos.visitas.registro_local'") && sql.includes("'projetos.visitas.fotos_arquivos'") && /ON CONFLICT \(chave\) DO NOTHING/.test(sql), 'chaves novas criadas sem sobrescrever')
ok(!/DELETE|DROP|TRUNCATE/i.test(sql.replace(/--.*$/gm, '')), 'migration só acrescenta texto de ajuda')
if (falhas) process.exit(1)
