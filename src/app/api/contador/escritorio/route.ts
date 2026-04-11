import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/withAuth'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { gerarApiKey } from '@/lib/contadorAuth'

// POST — registra novo escritório contábil e gera primeira API Key
export const POST = withAuth(async (req: NextRequest, { userId }) => {
  const body = await req.json()
  const { nome, cnpj, responsavel, email, telefone, crc_uf, plano } = body

  if (!nome || !email) {
    return NextResponse.json({ error: 'nome e email são obrigatórios' }, { status: 400 })
  }

  // Cria escritório
  const { data: escritorio, error: errEsc } = await supabaseAdmin
    .from('escritorios_contabeis')
    .insert({ nome, cnpj, responsavel, email, telefone, crc_uf, plano: plano || 'starter' })
    .select().single()

  if (errEsc) return NextResponse.json({ error: errEsc.message }, { status: 400 })

  // Cria contador admin vinculado ao usuário logado
  const { data: contador, error: errCnt } = await supabaseAdmin
    .from('contadores')
    .insert({ escritorio_id: escritorio.id, user_id: userId, nome: responsavel || nome, email, admin: true })
    .select().single()

  if (errCnt) return NextResponse.json({ error: errCnt.message }, { status: 400 })

  // Gera primeira API Key
  const { token, hash, prefix } = gerarApiKey()
  await supabaseAdmin.from('contador_api_keys').insert({
    contador_id: contador.id,
    escritorio_id: escritorio.id,
    nome: 'Chave Principal',
    token_hash: hash,
    token_prefix: prefix,
    escopos: ['read:dre','read:fluxo','read:fiscal','read:lancamentos','export:sped'],
  })

  return NextResponse.json({
    escritorio,
    contador,
    api_key: token,
    aviso: 'Guarde a API Key — não será exibida novamente',
  })
})

// GET — dados do escritório do usuário logado
export const GET = withAuth(async (_req: NextRequest, { userId }) => {
  const { data: contador } = await supabaseAdmin
    .from('contadores')
    .select('*, escritorios_contabeis(*)')
    .eq('user_id', userId)
    .single()

  if (!contador) return NextResponse.json({ escritorio: null })
  return NextResponse.json({ escritorio: contador.escritorios_contabeis, contador })
})
