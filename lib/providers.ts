export type ProviderResult = {
  provider: string;
  status: number;
  text: string;
  inputTokens: number;
  outputTokens: number;
  errorMessage?: string;
};

export async function callProvider(body: any): Promise<ProviderResult> {
  const provider = process.env.PROVIDER ?? "ollama";

  const res =
    provider === "anthropic"
      ? await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": process.env.ANTHROPIC_API_KEY!,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify(body),
        })
      : await fetch(
          `${process.env.OLLAMA_BASE_URL ?? "http://localhost:11434"}/v1/chat/completions`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }
        );

  const text = await res.text();
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {}

  const inputTokens = data?.usage?.prompt_tokens ?? data?.usage?.input_tokens ?? 0;
  const outputTokens = data?.usage?.completion_tokens ?? data?.usage?.output_tokens ?? 0;
  const errorMessage = res.ok
    ? undefined
    : String(data?.error?.message ?? data?.error ?? "Upstream error").slice(0, 500);

  return { provider, status: res.status, text, inputTokens, outputTokens, errorMessage };
}