// Passo final (always) das aceitações: solta a trava da demo mesmo quando o run foi cancelado/estourou o timeout
// (o global-teardown não roda nesses casos e a lease ficava até 25 min, bloqueando a próxima aceitação sem teste rodado).
// Só solta a trava DESTE run (dono = URL do run); se não for dona, fn_e2e_trava_soltar não apaga nada.
// Também PURGA o lixo de E2E das demos (CEO 22/10): como roda SEMPRE (até em cancel/timeout), zera a acumulação de
// obras/centros de teste que estourava o limite de 1000 do dropdown "Centro de custo / obra" e travava o @pos.
import { donoTrava, soltarTravaDemo, purgarLeftoversDemo } from '../e2e/support/api'

async function main(): Promise<void> {
  await soltarTravaDemo(donoTrava())
  console.log('[trava-demo] liberação final concluída')
  await purgarLeftoversDemo()
}

void main()
