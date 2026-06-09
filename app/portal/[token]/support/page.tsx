import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getBoaterByPortalToken } from "@/lib/mock-data";
import { BoaterSupportView } from "@/components/support/boater-support-view";

/*
 * Boater-facing support page.
 *
 * Lives at /portal/{token}/support so the magic-link session is already
 * resolved — no extra auth here. The shell mirrors HolderShell's
 * structure (safe-area padded canvas, top identity bar via parent)
 * but stripped down to the support surface so the boater can drop in,
 * file or check a ticket, and bounce.
 *
 * Per the Marina Stee carve-out (../CLAUDE.md §5), this stays inside
 * Marina Stee's own backend — NO proxy to admin.stee-suite.com.
 */

type Props = { params: Promise<{ token: string }> };

export async function generateMetadata({ params }: Props) {
  const { token } = await params;
  const b = getBoaterByPortalToken(token);
  return {
    title: b ? `Support — ${b.first_name} — Marina Stee` : "Support — Marina Stee",
  };
}

export default async function MemberSupportPage({ params }: Props) {
  const { token } = await params;
  const boater = getBoaterByPortalToken(token);
  if (!boater) {
    redirect("/portal");
  }

  return (
    <main
      className="min-h-screen bg-canvas"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
      }}
    >
      <div className="mx-auto w-full max-w-[820px] px-4 pb-24 pt-6">
        <Link
          href={`/portal/${token}`}
          className="mb-3 inline-flex items-center gap-1 text-[12px] text-fg-subtle transition-colors hover:text-fg"
        >
          <ChevronLeft className="size-3.5" />
          Back to portal
        </Link>
        <BoaterSupportView boater={boater} />
      </div>
    </main>
  );
}
