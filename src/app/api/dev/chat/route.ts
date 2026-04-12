import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function loadContext(): Promise<string> {
  const parts: string[] = [];

  // Tabelas e contagens
  const knownTables = [
    'empresas', 'lancamentos', 'usuarios', 'linhas_negocio', 'lancamentos_linhas',
    'assessorias', 'assessoria_usuarios', 'clientes_assessoria', 'diagnosticos',
    'diagnostico_curvas_abc', 'diagnostico_imports',
    'modulos_sistema', 'permissoes_nivel', 'planos_licenca', 'planos_modulos',
    'ind_unidades', 'ind_turnos', 'ind_apontamentos_bovinos', 'ind_lotes_animais',
    'ind_custos_turno', 'ind_qualidade_sif', 'ind_kpis_diarios', 'ind_alertas_ceo'
  ];
  const tableInfo: string[] = [];
  for (const t of knownTables) {
    try {
      const { count } = await supabase.from(t).select('*', { count: 'exact', head: true });
      if (count !== null) tableInfo.push(t + ': ' + count + ' registros');
    } catch(e) {}
  }
  if (tableInfo.length > 0) parts.push('TABELAS SUPABASE:\n' + tableInfo.join('\n'));

  // Empresas
  try {
    const { data: empresas } = await supabase.from('empresas').select('nome, cnpj, status').order('nome');
    if (empresas && empresas.length > 0) {
      parts.push('EMPRESAS NO ERP:\n' + empresas.map(e => e.nome + (e.cnpj ? ' ('+e.cnpj+')' : '') + ' ['+e.status+']').join('\n'));
    }
  } catch(e) {}

  // Módulos
  try {
    const { data: modulos } = await supabase.from('modulos_sistema').select('id, nome, grupo, ativo').order('ordem');
    if (modulos && modulos.length > 0) {
      parts.push('MODULOS DO SISTEMA:\n' + modulos.map(m => m.id + ' — ' + m.nome + ' (' + m.grupo + ')' + (m.ativo ? '' : ' [INATIVO]')).join('\n'));
    }
  } catch(e) {}

  // Linhas de negócio
  try {
    const { data: linhas } = await supabase.from('linhas_negocio').select('nome, empresa_id');
    if (linhas && linhas.length > 0) {
      parts.push('LINHAS DE NEGOCIO: ' + linhas.map(l => l.nome).join(', '));
    }
  } catch(e) {}

  // Assessorias
  try {
    const { data: assessorias } = await supabase.from('assessorias').select('nome, plano, status');
    if (assessorias && assessorias.length > 0) {
      parts.push('ASSESSORIAS CADASTRADAS:\n' + assessorias.map(a => a.nome + ' [' + a.plano + ' / ' + a.status + ']').join('\n'));
    }
  } catch(e) {}

  // Planos
  try {
    const { data: planos } = await supabase.from('planos_licenca').select('id, nome, preco_min, preco_max');
    if (planos && planos.length > 0) {
      parts.push('PLANOS DE LICENCA:\n' + planos.map(p => p.id + ' — ' + p.nome + ' R$' + p.preco_min + '-' + p.preco_max).join('\n'));
    }
  } catch(e) {}

  return parts.join('\n\n');
}

export async function POST(req: NextRequest) {
  try {
    const { messages, system, useContext } = await req.json();
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: 'messages obrigatorio' }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY nao configurada' }, { status: 500 });

    // Auto-load context from Supabase
    let liveContext = '';
    if (useContext !== false) {
      try {
        liveContext = await loadContext();
      } catch(e) {
        liveContext = '[Erro ao carregar contexto do Supabase]';
      }
    }

    const systemPrompt = (system || '') + `
Voce e o assistente de desenvolvimento do ERP PS Gestao e Capital.
Seu nome e Claude. Voce esta integrado DENTRO do ERP, no modulo Dev.
O usuario e Gilberto Paravizi, fundador da PS Gestao e Capital, consultoria em Chapeco/SC.
26 anos de experiencia em agroindustria (suinos, aves, bovinos).

=== STACK TECNICO ===
Next.js 16.2.2 + Supabase (SP) + Vercel Pro + Anthropic Claude API + Google Gemini fallback
Repo: psgestaoecapital/erp-psgestao (branch main)
Deploy: GitHub API → Vercel auto-rebuild
Identidade visual: Espresso #3D2314, Dourado #C8941A, Off-white #FAF7F2

=== PADRAO DE CODIGO ===
- APIs: import createClient from @supabase/supabase-js + SUPABASE_SERVICE_ROLE_KEY
- Pages: 'use client' com useState/useEffect
- NAO usar createRouteHandlerClient (nao funciona no projeto)
- Sem cinza em bordas. Verde/Amarelo/Vermelho exclusivo para semaforos

=== MODULOS NO MENU (17+) ===
Visao Diaria, Dados, Rateio, Orcamento, Ficha Tecnica, Viabilidade, Ajuda,
Industrial, Custo, Anti-Fraude, Operacional, Importar, NOC, Wealth,
Consultor IA, Contador, Admin, Dev, PS Assessor

=== CLIENTES ATIVOS ===
Grupo Tryo Gessos (4 CNPJs, SMO/SC), Frioeste Ltda (frigorifico bovino, SMO/SC),
Fazenda Umuarama (Esteio Gestao, bovinos), PS Gestao propria

=== PRODUTOS ===
PS Assessor: SaaS white-label para assessorias (Starter R$497 / Pro R$1.497 / Enterprise R$3.497)
Modulo Industrial: R$3.500-35.000/mes para frigorificos
Modulo Contador: canal distribuicao CAC zero (100 contadores → 5K-20K empresas)
PS Wealth: MFO R$2.000-5.000/mes

=== PENDENCIAS CONHECIDAS ===
- FluxoCaixa.tsx bug (zeroed cash flow)
- Tryo empresa→linha: mapeamento 4 CNPJs → 4 linhas pendente
- exceljs missing no import/universal
- Contador: fetch sem credentials:include → erro token
- RLS restritivo, audit log, dominio psgestao.com.br

${liveContext ? '=== ESTADO ATUAL DO SUPABASE (tempo real) ===\n' + liveContext : ''}

=== DIRETRIZES ===
- Responda em portugues brasileiro
- Seja direto, tecnico, objetivo
- Quando gerar codigo, siga os padroes acima
- Quando sugerir deploy, gere o arquivo completo pronto para colar no Deploy Manager
- Pode consultar dados do Supabase quando relevante
- Conheca o historico: ERP em producao desde abril/2026, build verde, 30+ tabelas
`;

    // Try Opus first
    let model = 'claude-opus-4-20250514';
    let response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model,
        max_tokens: 8192,
        system: systemPrompt,
        messages
      })
    });

    // Fallback to Sonnet if Opus fails (rate limit, not available)
    if (!response.ok && (response.status === 429 || response.status === 503 || response.status === 400)) {
      model = 'claude-sonnet-4-20250514';
      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model,
          max_tokens: 8192,
          system: systemPrompt,
          messages
        })
      });
    }

    // Fallback to Gemini if Claude fails entirely
    if (!response.ok) {
      const geminiKey = process.env.GOOGLE_AI_API_KEY;
      if (geminiKey) {
        const geminiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: messages.map((m: any) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
              systemInstruction: { parts: [{ text: systemPrompt }] }
            })
          }
        );
        if (geminiRes.ok) {
          const geminiData = await geminiRes.json();
          const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || 'Sem resposta';
          return NextResponse.json({ content: text, model: 'gemini-2.0-flash', fallback: true, context_loaded: !!liveContext });
        }
      }
      const errData = await response.json().catch(() => ({}));
      return NextResponse.json({ error: (errData as any).error?.message || 'Erro API', status: response.status }, { status: response.status });
    }

    const data = await response.json();
    const text = data.content?.map((c: any) => c.text || '').join('') || '';
    return NextResponse.json({
      content: text,
      model: data.model || model,
      usage: data.usage,
      context_loaded: !!liveContext,
      fallback: model !== 'claude-opus-4-20250514'
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Erro interno' }, { status: 500 });
  }
}
