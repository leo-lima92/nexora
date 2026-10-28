import Link from "next/link";

import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";
import { createClient } from "@/lib/supabase/server";
import { idiomaDoVisitante } from "@/lib/i18n/idiomaAnonimo";
import { traduzir } from "@/lib/i18n/dicionario";
import { tituloDaTelaPublica } from "@/lib/i18n/titulo-da-tela-publica";

// A aba no idioma do visitante, como o corpo (`lib/i18n/titulo-da-tela-publica.ts`).
export const generateMetadata = () => tituloDaTelaPublica((t) => t("Recuperar senha"));

export default async function ForgotPasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const idioma = await idiomaDoVisitante(
    (user?.user_metadata?.locale as string | undefined) ?? null,
  );
  const t = (texto: string) => traduzir(texto, idioma);

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-medium tracking-title text-text">{t("Recuperar senha")}</h1>
        <p className="text-sm text-text-muted">
          {t("Informe seu e-mail e enviaremos um link de redefinição")}
        </p>
      </div>
      <ForgotPasswordForm />
      <p className="border-t border-border pt-5 text-sm text-text-muted">
        {t("Lembrou a senha?")}{" "}
        <Link href="/login" className="font-medium text-text underline underline-offset-4 transition-colors duration-fast hover:text-accent">
          {t("Entrar")}
        </Link>
      </p>
    </div>
  );
}
