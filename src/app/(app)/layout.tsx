import { Sidebar } from "@/components/Sidebar";
import { navForRole } from "@/lib/nav";
import { requireSession, initialsOf } from "@/lib/page-helpers";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const sections = navForRole(session.viewRole);

  return (
    <div
      style={{
        display: "flex",
        minHeight: "100vh",
        background: "var(--color-bg)",
        color: "var(--color-text)",
        fontFamily: "var(--font-body)",
      }}
    >
      <Sidebar
        sections={sections}
        name={session.name}
        role={session.role}
        viewRole={session.viewRole}
        initials={initialsOf(session.name)}
      />
      <main style={{ flex: 1, minWidth: 0, padding: "26px 30px", maxWidth: 1220 }}>{children}</main>
    </div>
  );
}
