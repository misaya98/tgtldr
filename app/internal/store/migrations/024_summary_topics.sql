alter table summaries add column if not exists topic_id bigint not null default 0;

alter table summaries drop constraint if exists summaries_chat_id_summary_date_key;

create unique index if not exists idx_summaries_chat_topic_date
on summaries (chat_id, topic_id, summary_date);

create index if not exists idx_summaries_topic_date
on summaries (topic_id, summary_date desc);
