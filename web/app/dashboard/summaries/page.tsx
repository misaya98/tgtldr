import { Suspense } from "react";
import { SummariesPanel } from "@/components/summaries-panel";

export default async function SummariesPage({
  searchParams
}: {
  searchParams: Promise<{ chatId?: string | string[] }>;
}) {
  const params = await searchParams;
  const chatId = Array.isArray(params.chatId) ? params.chatId[0] : params.chatId;
  const initialChatId = chatId && /^-?\d+$/.test(chatId) ? chatId : "all";

  return (
    <Suspense fallback={null}>
      <SummariesPanel initialChatId={initialChatId} />
    </Suspense>
  );
}
