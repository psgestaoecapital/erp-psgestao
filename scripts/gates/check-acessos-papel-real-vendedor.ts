// Gate · Acessos por papéis reais + código do vendedor no cadastro (CEO 25/11). Sem rede. Confere:
//  A) /dashboard/admin/acessos: a "Função / Papel na empresa" vem do catálogo (fn_acessos_papeis_rbac), agrupada por
//     camada (optgroup), e o Salvar grava pela RPC com guarda (fn_acessos_definir_papel_rbac); o nível (users.role)
//     segue gravado por fn_acessos_salvar_pessoa e a lista de níveis nunca oferece admin; o adicionar também aplica a função;
//  B) /dashboard/admin/vendedores: cadastro usuário → código vem da equipe do ERP de origem (fn_com_vendedor_acesso_listar)
//     e grava só pela RPC com guarda (fn_com_vendedor_acesso_salvar); mostra superior; nenhuma escrita direta (.from);
//  C) a migration do PR é só aditiva (chaves de ajuda) e toda chave de "?" das duas telas está cadastrada.
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (c) console.log('✓', m); else { falhas++; console.error('✗', m) } }

const acessos = readFileSync('src/app/dashboard/admin/acessos/page.tsx', 'utf8')
const seletor = readFileSync('src/app/dashboard/admin/acessos/_components/SeletorPapelReal.tsx', 'utf8')
const vend = readFileSync('src/app/dashboard/admin/vendedores/page.tsx', 'utf8')
const migs = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql'))
const todasMigs = migs.map((f) => readFileSync(`supabase/migrations/${f}`, 'utf8')).join('\n')
const arq = migs.filter((f) => f.endsWith('_ajuda_acessos_papel_real_vendedor_codigo.sql'))
ok(arq.length === 1, 'migration de ajuda do PR presente (1 arquivo)')
const mig = arq.length ? readFileSync(`supabase/migrations/${arq[0]}`, 'utf8') : ''
const sql = mig.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')

// A — Acessos
ok(/rpc\("fn_acessos_papeis_rbac"/.test(acessos), 'acessos: papéis reais vêm de fn_acessos_papeis_rbac (catálogo da vertical contratada)')
ok(/<SeletorPapelReal[^>]*value=\{papelSlug\}/.test(acessos) && (acessos.match(/<SeletorPapelReal/g) || []).length >= 2, 'acessos: seletor de papel real no editar E no adicionar pessoa')
ok(/<optgroup/.test(seletor) && /propriedade[\s\S]*direcao[\s\S]*gerencia[\s\S]*supervisao[\s\S]*especialista[\s\S]*operacao/.test(seletor), 'seletor: agrupado por camada (Propriedade → Operação)')
ok(/secoes/.test(seletor) && /itens/.test(seletor), 'seletor: mostra seções/itens que a função libera')
ok(/rpc\("fn_acessos_definir_papel_rbac"/.test(acessos), 'acessos: adicionar (pessoa já com login) aplica a função por fn_acessos_definir_papel_rbac')
// Spec CEO 26/11 (raiz do "menu aberto"): o Salvar da pessoa manda papel + código do vendedor NA MESMA chamada.
ok(/p_papel_slug: papelSlug \|\| null/.test(acessos) && /p_vendedor_codigo: codigoVend/.test(acessos), 'acessos: Salvar manda papel e código do vendedor no mesmo fn_acessos_salvar_pessoa')
ok(/PAPEL_VENDEDOR = "industria_comercial"/.test(acessos) && /data-testid="vendedor-codigo"/.test(acessos) && /ehVendedor && !codigoVend/.test(acessos), 'acessos: Vendedor Comercial mostra e exige o "Código do vendedor"')
{
  const m = migs.filter((f) => f.endsWith('_acessos_salvar_pessoa_papel_codigo_vendedor.sql'))
  const s2 = m.length ? readFileSync(`supabase/migrations/${m[0]}`, 'utf8') : ''
  ok(m.length === 1, 'migration do salvar com papel + código presente')
  ok(/p_papel_slug text DEFAULT '<manter>'/.test(s2) && /p_vendedor_codigo text DEFAULT NULL/.test(s2), 'salvar_pessoa: papel opcional (omitido = mantém) e código opcional')
  ok(/fn_acessos_definir_papel_rbac\(p_company_id, p_user_id, v_slug, NULL\)/.test(s2) && /fn_com_vendedor_acesso_salvar\(p_company_id, v_cod, p_user_id\)/.test(s2), 'salvar_pessoa: reusa as RPCs com guarda (papel e código), sem recriar')
  ok(/RAISE EXCEPTION/.test(s2), 'salvar_pessoa: recusa do papel/código desfaz o salvar inteiro')
  ok(/'adm','admin','acesso_total','ps_admin'/.test(s2), 'salvar_pessoa: continua barrando nível admin')
  ok(/REVOKE ALL ON FUNCTION public\.fn_acessos_salvar_pessoa\([^)]*\) FROM PUBLIC, anon/.test(s2), 'salvar_pessoa: sem EXECUTE para anon')
}
ok(/rpc\("fn_acessos_salvar_pessoa"/.test(acessos), 'acessos: áreas, plantas, horário e nível seguem em fn_acessos_salvar_pessoa (compatibilidade)')
const niveis = acessos.match(/const PAPEIS(?:_AGENCIA)?: [\s\S]*?\n\];/g)?.join('\n') ?? ''
ok(niveis.length > 0 && !/role: "(adm|admin|acesso_total|ps_admin)"/.test(niveis), 'níveis oferecidos nunca incluem admin (sem escalação)')
ok(!/"(adm|admin|acesso_total)"/.test(seletor), 'sugestão de nível nunca devolve admin')
ok(!/\.from\(/.test(seletor), 'seletor não lê tabela direto')

// B — Vendedores
ok(/rpc\('fn_com_vendedor_acesso_listar'/.test(vend) && /rpc\('fn_com_vendedor_acesso_salvar'/.test(vend), 'vendedores: lista e grava só pelas RPCs com guarda de empresa')
ok(!/\.from\(/.test(vend), 'vendedores: nenhuma escrita/leitura direta em tabela')
ok(/data-testid="novo-usuario"/.test(vend) && /data-testid="novo-codigo"/.test(vend), 'vendedores: cadastro escolhe usuário + código')
ok(/rotuloSuperior\(m\.superior\)/.test(vend) && /com\.vendedores\.col_superior/.test(vend), 'vendedores: mostra o superior de cada código')

// C — migration aditiva + "?"
ok(/INSERT INTO public\.erp_ajuda_campo/.test(sql) && /ON CONFLICT \(chave\) DO NOTHING/.test(sql), 'migration: só semeia chaves de ajuda (idempotente)')
ok(!/\b(UPDATE|DELETE|DROP|TRUNCATE|ALTER|GRANT|REVOKE|CREATE\s+(OR\s+REPLACE\s+)?(FUNCTION|VIEW|POLICY|TABLE))\b/i.test(sql), 'migration: nada além de INSERT (sem função/policy/grant/dado de cliente)')
for (const [nome, txt] of [['acessos', acessos + seletor], ['vendedores', vend]] as const) {
  const chaves = [...txt.matchAll(/AjudaCampo chave="([^"]+)"/g)].map((m) => m[1])
  ok(chaves.length > 0, `"?" na tela ${nome}`)
  for (const k of new Set(chaves)) ok(todasMigs.includes(`('${k}',`), `chave de ajuda cadastrada: ${k}`)
}

if (falhas) { console.error(`\n${falhas} falha(s) — acessos por papel real / código do vendedor`); process.exit(1) }
console.log('\nAcessos por papel real + código do vendedor ok')
