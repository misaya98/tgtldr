# Forum Topics Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist Telegram forum topics, attribute incoming and backfilled messages to them, expose topic-aware APIs, and render a hierarchical chat/topic management UI.

**Architecture:** Add `chat_topics` as a child of `chats`, keep one `chats` row per Telegram peer, store an internal topic ID on messages, and propagate optional topic scope through the existing chat and message APIs. Topic characteristics are stored in the domain model; Telegram discovery and reply-header resolution live in the existing Telegram service.

**Tech Stack:** Go 1.25, gotd/td v0.134.0, PostgreSQL 17, Next.js 16, React 19, TypeScript 5.9.

## Global Constraints

- UI terminology is `话题` / `Topics`, never `子群组` / `subgroups`.
- One Telegram forum supergroup is one `chats` row.
- One Telegram message belongs to at most one internal topic.
- Keep the existing `(chat_id, telegram_message_id)` uniqueness; update `topic_id` in place when topic resolution changes.
- `NULL` means inherited for nullable topic settings.
- Parent chat disablement is independent from child topic switches.
- Non-forum chats keep `topic_id = 0`.
- Existing APIs and UI behavior must remain valid for non-forum chats.
- All visible UI strings require Chinese and English i18n entries.
- Do not modify unrelated `docker-compose.yml` work.

---

### Task 1: Topic Domain Types and Resolver

**Files:**
- Modify: `app/internal/model/types.go`
- Create: `app/internal/telegram/forum_topic.go`
- Create: `app/internal/telegram/forum_topic_test.go`
- Modify: `app/internal/telegram/helpers.go`
- Modify: `app/internal/telegram/helpers_test.go`

**Interfaces:**
- Produces:
  - `model.ChatTopic`
  - `model.Chat.IsForum`
  - `model.Message.TopicID`
  - `model.ChatTopic.Inherited() model.TopicInheritance`
  - `telegram.resolveMessageTopic(msg *tg.Message, isForum bool) (telegramTopicID int, isForumMessage bool, ok bool)`
  - `telegram.replyToTopID(msg *tg.Message) int`

- [ ] **Step 1: Write failing resolver tests**

```go
func TestResolveMessageTopic(t *testing.T) {
	Convey("论坛消息按 reply header 解析话题 ID", t, func() {
		So(resolveMessageTopic(&tg.Message{ReplyTo: &tg.MessageReplyHeader{
			ReplyToMsgID: 7310786,
			ReplyToTopID: 7310786,
		}}, true), ShouldResolveTo, 7310786, true)
		So(resolveMessageTopic(&tg.Message{ReplyTo: &tg.MessageReplyHeader{
			ReplyToMsgID: 458347,
		}}, true), ShouldResolveTo, 458347, true)
		So(resolveMessageTopic(&tg.Message{ReplyTo: &tg.MessageReplyHeader{
			ReplyToMsgID: 9001,
			ForumTopic:   true,
		}}, true), ShouldResolveTo, 9001, true)
	})
}

func TestResolveMessageTopicGeneralFallback(t *testing.T) {
	Convey("论坛消息没有 reply header 时归入 General", t, func() {
		So(resolveMessageTopic(&tg.Message{}, true), ShouldResolveTo, 1, true)
	})
}

func TestResolveMessageTopicNonForum(t *testing.T) {
	Convey("普通群组不解析话题", t, func() {
		So(resolveMessageTopic(&tg.Message{ReplyTo: &tg.MessageReplyHeader{
			ReplyToMsgID: 10,
			ReplyToTopID: 10,
		}}, false), ShouldResolveTo, 0, false)
	})
}
```

Use explicit assertions in each test so failures are easy to read:

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
docker run --rm -v /home/ubuntu/projects/tgtldr/app:/src -w /src golang:1.25-alpine go test ./internal/telegram -run 'TestResolveMessageTopic'
```

Expected: compile failure because `resolveMessageTopic` is undefined.

- [ ] **Step 3: Add domain types**

In `app/internal/model/types.go` add:

```go
type TopicInheritance struct {
	SummaryTimeLocal bool `json:"summaryTimeLocal"`
	SummaryTimezone  bool `json:"summaryTimezone"`
	ModelOverride    bool `json:"modelOverride"`
	DeliveryMode     bool `json:"deliveryMode"`
	KeepBotMessages  bool `json:"keepBotMessages"`
}

type ChatTopic struct {
	ID               int64     `json:"id"`
	ChatID           int64     `json:"chatId"`
	TelegramTopicID  int64     `json:"telegramTopicId"`
	Title            string    `json:"title"`
	IconColor        int       `json:"iconColor"`
	IconEmojiID      int64     `json:"iconEmojiId"`
	IsClosed         bool      `json:"isClosed"`
	IsPinned         bool      `json:"isPinned"`
	IsDeleted        bool      `json:"isDeleted"`
	Enabled          bool      `json:"enabled"`
	SummaryEnabled   bool      `json:"summaryEnabled"`
	SummaryContext   string    `json:"summaryContext"`
	SummaryPrompt    string    `json:"summaryPrompt"`
	SummaryTimeLocal *string   `json:"-"`
	SummaryTimezone  *string   `json:"-"`
	ModelOverride    *string   `json:"-"`
	DeliveryMode     *string   `json:"-"`
	KeepBotMessages  *bool     `json:"-"`
	FilteredSenders  []string  `json:"filteredSenders"`
	FilteredKeywords []string  `json:"filteredKeywords"`
	FirstSeenAt      time.Time `json:"firstSeenAt"`
	LastSeenAt       time.Time `json:"lastSeenAt"`
	CreatedAt        time.Time `json:"createdAt"`
	UpdatedAt        time.Time `json:"updatedAt"`
}

func (topic ChatTopic) Inherited() TopicInheritance {
	return TopicInheritance{
		SummaryTimeLocal: topic.SummaryTimeLocal == nil,
		SummaryTimezone:  topic.SummaryTimezone == nil,
		ModelOverride:    topic.ModelOverride == nil,
		DeliveryMode:     topic.DeliveryMode == nil,
		KeepBotMessages:  topic.KeepBotMessages == nil,
	}
}
```

Add to `model.Chat`:

```go
IsForum bool        `json:"isForum"`
Topics  []ChatTopic `json:"topics,omitempty"`
```

Add to `model.Message`:

```go
TopicID int64 `json:"topicId"`
```

- [ ] **Step 4: Implement resolver**

Create `app/internal/telegram/forum_topic.go`:

```go
package telegram

import "github.com/gotd/td/tg"

const generalForumTopicID = 1

// resolveMessageTopic 解析论坛消息所属的 Telegram 话题 ID。
// 非论坛消息返回 (0, false, false)，论坛但无法解析时返回 General。
func resolveMessageTopic(msg *tg.Message, isForum bool) (telegramTopicID int, isForumMessage bool, ok bool) {
	if !isForum {
		return 0, false, false
	}
	header, isReplyHeader := msg.ReplyTo.(*tg.MessageReplyHeader)
	if !isReplyHeader || header == nil {
		return generalForumTopicID, true, true
	}
	if header.ReplyToTopID != 0 {
		return header.ReplyToTopID, true, true
	}
	if header.ForumTopic && header.ReplyToMsgID != 0 {
		return header.ReplyToMsgID, true, true
	}
	if header.ReplyToMsgID != 0 {
		return header.ReplyToMsgID, true, true
	}
	return generalForumTopicID, true, true
}

func replyToTopID(msg *tg.Message) int {
	if msg.ReplyTo == nil {
		return 0
	}
	header, ok := msg.ReplyTo.(*tg.MessageReplyHeader)
	if !ok || header == nil {
		return 0
	}
	return header.ReplyToTopID
}
```

- [ ] **Step 5: Run tests and commit**

Run:

```bash
docker run --rm -v /home/ubuntu/projects/tgtldr/app:/src -w /src golang:1.25-alpine go test ./internal/telegram -run 'TestResolveMessageTopic'
```

Expected: `ok`.

```bash
git add app/internal/model/types.go app/internal/telegram/forum_topic.go app/internal/telegram/forum_topic_test.go app/internal/telegram/helpers.go app/internal/telegram/helpers_test.go
git commit -m "feat: add forum topic domain types and resolver"
```

### Task 2: Topic Schema and Repository

**Files:**
- Create: `app/internal/store/migrations/023_chat_topics.sql`
- Create: `app/internal/store/topics_repo.go`
- Create: `app/internal/store/topics_repo_test.go`
- Modify: `app/internal/store/postgres.go`

**Interfaces:**
- Consumes: `model.ChatTopic`, `model.TopicInheritance`.
- Produces:
  - `store.TopicRepository`
  - `(*TopicRepository).UpsertDiscovered(ctx, chatID int64, topic model.ChatTopic) (model.ChatTopic, error)`
  - `(*TopicRepository).ListByChat(ctx, chatID int64) ([]model.ChatTopic, error)`
  - `(*TopicRepository).GetByID(ctx, chatID, topicID int64) (model.ChatTopic, error)`
  - `(*TopicRepository).UpdateSettings(ctx, topic model.ChatTopic) (model.ChatTopic, error)`
  - `(*TopicRepository).ResolveInternalID(ctx, chatID int64, telegramTopicID int64) (int64, error)`
  - `(*TopicRepository).MarkStale(ctx, chatID int64, keepIDs []int64) error`

- [ ] **Step 1: Write failing migration and repository tests**

Create a unit test for inheritance:

```go
func TestChatTopicInherited(t *testing.T) {
	Convey("空的可继承字段标记为继承", t, func() {
		topic := model.ChatTopic{}
		inherited := topic.Inherited()
		So(inherited.SummaryTimeLocal, ShouldBeTrue)
		So(inherited.SummaryTimezone, ShouldBeTrue)
		So(inherited.ModelOverride, ShouldBeTrue)
		So(inherited.DeliveryMode, ShouldBeTrue)
		So(inherited.KeepBotMessages, ShouldBeTrue)
	})
}
```

Add an integration test following the existing `settings_digest_integration_test.go` schema-isolation pattern:

```go
func TestTopicRepositoryResolveAndUpdate(t *testing.T) {
	st := newTestStore(t)
	ctx := context.Background()
	chatID := insertTopicTestChat(t, st)
	created, err := st.Topics.UpsertDiscovered(ctx, chatID, model.ChatTopic{
		TelegramTopicID: 458347,
		Title:           "Technical",
		Enabled:         true,
		SummaryEnabled:  true,
	})
	So(err, ShouldBeNil)

	resolved, err := st.Topics.ResolveInternalID(ctx, chatID, 458347)
	So(err, ShouldBeNil)
	So(resolved, ShouldEqual, created.ID)

	title := "Overridden"
	closed := false
	updated, err := st.Topics.UpdateSettings(ctx, model.ChatTopic{
		ID: created.ID, ChatID: chatID,
		Enabled: false, SummaryEnabled: false,
		SummaryContext: "ctx", SummaryPrompt: "prompt",
		SummaryTimeLocal: nil,
		ModelOverride: &title,
		KeepBotMessages: &closed,
	})
	So(err, ShouldBeNil)
	So(updated.Enabled, ShouldBeFalse)
	So(updated.Inherited().ModelOverride, ShouldBeFalse)
	So(updated.Inherited().SummaryTimeLocal, ShouldBeTrue)
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
docker run --rm -v /home/ubuntu/projects/tgtldr/app:/src -w /src golang:1.25-alpine go test ./internal/store -run 'TestChatTopicInherited|TestTopicRepository'
```

Expected: compile failure because `Store.Topics` is undefined.

- [ ] **Step 3: Add migration**

Create `app/internal/store/migrations/023_chat_topics.sql`:

```sql
create table if not exists chat_topics (
    id bigint primary key generated always as identity,
    chat_id bigint not null references chats(id) on delete cascade,
    telegram_topic_id bigint not null,
    title text not null default '',
    icon_color integer not null default 0,
    icon_emoji_id bigint not null default 0,
    is_closed boolean not null default false,
    is_pinned boolean not null default false,
    is_deleted boolean not null default false,
    enabled boolean not null default true,
    summary_enabled boolean not null default true,
    summary_context text not null default '',
    summary_prompt text not null default '',
    summary_time_local text,
    summary_timezone text,
    model_override text,
    delivery_mode text,
    keep_bot_messages boolean,
    filtered_senders text[] not null default '{}',
    filtered_keywords text[] not null default '{}',
    first_seen_at timestamptz not null default now(),
    last_seen_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (chat_id, telegram_topic_id)
);

alter table chats add column if not exists is_forum boolean not null default false;

alter table messages add column if not exists topic_id bigint not null default 0;

create index if not exists idx_chat_topics_chat
on chat_topics (chat_id, is_deleted, telegram_topic_id);

create index if not exists idx_messages_chat_topic_time
on messages (chat_id, topic_id, message_time);
```

- [ ] **Step 4: Implement repository**

Create `app/internal/store/topics_repo.go` with repository methods listed in Interfaces. Use `pgx.ErrNoRows` for missing rows. Scan nullable fields into pointers. When upserting discovered metadata, preserve user settings:

```sql
insert into chat_topics (chat_id, telegram_topic_id, title, icon_color, icon_emoji_id, is_closed, is_pinned)
values ($1, $2, $3, $4, $5, $6, $7)
on conflict (chat_id, telegram_topic_id) do update
set title = excluded.title,
    icon_color = excluded.icon_color,
    icon_emoji_id = excluded.icon_emoji_id,
    is_closed = excluded.is_closed,
    is_pinned = excluded.is_pinned,
    is_deleted = false,
    last_seen_at = now(),
    updated_at = now()
returning ...
```

For General topic insertion, use title `General`.

`MarkStale` must only update rows whose `telegram_topic_id` is not in `keepIDs`, and must not touch `enabled` or `summary_enabled`.

- [ ] **Step 5: Register repository**

Add to `Store`:

```go
Topics *TopicRepository
```

Initialize in `Open`:

```go
Topics: &TopicRepository{pool: pool},
```

- [ ] **Step 6: Run tests and commit**

Run:

```bash
docker run --rm -v /home/ubuntu/projects/tgtldr/app:/src -w /src golang:1.25-alpine go test ./internal/store -run 'TestChatTopicInherited|TestTopicRepository'
```

Expected: PASS.

```bash
git add app/internal/store/migrations/023_chat_topics.sql app/internal/store/topics_repo.go app/internal/store/topics_repo_test.go app/internal/store/postgres.go app/internal/model/types.go
git commit -m "feat: persist telegram forum topics"
```

### Task 3: Telegram Discovery and Message Attribution

**Files:**
- Modify: `app/internal/telegram/service.go`
- Modify: `app/internal/telegram/history_backfill.go`
- Modify: `app/internal/telegram/helpers.go`
- Modify: `app/internal/telegram/helpers_test.go`
- Modify: `app/internal/telegram/history_backfill_test.go`
- Create: `app/internal/telegram/forum_topics.go`
- Create: `app/internal/telegram/forum_topics_test.go`
- Modify: `app/internal/model/types.go`

**Interfaces:**
- Consumes: `resolveMessageTopic`, `store.Topics`.
- Produces:
  - `telegram.topicSyncResult`
  - `(*Service).syncForumTopics(ctx, api *tg.Client, chat model.Chat) ([]model.ChatTopic, error)`
  - `(*Service).resolveTopicID(ctx, chat model.Chat, msg *tg.Message) (int64, error)`
  - `model.Message.TopicID`

- [ ] **Step 1: Write failing tests for topic attribution**

Add to `helpers_test.go`:

```go
func TestMessageTopicIDs(t *testing.T) {
	Convey("论坛消息保留话题信息并可被历史回补复用", t, func() {
		chat := model.Chat{ID: 10, Title: "ja-netfilter"}
		msg := &tg.Message{
			ID: 2001, Date: 1_700_000_000, Message: "hello",
			PeerID: &tg.PeerChannel{ChannelID: 1680975844},
			ReplyTo: &tg.MessageReplyHeader{
				ReplyToMsgID: 458347, ReplyToTopID: 458347,
			},
		}
		topicID, isForumMessage, ok := resolveMessageTopic(msg, true)
		So(topicID, ShouldEqual, 458347)
		So(isForumMessage, ShouldBeTrue)
		So(ok, ShouldBeTrue)
		_ = chat
	})
}
```

Add to `history_backfill_test.go` a pure test that `historyElemToMessage` copies the resolved raw topic id into a new field:

```go
func TestHistoryElemToMessageIncludesTopicID(t *testing.T) {
	Convey("历史回补消息携带话题 ID", t, func() {
		chat := model.Chat{ID: 10, ChatType: "supergroup", Title: "ja-netfilter"}
		elem := messagesquery.Elem{Msg: &tg.Message{
			ID: 77, Date: 1_700_000_000, Message: "hello",
			PeerID: &tg.PeerChannel{ChannelID: 1680975844},
			ReplyTo: &tg.MessageReplyHeader{
				ReplyToMsgID: 458347, ReplyToTopID: 458347,
			},
		}}
		item, ok := historyElemToMessage(chat, elem)
		So(ok, ShouldBeTrue)
		So(item.TelegramTopicID, ShouldEqual, 458347)
	})
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
docker run --rm -v /home/ubuntu/projects/tgtldr/app:/src -w /src golang:1.25-alpine go test ./internal/telegram -run 'TestMessageTopicIDs|TestHistoryElemToMessageIncludesTopicID'
```

Expected: compile failure because `TelegramTopicID` is undefined on `model.Message`.

- [ ] **Step 3: Add message topic metadata**

Add to `model.Message`:

```go
TelegramTopicID int `json:"telegramTopicId"`
TopicID         int64 `json:"topicId"`
```

In `historyElemToMessage`, set:

```go
telegramTopicID, _, _ := resolveMessageTopic(msg, chat.ChatType == "supergroup" && chat.IsForum)
```

and include `TelegramTopicID: telegramTopicID`.

In `dialogToChat`, set `IsForum: channel.Forum` when using `tg.Channel`.

- [ ] **Step 4: Implement discovery**

Create `forum_topics.go`:

```go
type topicSyncResult struct {
	Topics  []model.ChatTopic
	Partial bool
}

func (s *Service) syncForumTopics(ctx context.Context, client *tg.Client, chat model.Chat) (topicSyncResult, error) {
	inputPeer := &tg.InputPeerChannel{
		ChannelID:  chat.TelegramChatID,
		AccessHash: chat.TelegramAccess,
	}
	result := topicSyncResult{Topics: make([]model.ChatTopic, 0)}
	topics, err := client.MessagesGetForumTopics(ctx, &tg.MessagesGetForumTopicsRequest{
		Peer:  inputPeer,
		Limit: 100,
	})
	if err != nil {
		return result, err
	}
	for _, topicClass := range topics.GetTopics() {
		topic, ok := topicClass.(*tg.ForumTopic)
		if !ok {
			continue
		}
		result.Topics = append(result.Topics, model.ChatTopic{
			TelegramTopicID: int64(topic.ID),
			Title:           topic.Title,
			IconColor:       topic.IconColor,
			IsClosed:        topic.Closed,
			IsPinned:        topic.Pinned,
			Enabled:         true,
			SummaryEnabled:  true,
		})
	}
	return result, nil
}
```

If the generated response does not expose `GetTopics()`, inspect the pinned generated type and use its actual accessor or fields. Do not guess at runtime shape.

- [ ] **Step 5: Wire discovery into SyncChats**

Change the loop inside `client.Run` to keep the client accessible, then after `EnsureExists`:

```go
if chat.IsForum {
    result, syncErr := s.syncForumTopics(ctx, client.API(), stored)
    if syncErr != nil {
        log.Printf("sync forum topics for %s: %v", chat.Title, syncErr)
    } else {
        keepIDs := make([]int64, 0, len(result.Topics))
        for _, topic := range result.Topics {
            saved, err := s.store.Topics.UpsertDiscovered(ctx, stored.ID, topic)
            if err != nil {
                return err
            }
            keepIDs = append(keepIDs, saved.TelegramTopicID)
        }
        if !result.Partial {
            if err := s.store.Topics.MarkStale(ctx, stored.ID, keepIDs); err != nil {
                return err
            }
        }
    }
}
```

Add a synthesized General topic when `chat.IsForum` and no returned topic has ID 1:

```go
result.Topics = append(result.Topics, model.ChatTopic{
    TelegramTopicID: 1,
    Title:           "General",
    Enabled:         true,
    SummaryEnabled:  true,
})
```

- [ ] **Step 6: Attribute stored messages**

Add `resolveTopicID`:

```go
func (s *Service) resolveTopicID(ctx context.Context, chat model.Chat, msg *tg.Message) (int64, error) {
	_ = ctx
	if !chat.IsForum {
		return 0, nil
	}
	telegramTopicID, _, ok := resolveMessageTopic(msg, true)
	if !ok {
		return 0, nil
	}
	return s.store.Topics.ResolveInternalID(ctx, chat.ID, int64(telegramTopicID))
}
```

In `storeIncomingMessage`, after resolving `chat` and before constructing `model.Message`:

```go
topicID, err := s.resolveTopicID(ctx, chat, msg)
if err != nil {
    log.Printf("resolve topic for message %d in chat %d: %v", msg.ID, chat.ID, err)
    topicID = 0
}
```

Set `TelegramTopicID` and `TopicID` on the item. In non-forum chats both remain zero.

In `historyElemToMessage`, resolve the raw Telegram topic ID and let the caller map it to the internal ID before `Upsert`.

- [ ] **Step 7: Update message repository for topic ID**

Add `topic_id` to the insert column list, values, and conflict update:

```sql
insert into messages (..., topic_id, ...) values (..., $15, ...)
on conflict (chat_id, telegram_message_id) do update
set ..., topic_id = excluded.topic_id, ...
```

- [ ] **Step 8: Run tests and commit**

Run:

```bash
docker run --rm -v /home/ubuntu/projects/tgtldr/app:/src -w /src golang:1.25-alpine go test ./internal/telegram ./internal/store
```

Expected: PASS.

```bash
git add app/internal/model/types.go app/internal/telegram app/internal/store/messages_repo.go
git commit -m "feat: attribute telegram messages to forum topics"
```

### Task 4: Topic-Aware Chat and Message APIs

**Files:**
- Modify: `app/internal/api/router.go`
- Modify: `app/internal/api/chat_messages.go`
- Modify: `app/internal/api/chat_message_search.go`
- Modify: `app/internal/store/messages_repo.go`
- Modify: `app/internal/store/messages_search.go`
- Modify: `app/internal/store/chats_repo.go`
- Create: `app/internal/api/topics.go`
- Create: `app/internal/api/topics_test.go`
- Modify: `web/lib/types.ts`
- Modify: `web/lib/api.ts`

**Interfaces:**
- Consumes: `store.Topics`, `model.ChatTopic`.
- Produces:
  - `GET /api/chats?includeTopics=true`
  - `POST /api/chats/{chatID}/topics/sync`
  - `PATCH /api/chats/{chatID}/topics/{topicID}`
  - `topicId` query support on message APIs
  - `api.listChats({ includeTopics: true })`
  - `api.syncChatTopics(chatId)`
  - `api.saveChatTopic(chatId, topic)`

- [ ] **Step 1: Write failing API tests**

Create `topics_test.go` with tests for:

- topic ID must belong to the chat;
- invalid topic ID returns `400`;
- `includeTopics=true` attaches topic arrays;
- PATCH preserves omitted fields.

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
docker run --rm -v /home/ubuntu/projects/tgtldr/app:/src -w /src golang:1.25-alpine go test ./internal/api -run 'TestTopic'
```

Expected: compile failure because the handlers and routes are undefined.

- [ ] **Step 3: Add read support**

In `handleChats`, parse `includeTopics`. When true, load topics for all chats in one query or with a bounded repository method and attach them. Do not make one query per chat.

Extend `MessageSearchParams` with:

```go
TopicID int64
```

Add `m.topic_id = $n` when `TopicID > 0`. Add `topicId` support to `ListForRange`, `ListPageForRange`, `ListWindowAround`, `LatestDateAtOrBefore`, `AdjacentDates`, `ActivityForRange`, and `CountForRange` without changing the default when topic is omitted.

- [ ] **Step 4: Add topic routes**

Add route registrations:

```go
mux.HandleFunc("POST /api/chats/{chatID}/topics/sync", r.handleSyncChatTopics)
mux.HandleFunc("PATCH /api/chats/{chatID}/topics/{topicID}", r.handleSaveChatTopic)
```

The sync handler loads the chat, calls the Telegram service, then returns the updated topic list. If Telegram is unavailable, return a localized 502 with an actionable message.

The PATCH handler decodes only topic settings and calls `Topics.UpdateSettings`.

- [ ] **Step 5: Add frontend types and API**

Add to `Chat`:

```ts
isForum?: boolean;
topics?: ChatTopic[];
```

Add:

```ts
export type ChatTopic = {
  id: number;
  chatId: number;
  telegramTopicId: number;
  title: string;
  iconColor: number;
  iconEmojiId: number;
  isClosed: boolean;
  isPinned: boolean;
  isDeleted: boolean;
  enabled: boolean;
  summaryEnabled: boolean;
  summaryContext: string;
  summaryPrompt: string;
  filteredSenders: string[];
  filteredKeywords: string[];
  inherited: {
    summaryTimeLocal: boolean;
    summaryTimezone: boolean;
    modelOverride: boolean;
    deliveryMode: boolean;
    keepBotMessages: boolean;
  };
};
```

Add API methods:

```ts
listChats: async (options?: { includeTopics?: boolean }) => ...
syncChatTopics: (chatId: number) => request<ChatTopic[]>(`...`, { method: "POST" })
saveChatTopic: (chatId: number, topic: ChatTopic) => request<ChatTopic>(...)
```

- [ ] **Step 6: Run tests and commit**

Run:

```bash
docker run --rm -v /home/ubuntu/projects/tgtldr/app:/src -w /src golang:1.25-alpine go test ./internal/api ./internal/store
```

Expected: PASS.

```bash
git add app/internal/api app/internal/store/messages_repo.go app/internal/store/messages_search.go app/internal/store/chats_repo.go web/lib/types.ts web/lib/api.ts
git commit -m "feat: expose topic-aware chat and message APIs"
```

### Task 5: Hierarchical Chats UI

**Files:**
- Modify: `web/components/chats-panel.tsx`
- Modify: `web/lib/i18n.tsx`
- Modify: `web/app/globals.css`
- Create: `web/components/topic-settings-drawer.tsx`

**Interfaces:**
- Consumes: `Chat.isForum`, `Chat.topics`, topic API methods.
- Produces:
  - expandable forum rows
  - topic child rows
  - topic sync action
  - topic settings drawer with inheritance labels

- [ ] **Step 1: Add failing behavior checks**

Add a small pure helper and tests if a test runner is available. Because this project has no frontend unit test script, verify behavior with TypeScript build and Playwright checks:

- forum row exposes `aria-expanded`;
- expanding it renders child rows;
- parent toggle does not change child toggle text;
- topic drawer marks inherited fields.

Add stable test IDs:

```tsx
data-testid={`forum-row-${chat.id}`}
data-testid={`topic-row-${chat.id}-${topic.id}`}
data-testid="topic-settings-drawer"
```

- [ ] **Step 2: Run the build to verify the baseline fails**

Run:

```bash
docker run --rm -v /home/ubuntu/projects/tgtldr:/src -w /src/web node:24-alpine sh -c 'npm ci --prefer-offline >/dev/null && npm run build'
```

Expected: currently PASS for the baseline; after adding missing imports or types, the first build fails.

- [ ] **Step 3: Implement the tree table**

In `ChatsPanel`:

- call `api.listChats({ includeTopics: true })`;
- track `expandedChats` as a `Set<number>`;
- render parent forum row with a disclosure button;
- render topic rows immediately after the expanded parent row;
- show `Forum · N topics` badge;
- show a sync button for forum chats;
- keep history backfill and settings actions on the parent chat;
- add topic collection and summary toggles as immediate PATCH actions.

Do not render the old full editor for every topic.

- [ ] **Step 4: Implement the topic drawer**

Create `topic-settings-drawer.tsx` with:

- scope header `chat / topic`;
- inheritance badges for nullable fields;
- fields for summary context, prompt, filters, model override;
- save and cancel actions;
- loading and error states.

Use the existing `Drawer`, `Field`, `Input`, `Textarea`, and `Button` components.

- [ ] **Step 5: Add translations and styles**

Add every new visible string to `web/lib/i18n.tsx`. Add CSS for:

- disclosure button;
- indented topic row;
- forum badge;
- topic status chips;
- inheritance label;
- drawer layout.

Keep the existing editorial style and do not introduce a new design system.

- [ ] **Step 6: Run build and commit**

Run:

```bash
docker run --rm -v /home/ubuntu/projects/tgtldr:/src -w /src/web node:24-alpine sh -c 'npm ci --prefer-offline >/dev/null && npm run build'
```

Expected: PASS.

```bash
git add web/components/chats-panel.tsx web/components/topic-settings-drawer.tsx web/lib/i18n.tsx web/app/globals.css
git commit -m "feat: manage forum topics from the chats page"
```

### Task 6: Verification and Rollout

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `CHANGELOG.en.md`

**Interfaces:**
- Consumes: all previous tasks.
- Produces: a verified, deployable phase 1.

- [ ] **Step 1: Run backend tests**

Run:

```bash
docker run --rm -v /home/ubuntu/projects/tgtldr/app:/src -w /src golang:1.25-alpine go test ./...
```

Expected: PASS.

- [ ] **Step 2: Build frontend**

Run:

```bash
docker run --rm -v /home/ubuntu/projects/tgtldr:/src -w /src/web node:24-alpine sh -c 'npm ci --prefer-offline >/dev/null && npm run build'
```

Expected: PASS.

- [ ] **Step 3: Build the application image**

Run:

```bash
docker compose -f docker-compose.dev.yml build app web
```

Expected: both images build successfully.

- [ ] **Step 4: Apply migration and verify data**

Restart the app and query:

```bash
docker compose up -d app
docker exec tgtldr-postgres-1 psql -U postgres -d tgtldr -c "select column_name from information_schema.columns where table_name='chat_topics' order by ordinal_position;"
docker exec tgtldr-postgres-1 psql -U postgres -d tgtldr -c "select count(*) from chat_topics;"
```

Expected: the new table exists and the migration is recorded.

- [ ] **Step 5: Verify the real forum**

Use the authenticated Telegram account to sync `ja-netfilter` and confirm:

- `is_forum = true`;
- topic count is at least 3;
- General, technical, and role-play topics are present;
- new messages get non-zero `topic_id`;
- non-forum messages retain `topic_id = 0`.

- [ ] **Step 6: Update changelogs and commit**

Add matching Chinese and English entries under `2026-10-25`:

```markdown
### 新增

- 支持识别 Telegram 论坛超级群的话题，并可按话题管理消息保存与 AI 总结。
```

```markdown
### Added

- Support Telegram forum topics and per-topic message collection and AI summary settings.
```

Run:

```bash
git add CHANGELOG.md CHANGELOG.en.md
git commit -m "docs: record forum topic support"
```
