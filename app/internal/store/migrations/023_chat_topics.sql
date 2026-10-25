create table if not exists chat_topics (
    id bigint primary key generated always as identity,
    chat_id bigint not null references chats(id) on delete cascade,
    telegram_topic_id bigint not null,
    top_message_id bigint not null default 0,
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
