// Protocolo da Open API do rastreador (provider técnico `brasilsat`) — funções PURAS, sem rede, testadas pelo gate
// scripts/gates/check-frota-rastreio-brasilsat.ts (roda em Node/tsx e no Deno da edge).
//
// Auth:     GET /api/authorization?time=<unix s>&account=<conta>&signature=md5(md5(senha) + time)  → record.access_token (2 h)
// Frota:    GET /api/device/list?access_token=…                                                    → record[] (imei, devicename, platenumber…)
// Posição:  GET /api/track?access_token=…&imeis=<até 100, vírgula>                                 → record[] (latitude, longitude, gpstime…)
// Rota:     GET /api/playback?access_token=…&imei=…&begintime=<unix s>&endtime=<unix s>           → record "lng,lat,gpstime,speed,course;…"
//           (até 1000 pontos por chamada; repetir com begintime = último gpstime enquanto vier 1000)

export const BASE_URL = 'https://api.brasilsatgps.com.br'

/** Endereço da API por empresa (família Protrack: BrasilSat e outras marcas com a mesma Open API). Só https; vazio = padrão. */
export function baseUrlDe(cfg: unknown): string {
  const s = String(cfg ?? '').trim().replace(/\/+$/, '')
  return /^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(s) ? s : BASE_URL
}
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

/** mileage/todaymileage vêm em METROS (Open API); -1 = sem dado → km com 3 casas. */
export const metrosParaKm = (v: unknown): number | null => {
  const n = num(v)
  return n === null || n < 0 ? null : Math.round(n) / 1000
}
/** driver vem como objeto {id, name} ({} = sem cartão); aceita texto por compatibilidade. */
export const motoristaDe = (d: unknown): string | null => {
  if (d && typeof d === 'object') {
    const o = d as Record<string, unknown>
    const s = String(o.name ?? o.id ?? '').trim()
    return s || null
  }
  const s = String(d ?? '').trim()
  return s && s !== '[object Object]' ? s : null
}
/** temperature vem como lista de textos em °C ([] = sem sonda); guarda a 1ª sonda. Nunca vira 0 falso. */
export const temperaturaDe = (t: unknown): number | null => {
  const lista = Array.isArray(t) ? t : t === null || t === undefined || t === '' ? [] : [t]
  for (const x of lista) { const n = num(x); if (n !== null) return n }
  return null
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
      odometro: metrosParaKm(r.mileage), km_hoje: metrosParaKm(r.todaymileage), combustivel: num(r.fuel),
      temperatura: temperaturaDe(r.temperature), motorista: motoristaDe(r.driver),
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

// ======================================================================================================
// Cópia diária (D-1), km oficial, alarmes e cercas — pacote Eng. Chefe 27/11 (mapa 'mapa-brasilsat')
// ======================================================================================================
export const FUSO_OFFSET_H = -3   // Brasília (sem horário de verão desde 2019)

/** Início e fim (unix s) do dia local de Brasília. Fim exclusivo. Minuto 0 (exigido pelo /api/device/mileage). */
export function janelaDia(diaIso: string): { ini: number; fim: number } {
  const ini = Math.floor(Date.parse(`${diaIso}T00:00:00Z`) / 1000) - FUSO_OFFSET_H * 3600
  return { ini, fim: ini + 86400 }
}

/** /api/device/mileage → record[{ imei, mileage }] já em km. */
export function converterMileage(record: unknown): { imei: string; km: number }[] {
  const lista = Array.isArray(record) ? record : record && typeof record === 'object' ? [record] : []
  const out: { imei: string; km: number }[] = []
  for (const r of lista as Record<string, unknown>[]) {
    const imei = String(r?.imei ?? '').trim()
    const km = num(r?.mileage)
    if (imei && km !== null && km >= 0) out.push({ imei, km: Math.round(km * 10) / 10 })
  }
  return out
}

// Tipos de alarme da Open API (seção 4.1) em português do usuário.
export const ALARME_NOME: Record<number, string> = {
  1: 'Pânico (SOS)', 2: 'Bateria baixa', 3: 'Energia desligada', 4: 'Vibração', 5: 'Entrou na cerca', 6: 'Saiu da cerca',
  7: 'Excesso de velocidade', 8: 'Veículo em movimento', 9: 'Ignição ligada', 10: 'Ignição desligada',
  11: 'Temperatura do pneu', 12: 'Vazamento no pneu', 13: 'Pneu com pressão baixa', 14: 'Pneu com pressão alta',
  15: 'Entrou em área sem GPS', 16: 'Saiu da área sem GPS', 17: 'Falha do motor (OBD)', 18: 'Rastreador removido',
  19: 'Rastreador desligado', 20: 'Colisão', 21: 'Queda', 22: 'Desvio de rota', 23: 'Aceleração brusca',
  24: 'Freada brusca', 25: 'Curva brusca', 26: 'Porta aberta', 27: 'Porta fechada', 28: 'Sem comunicação',
  29: 'Motor ligado parado (marcha lenta)', 30: 'Parada', 31: 'Vazamento de combustível', 32: 'Furto de combustível',
  33: 'Bloqueador de sinal', 34: 'Direção em horário restrito', 35: 'Temperatura baixa', 36: 'Temperatura alta',
  37: 'Basculante acionado', 38: 'Basculante desligado', 39: 'Alarme armado', 40: 'Capotamento', 41: 'Direção cansativa',
  42: 'Sem descanso (fadiga)', 43: 'Combustível baixo', 44: 'Bateria externa baixa', 45: 'Interferência no GPS',
  46: 'Fim da interferência no GPS', 47: 'Interferência no sinal de celular', 48: 'Fim da interferência no celular',
  49: 'Instalação', 50: 'Umidade baixa', 51: 'Umidade alta',
}
export type Alarme = { imei: string; tipo: number; tipo_nome: string; sistema_em: string; gps_em: string | null
  latitude: number | null; longitude: number | null; velocidade_kmh: number | null; cerca_id: string | null; cerca_nome: string | null; t: number }
export function converterAlarmes(imei: string, record: unknown): Alarme[] {
  const lista = Array.isArray(record) ? record : record && typeof record === 'object' ? [record] : []
  const out: Alarme[] = []
  for (const r of lista as Record<string, unknown>[]) {
    const tipo = num(r?.alarmtype), t = num(r?.systemtime)
    const sis = unixParaIso(r?.systemtime)
    if (tipo === null || !sis || !t) continue
    const lat = num(r.latitude), lng = num(r.longitude)
    const semPos = lat === null || lng === null || (lat === 0 && lng === 0)
    out.push({ imei, tipo, tipo_nome: ALARME_NOME[tipo] ?? `Alarme ${tipo}`, sistema_em: sis, gps_em: unixParaIso(r.gpstime),
      latitude: semPos ? null : lat, longitude: semPos ? null : lng, velocidade_kmh: num(r.speed),
      cerca_id: r.geofenceid != null && String(r.geofenceid) !== '0' ? String(r.geofenceid) : null,
      cerca_nome: String(r.geofencename ?? '').trim() || null, t: t > 1e12 ? Math.floor(t / 1000) : t })
  }
  return out
}

export type Cerca = { cerca_id: string; nome: string | null; tipo: 'circulo' | 'poligono'; centro_lat: number | null
  centro_lng: number | null; raio_m: number | null; poligono: [number, number][] | null; velocidade_max: number | null }
/** /api/geofence/list → record[{ id, name, type (2 círculo · 3 polígono), parameter, speeding }] */
export function converterCercas(record: unknown): Cerca[] {
  const lista = Array.isArray(record) ? record : record && typeof record === 'object' ? [record] : []
  const out: Cerca[] = []
  for (const r of lista as Record<string, unknown>[]) {
    const id = String(r?.id ?? '').trim()
    const tipo = num(r?.type)
    const par = String(r?.parameter ?? '')
    const vel = num(r?.speeding)
    if (!id) continue
    if (tipo === 2) {
      const [lng, lat, raio] = par.split(',').map((x) => num(x.trim()))
      if (lat === null || lng === null || raio === null) continue
      out.push({ cerca_id: id, nome: String(r.name ?? '').trim() || null, tipo: 'circulo', centro_lat: lat, centro_lng: lng, raio_m: raio, poligono: null, velocidade_max: vel || null })
    } else if (tipo === 3) {
      const pts = par.split(';').map((p) => p.split(',').map((x) => num(x.trim()))).filter((p) => p.length >= 2 && p[0] !== null && p[1] !== null) as [number, number][]
      if (pts.length < 3) continue
      out.push({ cerca_id: id, nome: String(r.name ?? '').trim() || null, tipo: 'poligono', centro_lat: null, centro_lng: null, raio_m: null, poligono: pts, velocidade_max: vel || null })
    }
  }
  return out
}

function distM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000, rad = (g: number) => (g * Math.PI) / 180
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Nome da cerca que contém o ponto (círculo pelo raio; polígono por ray casting) ou null. */
export function cercaDoPonto(p: { lat: number; lng: number }, cercas: Cerca[]): string | null {
  for (const c of cercas) {
    if (c.tipo === 'circulo' && c.centro_lat !== null && c.centro_lng !== null && c.raio_m !== null) {
      if (distM(p, { lat: c.centro_lat, lng: c.centro_lng }) <= c.raio_m) return c.nome ?? c.cerca_id
    } else if (c.tipo === 'poligono' && c.poligono) {
      let dentro = false
      const pol = c.poligono
      for (let i = 0, j = pol.length - 1; i < pol.length; j = i++) {
        const [xi, yi] = pol[i], [xj, yj] = pol[j]
        if (((yi > p.lat) !== (yj > p.lat)) && (p.lng < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi)) dentro = !dentro
      }
      if (dentro) return c.nome ?? c.cerca_id
    }
  }
  return null
}

// Regras de derivação (calculadas por nós: os rótulos de "excesso"/"parado" da plataforma não são confiáveis)
export const PARADA_MIN_MIN = 5          // parada = 5 min ou mais sem sair do lugar
export const PARADO_VEL_KMH = 3          // até 3 km/h conta como parado
export const LACUNA_MIN = 10             // sem ponto por 10 min ou mais e quase sem deslocamento = parado (rastreador dorme com ignição desligada)
export const LACUNA_DIST_M = 300
export const VIAGEM_MIN_KM = 0.5

export type Parada = { inicio: number; fim: number; duracao_min: number; lat: number; lng: number }
export type Viagem = { inicio: number; fim: number; km: number; duracao_min: number; velocidade_max: number
  origem: { lat: number; lng: number }; destino: { lat: number; lng: number } }

/** Separa a rota de um dia em paradas e viagens. Pontos em qualquer ordem; devolve em ordem de tempo. */
export function derivarViagensParadas(pontosIn: PontoRota[]): { paradas: Parada[]; viagens: Viagem[] } {
  const pts = [...pontosIn].sort((a, b) => a.t - b.t)
  const paradas: Parada[] = []
  const viagens: Viagem[] = []
  if (pts.length < 2) return { paradas, viagens }

  // 1) marca cada intervalo [i-1, i] como "parado" ou "andando"
  //    parado: velocidade dos dois pontos ≤ 3 km/h, ou lacuna longa sem deslocamento
  const intervaloParado: boolean[] = []
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i]
    const lento = (a.velocidade ?? 0) <= PARADO_VEL_KMH && (b.velocidade ?? 0) <= PARADO_VEL_KMH && distM(a, b) < LACUNA_DIST_M
    const lacuna = b.t - a.t >= LACUNA_MIN * 60 && distM(a, b) < LACUNA_DIST_M
    intervaloParado.push(lento || lacuna)
  }

  // 2) blocos contínuos de intervalos parados ≥ 5 min viram parada; o resto, trechos de movimento
  type Bloco = { parado: boolean; i0: number; i1: number }   // índices de pontos (inclusivos)
  const blocos: Bloco[] = []
  for (let k = 0; k < intervaloParado.length; k++) {
    const parado = intervaloParado[k]
    const ult = blocos[blocos.length - 1]
    if (ult && ult.parado === parado) ult.i1 = k + 1
    else blocos.push({ parado, i0: k, i1: k + 1 })
  }
  // parado curto (< 5 min: semáforo, fila) volta a ser movimento
  for (const b of blocos) if (b.parado && pts[b.i1].t - pts[b.i0].t < PARADA_MIN_MIN * 60) b.parado = false
  // junta vizinhos iguais
  const juntos: Bloco[] = []
  for (const b of blocos) {
    const ult = juntos[juntos.length - 1]
    if (ult && ult.parado === b.parado) ult.i1 = b.i1
    else juntos.push({ ...b })
  }

  for (const b of juntos) {
    const a = pts[b.i0], z = pts[b.i1]
    if (b.parado) {
      paradas.push({ inicio: a.t, fim: z.t, duracao_min: Math.round((z.t - a.t) / 6) / 10, lat: a.lat, lng: a.lng })
    } else {
      const trecho = pts.slice(b.i0, b.i1 + 1)
      const km = distanciaKm(trecho)
      if (km < VIAGEM_MIN_KM) continue
      viagens.push({ inicio: a.t, fim: z.t, km, duracao_min: Math.round((z.t - a.t) / 6) / 10,
        velocidade_max: trecho.reduce((m, p) => Math.max(m, p.velocidade ?? 0), 0),
        origem: { lat: a.lat, lng: a.lng }, destino: { lat: z.lat, lng: z.lng } })
    }
  }
  return { paradas, viagens }
}
