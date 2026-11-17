// GE-F10 · gov-nfse-sync-municipios
// Sincroniza lista de municípios aderidos ao SN NFS-e
// Pode rodar via cron diário ou manual

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false }
})

/**
 * Endpoint público da Receita Federal com lista de municípios aderidos
 * URL exata: https://www.gov.br/nfse/pt-br/adesao
 * Lista CSV/JSON: https://www.gov.br/nfse/pt-br/dados-abertos/municipios-aderidos.json
 * (URL hipotética · ajustar quando confirmado endpoint público)
 */
const URL_LISTA_GOV = "https://www.gov.br/nfse/pt-br/dados-abertos/municipios-aderidos.json"

Deno.serve(async (req: Request) => {
  try {
    // Tentar fetch da lista oficial
    const resp = await fetch(URL_LISTA_GOV)

    if (!resp.ok) {
      // Fallback · marca os municípios cadastrados como precisando consulta manual
      const { data: municipios } = await supabase
        .from("erp_gov_nfse_municipios")
        .select("codigo_ibge, nome_municipio")
        .is("aderido", null)

      return new Response(JSON.stringify({
        ok: false,
        sincronizado: false,
        erro: `Fonte oficial retornou HTTP ${resp.status}`,
        municipios_aguardando_check: municipios?.length || 0,
        sugestao: "CEO valida manualmente em https://www.gov.br/nfse/pt-br/adesao"
      }), { status: 200, headers: { "Content-Type": "application/json" } })
    }

    const lista = await resp.json()

    // Estrutura esperada (hipotética · ajustar conforme spec real):
    // [{ codigo_ibge: "4216701", nome: "São Miguel do Oeste", uf: "SC", data_adesao: "2025-12-15" }]

    let atualizados = 0
    let inseridos = 0

    if (Array.isArray(lista)) {
      for (const m of lista) {
        const { data: existente } = await supabase
          .from("erp_gov_nfse_municipios")
          .select("codigo_ibge, aderido")
          .eq("codigo_ibge", m.codigo_ibge)
          .maybeSingle()

        if (existente) {
          if (!existente.aderido) {
            await supabase
              .from("erp_gov_nfse_municipios")
              .update({
                aderido: true,
                data_adesao: m.data_adesao || null,
                atualizado_em: new Date().toISOString()
              })
              .eq("codigo_ibge", m.codigo_ibge)
            atualizados++
          }
        } else {
          await supabase
            .from("erp_gov_nfse_municipios")
            .insert({
              codigo_ibge: m.codigo_ibge,
              nome_municipio: m.nome,
              uf: m.uf,
              aderido: true,
              data_adesao: m.data_adesao || null
            })
          inseridos++
        }
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      sincronizado: true,
      total_lista: lista.length || 0,
      inseridos,
      atualizados
    }), { status: 200, headers: { "Content-Type": "application/json" } })

  } catch (e: any) {
    return new Response(JSON.stringify({
      ok: false,
      erro: e.message || String(e),
      observacao: "Endpoint oficial pode ter mudado · atualizar URL_LISTA_GOV"
    }), { status: 200, headers: { "Content-Type": "application/json" } })
  }
})
