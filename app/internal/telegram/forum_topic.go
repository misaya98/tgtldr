package telegram

import (
	"github.com/fr0der1c/tgtldr/app/internal/model"
	"github.com/gotd/td/tg"
)

const generalForumTopicID = 1

// resolveMessageTopic 解析论坛消息所属的 Telegram 话题 ID。
// 非论坛消息返回 (0, false, false)，论坛消息无法取得具体话题时使用 General。
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

// shouldStoreTopicMessage 判断论坛消息是否应落库。无法解析话题时保留消息，避免数据丢失。
func shouldStoreTopicMessage(chat model.Chat, topic model.ChatTopic, topicResolved bool) bool {
	if !chat.IsForum {
		return true
	}
	if !topicResolved {
		return true
	}
	return topic.Enabled
}
