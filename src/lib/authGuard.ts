/**
 * authGuard.ts — PS Gestão v1.3
 * Helpers de resposta HTTP para proteção de rotas.
 * Sem dependências externas.
 */
import { NextResponse } from 'next/server'

export function unauthorizedResponse(message = 'Não autorizado') {
  return NextResponse.json({ error: message }, { status: 401 })
}

export function forbiddenResponse(message = 'Acesso negado') {
  return NextResponse.json({ error: message }, { status: 403 })
}

export function badRequestResponse(message = 'Parâmetros inválidos') {
  return NextResponse.json({ error: message }, { status: 400 })
}

export function serverErrorResponse(message = 'Erro interno do servidor') {
  return NextResponse.json({ error: message }, { status: 500 })
}
