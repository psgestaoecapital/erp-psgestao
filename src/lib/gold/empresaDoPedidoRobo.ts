// Empresa que o robô (screen-watcher/playwright) deve usar num pedido — regra pura, testável no gate.
// CEO 01/10 (auditoria do Hub): o disparo do banco (fn_auditor_disparar) manda só { rota } com
// "?company_id=<demo>" dentro da rota — sem empresa_id no corpo. A rota ficava com empresa vazia, caía no 403
// "só demonstração" e o run ficava "pending" para sempre. Agora: corpo primeiro; senão, o company_id/empresa_id
// da(s) rota(s). Num lote, todas as rotas têm de apontar a MESMA empresa — se divergirem, devolve '' (fail-closed:
// a checagem is_demo seguinte recusa). Esta função NÃO libera nada: quem decide é empresaPermitidaParaRobo.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function empresaDaRota(rota: string): string {
  const q = rota.split('#')[0].split('?')[1]
  if (!q) return ''
  const p = new URLSearchParams(q)
  return (p.get('company_id') || p.get('empresa_id') || '').trim()
}

export function empresaDoPedidoRobo(empresaCorpo: string | undefined | null, rotas: string[]): string {
  const doCorpo = (empresaCorpo || '').trim()
  if (doCorpo) return doCorpo
  const achadas = new Set(rotas.map(empresaDaRota).filter(Boolean))
  if (achadas.size !== 1) return ''
  const [unica] = [...achadas]
  return UUID.test(unica) ? unica : ''
}

// Eng. Chefe 17/10 (PDCA do Hub): quando o pedido do robô não traz empresa (fn_auditor_disparar manda só { rota }),
// o watcher resolve a empresa de DEMONSTRAÇÃO da ÁREA da rota (2º segmento de /dashboard/<area>/...) via
// demo_por_area. Esta função só devolve a área; a empresa (e o is_demo) é conferida no banco pelo watcher.
// Num lote, todas as rotas têm de apontar a MESMA área — se divergirem, devolve '' (fail-closed).
export function areaDaRotaRobo(rotas: string[]): string {
  const areas = new Set(
    rotas
      .map((r) => (r || '').split('#')[0].split('?')[0].replace(/^\/+/, '').split('/')[1] || '')
      .filter(Boolean),
  )
  if (areas.size !== 1) return ''
  return [...areas][0]
}
