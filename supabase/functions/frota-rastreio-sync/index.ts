// Rastreamento de frota — sincronizador do rastreador (provider técnico `brasilsat`) · SPEC 27/11 PARTE E.
//
// Modos (POST JSON):
//   { origem: 'cron' }                                   → só conexão de serviço (fn_frota_rastreio_dispatch, a cada
//                                                          5 min). Sincroniza as empresas devidas pela SUA cadência
//                                                          (frota_rastreio_config.cadencia_min, default provisório 10).
//   { modo: 'sync', company_id }                         → usuário logado com a empresa ("Atualizar agora"; 1×/min).
//   { origem: 'cron', modo: 'diario' }                   → só serviço (fn_frota_rastreio_dispatch_diario, 04h–09h):
//                                                          cópia D-1 por veículo × dia (rota, km oficial, viagens,
//                                                          paradas), cercas da conta e limpeza do bruto > 90 dias.
//   { modo: 'playback', company_id, imei, inicio, fim }  → usuário logado; rota histórica SOB DEMANDA, só com
//                                                          frota_rastreio_config.playback_habilitado = true (HISTÓRICO
//                                                          pendente do CEO: desligado por padrão). Não grava nada.
//
// Credencial: conta + senha no Cofre (erp_credencial provider 'brasilsat', chaves 'account' e 'senha', escopo
// empresa; cadastradas pela tela de Conectores). Lidas por fn_credencial_ler (service_role). A senha NUNCA é logada
// nem devolvida. Erros da API viram texto do usuário (protocolo.ts › mensagemErro), nunca erro cru.
// NÃO toca atak_conexao_config, erp_credencial (só lê), erp_sync_log nem o ETL.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2"
import { corsHeaders } from "../_shared/cors.ts"
import {
  BASE_URL, baseUrlDe, IMEIS_POR_CHAMADA, PLAYBACK_PONTOS_POR_PAGINA, CODIGOS_TOKEN,
  assinatura, mensagemErro, ehErroDeAutenticacao, converterDispositivos, converterPosicoes, converterPlayback,
  distanciaKm, lotes, janelaDia, converterMileage, converterAlarmes, converterCercas, cercaDoPonto,
  derivarViagensParadas, type Cerca, type PontoRota,
} from "./protocolo.ts"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

const PLAYBACK_MAX_DIAS = 3
const PLAYBACK_MAX_PAGINAS = 10
const SYNC_MANUAL_MIN_INTERVALO_MS = 60_000
const TIMEOUT_MS = 20_000

function respond(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } })
}

class ErroApi extends Error {
  constructor(public codigo: number | null, public amigavel: string) { super(amigavel) }
}

// Endereço da API da empresa em processamento (frota_rastreio_config.api_base_url; vazio = BASE_URL).
// A edge processa uma empresa por vez, então a variável do módulo é trocada no início de cada uma.
let apiBase = BASE_URL
async function usarApiDaEmpresa(companyId: string) {
  const { data } = await admin.from("frota_rastreio_config").select("api_base_url").eq("company_id", companyId).maybeSingle()
  apiBase = baseUrlDe((data as { api_base_url?: string | null } | null)?.api_base_url)
}

async function chamar(path: string, params: Record<string, string | number>): Promise<unknown> {
  const url = new URL(path, apiBase)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v))
  let res: Response
  try {
    res = await fetch(url, { method: "GET", headers: { accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch {
    throw new ErroApi(null, "Não foi possível falar com o rastreador agora (sem resposta). A próxima leitura tenta de novo.")
  }
  let j: { code?: number; record?: unknown } | null = null
  try { j = await res.json() } catch { /* corpo não-JSON */ }
  if (!res.ok || !j) throw new ErroApi(null, mensagemErro(null))
  const code = Number(j.code ?? -1)
  if (code !== 0) throw new ErroApi(code, mensagemErro(code))
  return j.record
}

async function lerCredencial(companyId: string): Promise<{ account: string; senha: string } | null> {
  const ler = async (chave: string) => {
    const { data, error } = await admin.rpc("fn_credencial_ler", {
      p_provider: "brasilsat", p_chave: chave, p_escopo: "empresa", p_company_id: companyId,
    })
    return error ? null : ((data as string | null) ?? null)
  }
  const account = (await ler("account"))?.trim()
  const senha = await ler("senha")
  return account && senha ? { account, senha } : null
}

async function autenticarNovo(companyId: string, cred: { account: string; senha: string }): Promise<string> {
  const time = Math.floor(Date.now() / 1000)
  const rec = await chamar("/api/authorization", { account: cred.account, time, signature: assinatura(cred.senha, time) }) as
    { access_token?: string; expires_in?: number } | null
  if (!rec?.access_token) throw new ErroApi(null, mensagemErro(null))
  // Token único por conta: um novo derruba o anterior → guarda no Vault e reaproveita (fn_frota_rastreio_token_*).
  const expira = new Date(Date.now() + Math.max(600, Number(rec.expires_in ?? 7200)) * 1000).toISOString()
  await admin.rpc("fn_frota_rastreio_token_gravar", { p_company_id: companyId, p_token: rec.access_token, p_expira_em: expira })
  return rec.access_token
}

/** Sessão com o rastreador: reaproveita o token guardado; se a API disser que expirou, entra de novo UMA vez. */
async function sessao(companyId: string, cred: { account: string; senha: string }) {
  const { data: guardado } = await admin.rpc("fn_frota_rastreio_token_ler", { p_company_id: companyId })
  let token = (guardado as string | null) || await autenticarNovo(companyId, cred)
  return async (path: string, params: Record<string, string | number>) => {
    try { return await chamar(path, { access_token: token, ...params }) }
    catch (e) {
      if (e instanceof ErroApi && e.codigo !== null && CODIGOS_TOKEN.has(e.codigo)) {
        token = await autenticarNovo(companyId, cred)
        return await chamar(path, { access_token: token, ...params })
      }
      throw e
    }
  }
}

async function gravarStatus(companyId: string, patch: Record<string, unknown>) {
  const agora = new Date().toISOString()
  await admin.from("frota_rastreio_config")
    .upsert({ company_id: companyId, ultima_sync_em: agora, atualizado_em: agora, ...patch }, { onConflict: "company_id" })
}

type ResultadoSync = { company_id: string; ok: boolean; veiculos?: number; posicoes?: number; alarmes?: number; status: string; erro?: string }

async function sincronizarEmpresa(companyId: string): Promise<ResultadoSync> {
  await usarApiDaEmpresa(companyId)
  const cred = await lerCredencial(companyId)
  if (!cred) {
    await gravarStatus(companyId, { ultimo_status: "sem_credencial", ultimo_erro: "Conta e senha do rastreador ainda não cadastradas." })
    return { company_id: companyId, ok: false, status: "sem_credencial" }
  }
  try {
    const comToken = await sessao(companyId, cred)

    const disp = converterDispositivos(await comToken("/api/device/list", {}))
    const agora = new Date().toISOString()
    if (disp.length) {
      const { error } = await admin.from("frota_rastreio_dispositivo")
        .upsert(disp.map((d) => ({ company_id: companyId, ...d, visto_em: agora })), { onConflict: "company_id,imei" })
      if (error) throw new ErroApi(null, "Falha ao gravar a frota lida do rastreador.")
    }

    let posicoes = 0
    for (const lote of lotes(disp.map((d) => d.imei), IMEIS_POR_CHAMADA)) {
      const pos = converterPosicoes(await comToken("/api/track", { imeis: lote.join(",") }))
      if (!pos.length) continue
      const { error } = await admin.from("frota_rastreio_posicao")
        .upsert(pos.map((p) => ({ company_id: companyId, ...p })), { onConflict: "company_id,imei,gps_em", ignoreDuplicates: true })
      if (error) throw new ErroApi(null, "Falha ao gravar as posições lidas do rastreador.")
      posicoes += pos.length
    }

    // Alarmes desde a última leitura (por equipamento; até 100 por chamada, pagina pelo systemtime)
    const marcaAlarme = Math.floor(Date.now() / 1000)
    const { data: cfgRow } = await admin.from("frota_rastreio_config").select("ultimo_alarme_em").eq("company_id", companyId).maybeSingle()
    const desdeAlarme = Math.max(
      marcaAlarme - 86400,
      cfgRow?.ultimo_alarme_em ? Math.floor(Date.parse(cfgRow.ultimo_alarme_em) / 1000) - 300 : marcaAlarme - 86400)
    let alarmes = 0
    for (const d of disp) {
      let desde = desdeAlarme
      for (let pagina = 0; pagina < 5; pagina++) {
        const lote = converterAlarmes(d.imei, await comToken("/api/alarm/list2", { imei: d.imei, begintime: desde, endtime: marcaAlarme }))
        if (lote.length) {
          await admin.from("frota_alarme").upsert(lote.map(({ t: _t, ...a }) => ({ company_id: companyId, ...a })),
            { onConflict: "company_id,imei,tipo,sistema_em", ignoreDuplicates: true })
          alarmes += lote.length
        }
        if (lote.length < 100) break
        desde = lote[lote.length - 1].t
      }
    }

    await gravarStatus(companyId, {
      ultimo_status: "ok", ultimo_erro: null, ultima_sync_ok_em: new Date().toISOString(),
      veiculos: disp.length, posicoes_ultima: posicoes, ultimo_alarme_em: new Date(marcaAlarme * 1000).toISOString(),
    })
    return { company_id: companyId, ok: true, status: "ok", veiculos: disp.length, posicoes, alarmes }
  } catch (e) {
    const codigo = e instanceof ErroApi ? e.codigo : null
    const msg = e instanceof ErroApi ? e.amigavel : mensagemErro(null)
    const status = ehErroDeAutenticacao(codigo) ? "erro_autenticacao" : "erro"
    await gravarStatus(companyId, { ultimo_status: status, ultimo_erro: msg })
    console.warn(`frota-rastreio-sync: empresa ${companyId} status=${status} codigo=${codigo ?? "-"}`)
    return { company_id: companyId, ok: false, status, erro: msg }
  }
}

async function playback(companyId: string, imei: string, inicioIso: string, fimIso: string) {
  const ini = Math.floor(Date.parse(inicioIso) / 1000), fim = Math.floor(Date.parse(fimIso) / 1000)
  if (!Number.isFinite(ini) || !Number.isFinite(fim) || fim <= ini) return respond(400, { ok: false, erro: "Informe um período válido: o fim precisa ser depois do início." })
  if (fim - ini > PLAYBACK_MAX_DIAS * 86400) return respond(400, { ok: false, erro: `Escolha no máximo ${PLAYBACK_MAX_DIAS} dias por consulta.` })

  const { data: d } = await admin.from("frota_rastreio_dispositivo").select("imei").eq("company_id", companyId).eq("imei", imei).maybeSingle()
  if (!d) return respond(404, { ok: false, erro: "Veículo não encontrado na frota rastreada desta empresa." })

  await usarApiDaEmpresa(companyId)
  const cred = await lerCredencial(companyId)
  if (!cred) return respond(200, { ok: false, erro: "Conta e senha do rastreador ainda não cadastradas." })
  try {
    const comToken = await sessao(companyId, cred)
    const pontos = await baixarRota(comToken, imei, ini, fim, PLAYBACK_MAX_PAGINAS)
    const vmax = pontos.reduce((m, p) => Math.max(m, p.velocidade ?? 0), 0)
    return respond(200, {
      ok: true, imei, pontos: pontos.map(({ lat, lng, em, velocidade }) => ({ lat, lng, em, velocidade })),
      resumo: { pontos: pontos.length, distancia_km: distanciaKm(pontos), velocidade_max: vmax, inicio: pontos[0]?.em ?? null, fim: pontos.at(-1)?.em ?? null },
    })
  } catch (e) {
    const msg = e instanceof ErroApi ? e.amigavel : mensagemErro(null)
    return respond(200, { ok: false, erro: msg })
  }
}

type ComToken = (path: string, params: Record<string, string | number>) => Promise<unknown>

async function baixarRota(comToken: ComToken, imei: string, ini: number, fim: number, maxPaginas: number): Promise<PontoRota[]> {
  const pontos: PontoRota[] = []
  let desde = ini
  for (let pagina = 0; pagina < maxPaginas; pagina++) {
    const lote = converterPlayback(await comToken("/api/playback", { imei, begintime: desde, endtime: fim }))
    const novos = lote.filter((p) => !pontos.length || p.t > pontos[pontos.length - 1].t)
    pontos.push(...novos)
    if (lote.length < PLAYBACK_PONTOS_POR_PAGINA || !novos.length) break
    desde = pontos[pontos.length - 1].t
  }
  return pontos
}

const ISO = (t: number) => new Date(t * 1000).toISOString()
const DIARIO_ORCAMENTO_MS = 110_000            // cabe na janela da edge; o cron da hora seguinte continua
const DIARIO_MAX_PAGINAS = 40                  // até 40 mil pontos por veículo/dia

async function cercasDaEmpresa(companyId: string, account: string, comToken: ComToken): Promise<Cerca[]> {
  const { data: cfg } = await admin.from("frota_rastreio_config").select("cercas_em").eq("company_id", companyId).maybeSingle()
  const velha = !cfg?.cercas_em || Date.now() - Date.parse(cfg.cercas_em) > 20 * 3600 * 1000
  if (velha) {
    const todas: Cerca[] = []
    for (let pagina = 1; pagina <= 20; pagina++) {
      const lote = converterCercas(await comToken("/api/geofence/list", { account, pagenumber: pagina, pagesize: 100 }))
      todas.push(...lote)
      if (lote.length < 100) break
    }
    if (todas.length) {
      const agora = new Date().toISOString()
      await admin.from("frota_cerca").upsert(todas.map((c) => ({ company_id: companyId, ...c, origem: "rastreador", visto_em: agora })),
        { onConflict: "company_id,cerca_id" })
    }
    await admin.from("frota_rastreio_config").update({ cercas_em: new Date().toISOString() }).eq("company_id", companyId)
  }
  const { data } = await admin.from("frota_cerca").select("cerca_id,nome,tipo,centro_lat,centro_lng,raio_m,poligono,velocidade_max").eq("company_id", companyId)
  return ((data ?? []) as Cerca[]).map((c) => ({ ...c,
    centro_lat: c.centro_lat === null ? null : Number(c.centro_lat), centro_lng: c.centro_lng === null ? null : Number(c.centro_lng),
    raio_m: c.raio_m === null ? null : Number(c.raio_m) }))
}

/** Copia um veículo × dia: rota (bruto), km oficial, viagens e paradas. Idempotente (refaz o dia inteiro). */
async function copiarDia(companyId: string, imei: string, dia: string, comToken: ComToken, cercas: Cerca[]) {
  const { ini, fim } = janelaDia(dia)
  const pontos = await baixarRota(comToken, imei, ini, fim, DIARIO_MAX_PAGINAS)
  const kmRec = converterMileage(await comToken("/api/device/mileage", { imeis: imei, begintime: ini, endtime: fim }))
  const kmOficial = kmRec.find((k) => k.imei === imei)?.km ?? null

  for (const lote of lotes(pontos, 1000)) {
    const { error } = await admin.from("frota_rastreio_ponto").upsert(lote.map((p) => ({
      company_id: companyId, imei, gps_em: p.em, latitude: p.lat, longitude: p.lng, velocidade_kmh: p.velocidade, curso: p.curso,
    })), { onConflict: "company_id,imei,gps_em", ignoreDuplicates: true })
    if (error) throw new ErroApi(null, "Falha ao gravar a rota copiada do rastreador.")
  }
  if (kmOficial !== null) {
    await admin.from("frota_km_dia").upsert({ company_id: companyId, imei, dia, km: kmOficial, atualizado_em: new Date().toISOString() },
      { onConflict: "company_id,imei,dia" })
  }

  const { paradas, viagens } = derivarViagensParadas(pontos)
  await admin.from("frota_viagem").delete().eq("company_id", companyId).eq("imei", imei).eq("dia", dia)
  await admin.from("frota_parada").delete().eq("company_id", companyId).eq("imei", imei).eq("dia", dia)
  if (viagens.length) {
    await admin.from("frota_viagem").insert(viagens.map((v) => ({
      company_id: companyId, imei, dia, inicio: ISO(v.inicio), fim: ISO(v.fim), km: v.km, duracao_min: v.duracao_min,
      velocidade_max: v.velocidade_max, origem_lat: v.origem.lat, origem_lng: v.origem.lng, destino_lat: v.destino.lat,
      destino_lng: v.destino.lng, origem_cerca: cercaDoPonto(v.origem, cercas), destino_cerca: cercaDoPonto(v.destino, cercas),
    })))
  }
  if (paradas.length) {
    await admin.from("frota_parada").insert(paradas.map((p) => ({
      company_id: companyId, imei, dia, inicio: ISO(p.inicio), fim: ISO(p.fim), duracao_min: p.duracao_min,
      latitude: p.lat, longitude: p.lng, cerca: cercaDoPonto(p, cercas),
    })))
  }
  return { pontos: pontos.length, viagens: viagens.length, paradas: paradas.length, km: kmOficial }
}

async function rodarDiario() {
  const t0 = Date.now()
  const { data, error } = await admin.rpc("fn_frota_rastreio_copias_pendentes", { p_limite: 500 })
  if (error) return { ok: false, erro: "falha_ao_listar_pendencias" }
  const pend = (data ?? []) as { company_id: string; imei: string; dia: string }[]
  const sessoes = new Map<string, { comToken: ComToken; cercas: Cerca[]; base: string } | null>()
  let feitos = 0, erros = 0
  for (const p of pend) {
    if (Date.now() - t0 > DIARIO_ORCAMENTO_MS) break
    if (!sessoes.has(p.company_id)) {
      await usarApiDaEmpresa(p.company_id)
      const cred = await lerCredencial(p.company_id)
      if (!cred) { sessoes.set(p.company_id, null); continue }
      try {
        const comToken = await sessao(p.company_id, cred)
        const cercas = await cercasDaEmpresa(p.company_id, cred.account, comToken).catch(() => [] as Cerca[])
        sessoes.set(p.company_id, { comToken, cercas, base: apiBase })
      } catch { sessoes.set(p.company_id, null) }
    }
    const s = sessoes.get(p.company_id)
    if (!s) continue
    apiBase = s.base   // a lista de pendências pode alternar empresas: volta ao endereço da API desta
    const { data: ant } = await admin.from("frota_copia_dia").select("tentativas").eq("company_id", p.company_id).eq("imei", p.imei).eq("dia", p.dia).maybeSingle()
    try {
      const r = await copiarDia(p.company_id, p.imei, p.dia, s.comToken, s.cercas)
      await admin.from("frota_copia_dia").upsert({ company_id: p.company_id, imei: p.imei, dia: p.dia,
        status: r.pontos || r.km ? "ok" : "sem_dado", pontos: r.pontos, viagens: r.viagens, paradas: r.paradas, km: r.km,
        erro: null, tentativas: (ant?.tentativas ?? 0) + 1, em: new Date().toISOString() }, { onConflict: "company_id,imei,dia" })
      feitos++
    } catch (e) {
      const sem = e instanceof ErroApi && e.codigo === 20023
      await admin.from("frota_copia_dia").upsert({ company_id: p.company_id, imei: p.imei, dia: p.dia,
        status: sem ? "sem_dado" : "erro", erro: e instanceof ErroApi ? e.amigavel : mensagemErro(null),
        tentativas: (ant?.tentativas ?? 0) + 1, em: new Date().toISOString() }, { onConflict: "company_id,imei,dia" })
      if (!sem) erros++
    }
  }
  for (const [companyId, s] of sessoes) {
    if (s) await admin.from("frota_rastreio_config").update({ ultima_copia_em: new Date().toISOString() }).eq("company_id", companyId)
  }
  const purga = await admin.rpc("fn_frota_rastreio_purgar")
  return { ok: true, pendentes: pend.length, feitos, erros, purga: purga.data ?? null }
}

function papelDoToken(authHeader: string): string | null {
  try {
    const payload = authHeader.replace(/^Bearer\s+/i, "").split(".")[1]
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")))
    return typeof json.role === "string" ? json.role : null
  } catch { return null }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "POST") return respond(405, { ok: false, erro: "metodo_nao_permitido" })

  const auth = req.headers.get("Authorization") ?? ""
  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { /* vazio */ }
  const ehServico = auth === `Bearer ${SERVICE_KEY}` || papelDoToken(auth) === "service_role"

  // ---- agenda (cron) ----
  if (body.origem === "cron") {
    if (!ehServico) return respond(403, { ok: false, erro: "somente_servico" })
    if (body.modo === "diario") return respond(200, await rodarDiario())
    const { data, error } = await admin.rpc("fn_frota_rastreio_empresas_devidas")
    if (error) return respond(500, { ok: false, erro: "falha_ao_listar_empresas" })
    const resultados: ResultadoSync[] = []
    for (const r of (data ?? []) as { company_id: string }[]) resultados.push(await sincronizarEmpresa(r.company_id))
    return respond(200, { ok: true, empresas: resultados.length, resultados })
  }

  // ---- usuário logado: confere acesso à empresa COMO o usuário ----
  const companyId = String(body.company_id ?? "")
  if (!/^[0-9a-f-]{36}$/i.test(companyId)) return respond(400, { ok: false, erro: "Escolha uma empresa." })
  const user = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false }, global: { headers: { Authorization: auth } } })
  const { data: acesso } = await user.rpc("fn_frota_rastreio_acesso", { p_company_id: companyId })
  const a = acesso as { acesso?: boolean; playback_habilitado?: boolean; ultima_sync_em?: string | null } | null
  if (!a?.acesso) return respond(403, { ok: false, erro: "Sem acesso a esta empresa." })

  if (body.modo === "sync") {
    const ultima = a.ultima_sync_em ? Date.parse(a.ultima_sync_em) : 0
    if (ultima && Date.now() - ultima < SYNC_MANUAL_MIN_INTERVALO_MS) return respond(200, { ok: true, pulado: true })
    return respond(200, await sincronizarEmpresa(companyId))
  }
  if (body.modo === "playback") {
    if (!a.playback_habilitado) return respond(200, { ok: false, erro: "A rota histórica ainda não está habilitada para esta empresa." })
    return await playback(companyId, String(body.imei ?? ""), String(body.inicio ?? ""), String(body.fim ?? ""))
  }
  return respond(400, { ok: false, erro: "modo_invalido" })
})
