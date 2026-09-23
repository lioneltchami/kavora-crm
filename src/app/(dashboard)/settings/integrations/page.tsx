import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function IntegrationsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Integrations"
        description="Webhook endpoints and provider configuration for Kavora CRM."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Twilio webhooks</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <Endpoint path="/api/twilio/voice" event="Inbound voice call" />
          <Endpoint path="/api/twilio/sms" event="Inbound SMS" />
          <Endpoint path="/api/twilio/status" event="Voice status callback" />
          <Endpoint path="/api/twilio/recording" event="Recording completed" />
          <Endpoint path="/api/twilio/recording-url" event="Signed recording URL (browser playback)" />
          <Endpoint path="/api/twilio/voicemail" event="Dial action / voicemail done" />
          <Endpoint path="/api/twilio/dial-gate" event="Outbound agent 'press 1' gate" />
          <Endpoint path="/api/twilio/dial-gate-bootstrap" event="Outbound call bootstrap" />
          <Endpoint path="/api/twilio/sms-status" event="SMS delivery status" />
          <p className="mt-3 text-xs text-muted-foreground">
            When you provision a number via Settings → Phone numbers, these URLs are wired to the
            number automatically.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Clerk webhook</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          <p>
            <code className="rounded bg-muted px-1">/api/webhooks/clerk</code> — keep this in sync with
            your Clerk webhook endpoint. Events: <code>user.created</code>, <code>user.updated</code>,{" "}
            <code>user.deleted</code>.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">AI providers</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <Row label="Anthropic Claude" var="ANTHROPIC_API_KEY" />
          <Row label="Deepgram STT" var="DEEPGRAM_API_KEY" />
          <Row label="Voyage / OpenAI Embeddings" var="VOYAGE_API_KEY / OPENAI_API_KEY" />
          <Row label="Trigger.dev (jobs)" var="TRIGGER_SECRET_KEY" />
        </CardContent>
      </Card>
    </div>
  );
}

function Endpoint({ path, event }: { path: string; event: string }) {
  return (
    <div className="flex items-center justify-between rounded-md border bg-background px-3 py-2">
      <code className="text-xs">{path}</code>
      <span className="text-xs text-muted-foreground">{event}</span>
    </div>
  );
}

function Row({ label, var: varName }: { label: string; var: string }) {
  return (
    <div className="flex items-center justify-between rounded-md border bg-background px-3 py-2">
      <span>{label}</span>
      <code className="text-xs text-muted-foreground">{varName}</code>
    </div>
  );
}
