// src/app/dashboard/importar-universal/page.tsx
// ========================================================================
// Página Importar Universal v2.0 — UI premium com:
//   - Botão de download da Planilha Modelo PS Gestão
//   - Upload com preview robusto
//   - Detecção visual do tipo de planilha
//   - Confirmação explícita antes de importar
//   - Logs de erro detalhados linha-a-linha
// ========================================================================

'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';

// Paleta oficial PS Gestão
const COLORS = {
  espresso: '#3D2314',
  espressoLight: '#5C3825',
  offwhite: '#FAF7F2',
  dourado: '#C8941A',
  douradoLight: '#E8B547',
  success: '#2D7A4F',
  warning: '#C8941A',
  danger: '#9B2D2D',
  gray: '#F5F2ED',
};

interface PreviewSheet {
  index: number;
  nome: string;
  linhas: number;
  colunas: number;
  headers: string[];
  eh_planilha_ps: boolean;
}

interface PreviewResponse {
  ok: boolean;
  arquivo: { nome: string; tamanho_kb: number };
  sheets: PreviewSheet[];
  deteccao: { kind: string; confidence: number; sheetIndex: number; reason: string };
  sheet_selecionada: { index: number; nome: string; headers: string[]; preview_linhas: any[][] };
  error?: string;
}

interface ConfirmResponse {
  ok: boolean;
  inseridos?: number;
  duplicados?: number;
  erros?: number;
  lista_erros?: any[];
  total_registros_validos?: number;
  empresas?: number;
  mensagem?: string;
  error?: string;
}

export default function ImportarUniversalPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [resultado, setResultado] = useState<ConfirmResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  function reset() {
    setFile(null);
    setPreview(null);
    setResultado(null);
    setErro(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handleFile(f: File) {
    setFile(f);
    setPreview(null);
    setResultado(null);
    setErro(null);
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append('file', f);
      fd.append('action', 'preview');
      const res = await fetch('/api/import/universal', { method: 'POST', body: fd });
      const j = await res.json();
      if (!j.ok) {
        setErro(j.error || 'Erro ao processar arquivo');
      } else {
        setPreview(j);
      }
    } catch (e: any) {
      setErro(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirm() {
    if (!file) return;
    if (!confirm('Confirma a importação? Os registros serão inseridos em erp_lancamentos e o pipeline PSGC processará automaticamente.')) {
      return;
    }
    setLoading(true);
    setErro(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('action', 'confirm');
      if (preview?.deteccao?.sheetIndex !== undefined) {
        fd.append('sheet_index', String(preview.deteccao.sheetIndex));
      }
      const res = await fetch('/api/import/universal', { method: 'POST', body: fd });
      const j = await res.json();
      setResultado(j);
      if (!j.ok) {
        setErro(j.error || 'Erro ao importar');
      }
    } catch (e: any) {
      setErro(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  const detectionLabel = (kind: string) => {
    const labels: Record<string, { texto: string; cor: string; icone: string }> = {
      planilha_modelo_ps: { texto: 'Planilha Modelo PS Gestão', cor: COLORS.success, icone: '✅' },
      lancamentos_generico: { texto: 'Lançamentos (genérico)', cor: COLORS.dourado, icone: '⚠️' },
      clientes: { texto: 'Cadastro de Clientes', cor: COLORS.dourado, icone: 'ℹ️' },
      fornecedores: { texto: 'Cadastro de Fornecedores', cor: COLORS.dourado, icone: 'ℹ️' },
      desconhecido: { texto: 'Formato não reconhecido', cor: COLORS.danger, icone: '❌' },
    };
    return labels[kind] || labels['desconhecido'];
  };

  return (
    <div style={{ background: COLORS.offwhite, minHeight: '100vh', padding: 24, fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        {/* Header */}
        <div
          style={{
            background: `linear-gradient(135deg, ${COLORS.espresso} 0%, ${COLORS.espressoLight} 100%)`,
            padding: '32px 40px',
            borderRadius: 16,
            color: 'white',
            marginBottom: 24,
            boxShadow: '0 4px 16px rgba(61,35,20,0.15)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
            <div>
              <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em' }}>
                📤 Importar Dados — Upload Universal
              </h1>
              <p style={{ margin: '8px 0 0 0', color: COLORS.douradoLight, fontSize: 14 }}>
                Aceita Planilha Modelo PS Gestão, SIGA, ContaAzul, Omie · Detecção automática · Idempotente · Multi-tenant
              </p>
            </div>
            <a
              href="/api/templates/planilha-modelo"
              download
              style={{
                background: COLORS.dourado,
                color: COLORS.espresso,
                padding: '12px 22px',
                borderRadius: 10,
                fontWeight: 700,
                textDecoration: 'none',
                fontSize: 14,
                whiteSpace: 'nowrap',
                boxShadow: '0 2px 8px rgba(200,148,26,0.3)',
                transition: 'transform 0.15s',
              }}
              onMouseOver={(e) => (e.currentTarget.style.transform = 'translateY(-2px)')}
              onMouseOut={(e) => (e.currentTarget.style.transform = 'translateY(0)')}
            >
              📥 Baixar Planilha Modelo
            </a>
          </div>
        </div>

        {/* Card principal */}
        <div
          style={{
            background: 'white',
            borderRadius: 16,
            padding: 32,
            boxShadow: '0 2px 12px rgba(61,35,20,0.06)',
            border: `1px solid ${COLORS.gray}`,
          }}
        >
          {!file && (
            <>
              {/* Dica sobre planilha modelo */}
              <div
                style={{
                  background: COLORS.gray,
                  padding: 20,
                  borderRadius: 12,
                  marginBottom: 24,
                  borderLeft: `4px solid ${COLORS.dourado}`,
                }}
              >
                <p style={{ margin: 0, color: COLORS.espresso, fontSize: 14, lineHeight: 1.6 }}>
                  <strong>💡 Recomendado:</strong> Baixe a <strong>Planilha Modelo PS Gestão</strong>, preencha
                  com seus dados (suas empresas, suas linhas de negócio, lançamentos) e suba aqui. O sistema
                  detecta automaticamente o formato, valida e popula o Dashboard em até 5 minutos.
                </p>
              </div>

              {/* Drop zone */}
              <label
                htmlFor="file-input"
                style={{
                  display: 'block',
                  border: `2px dashed ${COLORS.dourado}`,
                  borderRadius: 14,
                  padding: 48,
                  textAlign: 'center',
                  cursor: 'pointer',
                  background: COLORS.offwhite,
                  transition: 'all 0.2s',
                }}
              >
                <div style={{ fontSize: 48, marginBottom: 12 }}>📋</div>
                <div style={{ fontSize: 18, fontWeight: 600, color: COLORS.espresso, marginBottom: 6 }}>
                  Selecione a planilha para importar
                </div>
                <div style={{ fontSize: 13, color: COLORS.espressoLight }}>
                  Arquivos .xlsx, .xls ou .csv até 50MB
                </div>
                <input
                  id="file-input"
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
                  style={{ display: 'none' }}
                />
              </label>
            </>
          )}

          {/* Loading */}
          {loading && (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div>
              <p style={{ color: COLORS.espresso, fontWeight: 600 }}>Processando arquivo...</p>
            </div>
          )}

          {/* Erro */}
          {erro && (
            <div
              style={{
                background: '#FCEAEA',
                border: `1px solid ${COLORS.danger}`,
                color: COLORS.danger,
                padding: 16,
                borderRadius: 10,
                marginTop: 16,
              }}
            >
              <strong>❌ Erro:</strong> {erro}
              <button
                onClick={reset}
                style={{
                  marginLeft: 16,
                  background: 'transparent',
                  border: `1px solid ${COLORS.danger}`,
                  color: COLORS.danger,
                  padding: '4px 12px',
                  borderRadius: 6,
                  cursor: 'pointer',
                }}
              >
                Tentar de novo
              </button>
            </div>
          )}

          {/* Preview */}
          {preview && !resultado && (
            <div>
              {/* Detecção */}
              <div
                style={{
                  background: COLORS.gray,
                  padding: 20,
                  borderRadius: 12,
                  marginBottom: 20,
                  borderLeft: `4px solid ${detectionLabel(preview.deteccao.kind).cor}`,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: COLORS.espresso }}>
                      {detectionLabel(preview.deteccao.kind).icone} {detectionLabel(preview.deteccao.kind).texto}
                    </div>
                    <div style={{ fontSize: 13, color: COLORS.espressoLight, marginTop: 4 }}>
                      {preview.deteccao.reason} · Confiança: {preview.deteccao.confidence}%
                    </div>
                  </div>
                  <div style={{ fontSize: 13, color: COLORS.espressoLight }}>
                    📁 <strong>{preview.arquivo.nome}</strong> · {preview.arquivo.tamanho_kb} KB
                  </div>
                </div>
              </div>

              {/* Sheets info */}
              <div style={{ marginBottom: 20 }}>
                <h3 style={{ color: COLORS.espresso, fontSize: 14, marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Abas detectadas
                </h3>
                <div style={{ display: 'grid', gap: 8 }}>
                  {preview.sheets.map((s) => (
                    <div
                      key={s.index}
                      style={{
                        background: s.index === preview.deteccao.sheetIndex ? COLORS.gray : 'white',
                        border: `1px solid ${s.index === preview.deteccao.sheetIndex ? COLORS.dourado : '#e5e5e5'}`,
                        padding: 12,
                        borderRadius: 8,
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <div>
                        <strong style={{ color: COLORS.espresso }}>{s.nome}</strong>
                        <span style={{ color: COLORS.espressoLight, marginLeft: 12, fontSize: 13 }}>
                          {s.linhas} linhas · {s.colunas} colunas
                        </span>
                      </div>
                      {s.index === preview.deteccao.sheetIndex && (
                        <span
                          style={{
                            background: COLORS.dourado,
                            color: COLORS.espresso,
                            padding: '4px 10px',
                            borderRadius: 6,
                            fontSize: 12,
                            fontWeight: 700,
                          }}
                        >
                          SELECIONADA
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Headers da aba selecionada */}
              <div style={{ marginBottom: 20 }}>
                <h3 style={{ color: COLORS.espresso, fontSize: 14, marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Cabeçalhos detectados
                </h3>
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 6,
                    background: COLORS.offwhite,
                    padding: 12,
                    borderRadius: 8,
                  }}
                >
                  {preview.sheet_selecionada.headers.map((h, i) => (
                    <span
                      key={i}
                      style={{
                        background: 'white',
                        border: `1px solid ${COLORS.gray}`,
                        padding: '4px 10px',
                        borderRadius: 6,
                        fontSize: 12,
                        color: COLORS.espresso,
                      }}
                    >
                      {h || <em style={{ color: COLORS.espressoLight }}>(vazio)</em>}
                    </span>
                  ))}
                </div>
              </div>

              {/* Preview linhas */}
              {preview.sheet_selecionada.preview_linhas.length > 0 && (
                <div style={{ marginBottom: 24 }}>
                  <h3 style={{ color: COLORS.espresso, fontSize: 14, marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Preview (primeiras 10 linhas)
                  </h3>
                  <div style={{ overflow: 'auto', maxHeight: 300, border: `1px solid ${COLORS.gray}`, borderRadius: 8 }}>
                    <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ background: COLORS.espresso, color: 'white' }}>
                          {preview.sheet_selecionada.headers.map((h, i) => (
                            <th
                              key={i}
                              style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600, fontSize: 11, position: 'sticky', top: 0 }}
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {preview.sheet_selecionada.preview_linhas.map((row, i) => (
                          <tr
                            key={i}
                            style={{ background: i % 2 === 0 ? 'white' : COLORS.offwhite }}
                          >
                            {row.map((c, j) => (
                              <td key={j} style={{ padding: '4px 8px', color: COLORS.espresso }}>
                                {c?.toString().slice(0, 50) || ''}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Botões */}
              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 24 }}>
                <button
                  onClick={reset}
                  style={{
                    background: 'white',
                    color: COLORS.espresso,
                    border: `1px solid ${COLORS.espresso}`,
                    padding: '12px 24px',
                    borderRadius: 10,
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontSize: 14,
                  }}
                >
                  Cancelar
                </button>
                {preview.deteccao.kind === 'planilha_modelo_ps' ? (
                  <button
                    onClick={handleConfirm}
                    disabled={loading}
                    style={{
                      background: COLORS.success,
                      color: 'white',
                      border: 'none',
                      padding: '12px 28px',
                      borderRadius: 10,
                      fontWeight: 700,
                      cursor: 'pointer',
                      fontSize: 14,
                      boxShadow: '0 2px 8px rgba(45,122,79,0.3)',
                    }}
                  >
                    🚀 Confirmar Importação
                  </button>
                ) : (
                  <div
                    style={{
                      background: COLORS.gray,
                      color: COLORS.espresso,
                      padding: '12px 24px',
                      borderRadius: 10,
                      fontSize: 13,
                      maxWidth: 400,
                    }}
                  >
                    ⚠️ Importação automática disponível somente para a <strong>Planilha Modelo PS Gestão</strong>.
                    Baixe o template clicando no botão acima.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Resultado */}
          {resultado && (
            <div>
              <div
                style={{
                  background: resultado.ok && (resultado.inseridos || 0) > 0 ? '#E8F5E9' : '#FFF3E0',
                  border: `1px solid ${resultado.ok && (resultado.inseridos || 0) > 0 ? COLORS.success : COLORS.dourado}`,
                  padding: 24,
                  borderRadius: 12,
                  marginBottom: 16,
                }}
              >
                <h2 style={{ margin: '0 0 12px 0', color: COLORS.espresso, fontSize: 20 }}>
                  {resultado.ok ? '✅ Importação concluída' : '❌ Falha na importação'}
                </h2>
                {resultado.mensagem && (
                  <p style={{ color: COLORS.espresso, fontSize: 14, margin: '0 0 16px 0', lineHeight: 1.6 }}>
                    {resultado.mensagem}
                  </p>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
                  <Metric label="Inseridos" value={resultado.inseridos || 0} color={COLORS.success} />
                  <Metric label="Duplicados (ignorados)" value={resultado.duplicados || 0} color={COLORS.espressoLight} />
                  <Metric label="Erros" value={resultado.erros || 0} color={COLORS.danger} />
                  <Metric label="Empresas" value={resultado.empresas || 0} color={COLORS.dourado} />
                </div>
              </div>

              {resultado.lista_erros && resultado.lista_erros.length > 0 && (
                <details style={{ marginBottom: 16 }}>
                  <summary style={{ cursor: 'pointer', color: COLORS.danger, fontWeight: 600, padding: 8 }}>
                    Ver {resultado.lista_erros.length} erro(s)
                  </summary>
                  <div style={{ background: '#FCEAEA', padding: 12, borderRadius: 8, maxHeight: 300, overflow: 'auto', fontSize: 12 }}>
                    {resultado.lista_erros.map((e: any, i: number) => (
                      <div key={i} style={{ padding: '4px 0', borderBottom: '1px solid #f5d4d4' }}>
                        <strong>Linha {e.linha || '?'}:</strong> {e.erro || JSON.stringify(e)}
                      </div>
                    ))}
                  </div>
                </details>
              )}

              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                <button
                  onClick={reset}
                  style={{
                    background: 'white',
                    color: COLORS.espresso,
                    border: `1px solid ${COLORS.espresso}`,
                    padding: '10px 20px',
                    borderRadius: 8,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Importar outro arquivo
                </button>
                <button
                  onClick={() => router.push('/dashboard')}
                  style={{
                    background: COLORS.espresso,
                    color: 'white',
                    border: 'none',
                    padding: '10px 24px',
                    borderRadius: 8,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  📊 Ver Dashboard
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <p style={{ textAlign: 'center', color: COLORS.espressoLight, fontSize: 12, marginTop: 24 }}>
          PS Gestão ERP · Upload Universal v2.0 · Multi-tenant · Idempotente
        </p>
      </div>
    </div>
  );
}

function Metric({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ background: 'white', padding: 14, borderRadius: 10, textAlign: 'center', border: '1px solid #e8e0d4' }}>
      <div style={{ fontSize: 24, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 11, color: COLORS.espressoLight, marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </div>
    </div>
  );
}
