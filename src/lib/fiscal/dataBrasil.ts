// #1944 · data e hora das notas (NF-e, NFC-e e NFS-e) no fuso de Brasília — UMA regra só (RD-71).
// Antes, parte dos envios usava new Date().toISOString() (UTC): nota emitida depois das 21h de Brasília saía com o dia
// seguinte (data de emissão/competência). Aqui o relógio é o de America/Sao_Paulo, com o deslocamento real do fuso
// (Intl), nunca "−3 h" fixo no código.

const FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
})

function partes(d: Date) {
  const p: Record<string, string> = {}
  for (const x of FMT.formatToParts(d)) p[x.type] = x.value
  return p
}

// AAAA-MM-DD do dia em Brasília (data de competência; vigências do dia).
export function dataBrasil(d: Date = new Date()): string {
  const p = partes(d)
  return `${p.year}-${p.month}-${p.day}`
}

// AAAA-MM-DDTHH:MM:SS-03:00 — o mesmo instante, escrito no horário de Brasília com o deslocamento do fuso.
export function isoBrasilia(d: Date = new Date()): string {
  const p = partes(d)
  const local = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second)
  const minutos = Math.round((local - Math.floor(d.getTime() / 1000) * 1000) / 60000)
  const sinal = minutos <= 0 ? '-' : '+'
  const abs = Math.abs(minutos)
  const off = `${sinal}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${off}`
}
