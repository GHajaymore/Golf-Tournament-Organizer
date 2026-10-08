import { LOGO_SIZE } from "@/components/Logo";
import { Lockup } from "@/components/Lockup";
import { ResetPasswordForm } from "@/components/ResetPasswordForm";
import { NOINDEX } from "@/lib/site";

// The reset token travels in the query string, so this URL IS a credential for
// as long as it is valid. An indexed copy, or a cached snippet, outlives that.
export const metadata = { title: "Reset your password", robots: NOINDEX };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "64px 24px",
        background:
          "radial-gradient(1100px 650px at 85% -140px, var(--color-accent-900), transparent 62%), " +
          "radial-gradient(900px 500px at -10% 110%, var(--color-accent-2-900), transparent 55%), " +
          "var(--color-bg)",
        color: "var(--color-text)",
      }}
    >
      <div style={{ marginBottom: 40 }}>
        <Lockup size={LOGO_SIZE.md} />
      </div>
      <ResetPasswordForm token={token ?? ""} />
    </main>
  );
}
