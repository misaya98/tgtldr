# Forum Topics and Reading Workspace Design

Date: 2026-10-25
Status: Proposed
Selected approach: Option A — domain model first, interaction evolution second, message-level evidence tracing last

## 1. Problem

TGTLDR currently models every Telegram group or supergroup as one flat `Chat`.
Messages are stored under that chat, one daily summary is produced per chat and
date, and the UI exposes the chat as a single timeline.

This breaks down for Telegram forum supergroups. A forum contains independent
topics with sharply different value and volume. In the verified
`ja-netfilter` case, one role-playing topic accounts for roughly 72% of all
messages and dominates summaries and token usage. Keyword filtering remains a
workaround because the system lacks topic identity.

The current design also makes evidence checking expensive: a reader must leave
the summary, navigate to the chat, choose a date, and search for the original
message.

The selected approach fixes the domain model before changing the layout:

1. Topic-aware ingestion and management.
2. Summary reading workspace and hierarchical filtering.
3. Message-level evidence tracing.
4. Visual and efficiency refinements.

The work must preserve current behavior for non-forum chats and for existing
summaries.

## 2. Goals

- Discover Telegram forum topics and persist their identity and metadata.
- Attribute new and backfilled messages to the correct topic without duplicates.
- Allow message collection and AI summary settings per topic.
- Keep an explicit chat-level aggregate summary and an explicit whole-chat view.
- Make topic selection consistent across chat management, summaries, message
  history, manual runs, Catch Up, and Daily Digest.
- Introduce a summary reading workspace that is usable on wide, medium, and
  narrow screens.
- Keep evidence tracing as a separate capability so layout work does not depend
  on an unvalidated citation pipeline.
- Preserve existing non-forum chats, summaries, URLs where possible, and Bot
  delivery behavior.

## 3. Non-goals

- Splitting a Telegram forum into multiple `Chat` records.
- Treating a Telegram topic as an independent Telegram peer.
- Replacing the existing authentication, Bot, or scheduler architecture.
- Adding message-level citations in this phase.
- Adding Dark Mode in the initial phases.
- Adding batch operations or global keyboard shortcuts in the initial phases.
- Supporting forum topics for a collector account that cannot access the forum.

## 4. Terminology

- **Chat**: the Telegram group, supergroup, or channel represented by one row in
  `chats`. A forum supergroup is one Chat.
- **Topic**: a Telegram Forum Topic inside a forum supergroup. The General topic
  has topic ID `1`. Non-forum chats have no topic rows.
- **Scope**: the unit used for reading or summary generation. Supported scopes
  are `chat` (whole-chat aggregate) and `topic`.
- **Chat aggregate summary**: a whole-chat summary derived from topic summaries,
  not directly from raw messages, for forum chats.
- **Topic summary**: a daily summary for one topic.
- **Unscoped summary**: an existing or non-forum summary for a whole chat.

The UI must call these “话题” / “Topics”, never “子群组” / “subgroups”.

## 5. Domain Model

### 5.1 Schema

Add a `chat_topics` table:

| Column | Type | Notes |
| --- | --- | --- |
| `id` | bigint identity | Internal stable ID |
| `chat_id` | bigint | References `chats(id)` |
| `telegram_topic_id` | bigint | Telegram topic ID; General is `1` |
| `title` | text | Default `General` for ID `1` when Telegram omits it |
| `icon_color` | integer | Telegram fallback color |
| `icon_emoji_id` | bigint | Optional custom emoji ID |
| `is_closed` | boolean | Telegram topic closure state |
| `is_pinned` | boolean | Presentation metadata |
| `enabled` | boolean | Whether new messages are collected |
| `summary_enabled` | boolean | Whether the topic produces summaries |
| `summary_context` | text | Topic-specific context |
| `summary_prompt` | text | Topic-specific extra prompt |
| `summary_time_local` | text nullable | `NULL` means inherit from chat |
| `summary_timezone` | text nullable | `NULL` means inherit from chat |
| `model_override` | text nullable | `NULL` means inherit from chat/settings |
| `delivery_mode` | text nullable | `NULL` means inherit from chat |
| `keep_bot_messages` | boolean nullable | `NULL` means inherit from chat |
| `filtered_senders` | text[] | Topic-specific additions |
| `filtered_keywords` | text[] | Topic-specific additions |
| `first_seen_at` | timestamptz | Discovery time |
| `last_seen_at` | timestamptz | Last successful sync |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

Constraints:

```sql
unique (chat_id, telegram_topic_id)
```

Add topic identity to messages:

```sql
alter table messages
add column topic_id bigint not null default 0;
```

`topic_id` uses the internal `chat_topics.id`, not the raw Telegram topic ID.
`0` means no topic scope. This avoids exposing Telegram IDs to API consumers and
keeps joins simple. Add an index for topic-aware reads:

```sql
create index messages_chat_topic_time
on messages (chat_id, topic_id, message_time);
```

Keep the existing unique constraint `(chat_id, telegram_message_id)`. Telegram
message IDs are unique within the channel/supergroup, not within each topic.
When a message is first stored unscoped and its topic is resolved later, the
upsert must update `topic_id` on the existing row rather than insert a duplicate.
For non-forum chats, `topic_id` remains `0`.

Add topic scope to summaries:

```sql
alter table summaries
add column topic_id bigint not null default 0;

alter table summaries
add column scope text not null default 'chat';
```

Effective summary identities:

- `scope = 'chat'`, `topic_id = 0`: existing whole-chat or non-forum summary.
- `scope = 'topic'`, `topic_id > 0`: topic summary.
- `scope = 'aggregate'`, `topic_id = 0`: derived whole-chat summary for a forum.

Replace the old unique constraint with:

```sql
unique (chat_id, topic_id, scope, summary_date)
```

Keep legacy rows as `scope = 'chat'`, `topic_id = 0`.

### 5.2 Topic states

- A forum chat may have zero topic rows before the first successful topic sync.
- A chat is treated as a forum only after Telegram reports it as a forum and
  topic discovery succeeds.
- Topics absent from discovery are marked stale, not deleted. Stale topics remain
  readable and retain messages and summaries.
- A topic reappearing later is reactivated by its `(chat_id, telegram_topic_id)`
  identity.
- Deleted Telegram topics keep historical data but cannot collect new messages.
- A closed topic may keep collecting existing history during backfill but is
  shown as closed.

### 5.3 Topic inheritance

Topic settings inherit from the parent chat unless explicitly overridden.

- `model_override`: `NULL` means inherit.
- `summary_context` and `summary_prompt`: the effective prompt is parent context
  plus topic context, with topic instructions appended last.
- `summary_time_local` and `summary_timezone`: `NULL` means inherit; changing
  the parent affects only topics that still inherit.
- Sender and keyword filters: union of parent and topic filters.
- `delivery_mode`: `NULL` means use the parent chat setting.
- `keep_bot_messages`: parent value unless explicitly overridden.

The UI must show whether a field is inherited or overridden. It must not silently
copy all parent values into every topic row. For fields that support inheritance,
`NULL` in the database is the single source of truth for "inherit".

### 5.4 Collection semantics

- A non-forum chat stores messages with `topic_id = 0`.
- A forum chat stores each message under its resolved topic.
- If topic resolution fails, the message must be stored with `topic_id = 0` and
  flagged for reconciliation. It must not be dropped.
- `chats.enabled` is the master switch for the Telegram chat.
- A topic collects only when both the parent chat and topic are enabled.
- Disabling the parent does not mutate child topic rows. Re-enabling the parent
  restores only topics still individually enabled.
- Disabling a topic does not delete its messages or summaries.

## 6. Telegram Ingestion

### 6.1 Topic discovery

During `SyncChats`, after a chat is identified as a forum:

1. Call `messages.getForumTopics` with the forum peer.
2. Paginate using `offset_date`, `offset_id`, `offset_topic`, and `limit`.
3. Upsert topics by `(chat_id, telegram_topic_id)`.
4. Include a synthesized General topic with ID `1` when Telegram omits it from
   the returned list.
5. Mark topics not returned by a complete successful pass as stale.
6. Never mark topics stale on a partial or failed pass.
7. Treat `ForumTopicDeleted` entries as deleted: retain history, block new
   collection, and show the topic as deleted.

The server must use the local gotd version's generated
`tg.MessagesGetForumTopicsRequest` API. It must not depend on a higher-level
wrapper unless that wrapper already exists in the pinned dependency.

### 6.2 Per-message topic resolution

The authoritative source is the message reply header:

- If `ReplyTo` is `*tg.MessageReplyHeader` and `ReplyToTopID != 0`, that value is
  the Telegram topic ID. This covers replies inside a topic.
- If `ReplyTo` is `*tg.MessageReplyHeader`, `ReplyToTopID == 0`, and
  `ReplyToMsgID != 0`, the message belongs to the topic whose root message ID is
  `ReplyToMsgID`. This covers the topic root message and simple replies.
- If `ForumTopic == true` and only `ReplyToMsgID` is present, use
  `ReplyToMsgID` as the topic ID.
- For a forum message without a reply header, resolve the General topic as
  Telegram topic ID `1`.
- For a non-forum chat, topic ID is `0`.

The resolver must be a pure function with unit tests. It should return:

```text
telegramTopicID int
isForumMessage  bool
ok              bool
```

The resolver must not guess a topic from text, sender, or message content.

### 6.3 Store insertion

`storeIncomingMessage` and `historyElemToMessage` must resolve the topic before
writing. The insertion path should:

1. Look up the internal topic ID from the cached `(chat_id, telegram_topic_id)`.
2. Use `0` when the topic is not yet known and enqueue a lightweight
   reconciliation.
3. Upsert using `(chat_id, topic_id, telegram_message_id)`.

Topic discovery and message ingestion share one process-local cache with a
bounded TTL. A discovery failure must not block message storage.

### 6.4 Historical backfill

- Backfill remains chat-based at the API boundary for compatibility.
- For forum chats, backfill into topic-aware storage when an effective topic
  scope is selected.
- A whole-chat backfill stores all topics while respecting parent and topic
  collection switches.
- Re-running a topic backfill must be idempotent.
- After backfill, only regenerate summaries for scopes whose stored message set
  actually changed.

### 6.5 Filtering

- Existing parent filters still apply.
- Effective filters are the union of parent and topic filters.
- A topic-specific filter must not mutate the parent lists.
- Filtering happens before summary transcript construction.
- A filtered-out message remains stored unless collection itself is disabled.

## 7. Summary Semantics

### 7.1 Summary scopes

For forum chats, the canonical daily flow is:

```text
raw messages
  -> topic summaries
  -> chat aggregate summary (derived from topic summaries)
  -> Daily Digest
```

Rules:

- Topic summaries consume raw messages.
- Chat aggregate summaries consume successful topic summaries only.
- Daily Digest consumes exactly one effective source per chat:
  - the chat aggregate summary for a forum with topic summaries enabled; or
  - the existing whole-chat summary for a non-forum chat.
- Daily Digest must never include both a chat aggregate and the same chat's
  topic summaries.
- Catch Up consumes already generated summaries; it does not read raw messages.
- If a topic summary is missing or failed, the chat aggregate is incomplete and
  must say so through structured omission metadata.

### 7.2 Topic summary

- Input: messages for `(chat_id, topic_id)` in the configured local day.
- Prompt: parent context plus topic context plus topic instructions.
- Source message count: filtered topic messages.
- Model: topic override, then chat override, then global setting.
- Retry, delivery, and failure snapshots follow the existing summary rules.
- Summary references to raw messages are not added in this phase.

### 7.3 Chat aggregate summary

- Input: topic summaries for the date, ordered by topic order and title.
- Input must not contain raw topic transcripts.
- If there are no topic summaries, return an explicit empty aggregate, not a
  hallucinated summary.
- Store per-source inclusion, omission reason, source message count, and topic
  title.
- A failed or empty topic is reported as an omission in metadata, not silently
  treated as a successful empty topic.
- The aggregate is invalidated when its source topic summaries change.

### 7.4 Non-forum chats

Non-forum chats continue to use the existing whole-chat flow:

```text
raw messages -> whole-chat summary -> Daily Digest
```

No synthetic topic is created for these chats.

### 7.5 Daily Digest and Catch Up compatibility

- Existing `daily_digest_sources` and `catch_up_sources` remain keyed by
  `summary_id`, with added canonical scope metadata.
- Every selected chat contributes one effective source, never two.
- A source's display label is:
  - chat title for non-forum;
  - `chat title · topic title` for topic scope;
  - chat title for aggregate scope.
- Existing delivery source citation labels remain valid.
- When repairing an old digest, legacy whole-chat summaries are used unchanged.

## 8. API Design

### 8.1 Response compatibility

All existing `Chat` fields remain. Add optional fields:

```json
{
  "isForum": true,
  "topics": [
    {
      "id": 42,
      "telegramTopicId": 458347,
      "title": "技术交流",
      "iconColor": 7300850,
      "iconEmojiId": 0,
      "isClosed": false,
      "isPinned": true,
      "enabled": true,
      "summaryEnabled": true,
      "inherited": {
        "summaryTimeLocal": true,
        "summaryTimezone": true,
        "modelOverride": true,
        "deliveryMode": true
      }
    }
  ]
}
```

`topics` is empty for non-forum chats and for forum chats before discovery.
Existing clients must continue to work because the new fields are optional.

### 8.2 Endpoints

Add:

```text
POST /api/chats/{chatID}/topics/sync
PATCH /api/chats/{chatID}/topics/{topicID}
GET  /api/chats/{chatID}/topics/{topicID}/messages
```

Extend:

```text
GET /api/chats?includeTopics=true
GET /api/messages/search?topicId=...
GET /api/chats/{chatID}/messages/search?topicId=...
GET /api/chats/{chatID}/messages?topicId=...
POST /api/summaries/run              body: { chatId, topicId?, date, scope? }
GET  /api/summaries?chatId=...&topicId=...&scope=...
```

Rules:

- Omitting `topicId` means no topic filter for reads.
- `topicId=0` means unscoped or whole-chat reads, depending on `scope`.
- `scope` must be one of `chat`, `topic`, `aggregate`, or omitted.
- For a forum, `scope=chat` and `scope=aggregate` must not be silently treated
  as aliases. The UI must choose one explicitly.
- Invalid or stale topic IDs return `404`, not an empty result.
- A topic belonging to another chat returns `404`.

### 8.3 Mutation semantics

- Topic PATCH is partial.
- Empty string or null clears an override and restores inheritance where the
  field supports inheritance.
- Parent chat changes must not overwrite existing explicit topic overrides.
- Topic sync is idempotent.
- Topic sync returns the resulting topic list.

## 9. UI and Interaction Design

### 9.1 Phase 1: hierarchical chat management

The Chats page keeps its table and metric cards but becomes a tree table:

- A non-forum chat is one row.
- A forum chat is a parent row with:
  - a disclosure control;
  - a `Forum · N topics` badge;
  - a `Sync topics` action;
  - parent-level collection and summary controls.
- Expanded child rows show:
  - topic title and icon;
  - closed and stale state;
  - collection switch;
  - summary switch;
  - edit action opening the existing settings drawer scoped to the topic.
- Parent-level toggles control the master switch only. They do not overwrite
  child values.
- Child rows use indentation and a clear parent-child connector.
- All visible strings require both Chinese and English translations.

The existing expandable edit form is not duplicated for every topic. Reuse the
settings drawer with a scope header and inheritance labels.

### 9.2 Phase 1: hierarchical selectors

Every chat selector that can target summaries or messages uses a shared grouped
selector:

```text
All chats
├─ CLIProxyAPI
├─ Waka AI
└─ ja-netfilter
   ├─ Whole chat
   ├─ General
   ├─ Technical discussion
   └─ Role-play (summary off)
```

Requirements:

- Group headings are not selectable.
- Disabled or stale topics remain visible but are visually marked.
- Search matches topic titles and parent chat titles.
- Keyboard navigation supports opening groups and selecting options.
- The selected value is represented by stable internal IDs, not titles.

### 9.3 Phase 2: summaries workspace

Use a dedicated reading workspace only for the Summaries area:

- Global navigation remains a compact rail.
- A summary list occupies the left reading column.
- The reader occupies the main reading column.
- Evidence is a separate panel or drawer, not permanent empty space.

Wide screens:

```text
global nav | summary list | reader | evidence drawer (on demand)
```

Medium screens:

```text
global nav | summary list / reader
```

Narrow screens:

```text
single-column list -> full-page reader -> evidence drawer
```

The layout must not permanently reserve an empty third column.

Reader requirements:

- Breadcrumb: `chat / topic / date`.
- Table of contents from Markdown headings.
- Copy Markdown and open-source-context actions.
- Full-width toggle where the viewport permits.
- Deep links that preserve `chat`, `topic`, `scope`, `date`, and summary ID.
- Empty, loading, stale, and error states.
- Browser back returns to the previously selected summary.

URL contract:

```text
/dashboard/summaries?chat=10&topic=42&scope=topic&date=2026-10-25&summary=123
```

Non-forum chats use `topic=0&scope=chat`.

### 9.4 Phase 3: evidence tracing

Do not ship clickable evidence until all of the following exist:

- Stable message references in the summary prompt.
- A persisted `summary_message_refs` mapping.
- Server-side validation that every rendered reference belongs to the summary.
- A message-context endpoint that returns the referenced message and neighbors.
- A UX state for unresolved or stale references.

Suggested mapping:

```sql
create table summary_message_refs (
  summary_id bigint not null,
  ref text not null,
  message_id bigint not null,
  primary key (summary_id, ref)
);
```

Evidence panel:

- Opens from a valid inline reference.
- Shows the original message, sender, time, topic, and nearby context.
- Keeps the reader's scroll position.
- Offers “open full day” and “search this topic”.
- Does not fabricate a source when the reference is missing.

### 9.5 Phase 4: visual and efficiency refinements

- Dark Mode with the existing warm editorial identity preserved.
- Batch topic operations with explicit impact confirmation.
- Keyboard shortcuts.
- Richer connectivity diagnostics.
- Saved views.

These must not block Phases 1–3.

## 10. Data Flow

### 10.1 Discovery

```text
Telegram dialogs
  -> detect forum
  -> messages.getForumTopics
  -> upsert chat_topics
  -> invalidate topic cache
```

### 10.2 Ingestion

```text
Telegram update
  -> resolve chat
  -> resolve forum topic from reply header
  -> map raw topic ID to internal topic ID
  -> enforce parent/topic collection switches
  -> upsert message
```

### 10.3 Summary generation

```text
scheduler
  -> select due chat and topic scopes
  -> build topic transcripts
  -> generate topic summaries
  -> build aggregate from topic summaries
  -> build Daily Digest from one effective source per chat
  -> deliver
```

### 10.4 Reading

```text
summary list filters
  -> select chat/topic/scope/date
  -> load summary
  -> render reader
  -> optional evidence lookup
```

## 11. Error Handling

- Topic discovery failure: keep the chat functional, show a warning, allow retry.
- Topic mapping failure: store the message unscoped and schedule reconciliation.
- Partial topic sync: do not mark missing topics stale.
- Unknown topic at read time: return `404` and remove the stale selection.
- Parent disabled: reads remain available; new collection is blocked.
- Topic disabled: reads remain available; new collection and new summaries are
  blocked.
- Aggregate input incomplete: produce a partial aggregate with structured
  omission metadata, never silently omit the topic.
- Duplicate source in Digest: reject at construction time.
- Legacy summary without scope: treat as `scope=chat`, `topic_id=0`.
- Citation mapping missing: render plain text, not a broken link.

## 12. Migration and Rollout

### 12.1 Database migration

1. Create `chat_topics`.
2. Add `messages.topic_id` with default `0`.
3. Add `summaries.topic_id` and `summaries.scope` with defaults.
4. Replace message and summary unique constraints.
5. Add indexes for `(chat_id, topic_id, message_time)` and
   `(chat_id, topic_id, scope, summary_date)`.
6. Backfill forum topic rows from stored `raw_json` where possible.
7. Backfill message `topic_id` from `raw_json` using the same resolver.
8. Leave ambiguous messages at `topic_id = 0`.
9. Do not rewrite existing summary content.

### 12.2 Feature flag

Use a server-side feature flag:

```text
forum_topics_enabled
```

Default: `false` until topic discovery and migration verification pass.

When disabled:

- existing chat behavior is unchanged;
- topic-aware code paths are not shown;
- the migration remains backward compatible.

### 12.3 Release sequence

1. Schema and resolver, feature flag off.
2. Discovery and ingestion, flag on for one test forum.
3. Topic-aware management UI.
4. Topic summaries and chat aggregates.
5. Hierarchical selectors across all surfaces.
6. Summary workspace.
7. Evidence tracing.
8. Visual refinements.

## 13. Testing

### 13.1 Unit tests

- Topic resolver for each reply-header combination.
- General topic fallback.
- Non-forum unchanged behavior.
- Topic inheritance and override clearing.
- Parent/topic collection gates.
- Effective filter union.
- Summary scope uniqueness and selection.
- Scheduler APIs always name a scope; no ambiguous `chat/date` lookup may pick an
  aggregate or topic summary implicitly.
- Aggregate excludes raw messages.
- Digest selects exactly one effective source per chat.
- Legacy summary compatibility.
- Invalid topic/chat combinations.

### 13.2 Integration tests

- Discovery upserts topics and marks only a complete pass stale.
- Partial sync preserves prior topics.
- Incoming forum messages map to the right topic.
- Backfill is idempotent.
- Duplicate Telegram message ID across two topics is allowed.
- Duplicate message in the same topic is rejected or upserted.
- Topic summary followed by aggregate summary.
- Digest with a forum chat and a non-forum chat.
- Catch Up continues to read generated summaries only.
- Legacy rows survive migration.

### 13.3 Frontend verification

- Tree table expands and collapses without layout jumps.
- Parent switch does not overwrite child switches.
- Topic selector supports search and keyboard navigation.
- Deep links restore selection.
- Reader states are complete.
- Medium and narrow layouts do not preserve an empty column.
- All new visible strings have Chinese and English translations.

### 13.4 Manual acceptance

On the `ja-netfilter` forum:

1. Sync topics and confirm at least `General`, technical discussion, and the
   role-play topic are discovered.
2. Confirm existing messages are attributed or left unscoped with a reconciliation
   report.
3. Disable the role-play topic.
4. Send and backfill messages in both enabled and disabled topics.
5. Confirm only enabled-topic messages enter new summaries.
6. Generate topic summaries and one aggregate summary.
7. Confirm Daily Digest contains one source for the chat.
8. Confirm non-forum chats still generate and read normally.
9. Confirm the summary reader opens the selected topic from a deep link.

## 14. Acceptance Criteria

- Forum supergroups are detected and their topics are persisted.
- The UI uses hierarchical chat/topic selection and never calls topics
  “subgroups”.
- New and backfilled messages are attributed without duplicates.
- A parent switch and a topic switch have independent, documented semantics.
- Topic summaries and a derived chat aggregate exist for forum chats.
- Daily Digest receives exactly one effective source per chat.
- Existing non-forum chats and legacy summaries work unchanged.
- The summaries workspace is usable at wide, medium, and narrow widths.
- Evidence tracing is absent until its mapping and validation exist.
- Backend tests and the frontend production build pass.

## 15. Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Telegram reply headers are incomplete | Resolver falls back to General or unscoped and reconciles later |
| Topic discovery is partial | Never mark stale on partial passes |
| Raw JSON backfill has ambiguous topics | Keep `topic_id = 0` and report count |
| Duplicate summaries or digest sources | Enforce scope and one-source-per-chat rules |
| Overrides drift from parent settings | Explicit inheritance metadata and inheritance-aware updates |
| Three-column layout hurts laptops | Reader panel and evidence drawer, no permanent empty column |
| Citation hallucination | Only enable evidence after persisted, validated mappings |
| UI performance regressions | Keep global bootstrap lean; load topic details only when expanded |
| Migration locks a large messages table | Use additive columns, concurrent indexes where supported, and a bounded backfill |

## 16. Open Decisions

The following are intentionally fixed for implementation:

- Topic identity uses internal IDs; Telegram topic IDs remain external metadata.
- The UI term is “Topic”, not “subgroup”.
- Forum aggregate summaries are derived from topic summaries.
- Daily Digest uses one effective source per chat.
- The summaries workspace is not the global navigation model.
- Evidence tracing is a separate phase.

No implementation should proceed on an unresolved variant of these decisions
without revising this spec.
