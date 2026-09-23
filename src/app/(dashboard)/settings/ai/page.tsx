import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { VoiceStyleForm } from "@/components/settings/voice-style-form";
import { getMyVoiceStyle } from "@/actions/ai";

export const dynamic = "force-dynamic";

export default async function AISettingsPage() {
  const style = await getMyVoiceStyle();

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI style"
        description="Teach the AI how you write. Paste past emails/SMS as examples and the outreach drafter will mirror your voice."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Voice examples</CardTitle>
        </CardHeader>
        <CardContent>
          <VoiceStyleForm
            initialExamples={style?.examples ?? []}
            initialNotes={style?.notes ?? ""}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">How the AI uses this</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            When you click <strong>Draft outreach</strong> on a contact, the AI:
          </p>
          <ol className="list-decimal space-y-1 pl-6">
            <li>Embeds your prompt + recent deal notes.</li>
            <li>Retrieves the 6 most relevant past transcripts/SMS/notes from pgvector.</li>
            <li>Builds a system prompt with your voice examples + retrieved chunks.</li>
            <li>Returns 2-3 candidate drafts (Claude Sonnet for email, Haiku for SMS).</li>
          </ol>
          <p className="pt-2">
            You always edit before sending. Outbound comms never go out without your click.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
