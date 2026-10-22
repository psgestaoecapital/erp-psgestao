// Gate · estado da main/deploy no painel da aba Codes: cancelado não é vermelho; workflow só lê o GitHub.
import { readFileSync } from 'node:fs'
import { estadoDoRun, ultimoEstado } from '../dev/codes-main-deploy.mjs'
const falhas: string[] = []
const exige = (ok: boolean, m: string) => { if (!ok) falhas.push(m) }
exige(estadoDoRun({ status: 'completed', conclusion: 'success' }) === 'verde', 'success = verde')
exige(estadoDoRun({ status: 'completed', conclusion: 'failure' }) === 'vermelho', 'failure = vermelho')
exige(estadoDoRun({ status: 'completed', conclusion: 'cancelled' }) === 'desconhecido', 'cancelado não é vermelho')
exige(estadoDoRun({ status: 'in_progress', conclusion: null }) === 'desconhecido', 'em andamento = desconhecido')
exige(ultimoEstado([{ status: 'completed', conclusion: 'cancelled' }, { status: 'completed', conclusion: 'success' }]) === 'verde', 'pula cancelado')
const yml = readFileSync('.github/workflows/codes-main-deploy.yml', 'utf8')
exige(/permissions:\s*\n\s*contents: read\s*\n\s*actions: read/.test(yml), 'permissões só leitura')
exige(!/pull_request/.test(yml), 'não roda código de PR')
if (falhas.length) { console.error('check-codes-main-deploy FALHOU:', falhas.join('; ')); process.exit(1) }
console.log('check-codes-main-deploy ok')
