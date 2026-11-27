// Rastreamento de frota — sincronizador do rastreador (provider técnico `brasilsat`) · SPEC 27/11 PARTE E.
//
// Modos (POST JSON):
//   { origem: 'cron' }                                   → só conexão de serviço (fn_frota_rastreio_dispatch, a cada
//                                                          5 min). Sincroniza as empresas devidas pela SUA cadência
//                                                          (frota_rastreio_config.cadencia_min, default provisório 10).
//   { modo: 'sync', company_id }                         → usuário logado com a empresa ("Atualizar agora"; 1×/min).
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
  BASE_URL, IMEIS_POR_CHAMADA, PLAYBACK_PONTOS_POR_PAGINA, CODIGOS_TOKEN,
  assinatura, mensagemErro, ehErroDeAutenticacao, converterDispositivos, converterPosicoes, converterPlayback,
  distanciaKm, lotes,
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

async function chamar(path: string, params: Record<string, string | number>): Promise<unknown> {
  const url = new URL(path, BASE_URL)
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

async function autenticar(cred: { account: string; senha: string }): Promise<string> {
  const time = Math.floor(Date.now() / 1000)
  const rec = await chamar("/api/authorization", { account: cred.account, time, signature: assinatura(cred.senha, time) }) as
    { access_token?: string } | null
  if (!rec?.access_token) throw new ErroApi(null, mensagemErro(null))
  return rec.access_token
}

async function gravarStatus(companyId: string, patch: Record<string, unknown>) {
  const agora = new Date().toISOString()
  await admin.from("frota_rastreio_config")
    .upsert({ company_id: companyId, ultima_sync_em: agora, atualizado_em: agora, ...patch }, { onConflict: "company_id" })
}

type ResultadoSync = { company_id: string; ok: boolean; veiculos?: number; posicoes?: number; status: string; erro?: string }

async function sincronizarEmpresa(companyId: string): Promise<ResultadoSync> {
  const cred = await lerCredencial(companyId)
  if (!cred) {
    await gravarStatus(companyId, { ultimo_status: "sem_credencial", ultimo_erro: "Conta e senha do rastreador ainda não cadastradas." })
    return { company_id: companyId, ok: false, status: "sem_credencial" }
  }
  try {
    let token = await autenticar(cred)
    const comToken = async (path: string, params: Record<string, string | number>) => {
      try { return await chamar(path, { access_token: token, ...params }) }
      catch (e) {
        if (e instanceof ErroApi && e.codigo !== null && CODIGOS_TOKEN.has(e.codigo)) {
          token = await autenticar(cred)                    // token expirou no meio: entra de novo, 1 vez
          return await chamar(path, { access_token: token, ...params })
        }
        throw e
      }
    }

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

    await gravarStatus(companyId, {
      ultimo_status: "ok", ultimo_erro: null, ultima_sync_ok_em: new Date().toISOString(),
      veiculos: disp.length, posicoes_ultima: posicoes,
    })
    return { company_id: companyId, ok: true, status: "ok", veiculos: disp.length, posicoes }
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

  const cred = await lerCredencial(companyId)
  if (!cred) return respond(200, { ok: false, erro: "Conta e senha do rastreador ainda não cadastradas." })
  try {
    const token = await autenticar(cred)
    const pontos: ReturnType<typeof converterPlayback> = []
    let desde = ini
    for (let pagina = 0; pagina < PLAYBACK_MAX_PAGINAS; pagina++) {
      const rec = await chamar("/api/playback", { access_token: token, imei, begintime: desde, endtime: fim })
      const lote = converterPlayback(rec)
      const novos = lote.filter((p) => !pontos.length || p.t > pontos[pontos.length - 1].t)
      pontos.push(...novos)
      if (lote.length < PLAYBACK_PONTOS_POR_PAGINA || !novos.length) break
      desde = pontos[pontos.length - 1].t
    }
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
