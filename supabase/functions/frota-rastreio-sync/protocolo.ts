// Protocolo da Open API do rastreador (provider técnico `brasilsat`) — funções PURAS, sem rede, testadas pelo gate
// scripts/gates/check-frota-rastreio-brasilsat.ts (roda em Node/tsx e no Deno da edge).
//
// Auth:     GET /api/authorization?time=<unix s>&account=<conta>&signature=md5(md5(senha) + time)  → record.access_token (2 h)
// Frota:    GET /api/device/list?access_token=…                                                    → record[] (imei, devicename, platenumber…)
// Posição:  GET /api/track?access_token=…&imeis=<até 100, vírgula>                                 → record[] (latitude, longitude, gpstime…)
// Rota:     GET /api/playback?access_token=…&imei=…&begintime=<unix s>&endtime=<unix s>           → record "lng,lat,gpstime,speed,course;…"
//           (até 1000 pontos por chamada; repetir com begintime = último gpstime enquanto vier 1000)

export const BASE_URL = 'https://api.brasilsatgps.com.br'
export const IMEIS_POR_CHAMADA = 100
export const PLAYBACK_PONTOS_POR_PAGINA = 1000

// ---------- MD5 (RFC 1321), sem dependência ----------
function md5Bytes(input: Uint8Array): Uint8Array {
  const s = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21]
  const K = new Uint32Array(64)
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0
  const len = input.length
  const nBlocos = ((len + 8) >>> 6) + 1
  const buf = new Uint8Array(nBlocos * 64)
  buf.set(input)
  buf[len] = 0x80
  const bits = len * 8
  const dv = new DataView(buf.buffer)
  dv.setUint32(buf.length - 8, bits >>> 0, true)
  dv.setUint32(buf.length - 4, Math.floor(bits / 2 ** 32) >>> 0, true)
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476
  for (let off = 0; off < buf.length; off += 64) {
    const M = new Uint32Array(16)
    for (let j = 0; j < 16; j++) M[j] = dv.getUint32(off + j * 4, true)
    let A = a0, B = b0, C = c0, D = d0
    for (let i = 0; i < 64; i++) {
      let F: number, g: number
      if (i < 16) { F = (B & C) | (~B & D); g = i }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16 }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16 }
      else { F = C ^ (B | ~D); g = (7 * i) % 16 }
      F = (F + A + K[i] + M[g]) >>> 0
      A = D; D = C; C = B
      B = (B + ((F << s[i]) | (F >>> (32 - s[i])))) >>> 0
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0
  }
  const out = new Uint8Array(16)
  const odv = new DataView(out.buffer)
  odv.setUint32(0, a0, true); odv.setUint32(4, b0, true); odv.setUint32(8, c0, true); odv.setUint32(12, d0, true)
  return out
}

export function md5Hex(texto: string): string {
  return Array.from(md5Bytes(new TextEncoder().encode(texto)), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** signature = md5(md5(senha) + time), 32 hex minúsculos. */
export function assinatura(senha: string, time: number): string {
  return md5Hex(md5Hex(senha) + String(time))
}

// ---------- erros da API → texto do usuário (nunca erro cru) ----------
export const CODIGOS_TOKEN = new Set([10002, 10003, 10010, 10011, 10012])
const MSG: Record<number, string> = {
  20001: 'O rastreador recusou a conta ou a senha. Confira a credencial em Conectores › Logística.',
  10016: 'A conta do rastreador está bloqueada. Fale com o fornecedor do rastreamento.',
  10007: 'A conta do rastreador não tem permissão para esta consulta.',
  10009: 'O rastreador pediu um intervalo maior entre as consultas. A próxima leitura tenta de novo.',
  10013: 'Algum equipamento não está liberado para esta conta no rastreador.',
  10014: 'O rastreador recusou o horário da consulta. A próxima leitura tenta de novo.',
  20023: 'O rastreador não devolveu dados para o período.',
}
export function mensagemErro(codigo: number | null | undefined): string {
  if (codigo != null && MSG[codigo]) return MSG[codigo]
  if (codigo != null && CODIGOS_TOKEN.has(codigo)) return 'A sessão com o rastreador expirou. A próxima leitura entra de novo.'
  return 'O rastreador não respondeu como esperado. A próxima leitura tenta de novo.'
}
export function ehErroDeAutenticacao(codigo: number | null | undefined): boolean {
  return codigo === 20001 || codigo === 10016
}

// ---------- conversões ----------
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const unixParaIso = (v: unknown): string | null => {
  const n = num(v)
  if (!n || n <= 0) return null
  return new Date((n > 1e12 ? n : n * 1000)).toISOString()   // aceita segundos ou milissegundos
}

export type Dispositivo = { imei: string; nome: string | null; placa: string | null; tipo: string | null; ativado_em: string | null; vence_em: string | null }
export function converterDispositivos(record: unknown): Dispositivo[] {
  const lista = Array.isArray(record) ? record : record && typeof record === 'object' ? [record] : []
  const out: Dispositivo[] = []
  for (const r of lista as Record<string, unknown>[]) {
    const imei = String(r?.imei ?? '').trim()
    if (!imei) continue
    const txt = (v: unknown) => { const s = String(v ?? '').trim(); return s || null }
    out.push({ imei, nome: txt(r.devicename), placa: txt(r.platenumber), tipo: txt(r.devicetype),
      ativado_em: unixParaIso(r.activatedtime), vence_em: unixParaIso(r.platformduetime ?? r.userduetime) })
  }
  return out
}

export type Posicao = {
  imei: string; gps_em: string; servidor_em: string | null; latitude: number; longitude: number
  velocidade_kmh: number | null; curso: number | null; ignicao: boolean | null; odometro: number | null
  km_hoje: number | null; combustivel: number | null; temperatura: number | null; motorista: string | null
}
export function converterPosicoes(record: unknown): Posicao[] {
  const lista = Array.isArray(record) ? record : record && typeof record === 'object' ? [record] : []
  const out: Posicao[] = []
  for (const r of lista as Record<string, unknown>[]) {
    const imei = String(r?.imei ?? '').trim()
    const lat = num(r?.latitude), lng = num(r?.longitude)
    const gps = unixParaIso(r?.gpstime)
    // sem fixo de GPS (0,0) ou sem hora → não é posição
    if (!imei || lat === null || lng === null || !gps || (lat === 0 && lng === 0)) continue
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) continue
    const acc = num(r.accstatus)
    out.push({
      imei, gps_em: gps, servidor_em: unixParaIso(r.servertime), latitude: lat, longitude: lng,
      velocidade_kmh: num(r.speed), curso: num(r.course), ignicao: acc === 1 ? true : acc === 0 ? false : null,
      odometro: num(r.mileage), km_hoje: num(r.todaymileage), combustivel: num(r.fuel), temperatura: num(r.temperature),
      motorista: String(r.driver ?? '').trim() || null,
    })
  }
  return out
}

export type PontoRota = { lat: number; lng: number; em: string; velocidade: number | null; curso: number | null; t: number }
/** record do playback: "lng,lat,gpstime,speed,course;lng,lat,…" */
export function converterPlayback(record: unknown): PontoRota[] {
  const s = typeof record === 'string' ? record : ''
  const out: PontoRota[] = []
  for (const parte of s.split(';')) {
    const [lng, lat, t, vel, cur] = parte.split(',').map((x) => x.trim())
    const nLat = num(lat), nLng = num(lng), nT = num(t)
    if (nLat === null || nLng === null || !nT || (nLat === 0 && nLng === 0)) continue
    out.push({ lat: nLat, lng: nLng, t: nT, em: new Date(nT * 1000).toISOString(), velocidade: num(vel), curso: num(cur) })
  }
  return out
}

export function distanciaKm(pts: { lat: number; lng: number }[]): number {
  const R = 6371, rad = (g: number) => (g * Math.PI) / 180
  let km = 0
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i]
    const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng)
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
    km += 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
  }
  return Math.round(km * 10) / 10
}

export function lotes<T>(xs: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n))
  return out
}
