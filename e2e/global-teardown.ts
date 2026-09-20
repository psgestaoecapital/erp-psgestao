// Revenda R1b · global teardown: devolve a Demonstração Revenda ao seed (fn_demo_reset). A demo pode
// ser mexida à vontade pelas jornadas porque ao fim ela é restaurada.

import { resetarDemo } from './support/api'

export default async function globalTeardown(): Promise<void> {
  try {
    await resetarDemo()
    console.log('[jornadas-revenda] fn_demo_reset ok — demo restaurada ao seed')
  } catch (e) {
    console.error('[jornadas-revenda] fn_demo_reset falhou:', e instanceof Error ? e.message : String(e))
  }
}
