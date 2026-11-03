// Gate (chamado #6698 Alliance): "Alterar" criava o rascunho mas o obter falhava ("record v_apr is not assigned yet").
// Estático, sem rede.
import { readdirSync, readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const arq = readdirSync('supabase/migrations').filter((f) => f.endsWith('_revenda_perfil_fiscal_obter_rascunho.sql'))
ok(arq.length === 1, 'existe a migration do obter com rascunho')
const sql = readFileSync(`supabase/migrations/${arq[0]}`, 'utf8').replace(/--.*$/gm, '')
ok(sql.includes('v_apr_id uuid') && sql.includes('v_apr_id := v_apr.id'), 'guarda o id do aprovado em variável uuid')
ok(sql.includes("'aprovado', CASE WHEN v_apr_id IS NULL"), 'o bloco aprovado não lê o registro não atribuído')
ok(!/CASE WHEN v_apr\.id IS NULL/.test(sql), 'não lê v_apr.id fora do ramo sem rascunho')

if (falhas) process.exit(1)
