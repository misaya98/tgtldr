import { redirect } from "next/navigation";

export default async function ChatRedirectPage(props: {
  params: Promise<{ chatId: string }>;
}) {
  const params = await props.params;
  redirect(`/dashboard/chats/${params.chatId}/messages`);
}

