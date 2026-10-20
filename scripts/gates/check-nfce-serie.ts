/**
 * Gate (#3753, etapa 1A da NFC-e): a NFC-e (modelo 65) sai na série PRÓPRIA da Configuração Fiscal, nunca na da NF-e;
 * sem série configurada a emissão é recusada antes da Focus. Coluna nova nula (ninguém muda sem cadastrar), gravação
 * com guarda de empresa e de Master, sem segredo no ERP (CSC fica na Focus) e "?" em todo campo novo (RD-95).
 */
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }

const rota = readFileSync('src/app/api/fiscal/nfce/emitir/route.ts', 'utf8')
const iCfg = rota.indexOf(".select('serie_nfce')")
const iSemSerie = rota.indexOf("codigo: 'NFCE_SEM_SERIE'")
const iEmitir = rota.indexOf('svc.emitirNFCe(')
ok(iCfg > 0, 'rota lê a série da NFC-e da configuração fiscal da empresa')
ok(iSemSerie > iCfg && iSemSerie < iEmitir, 'sem série → recusa (NFCE_SEM_SERIE) antes de chamar a Focus')
ok(/nfceReq\.serie = serieNfce/.test(rota) && rota.indexOf('nfceReq.serie = serieNfce') < iEmitir, 'nota sai na série da NFC-e (não na serie_nfe_padrao do builder)')
ok(/ambienteOverride: body\.ambiente \?\? 'homologacao'/.test(rota), 'régua mantida: NFC-e nasce em homologação')

const mig = readFileSync('supabase/migrations/20261020160020_fiscal_nfce_serie.sql', 'utf8')
ok(/ADD COLUMN IF NOT EXISTS serie_nfce text;/.test(mig), 'coluna nova nula por padrão (NFC-e desligada até cadastrar)')
ok(/fn__guarda_empresa\(p_company_id\)/.test(mig) && /fn_pagar_usuario_master\(p_company_id\)/.test(mig), 'gravação com guarda de empresa e de Master')
ok(/precisa ser diferente da série da NF-e/.test(mig), 'série da NFC-e não pode repetir a da NF-e')
ok(/REVOKE EXECUTE ON FUNCTION public\.fn_fiscal_nfce_serie_salvar\(uuid, text\) FROM anon, public/.test(mig), 'função nova sem acesso anônimo')
ok(!/csc|vault/i.test(mig.replace(/^--.*$/gm, '').replace(/'[^']*'/g, '')), 'nenhum segredo (CSC) guardado no ERP')
const migSql = mig.replace(/^--.*$/gm, '')
ok(!/CREATE OR REPLACE (VIEW|FUNCTION public\.fn_(?!fiscal_nfce_serie_salvar))/i.test(migSql) && !/\bPOLICY\b|\bDROP\b/i.test(migSql), 'aditiva: não altera função, view nem policy existente')

const card = readFileSync('src/components/fiscal/ConfigFiscalEditCard.tsx', 'utf8')
ok(/supabase\.rpc\('fn_fiscal_nfce_serie_salvar'/.test(card), 'tela grava pela função com guarda')
const chaves = [...card.matchAll(/<AjudaCampo chave="([^"]*nfce[^"]*)"/g)].map((m) => m[1])
ok(chaves.length >= 2, 'campo e botão da NFC-e com "?"')
for (const c of chaves) ok(mig.includes(`'${c}'`), `"?" cadastrado: ${c}`)

if (falhas) { console.error(`\n[check-nfce-serie] ${falhas} falha(s) — build bloqueado.`); process.exit(1) }
console.log('\n[check-nfce-serie] série da NFC-e conferida.')
