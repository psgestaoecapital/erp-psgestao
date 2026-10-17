/**
 * Gate (#2946): nota emitida sai do "processando" depressa e sem duplicidade — consulta em degraus no modal (~2 min),
 * "processando" nunca vira "rejeitada" (RD-51), botão "Consultar agora" na lista e rotina de segurança a cada 2 min.
 */
import { readFileSync } from 'node:fs'
import { ESPERAS_CONSULTA_MS, esperaConsulta, resumoConsulta, AVISO_PROCESSANDO } from '../../src/lib/fiscal/consultaRetorno'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }

const total = ESPERAS_CONSULTA_MS.reduce((a, b) => a + b, 0)
ok(ESPERAS_CONSULTA_MS[0] <= 3000, 'primeira consulta em até 3 s')
ok(total >= 90_000 && total <= 180_000, `modal consulta por ~2 min (${total / 1000}s)`)
ok(ESPERAS_CONSULTA_MS.every((v, i) => i === 0 || v >= ESPERAS_CONSULTA_MS[i - 1]), 'esperas só crescem (não martela a Focus)')
ok(esperaConsulta(0) === ESPERAS_CONSULTA_MS[0] && esperaConsulta(ESPERAS_CONSULTA_MS.length) === null && esperaConsulta(-1) === null, 'fim das tentativas devolve null')
ok(/Nota autorizada: nº 651/.test(resumoConsulta({ status: 'autorizada', numero: 651 })), 'resumo: autorizada com número')
ok(/rejeitada: Rejeição 539/.test(resumoConsulta({ status: 'rejeitada', motivoRejeicao: 'Rejeição 539' })), 'resumo: rejeitada com motivo')
ok(/Não emita de novo/.test(resumoConsulta({ status: 'processando' })) && /Não emita de novo/.test(AVISO_PROCESSANDO), 'processando avisa para não reemitir')

const nfe = readFileSync('src/components/fiscal/NFePreviewModal.tsx', 'utf8')
const nfse = readFileSync('src/components/fiscal/NFSePreviewModal.tsx', 'utf8')
const lista = readFileSync('src/app/dashboard/fiscal/nfe/NFeListClient.tsx', 'utf8')
ok(/esperaConsulta\(attempt\)/.test(nfe) && /esperaConsulta\(attempt\)/.test(nfse), 'modais NF-e e NFS-e usam a consulta em degraus')
const pollNfse = nfse.slice(nfse.indexOf('async function pollStatus'), nfse.indexOf('async function pollStatus') + 600)
ok(/setStatus\('processando'\)/.test(pollNfse) && !/Tempo esgotado/.test(nfse), 'NFS-e: fim da espera fica "processando", não "rejeitada" (RD-51)')
ok(/data-testid="nfse-consultar-agora"/.test(nfse), 'NFS-e: botão Consultar agora no estado processando')
ok(/data-testid="nfe-consultar-agora"/.test(lista) && /\/api\/fiscal\/nfe\/consultar\/\$\{doc\.principal_id\}/.test(lista), 'lista de NF-es: Consultar agora usa a rota com guarda')
ok(/data-testid="nfe-aviso-processando"/.test(lista), 'lista de NF-es: aviso de não reemitir')

const mig = readFileSync('supabase/migrations/20261017220020_nfe_consultar_processando_2min.sql', 'utf8')
ok(/cron\.alter_job\([^)]*'\*\/2 \* \* \* \*'/.test(mig) && /nfe-consultar-processando/.test(mig), 'rotina de segurança da NF-e a cada 2 min')
ok(!/CREATE OR REPLACE FUNCTION/i.test(mig), 'migration não reescreve função')

if (falhas) { console.error(`\n[check-nfe-consulta-retorno] ${falhas} falha(s) — build bloqueado.`); process.exit(1) }
console.log('\n[check-nfe-consulta-retorno] retorno da nota conferido.')
