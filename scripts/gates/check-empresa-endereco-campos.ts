// Gate do Canal PS 4762a526/60675777 (OK do CEO 13/10): endereço da EMPRESA em campos (CEP, logradouro, número,
// complemento, bairro, cidade, UF fiscal, IBGE), validado para a NF-e/NFS-e e com "?" em todos (RD-95).
import { readFileSync, readdirSync } from 'node:fs'

const falhas: string[] = []
const ok = (c: boolean, m: string) => { if (c) console.log('✓ ' + m); else { falhas.push(m); console.log('✗ ' + m) } }
const ler = (p: string) => readFileSync(p, 'utf8')

const mig = readdirSync('supabase/migrations').find((f) => f.endsWith('_companies_endereco_campos.sql'))
const sql = mig ? ler('supabase/migrations/' + mig) : ''
ok(!!mig && /^\d{12}20_/.test(mig), 'migration existe com os segundos 20 (faixa jordana-code)')
for (const c of ['cep', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'codigo_ibge_municipio'])
  ok(new RegExp(`ADD COLUMN IF NOT EXISTS ${c} text`).test(sql), `companies.${c} (aditiva)`)
ok(/FUNCTION public\.fn_empresa_salvar_endereco[\s\S]*get_user_company_ids/.test(sql), 'gravação do endereço confere a empresa do usuário')
ok(/REVOKE ALL ON FUNCTION public\.fn_empresa_salvar_endereco\([^)]*\) FROM PUBLIC, anon/.test(sql), 'gravação do endereço revoga anon')
ok(/REVOKE ALL ON FUNCTION public\.fn_empresa_obter_dados\(uuid\) FROM PUBLIC, anon/.test(sql), 'leitura revoga anon')
ok(/endereco_incompleto/.test(sql) && /uf_divergente/.test(sql) && /ibge_invalido/.test(sql), 'empresa brasileira: endereço incompleto, UF trocada e IBGE inexistente são recusados')
ok(/fn_municipio_por_nome_uf/.test(sql), 'IBGE vazio usa a regra única do município (fn_municipio_por_nome_uf)')
ok(/uf_fiscal = CASE WHEN v_br THEN v_uf/.test(sql), 'UF do endereço grava companies.uf_fiscal')
// revisão 16/10: foto de antes do backfill, sem UPDATE fixo por empresa e gravação só por quem administra a empresa
ok(/CREATE TABLE IF NOT EXISTS public\.companies_endereco_bkp_\d{8}[\s\S]*ENABLE ROW LEVEL SECURITY[\s\S]*REVOKE ALL ON public\.companies_endereco_bkp_\d{8} FROM PUBLIC, anon, authenticated/.test(sql),
  'backfill guarda a foto de antes numa tabela só do service_role')
ok(sql.indexOf('companies_endereco_bkp_') < sql.indexOf('DO $$'), 'a foto é tirada ANTES do backfill')
ok(!/WHERE id = '[0-9a-f-]{36}'/.test(sql), 'nenhum UPDATE fixo de uma empresa na migration')
ok(/fn_empresa_salvar_endereco[\s\S]*is_admin\(\)[\s\S]*user_companies[\s\S]*'owner', 'socio'[\s\S]*sem_permissao/.test(sql),
  'endereço fiscal só é gravado por dono/sócio/administrador da empresa ou administrador PS')

const pg = ler('src/app/dashboard/configuracoes/empresa/page.tsx')
const cep = ler('src/components/comum/CepEndereco.tsx')
ok(/<CepEndereco[\s\S]{0,300}?ajuda="empresa\.dados"/.test(pg), 'tela da empresa usa o CepEndereco comum com "?"')
ok(/fn_empresa_salvar_endereco/.test(pg), 'tela grava pelo RPC do endereço')
ok(!/set\('cidade_estado'/.test(pg) && !/set\('endereco'/.test(pg), 'texto livre de Cidade/Estado e Endereço saiu da tela (vem dos campos)')

// toda chave empresa.dados.* usada na tela/componente existe na migration
const chaves = new Set<string>([...pg.matchAll(/chave="(empresa\.dados\.[a-z_]+)"/g)].map((m) => m[1]))
for (const m of cep.matchAll(/chave=\{`\$\{ajuda\}\.([a-z_]+)`\}/g)) chaves.add('empresa.dados.' + m[1])
for (const k of chaves) if (k !== 'empresa.dados.ie_isento') ok(sql.includes(`'${k}'`), `"?" ${k} cadastrado em erp_ajuda_campo`)

if (falhas.length) { console.error(`\n${falhas.length} falha(s)`); process.exit(1) }
console.log('Endereço da empresa em campos: ok')
