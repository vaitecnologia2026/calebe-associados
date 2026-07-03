// Resolução de URL de mídia servida pelo backend.
// O React roda em calebe-frontend.vercel.app · backend serve estáticos em app.calebe.tech
// (nginx mapeia /midias/, /avisos/, /documentos/, /pagamentos-comissoes/, etc).
//
// Aplica-se a: imageUrl/videoUrl/documentUrl de Aviso, photoUrl de Associate,
// agreement.url, comprovante de comissão, mídia de imóvel — tudo que vier
// como "/algo/..." (relativo) no JSON precisa virar URL absoluta.

const BACKEND_BASE = "https://app.calebe.tech";

export function resolveBackendUrl(url?: string | null): string {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  // Data URLs e blob URLs intocados (uploads em preview)
  if (/^(data|blob):/i.test(url)) return url;
  const path = url.startsWith("/") ? url : `/${url}`;
  return BACKEND_BASE + path;
}
