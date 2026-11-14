// Passo final (always) das aceitações: solta a trava da demo mesmo quando o run foi cancelado/estourou o timeout
// (o global-teardown não roda nesses casos e a lease ficava até 25 min, bloqueando a próxima aceitação sem teste rodado).
// Só solta a trava DESTE run (dono = URL do run); se não for dona, fn_e2e_trava_soltar não apaga nada.
// Também PURGA o lixo de E2E das demos (CEO 22/10): como roda SEMPRE (até em cancel/timeout), zera a acumulação de
// obras/centros de teste que estourava o limite de 1000 do dropdown "Centro de custo / obra" e travava o @pos.
import { donoTrava, soltarTravaDemo, purgarLeftoversDemo, purgarReceberDemo, purgarProdutosDemo } from '../e2e/support/api'

async function main(): Promise<void> {
  await soltarTravaDemo(donoTrava())
  console.log('[trava-demo] liberação final concluída')
  await purgarLeftoversDemo()
  // PDCA GE 13/11 (0c3345df/26111304): estanca o vazamento de títulos de teste em erp_receber na DEMO
  // quando o run é cancelado/estoura timeout e o afterAll do spec não roda. Soft-delete por marcador e2e.
  await purgarReceberDemo()
  // PDCA GE 14/11 (0c3345df/26111304): mesmo vazamento em erp_produtos (~20k linhas "E2E *"). Soft-delete.
  await purgarProdutosDemo()
}

void main()
