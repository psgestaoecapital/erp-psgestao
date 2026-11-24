// Gate (chamado "Configuração Fiscal não persiste o Token da Focus", 163): o token de cada ambiente (homologação/produção) é
// gravado no seu segredo do cofre e LIDO pelo mesmo segredo — antes a leitura exigia que o ambiente da config (NFS-e) fosse
// igual ao pedido e devolvia NULL para a NF-e em homologação ("api_key Focus NFe não encontrada"), e o ponteiro único fazia o
// token de um ambiente aparecer no outro. Estático, sem rede nem banco.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }
const mig = readFileSync('supabase/migrations/20261126100030_fiscal_token_por_ambiente_focus.sql', 'utf8')
const sql = mig.replace(/--.*$/gm, '')
const corpo = (nome: string) => {
  const i = sql.indexOf(`FUNCTION public.${nome}(`)
  return i < 0 ? '' : sql.slice(i, sql.indexOf('$function$;', sql.indexOf('AS $function$', i) + 10))
}
const obter = corpo('fn_fiscal_obter_token')
const salvar = corpo('fn_fiscal_salvar_token')
const status = corpo('fn_fiscal_token_status')

// leitura
ok(/'focus_token_' \|\| CASE WHEN v_amb = 'producao' THEN 'prod' ELSE 'homolog' END \|\| '_' \|\| p_company_id::text/.test(obter), 'obter: cada ambiente resolve o SEU segredo pelo nome (focus_token_{prod|homolog}_<empresa>)')
ok(obter.indexOf("'focus_token_'") > -1 && obter.indexOf("'focus_token_'") < obter.indexOf('focus_token_vault_id'), 'obter: o segredo do ambiente vem ANTES do ponteiro legado')
ok(/lower\(coalesce\(ambiente,'producao'\)\) = v_amb/.test(obter), 'obter: o ponteiro legado só vale se o ambiente da config é o pedido (nunca token de produção em homologação)')
ok(/IF NOT EXISTS \(SELECT 1 FROM erp_fiscal_provider_config WHERE company_id = p_company_id AND ativo = true\)/.test(obter), 'obter: só empresa com config fiscal ativa')
ok(/REVOKE ALL ON FUNCTION public\.fn_fiscal_obter_token\(uuid, text\) FROM PUBLIC, anon, authenticated;/.test(sql) && /GRANT EXECUTE ON FUNCTION public\.fn_fiscal_obter_token\(uuid, text\) TO service_role;/.test(sql), 'obter: segue só service_role (o token nunca chega ao navegador)')
// gravação
ok(/focus_token_vault_id = CASE WHEN focus_token_vault_id IS NULL OR lower\(coalesce\(ambiente,'producao'\)\) = p_ambiente/.test(salvar), 'salvar: o ponteiro legado não é trocado pelo token do outro ambiente')
ok(/atualizado_em = now\(\), atualizado_por = v_uid/.test(salvar) && /vault\.update_secret/.test(salvar) && /vault\.create_secret/.test(salvar), 'salvar: grava no cofre e carimba atualizado_em/por')
ok(/NOT EXISTS \(SELECT 1 FROM user_companies WHERE user_id = v_uid AND company_id = p_company_id\)/.test(salvar) && /length\(btrim\(p_token\)\) < 8/.test(salvar), 'salvar: confere o vínculo com a empresa e o tamanho do token')
ok(/REVOKE ALL ON FUNCTION public\.fn_fiscal_salvar_token\(uuid, text, text\) FROM PUBLIC, anon;/.test(sql), 'salvar: fechada ao anon')
// estado (nunca o valor)
ok(!/decrypted_secret|\bsecret\b\s*(FROM|,)/.test(status.replace(/vault\.secrets/g, '')) && /updated_at, created_at/.test(status), 'status: só existência e data do segredo — o valor nunca é lido')
ok(/REVOKE ALL ON FUNCTION public\.fn_fiscal_token_status\(uuid\) FROM PUBLIC, anon;/.test(sql), 'status: fechada ao anon')
ok(!/\bDELETE\b|\bDROP\b|TRUNCATE|UPDATE vault\.secrets|INSERT INTO vault/.test(sql), 'migration não apaga nem mexe em segredo existente')

// emissor e telas
const svc = readFileSync('src/lib/fiscal/service.ts', 'utf8')
ok(/rpc\('fn_fiscal_obter_token', \{\s*p_company_id: companyId,\s*p_ambiente: ambiente,/.test(svc), 'emissor pede o token do ambiente EFETIVO (o da NF-e, ou homologação se o override desceu)')
const card = readFileSync('src/components/fiscal/FocusNFeConfigCard.tsx', 'utf8')
ok(/fn_fiscal_token_status/.test(card) && /focus-token-homolog-status/.test(card) && /focus-token-prod-status/.test(card), 'tela mostra, por ambiente, se o token está gravado e quando')
ok(/focus-token-falta-nfe/.test(card) && /a emissão vai falhar/.test(card), 'tela avisa quando falta o token do ambiente em que a NF-e está')
ok(/gravado no cofre/.test(card) && /setSalvouTokens\(gravados\)/.test(card), 'ao salvar, a tela diz qual token foi gravado')
const rota = readFileSync('src/app/api/fiscal/provider-config/route.ts', 'utf8')
ok(/atualizado_em: new Date\(\)\.toISOString\(\)/.test(rota), 'todo Salvar da configuração carimba atualizado_em')
ok(/Token no corpo = recusa|O token do Focus é gravado no cofre pela tela/.test(rota), 'rota continua recusando token no corpo (só o cofre)')

if (falhas) { console.error(`\ncheck-fiscal-token-por-ambiente: ${falhas} falha(s)`); process.exit(1) }
console.log('\ncheck-fiscal-token-por-ambiente: ok')
