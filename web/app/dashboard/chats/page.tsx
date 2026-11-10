import { Suspense } from "react";
import { ChatsPanel } from "@/components/chats-panel";

export default function ChatsPage() {
  return (
    <Suspense fallback={null}>
      <ChatsPanel />
    </Suspense>
  );
}
