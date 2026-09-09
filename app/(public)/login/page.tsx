import Link from "next/link";

import { LoginForm } from "@/components/auth/LoginForm";
import { branding } from "@/lib/branding";
import { createClient } from "@/lib/supabase/server";
import { normalizarIdioma } from "@/lib/i18n/idiomas";
import { traduzir } from "@/lib/i18n/dicionario";

export const metadata = { title: "Entrar" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reset?: string; error?: string }>;
}) {
  const { next, reset, error } = await searchParams;
  // Fora da árvore de `app/app/layout.tsx` — sem `IdiomaProvider` do lado do
  // servidor (o cliente já tem o seu, montado em `app/(public)/layout.tsx`).
  // Quase nunca há sessão aqui (é a própria tela de entrar), mas resolve do
  // mesmo jeito por segurança — `user` opcional.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const idioma = normalizarIdioma(
    (user?.user_metadata?.locale as string | undefined) ?? null,
  );
  const t = (texto: string) => traduzir(texto, idioma);

  return (
    <div className="space-y-6">
      {/* A marca subiu para a casca pública (app/(public)/layout.tsx), acima do
          cartão. O nome continua aqui, dentro da frase, porque
          tests/e2e/icone-da-marca.spec.ts cruza este texto (que lê o .env) com o
          título da aba (que lê o banco) — trocar a fonte deixaria a spec verde
          medindo nada. */}
      <div className="space-y-1.5">
        <h1 className="text-2xl font-medium tracking-title text-text">{t("Entrar")}</h1>
        <p className="text-sm text-text-muted">
          {t("Use o e-mail da sua conta")} {branding().name}.
        </p>
      </div>
      {reset === "success" && (
        <div
          className="rounded-md border border-success bg-success-bg px-3.5 py-2.5 text-sm text-success-fg"
          role="status"
        >
          {t("Senha redefinida com sucesso. Entre com a nova senha.")}
        </div>
      )}
      {error === "link_invalido" && (
        <div
          className="rounded-md border border-error bg-error-bg px-3.5 py-2.5 text-sm text-error-fg"
          role="alert"
        >
          {t("Link inválido ou expirado. Peça um novo em Recuperar senha ou refaça o cadastro.")}
        </div>
      )}
      {/*
        Os dois avisos abaixo chegaram por frentes diferentes e falam de erros
        diferentes — o merge os pôs no mesmo lugar, e ficar com um só apagaria um
        diagnóstico inteiro da tela de login.
      */}
      {error === "convite_invalido" && (
        <div
          className="rounded-md border border-error bg-error-bg px-3.5 py-2.5 text-sm text-error-fg"
          role="alert"
        >
          {t(
            "Sua conta foi confirmada, mas o convite não vale mais — ele expirou ou foi emitido para outro e-mail. Peça um novo a quem te convidou. Não criamos uma empresa nova para você, porque não era isso que você estava fazendo.",
          )}
        </div>
      )}
      {error === "template_padrao" && (
        <div
          className="rounded-md border border-error bg-error-bg px-3.5 py-2.5 text-sm text-error-fg"
          role="alert"
        >
          {t(
            "Este link veio do modelo de e-mail padrão do Supabase, que não fecha o acesso nesta instalação — pedir outro link não resolve. Quem administra o sistema precisa configurar os e-mails de acesso (",
          )}
          <code>marca-emails.sh</code>
          {t(", no kit de instalação).")}
        </div>
      )}
      {error === "provisionamento" && (
        <div
          className="rounded-md border border-error bg-error-bg px-3.5 py-2.5 text-sm text-error-fg"
          role="alert"
        >
          {t(
            "Sua conta foi confirmada, mas houve um erro ao preparar seu ambiente. Tente entrar novamente em instantes.",
          )}
        </div>
      )}
      <LoginForm next={next} />
      {/* Alinhado à ESQUERDA como o título e os campos; separado por hairline
          porque são portas para OUTRAS telas, não parte do formulário. */}
      <div className="space-y-2 border-t border-border pt-5 text-sm">
        <p>
          <Link
            href="/login/forgot"
            className="text-text-muted underline underline-offset-4 transition-colors duration-fast hover:text-text"
          >
            {t("Esqueci minha senha")}
          </Link>
        </p>
        <p className="text-text-muted">
          {t("Não tem conta?")}{" "}
          <Link
            href="/signup"
            className="font-medium text-text underline underline-offset-4 transition-colors duration-fast hover:text-accent"
          >
            {t("Criar conta")}
          </Link>
        </p>
      </div>
    </div>
  );
}
