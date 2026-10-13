// Revenda R1b · global teardown: devolve a Demonstração Revenda ao seed (fn_demo_reset). A demo pode
// ser mexida à vontade pelas jornadas porque ao fim ela é restaurada.

import { resetarDemo, soltarTravaDemo } from './support/api'

export default async function globalTeardown(): Promise<void> {
  try {
    await resetarDemo()
    console.log('[jornadas-revenda] fn_demo_reset ok — demo restaurada ao seed')
  } catch (e) {
    console.error('[jornadas-revenda] fn_demo_reset falhou:', e instanceof Error ? e.message : String(e))
  }
  // RD-78 · devolve a trava da demo só DEPOIS do reset (a próxima suíte começa do seed)
  const dono = process.env.JORNADA_TRAVA_DONO
  if (dono) { await soltarTravaDemo(dono); console.log('[trava-demo] solta') }
}
