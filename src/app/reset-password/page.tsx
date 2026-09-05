import { Logo, LOGO_SIZE } from "@/components/Logo";
import { BrandMark } from "@/components/BrandMark";
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
    <div
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
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 40 }}>
        <div
          style={{
            width: 40,
            height: 40,
            display: "grid",
            placeItems: "center",
            borderRadius: 11,
            background: "color-mix(in srgb, var(--color-accent) 16%, transparent)",
          }}
        >
          <Logo size={LOGO_SIZE.md} style={{ color: "var(--color-accent)" }} />
        </div>
        <BrandMark />
      </div>
      <ResetPasswordForm token={token ?? ""} />
    </div>
  );
}
