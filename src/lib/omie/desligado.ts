import { NextResponse } from 'next/server'
export { OMIE_DESLIGADO, OMIE_DESLIGADO_EM, OMIE_DESLIGADO_ROTULO } from './constantes'

/** Resposta única das rotas de integração com o Omie: 410 (o recurso não existe mais). */
export function omieDesligadoResposta(): NextResponse {
  return NextResponse.json(
    { ok: false, desligado: true, erro: 'Integração com o Omie desligada em 02/10/2026 (decisão da PS). O histórico importado continua no sistema.' },
    { status: 410 },
  )
}
