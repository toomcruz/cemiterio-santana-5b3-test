import { assert, assertEquals } from "../../../tests/fixtures/assert.ts";
import { OfficialSupabaseRest } from "../official-rest.ts";
import { WapiAttachmentProcessor } from "../official-attachments.ts";

class FakeRest {
  calls: Array<{ name: string; body: Record<string, unknown> }> = [];
  uploads: Array<{ bucket: string; path: string; mimeType: string; size: number }> = [];

  rpc(name: string, body: Record<string, unknown>): Promise<unknown> {
    this.calls.push({ name, body });
    if (name === "support_runtime_get_attachment") return Promise.resolve({ found: false });
    if (name === "support_runtime_store_attachment") {
      return Promise.resolve({
        stored: true,
        document_id: "doc-1",
        file_name: "teste.pdf",
        mime_type: "application/pdf",
      });
    }
    if (name === "support_runtime_fail_attachment") return Promise.resolve({ stored: false, status: "FAILED" });
    throw new Error("unexpected RPC");
  }

  uploadObject(bucket: string, path: string, bytes: ArrayBuffer, mimeType: string): Promise<void> {
    this.uploads.push({ bucket, path, mimeType, size: bytes.byteLength });
    return Promise.resolve();
  }

  removeObject(): Promise<void> {
    return Promise.resolve();
  }
}

function attachmentInput(mediaUrl = "") {
  return {
    conversation_id: "11111111-2222-4333-8444-555555555555",
    inbound_message_id: "66666666-7777-4888-8999-aaaaaaaaaaaa",
    attachment: {
      file_name: "teste.pdf",
      mime_type: "application/pdf",
      message_type: "document" as const,
      media_url: mediaUrl || null,
      media_key: mediaUrl ? null : "media-key",
      media_direct_path: mediaUrl ? null : "/download/path",
    },
  };
}

Deno.test("official attachment processor stores a W-API file without persisting its media reference", async () => {
  const rest = new FakeRest();
  const fetcher: typeof fetch = (input) => {
    const url = String(input);
    if (url.includes("download-media")) {
      return Promise.resolve(Response.json({ fileLink: "https://files.example.test/teste.pdf" }));
    }
    return Promise.resolve(
      new Response(new Uint8Array([37, 80, 68, 70]).buffer, {
        status: 200,
        headers: { "content-type": "application/pdf", "content-length": "4" },
      }),
    );
  };
  const processor = new WapiAttachmentProcessor(rest as unknown as OfficialSupabaseRest, {
    token: "token",
    instanceId: "instance-1",
    fetcher,
    now: () => new Date("2026-09-08T15:00:00.000Z"),
    randomUuid: () => "file-uuid",
  });

  const result = await processor.persist(attachmentInput());

  assertEquals(result.failure_code, null);
  assertEquals(result.received_document?.documento_id, "doc-1");
  assertEquals(rest.uploads[0]?.path, "11111111-2222-4333-8444-555555555555/file-uuid.pdf");
  const storeCall = rest.calls.find((call) => call.name === "support_runtime_store_attachment");
  assertEquals(JSON.stringify(storeCall?.body).includes("media-key"), false);
  assertEquals(JSON.stringify(storeCall?.body).includes("download/path"), false);
});

Deno.test("official attachment processor records an unsafe supplied URL as a safe failure code", async () => {
  const rest = new FakeRest();
  const processor = new WapiAttachmentProcessor(rest as unknown as OfficialSupabaseRest, {
    token: "token",
    instanceId: "instance-1",
  });

  const result = await processor.persist(attachmentInput("http://127.0.0.1/private.pdf"));

  assertEquals(result.received_document, null);
  assertEquals(result.failure_code, "ATTACHMENT_URL_REJECTED");
  assert(rest.calls.some((call) => call.name === "support_runtime_fail_attachment"));
});
