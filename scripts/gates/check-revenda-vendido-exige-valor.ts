// Gate (chamado #3725 Alliance): marcar o veículo como "vendido" na ficha não pode mudar a situação sem o valor da venda.
// Sem venda registrada, escolher "vendido" abre a janela de registrar venda (que exige valor > 0). Roda no build. Sem rede.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const src = readFileSync('src/app/dashboard/revenda/veiculo/[id]/page.tsx', 'utf8')
const fn = src.slice(src.indexOf('async function mudarSituacao'), src.indexOf('async function excluirCusto'))
const guarda = fn.indexOf("nova === 'vendido' && !venda")
ok(guarda > -1 && fn.slice(guarda, guarda + 120).includes("setModal('venda')"), "escolher 'vendido' sem venda abre a janela de registrar venda")
ok(guarda > -1 && guarda < fn.indexOf('fn_veic_mudar_situacao'), 'a guarda vem ANTES da chamada que muda a situação')
ok(src.includes("Informe o valor da venda (maior que zero)."), 'a janela de venda exige o valor da venda')

if (falhas) process.exit(1)
