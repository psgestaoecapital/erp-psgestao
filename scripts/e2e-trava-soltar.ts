// Passo final (always) das aceitações: solta a trava da demo mesmo quando o run foi cancelado/estourou o timeout
// (o global-teardown não roda nesses casos e a lease ficava até 25 min, bloqueando a próxima aceitação sem teste rodado).
// Só solta a trava DESTE run (dono = URL do run); se não for dona, fn_e2e_trava_soltar não apaga nada.
import { donoTrava, soltarTravaDemo } from '../e2e/support/api'

soltarTravaDemo(donoTrava()).then(() => console.log('[trava-demo] liberação final concluída'))
