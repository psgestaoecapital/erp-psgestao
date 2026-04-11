/**
 * authGuard.ts — helpers para proteção de rotas e roles
 */

export function unauthorizedResponse(message = 'Não autorizado') {
  return new Response(JSON.stringify({ error: message }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' }
  })
}

export function forbiddenResponse(message = 'Acesso negado') {
  return new Response(JSON.stringify({ error: message }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' }
  })
}

export function badRequestResponse(message = 'Parâmetros inválidos') {
  return new Response(JSON.stringify({ error: message }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' }
  })
}
