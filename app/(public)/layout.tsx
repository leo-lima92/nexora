import { BrandMark } from "@/components/shell/BrandMark";
import { marcaDaSaida } from "@/lib/branding/saida";
import { createClient } from "@/lib/supabase/server";
import { traduzir } from "@/lib/i18n/dicionario";
import { normalizarIdioma } from "@/lib/i18n/idiomas";
import { IdiomaProvider } from "@/lib/i18n/IdiomaProvider";

/**
 * A casca das telas de acesso — login, cadastro, recuperação, MFA.
 *
 * ── Por que o LOGO mora aqui, e não em `login/page.tsx` ───────────────────────
 *
 * São seis telas no grupo `(public)`, e todas são "antes de entrar": quem instala
 * o produto para clientes mostra a marca dele exatamente aí. Um `<img>` por
 * página seriam seis cópias que divergem na primeira vez que alguém mexer numa
 * só — e a que ficaria para trás é sempre a que ninguém abre (recuperação de
 * senha, cadastro de MFA), que é justamente onde o cliente do revendedor
 * aparece sozinho e sem contexto.
 *
 * ── Por que `marcaDaSaida(null)` ──────────────────────────────────────────────
 *
 * Aqui não existe organização resolvida: `null` é a declaração disso, e a pilha
 * resultante é a mesma do layout raiz (banco acima, `.env` embaixo). Montar a
 * pilha à mão nesta tela faria a fachada anunciar uma precedência que o resto do
 * produto não usa. E `marcaDaSaida` NUNCA lança (ver o cabeçalho dela): uma cor
 * ou um logo mal gravados não podem derrubar a única tela por onde se entra para
 * corrigi-los.
 *
 * O NOME continua saindo de `branding()` dentro de cada página — não é descuido,
 * está medido em `tests/e2e/icone-da-marca.spec.ts:64-77`: aquela spec cruza duas
 * resoluções independentes (o título da aba, que lê o banco, contra o texto sob
 * o "Entrar", que lê o `.env`). Trocar o texto para este mesmo resolvedor
 * deixaria a spec verde medindo nada.
 */
export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const marca = await marcaDaSaida(null);
  // A maioria destas telas roda ANTES do login (não há usuário nenhum), mas
  // duas — `/login/mfa` e, em parte, `/login/recovery` — rodam com uma sessão
  // parcial já criada (primeiro fator verificado, segundo pendente). Onde há
  // sessão, o idioma salvo no perfil vale; sem ela, `IdiomaProvider` já cai no
  // padrão pt-BR sozinho (ver o cabeçalho do provider) — nunca lança.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const locale = (user?.user_metadata?.locale as string | undefined) ?? null;
  const idioma = normalizarIdioma(locale);

  return (
    <IdiomaProvider locale={locale}>
      {/* Gramática do deck (docs/DESIGN_SYSTEM.md): cartão de Paper com hairline
          sobre o Vellum da página, a marca ACIMA do cartão (ela apresenta o
          produto, não é um campo do formulário) e uma nota discreta no rodapé.
          400px em vez de `max-w-sm` (384px) porque o cartão tem 40px de padding
          de cada lado — mantendo 384px a linha útil do formulário encolhia 80px. */}
      <div className="flex min-h-screen flex-col items-center justify-center bg-bg px-6 py-12">
        <div className="w-full max-w-[400px]">
          <div className="mb-8 flex items-center justify-center gap-2.5">
            {/*
                <img> em vez de next/image pelo mesmo motivo da barra lateral: a URL
                é de quem hospeda e o `next/image` exige allowlist de domínios
                fechada em BUILD — a imagem pré-buildada do self-host recusaria o
                domínio do operador. Altura fixa e largura livre para não distorcer
                arte de proporção desconhecida.

                O `alt` é o nome DESTA resolução (`marca.nome`), e não o de
                `branding()`: é a legenda da imagem que está ali, e nomeá-la com a
                marca de outra fonte descreveria uma marca que não é a do logo.

                O `data-testid` é lido por `tests/e2e/marca-logo.spec.ts`, que prova
                que o logo da EMPRESA não vaza para cá. Sem ele a spec caía na
                "primeira <img> da página", e uma asserção de negação com seletor
                largo passa sozinha assim que outra imagem entra na tela.
              */}
            {marca.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                data-testid="logo-da-fachada"
                src={marca.logoUrl}
                alt={marca.nome}
                className="h-7 w-auto max-w-[12rem] object-contain"
              />
            ) : (
              <>
                <BrandMark size={18} className="text-text" />
                <span className="text-[17px] font-semibold tracking-title text-text">
                  {marca.nome}
                </span>
              </>
            )}
          </div>

          <div className="rounded-md border border-border bg-surface p-10 shadow-subtle">
            {children}
          </div>

          <p className="mt-6 text-center text-xs text-text-subtle">
            {traduzir("Atendimento e vendas por WhatsApp, num funil só.", idioma)}
          </p>
        </div>
      </div>
    </IdiomaProvider>
  );
}
