package telegram

import (
	"context"
	"fmt"

	"github.com/fr0der1c/tgtldr/app/internal/model"
	"github.com/gotd/td/tg"
)

type TopicBackfillResult struct {
	Scanned          int   `json:"scanned"`
	TouchedLocalRows int64 `json:"touchedLocalRows"`
}

// BackfillTopicMessages 通过 Telegram 回复链确认消息属于哪个话题，只更新本地 topic_id。
func (s *Service) BackfillTopicMessages(ctx context.Context, chat model.Chat, topic model.ChatTopic) (TopicBackfillResult, error) {
	result := TopicBackfillResult{}
	if !chat.IsForum || topic.TelegramTopicID == generalForumTopicID {
		return result, nil
	}
	accountID := chat.CollectorAccountID
	if accountID == 0 {
		var err error
		accountID, err = s.resolveAccountID(ctx)
		if err != nil {
			return result, err
		}
	}
	accountChat, err := s.store.AccountChats.Get(ctx, accountID, chat.ID)
	if err != nil {
		return result, err
	}
	chat.TelegramAccess = accountChat.TelegramAccess
	client, _, err := s.newClient(accountID)
	if err != nil {
		return result, err
	}
	err = client.Run(ctx, func(ctx context.Context) error {
		status, err := client.Auth().Status(ctx)
		if err != nil {
			return err
		}
		if !status.Authorized {
			return s.markAuthLoggedOut(ctx, accountID)
		}
		inputPeer := &tg.InputPeerChannel{ChannelID: chat.TelegramChatID, AccessHash: chat.TelegramAccess}
		offsetID, offsetDate := 0, 0
		for {
			response, err := client.API().MessagesGetReplies(ctx, &tg.MessagesGetRepliesRequest{
				Peer: inputPeer, MsgID: int(topic.TelegramTopicID),
				OffsetID: offsetID, OffsetDate: offsetDate, Limit: 100,
			})
			if err != nil {
				return err
			}
			var messageClasses []tg.MessageClass
			switch value := response.(type) {
			case *tg.MessagesMessages:
				messageClasses = value.GetMessages()
			case *tg.MessagesChannelMessages:
				messageClasses = value.GetMessages()
			default:
				return fmt.Errorf("unexpected replies response %T", response)
			}
			ids := make([]int, 0, len(messageClasses))
			for _, messageClass := range messageClasses {
				msg, ok := messageClass.(*tg.Message)
				if !ok {
					continue
				}
				ids = append(ids, msg.ID)
				offsetID = msg.ID
				offsetDate = msg.Date
			}
			result.Scanned += len(ids)
			touched, err := s.store.Topics.AssignMessagesToTopic(ctx, chat.ID, topic.ID, ids)
			if err != nil {
				return err
			}
			result.TouchedLocalRows += touched
			if len(ids) < 100 {
				break
			}
		}
		return nil
	})
	if err != nil {
		return result, fmt.Errorf("backfill topic %d: %w", topic.TelegramTopicID, err)
	}
	return result, nil
}
