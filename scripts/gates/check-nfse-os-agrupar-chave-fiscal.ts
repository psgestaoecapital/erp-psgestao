// Gate (ajuste #6426) — NFS-e da OS agrupa por CHAVE FISCAL (não por cadastro erp_servicos.id). Itens de cadastros
// diferentes com os MESMOS parâmetros fiscais = 1 grupo = 1 nota com o total. Estático, sem rede.
import { readFileSync, readdirSync, existsSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

const dir = 'supabase/migrations'
const nome = readdirSync(dir).find((n) => n.endsWith('_nfse_os_agrupar_chave_fiscal.sql'))
ok(!!nome, 'migration do ajuste presente')
const mig = nome ? readFileSync(`${dir}/${nome}`, 'utf8') : ''

ok(/CREATE OR REPLACE FUNCTION public\.fn_os_nfse_preparar\(/.test(mig), 'CREATE OR REPLACE fn_os_nfse_preparar')
// agrupa pela CHAVE FISCAL (todos os campos que mudam o XML) — e NÃO pelo id do cadastro
ok(/GROUP BY codigo_lc116, codigo_servico_municipio, aliq, retido, tipo_tributacao, codigo_nbs, cnae/.test(mig), 'agrupa por chave fiscal (LC116, município, ISS, retido, tributação, NBS, CNAE)')
ok(/pis, rpis, cof, rcof, ir, rir, csll, rcsll, inss, rinss/.test(mig), 'chave fiscal inclui PIS/COFINS/IR/CSLL/INSS + retenções')
ok(!/GROUP BY[^\n]*\bsid\b/.test(mig) && !/GROUP BY[^\n]*s\.id/.test(mig), 'NÃO agrupa pelo id do cadastro (sid)')
// candidatos + sugerido (maior valor)
ok(/'cadastros', jsonb_agg\(DISTINCT jsonb_build_object\('servico_fiscal_id', sid/.test(mig), 'devolve os cadastros candidatos do grupo')
ok(/'servico_fiscal_id', \(array_agg\(sid ORDER BY valor DESC/.test(mig), 'serviço sugerido = cadastro do item de MAIOR valor')
ok(/'valor_total', SUM\(valor\)/.test(mig), 'valor do grupo = soma dos itens (total)')
// mantém os campos atuais (sem regressão) + segurança
ok(/'servicos_fiscais', v_servicos/.test(mig) && /'tem_vinculo'/.test(mig) && /'itens_sem_vinculo'/.test(mig) && /'valor_servicos', v_val_serv/.test(mig), 'mantém campos atuais (servicos_fiscais/tem_vinculo/itens_sem_vinculo/valor_servicos)')
ok(/REVOKE ALL ON FUNCTION public\.fn_os_nfse_preparar\(uuid\) FROM PUBLIC, anon/.test(mig), 'função SECURITY DEFINER fechada ao anon (fn-guards)')
ok(/oficina\.os\.nfse_servico_nota/.test(mig) && /'publicado'/.test(mig), 'ajuda RD-95 do "Serviço da nota"')

// front
const btn = existsSync('src/components/comum/EmitirNFSeOSButton.tsx') ? readFileSync('src/components/comum/EmitirNFSeOSButton.tsx', 'utf8') : ''
ok(/cadastros\??: CadastroGrupo\[\]/.test(btn) && /escolhaCadastro/.test(btn), 'EmitirNFSeOSButton: escolha do cadastro por grupo (serviço da nota)')
ok(/AjudaCampo chave="oficina\.os\.nfse_servico_nota"/.test(btn), 'EmitirNFSeOSButton: "?" RD-95 do serviço da nota')
ok(/valor: g\.valor_total/.test(btn), 'EmitirNFSeOSButton: valor da nota = total do grupo (não muda com a escolha)')

if (falhas) { console.error(`${falhas} falha(s)`); process.exit(1) }
console.log('check-nfse-os-agrupar-chave-fiscal OK')
