import { NOINDEX } from "@/lib/site";
import { OrgBrand } from "@/components/OrgBrand";
import { RegisterCodeBox } from "@/components/RegisterCodeBox";

/**
 * /register: where the code printed under a sign-up poster's QR is typed (J39/J40 PR 3B). It opens the SAME sign-up
 * page the QR does. The page itself says nothing about any event: it is one box, and it is never indexed.
 */
export const dynamic = "force-dynamic";

export const metadata = { title: "Registration", robots: NOINDEX };

export default function RegisterCodePage() {
  return (
    <main style={{ minHeight: "100vh", background: "var(--color-bg)", color: "var(--color-text)", fontFamily: "var(--font-body)", padding: "22px 18px 48px" }}>
      <div style={{ maxWidth: 440, margin: "0 auto", paddingTop: "8vh" }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 18 }}>
          <OrgBrand brand={null} tagline />
        </div>
        <div className="card elev-sm" style={{ gap: 12 }}>
          <h1 style={{ fontSize: 22, margin: 0, fontFamily: "var(--font-heading)" }}>Sign up with a code</h1>
          <p className="text-muted" style={{ fontSize: 14, margin: 0 }}>
            No camera? Type the code printed under the poster&rsquo;s QR.
          </p>
          <RegisterCodeBox />
        </div>
      </div>
    </main>
  );
}
