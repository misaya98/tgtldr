package telegram

import (
	"context"
	"fmt"

	"github.com/fr0der1c/tgtldr/app/internal/model"
	"github.com/gotd/td/tg"
)

// syncForumTopics 拉取论坛超级群的话题元数据。调用方负责持久化用户设置。
func (s *Service) syncForumTopics(ctx context.Context, client *tg.Client, chat model.Chat) ([]model.ChatTopic, error) {
	if !chat.IsForum {
		return nil, nil
	}
	if chat.ChatType != "supergroup" {
		return nil, fmt.Errorf("forum topics require a supergroup, got %s", chat.ChatType)
	}

	inputPeer := &tg.InputPeerChannel{
		ChannelID:  chat.TelegramChatID,
		AccessHash: chat.TelegramAccess,
	}
	result := make([]model.ChatTopic, 0)
	offsetDate := 0
	offsetID := 0
	offsetTopic := 0
	for {
		response, err := client.MessagesGetForumTopics(ctx, &tg.MessagesGetForumTopicsRequest{
			Peer:        inputPeer,
			OffsetDate:  offsetDate,
			OffsetID:    offsetID,
			OffsetTopic: offsetTopic,
			Limit:       100,
		})
		if err != nil {
			return nil, err
		}
		for _, topicClass := range response.GetTopics() {
			topic, ok := topicClass.(*tg.ForumTopic)
			if !ok {
				continue
			}
			result = append(result, model.ChatTopic{
				TelegramTopicID: int64(topic.ID),
				Title:           topic.Title,
				IconColor:       topic.IconColor,
				IconEmojiID:     topic.IconEmojiID,
				IsClosed:        topic.Closed,
				IsPinned:        topic.Pinned,
				Enabled:         true,
				SummaryEnabled:  true,
				TopMessageID:    int64(topic.TopMessage),
			})
		}
		if len(response.GetTopics()) == 0 || len(result) >= response.GetCount() {
			break
		}
		last := response.GetTopics()[len(response.GetTopics())-1]
		lastTopic, ok := last.(*tg.ForumTopic)
		if !ok {
			break
		}
		offsetDate = lastTopic.Date
		offsetID = lastTopic.TopMessage
		offsetTopic = lastTopic.ID
	}

	hasGeneral := false
	for _, topic := range result {
		if topic.TelegramTopicID == generalForumTopicID {
			hasGeneral = true
			break
		}
	}
	if !hasGeneral {
		result = append(result, model.ChatTopic{
			TelegramTopicID: generalForumTopicID,
			Title:           "General",
			Enabled:         true,
			SummaryEnabled:  true,
		})
	}
	return result, nil
}

// SyncChatTopics 为单个群组发现并持久化论坛话题，供管理页按需刷新。
func (s *Service) SyncChatTopics(ctx context.Context, chat model.Chat) ([]model.ChatTopic, error) {
	if !chat.IsForum {
		return []model.ChatTopic{}, nil
	}
	accountID := chat.CollectorAccountID
	if accountID == 0 {
		var err error
		accountID, err = s.resolveAccountID(ctx)
		if err != nil {
			return nil, err
		}
	}
	accountChat, err := s.store.AccountChats.Get(ctx, accountID, chat.ID)
	if err != nil {
		return nil, err
	}
	chat.TelegramAccess = accountChat.TelegramAccess
	client, _, err := s.newClient(accountID)
	if err != nil {
		return nil, err
	}
	var topics []model.ChatTopic
	err = client.Run(ctx, func(ctx context.Context) error {
		status, err := client.Auth().Status(ctx)
		if err != nil {
			return err
		}
		if !status.Authorized {
			return s.markAuthLoggedOut(ctx, accountID)
		}
		discovered, syncErr := s.syncForumTopics(ctx, client.API(), chat)
		if syncErr != nil {
			return syncErr
		}
		keepIDs := make([]int64, 0, len(discovered))
		for _, topic := range discovered {
			saved, upsertErr := s.store.Topics.UpsertDiscovered(ctx, chat.ID, topic)
			if upsertErr != nil {
				return upsertErr
			}
			keepIDs = append(keepIDs, saved.TelegramTopicID)
		}
		if err := s.store.Topics.MarkStale(ctx, chat.ID, keepIDs); err != nil {
			return err
		}
		topics, err = s.store.Topics.ListByChat(ctx, chat.ID)
		return err
	})
	if err != nil {
		return nil, wrapTelegramError(err)
	}
	return topics, nil
}
